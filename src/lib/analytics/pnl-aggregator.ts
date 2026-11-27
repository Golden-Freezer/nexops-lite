/**
 * P&L 조회+집계 코어 (서버 전용) — Phase 1
 * 정본은 기존 /api/settlement/pnl 라우트의 계산 방식 (nexops-analytics-conventions §1~§3)
 * - 1층 fetchPnlRows: Supabase 조회 (fetchAllRows로 1000행 페이징 누락 방지)
 * - 2층 aggregatePnl: DB 비의존 순수 함수 (vitest 대상, Phase 2/3 재사용)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { resolveAdAmounts } from '@/lib/ads/amounts'
import type { Granularity, PnlBucket, PnlSummaryData } from './types'
import { bucketKey, enumerateBuckets, fillMissingBuckets } from './date-buckets'

export interface SalesRow {
  order_date: string
  total_amount: number | null
  order_quantity: number | null
  commission_fee: number | null
  commission_vat: number | null
  fulfillment_fee: number | null
  fulfillment_vat: number | null
  coupon_discount: number | null
  vat: number | null
  margin: number | null
  cancel_amount: number | null
  product_id: string | null
  unit_cost: number | null
}

export interface AdRow {
  ad_date: string
  spent_amount: number | null
  billable_amount: number | null
  vat_amount: number | null
}

export interface ExpenseRow {
  expense_date: string
  amount: number | null
  payment_method: string | null
}

/** 원시 행 (조회 결과) — 집계 입력 */
export interface PnlRawRows {
  sales: SalesRow[]
  ads: AdRow[]
  expenses: ExpenseRow[]
  costMap: Map<string, number>
}

type AdminClient = SupabaseClient<Database>

/** [1층·서버 전용] Supabase 조회 — 기존 pnl 라우트의 조회부와 동일 쿼리 */
export async function fetchPnlRows(
  supabase: AdminClient,
  userId: string,
  businessId: string,
  startDate: string,
  endDate: string
): Promise<PnlRawRows> {
  // 상품별 개당 원가: products 기본값 → inventory_state 이동평균 덮어쓰기 (스킬 §2)
  const { data: products, error: productsError } = await fetchAllRows(() =>
    supabase
      .from('products')
      .select('id, unit_cost_default')
      .eq('user_id', userId)
      .eq('business_id', businessId)
      .order('id', { ascending: true })
  )
  if (productsError) throw new Error(`상품 조회 실패: ${productsError.message}`)

  // inventory_state에는 user_id가 없다 — 전 사용자 스캔 대신 자기 상품 id로 한정 (audit §1-13)
  const ownProductIds = (products as Array<{ id: string }>).map((p) => p.id)
  const { data: invStates, error: invError } = ownProductIds.length
    ? await fetchAllRows(() =>
        supabase
          .from('inventory_state')
          .select('product_id, avg_cost_krw')
          .in('product_id', ownProductIds)
          .order('product_id', { ascending: true })
      )
    : { data: [], error: null }
  if (invError) throw new Error(`재고 상태 조회 실패: ${invError.message}`)

  const costMap = new Map<string, number>()
  for (const p of products as Array<{ id: string; unit_cost_default: number | null }>) {
    const cost = p.unit_cost_default == null ? null : Number(p.unit_cost_default)
    if (cost !== null && Number.isFinite(cost)) costMap.set(p.id, cost)
  }
  for (const inv of invStates as Array<{ product_id: string; avg_cost_krw: number | null }>) {
    const cost = inv.avg_cost_krw == null ? null : Number(inv.avg_cost_krw)
    if (cost !== null && Number.isFinite(cost)) costMap.set(inv.product_id, cost)
  }

  const { data: sales, error: salesError } = await fetchAllRows(() =>
    supabase
      .from('sales_transactions')
      .select(
        'order_date, total_amount, order_quantity, commission_fee, commission_vat, fulfillment_fee, fulfillment_vat, coupon_discount, vat, margin, cancel_amount, product_id, unit_cost'
      )
      .eq('user_id', userId)
      .eq('business_id', businessId)
      .gte('order_date', startDate)
      .lte('order_date', endDate)
      .order('order_date', { ascending: true })
      .order('id', { ascending: true })
  )
  if (salesError) throw new Error(`매출 조회 실패: ${salesError.message}`)

  const { data: ads, error: adsError } = await fetchAllRows(() =>
    supabase
      .from('ad_campaigns')
      .select('ad_date, spent_amount, billable_amount, vat_amount')
      .eq('user_id', userId)
      .eq('business_id', businessId)
      .gte('ad_date', startDate)
      .lte('ad_date', endDate)
      .order('ad_date', { ascending: true })
      .order('id', { ascending: true })
  )
  if (adsError) throw new Error(`광고 조회 실패: ${adsError.message}`)

  const { data: expenses, error: expenseError } = await fetchAllRows(() =>
    supabase
      .from('expenses')
      .select('expense_date, amount, payment_method')
      .eq('user_id', userId)
      .eq('business_id', businessId)
      .gte('expense_date', startDate)
      .lte('expense_date', endDate)
      .order('expense_date', { ascending: true })
      .order('id', { ascending: true })
  )
  if (expenseError) throw new Error(`지출 조회 실패: ${expenseError.message}`)

  return {
    sales: sales as SalesRow[],
    ads: ads as AdRow[],
    expenses: expenses as ExpenseRow[],
    costMap,
  }
}

function emptyBucket(bucket: string): PnlBucket {
  return {
    bucket,
    revenue: 0,
    quantity: 0,
    cost: 0,
    commission: 0,
    commissionVat: 0,
    fulfillment: 0,
    fulfillmentVat: 0,
    coupon: 0,
    vat: 0,
    cancelAmount: 0,
    margin: 0,
    adSpend: 0,
    expenses: 0,
    coupangDeductionExpenses: 0,
    netProfit: 0,
  }
}

/** [2층·순수 함수] granularity별 버킷 집계 — 계산 규약은 스킬 §1 그대로 */
export function aggregatePnl(
  rows: PnlRawRows,
  startDate: string,
  endDate: string,
  g: Granularity
): { summary: PnlSummaryData; buckets: PnlBucket[] } {
  const summary: PnlSummaryData = {
    totalRevenue: 0,
    totalQuantity: 0,
    totalCancelAmount: 0,
    totalCoupon: 0,
    totalCommission: 0,
    totalCommissionVat: 0,
    totalFulfillment: 0,
    totalFulfillmentVat: 0,
    totalCost: 0,
    totalVat: 0,
    totalMargin: 0,
    totalAdSpend: 0,
    totalAdVat: 0,
    totalExpenses: 0,
    coupangDeductionExpenses: 0,
    netProfit: 0,
  }

  const bucketMap = new Map<string, PnlBucket>()
  const getBucket = (dateStr: string): PnlBucket => {
    const key = bucketKey(dateStr, g)
    let b = bucketMap.get(key)
    if (!b) {
      b = emptyBucket(key)
      bucketMap.set(key, b)
    }
    return b
  }

  for (const s of rows.sales) {
    const b = getBucket(s.order_date)
    const revenue = Number(s.total_amount) || 0
    const qty = Number(s.order_quantity) || 0
    const commission = Number(s.commission_fee) || 0
    const commissionVat = Number(s.commission_vat) || 0
    const fulfillment = Number(s.fulfillment_fee) || 0
    const fulfillmentVat = Number(s.fulfillment_vat) || 0
    const coupon = Number(s.coupon_discount) || 0
    const vat = Number(s.vat) || 0
    const cancelAmount = Number(s.cancel_amount) || 0
    const margin = Number(s.margin) || 0
    // 원가 = |수량| × 개당 원가 — 판매 시점에 기록된 unit_cost 우선(과거 리포트 소급 변동 방지),
    // 없을 때만 상품 현재 이동평균으로 폴백 (audit §1-13)
    const snapshotUnitCost = s.unit_cost == null ? null : Number(s.unit_cost)
    const unitCost = snapshotUnitCost !== null && Number.isFinite(snapshotUnitCost)
      ? snapshotUnitCost
      : (s.product_id ? rows.costMap.get(s.product_id) || 0 : 0)
    const cost = Math.abs(qty) * unitCost

    b.revenue += revenue
    b.quantity += qty
    b.commission += commission
    b.commissionVat += commissionVat
    b.fulfillment += fulfillment
    b.fulfillmentVat += fulfillmentVat
    b.coupon += coupon
    b.vat += vat
    b.cancelAmount += cancelAmount
    b.margin += margin
    b.cost += cost

    summary.totalRevenue += revenue
    summary.totalQuantity += qty
    summary.totalCancelAmount += cancelAmount
    summary.totalCoupon += coupon
    summary.totalCommission += commission
    summary.totalCommissionVat += commissionVat
    summary.totalFulfillment += fulfillment
    summary.totalFulfillmentVat += fulfillmentVat
    summary.totalCost += cost
    summary.totalVat += vat
    summary.totalMargin += margin
  }

  for (const a of rows.ads) {
    // 광고비는 조정 후 청구 가능액을 우선하고 VAT를 더한다. 청구 가능액이
    // null인 과거 수기 행만 소진액으로 폴백한다.
    const amounts = resolveAdAmounts(a)
    const adSpend = amounts.accountingTotal
    getBucket(a.ad_date).adSpend += adSpend
    summary.totalAdSpend += adSpend
    summary.totalAdVat += amounts.vat
  }

  for (const e of rows.expenses) {
    const amount = Number(e.amount) || 0
    if (e.payment_method === 'coupang_deduction') {
      getBucket(e.expense_date).coupangDeductionExpenses =
        (getBucket(e.expense_date).coupangDeductionExpenses || 0) + amount
      summary.coupangDeductionExpenses = (summary.coupangDeductionExpenses || 0) + amount
    } else {
      getBucket(e.expense_date).expenses += amount
      summary.totalExpenses += amount
    }
  }

  summary.netProfit = summary.totalMargin - summary.totalAdSpend - summary.totalExpenses

  for (const b of bucketMap.values()) {
    b.netProfit = b.margin - b.adSpend - b.expenses
  }

  const keys = enumerateBuckets(startDate, endDate, g)
  const buckets = fillMissingBuckets(Array.from(bucketMap.values()), keys, emptyBucket)

  return { summary, buckets }
}
