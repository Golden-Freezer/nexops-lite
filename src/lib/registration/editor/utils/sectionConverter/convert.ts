// sectionConverter/convert.ts — D1 분할: 원본 sectionConverter.ts 20~33행, 2043~2381행 순수 이동 (2026-07-04)


import { ProSectionType, STANDARD_TO_PRO_MAPPING } from '@/lib/registration/editor/types/section';
import {
  PRO_DEFAULT_SECTION_ORDER,
  SECTION_GROUP_MAP,
  SECTION_IMAGE_MAPPING,
} from '@/lib/registration/editor/constants/sectionConfig';
import type { CanvasSection, CanvasElement, ExpansionKind, ReviewCardParams } from '@/lib/registration/editor/types/canvas';
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
import { planFeatureDedupe, specRowsFromInput } from './dedupe';
import { productInfoRows } from '@/lib/registration/product-info-rows';
import { isOptionSpec, toColorOptions } from '@/lib/registration/options/option-spec';
import { keepBeforeCta, missingRows, placePurchaseCheck, purchaseRows, shownTextsOf, type SpecRow } from './purchaseCheck';
import { buildSceneSection, expansionTables, expansionTitle, placeExpansions, type LongSectionsInput } from './longSections';


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
  /**
   * 모바일 하한(pdp-enrichment ENRICHMENT `mobile`) — section_plan.enrichment에 mobile이 기록된 잡만 true.
   * 켜지면 하한 예외를 쓰던 빌더(hidden_page·point_list_div)가 한 열·MIN_FONT_SIZES 변형으로 그린다. 없으면 기존 그대로.
   */
  mobile_floor?: boolean;
  /**
   * 옵션 갤러리(pdp-enrichment ENRICHMENT `options`) — section_plan.enrichment에 options가 기록된 잡만 true.
   * spec_sheet.optionSpec(variants ≥ 2)이 함께 있을 때만 petit_div가 축별 카드로 바뀐다. 없으면 기존 pill 그리드 그대로.
   */
  option_gallery?: boolean;
  /**
   * 특징·사진 중복 정리(pdp-enrichment R2) — section_plan.enrichment에 persuasion이 기록된 잡만 true.
   * 켜지면 dedupe.ts가 섹션 카피·컷을 페이지 전체 기준으로 다시 배정하고, 입력 값이 없는 스펙 표는 뺀다. 없으면 기존 그대로.
   */
  feature_dedupe?: boolean;
  /**
   * R4 렌더 리듬(pdp-enrichment, NEXFIT 대비 비교) — persuasion 기록 잡 중 디자인 컷이 아닌 잡만 true.
   * 켜지면 섹션 안 간격(헤드라인→본문·글→사진)을 줄여 경계 빈 영역(200)과의 비율을 2.5배 이상으로 맞춘다. 없으면 기존 그대로.
   */
  render_rhythm?: boolean;
  /**
   * W4-S 섹션 나누기(ENRICHMENT `split`) — section_plan.enrichment에 split·persuasion이 기록된 잡 중 디자인 컷이 아닌 잡만 true.
   * 켜지면 point_div·sub_div의 특징, hidden_page의 사용 단계를 하나씩 섹션으로 펼친다(section_plan은 유형 그대로). 없으면 기존 그대로.
   */
  section_split?: boolean;
  /**
   * 긴 상세페이지 확장 섹션(ENRICHMENT `long`) — section_plan.enrichment에 long·persuasion이 기록되고 section_plan.long이 있는 잡 중
   * 디자인 컷이 아닌 잡만. 설계 단계가 근거를 판정한 확장 섹션(크기·구성·관리·보관·구매 전 질문)을 스펙 표 빌더로 더한다(longSections.ts)
   */
  long_sections?: LongSectionsInput;
  /**
   * 긴 상세페이지 사용 장면(ENRICHMENT `long`, L-2) — long·persuasion 기록 잡 중 디자인 컷이 아닌 잡만 true. 페이지에 없는 사용 장면
   * 태그와 그 생성 컷(long_scene:i)이 2쌍 이상이면 확장 섹션 '사용 장면'을 더한다(longSections.ts)
   */
  long_scenes?: boolean;
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
    case 'certification':
      // 인증 카피(인증 입력이 있을 때만 생긴다 — pdp-pro-copy-templates)가 없으면 '정품 인증'을 지어내지 않는다
      return !!str(content.text);
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
  /** 중복 정리 계획(dedupe.ts)이 컷을 정한 섹션 — 대표 컷으로 다시 덮어쓰지 않는다 */
  pinned?: ReadonlySet<string>,
): CanvasSection[] {
  return sections.map((section) => {
    // Task 1: per-element 이미지가 이미 인덱스별로 설정된 섹션은 덮어쓰기 방지
    // 긴 상세페이지 확장 섹션은 자기 컷(사용 장면 long_scene:i)을 싣는다 — 유형(sub2_div_page)의 대표 컷(usage)으로 덮지 않는다
    if (
      section.expansion ||
      pinned?.has(section.sectionType) ||
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

/** 스펙 표 기존 행(중복 정리 아닌 잡) — 상품 정보 표 정본(product-info-rows, 오너 지시 11-01) */
export function legacySpecRows(specSheet: Record<string, unknown>): Array<{ label: string; value: string }> {
  return productInfoRows(specSheet);
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

  // 옵션 갤러리 — options 기록 잡 + 등록 옵션 구조(variants ≥ 2)일 때만
  const rawOptionSpec = specSheet?.optionSpec;
  const optionSpec =
    layoutSelection?.option_gallery && isOptionSpec(rawOptionSpec) && rawOptionSpec.variants.length >= 2
      ? {
          ...rawOptionSpec,
          // 실물 사진은 공개 URL만 쓴다 — 스토리지 경로 등 URL이 아닌 값은 없는 사진으로 보고 이름 칩으로 그린다(깨진 이미지 방지)
          variants: rawOptionSpec.variants.map(({ sourceImage, ...v }) =>
            sourceImage && /^https?:\/\//.test(sourceImage) ? { ...v, sourceImage } : v,
          ),
        }
      : null;

  // 스펙 표 기본 행 — 중복 정리 잡은 입력 값만(치수·소재를 만들지 않는다), 그 밖은 기존 행
  const baseSpecRows = !specSheet ? [] : layoutSelection?.feature_dedupe ? specRowsFromInput(specSheet) : legacySpecRows(specSheet);

  // 특징·사진 중복 정리(R2) — persuasion 기록 잡만. 섹션 순서가 정해진 뒤 페이지 전체를 보고 한 번 배정한다
  const dedupe = layoutSelection?.feature_dedupe
    ? planFeatureDedupe(copywritingResult, orderedTypes, generatedImages, layoutSelection.mobile_floor === true, {
        split: layoutSelection.section_split === true,
      })
    : null;

  // 추가 컨텍스트 (모든 섹션 빌더에 전달)
  const extra: SectionBuildExtra = {
    hookStrategy,
    brandName,
    allImages: generatedImages,
    specSheet,
    ...(layoutSelection?.mobile_floor ? { mobileFloor: true } : {}),
    ...(optionSpec ? { optionSpec } : {}),
    ...(dedupe ? { dedupe: true } : {}),
    ...(layoutSelection?.render_rhythm ? { rhythm: true } : {}),
  };

  // Step 3: 각 섹션 빌드 (shouldActivateSection 필터 적용). specPatch는 구매 전 확인이 스펙 표를 다시 지을 때 넘기는 행·제목,
  // 확장 섹션(expansion)은 스펙 표 빌더로 짓는 표 — 질문은 행마다 위아래 한 열(stacked), 레이아웃은 빌더 기본(스펙 표 프리셋을 받지 않는다)
  let sectionIdx = 0;
  const buildType = (
    sectionType: ProSectionType,
    specPatch?: { specRows: SpecRow[]; title?: string; expansion?: ExpansionKind; stacked?: boolean },
  ): CanvasSection[] => {
    if (dedupe?.drop.has(sectionType)) return [];
    const content = { ...extractContent(sectionType, copywritingResult, ctx), ...(dedupe?.content[sectionType] ?? {}) };
    // 옵션 갤러리: 옵션명은 카피가 아니라 등록 옵션명 그대로(05_OPTIONS.md §4 카피 — 옵션명은 바꾸지 않는다)
    if (sectionType === ProSectionType.PETIT_DIV && optionSpec) content.options = toColorOptions(optionSpec);

    // 데이터 미비 섹션 제외
    if (!shouldActivateSection(sectionType as string, content, generatedImages)) return [];

    const layoutId = specPatch?.expansion
      ? `${sectionType}_layout_01`
      : layoutSelection?.layout_assignments[sectionType] ?? `${sectionType}_layout_01`;

    // 이미지 중복 해소: 피처 이미지 슬롯 오버라이드
    let imageUrl = resolveImageUrl(sectionType, generatedImages);
    if (sectionType === ProSectionType.POINT_DIV && featureSlots.point_div) {
      imageUrl = featureSlots.point_div;
    } else if (sectionType === ProSectionType.SUB_DIV && featureSlots.sub_div) {
      imageUrl = featureSlots.sub_div;
    } else if (sectionType === ProSectionType.POINT_LIST_DIV && featureSlots.point_list_div) {
      imageUrl = featureSlots.point_list_div;
    }
    if (dedupe && dedupe.images[sectionType] !== undefined) imageUrl = dedupe.images[sectionType] || null;

    // SPEC_TABLE: specSheet 실제 데이터 주입. 구매 전 확인이 다시 지을 때는 넘긴 행·제목(아래 placePurchaseCheck)
    if (sectionType === ProSectionType.SPEC_TABLE) {
      const rows = specPatch?.specRows ?? baseSpecRows;
      if (specPatch?.title) content.title = specPatch.title;
      if (specPatch?.stacked) content.stacked = true;
      // 중복 정리 잡: 행이 없으면 안내 문구만 남는 빈 표를 내지 않는다
      if (dedupe && rows.length === 0) return [];
      if (dedupe || specSheet || specPatch) content.specRows = rows;
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

    // W4-S 섹션 나누기 — 특징·사용 단계를 항목 하나씩 섹션으로 펼친다(항목이 하나 이하면 그대로). 그 밖의 잡·유형은 섹션 하나
    const parts = layoutSelection?.section_split ? splitSectionParts(sectionType, content) : null;
    const variants: Array<{ content: Record<string, unknown>; split?: { offset: number; first: boolean } }> =
      parts && parts.length > 1 ? parts : [{ content }];

    return variants.map(({ content: partContent, split }) => {
      const elements = createSectionElements(sectionType, partContent, imageUrl, designPalette, {
        ...extra,
        cardParams: reviewCardParams,
        ...(split ? { split } : {}),
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
        ...(specPatch?.expansion ? { expansion: specPatch.expansion } : {}),
      };

      return section;
    });
  };
  const built = orderedTypes.flatMap((sectionType) => buildType(sectionType));

  // 긴 상세페이지 확장 섹션(longSections.ts) — 골격 섹션에 이미 보이는 값을 뺀 표만 짓는다(제자리 배치는 구매 전 확인 뒤)
  // 골격에 스펙 표가 없어도 상품 정보 표가 CTA 앞에 들어온다(placePurchaseCheck) — 그 값은 이미 보이는 값으로 친다
  const specTableComing = built.some((s) => s.sectionType === ProSectionType.SPEC_TABLE) ? [] : baseSpecRows.map((r) => r.value);
  const expansions = layoutSelection?.long_sections
    ? expansionTables(layoutSelection.long_sections, specSheet, [...shownTextsOf(built), ...specTableComing]).flatMap(({ kind, rows }) =>
        buildType(ProSectionType.SPEC_TABLE, {
          specRows: rows,
          title: expansionTitle(kind),
          expansion: kind,
          ...(kind === 'faq' ? { stacked: true } : {}),
        }).map((section) => ({ kind, section })),
      )
    : [];

  // 구매 전 확인(purchaseCheck.ts) — 후킹에서 뺀 구성·사이즈·옵션 값이 실제로 그려진 글(카피·옵션 갤러리·스펙 표·확장 섹션)에
  // 없으면 스펙 표에 더하고, 스펙 표가 없으면 CTA 바로 앞에 '구매 전 확인' 표를 둔다. 확장 섹션이 이미 실은 값은 싣지 않는다(겹치면 한쪽만)
  const missing = missingRows(purchaseRows(specSheet), shownTextsOf([...built, ...expansions.map((e) => e.section)]));
  const purchase = placePurchaseCheck(built, missing, baseSpecRows, (patch) => buildType(ProSectionType.SPEC_TABLE, patch));
  // 긴 상세페이지 사용 장면(L-2) — 사진 확장 섹션. 표 확장 섹션 뒤에 자리를 찾는다(같은 사용 방법 뒤면 사진이 표보다 앞)
  // 이미 보이는 글에서 후기 카드는 뺀다 — 고객 말에 같은 낱말이 있어도 장면 사진의 되풀이가 아니고, 컷 계획(render-aware-cuts)도
  // 후기를 보지 않아 여기서만 빼면 만든 컷이 그려지지 않는다
  const scenes = layoutSelection?.long_scenes
    ? buildSceneSection(
        copywritingResult.usageSceneTags,
        generatedImages,
        layoutSelection.section_order,
        designPalette,
        shownTextsOf([...built, ...expansions.map((e) => e.section)].filter((s) => s.sectionType !== ProSectionType.PERFORMANCE_REVIEWS)),
      )
    : null;
  // 다른 섹션처럼 그룹 폰트 스킴을 입힌다(AI font_scheme > 기본 스킴)
  if (scenes) applySectionFontScheme(scenes.elements, scenes.groupType, layoutSelection?.font_scheme?.[scenes.groupType]);
  const placed = [...expansions, ...(scenes ? [{ kind: 'scenes' as const, section: scenes }] : [])];
  const sections = placed.length > 0 ? placeExpansions(purchase.sections, placed) : purchase.sections;

  // Step 4: 이미지 URL 최종 배정 (assignImagesToSections로 재확인)
  const withImages = assignImagesToSections(
    sections,
    generatedImages,
    dedupe ? new Set<string>(Object.keys(dedupe.images)) : undefined,
  );

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

  // Step 7: 안전장치 (CTA 마지막 보장 + perf_review 이중 제거). CTA를 옮겼으면 구매 전 확인 표를 다시 그 바로 앞으로
  const safe = keepBeforeCta(applySafetyGuards(valid), purchase.added?.id ?? null);

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

/** W4-S 나누기 대상 유형 → 항목 칸(빌더가 앞 3개만 그린다) */
const SPLIT_ITEM_KEYS: Partial<Record<ProSectionType, string>> = {
  [ProSectionType.POINT_DIV]: 'points',
  [ProSectionType.SUB_DIV]: 'points',
  [ProSectionType.HIDDEN_PAGE]: 'steps',
};
const SPLIT_ITEM_MAX = 3;

/**
 * 나누기 인스턴스 — 항목 하나씩 담은 내용과 순번(번호·컷 키 오프셋, 첫 인스턴스만 머리말). 나눌 유형이 아니면 null
 */
export function splitSectionParts(
  sectionType: ProSectionType,
  content: Record<string, unknown>,
): Array<{ content: Record<string, unknown>; split: { offset: number; first: boolean } }> | null {
  const key = SPLIT_ITEM_KEYS[sectionType];
  if (!key) return null;
  const items = Array.isArray(content[key]) ? (content[key] as unknown[]).slice(0, SPLIT_ITEM_MAX) : [];
  return items.map((item, k) => ({ content: { ...content, [key]: [item] }, split: { offset: k, first: k === 0 } }));
}
