/**
 * NexOps 마진 계산 엔진
 * 쿠팡 로켓그로스 수수료 구조 기반
 * 
 * 검증 기준: 소싱_마진계산기_서식.xlsx SEQ=1 유모차스트랩
 * - 판매가: 6,300 / 원가(1688): 288 / 수수료율: 10%
 * - 기대 마진: 2,585 / 마진율: 41.04%
 */

import type { MarginInput, MarginResult, SimulationInput, SimulationResult, ReversePriceInput } from '@/types/calc'

/** 단품 마진 계산 */
export function calculateMargin(input: MarginInput): MarginResult {
  const {
    sellingPrice,
    unitCost,
    fulfillmentFee,
    commissionRate,
    couponDiscount = 0,
    returnRate = 0,
    returnPickupFee = 0,
    returnRestockFee = 0,
  } = input

  // 수수료·부가세 과세 기준 = 쿠폰 차감 후 최종 판매액.
  // 쿠팡 판매수수료는 즉시할인쿠폰 적용 후 금액에 부과되고(2026-08-19 피쿠미 RG 정산
  // profit-status 실측: takeRate 261,577 = (순매출-쿠폰)×요율×1.1), 매출 부가세 과세표준도
  // 실제 결제액(쿠폰 차감 후)이다. 쿠폰 미차감 기준으로 계산하면 둘 다 과대 계상된다.
  const netSellingPrice = Math.max(0, sellingPrice - couponDiscount)
  const commissionAmount = Math.floor(netSellingPrice * commissionRate)
  const commissionVat = Math.floor(commissionAmount * 0.1)

  // 입출고 VAT
  const fulfillmentVat = Math.floor(fulfillmentFee * 0.1)

  // 부가세 (매출세액 - 매입세액)
  // 매입세액은 unitCost만 VAT 포함(공급가액×1.1) 가정으로 /11 공제하고, fulfillmentFee·
  // commissionAmount는 위에서 이미 별도 VAT(10%)를 더하는 공급가액 기준이므로 그 값(fulfillmentVat·
  // commissionVat)을 그대로 매입세액에 합산한다 — 두 항목을 /11로 다시 나누면 이중으로 다른 가정을
  // 섞어 매입세액을 과소 계상하게 된다(audit §1-10).
  const salesTax = netSellingPrice / 11
  const purchaseTax = unitCost / 11 + fulfillmentVat + commissionVat
  const vat = Math.floor(salesTax - purchaseTax)

  // 마진 (순판매금액 − 원가 − 수수료 − 수수료VAT − 입출고배송비 − 입출고VAT − 쿠폰 − 부가세,
  // import 저장 공식과 동일 — nexops_margin_coupon_model 메모리 확정 규칙)
  const margin = Math.floor(
    sellingPrice - unitCost - fulfillmentFee - fulfillmentVat
    - commissionAmount - commissionVat - couponDiscount - vat
  )

  // 마진율
  const marginRate = sellingPrice > 0 ? margin / sellingPrice : 0

  // 최소 ROAS (마진이 0이 되는 광고비 = 마진 자체)
  const minRoas = margin > 0 ? sellingPrice / margin : Infinity

  // 비용 비율
  const total = sellingPrice || 1
  const costBreakdown = {
    unitCost: unitCost / total,
    fulfillment: (fulfillmentFee + fulfillmentVat) / total,
    commission: (commissionAmount + commissionVat) / total,
    coupon: couponDiscount / total,
    vat: vat / total,
    margin: margin / total,
  }

  return {
    commissionAmount,
    commissionVat,
    fulfillmentVat,
    vat,
    margin,
    marginRate,
    minRoas,
    costBreakdown,
  }
}

/** 총합 시뮬레이션 (반품 포함) */
export function simulateTotal(input: SimulationInput): SimulationResult {
  const {
    sellingPrice,
    unitCost,
    fulfillmentFee,
    commissionRate,
    couponDiscount = 0,
    quantity,
    returnRate = 0.08,
    returnPickupFee = 0,
    returnRestockFee = 0,
    adCost = 0,
  } = input

  const returnQty = Math.floor(quantity * returnRate)
  // 반품된 수량은 매출·수수료(쿠팡이 환불)에서 제외한다. 원가는 반품 재입고분이 재판매
  // 가능하다고 가정해 매입 수량(quantity) 전체를 그대로 유지한다 — 입출고비는 반품분도 이미
  // 배송이 발생했으므로 quantity 기준 유지(audit §1-10, 오너 확정 정책).
  const netQty = quantity - returnQty

  // 총합 계산 — 수수료 과세 기준은 calculateMargin과 동일하게 쿠폰 차감 후 판매액
  const netSellingPrice = Math.max(0, sellingPrice - couponDiscount)
  const totalRevenue = sellingPrice * netQty
  const totalCost = unitCost * quantity
  const totalFulfillment = fulfillmentFee * quantity
  const totalFulfillmentVat = Math.floor(totalFulfillment * 0.1)
  const totalCommission = Math.floor(netSellingPrice * commissionRate) * netQty
  const totalCommissionVat = Math.floor(totalCommission * 0.1)
  const totalCoupon = couponDiscount * netQty

  // 반품 비용
  const totalReturnPickup = returnQty * returnPickupFee
  const totalReturnPickupVat = Math.floor(totalReturnPickup * 0.1)
  const totalReturnRestock = returnQty * returnRestockFee
  const totalReturnRestockVat = Math.floor(totalReturnRestock * 0.1)
  const totalReturnCost = totalReturnPickup + totalReturnPickupVat
    + totalReturnRestock + totalReturnRestockVat

  // VAT — calculateMargin과 동일한 매입세액 기준(unitCost만 /11, 나머지는 이미 계산된 VAT 합산).
  // 매출세액 과세표준은 쿠폰 차감 후 실결제액이다.
  const totalVat = Math.floor(
    ((totalRevenue - totalCoupon) / 11) - (totalCost / 11 + totalFulfillmentVat + totalCommissionVat)
  )

  // 총마진
  const totalMargin = totalRevenue - totalCost
    - totalFulfillment - totalFulfillmentVat
    - totalCommission - totalCommissionVat
    - totalCoupon
    - totalReturnCost - totalVat

  const totalMarginRate = totalRevenue > 0 ? totalMargin / totalRevenue : 0
  const netProfit = totalMargin - adCost

  // 손익분기 판매량 (마진이 광고비를 커버하는 최소 수량)
  const singleMargin = calculateMargin(input).margin
  const breakEvenQty = singleMargin > 0 ? Math.ceil(adCost / singleMargin) : Infinity

  return {
    totalRevenue,
    totalCost,
    totalFulfillment: totalFulfillment + totalFulfillmentVat,
    totalCommission: totalCommission + totalCommissionVat,
    totalCoupon,
    totalReturnCost,
    totalVat,
    totalMargin,
    totalMarginRate,
    adCost,
    netProfit,
    breakEvenQty,
  }
}

/** 판매가 역산 (목표 마진율 → 최소 판매가) */
export function reversePrice(input: ReversePriceInput): number {
  const { targetMarginRate, unitCost, fulfillmentFee, commissionRate } = input

  // 반복 수렴법으로 판매가 역산
  // 초기 추정: 원가 / (1 - 목표마진율 - 수수료율)
  let price = Math.ceil(unitCost / (1 - targetMarginRate - commissionRate - 0.15))

  for (let i = 0; i < 100; i++) {
    const result = calculateMargin({
      sellingPrice: price,
      unitCost,
      fulfillmentFee,
      commissionRate,
    })

    if (Math.abs(result.marginRate - targetMarginRate) < 0.001) break

    // 마진율이 목표보다 낮으면 → 판매가 올리기
    if (result.marginRate < targetMarginRate) {
      price += Math.max(1, Math.floor((targetMarginRate - result.marginRate) * price))
    } else {
      price -= Math.max(1, Math.floor((result.marginRate - targetMarginRate) * price))
    }

    if (price < 0) price = 0
  }

  return Math.ceil(price / 100) * 100  // 100원 단위 올림
}
