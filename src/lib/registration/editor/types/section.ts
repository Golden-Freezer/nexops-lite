// ─────────────────────────────────────────────
// Pro 전용 24개 섹션 타입 (명세서 2.2.1)
// ─────────────────────────────────────────────
export enum ProSectionType {
  // === 초반 구성 (Hook Zone) — 11개 ===
  HOOK_3STEP          = 'hook_3step',           // 후킹 3 STEP
  CERTIFICATION       = 'certification',         // 인증
  EVENT_BANNER        = 'event_banner',          // 이벤트: 배너 타입
  PERFORMANCE_SALES   = 'perf_sales',            // 성과: 판매량
  PERFORMANCE_RATING  = 'perf_rating',           // 성과: 평점
  PERFORMANCE_REVIEWS = 'perf_reviews',          // 성과: 리뷰수
  PRODUCT_EXPOSURE    = 'product_exposure',      // 제품 노출
  PERFORMANCE_REVIEW  = 'perf_review',           // 성과: 리뷰
  EVENT_BUNDLE        = 'event_bundle',          // 이벤트: 묶음
  EVENT_DISCOUNT      = 'event_discount',        // 이벤트: 할인
  EVENT_OPTION        = 'event_option',          // 이벤트: 옵션

  // === 본문 시작 (Problem Framing) — 5개 ===
  PROBLEM_RAISE       = 'problem_raise',         // 문제 제기
  PROBLEM_EMPATHY     = 'problem_empathy',       // 문제 공감
  DIRECTION_SUGGEST   = 'direction_suggest',     // 방향 제시
  SOLUTION_GUIDE      = 'solution_guide',        // 해결 유도
  KEY_MESSAGE         = 'key_message',           // 키 메시지 노출

  // === 핵심 USP (Value Delivery) — 6개 ===
  MAIN_CUT            = 'main_cut',              // 메인컷 DIV
  CONCEPT_DESC        = 'concept_desc',          // 컨셉 설명
  POINT_DIV           = 'point_div',             // 포인트 DIV (챕터)
  SUB_DIV             = 'sub_div',               // 서브 DIV
  SUB2_DIV_PAGE       = 'sub2_div_page',         // 서브 2 DIV_페이지 타입
  HIDDEN_PAGE         = 'hidden_page',           // 히든 페이지

  // === 파트 옵션 (Flexible Modules) — 7개 ===
  COMPARE_DIV         = 'compare_div',           // 비교_DIV
  COMPARE2_DIV        = 'compare2_div',          // 비교 2_DIV
  POINT_LIST_DIV      = 'point_list_div',        // 포인트 나열_DIV
  PETIT_DIV           = 'petit_div',             // 뽀띠_DIV
  CONVERT_DIV         = 'convert_div',           // 전환_DIV (포인트 강조)
  SPEC_TABLE          = 'spec_table',            // 제원
  CTA                 = 'cta',                   // CTA

  // === 내부 레이아웃 보조 ===
  DIVIDER             = 'divider',               // 섹션 간 흰색 구분선 (6px)
}

// ─────────────────────────────────────────────
// 섹션 그룹 타입
// ─────────────────────────────────────────────
export type SectionGroup = 'hook' | 'problem' | 'usp' | 'modules';

// ─────────────────────────────────────────────
// V4.3: 섹션별 메타데이터 정의
// ─────────────────────────────────────────────
export interface SectionMeta {
  /** 섹션 타입 */
  type: ProSectionType;

  /** 속하는 설득 구간 */
  group: SectionGroup;

  /** 기본 설득 목적 설명 */
  defaultPurpose: string;

  /** 이미지 필요 여부 */
  requiresImage: boolean;

  /** 파생본 우선순위 (1=최우선, Quick에 항상 포함 / 10=최저, Persuasive만) */
  defaultPriority: number;

  /** 이 섹션이 잘 맞는 전략 축 */
  affinityTags: string[];
}

// ─────────────────────────────────────────────
// 섹션 그룹 메타 (명세서 2.2.2)
// ─────────────────────────────────────────────
export interface ProSectionGroup {
  group: SectionGroup;
  label: string;
  required: boolean;
  minSections: number;
  maxSections: number;
  types: ProSectionType[];
}

export const PRO_SECTION_GROUPS: ProSectionGroup[] = [
  {
    group: 'hook',
    label: '초반 구성',
    required: true,
    minSections: 3,
    maxSections: 11,
    types: [
      ProSectionType.HOOK_3STEP,
      ProSectionType.CERTIFICATION,
      ProSectionType.EVENT_BANNER,
      ProSectionType.PERFORMANCE_SALES,
      ProSectionType.PERFORMANCE_RATING,
      ProSectionType.PERFORMANCE_REVIEWS,
      ProSectionType.PRODUCT_EXPOSURE,
      ProSectionType.PERFORMANCE_REVIEW,
      ProSectionType.EVENT_BUNDLE,
      ProSectionType.EVENT_DISCOUNT,
      ProSectionType.EVENT_OPTION,
    ],
  },
  {
    group: 'problem',
    label: '본문 시작',
    required: true,
    minSections: 2,
    maxSections: 5,
    types: [
      ProSectionType.PROBLEM_RAISE,
      ProSectionType.PROBLEM_EMPATHY,
      ProSectionType.DIRECTION_SUGGEST,
      ProSectionType.SOLUTION_GUIDE,
      ProSectionType.KEY_MESSAGE,
    ],
  },
  {
    group: 'usp',
    label: '핵심 USP',
    required: true,
    minSections: 2,
    maxSections: 6,
    types: [
      ProSectionType.MAIN_CUT,
      ProSectionType.CONCEPT_DESC,
      ProSectionType.POINT_DIV,
      ProSectionType.SUB_DIV,
      ProSectionType.SUB2_DIV_PAGE,
      ProSectionType.HIDDEN_PAGE,
    ],
  },
  {
    group: 'modules',
    label: '파트 옵션',
    required: false,
    minSections: 0,
    maxSections: 7,
    types: [
      ProSectionType.COMPARE_DIV,
      ProSectionType.COMPARE2_DIV,
      ProSectionType.POINT_LIST_DIV,
      ProSectionType.PETIT_DIV,
      ProSectionType.CONVERT_DIV,
      ProSectionType.SPEC_TABLE,
      ProSectionType.CTA,
    ],
  },
];

// ─────────────────────────────────────────────
// Standard 13섹션 → Pro 24섹션 확장 매핑 (명세서 2.2.3)
// ─────────────────────────────────────────────
export const STANDARD_TO_PRO_MAPPING: Record<string, ProSectionType[]> = {
  sold_out_banner:      [ProSectionType.PERFORMANCE_SALES],
  main_intro:           [ProSectionType.CERTIFICATION, ProSectionType.EVENT_BANNER, ProSectionType.HOOK_3STEP, ProSectionType.MAIN_CUT, ProSectionType.PRODUCT_EXPOSURE],
  reviews:              [ProSectionType.PERFORMANCE_REVIEW, ProSectionType.PERFORMANCE_RATING, ProSectionType.PERFORMANCE_REVIEWS],
  problem:              [ProSectionType.PROBLEM_RAISE, ProSectionType.PROBLEM_EMPATHY],
  solution:             [ProSectionType.DIRECTION_SUGGEST, ProSectionType.SOLUTION_GUIDE],
  point_cards:          [ProSectionType.KEY_MESSAGE, ProSectionType.POINT_DIV],
  detail_points:        [ProSectionType.MAIN_CUT, ProSectionType.CONCEPT_DESC, ProSectionType.SUB_DIV],
  usage_tags:           [ProSectionType.SUB2_DIV_PAGE],
  how_to:               [ProSectionType.HIDDEN_PAGE],
  color_options:        [ProSectionType.PETIT_DIV],
  recommended_targets:  [ProSectionType.POINT_LIST_DIV],
  spec_table:           [ProSectionType.SPEC_TABLE, ProSectionType.COMPARE_DIV],
  cta:                  [ProSectionType.CONVERT_DIV, ProSectionType.CTA],
} as const;
