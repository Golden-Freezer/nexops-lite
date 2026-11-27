import { ProSectionType } from '../../types/section';
import type { LayoutPreset } from '../../types/layout';

// 현재 JSON 프리셋이 존재하는 섹션 타입 매핑
// JSON import는 string으로 추론되므로 unknown 경유 캐스팅
type JsonLoader = () => Promise<unknown>;
const LAYOUT_FILE_MAP: Partial<Record<ProSectionType, JsonLoader>> = {
  // ── 기존 5개 ──
  [ProSectionType.HOOK_3STEP]:          () => import('./hook_3step.json'),
  [ProSectionType.PROBLEM_RAISE]:       () => import('./problem_raise.json'),
  [ProSectionType.MAIN_CUT]:            () => import('./main_cut.json'),
  [ProSectionType.COMPARE_DIV]:         () => import('./compare_div.json'),
  [ProSectionType.CTA]:                 () => import('./cta.json'),
  // ── Hook Zone 신규 ──
  [ProSectionType.PERFORMANCE_SALES]:   () => import('./perf_sales.json'),
  [ProSectionType.PERFORMANCE_RATING]:  () => import('./perf_rating.json'),
  [ProSectionType.PERFORMANCE_REVIEWS]: () => import('./perf_reviews.json'),
  [ProSectionType.PERFORMANCE_REVIEW]:  () => import('./perf_review.json'),
  [ProSectionType.CERTIFICATION]:       () => import('./certification.json'),
  [ProSectionType.EVENT_BANNER]:        () => import('./event_banner.json'),
  [ProSectionType.PRODUCT_EXPOSURE]:    () => import('./product_exposure.json'),
  [ProSectionType.EVENT_BUNDLE]:        () => import('./event_bundle.json'),
  [ProSectionType.EVENT_DISCOUNT]:      () => import('./event_discount.json'),
  [ProSectionType.EVENT_OPTION]:        () => import('./event_option.json'),
  // ── Problem Framing 신규 ──
  [ProSectionType.PROBLEM_EMPATHY]:     () => import('./problem_empathy.json'),
  [ProSectionType.DIRECTION_SUGGEST]:   () => import('./direction_suggest.json'),
  [ProSectionType.SOLUTION_GUIDE]:      () => import('./solution_guide.json'),
  [ProSectionType.KEY_MESSAGE]:         () => import('./key_message.json'),
  // ── USP Value Delivery 신규 ──
  [ProSectionType.CONCEPT_DESC]:        () => import('./concept_desc.json'),
  [ProSectionType.POINT_DIV]:           () => import('./point_div.json'),
  [ProSectionType.SUB_DIV]:             () => import('./sub_div.json'),
  [ProSectionType.SUB2_DIV_PAGE]:       () => import('./sub2_div_page.json'),
  [ProSectionType.HIDDEN_PAGE]:         () => import('./hidden_page.json'),
  // ── Flexible Modules 신규 ──
  [ProSectionType.CONVERT_DIV]:         () => import('./convert_div.json'),
  [ProSectionType.COMPARE2_DIV]:        () => import('./compare2_div.json'),
  [ProSectionType.POINT_LIST_DIV]:      () => import('./point_list_div.json'),
  [ProSectionType.PETIT_DIV]:           () => import('./petit_div.json'),
  [ProSectionType.SPEC_TABLE]:          () => import('./spec_table.json'),
};

/**
 * 섹션 타입에 해당하는 레이아웃 프리셋을 동적 import로 로드한다.
 * 아직 JSON이 없는 섹션은 빈 배열을 반환한다.
 */
export async function loadLayoutPresets(sectionType: ProSectionType): Promise<LayoutPreset[]> {
  const loader = LAYOUT_FILE_MAP[sectionType];
  if (!loader) return [];
  try {
    const mod = await loader() as { default: LayoutPreset[] };
    return mod.default;
  } catch {
    return [];
  }
}

/**
 * 여러 섹션의 프리셋을 병렬로 로드한다.
 */
export async function loadLayoutPresetsForSections(
  sectionTypes: ProSectionType[],
): Promise<Record<ProSectionType, LayoutPreset[]>> {
  const entries = await Promise.all(
    sectionTypes.map(async (type) => [type, await loadLayoutPresets(type)] as const),
  );
  return Object.fromEntries(entries) as Record<ProSectionType, LayoutPreset[]>;
}

/**
 * 현재 프리셋이 정의된 섹션 타입 목록을 반환한다.
 */
export function getAvailableSectionTypes(): ProSectionType[] {
  return Object.keys(LAYOUT_FILE_MAP) as ProSectionType[];
}
