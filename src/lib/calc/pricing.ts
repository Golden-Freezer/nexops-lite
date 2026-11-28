import { calculateMargin } from './margin'

export interface PricingSimulationInput {
  currentPrice: number
  unitCost: number
  fulfillmentFee: number
  commissionRate: number
  couponAmount?: number
}

export interface PriceSimulationPoint {
  price: number
  effectivePrice: number
  margin: number
  marginRate: number
  marginRatePercent: number
  minRoas: number | null
  minRoasPercent: number | null
}

function roundToHundred(value: number): number {
  return Math.max(100, Math.ceil(value / 100) * 100)
}

/** 판매가 시뮬레이터 원가 기준 — moving_avg=재고 이동평균, default=상품 기본 원가, none=둘 다 없음 */
export type SimulationCostBasis = 'moving_avg' | 'default' | 'none'

/**
 * 시뮬레이터 단위 원가: 재고 이동평균 원가(inventory_state.avg_cost_krw — 대시보드·재고 평가와 같은 원가)가
 * 있으면 그것, 없으면 상품 기본 원가(products.unit_cost_default). 원 단위 반올림.
 */
export function pickSimulationUnitCost(
  movingAvgCost: number | null | undefined,
  defaultUnitCost: number | null | undefined
): { unitCost: number; costBasis: SimulationCostBasis } {
  const avg = Number(movingAvgCost)
  if (Number.isFinite(avg) && avg > 0) return { unitCost: Math.round(avg), costBasis: 'moving_avg' }
  const base = Number(defaultUnitCost)
  if (Number.isFinite(base) && base > 0) return { unitCost: Math.round(base), costBasis: 'default' }
  return { unitCost: 0, costBasis: 'none' }
}

export function simulatePrice(
  input: PricingSimulationInput,
  sellingPrice: number
): PriceSimulationPoint {
  const price = Math.max(0, Math.round(sellingPrice))
  const couponAmount = Math.max(0, Math.round(input.couponAmount ?? 0))
  const result = calculateMargin({
    sellingPrice: price,
    unitCost: Math.max(0, input.unitCost),
    fulfillmentFee: Math.max(0, input.fulfillmentFee),
    commissionRate: Math.max(0, input.commissionRate),
    couponDiscount: couponAmount,
  })
  const minRoas = Number.isFinite(result.minRoas) ? result.minRoas : null

  return {
    price,
    effectivePrice: Math.max(0, price - couponAmount),
    margin: result.margin,
    marginRate: result.marginRate,
    marginRatePercent: Math.round(result.marginRate * 10_000) / 100,
    minRoas,
    minRoasPercent: minRoas === null ? null : Math.round(minRoas * 10_000) / 100,
  }
}

/** 목표 마진율을 처음 충족하는 100원 단위 최소 판매가를 찾는다. */
export function recommendSellingPrice(
  input: PricingSimulationInput,
  targetMarginRate: number
): PriceSimulationPoint {
  const target = Number(targetMarginRate)
  if (!Number.isFinite(target) || target < 0 || target >= 0.9) {
    throw new Error('목표 마진율은 0% 이상 90% 미만이어야 합니다.')
  }

  let low = 100
  let high = roundToHundred(Math.max(
    input.currentPrice * 2,
    (input.unitCost + input.fulfillmentFee + (input.couponAmount ?? 0)) * 3,
    10_000
  ))
  const maxPrice = 100_000_000

  while (simulatePrice(input, high).marginRate < target && high < maxPrice) {
    high = Math.min(maxPrice, high * 2)
  }
  if (simulatePrice(input, high).marginRate < target) {
    throw new Error('입력한 비용 구조에서는 목표 마진율을 달성할 수 없습니다.')
  }

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (simulatePrice(input, middle).marginRate >= target) high = middle
    else low = middle + 1
  }

  let recommended = roundToHundred(low)
  while (
    recommended <= maxPrice
    && simulatePrice(input, recommended).marginRate < target
  ) {
    recommended += 100
  }
  return simulatePrice(input, recommended)
}

/** 현재가와 추천가 주변을 모두 포함하는 가격-마진 곡선을 만든다. */
export function buildPriceCurve(
  input: PricingSimulationInput,
  recommendedPrice?: number
): PriceSimulationPoint[] {
  const center = Math.max(100, input.currentPrice, recommendedPrice ?? 0)
  const minPrice = roundToHundred(Math.max(100, center * 0.65))
  const maxPrice = roundToHundred(center * 1.35)
  const rawStep = Math.max(100, (maxPrice - minPrice) / 12)
  const step = roundToHundred(rawStep)
  const prices = new Set<number>([
    Math.max(100, Math.round(input.currentPrice)),
    ...(recommendedPrice ? [roundToHundred(recommendedPrice)] : []),
  ])

  for (let price = minPrice; price <= maxPrice; price += step) prices.add(price)
  prices.add(maxPrice)

  return Array.from(prices)
    .filter((price) => price > 0)
    .sort((a, b) => a - b)
    .map((price) => simulatePrice(input, price))
}
