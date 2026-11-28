/**
 * 주장 범위 블록(R2) — 카피 3단계(구조·스토리텔링·품질 관문)와 pointCards 보충 생성 공통 말미 지시.
 * §7 프롬프트 규약(인라인 금지, prompts/ 전용 파일) — 순수 문자열 조립만, LLM 호출 없음.
 *
 * R1 감점 문장:
 * - P03 두피 브러시(f2d72bd0, 효능 4건 −40): "두피가 개운해지는 3분 샤워 습관", "…두피를 자극해 개운한 세정감까지 끌어올려요",
 *   "…압력을 전달해 샴푸하면서 마사지까지 끝나요", "단순 브러쉬와는 구조부터 달라요"(근거 없는 비교)
 * - P07 반려동물 식기(8e7006a3, 성능 결과 3건): "밀림을 줄인 안정적인 구조", "흔들림 적게", "밀림 최소화" — 입력에 없는 바닥 기능
 * 출처: 기본 카피 지시(pointCards '결과/효과', detailPoints '말도 안 되는 결과', 뷰티 '변화된 모습'), Stage 2 '오감 트리거',
 * 분석 키워드(혈액순환·두피 건강), 설득 흐름의 미응답 고민 문장. 이 블록이 앞선 지시·예시보다 우선한다고 명시한다.
 * 자동 금지어 사전(eval/claim-lexicon, 세션 B)과는 별개다 — 여기는 생성 지시만 둔다.
 *
 * J50(2026-11-10 오너 23:5x "효능 문구 부활 — 의료, 인증을 받아야 하는 문구만 사용하지 않도록", 통합 decide 28·29): 체감 효능
 * (노폐물·각질 제거·피부결·개운함·시원함)은 상품 사실과 함께 쓰게 하고, 막는 것은 규제 사전(REGULATED_CLAIM_PATTERNS)이 잡는 의학·인증
 * 효능뿐이다. 분석 키워드 경고도 같은 사전으로 고른다. 입력에 없는 물건 성능 지어내기(P07)·근거 없는 비교 금지는 그대로다.
 */

import { regulatedClaimTermsIn } from '@/lib/registration/eval/claim-lexicon'

/**
 * 사람·반려동물의 몸에 직접 닿는 상품의 표지 낱말 — 신체 부위·관절 보호·마사지·세정·그루밍 도구.
 * 한 글자 부위(손·발·눈·빗)는 다른 낱말(손잡이·발판·빗자루)과 겹쳐 쓰지 않는다.
 * '뷰티'는 낱말로 보지 않는다(뷰티 파우치 포장봉투 오탐) — 분석 카테고리 beauty로 따로 본다.
 */
const BODY_CONTACT_TERMS = [
  '두피',
  '피부',
  '모발',
  '헤어',
  '머리카락',
  '머릿결',
  '얼굴',
  '페이스',
  '바디',
  '어깨',
  '허리',
  '종아리',
  '발바닥',
  '무릎',
  '슬개골',
  '관절',
  '손목',
  '발목',
  '팔꿈치',
  '보호대',
  '손톱',
  '네일',
  '눈가',
  '안대',
  '입술',
  '치아',
  '잇몸',
  '칫솔',
  '면도',
  '마사지',
  '마사저',
  '지압',
  '괄사',
  '찜질',
  '족욕',
  '깔창',
  '목베개',
  '각질',
  '때타올',
  '클렌징',
  '세안',
  '샴푸',
  '샤워',
  '목욕',
  '스킨케어',
  '털갈이',
  '슬리커',
  '그루밍',
  '빗질',
]


/**
 * 후기 사용 범위(R6, 2026-10-30 오너 지시) — 자사 리뷰(reviewsText)가 있는 모든 잡(트랙·플래너 기록과 무관)의 카피 지시. 막는 것은
 * 규제 표현(인증·인허가·의학·기능성 — eval/claim-lexicon REGULATED_CLAIM_PATTERNS)뿐이고, 사용 경험·체감 효익은 살려 쓰게 한다.
 * 리뷰 분석 섹션(REVIEWS_ANALYSIS_PROMPT)에도 같은 줄이 들어간다. 최종 카피는 같은 사전으로 검출만 한다(reviews/review-claims)
 */
export const REVIEW_CLAIM_LINE =
  '- 고객 후기: 리뷰 분석·리서치 인사이트·인용 카드에 있는 후기 속 인증·인허가 표현(KC·식약처·FDA·특허·"인증 받은"·"임상"·"테스트 완료")과 의학적 효능 표현(질병명·치료·처방·질병 예방, 기능성 화장품 효능 — 미백·주름 개선·탈모 완화·탈모 예방)은 옮기지 않는다. 사용 경험과 체감 효익은 살려 구체적으로 쓴다(예: "빗질해도 엉키지 않아요", "감고 나면 두피가 시원해요", "드라이가 빨라요", "끓는 물 소독도 가능해요") — 실제로 썼을 때 얻는 느낌과 장면이 떠오르게 쓴다.'

/**
 * 후기 사용 범위 블록 — 자사 리뷰가 있는 잡의 카피 Stage 1 그라운딩, Stage 2·3·pointCards 보충 말미, 편집기 카피 재생성에 붙인다
 * (reviews/review-claims reviewClaimBlockFor). 플래너 기록 잡은 주장 범위 블록 뒤에 온다
 */
export const REVIEW_CLAIM_BLOCK = `## [후기 사용 범위 — 인증·의학 표현은 옮기지 않고, 사용 경험은 살린다]\n${REVIEW_CLAIM_LINE}`

export interface ClaimGuardInput {
  productName?: string | null
  category?: string | null
  keywords?: readonly string[] | null
}

/**
 * 몸이 아니라 물건에 쓰는 상품의 표지(R3 — verifier 낮음: 가구 모서리 보호대·샤워커튼 고리·면도기 거치대·관절 인형 옷·
 * 핸드폰 손목스트랩이 신체 접촉으로 잡혔다). 상품명에 있으면 신체 낱말이 있어도 그 상품 자체는 몸에 닿아 쓰이지 않는다.
 */
const NOT_ON_BODY_TERMS = [
  '거치대',
  '걸이',
  '고리',
  '홀더',
  '스탠드',
  '선반',
  '수납',
  '정리함',
  '케이스',
  '디스펜서',
  '커튼',
  '장난감',
  '인형',
  '피규어',
  '테이블',
  '책상',
]
/** 물건용 표지 뒤에 이 말이 오면 본품에 딸린 구성이다(칫솔 케이스 포함·면도기 거치대 세트·필터 일체형) — 물건용으로 보지 않는다 */
const BUNDLED_SUFFIXES = ['포함', '증정', '일체형']
/** 보호대·바디 앞에 오면 몸이 아니라 물건 부위를 가리키는 말(가구 모서리 보호대, 자동차 바디 커버) — 두 글자 이상만 */
const OBJECT_PART_PREFIXES = ['가구', '모서리', '코너', '모퉁이', '기둥', '계단', '케이블', '전선', '자동차', '차량']
const OBJECT_PART_TERMS = new Set(['보호대', '바디'])
/** 기기 부속 상품의 표지 — 핸드폰 손목스트랩처럼 기기에 거는 줄은 몸이 아니라 기기용이다 */
const DEVICE_TERMS = ['핸드폰', '휴대폰', '스마트폰', '폰케이스', '카메라']

/**
 * 몸에 직접 닿아 쓰이는 상품인가 — 분석 카테고리 beauty이거나, 상품명에 신체 접촉 표지 낱말이 있고 그 상품이 물건용(거치대·커튼·
 * 장난감 등)·기기용(핸드폰 줄)이 아니며 그 낱말이 물건 부위(가구 모서리 보호대)를 가리키지 않는다. 분석 키워드(검색어 확장 —
 * '손목스트랩' 등)로는 판정하지 않는다.
 */
export function isBodyContactProduct(input: ClaimGuardInput): boolean {
  if (input.category?.trim().toLowerCase() === 'beauty') return true
  const name = input.productName ?? ''
  if (DEVICE_TERMS.some((t) => name.includes(t))) return false
  // 물건용 표지가 있으면 몸에 쓰는 상품이 아니다 — 단 본품에 딸린 구성('케이스 포함', '거치대 세트')이면 그대로 본다
  const forObject = NOT_ON_BODY_TERMS.some((t) => {
    const at = name.indexOf(t)
    if (at < 0) return false
    const after = name.slice(at + t.length)
    return !BUNDLED_SUFFIXES.some((s) => after.includes(s))
  })
  if (forObject) return false
  return BODY_CONTACT_TERMS.some((term) => {
    let at = name.indexOf(term)
    while (at >= 0) {
      const before = name.slice(0, at).trimEnd()
      if (!OBJECT_PART_TERMS.has(term) || !OBJECT_PART_PREFIXES.some((p) => before.endsWith(p))) return true
      at = name.indexOf(term, at + term.length)
    }
    return false
  })
}

/**
 * 분석 키워드 중 규제 표현(의학·인증 — claim-lexicon 규제 사전)이 든 것 — 카피 재료가 아니라고 블록에 그대로 적는다.
 * 체감 효능 낱말(노폐물·개운·시원·보습 등)은 고르지 않는다(J50 — 한 사전 기준)
 */
export function effectKeywordsIn(keywords: readonly string[] | null | undefined): string[] {
  return [...new Set((keywords ?? []).filter((k) => regulatedClaimTermsIn(k, { negation: true }).length > 0))]
}

/**
 * 주장 범위 블록 — 모든 기록 잡: 해결 칸은 기능·구성, 성능 결과 약속 금지(입력에 있는 기능만 기능 자체로), 비교는 보이는 구조
 * 차이만. 신체 접촉 상품은 결과 주장 금지를 더한다. 카피 Stage 1 그라운딩 말미와 Stage 2·3·pointCards 보충 말미에 붙인다.
 */
export function buildClaimGuardBlock(input: ClaimGuardInput): string {
  const lines = [
    '## [주장 범위 — 의학·인증 효능은 쓰지 않고, 체감 효능은 사실과 함께 쓴다]',
    '앞선 지시나 예시에 결과·변화·효과·효익 반복·간접 비교를 쓰라는 내용이 있어도(예: "결과/효과", "변화된 모습", "고객이 얻을 결과", "말도 안 되는 결과", "효익 키워드 앵커링", "간접 비교") 이 범위가 우선한다. 막는 것은 의학·인증 효능, 보장·단정("100%", "완벽히", "효과 보장"), 입력에 없는 기능과 근거 없는 비교다. 체감 효능(노폐물·각질 제거, 피부결, 개운함·시원함·편안함 등)은 상품 사실(소재·구조·사용법)과 함께 쓴다(예: "실리콘 돌기가 모공 속 노폐물까지 쓸어내요").',
    '- 고민-해결: solution.declaration·solution.summary·detailPoints[].benefit처럼 고민에 답하는 칸은 이 상품의 기능·구성(무엇이 들어 있고 어떻게 작동하고 어떻게 쓰는지)과 그때 느끼는 체감 효능으로 답한다. 의학·기능성 효능과 보장·단정은 쓰지 않는다.',
    '- 성능 결과: "밀림 최소화", "흔들림 적게", "~을 줄인", "~ 방지", "새지 않는", "소음 없는"처럼 무엇이 덜·안 일어난다는 결과를 쓰지 않는다. 그 결과를 내는 기능이 상품 정보(상품명·옵션·스펙·소싱 자료)에 있을 때만 그 기능 자체를 쓴다(예: "바닥 실리콘 패드", "좌우가 나뉜 2구"). 상품 정보에 없는 기능(바닥 설계·미끄럼 방지 처리 등)은 만들지 않는다. 단, 상품명·옵션에 들어 있는 용도 이름("도난방지 스트랩", "엉킴방지 빗" 등)은 무엇에 쓰는 상품인지 알리는 이름이라 그대로 쓴다 — 그 결과를 늘려 약속하지는 않는다("절대 잃어버리지 않아요" 등). 몸이 느끼는 체감 효능(노폐물·각질이 씻겨 나감, 개운함 등)은 이 줄 대상이 아니다.',
    '- 비교: 다른 상품·방법과 비교할 때는 상품 정보나 사진으로 보이는 구조 차이(형태·소재·구성·개수)만 구체적으로 쓴다. 무엇이 다른지 말하지 않는 비교("~와는 구조부터 달라요", "차원이 달라요")와 근거 없는 우위 비교는 쓰지 않는다.',
  ]
  // 신체 접촉 상품만 — 인증·인허가·의학·기능성 효능은 막고, 체감 효능은 상품 사실과 함께 쓰게 한다(2026-10-30·11-10 오너 지시: 체감 효익은 설득에 필요)
  if (!isBodyContactProduct(input)) return lines.join('\n')
  lines.push(
    '- 이 상품은 사람이나 반려동물의 몸(피부·두피·모발·털·관절 등)에 직접 닿는다. mainIntro(hook·benefitHeadline·subBenefit)를 포함한 모든 필드에서 인증·인허가·의학·기능성 효능은 주장하지 않는다 — 질병·통증의 치료·완화·예방, 혈행·혈액순환·면역, 기능성 화장품 효능(미백·주름 개선·탈모 완화·탈모 예방), 인증·임상·테스트 완료. 상품명에 "마사지"·"보호대" 같은 말이 있어도 의학·치료 효과로 풀어 쓰지 않는다.',
    '- 시원함·개운함·편안함 같은 사용 감각과 노폐물·각질 제거·피부결 같은 체감 효능은 상품 사실(소재·구조·사용법)과 함께 구체적으로 쓴다(예: "실리콘 돌기가 두피에 닿아 감고 나면 시원해요", "부드러운 모가 모공 속 노폐물까지 흡착해 씻어 내요"). 사실 없이 결과만 내세우는 문장("~가 좋아져요", "~효과 보장") 대신 무엇으로 만들었고 어떻게 쓰는지와 그때의 느낌·효능을 함께 쓴다.'
  )
  const effects = effectKeywordsIn(input.keywords)
  if (effects.length > 0) {
    lines.push(
      `- 분석 키워드 중 ${effects.map((k) => `"${k}"`).join(', ')}는 의학·인증 효능 표현이라 검색어일 뿐 이 상품의 효과 근거가 아니다. 카피에 효과·변화로 쓰지 않는다.`
    )
  }
  return lines.join('\n')
}

/** Stage 2·pointCards 보충 말미 머리 — 다시 쓸 때도 지킨다 */
export const CLAIM_GUARD_REWRITE_LEAD = '## 추가 규칙(위 JSON을 고칠 때도 지킨다)'
/** Stage 3 말미 머리 — 범위 위반도 검수 기준 위반으로 보고 고친 필드를 _changed_fields에 남기게 한다(무결성 복원이 되돌리지 않게) */
export const CLAIM_GUARD_QUALITY_GATE_LEAD =
  '## 검수 기준 추가(주장 범위) — 아래 범위를 어긴 문장도 검수 기준 위반이다. 사실형(기능·구성·사용 방법)으로 고치고, 고친 필드 경로를 "_changed_fields"에 적는다'
