/**
 * 정산 손익 계산 비즈니스 로직 (순수 함수)
 * Phase 1 마진 공식과 동일한 VAT/마진/순이익 계산
 */

import type { SettlementFormData, ProfitLossRow, SkuProfitability, SettlementItem } from '@/types/settlement'
import { simulateTotal } from '@/lib/calc/margin'
import { resolveAdAmounts } from '@/lib/ads/amounts'

/**
 * 정산 입력 → 파생 필드 자동 계산
 * Phase 1 simulateTotal과 동일한 공식 적용
 */
export function calculateSettlementTotals(input: SettlementFormData) {
  const returnRate = input.returnRate ?? 0.08
  const returnQuantity = Math.floor(input.salesQuantity * returnRate)
  const netQuantity = input.salesQuantity - returnQuantity
  const totalFulfillment = input.fulfillmentFee * input.salesQuantity
  const totalFulfillmentVat = Math.floor(totalFulfillment * 0.1)
  const totalCommission = Math.floor(input.sellingPrice * input.commissionRate) * netQuantity
  const totalCommissionVat = Math.floor(totalCommission * 0.1)

  const sim = simulateTotal({
    sellingPrice: input.sellingPrice,
    unitCost: input.unitCost,
    fulfillmentFee: input.fulfillmentFee,
    commissionRate: input.commissionRate,
    quantity: input.salesQuantity,
    returnRate,
    returnPickupFee: input.returnPickupFee ?? 0,
    returnRestockFee: input.returnRestockFee ?? 0,
    adCost: input.adCost ?? 0,
  })

  return {
    total_revenue: sim.totalRevenue,
    total_cost: sim.totalCost,
    // settlements의 기본 금액 열은 공급가, *_vat 열은 VAT다. simulateTotal의
    // totalFulfillment/totalCommission은 VAT 포함 합계라 그대로 저장하면 조회 집계에서
    // VAT가 한 번 더 더해진다.
    total_fulfillment: totalFulfillment,
    total_fulfillment_vat: totalFulfillmentVat,
    total_commission: totalCommission,
    total_commission_vat: totalCommissionVat,
    total_return_pickup: returnQuantity * (input.returnPickupFee ?? 0),
    total_return_restock: returnQuantity * (input.returnRestockFee ?? 0),
    total_vat: sim.totalVat,
    total_margin: sim.totalMargin,
    total_margin_rate: sim.totalMarginRate,
    ad_cost: input.adCost ?? 0,
    net_profit: sim.netProfit,
  }
}

/** 상품별 손익 집계 */
export function calculateProfitLoss(settlements: SettlementItem[]): ProfitLossRow[] {
  const grouped = new Map<string, SettlementItem[]>()

  for (const s of settlements) {
    const existing = grouped.get(s.productId) || []
    existing.push(s)
    grouped.set(s.productId, existing)
  }

  const result: ProfitLossRow[] = []

  for (const [productId, items] of grouped) {
    const first = items[0]
    const totalRevenue = items.reduce((sum, s) => sum + s.totalRevenue, 0)
    const totalCost = items.reduce((sum, s) => sum + s.totalCost, 0)
    const totalFulfillment = items.reduce((sum, s) => sum + s.totalFulfillment + s.totalFulfillmentVat, 0)
    const totalCommission = items.reduce((sum, s) => sum + s.totalCommission + s.totalCommissionVat, 0)
    const totalReturnCost = items.reduce((sum, s) => sum + s.totalReturnPickup + s.totalReturnRestock, 0)
    const totalVat = items.reduce((sum, s) => sum + s.totalVat, 0)
    const totalMargin = items.reduce((sum, s) => sum + s.totalMargin, 0)
    const totalAdCost = items.reduce((sum, s) => sum + s.adCost, 0)
    const totalNetProfit = items.reduce((sum, s) => sum + s.netProfit, 0)

    result.push({
      productId,
      productName: first.productName,
      sku: first.sku,
      periodCount: items.length,
      totalRevenue,
      totalCost,
      totalFulfillment,
      totalCommission,
      totalReturnCost,
      totalVat,
      totalMargin,
      totalMarginRate: totalRevenue > 0 ? totalMargin / totalRevenue : 0,
      totalAdCost,
      totalNetProfit,
    })
  }

  // 순이익 내림차순 정렬
  return result.sort((a, b) => b.totalNetProfit - a.totalNetProfit)
}

/** SKU 수익성 랭킹 (순이익 기준) */
export function rankSkuProfitability(settlements: SettlementItem[]): SkuProfitability[] {
  const profitLoss = calculateProfitLoss(settlements)

  const ranked = profitLoss
    .map((row) => ({
      rank: 0,
      productId: row.productId,
      productName: row.productName,
      sku: row.sku,
      avgMarginRate: row.totalMarginRate,
      totalMargin: row.totalMargin,
      totalRevenue: row.totalRevenue,
      adSpend: row.totalAdCost,
      allocatedExpenses: 0,
      totalNetProfit: row.totalNetProfit,
      contributionRate: 0,
      isLoss: row.totalNetProfit < 0,
      grade: classifyGrade(row.totalMarginRate),
    }))
    .sort((a, b) => b.totalNetProfit - a.totalNetProfit)

  const positiveProfit = ranked.reduce((sum, item) => sum + Math.max(0, item.totalNetProfit), 0)
  ranked.forEach((item, index) => {
    item.rank = index + 1
    item.contributionRate =
      positiveProfit > 0 && item.totalNetProfit > 0 ? item.totalNetProfit / positiveProfit : 0
  })

  return ranked
}

export interface ProductProfitSalesRow {
  productId: string
  productName: string
  sku: string | null
  revenue: number
  margin: number
}

export interface ProductProfitAdRow {
  productId: string | null
  /** 캠페인명 매칭으로 식별된 상품 집합(campaign-product-match). productId가 없을 때 사용. */
  productIds?: string[] | null
  spentAmount: number
  billableAmount?: number | null
  vatAmount: number
}

/**
 * 연결 광고는 직접 귀속하고 미연결 광고·운영비는 매출 비중으로 배부한 상품별 추정 순이익.
 * productIds(캠페인명 매칭 상품군)가 있으면 그 집합 안에서 매출 비중으로 나눠 귀속한다 —
 * 전 상품 배부보다 좁은 범위라 매출 1위 상품이 남의 캠페인 비용을 뒤집어쓰는 왜곡을 막는다.
 */
export function rankProductProfitability(
  sales: ProductProfitSalesRow[],
  ads: ProductProfitAdRow[],
  sharedExpenses = 0
): SkuProfitability[] {
  const grouped = new Map<
    string,
    { productName: string; sku: string | null; revenue: number; margin: number; adSpend: number }
  >()

  for (const row of sales) {
    const current = grouped.get(row.productId) ?? {
      productName: row.productName,
      sku: row.sku,
      revenue: 0,
      margin: 0,
      adSpend: 0,
    }
    current.revenue += row.revenue
    current.margin += row.margin
    grouped.set(row.productId, current)
  }

  let sharedAdSpend = 0
  for (const row of ads) {
    const spend = resolveAdAmounts({
      spent_amount: row.spentAmount,
      billable_amount: row.billableAmount,
      vat_amount: row.vatAmount,
    }).accountingTotal
    const current = row.productId ? grouped.get(row.productId) : undefined
    if (current) {
      current.adSpend += spend
      continue
    }
    // 캠페인명 매칭 상품군 안에서 매출 비중으로 분배 (매출 전무 시 균등)
    const linked = (row.productIds ?? []).map((id) => grouped.get(id)).filter((g): g is NonNullable<typeof g> => g != null)
    if (linked.length > 0) {
      const linkedRevenue = linked.reduce((sum, g) => sum + Math.max(0, g.revenue), 0)
      for (const g of linked) {
        g.adSpend += linkedRevenue > 0 ? spend * (Math.max(0, g.revenue) / linkedRevenue) : spend / linked.length
      }
      continue
    }
    sharedAdSpend += spend
  }

  const totalRevenue = Array.from(grouped.values()).reduce((sum, row) => sum + Math.max(0, row.revenue), 0)
  const ranked = Array.from(grouped.entries())
    .map(([productId, row]) => {
      const avgMarginRate = row.revenue > 0 ? row.margin / row.revenue : 0
      const revenueShare = totalRevenue > 0 ? Math.max(0, row.revenue) / totalRevenue : 0
      const adSpend = row.adSpend + sharedAdSpend * revenueShare
      const allocatedExpenses = sharedExpenses * revenueShare
      const totalNetProfit = row.margin - adSpend - allocatedExpenses
      return {
        rank: 0,
        productId,
        productName: row.productName,
        sku: row.sku,
        avgMarginRate,
        totalMargin: row.margin,
        totalRevenue: row.revenue,
        adSpend,
        allocatedExpenses,
        totalNetProfit,
        contributionRate: 0,
        isLoss: totalNetProfit < 0,
        grade: classifyGrade(avgMarginRate),
      }
    })
    .sort((a, b) => b.totalNetProfit - a.totalNetProfit)

  const positiveProfit = ranked.reduce((sum, item) => sum + Math.max(0, item.totalNetProfit), 0)
  return ranked.map((item, index) => ({
    ...item,
    rank: index + 1,
    contributionRate:
      positiveProfit > 0 && item.totalNetProfit > 0 ? item.totalNetProfit / positiveProfit : 0,
  }))
}

/** 마진율 기준 등급 분류 */
function classifyGrade(marginRate: number): 'A' | 'B' | 'C' | 'D' {
  if (marginRate >= 0.30) return 'A'  // 30% 이상
  if (marginRate >= 0.20) return 'B'  // 20~30%
  if (marginRate >= 0.10) return 'C'  // 10~20%
  return 'D'                          // 10% 미만
}
