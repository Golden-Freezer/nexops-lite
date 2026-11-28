/**
 * 원산지·제조국 말(하네스 R09b) — 원산지는 맨 아래 상품 정보 표(productInfoRows 필수 7행)에만 싣는다. K 칸 카피(섹션 제목·사진 문구)와
 * 장점 후보에는 쓰지 않는다. 오너 2026-11-08 21:0x 새 배치 켜기 승인의 '원산지를 장점 제목으로 쓰지 않는 작은 고침'이고, 11-06 '쓰기 전 꼭
 * 확인할 정보' 사실 칸 원산지 제외(#867, info-cells)와 같은 층이다. 사례: R08 P09 새 배치 잡 4a3c5af1 k8_sub_div 제목 '여행 준비 전 원산지 확인'.
 * 순수 함수다.
 */

import { copyInputWithoutCommonMaterial } from '../common-material'

/** 원산지를 가리키는 낱말(공백을 뺀 글에서 찾는다) */
const ORIGIN_WORDS = /원산지|원산국|제조국|생산국|madein/i
/** 국내 원산지 값 — 이 값이면 '국산·국내산' 같은 말을 찾는다 */
const DOMESTIC_ORIGIN = /^(대한민국|한국|국내|국산|korea|southkorea|republicofkorea)$/i
const DOMESTIC_WORDS = ['국산', '국내산', '한국산', '국내생산', '국내제조']

const squash = (text: string) => text.replace(/\s+/g, '')

/**
 * 글이 원산지·제조국을 말하는가 — 낱말(원산지·제조국·생산국·Made in)과, 상품 원산지 값으로 만든 말('중국산'·'중국 제조'·'중국 생산',
 * 국내면 '국산'·'국내산' 등)을 본다. 원산지 값만 홀로 든 글(예: 다른 뜻의 '중국')은 잡지 않는다
 */
export function mentionsOrigin(text: string, origin?: string | null): boolean {
  const body = squash(text)
  if (!body) return false
  if (ORIGIN_WORDS.test(body)) return true
  const value = squash(origin ?? '')
  if (!value) return false
  const words = DOMESTIC_ORIGIN.test(value) ? DOMESTIC_WORDS : [`${value}산`, `${value}제조`, `${value}생산`, `${value}에서제조`, `${value}에서생산`]
  return words.some((word) => body.toLowerCase().includes(word.toLowerCase()))
}

/**
 * 카피에 넘기지 않는 사실인가 — 원산지 값 그 자체(사실 목록의 '중국')이거나 원산지를 말하는 글(특징·추가 사양의 '제조국 중국' 등).
 * 사실 예산·섹션 구성(factsOf·factBudget)은 그대로 세고, 카피 콜의 '실을 수 있는 사실' 목록에서만 뺀다(R09b)
 */
export function isOriginFact(fact: string, origin?: string | null): boolean {
  const value = squash(origin ?? '')
  return (value !== '' && squash(fact) === value) || mentionsOrigin(fact, origin)
}

/**
 * K 칸 카피 콜에 넘길 사실·장점 후보 — 표에만 싣는 말을 뺀다: 원산지 값과 원산지를 말하는 글(R09b), ABS·PP·플라스틱 같은 흔한 소재(J38 오너 11-10,
 * common-material). K 칸 카피 입력이 모두 이 함수를 지난다(line-plan planTemplateLine·단계 재현) — 이름은 원산지 때 그대로 둔다
 */
export function copyInputWithoutOrigin(input: { facts: readonly string[]; usps: readonly string[] }, origin?: string | null): { facts: string[]; usps: string[] } {
  return copyInputWithoutCommonMaterial({
    facts: input.facts.filter((fact) => !isOriginFact(fact, origin)),
    usps: input.usps.filter((usp) => !mentionsOrigin(usp, origin)),
  })
}
