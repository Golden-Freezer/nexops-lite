// sectionConverter/convert.ts — D1 분할: 원본 sectionConverter.ts 20~33행, 2043~2381행 순수 이동 (2026-07-04)


import { ProSectionType, STANDARD_TO_PRO_MAPPING } from '@/lib/registration/editor/types/section';
import {
  PRO_DEFAULT_SECTION_ORDER,
  SECTION_GROUP_MAP,
  SECTION_IMAGE_MAPPING,
} from '@/lib/registration/editor/constants/sectionConfig';
import type { CanvasSection, CanvasElement, ReviewCardParams } from '@/lib/registration/editor/types/canvas';
import {
  REVIEW_CARD_DEFAULTS,
  SECTION_FONT_SCHEME,
  HEADING_FONT_WHITELIST,
  BODY_FONT_WHITELIST,
} from '@/lib/registration/editor/constants/designTokens';
import type { SectionGroupKey, GroupFontPair } from '@/lib/registration/editor/constants/designTokens';
import { isAllowedEditorFont } from '@/lib/registration/editor/constants/fonts';
import type { CopywritingResult, DesignPalette } from '@/lib/registration/editor/types/editor';
import { uid, str, sanitizeImageUrl, computeSectionHeight } from './helpers';
import { resolveImageUrl, buildFeatureImageSlots, buildContext, extractContent } from './content';
import { createSectionElements } from './sections';
import type { SectionBuildExtra } from './sections';
import { filterValidSections, insertWhiteDividers, applySafetyGuards } from './guards';


// ─────────────────────────────────────────────────────────────────────────────
// Public interface — layoutSelection (DesignPrompt 출력의 layout_selection 블록)
// ─────────────────────────────────────────────────────────────────────────────
export interface LayoutSelection {
  activated_sections: string[];
  section_order: string[];
  layout_assignments: Record<string, string>;
  hook_strategy?: {
    hero_frame?: string;
    image_hooking?: boolean;
    brand_name?: string;
  };
  /** 트랙 4 D-3: 프리셋 cardParams (sectionType → 부분 오버라이드) */
  card_params?: Record<string, Partial<ReviewCardParams>>;
  /** 트랙 5/7: 생성 파이프라인의 그룹별 폰트 스킴 (section_plan.font_scheme) */
  font_scheme?: Partial<Record<SectionGroupKey, Partial<GroupFontPair>>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 트랙 5: 섹션 그룹별 폰트 스킴 적용
// makeTextEl이 요소에 스탬프한 typoLevel 기준으로, heading(display/h1/h2) /
// body(body/caption) 폰트를 그룹 스킴으로 치환한다. AI(section_plan.font_scheme)
// 지정 폰트는 화이트리스트 + 에디터 로드 가능 목록을 통과해야만 적용된다.
// ─────────────────────────────────────────────────────────────────────────────
const HEADING_LEVELS = new Set(['display', 'h1', 'h2']);
const HEADING_ALLOWED = new Set<string>(HEADING_FONT_WHITELIST);
const BODY_ALLOWED = new Set<string>(BODY_FONT_WHITELIST);

function resolveGroupFonts(
  groupType: SectionGroupKey,
  override?: Partial<GroupFontPair>,
): GroupFontPair {
  const base = SECTION_FONT_SCHEME[groupType];
  const heading =
    override?.heading && HEADING_ALLOWED.has(override.heading) && isAllowedEditorFont(override.heading)
      ? override.heading
      : base.heading;
  const body =
    override?.body && BODY_ALLOWED.has(override.body) && isAllowedEditorFont(override.body)
      ? override.body
      : base.body;
  return { heading, body };
}

function applySectionFontScheme(
  elements: CanvasElement[],
  groupType: SectionGroupKey,
  override?: Partial<GroupFontPair>,
): void {
  const fonts = resolveGroupFonts(groupType, override);
  for (const el of elements) {
    const tp = el.textProps;
    if (el.type !== 'text' || !tp?.typoLevel) continue;
    tp.fontFamily = HEADING_LEVELS.has(tp.typoLevel) ? fonts.heading : fonts.body;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// 배경 연출 — 밝기 가드
// 빌더가 생성하는 텍스트(#333 계열)는 밝은 배경을 전제한다. AI 팔레트가
// 어두운 배경을 내면 대비 붕괴 → 라이트 폴백으로 가드한다.
// ─────────────────────────────────────────────────────────────────────────────
function lightOr(hex: string | undefined, fallback: string): string {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex.trim())) return fallback;
  const h = hex.trim().slice(1);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 >= 160 ? hex.trim() : fallback;
}

/** hex를 factor(<1 어둡게)로 조정 — perf_sales 완판 섹션 다크 배경용 */
function darkenHex(hex: string | undefined, factor: number, fallback: string): string {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex.trim())) return fallback;
  const h = hex.trim().slice(1);
  const adj = (c: number) => Math.max(0, Math.min(255, Math.round(c * factor)));
  const r = adj(parseInt(h.slice(0, 2), 16));
  const g = adj(parseInt(h.slice(2, 4), 16));
  const b = adj(parseInt(h.slice(4, 6), 16));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. mapStandardToProSections
//    CopywritingResult의 실제 데이터 유무로 활성화할 Pro 섹션 결정
// ─────────────────────────────────────────────────────────────────────────────
export function mapStandardToProSections(
  copy: CopywritingResult,
  specSheet?: Record<string, unknown>,
): ProSectionType[] {
  const active: ProSectionType[] = [];
  const ctx = buildContext(specSheet);

  const checks: Array<{ key: keyof typeof STANDARD_TO_PRO_MAPPING; hasData: boolean }> = [
    { key: 'sold_out_banner', hasData: ctx.soldOutCount !== null },
    { key: 'main_intro',      hasData: !!copy.mainIntro?.title },
    { key: 'reviews',         hasData: !!(copy.reviewHighlights && copy.reviewHighlights.length > 0) },
    { key: 'problem',         hasData: !!(copy.problem?.question) },
    { key: 'solution',        hasData: !!(copy.solution?.declaration) },
    { key: 'point_cards',     hasData: !!(copy.pointCards && copy.pointCards.length > 0) },
    { key: 'detail_points',   hasData: !!(copy.detailPoints && copy.detailPoints.length > 0) },
    { key: 'usage_tags',      hasData: !!(copy.usageSceneTags && copy.usageSceneTags.length > 0) },
    { key: 'how_to',          hasData: !!(copy.howTo && copy.howTo.length > 0) },
    { key: 'color_options',   hasData: !!(copy.colorOptions?.options && copy.colorOptions.options.length > 0) },
    { key: 'recommended_targets', hasData: !!(copy.recommendedTargets && copy.recommendedTargets.length > 0) },
    { key: 'spec_table',      hasData: true },
    { key: 'cta',             hasData: !!copy.closingCta },
  ];

  for (const { key, hasData } of checks) {
    if (hasData) {
      const proTypes = STANDARD_TO_PRO_MAPPING[key];
      if (proTypes) {
        for (const pt of proTypes) {
          if (!active.includes(pt)) active.push(pt);
        }
      }
    }
  }

  return PRO_DEFAULT_SECTION_ORDER.filter((t) => active.includes(t));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2-b. resolveSectionOrder
//      섹션 순서 우선순위 결정 (사용자 편집 > AI 설계 > 기본값)
//
//  1순위: savedOrder  — 사용자가 에디터에서 드래그&드롭으로 변경한 순서
//  2순위: aiOrder     — DesignPrompt section_plan.section_order
//  3순위: PRO_DEFAULT_SECTION_ORDER (fallback)
// ─────────────────────────────────────────────────────────────────────────────
export function resolveSectionOrder(
  savedOrder: string[] | null | undefined,
  aiOrder: string[] | null | undefined,
  activatedSections: string[],
): string[] {
  // 1순위: 사용자가 편집한 순서
  if (savedOrder && savedOrder.length > 0) {
    const missing = activatedSections.filter((s) => !savedOrder.includes(s));
    return [...savedOrder.filter((s) => activatedSections.includes(s)), ...missing];
  }

  // 2순위: AI가 설계한 순서
  if (aiOrder && aiOrder.length > 0) {
    const missing = activatedSections.filter((s) => !aiOrder.includes(s));
    return [...aiOrder.filter((s) => activatedSections.includes(s)), ...missing];
  }

  // 3순위: 기본 템플릿 순서
  const defaultFiltered = PRO_DEFAULT_SECTION_ORDER.filter((s) =>
    activatedSections.includes(s as string),
  );
  const missing = activatedSections.filter(
    (s) => !(PRO_DEFAULT_SECTION_ORDER as string[]).includes(s),
  );
  return [...defaultFiltered, ...missing];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2-c. shouldActivateSection
//      데이터 미비 섹션을 초기 생성 시 제외하는 필터
// ─────────────────────────────────────────────────────────────────────────────
function shouldActivateSection(
  sectionType: string,
  content: Record<string, unknown>,
  images: Record<string, string | string[]>,
): boolean {
  switch (sectionType) {
    case 'perf_sales':
      return !!content.soldOutCount && Number(content.soldOutCount) > 0;
    case 'perf_rating':
      // 실제 평점 데이터(reviews[].rating)가 있을 때만 활성화. 없으면 기본값
      // 4.9/5.0을 지어내 표기 → 허위 표시 위험(전자상거래법)이므로 섹션 제외.
      return !!content.hasRealRating;
    case 'event_banner': {
      // event_banner 이미지가 있으면 활성화 (이미지 없어도 eventBanner/discountInfo 데이터가 있으면 활성화)
      const key = SECTION_IMAGE_MAPPING['event_banner']?.imageKey;
      if (key) {
        const imgVal = images[key];
        const imgStr = Array.isArray(imgVal) ? (imgVal[0] ?? '') : (imgVal ?? '');
        if (sanitizeImageUrl(imgStr as string)) return true;
      }
      return !!(content.eventBanner || content.discountInfo);
    }
    case 'perf_reviews': {
      // extractContent는 'reviews' 키로 반환; Pro 파이프라인은 'reviewHighlights' 사용
      const rv = content.reviews ?? content.reviewHighlights;
      return Array.isArray(rv) && (rv as unknown[]).length > 0;
    }
    case 'event_bundle': {
      // 세트 구성 섹션 — 묶음(bundle_arrangement) 이미지가 있을 때만 활성화.
      // 단품인데 "세트 구성" 섹션이 이미지 없이 제목만 뜨는 과활성 방지.
      const imgVal = images['bundle_arrangement'];
      const imgStr = Array.isArray(imgVal) ? (imgVal[0] ?? '') : (imgVal ?? '');
      return !!sanitizeImageUrl(imgStr as string);
    }
    case 'petit_div': {
      // 컬러/옵션 섹션 — 옵션이 2개 이상일 때만 활성화. 단색(옵션 1개) 상품에서
      // "컬러 옵션" 섹션이 정보가치 없이 뜨는 것 방지.
      const opts = content.options;
      return Array.isArray(opts) && opts.filter(Boolean).length >= 2;
    }
    case 'convert_div':
      return !!(content.ctaHeadline || content.closingCta);
    case 'product_exposure': {
      const key = SECTION_IMAGE_MAPPING['product_exposure']?.imageKey ?? '';
      if (!key) return false;
      const imgVal = images[key];
      const imgStr = Array.isArray(imgVal) ? (imgVal[0] ?? '') : (imgVal ?? '');
      return !!sanitizeImageUrl(imgStr as string);
    }
    default:
      return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. assignImagesToSections
//    SECTION_IMAGE_MAPPING 기반으로 각 섹션에 이미지 URL 배정
// ─────────────────────────────────────────────────────────────────────────────
export function assignImagesToSections(
  sections: CanvasSection[],
  images: Record<string, string | string[]>,
): CanvasSection[] {
  return sections.map((section) => {
    // Task 1: per-element 이미지가 이미 인덱스별로 설정된 섹션은 덮어쓰기 방지
    if (
      section.sectionType === ProSectionType.DIVIDER ||
      section.sectionType === ProSectionType.MAIN_CUT ||
      section.sectionType === ProSectionType.POINT_DIV ||
      section.sectionType === ProSectionType.SUB_DIV ||
      section.sectionType === ProSectionType.HIDDEN_PAGE
    ) return section;
    const url = resolveImageUrl(section.sectionType, images);

    const updatedElements = section.elements.map((el) => {
      if (el.type === 'image' && el.imageProps && url) {
        return { ...el, imageProps: { ...el.imageProps, src: url } };
      }
      if (el.type === 'framed-image' && el.framedImageProps && url) {
        return { ...el, framedImageProps: { ...el.framedImageProps, src: url } };
      }
      return el;
    });

    return { ...section, elements: updatedElements };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. convertToCanvasSections  ← main entry point
// ─────────────────────────────────────────────────────────────────────────────
export function convertToCanvasSections(
  copywritingResult: CopywritingResult,
  generatedImages: Record<string, string | string[]>,
  designPalette: DesignPalette,
  layoutSelection?: LayoutSelection,
  specSheet?: Record<string, unknown>,
): CanvasSection[] {
  const ctx = buildContext(specSheet);

  // hook_strategy 추출
  const hookStrategy = layoutSelection?.hook_strategy;
  const brandName = str(
    hookStrategy?.brand_name ??
    copywritingResult.mainIntro?.brandAndName ??
    '',
  );

  // 이미지 중복 해소: featureImages 슬롯
  const featureSlots = buildFeatureImageSlots(generatedImages);

  // Step 1: 활성화할 Pro 섹션 결정
  const activatedTypes: ProSectionType[] = layoutSelection
    ? (layoutSelection.activated_sections.filter((s) =>
        Object.values(ProSectionType).includes(s as ProSectionType),
      ) as ProSectionType[])
    : mapStandardToProSections(copywritingResult, specSheet);

  // Step 2: 배치 순서 결정 (우선순위: AI 설계 > 기본값; 사용자 편집 순서는 canvasStore에서 적용)
  const orderedTypes: ProSectionType[] = resolveSectionOrder(
    null,                                   // 초기 생성 시 savedOrder 없음
    layoutSelection?.section_order ?? null, // 2순위: DesignPrompt AI 순서
    activatedTypes,
  ) as ProSectionType[];

  // 추가 컨텍스트 (모든 섹션 빌더에 전달)
  const extra: SectionBuildExtra = {
    hookStrategy,
    brandName,
    allImages: generatedImages,
    specSheet,
  };

  // Step 3: 각 섹션 빌드 (shouldActivateSection 필터 적용)
  let sectionIdx = 0;
  const sections: CanvasSection[] = orderedTypes.flatMap((sectionType) => {
    const content = extractContent(sectionType, copywritingResult, ctx);

    // 데이터 미비 섹션 제외
    if (!shouldActivateSection(sectionType as string, content, generatedImages)) return [];

    const layoutId =
      layoutSelection?.layout_assignments[sectionType] ??
      `${sectionType}_layout_01`;

    // 이미지 중복 해소: 피처 이미지 슬롯 오버라이드
    let imageUrl = resolveImageUrl(sectionType, generatedImages);
    if (sectionType === ProSectionType.POINT_DIV && featureSlots.point_div) {
      imageUrl = featureSlots.point_div;
    } else if (sectionType === ProSectionType.SUB_DIV && featureSlots.sub_div) {
      imageUrl = featureSlots.sub_div;
    } else if (sectionType === ProSectionType.POINT_LIST_DIV && featureSlots.point_list_div) {
      imageUrl = featureSlots.point_list_div;
    }

    // SPEC_TABLE: specSheet 실제 데이터 주입
    if (sectionType === ProSectionType.SPEC_TABLE && specSheet) {
      const rows: Array<{ label: string; value: string }> = [];
      if (specSheet.name)     rows.push({ label: '상품명', value: str(specSheet.name) });
      if (specSheet.material) rows.push({ label: '소재/재질', value: str(specSheet.material) });
      if (specSheet.size)     rows.push({ label: '사이즈', value: str(specSheet.size) });
      if (specSheet.weight)   rows.push({ label: '무게', value: str(specSheet.weight) });
      if (specSheet.color)    rows.push({ label: '색상', value: str(specSheet.color) });
      if (specSheet.origin)   rows.push({ label: '원산지', value: str(specSheet.origin) });
      const extraSpec = specSheet.extra as Record<string, string> | undefined;
      if (extraSpec) {
        Object.entries(extraSpec).forEach(([key, value]) => {
          if (value) rows.push({ label: key, value });
        });
      }
      content.specRows = rows;
    }

    // 트랙 4: 리뷰 섹션 카드 파라미터 (기본 토큰 + 프리셋 오버라이드) — 섹션에 스탬프해
    // StyleTab 조절 UI가 현재값을 읽고, 저장/재로드 후에도 유지되게 한다
    const reviewCardParams: ReviewCardParams | undefined =
      sectionType === ProSectionType.PERFORMANCE_REVIEWS
        ? (() => {
            const merged = {
              gap: REVIEW_CARD_DEFAULTS.gap,
              padding: REVIEW_CARD_DEFAULTS.padding,
              bodyFontSize: REVIEW_CARD_DEFAULTS.bodyFontSize,
              ...(layoutSelection?.card_params?.[sectionType] ?? {}),
            };
            // 프리셋 cardParams가 모바일 가독 하한(34px)을 우회하지 못하게 클램프
            merged.bodyFontSize = Math.max(REVIEW_CARD_DEFAULTS.bodyFontSize, merged.bodyFontSize);
            return merged;
          })()
        : undefined;

    const elements = createSectionElements(sectionType, content, imageUrl, designPalette, {
      ...extra,
      cardParams: reviewCardParams,
    });

    // 트랙 5: 그룹별 폰트 스킴 적용 (AI font_scheme > 기본 스킴, 화이트리스트 검증)
    const groupType = SECTION_GROUP_MAP[sectionType];
    applySectionFontScheme(elements, groupType, layoutSelection?.font_scheme?.[groupType]);

    const sectionHeight = computeSectionHeight(elements);

    const section: CanvasSection = {
      id: uid('sec'),
      sectionType,
      groupType: SECTION_GROUP_MAP[sectionType],
      order: sectionIdx++,
      isVisible: true,
      layoutId,
      canvas: {
        width: 860,
        height: sectionHeight,
        backgroundColor: designPalette.bgMain,
      },
      elements,
      ...(reviewCardParams ? { reviewCardParams } : {}),
      // 신규 변환 세션 표식 — 마운트 실측·자동 reflow 허용 (첫 저장 시 해제)
      needsInitialReflow: true,
    };

    return [section];
  });

  // Step 4: 이미지 URL 최종 배정 (assignImagesToSections로 재확인)
  const withImages = assignImagesToSections(sections, generatedImages);

  // Step 5: 빈 섹션 필터링 + perf_review 제거
  const valid = filterValidSections(withImages);

  // Step 6: 배경 연출 우선 (2026-07-08) — AI 팔레트(bgMain/bgSub)를 존중한다.
  // 기존 '전체 화이트 베이스' 하드코딩을 폐기하고 bgMain 베이스 + bgSub 교차
  // 리듬으로 구획감을 만든다. 예외(심리적 정지 포인트): perf_sales(이미지),
  // CTA(primary). hero는 백엔드 page_renderer와 동일하게 bgSub→bgMain 그라디언트.
  // 빌더 텍스트는 밝은 배경을 전제하므로 다크 팔레트는 라이트 폴백으로 가드한다.
  const bgMain = lightOr(designPalette.bgMain, '#FFFFFF');
  const bgSub = lightOr(designPalette.bgSub, '#F8FAFC');
  let rhythmIdx = 0;
  // A-3(섹션 리듬, 2026-07-11): 풀블리드 배너는 이미지 가장자리 = 섹션 끝.
  // 기존 40px 가산이 배너 밑 배경 띠를 만들었다(§1-B) — 하단 여백 0으로 마감.
  const FULLBLEED_BOTTOM_MARGIN = 0;
  valid.forEach((section) => {
    // perf_sales: 완판 성과 = 다크 배경(팔레트 톤 다크) + 다크 배너 이미지로 일관.
    // 밝은 파스텔 흐름 속 극적 강조(사용자 편집 레퍼런스 반영).
    if (section.sectionType === ProSectionType.PERFORMANCE_SALES) {
      section.canvas.backgroundColor = darkenHex(designPalette.primary, 0.16, '#1a1a2e');
      const bgImg = section.elements.find((el) => el.type === 'image');
      if (bgImg) section.canvas.height = bgImg.transform.height + FULLBLEED_BOTTOM_MARGIN;
      return;
    }
    // cta: 유일한 풀 컬러 배경 (행동 정지) + 섹션 높이 = 이미지 높이 + 하단 여백
    if (section.sectionType === ProSectionType.CTA) {
      section.canvas.backgroundColor = designPalette.primary || '#1A1A2E';
      const bgImg = section.elements.find((el) => el.type === 'image');
      if (bgImg) section.canvas.height = bgImg.transform.height + FULLBLEED_BOTTOM_MARGIN;
      return;
    }
    // hero: bgSub→bgMain 세로 그라디언트 (CanvasSection이 gradient 문자열 지원)
    if (section.sectionType === ProSectionType.HOOK_3STEP) {
      section.canvas.backgroundColor = `linear-gradient(180deg, ${bgSub} 0%, ${bgMain} 100%)`;
      rhythmIdx = 1; // 그라디언트 하단이 bgMain이므로 다음 섹션은 bgSub로 대비
      return;
    }
    // 나머지: bgMain / bgSub 교차 리듬
    section.canvas.backgroundColor = rhythmIdx % 2 === 0 ? bgMain : bgSub;
    rhythmIdx++;
  });

  // Step 7: 안전장치 (CTA 마지막 보장 + perf_review 이중 제거)
  const safe = applySafetyGuards(valid);

  // Step 8: 섹션 간 거터 삽입 — 팔레트 베이스 색으로 연결부 여백 (연결부 개선)
  return insertWhiteDividers(safe, bgMain);
}

// ─────────────────────────────────────────────────────────────────────────────
// V4.12.3: 백엔드 section_plan → ProSectionType 변환
// ─────────────────────────────────────────────────────────────────────────────

/** 백엔드 section_plan의 섹션 ID → ProSectionType 변환 맵 */
const BACKEND_TO_PRO_SECTION: Record<string, ProSectionType[]> = {
  sold_out_banner:     [ProSectionType.PERFORMANCE_SALES],
  certification:       [ProSectionType.CERTIFICATION],
  event_banner:        [ProSectionType.EVENT_BANNER],
  main_intro:          [ProSectionType.HOOK_3STEP],
  main_cut:            [ProSectionType.MAIN_CUT],
  perf_rating:         [ProSectionType.PERFORMANCE_RATING],
  reviews:             [ProSectionType.PERFORMANCE_REVIEWS],
  problem:             [ProSectionType.PROBLEM_RAISE],
  problem_empathy:     [ProSectionType.PROBLEM_EMPATHY],
  direction_suggest:   [ProSectionType.DIRECTION_SUGGEST],
  solution:            [ProSectionType.SOLUTION_GUIDE],
  key_message:         [ProSectionType.KEY_MESSAGE],
  concept_desc:        [ProSectionType.CONCEPT_DESC],
  point_cards:         [ProSectionType.POINT_DIV],
  detail_points:       [ProSectionType.SUB_DIV],
  sub2_div_page:       [ProSectionType.SUB2_DIV_PAGE],
  how_to:              [ProSectionType.HIDDEN_PAGE],
  convert_div:         [ProSectionType.CONVERT_DIV],
  product_exposure:    [ProSectionType.PRODUCT_EXPOSURE],
  compare_div:         [ProSectionType.COMPARE_DIV],
  recommended_targets: [ProSectionType.POINT_LIST_DIV],
  color_options:       [ProSectionType.PETIT_DIV],
  spec_table:          [ProSectionType.SPEC_TABLE],
  cta:                 [ProSectionType.CTA],
};

export function mapBackendSectionsToProTypes(backendSections: string[]): ProSectionType[] {
  const result: ProSectionType[] = [];
  for (const id of backendSections) {
    // 직접 ProSectionType 값이면 그대로 사용
    if (Object.values(ProSectionType).includes(id as ProSectionType)) {
      if (!result.includes(id as ProSectionType)) result.push(id as ProSectionType);
      continue;
    }
    // 백엔드 이름 → ProSectionType 변환
    const mapped = BACKEND_TO_PRO_SECTION[id];
    if (mapped) {
      for (const pt of mapped) {
        if (!result.includes(pt)) result.push(pt);
      }
    }
  }
  return result;
}

