/**
 * K 슬롯 카피 섹션별 문구 안내표(적용 T1-15, 연구 A2 요소 7) — 섹션마다 고객의 다른 질문에 답한다. 그 콜에 나온 섹션만 프롬프트에 넣어 글자 수를 아낀다.
 * 표 값은 판매 페이지 집계에서 온 판단이고 효과는 V2 전까지 재지 못했다. main_cut·point_list_div·sub2_div_page·petit_div·product_exposure·how_to·ingredients·notice·motion_band 줄은 A2 초안 밖이라 같은 유형 값으로 채웠다.
 * 칸 상한과 사실 칸이 이 표보다 앞선다. '이런 고민' 금지와 규제 표현 규칙은 공통 규칙에 있어 줄마다 되풀이하지 않는다.
 */

export interface SectionCopyGuide {
  kind: string
  title: string
  body: string
  avoid: string
}

const row = (kind: string, title: string, body: string, avoid: string): SectionCopyGuide => ({ kind, title, body, avoid })

const WORRY = row('고민', '고객이 하는 말 같은 질문 또는 장면', '겪는 장면 1~2문장, 존댓말', '다른 상품 탓, 질병 표현')
const DETAIL = row('효익·세부', '세부 이름 + 쓰임', '사실 1문장', '앞 POINT 되풀이')
const IMPRESSION = row('효익·인상', '한 문장 선언, 대구·대조 허용', '없거나 1문장', '수식어 나열')
const PROOF = row('근거', '입력 근거만 짧게', '입력값', '지어낸 수치·인증')
const LABEL = row('안내', '이름표형 짧게', '입력값', '설득 문구')
const INVITE = row('권유', '다음 사용 장면', '짧은 권유 한 문장', '압박, 지어낸 혜택')

export const SECTION_COPY_GUIDE: Readonly<Record<string, SectionCopyGuide>> = {
  hook_3step: row('후킹', '장면·결과·약속, 명사구 또는 짧은 단정. 고민 질문은 고민이 곧 구매 이유일 때만', '보조 한 줄, 없어도 됨', '상품명·옵션명, 문장 나열'),
  main_cut: row('소개', '무엇을 파는지 바로 아는 구', '없거나 1문장', '첫 화면 되풀이'),
  problem_raise: WORRY,
  problem_empathy: WORRY,
  solution_guide: row('고민→해결 전환', '해결 방향 한 구', '순서 말은 동사로 시작', '장점 늘어놓기'),
  point_div: row('효익', '속성 + 달라지는 장면, 명사구(칸 상한 안에서 8자 이상)', '왜 그런지 사실 1개 + 체감 1문장', '소재 이름만, 같은 끝말 반복'),
  point_list_div: row('효익', '장점을 묶는 한 구', '항목마다 효익 한 구', '소재 이름만'),
  sub_div: DETAIL,
  hidden_page: DETAIL,
  key_message: IMPRESSION,
  concept_desc: IMPRESSION,
  compare: row('효익(전후)', '달라진 점', 'from·to 칸 규칙을 따른다', '깎아내리기'),
  sub2_div_page: row('효익·장면', '쓰는 장면 한 구', '없거나 1문장', '사실 나열'),
  petit_div: row('전환', '다음 섹션으로 잇는 한 구', '없거나 1문장', '앞 글 되풀이'),
  product_exposure: row('소개', '보이는 부분 이름 짧게', '없거나 1문장', '설득 문구'),
  review: PROOF,
  perf_metric: PROOF,
  certification: PROOF,
  event_offer: PROOF,
  faq: row('안내', '고객 말 그대로 질문', '답 1~2문장, 첫 말이 결론', '답 없는 권유'),
  option_gallery: LABEL,
  spec_table: LABEL,
  how_to: row('안내', '쓰는 순서나 장면의 이름표', '동사로 시작하는 짧은 안내', '입력에 없는 순서·수치'),
  ingredients: row('안내', '무엇이 들었는지 묻는 이름표형 짧게', '재료 이름은 입력값', '재료별 효능·함량·입력에 없는 재료'),
  notice: row('안내', '쓰기 전에 확인할 것을 알리는 짧은 제목', '주의·보관 글은 입력값', '입력에 없는 주의·보관 문구·안전 보장·각주'),
  // 동작은 상품 사실·사용 장면에서 고른다 — 실물 쓰는 법과 다른 동작은 GIF가 그대로 그린다(오너 11-05 지적: 빗을 반대로 쥔 빗질, 세션 B ③ P5)
  motion_band: row(
    '안내',
    '움직이는 띠가 보여 줄 동작 한 줄 — 상품 사실·사용 장면에서 실제로 쓰는 동작 하나(무엇을 하는 모습인지)',
    '동작 이름으로 끝나는 짧은 한 줄',
    '입력에 없는 동작·변형·결과, 실물을 쓰는 방식과 다른 동작(반대로 쥐기·거꾸로 쓰기·다른 면으로 쓰기)'
  ),
  direction_suggest: row('권유', '장면·대상 호명, ~할 때', '존댓말', '압박'),
  convert_div: INVITE,
  // 마지막 권유(결정 카드 c14) — D 카피 1·2단 CTA 규칙(완성 동사형·입력에 없는 약속 금지·보라고 안내하는 말 금지)을 칸 글에 맞춘다
  cta: row(
    '권유',
    '이 상품을 쓰면 달라지는 점으로 지금 고를 이유를 담은 동사형 완성 문장(쉼표·조사로 끝내지 않는다)',
    '위 사실이나 쓰는 장면에 있는 것만, 쓸 말이 없으면 뺀다',
    "압박, 입력에 없는 배송·반품·보증·기간·혜택 약속, '살펴보세요·확인하세요·만나보세요'처럼 보라고 안내하는 말"
  ),
}

/** 목적 줄 뒤에 붙일 한 줄 — 표에 없는 섹션은 빈 값이다 */
export function sectionGuideLine(section: string): string {
  const guide = SECTION_COPY_GUIDE[section]
  return guide ? `  안내(${guide.kind}): 제목은 ${guide.title} / 본문은 ${guide.body} / 피할 것: ${guide.avoid}` : ''
}

/** 공통 규칙(A2 7절 ①~⑤) — 안내표와 함께 쓴다 */
export const COPY_COMMON_RULES = [
  '제목은 안내에 따로 적지 않았으면 구로 끝내고, 본문은 존댓말로 쓴다.',
  '같은 끝말을 세 섹션 연속 쓰지 않는다. 느낌표는 페이지 전체에 2번까지 쓴다.',
  '실을 수 있는 사실에 수량·치수가 있으면 사실 칸이 있는 효익 제목에 숫자를 쓰고, 없으면 쓰지 않는다.',
  '짧은 대구, 쓰기 전후 대조, 체감 낱말 중 섹션마다 하나만 쓴다.',
  '본문 한 문장은 두 줄 안에 쓰고, 좁은 칸은 한 문장으로 쓴다.',
] as const

/** 고민 칸이 있는 콜에만 붙는다(적용 T1-45, 연구 A1 #12·L6 #9) */
export const CONCERN_PAIR_RULE =
  "고민 글 하나마다 답이 되는 POINT(point_div) 하나가 있어야 한다. 위 '고민' 목록과 사실로 답할 수 있는 고민만 쓰고, 답할 POINT가 없는 고민은 쓰지 않는다. 고민 칸에는 사실 칸을 쓰지 않는다. 고민 질문 → 전환 한 줄(solution_guide·petit_div) → POINT 효익 순서로 읽히게 쓴다."
export const CONCERN_SECTIONS: ReadonlySet<string> = new Set(['problem_raise', 'problem_empathy'])
