// NexOps 계산 관련 타입 정의

/** 단품 마진 계산 입력 */
export interface MarginInput {
  sellingPrice: number       // 판매가
  unitCost: number           // 원가
  fulfillmentFee: number     // 입출고배송비
  commissionRate: number     // 수수료율 (0.040 ~ 0.109)
  couponDiscount?: number    // 판매자할인쿠폰 (건당, 기본 0) — import 저장 공식과 통일(audit §1-10)
  returnRate?: number        // 반품율 (기본 0.08)
  returnPickupFee?: number   // 반품회수비
  returnRestockFee?: number  // 반품재입고비
}

/** 단품 마진 계산 결과 */
export interface MarginResult {
  // 비용 분해
  commissionAmount: number   // 판매수수료
  commissionVat: number      // 수수료 VAT
  fulfillmentVat: number     // 입출고 VAT
  vat: number                // 부가세
  // 마진
  margin: number             // 마진 (원)
  marginRate: number         // 마진율 (0~1)
  minRoas: number            // 최소 광고수익률
  // 비용 비율
  costBreakdown: {
    unitCost: number         // 원가 비율
    fulfillment: number      // 물류 비율
    commission: number       // 수수료 비율
    coupon: number           // 쿠폰 비율
    vat: number              // VAT 비율
    margin: number           // 마진 비율
  }
}

/** 총합 시뮬레이션 입력 */
export interface SimulationInput extends MarginInput {
  quantity: number           // 예상 판매량
  adCost?: number            // 광고비
}

/** 총합 시뮬레이션 결과 */
export interface SimulationResult {
  totalRevenue: number       // 총매출
  totalCost: number          // 총원가
  totalFulfillment: number   // 총입출고비
  totalCommission: number    // 총수수료
  totalCoupon: number        // 총쿠폰
  totalReturnCost: number    // 총반품비용
  totalVat: number           // 총VAT
  totalMargin: number        // 총마진
  totalMarginRate: number    // 총마진율
  adCost: number             // 광고비
  netProfit: number          // 순이익
  breakEvenQty: number       // 손익분기 판매량
}

/** 판매가 역산 입력 */
export interface ReversePriceInput {
  targetMarginRate: number   // 목표 마진율
  unitCost: number           // 원가
  fulfillmentFee: number     // 입출고배송비
  commissionRate: number     // 수수료율
}

/** 수수료 룰 */
export interface CommissionRule {
  id: number
  majorCategory: string
  midCategory: string | null
  subCategory: string | null
  rate: number
}

/** 카테고리 트리 (UI용) */
export interface CategoryNode {
  label: string
  value: string
  rate?: number
  children?: CategoryNode[]
}
