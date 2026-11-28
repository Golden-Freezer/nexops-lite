/**
 * 제품군 구성 사전값(적용 K5 ①-b T1-42, 분석 2차 A1 #9·11절 시작값 표, A6 2절)과 카테고리별 인포그래픽 가점(T1-88, L7 1.3절).
 * 순수 데이터다 — 템플릿 라이브러리를 읽지 않는다(D 쪽에서 import할 수 있게, 통합 11-03 13:1x).
 *
 * 구성: 제품군 줄 → 키 줄 → 기본 구성 순서로 찾는다. 표본 없는 제품군(반려·문구·포장·원예·폰 소품)은 기본 구성이다.
 * add는 고를 수 있는 섹션일 때만 필수처럼 더하고(상한에 밀리지 않음), drop은 필수 섹션이 아닐 때만 뺀다. 근거 잠금·상한·POINT 규칙을 이기지 않는다.
 * 섹션으로 옮길 수 없는 표 값은 여기 두지 않는다: '옵션 앞으로'·'표 앞 수치'(순서 풀이 자리 띠), '크기 컷'(사진 목적), 첫 화면 사진(heroKindOf).
 * 값은 판단이고(A1 '시작값') 채점 전이다.
 */

export interface CategoryFlowRow {
  readonly add?: readonly string[]
  readonly drop?: readonly string[]
}

const PROBLEMS = ['problem_raise', 'problem_empathy'] as const

/** 제품군 줄 — A1 11절 표에서 섹션으로 옮길 수 있는 줄만 */
export const FAMILY_FLOW: Readonly<Record<string, CategoryFlowRow>> = {
  // 보호대 — 사용법(네이버 13건, 오너 지적 P10)
  sports_support: { add: ['how_to'] },
  // 뷰티 도구 — 사용법, 인증 뺌(판매 4~10건, 추정)
  beauty_tool: { add: ['how_to'], drop: ['certification'] },
  // 화장품 — 사용법(인증은 자료 있을 때라 근거 잠금이 이미 맡는다)
  cosmetic: { add: ['how_to'] },
  // 의류 — 고민(22%)·인증(30%) 뺌
  apparel: { drop: [...PROBLEMS, 'certification'] },
  // 가공 식품 — 고민 뺌(쿠팡 9%, 캔바 0/12)
  processed: { drop: PROBLEMS },
  // 디지털 기기 — FAQ(네이버 69%)
  device: { add: ['faq'] },
  // 주방·수납 — 사용법(쿠팡 손 33%)
  kitchen_storage: { add: ['how_to'] },
  // 가구·장식 — 사용법, FAQ(네이버 가구)
  home_decor: { add: ['how_to', 'faq'] },
}

/** 키 줄 — A1 시작값이 모두 제품군 단위라 비어 있다. 제품군 줄이 없는 상품은 키 줄, 그것도 없으면 기본 구성이다 */
export const KEY_FLOW: Readonly<Record<string, CategoryFlowRow>> = {}

const NONE: CategoryFlowRow = {}

/** 이 상품의 구성 줄 — 제품군 줄 → 키 줄 → 기본(빈 줄) */
export function categoryFlowOf(categoryKey: string | undefined, productFamily: string | undefined): CategoryFlowRow {
  return (productFamily !== undefined ? FAMILY_FLOW[productFamily] : undefined) ?? (categoryKey ? KEY_FLOW[categoryKey] : undefined) ?? NONE
}

/** 인포그래픽 가점 — 카테고리 후보 가점(FIT_BONUS)보다 작아 카테고리·컨셉 순서를 뒤집지 않는다. 484 탐침에서 나빠지면 뺀다(통합 11-03 13:1x) */
export const INFOGRAPHIC_BONUS = 0.25

/**
 * 카테고리에서 자주 쓰는 인포그래픽 노드(L7 1.3절, 출현율 35% 이상) — 그 노드가 있는 템플릿이 같은 섹션 안에서 가점을 받는다.
 * 지금 템플릿에서 유형을 알 수 있는 노드는 치수 도식(dimension)뿐이다. 섹션 단위 유형(비교표·사용법·그래프)은 같은 섹션의 후보가 모두 같은 가점을 받아
 * 고름이 바뀌지 않으므로 두지 않는다.
 */
export const CATEGORY_INFOGRAPHIC: Readonly<Record<string, readonly string[]>> = {
  // 치수 도식 — 의류 49·쿠팡 패션 50·잡화 35
  fashion: ['dimension'],
  // 치수 도식 — 가구 47·쿠팡 주방 79
  household: ['dimension'],
}
