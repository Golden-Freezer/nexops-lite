/**
 * 정가 규칙(AX-CT-15) — 새 등록 초안의 정가(할인 전 가격)를 판매가에서 거꾸로 정한다. 순수 함수만 둔다.
 * 할인율은 45~55% 사이에서 뽑고, 정가는 100원 단위로 올린다. 올린 뒤의 표시 할인율이 45~55% 밖이면 다시 뽑는다.
 * 쓰는 곳은 drafts.ts upsertDraft 한 곳이다(스위치 REGISTRATION_LIST_PRICE_RULE 가 on 일 때만).
 * 가격 변경안 카드(AX-OP-16)는 displayDiscountRate 를 가져다 쓴다.
 */

export const LIST_PRICE_DISCOUNT_MIN = 0.45
export const LIST_PRICE_DISCOUNT_MAX = 0.55
export const LIST_PRICE_RULE_VERSION = 'ct15-v1'
export const LIST_PRICE_RULE_ENV = 'REGISTRATION_LIST_PRICE_RULE'

/** 부동소수 오차로 나누어떨어지는 값이 100원 올라가거나 경계 값이 범위 밖으로 보이지 않게 하는 보정 */
const EPSILON = 1e-9

/** 0 이상 1 미만 난수 공급 함수 — 시험에서는 고정 순서로 바꾼다. */
export type Rng = () => number

/** 초안 form 에 한 번 기록되는 정가 규칙 결과(서버만 쓴다). */
export interface ListPriceRule {
  discountRate: number
  salePriceAtDraw: number
  listPrice: number
  drawnAt: string
  version: string
}

export interface ListPriceDecision {
  discountRate: number
  listPrice: number
  displayRate: number
}

export const isListPriceRuleOn = (env: Record<string, string | undefined>): boolean =>
  env[LIST_PRICE_RULE_ENV]?.trim().toLowerCase() === 'on'

/** crypto 기반 기본 난수 — 0 이상 1 미만 */
export const defaultRng: Rng = () => {
  // Web Crypto 가 없는 런타임(오래된 Node)에서는 Math.random 으로 — 보안 난수가 필요한 값이 아니다
  const webCrypto = globalThis.crypto
  if (!webCrypto?.getRandomValues) return Math.random()
  const buf = new Uint32Array(1)
  webCrypto.getRandomValues(buf)
  return buf[0] / 4294967296
}

/** 할인율 하나 — 45~55% 안, 소수 넷째 자리 */
export function drawDiscountRate(rng: Rng): number {
  const raw = LIST_PRICE_DISCOUNT_MIN + rng() * (LIST_PRICE_DISCOUNT_MAX - LIST_PRICE_DISCOUNT_MIN)
  const rounded = Math.round(raw * 10000) / 10000
  return Math.min(LIST_PRICE_DISCOUNT_MAX, Math.max(LIST_PRICE_DISCOUNT_MIN, rounded))
}

/** 정가 = 판매가 ÷ (1 − 할인율) 을 100원 단위로 올림 */
export function listPriceFor(salePrice: number, rate: number): number {
  return Math.ceil(salePrice / (1 - rate) / 100 - EPSILON) * 100
}

/** 표시 할인율 = 1 − 판매가 ÷ 정가. 값이 없거나 정가가 0 이하이면 null. */
export function displayDiscountRate(salePrice: number | null | undefined, listPrice: number | null | undefined): number | null {
  if (typeof salePrice !== 'number' || typeof listPrice !== 'number') return null
  if (!Number.isFinite(salePrice) || !Number.isFinite(listPrice) || listPrice <= 0) return null
  return 1 - salePrice / listPrice
}

const inRange = (rate: number): boolean => rate >= LIST_PRICE_DISCOUNT_MIN - EPSILON && rate <= LIST_PRICE_DISCOUNT_MAX + EPSILON

/**
 * 판매가로 정가를 정한다. 올린 뒤 표시 할인율이 범위 밖이면 다시 뽑고, maxTries 안에 못 찾으면 null(채우지 않음).
 * 판매가가 유한수가 아니거나 0 이하여도 null.
 */
export function decideListPrice(salePrice: number | null | undefined, rng: Rng = defaultRng, maxTries = 20): ListPriceDecision | null {
  if (typeof salePrice !== 'number' || !Number.isFinite(salePrice) || salePrice <= 0) return null
  for (let i = 0; i < maxTries; i++) {
    const discountRate = drawDiscountRate(rng)
    const listPrice = listPriceFor(salePrice, discountRate)
    const displayRate = displayDiscountRate(salePrice, listPrice)
    if (displayRate !== null && inRange(displayRate)) return { discountRate, listPrice, displayRate }
  }
  return null
}
