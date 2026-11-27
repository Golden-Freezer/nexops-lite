// 정산 대조 조회 헬퍼 — coupang_settlement_reports + 같은 기간 우리 P&L(pnl-aggregator)
// + 같은 정산일 창의 실제 계좌입금(coupang_wallet_events)을 buildReconciliationRow로 조립한다.
// reconcile 라우트(전체 목록)와 analyze 라우트(단건)가 공유한다(중복 조회 금지).
// reconcile.ts는 순수 함수만 두고, DB 접근은 이 모듈에 격리한다.

import { fetchPnlRows, aggregatePnl } from '@/lib/analytics/pnl-aggregator'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { buildReconciliationRow } from '@/lib/settlement/reconcile'
import type { SettlementReportForReconcile, WalletEventForReconcile } from '@/lib/settlement/reconcile'
import type { ReconciliationRow } from '@/types/settlement-recon'
import type { PnlSummaryData } from '@/lib/analytics/types'

// 실제 계좌입금 창 — settlement_date(지급 예정일) 전후 며칠. 은행 이체 통상 지연 근사값.
const PAYOUT_WINDOW_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000

const EMPTY_PNL_SUMMARY: PnlSummaryData = {
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
  netProfit: 0,
}

const REPORT_COLUMNS =
  'settlement_group_key, settlement_cycle, final_settlement_amount, settlement_date, period_start, period_end, business_id, ' +
  'total_sales_amount, total_refunded_amount, total_take_rate_amount_with_vat, total_seller_discount, ' +
  'total_ad_sales_deduction_amount, total_fulfillment_fee_deduction_amount, total_warehousing_fee_deduction_amount, ' +
  'total_storage_fee_deduction_amount, total_subscription_fee_deduction_amount, total_business_insights_deduction_amount, ' +
  'total_final_cfs_fee_deduction_amount, total_cfs_inventory_compensation_amount'

type ReportRow = SettlementReportForReconcile & { business_id: string }

function toDateOnly(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null
}

function windowAround(dateIso: string, days: number): { start: string; end: string } {
  const t = new Date(dateIso).getTime()
  return {
    start: new Date(t - days * DAY_MS).toISOString(),
    end: new Date(t + days * DAY_MS).toISOString(),
  }
}

export interface FetchReconcileOptions {
  businessId?: string | null
  groupKey?: string | null
}

/**
 * 대조 행을 조회·조립한다. 소유 필터(user_id + business_id)를 항상 적용한다.
 * groupKey를 주면 해당 정산주기만, 아니면 최신순 전체.
 */
export async function fetchReconciliationRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  opts: FetchReconcileOptions = {}
): Promise<ReconciliationRow[]> {
  const buildReportQuery = () => {
    let query = supabase
      .from('coupang_settlement_reports')
      .select(REPORT_COLUMNS)
      .eq('user_id', userId)
    if (opts.businessId) query = query.eq('business_id', opts.businessId)
    if (opts.groupKey) query = query.eq('settlement_group_key', opts.groupKey)
    return query
      .order('period_start', { ascending: false })
      .order('settlement_group_key', { ascending: true })
  }

  const { data: reports, error: reportsError } = await fetchAllRows(buildReportQuery)
  if (reportsError) throw new Error(`정산 리포트 조회 실패: ${reportsError.message}`)

  const reportRows = (reports || []) as ReportRow[]
  const rows: ReconciliationRow[] = []

  for (const report of reportRows) {
    const periodStart = toDateOnly(report.period_start)
    const periodEnd = toDateOnly(report.period_end)

    let ourPnlSummary: PnlSummaryData = EMPTY_PNL_SUMMARY
    if (periodStart && periodEnd) {
      const pnlRows = await fetchPnlRows(supabase, userId, report.business_id, periodStart, periodEnd)
      ourPnlSummary = aggregatePnl(pnlRows, periodStart, periodEnd, 'daily').summary
    }

    let walletEvents: WalletEventForReconcile[] = []
    if (report.settlement_date) {
      const { start, end } = windowAround(report.settlement_date, PAYOUT_WINDOW_DAYS)
      const { data: wallet, error: walletError } = await fetchAllRows(() =>
        supabase
          .from('coupang_wallet_events')
          .select('wallet_event_type, amount')
          .eq('user_id', userId)
          .eq('business_id', report.business_id)
          .gte('payment_date', start)
          .lte('payment_date', end)
          .order('payment_date', { ascending: true })
          .order('id', { ascending: true })
      )
      if (walletError) throw new Error(`지갑 이력 조회 실패: ${walletError.message}`)
      walletEvents = (wallet || []) as WalletEventForReconcile[]
    }

    rows.push(buildReconciliationRow(report, ourPnlSummary, walletEvents))
  }

  return rows
}
