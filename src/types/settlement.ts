// Phase 2: 정산 시스템 타입 정의

/** 정산 내역 아이템 (settlements 테이블 Row + 상품명) */
export interface SettlementItem {
  id: string
  productId: string
  productName: string
  sku: string | null
  periodStart: string
  periodEnd: string
  salesQuantity: number
  totalRevenue: number
  totalCost: number
  totalFulfillment: number
  totalFulfillmentVat: number
  totalCommission: number
  totalCommissionVat: number
  totalReturnPickup: number
  totalReturnRestock: number
  totalVat: number
  totalMargin: number
  totalMarginRate: number
  adCost: number
  netProfit: number
  verified: boolean
  createdAt: string
}

/** 정산 수동 입력 폼 */
export interface SettlementFormData {
  productId: string
  periodStart: string
  periodEnd: string
  salesQuantity: number
  sellingPrice: number       // 단품 판매가 (마진 역산용)
  unitCost: number           // 단품 원가
  fulfillmentFee: number     // 단품 입출고비
  commissionRate: number     // 수수료율
  returnRate?: number        // 반품율
  returnPickupFee?: number   // 반품회수비
  returnRestockFee?: number  // 반품재입고비
  adCost?: number            // 광고비
}

/** 상품별 손익 집계 */
export interface ProfitLossRow {
  productId: string
  productName: string
  sku: string | null
  periodCount: number        // 정산 건수
  totalRevenue: number
  totalCost: number
  totalFulfillment: number
  totalCommission: number
  totalReturnCost: number
  totalVat: number
  totalMargin: number
  totalMarginRate: number
  totalAdCost: number
  totalNetProfit: number
}

/** SKU 수익성 랭킹 */
export interface SkuProfitability {
  rank: number
  productId: string
  productName: string
  sku: string | null
  avgMarginRate: number
  totalMargin: number
  totalRevenue: number
  adSpend: number
  allocatedExpenses: number
  totalNetProfit: number
  contributionRate: number
  isLoss: boolean
  grade: 'A' | 'B' | 'C' | 'D'  // 마진율 기준 등급
}

/** 기간 필터 */
export interface PeriodFilter {
  type: 'week' | 'month' | 'last-month' | 'last7' | 'last30' | 'custom'
  periodStart: string
  periodEnd: string
}
