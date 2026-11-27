/**
 * 정산 대조 순수 로직 — 쿠팡 확정 정산(coupang_settlement_reports 행)과 우리 P&L 집계를
 * 항목별로 맞대어 라인·총차액을 계산한다. DB·네트워크 비의존 순수 함수(vitest 대상).
 *
 * 매핑 근거: docs/reports/wing-settlement-recon-20260713.md(윙 API 실캡처),
 * docs/plans/settlement-recon/DESIGN.md, CLAUDE.md 마진 계산 공식.
 *
 * 실데이터 검증(2026-07-13, 실제 셀러 계정 2건 수집):
 *  - 반품 부호: 쿠팡 totalRefundedAmount는 음수(-2,711,700) 확인 → 절대값 정규화 반영 완료.
 *  - 입출고비 grain: 우리 '입출고배송비'는 쿠팡 fulfillment에 대응, warehousing/보관료는
 *    우리가 별도로 안 잡는 비용이라 blind-spot(ours=null)로 둔다(설계 유지).
 */

import type { ReconciliationRow, ReconciliationLine } from '@/types/settlement-recon'
import type { PnlSummaryData } from '@/lib/analytics/types'
import { estimatePayout } from '@/lib/analytics/payout'

/** coupang_settlement_reports 조회 결과 중 대조에 필요한 부분집합. */
export interface SettlementReportForReconcile {
  settlement_group_key: string
  settlement_cycle: string | null
  final_settlement_amount: number | null
  settlement_date: string | null
  period_start: string | null
  period_end: string | null
  total_sales_amount: number | null
  total_refunded_amount: number | null
  total_take_rate_amount_with_vat: number | null
  total_seller_discount: number | null
  total_ad_sales_deduction_amount: number | null
  total_fulfillment_fee_deduction_amount: number | null
  total_warehousing_fee_deduction_amount: number | null
  total_storage_fee_deduction_amount: number | null
  total_subscription_fee_deduction_amount: number | null
  total_business_insights_deduction_amount: number | null
  total_final_cfs_fee_deduction_amount: number | null
  total_cfs_inventory_compensation_amount: number | null
}

/** coupang_wallet_events 조회 결과 중 대조에 필요한 부분집합. */
export interface WalletEventForReconcile {
  wallet_event_type: string | null
  amount: number | null
}

function n(v: number | null | undefined): number {
  return v ?? 0
}

/** 실제 계좌입금 합 — AUTO_WITHDRAWAL 이벤트만 합산한다. 창에 이벤트가 없으면 null(미확인). */
export function sumActualDeposit(events: WalletEventForReconcile[]): number | null {
  const withdrawals = events.filter((e) => e.wallet_event_type === 'AUTO_WITHDRAWAL')
  if (withdrawals.length === 0) return null
  return withdrawals.reduce((sum, e) => sum + n(e.amount), 0)
}

function buildLine(label: string, ours: number | null, coupang: number, ourBlindSpot: boolean): ReconciliationLine {
  const diff = ours == null ? coupang : coupang - ours
  return { label, ours, coupang, diff, ourBlindSpot }
}

/**
 * 한 정산주기의 대조 행을 조립한다. 쿠팡 확정(report)·우리 집계(ourPnlForPeriod)가 정본이며,
 * 이 함수는 순수 매핑·차액 계산만 수행한다.
 */
export function buildReconciliationRow(
  report: SettlementReportForReconcile,
  ourPnlForPeriod: PnlSummaryData,
  walletEventsInWindow: WalletEventForReconcile[]
): ReconciliationRow {
  const coupangFinalPayout = n(report.final_settlement_amount)
  const ourEstimatedPayout = estimatePayout(ourPnlForPeriod)

  const lines: ReconciliationLine[] = [
    buildLine('매출', ourPnlForPeriod.totalRevenue, n(report.total_sales_amount), false),
    // 쿠팡 total_refunded_amount는 음수(차감 부호)로 저장된다(실데이터 확인 2026-07-13: -2,711,700).
    // 우리 totalCancelAmount는 양수 크기라, 절대값으로 정규화해 같은 크기끼리 비교한다.
    buildLine('반품/취소', ourPnlForPeriod.totalCancelAmount, Math.abs(n(report.total_refunded_amount)), false),
    buildLine(
      '판매수수료(VAT포함)',
      ourPnlForPeriod.totalCommission + ourPnlForPeriod.totalCommissionVat,
      n(report.total_take_rate_amount_with_vat),
      false
    ),
    buildLine('판매자 할인쿠폰', ourPnlForPeriod.totalCoupon, n(report.total_seller_discount), false),
    buildLine(
      '입출고비(VAT포함)',
      ourPnlForPeriod.totalFulfillment + ourPnlForPeriod.totalFulfillmentVat,
      n(report.total_fulfillment_fee_deduction_amount),
      false
    ),
    buildLine('광고비 정산 차감', ourPnlForPeriod.totalAdSpend, n(report.total_ad_sales_deduction_amount), false),
    // 우리 마진공식에 대응 항목이 없는 '신규 확보' 비용 — ours=null
    buildLine('입고비(창고 취급)', null, n(report.total_warehousing_fee_deduction_amount), true),
    buildLine('보관료', null, n(report.total_storage_fee_deduction_amount), true),
    buildLine('구독료', null, n(report.total_subscription_fee_deduction_amount), true),
    buildLine('비즈니스 인사이트비', null, n(report.total_business_insights_deduction_amount), true),
    buildLine('CFS 수수료', null, n(report.total_final_cfs_fee_deduction_amount), true),
    buildLine('CFS 재고보상금', null, n(report.total_cfs_inventory_compensation_amount), true),
  ]

  return {
    settlementGroupKey: report.settlement_group_key,
    cycle: report.settlement_cycle,
    periodStart: report.period_start,
    periodEnd: report.period_end,
    settlementDate: report.settlement_date,
    coupangFinalPayout,
    ourEstimatedPayout,
    actualDeposit: sumActualDeposit(walletEventsInWindow),
    lines,
    totalDiff: coupangFinalPayout - ourEstimatedPayout,
  }
}
