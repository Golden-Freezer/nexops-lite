import { fetchAllRows } from '@/lib/supabase/fetch-all'

export interface SettlementSalesRow {
  product_id: string | null
  order_date: string
  order_quantity: number | string | null
  total_amount: number | string | null
  unit_cost: number | string | null
  fulfillment_fee: number | string | null
  fulfillment_vat: number | string | null
  commission_fee: number | string | null
  commission_vat: number | string | null
  vat: number | string | null
  margin: number | string | null
}

export interface DailySettlementContext {
  userId: string
  businessId: string | null
  orderDate: string
  importBatchId?: string | null
}

export interface AutoSettlementRow {
  aggregation_key: string
  user_id: string
  business_id: string | null
  product_id: string
  period_start: string
  period_end: string
  sales_quantity: number
  total_revenue: number
  total_cost: number
  total_fulfillment: number
  total_fulfillment_vat: number
  total_commission: number
  total_commission_vat: number
  total_return_pickup: number
  total_return_restock: number
  total_vat: number
  total_margin: number
  total_margin_rate: number
  ad_cost: number
  net_profit: number
  settlement_type: 'daily'
  source: 'auto'
  import_batch_id: string | null
  verified: boolean
}

function numberValue(value: number | string | null): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

// settlements 금액 컬럼은 원 단위 정수 — 소수(이동평균 원가 파생)를 그대로 넘기면
// "invalid input syntax for type integer" 로 upsert가 실패한다 (2026-07-19 백필에서 실증).
function roundMoney(value: number): number {
  return Math.round(value)
}

/** 자동 생성 정산 행의 전역 멱등 키. 수동 정산 행은 이 키를 사용하지 않는다. */
export function buildDailySettlementKey(
  userId: string,
  businessId: string | null,
  productId: string,
  orderDate: string
): string {
  return ['daily', userId, businessId ?? 'none', productId, orderDate].join(':')
}

/** 같은 날짜의 판매 거래를 상품별 일일 정산 행으로 집계한다. */
export function aggregateDailySettlements(
  sales: SettlementSalesRow[],
  context: DailySettlementContext
): AutoSettlementRow[] {
  const grouped = new Map<string, AutoSettlementRow>()

  for (const sale of sales) {
    if (!sale.product_id || sale.order_date !== context.orderDate) continue

    const productId = sale.product_id
    const quantity = numberValue(sale.order_quantity)
    const revenue = numberValue(sale.total_amount)
    const margin = numberValue(sale.margin)
    const existing = grouped.get(productId) ?? {
      aggregation_key: buildDailySettlementKey(
        context.userId,
        context.businessId,
        productId,
        context.orderDate
      ),
      user_id: context.userId,
      business_id: context.businessId,
      product_id: productId,
      period_start: context.orderDate,
      period_end: context.orderDate,
      sales_quantity: 0,
      total_revenue: 0,
      total_cost: 0,
      total_fulfillment: 0,
      total_fulfillment_vat: 0,
      total_commission: 0,
      total_commission_vat: 0,
      total_return_pickup: 0,
      total_return_restock: 0,
      total_vat: 0,
      total_margin: 0,
      total_margin_rate: 0,
      ad_cost: 0,
      net_profit: 0,
      settlement_type: 'daily',
      source: 'auto',
      import_batch_id: context.importBatchId ?? null,
      verified: false,
    }

    existing.sales_quantity += quantity
    existing.total_revenue += revenue
    existing.total_cost += Math.abs(quantity) * numberValue(sale.unit_cost)
    existing.total_fulfillment += numberValue(sale.fulfillment_fee)
    existing.total_fulfillment_vat += numberValue(sale.fulfillment_vat)
    existing.total_commission += numberValue(sale.commission_fee)
    existing.total_commission_vat += numberValue(sale.commission_vat)
    existing.total_vat += numberValue(sale.vat)
    existing.total_margin += margin
    existing.net_profit += margin

    grouped.set(productId, existing)
  }

  return [...grouped.values()]
    .map((row) => {
      const totalRevenue = roundMoney(row.total_revenue)
      const totalMargin = roundMoney(row.total_margin)
      return {
        ...row,
        total_revenue: totalRevenue,
        total_cost: roundMoney(row.total_cost),
        total_fulfillment: roundMoney(row.total_fulfillment),
        total_fulfillment_vat: roundMoney(row.total_fulfillment_vat),
        total_commission: roundMoney(row.total_commission),
        total_commission_vat: roundMoney(row.total_commission_vat),
        total_vat: roundMoney(row.total_vat),
        total_margin: totalMargin,
        total_margin_rate: totalRevenue !== 0 ? totalMargin / totalRevenue : 0,
        net_profit: totalMargin,
      }
    })
    .sort((a, b) => a.product_id.localeCompare(b.product_id))
}

/**
 * 지정 날짜의 자동 정산을 판매 거래 SSOT로 재생성한다.
 * 다른 사용자·사업장·날짜 및 source=manual/import 정산은 변경하지 않는다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function syncDailySettlements(supabase: any, context: DailySettlementContext) {
  const buildSalesQuery = () => {
    let query = supabase
      .from('sales_transactions')
      .select(
        'product_id, order_date, order_quantity, total_amount, unit_cost, fulfillment_fee, fulfillment_vat, commission_fee, commission_vat, vat, margin'
      )
      .eq('user_id', context.userId)
      .eq('order_date', context.orderDate)
      .not('product_id', 'is', null)
    query = context.businessId
      ? query.eq('business_id', context.businessId)
      : query.is('business_id', null)
    return query
  }

  const { data: sales, error: salesError } = await fetchAllRows(buildSalesQuery)
  if (salesError) {
    throw new Error(`판매 정산 원본 조회 실패: ${salesError.message}`)
  }

  const rows = aggregateDailySettlements(
    (sales ?? []) as SettlementSalesRow[],
    context
  )

  let existingQuery = supabase
    .from('settlements')
    .select('id, aggregation_key')
    .eq('user_id', context.userId)
    .eq('period_start', context.orderDate)
    .eq('period_end', context.orderDate)
    .eq('settlement_type', 'daily')
    .eq('source', 'auto')
  existingQuery = context.businessId
    ? existingQuery.eq('business_id', context.businessId)
    : existingQuery.is('business_id', null)

  const { data: existing, error: existingError } = await existingQuery
  if (existingError) {
    throw new Error(`기존 자동 정산 조회 실패: ${existingError.message}`)
  }

  if (rows.length > 0) {
    const writableRows = rows.map((row) => {
      const { net_profit: generatedNetProfit, ...writable } = row
      void generatedNetProfit
      return writable
    })
    const { error: upsertError } = await supabase
      .from('settlements')
      .upsert(writableRows, { onConflict: 'aggregation_key' })
    if (upsertError) {
      throw new Error(`자동 정산 저장 실패: ${upsertError.message}`)
    }
  }

  const activeKeys = new Set(rows.map((row) => row.aggregation_key))
  const staleIds = (existing ?? [])
    .filter((row: { aggregation_key: string | null }) =>
      !row.aggregation_key || !activeKeys.has(row.aggregation_key)
    )
    .map((row: { id: string }) => row.id)

  if (staleIds.length > 0) {
    let deleteQuery = supabase
      .from('settlements')
      .delete()
      .in('id', staleIds)
      .eq('user_id', context.userId)
      .eq('period_start', context.orderDate)
      .eq('period_end', context.orderDate)
      .eq('settlement_type', 'daily')
      .eq('source', 'auto')
    deleteQuery = context.businessId
      ? deleteQuery.eq('business_id', context.businessId)
      : deleteQuery.is('business_id', null)
    const { error: deleteError } = await deleteQuery
    if (deleteError) {
      throw new Error(`오래된 자동 정산 정리 실패: ${deleteError.message}`)
    }
  }

  return { upserted: rows.length, removed: staleIds.length }
}
