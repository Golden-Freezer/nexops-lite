/**
 * 정산 DB Row → SettlementItem 매핑 (snake_case → camelCase)
 * API route 파일에서 export하면 Next.js 빌드 에러 발생하므로 분리
 */

import type { SettlementItem } from '@/types/settlement'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapRowToSettlementItem(row: any): SettlementItem {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.products?.product_name || row.products?.keyword || '',
    sku: row.products?.sku || null,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    salesQuantity: row.sales_quantity || 0,
    totalRevenue: row.total_revenue || 0,
    totalCost: row.total_cost || 0,
    totalFulfillment: row.total_fulfillment || 0,
    totalFulfillmentVat: row.total_fulfillment_vat || 0,
    totalCommission: row.total_commission || 0,
    totalCommissionVat: row.total_commission_vat || 0,
    totalReturnPickup: row.total_return_pickup || 0,
    totalReturnRestock: row.total_return_restock || 0,
    totalVat: row.total_vat || 0,
    totalMargin: row.total_margin || 0,
    totalMarginRate: row.total_margin_rate || 0,
    adCost: row.ad_cost || 0,
    netProfit: row.net_profit || 0,
    verified: row.verified || false,
    createdAt: row.created_at || '',
  }
}
