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
import { applyMobileFloor, worsensSectionMobile } from '@/lib/registration/editor/utils/applyMobileFloor';
import { applyToneRhythm } from '@/lib/registration/editor/utils/applyToneRhythm';
import { applyLegibleText, capScenePhotos, closePhotoBottoms } from '@/lib/registration/editor/utils/applyLegibility';
import { alignPointBadges } from '@/lib/registration/editor/utils/sectionConverter/pointBadges';
import { applyImageAnnotations } from '@/lib/registration/editor/utils/sectionConverter/annotations';
import type { AnnotationRenderStats } from '@/lib/registration/editor/utils/sectionConverter/annotations';
import { readDesignCut } from '@/lib/registration/editor/utils/sectionConverter/designCut/contract';
import { readLongRecord } from '@/lib/registration/long-sections';
import { composeDesignCut } from '@/lib/registration/editor/utils/sectionConverter/designCut/compose';
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
export const PRESET_EXEMPT_SECTIONS = new Set<string>([
  ProSectionType.CTA,
  ProSectionType.PERFORMANCE_SALES,
  ProSectionType.COMPARE_DIV,
  ProSectionType.COMPARE2_DIV,
  ProSectionType.PRODUCT_EXPOSURE,
  ProSectionType.KEY_MESSAGE,
]);

/**
 * 최초 빌드 측정(품질 보고서 pdp-enrichment T4b) — options.stats를 넘겼을 때만 센다. 문서는 바뀌지 않는다.
 * layouts: 배정 프리셋을 적용해 본 섹션 수(tried) 중 적용·유실 가드 탈락·모바일 위반 증가로 되돌림.
 */
export interface EditorBuildStats {
  layouts: { tried: number; applied: number; guardDropped: number; mobileReverted: number };
  annotations: AnnotationRenderStats;
}

export async function buildEditorDocument(
  pdpId: string,
  result: EditorDataResponse,
  options?: { stats?: EditorBuildStats },
): Promise<ProEditorDocument> {
  const stats = options?.stats;
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
      enrichment?: { features?: string[] };
    } | null | undefined;
    // 모바일 하한 변형·후처리 — 서버 판정(mobile_floor: Track S 또는 mobile 기록 잡). 판정 없는 응답은 기록으로 본다
    const mobileFloor = result.mobile_floor === true || sectionPlan?.enrichment?.features?.includes('mobile') === true;
    // 옵션 갤러리(T6b) — options 기록 잡만. 실제 전환은 spec_sheet.optionSpec이 있을 때만(변환기 판정)
    const optionGallery = sectionPlan?.enrichment?.features?.includes('options') === true;
    // 특징·사진 중복 정리(R2) — persuasion 기록 잡만(설득 플래너 골격). 기록 없는 잡(Track S·대조군·구 잡)은 그대로
    const featureDedupe = sectionPlan?.enrichment?.features?.includes('persuasion') === true;
    // 디자인 컷(D2): section_plan.designcut 기록 잡만 — 배정 섹션을 템플릿으로 바꾸고 kept와 함께 section_order로 늘어놓는다(아래)
    const designCut = readDesignCut(result.section_plan);
    // R4 렌더 리듬(NEXFIT 대비 비교) — R3 최초 빌드와 같은 게이트(persuasion 기록, 디자인 컷 잡 제외).
    // 테마는 행간·바탕을 덮지 않고(크기는 올릴 때만), 경계 여백은 거터부터 덜고, 섹션 안 간격을 줄인다. Track S·대조군·구 잡은 그대로
    const renderRhythm = featureDedupe && !designCut;
    // W4-S 섹션 나누기 — split 기록 잡(persuasion 골격, 디자인 컷 잡 제외)만. 특징·사용 단계를 하나씩 섹션으로 펼친다
    const sectionSplit = featureDedupe && !designCut && sectionPlan?.enrichment?.features?.includes('split') === true;
    // 긴 상세페이지 확장 섹션 — long 기록 + 설계 근거 기록(section_plan.long) 잡(persuasion 골격, 디자인 컷 잡 제외)만.
    // 질문은 설득 기록의 고객 고민에서 나온다(편집기는 분석을 받지 않는다)
    const planRecord = result.section_plan as
      | { long?: unknown; internalized_skeleton?: { persuasion?: { objectionCoverage?: Array<{ objection: string; type?: string }> } } }
      | null
      | undefined;
    const longOn = featureDedupe && !designCut && sectionPlan?.enrichment?.features?.includes('long') === true;
    const longRecord = longOn ? readLongRecord(planRecord?.long) : null;
    const longSections =
      longRecord && longRecord.kinds.length > 0
        ? {
            kinds: longRecord.kinds,
            objections: (planRecord?.internalized_skeleton?.persuasion?.objectionCoverage ?? []).map((o) => ({
              objection: o.objection,
              ...(o.type ? { type: o.type } : {}),
            })),
          }
        : null;

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
        ...(mobileFloor ? { mobile_floor: true } : {}),
        ...(optionGallery ? { option_gallery: true } : {}),
        ...(featureDedupe ? { feature_dedupe: true } : {}),
        ...(renderRhythm ? { render_rhythm: true } : {}),
        ...(sectionSplit ? { section_split: true } : {}),
        ...(longSections ? { long_sections: longSections } : {}),
        // 긴 상세페이지 사용 장면(L-2) — 설계 기록(images)이 있고 태그·생성 컷이 있을 때만 변환기가 섹션을 짓는다
        ...(longRecord?.images ? { long_scenes: true } : {}),
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
          // 긴 상세페이지 확장 섹션(스펙 표 빌더로 지은 표)은 스펙 표에 고른 프리셋을 받지 않는다 — 구매 전 질문의 위아래 한 열이 풀린다
          if (sec.expansion) return sec;
          const assignedId = layoutAssignments[sec.sectionType];
          if (!assignedId || assignedId.endsWith('_layout_01')) return sec;
          const presets = await loadLayoutPresets(sec.sectionType);
          const preset = presets.find((p) => p.id === assignedId);
          if (!preset) return sec;
          // R4 렌더 리듬 잡: 매칭 안 된 슬롯은 빈 요소로 만들지 않는다(빈 띠 방지 — 유실 가드 판정은 그대로)
          const applied = applyLayoutPresetIfSafe(sec, preset, palette, renderRhythm ? { omitEmptySlots: true } : undefined);
          if (stats) stats.layouts.tried++;
          // mobile 기록 잡: 실제 카피로 섹션 단위 모바일 위반이 늘면 빌더 레이아웃 유지(설계 §4.3-7)
          if (applied && mobileFloor && worsensSectionMobile(sec, applied)) {
            if (stats) stats.layouts.mobileReverted++;
            return sec;
          }
          if (stats) stats.layouts[applied ? 'applied' : 'guardDropped']++;
          return applied ?? sec;
        }),
      );
    }

    // Track I(결정 T-5): 서버 해석 테마를 최초 빌드에만 적용 — 저장본 재로드(아래 else 분기)는 미적용.
    // 프리셋 적용 뒤에 얹어 테마가 초기 기본값의 최종 결정자가 되게 한다. 높이 정합은 마운트 reflow 소관.
    if (result.internalized_theme && Object.keys(result.internalized_theme).length > 0) {
      converted = applyInternalizedTheme(converted, result.internalized_theme, { tokenRhythm: renderRhythm });
    }
    if (mobileFloor) converted = applyMobileFloor(converted, { gutterFirst: renderRhythm });
    // 디자인 컷: 장식(T4)은 그다음에 얹혀 T3a 제품 카드(roundedRect 액자)에 붙는다. 기록 없는 잡은 그대로다.
    // persuasion 기록 잡의 최초 빌드(R3) — 디자인 컷 잡은 D1 계획이 바탕·히어로를 정해 건너뛴다.
    // ① 톤 리듬: 섹션 바탕을 D1 교차 규칙으로 다시 배정한다 — 테마 다음에 바탕의 최종 결정자다. R4: 짙은 띠 하나, 같은 톤 이웃 경계 표시
    // ② 판독성(r7): 인물·연출 컷 높이 상한은 톤 리듬 전에(사진 주도 판정이 최종 높이를 보게), 보조 문구 크기·대비는 바탕이 정해진 맨 뒤에
    // 후킹(첫 화면)은 카피와 이미지로만 — 상품명·옵션 사실 줄(R3 heroFacts)은 2026-10-30 오너 지시로 뺐다
    if (renderRhythm) {
      converted = closePhotoBottoms(capScenePhotos(converted));
      converted = applyToneRhythm(converted, palette);
      converted = applyLegibleText(converted);
    }
    // 핵심 포인트 번호 원: 테마·하한이 제목 크기·행간을 바꿨어도 제목 첫 줄에 붙인다(빌더와 같은 규칙, 맞으면 그대로)
    converted = alignPointBadges(converted);
    if (designCut) {
      converted = composeDesignCut(converted, designCut, {
        images,
        sectionOrder: sectionPlan?.section_order ?? [],
        specSheet,
        heroCopyZone: result.hero_copy_zone ?? null,
        imageAspects: result.image_aspects ?? null,
        productBoxes: result.product_boxes ?? null,
        // T5 단계 사진(D2 ①): 사용 컷 howto:j는 카피 howTo[j]로 만들어진다 — 계획 단계 제목과 대조한다
        howToSteps: Array.isArray(copywriting?.howTo) ? copywriting.howTo.map((h) => h?.step ?? null) : null,
        // 뺀 컷(usegate 잡, J44): 응답에 칸이 있을 때만 — K 목록 항목을 글째 뺀다
        droppedCuts: result.dropped_cuts ?? null,
      });
    }
    // 강조 장식(T4): 프리셋·테마·하한을 모두 적용한 최종 배치 위에 얹는다 — 라벨·원형 확대가 프리셋 유실 가드 판정에
    // 끼지 않고, 투영이 최종 transform·크롭을 쓰게. 장식이 없는 응답(Track S·구 잡)은 아무것도 하지 않는다.
    if (result.annotations) {
      converted = applyImageAnnotations(converted, result.annotations, palette, stats?.annotations);
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
        // GIF 칸(세션 B ③ P4) — 굽기가 포스터 자리를 움직이는 WebP로 바꾼다. 움직임 칸이 없는 잡은 키가 없다
        ...(result.motion_clips ? { motionClips: result.motion_clips } : {}),
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
        // 저장본도 옵션 등록용 내보내기(읽기 전용)가 등록 옵션 구조를 읽게 그것만 싣는다(T6b)
        specSheet: result.spec_sheet?.optionSpec ? { optionSpec: result.spec_sheet.optionSpec } : {},
        // 저장본도 GIF 칸 지도를 싣는다 — 사진 요소의 src가 포스터 그대로면 굽기가 그 자리를 WebP로 바꾼다
        ...(result.motion_clips ? { motionClips: result.motion_clips } : {}),
      },
      sections: migrateSectionsData(result.sections_data as CanvasSection[]),
      ...(initialBaseline ? { initialBaseline } : {}),
      settings: { canvasWidth: 860, defaultFont: 'Pretendard' },
    };
  }

  return doc;
}
