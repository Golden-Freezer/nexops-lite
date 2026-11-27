// ─── 에디터 문서 빌더 ─────────────────────────────────────────────────────────
// fetchEditorData() 응답(EditorDataResponse)을 ProEditorDocument로 변환한다.
// MainCanvas(데스크탑 에디터)와 MobileEditorViewer(모바일 읽기 전용 뷰어)가
// 동일한 문서 구성 로직을 공유하기 위해 분리했다 — 원래 MainCanvas.tsx 내부
// loadEditor()에 있던 로직을 그대로 옮긴 것이며 동작 변경은 없다.

import { ProSectionType } from '@/lib/registration/editor/types/section';
import type { CopywritingResult, DesignPalette, ProEditorDocument } from '@/lib/registration/editor/types/editor';
import type { CanvasSection } from '@/lib/registration/editor/types/canvas';
import { convertToCanvasSections, mapBackendSectionsToProTypes } from '@/lib/registration/editor/utils/sectionConverter';
import type { LayoutSelection } from '@/lib/registration/editor/utils/sectionConverter';
import { loadLayoutPresets } from '@/lib/registration/editor/data/layouts';
import { applyLayoutPresetIfSafe, ENABLE_INITIAL_PRESET_APPLY } from '@/lib/registration/editor/utils/applyLayoutPreset';
import { migrateSectionsData } from '@/lib/registration/editor/utils/sectionsMigration';
import { applyInternalizedTheme } from '@/lib/registration/editor/utils/applyInternalizedTheme';
import {
  BASELINE_ASSIGNMENT_KEY,
  captureInitialBaseline,
  parseBaseline,
} from '@/lib/registration/editor/utils/editorBaseline';
import type { EditorDataResponse } from '@/lib/registration/editor/services/editorApi';

/**
 * 밴드형/2이미지 프리셋 적용을 건너뛰는 섹션.
 * - CTA·perf_sales: 전면 배경 + 오버레이 텍스트 구성
 * - compare_div·compare2_div: 비교 테이블 + 단일 이미지 구성(프리셋의 2이미지
 *   split이 빈 슬롯을 만들어 레이아웃이 깨짐)
 * - 전용 디자인(텍스트 밴드/컬러 블록)이 정본 — AI 프리셋 재배치가 밴드·블록을 파괴
 */
const PRESET_EXEMPT_SECTIONS = new Set<string>([
  ProSectionType.CTA,
  ProSectionType.PERFORMANCE_SALES,
  ProSectionType.COMPARE_DIV,
  ProSectionType.COMPARE2_DIV,
  ProSectionType.PRODUCT_EXPOSURE,
  ProSectionType.KEY_MESSAGE,
]);

export async function buildEditorDocument(
  pdpId: string,
  result: EditorDataResponse,
): Promise<ProEditorDocument> {
  // API 응답에서 실제 파이프라인 데이터 추출
  const copywriting = result.copywriting_result as CopywritingResult | null | undefined;
  const images = result.generated_images as Record<string, string | string[]> | null | undefined;
  const palette: DesignPalette = (copywriting?.designPalette as DesignPalette | undefined) ?? {
    primary: '#1A1A2E',
    secondary: '#E94560',
    bgMain: '#FFFFFF',
    bgSub: '#F7F7F7',
    textMain: '#333333',
    textHighlight: '#1A1A2E',
  };

  let doc: ProEditorDocument;

  if (result.is_new || !result.sections_data?.length) {
    // 신규: 실제 파이프라인 데이터로 초기 문서 생성
    if (!copywriting || !images) {
      throw new Error(
        '파이프라인 결과(카피라이팅/이미지)를 찾을 수 없습니다. ' +
        '생성이 완료된 PDP인지 확인해주세요.',
      );
    }
    const specSheet = (result.spec_sheet as Record<string, unknown> | null | undefined) ?? {};

    // AI 레이아웃 선택 적용: section_plan.layout_selections → layout_assignments
    const layoutSelections = (
      result.section_plan as { layout_selections?: Record<string, string> } | null | undefined
    )?.layout_selections;
    let layoutAssignments: Record<string, string> = {};
    // 트랙 4 D-3: 프리셋의 cardParams(리뷰 카드 밀도)를 함께 수집해 변환에 전달
    const presetCardParams: NonNullable<LayoutSelection['card_params']> = {};
    if (layoutSelections && Object.keys(layoutSelections).length > 0) {
      const assignmentEntries = await Promise.all(
        Object.entries(layoutSelections).map(async ([backendKey, category]) => {
          // 백엔드 section_plan 키(main_intro, reviews …)를 ProSectionType으로
          // 변환 후 프리셋 매칭 — 미변환 시 전 섹션이 _layout_01로 폴백돼
          // AI 카테고리 선택이 무력화된다
          const [sectionType] = mapBackendSectionsToProTypes([backendKey]);
          if (!sectionType) return null;
          const presets = await loadLayoutPresets(sectionType);
          const match = presets.find((p) => p.category === category);
          if (match?.cardParams) presetCardParams[sectionType] = match.cardParams;
          return match ? ([sectionType as string, match.id] as const) : null;
        }),
      );
      layoutAssignments = Object.fromEntries(
        assignmentEntries.filter((e): e is readonly [string, string] => e !== null),
      );
    }

    // section_plan에서 LayoutSelection 구성
    const sectionPlan = result.section_plan as {
      activated_sections?: string[];
      section_order?: string[];
      hook_strategy?: { hero_frame?: string; image_hooking?: boolean; brand_name?: string };
      layout_selections?: Record<string, string>;
      font_scheme?: LayoutSelection['font_scheme'];
    } | null | undefined;

    let layoutSelection: LayoutSelection | undefined;
    if (sectionPlan?.activated_sections?.length) {
      layoutSelection = {
        activated_sections: mapBackendSectionsToProTypes(sectionPlan.activated_sections).map(String),
        section_order: sectionPlan.section_order
          ? mapBackendSectionsToProTypes(sectionPlan.section_order).map(String)
          : [],
        layout_assignments: layoutAssignments,
        hook_strategy: sectionPlan.hook_strategy,
        card_params: presetCardParams,
        font_scheme: sectionPlan.font_scheme,
      };
    }

    let converted = convertToCanvasSections(copywriting, images, palette, layoutSelection, specSheet);

    // 트랙 B-2: AI가 기본값이 아닌 프리셋을 고른 섹션은 초기 화면에도 실제 반영.
    // 콘텐츠 유실 가드(applyLayoutPresetIfSafe)를 통과하지 못하면 빌더 레이아웃 유지.
    if (ENABLE_INITIAL_PRESET_APPLY && Object.keys(layoutAssignments).length > 0) {
      converted = await Promise.all(
        converted.map(async (sec) => {
          // CTA·perf_sales는 빌더가 '전면 배경 이미지 + 오버레이 텍스트' 특수
          // 구성이라, 이미지를 밴드로 재배치하는 프리셋과 충돌(예: CTA 이미지가
          // 292px 밴드로 잘림). 이 둘은 빌더 레이아웃을 유지한다.
          if (PRESET_EXEMPT_SECTIONS.has(sec.sectionType)) return sec;
          const assignedId = layoutAssignments[sec.sectionType];
          if (!assignedId || assignedId.endsWith('_layout_01')) return sec;
          const presets = await loadLayoutPresets(sec.sectionType);
          const preset = presets.find((p) => p.id === assignedId);
          if (!preset) return sec;
          return applyLayoutPresetIfSafe(sec, preset, palette) ?? sec;
        }),
      );
    }

    // Track I(결정 T-5): 서버 해석 테마를 최초 빌드에만 적용 — 저장본 재로드(아래 else 분기)는 미적용.
    // 프리셋 적용 뒤에 얹어 테마가 초기 기본값의 최종 결정자가 되게 한다. 높이 정합은 마운트 reflow 소관.
    if (result.internalized_theme && Object.keys(result.internalized_theme).length > 0) {
      converted = applyInternalizedTheme(converted, result.internalized_theme);
    }

    const sections = migrateSectionsData(converted);
    // reflow 전 상태 캡처 — 복원 시 needsInitialReflow가 다시 발화해 최초 뷰와 동일 수렴
    const initialBaseline = captureInitialBaseline(sections);
    doc = {
      id: `doc-${pdpId}`,
      pdpId,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      meta: {
        productName: copywriting.mainIntro?.title ?? '',
        brandName: copywriting.mainIntro?.subtitle ?? '',
        category: copywriting.mainIntro?.category ?? '',
        essenceType: 'convenience',
        planTier: 'pro',
      },
      sourceData: {
        copywritingResult: copywriting,
        generatedImages: images,
        designPalette: palette,
        specSheet: specSheet,
      },
      sections,
      initialBaseline,
      settings: { canvasWidth: 860, defaultFont: 'Pretendard' },
    };
  } else {
    // 기존 저장 데이터 로드
    const initialBaseline = parseBaseline(
      result.layout_assignments?.[BASELINE_ASSIGNMENT_KEY],
    );
    doc = {
      id: `doc-${pdpId}`,
      pdpId,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      meta: {
        productName: copywriting?.mainIntro?.title ?? '',
        brandName: copywriting?.mainIntro?.subtitle ?? '',
        category: copywriting?.mainIntro?.category ?? '',
        essenceType: 'convenience',
        planTier: 'pro',
      },
      sourceData: {
        copywritingResult: copywriting ?? ({} as CopywritingResult),
        generatedImages: images ?? {},
        designPalette: palette,
        specSheet: {},
      },
      sections: migrateSectionsData(result.sections_data as CanvasSection[]),
      ...(initialBaseline ? { initialBaseline } : {}),
      settings: { canvasWidth: 860, defaultFont: 'Pretendard' },
    };
  }

  return doc;
}
