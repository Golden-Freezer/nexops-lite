import { ProSectionType, type SectionGroup, type SectionMeta } from '@/lib/registration/editor/types/section';

// ─────────────────────────────────────────────
// Pro 24개 섹션 기본 배치 순서 (fallback 전용)
//
// 우선순위:
//   1순위 — 사용자가 에디터에서 직접 변경한 순서 (canvasStore)
//   2순위 — DesignPrompt section_plan.section_order (AI 설계)
//   3순위 — 이 상수 (section_plan 없을 때 fallback)
// ─────────────────────────────────────────────
export const PRO_DEFAULT_SECTION_ORDER: ProSectionType[] = [
  // ── Hero 오프닝 (01~05) ──
  // hook_3step → main_cut 히어로로 시작 (perf_sales는 상단 아님 — 사회적 증거 블록으로 이동)
  ProSectionType.HOOK_3STEP,           // 01 후킹 문구 (히어로)
  ProSectionType.MAIN_CUT,             // 02 Hero + 아이콘 USP
  ProSectionType.CERTIFICATION,        // 03 정품 인증
  ProSectionType.EVENT_BANNER,         // 04 이벤트/할인 배너

  // ── Problem → Solution (05~09) ──
  ProSectionType.PROBLEM_RAISE,        // 05 문제 제기
  ProSectionType.PROBLEM_EMPATHY,      // 06 문제 공감
  ProSectionType.DIRECTION_SUGGEST,    // 07 해결 방향
  ProSectionType.SOLUTION_GUIDE,       // 08 해결책
  ProSectionType.PRODUCT_EXPOSURE,     // 09 제품 추가 앵글

  // ── 사회적 증거 블록 (10~12): 완판 → 평점 → 리뷰 인접 배치 ──
  ProSectionType.PERFORMANCE_SALES,    // 10 완판 배너 (다크 성과)
  ProSectionType.PERFORMANCE_RATING,   // 11 평점
  ProSectionType.PERFORMANCE_REVIEWS,  // 12 리뷰 카드

  // ── USP 전달 (13~18) ──
  ProSectionType.KEY_MESSAGE,          // 13 핵심 메시지
  ProSectionType.CONCEPT_DESC,         // 14 컨셉/브랜드
  ProSectionType.POINT_DIV,            // 15 핵심 포인트
  ProSectionType.SUB_DIV,              // 16 서브 포인트
  ProSectionType.SUB2_DIV_PAGE,        // 17 해시태그/사용 장면
  ProSectionType.HIDDEN_PAGE,          // 18 사용법 STEP

  // ── 마무리 (19~24) ──
  ProSectionType.CONVERT_DIV,          // 19 중간 전환 CTA
  ProSectionType.COMPARE_DIV,          // 20 사이즈 비교
  ProSectionType.POINT_LIST_DIV,       // 21 추천 대상
  ProSectionType.PETIT_DIV,            // 22 소재 & 컬러
  ProSectionType.SPEC_TABLE,           // 23 스펙 테이블
  ProSectionType.CTA,                  // 24 CTA
];

// ─────────────────────────────────────────────
// 섹션 → 그룹 매핑
// ─────────────────────────────────────────────
export const SECTION_GROUP_MAP: Record<ProSectionType, SectionGroup> = {
  // hook
  [ProSectionType.HOOK_3STEP]:          'hook',
  [ProSectionType.CERTIFICATION]:       'hook',
  [ProSectionType.EVENT_BANNER]:        'hook',
  [ProSectionType.PERFORMANCE_SALES]:   'hook',
  [ProSectionType.PERFORMANCE_RATING]:  'hook',
  [ProSectionType.PERFORMANCE_REVIEWS]: 'hook',
  [ProSectionType.PRODUCT_EXPOSURE]:    'hook',
  [ProSectionType.PERFORMANCE_REVIEW]:  'hook',
  [ProSectionType.EVENT_BUNDLE]:        'hook',
  [ProSectionType.EVENT_DISCOUNT]:      'hook',
  [ProSectionType.EVENT_OPTION]:        'hook',

  // problem
  [ProSectionType.PROBLEM_RAISE]:       'problem',
  [ProSectionType.PROBLEM_EMPATHY]:     'problem',
  [ProSectionType.DIRECTION_SUGGEST]:   'problem',
  [ProSectionType.SOLUTION_GUIDE]:      'problem',
  [ProSectionType.KEY_MESSAGE]:         'problem',

  // usp
  [ProSectionType.MAIN_CUT]:            'usp',
  [ProSectionType.CONCEPT_DESC]:        'usp',
  [ProSectionType.POINT_DIV]:           'usp',
  [ProSectionType.SUB_DIV]:             'usp',
  [ProSectionType.SUB2_DIV_PAGE]:       'usp',
  [ProSectionType.HIDDEN_PAGE]:         'usp',

  // modules
  [ProSectionType.COMPARE_DIV]:         'modules',
  [ProSectionType.COMPARE2_DIV]:        'modules',
  [ProSectionType.POINT_LIST_DIV]:      'modules',
  [ProSectionType.PETIT_DIV]:           'modules',
  [ProSectionType.CONVERT_DIV]:         'modules',
  [ProSectionType.SPEC_TABLE]:          'modules',
  [ProSectionType.CTA]:                 'modules',
  [ProSectionType.DIVIDER]:             'hook',   // 내부 보조 — 그룹 무관
};

// ─────────────────────────────────────────────
// Pro 24섹션 → 이미지 키 매핑
//
// imageKey: generatedImages Record의 키 이름
//           빈 문자열('')은 코드 기반 렌더링 (이미지 없음)
// ─────────────────────────────────────────────
export interface SectionImageSource {
  imageKey: string;
  isReused?: boolean;
}

export const SECTION_IMAGE_MAPPING: Record<string, SectionImageSource> = {
  'perf_sales':         { imageKey: 'sold_out_banner' },
  'certification':      { imageKey: '' },
  'event_banner':       { imageKey: 'event_banner' },
  'hook_3step':         { imageKey: 'hero' },
  'main_cut':           { imageKey: 'premium_hero' },                    // ★ premium_hero → main_cut (Pro)
  'perf_rating':        { imageKey: '' },
  'perf_reviews':       { imageKey: '' },
  'problem_raise':      { imageKey: 'problem' },
  'problem_empathy':    { imageKey: 'empathy_scene' },
  'direction_suggest':  { imageKey: 'direction_hint' },
  'solution_guide':     { imageKey: 'solution' },
  'key_message':        { imageKey: 'key_benefit_visual' },
  'concept_desc':       { imageKey: 'concept_mood' },
  'point_div':          { imageKey: 'feature_00' },
  'sub_div':            { imageKey: 'feature_03' },                    // features[3~5] → sub_div (features[0~2]는 point_div)
  'sub2_div_page':      { imageKey: 'usage' },
  'hidden_page':        { imageKey: 'howto_00' },
  'convert_div':        { imageKey: 'conversion_cta' },
  'product_exposure':   { imageKey: 'product_exposure' },               // 전용 Pro 이미지 (feature_01은 상위키 부재 → shouldActivateSection 탈락 유발)
  'compare_div':        { imageKey: 'size_comparison' },
  'point_list_div':     { imageKey: 'feature_02' },
  'petit_div':          { imageKey: 'options' },                       // 옵션 그리드 이미지 복원 (기존 ''은 이미지 없는 빈 섹션 — 사용자 피드백으로 재연결)
  'spec_table':         { imageKey: '' },
  'cta':                { imageKey: 'cta' },
};

// ─────────────────────────────────────────────
// V4.3: 28개 섹션 메타데이터 맵
//
// defaultPriority 1 = Quick 파생본에 항상 포함 (hook_3step, main_cut, cta)
// defaultPriority 10 = Persuasive 전용
// ─────────────────────────────────────────────
export const SECTION_META_MAP: Partial<Record<ProSectionType, SectionMeta>> = {
  // ── HOOK 구간 ──
  [ProSectionType.HOOK_3STEP]: {
    type: ProSectionType.HOOK_3STEP,
    group: 'hook',
    defaultPurpose: '초반 3초 후킹 — 스크롤 멈춤 유도',
    requiresImage: true,
    defaultPriority: 1,
    affinityTags: ['all'],
  },
  [ProSectionType.PERFORMANCE_SALES]: {
    type: ProSectionType.PERFORMANCE_SALES,
    group: 'hook',
    defaultPurpose: '사회적 검증 — 판매 실적으로 신뢰 선행',
    requiresImage: false,
    defaultPriority: 2,
    affinityTags: ['function', 'balanced'],
  },
  [ProSectionType.PERFORMANCE_RATING]: {
    type: ProSectionType.PERFORMANCE_RATING,
    group: 'hook',
    defaultPurpose: '평점 기반 신뢰 선행',
    requiresImage: false,
    defaultPriority: 3,
    affinityTags: ['function', 'balanced'],
  },
  [ProSectionType.PERFORMANCE_REVIEWS]: {
    type: ProSectionType.PERFORMANCE_REVIEWS,
    group: 'hook',
    defaultPurpose: '복수 리뷰 기반 사회적 증거',
    requiresImage: false,
    defaultPriority: 4,
    affinityTags: ['all'],
  },
  [ProSectionType.PERFORMANCE_REVIEW]: {
    type: ProSectionType.PERFORMANCE_REVIEW,
    group: 'hook',
    defaultPurpose: '단일 핵심 리뷰 강조',
    requiresImage: false,
    defaultPriority: 5,
    affinityTags: ['emotion', 'balanced'],
  },
  [ProSectionType.PRODUCT_EXPOSURE]: {
    type: ProSectionType.PRODUCT_EXPOSURE,
    group: 'hook',
    defaultPurpose: '제품 노출 — 기대감 형성',
    requiresImage: true,
    defaultPriority: 3,
    affinityTags: ['emotion', 'balanced'],
  },
  [ProSectionType.CERTIFICATION]: {
    type: ProSectionType.CERTIFICATION,
    group: 'hook',
    defaultPurpose: '인증/수상 기반 권위 확보',
    requiresImage: true,
    defaultPriority: 6,
    affinityTags: ['function', 'balanced'],
  },
  [ProSectionType.EVENT_BANNER]: {
    type: ProSectionType.EVENT_BANNER,
    group: 'hook',
    defaultPurpose: '이벤트 배너 — 긴급성/혜택 강조',
    requiresImage: true,
    defaultPriority: 7,
    affinityTags: ['all'],
  },
  [ProSectionType.EVENT_DISCOUNT]: {
    type: ProSectionType.EVENT_DISCOUNT,
    group: 'hook',
    defaultPurpose: '할인 이벤트 — 가격 저항 완화',
    requiresImage: false,
    defaultPriority: 8,
    affinityTags: ['function'],
  },
  [ProSectionType.EVENT_BUNDLE]: {
    type: ProSectionType.EVENT_BUNDLE,
    group: 'hook',
    defaultPurpose: '번들 이벤트 — 구성 가치 강조',
    requiresImage: true,
    defaultPriority: 8,
    affinityTags: ['function', 'balanced'],
  },
  [ProSectionType.EVENT_OPTION]: {
    type: ProSectionType.EVENT_OPTION,
    group: 'hook',
    defaultPurpose: '옵션 이벤트 — 선택지 제공',
    requiresImage: false,
    defaultPriority: 9,
    affinityTags: ['function'],
  },

  // ── PROBLEM 구간 ──
  [ProSectionType.PROBLEM_RAISE]: {
    type: ProSectionType.PROBLEM_RAISE,
    group: 'problem',
    defaultPurpose: '문제 제기 — 공감 진입점',
    requiresImage: true,
    defaultPriority: 2,
    affinityTags: ['function', 'balanced'],
  },
  [ProSectionType.PROBLEM_EMPATHY]: {
    type: ProSectionType.PROBLEM_EMPATHY,
    group: 'problem',
    defaultPurpose: '문제 공감 — 감정적 연결 강화',
    requiresImage: true,
    defaultPriority: 3,
    affinityTags: ['emotion', 'balanced'],
  },
  [ProSectionType.DIRECTION_SUGGEST]: {
    type: ProSectionType.DIRECTION_SUGGEST,
    group: 'problem',
    defaultPurpose: '사용 방향 제안 — 해결 방향 전환',
    requiresImage: false,
    defaultPriority: 4,
    affinityTags: ['all'],
  },
  [ProSectionType.SOLUTION_GUIDE]: {
    type: ProSectionType.SOLUTION_GUIDE,
    group: 'problem',
    defaultPurpose: '솔루션 가이드 — 해결 선언',
    requiresImage: true,
    defaultPriority: 3,
    affinityTags: ['function', 'balanced'],
  },
  [ProSectionType.KEY_MESSAGE]: {
    type: ProSectionType.KEY_MESSAGE,
    group: 'problem',
    defaultPurpose: '핵심 메시지 — 브랜드 선언문',
    requiresImage: false,
    defaultPriority: 4,
    affinityTags: ['emotion', 'balanced'],
  },

  // ── USP 구간 ──
  [ProSectionType.MAIN_CUT]: {
    type: ProSectionType.MAIN_CUT,
    group: 'usp',
    defaultPurpose: '핵심 효익 선언 — 메인 비주얼',
    requiresImage: true,
    defaultPriority: 1,
    affinityTags: ['all'],
  },
  [ProSectionType.CONCEPT_DESC]: {
    type: ProSectionType.CONCEPT_DESC,
    group: 'usp',
    defaultPurpose: '제품 컨셉 설명 — 효익의 논리적 근거',
    requiresImage: true,
    defaultPriority: 3,
    affinityTags: ['function', 'balanced'],
  },
  [ProSectionType.POINT_DIV]: {
    type: ProSectionType.POINT_DIV,
    group: 'usp',
    defaultPurpose: '핵심 차이 포인트 — 다각도 증명',
    requiresImage: true,
    defaultPriority: 2,
    affinityTags: ['all'],
  },
  [ProSectionType.SUB_DIV]: {
    type: ProSectionType.SUB_DIV,
    group: 'usp',
    defaultPurpose: '세부 구조/재질/설계 근거',
    requiresImage: true,
    defaultPriority: 5,
    affinityTags: ['function'],
  },
  [ProSectionType.SUB2_DIV_PAGE]: {
    type: ProSectionType.SUB2_DIV_PAGE,
    group: 'usp',
    defaultPurpose: '실제 사용 장면 증명',
    requiresImage: true,
    defaultPriority: 6,
    affinityTags: ['emotion', 'balanced'],
  },
  [ProSectionType.HIDDEN_PAGE]: {
    type: ProSectionType.HIDDEN_PAGE,
    group: 'usp',
    defaultPurpose: '깊은 비교 또는 기술 세부 근거',
    requiresImage: false,
    defaultPriority: 9,
    affinityTags: ['function'],
  },

  // ── MODULE 구간 ──
  [ProSectionType.CONVERT_DIV]: {
    type: ProSectionType.CONVERT_DIV,
    group: 'modules',
    defaultPurpose: '중간 전환 CTA — 구매 욕구 전환점 제공',
    requiresImage: true,
    defaultPriority: 3,
    affinityTags: ['all'],
  },
  [ProSectionType.COMPARE_DIV]: {
    type: ProSectionType.COMPARE_DIV,
    group: 'modules',
    defaultPurpose: '비교 섹션 — 판단 근거 제공',
    requiresImage: true,
    defaultPriority: 5,
    affinityTags: ['function'],
  },
  [ProSectionType.COMPARE2_DIV]: {
    type: ProSectionType.COMPARE2_DIV,
    group: 'modules',
    defaultPurpose: '비교 섹션 v2 — 심화 비교',
    requiresImage: true,
    defaultPriority: 7,
    affinityTags: ['function'],
  },
  [ProSectionType.POINT_LIST_DIV]: {
    type: ProSectionType.POINT_LIST_DIV,
    group: 'modules',
    defaultPurpose: '포인트 목록 — 최종 정리와 자기정당화',
    requiresImage: false,
    defaultPriority: 6,
    affinityTags: ['all'],
  },
  [ProSectionType.PETIT_DIV]: {
    type: ProSectionType.PETIT_DIV,
    group: 'modules',
    defaultPurpose: '소형 구분선 — 리듬 조절',
    requiresImage: false,
    defaultPriority: 8,
    affinityTags: ['emotion'],
  },
  [ProSectionType.SPEC_TABLE]: {
    type: ProSectionType.SPEC_TABLE,
    group: 'modules',
    defaultPurpose: '스펙 테이블 — 정보 정리',
    requiresImage: false,
    defaultPriority: 4,
    affinityTags: ['function', 'balanced'],
  },
  [ProSectionType.CTA]: {
    type: ProSectionType.CTA,
    group: 'modules',
    defaultPurpose: 'CTA — 최종 행동 유도 (항상 마지막)',
    requiresImage: false,
    defaultPriority: 1,
    affinityTags: ['all'],
  },
};
