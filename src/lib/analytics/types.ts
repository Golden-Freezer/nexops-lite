/**
 * ops-ux 공용 타입 — 전 페이즈에서 사용하는 analytics 타입 정의
 * (신규 코드 any 금지 원칙에 따라 이 파일의 타입을 사용한다)
 */

export type Granularity = 'daily' | 'weekly' | 'monthly'

/** P&L 버킷 — 기존 PnlDaily(usePnl.ts)와 동일 필드 + 버킷 키 */
export interface PnlBucket {
  bucket: string // 일: 'YYYY-MM-DD' | 주: 그 주 월요일 'YYYY-MM-DD' | 월: 'YYYY-MM'
  revenue: number
  quantity: number
  cost: number
  commission: number
  commissionVat: number
  fulfillment: number
  fulfillmentVat: number
  coupon: number
  vat: number
  cancelAmount: number
  margin: number
  adSpend: number
  expenses: number
  coupangDeductionExpenses?: number
  netProfit: number
}

/** 총합 요약 — 기존 PnlSummary(usePnl.ts)와 동일 구조 */
export interface PnlSummaryData {
  totalRevenue: number
  totalQuantity: number
  totalCancelAmount: number
  totalCoupon: number
  totalCommission: number
  totalCommissionVat: number
  totalFulfillment: number
  totalFulfillmentVat: number
  totalCost: number
  totalVat: number
  totalMargin: number
  totalAdSpend: number
  totalAdVat: number
  totalExpenses: number
  coupangDeductionExpenses?: number
  netProfit: number
}

export interface PeriodTile {
  key: 'today' | 'yesterday' | 'mtd' | 'lastMonth'
  label: string // '오늘' | '어제' | '이번 달' | '지난 달'
  startDate: string
  endDate: string
  revenue: number
  adSpend: number
  expenses: number
  margin: number
  netProfit: number
  marginRate: number // %
  estimatedPayout: number
}

export interface BusinessOverview {
  businessId: string
  businessName: string
  revenue: number
  margin: number
  adSpend: number
  expenses: number
  netProfit: number
  marginRate: number
  stockAlertCount: number
  pendingPurchaseCount: number
}

export interface OverviewData {
  period: { startDate: string; endDate: string }
  combined: Omit<BusinessOverview, 'businessId' | 'businessName'>
  businesses: BusinessOverview[]
}
