import type { PnlSummaryData } from './types'

/**
 * 예상 정산금 v2 — 쿠팡 최종지급액 공식의 데이터 보유 항목만 반영한 추정치.
 * (nexops-analytics-conventions §5, CEO 제공 공식 기반)
 *
 * totalRevenue(total_amount)는 이미 취소 차감된 '순 판매 금액'이므로
 * 취소액(cancelAmount)을 다시 빼지 않는다 (이중차감 금지).
 * 미반영: 밀크런·정산차감·라이브수수료·세이버·인사이트비·다음정산이월·재고손실보상
 * → UI에 "(추정)" 표기 필수. 음수면 그대로 반환 (상계 후 지급액 없음/차감 이월 가능성).
 */
export function estimatePayout(s: PnlSummaryData): number {
  return (
    s.totalRevenue -                                    // A: 매출금액 (판매액 − 취소액 = 순 판매 금액)
    s.totalCommission - s.totalCommissionVat -          // B: 판매수수료 (VAT 포함)
    s.totalCoupon -                                     // C: 상계금액 (쿠폰)
    s.totalAdSpend -                                    // I: 광고비 (VAT 포함)
    s.totalFulfillment - s.totalFulfillmentVat          // J: CFS 비용 (입출고배송비)
  )
}
