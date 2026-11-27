/**
 * 재고 관리 비즈니스 로직 (순수 함수)
 * 재고일수, 재발주점, 상태 분류, 회전율, 알림
 */

import type { InventoryItem, StockStatus, StockAlert } from '@/types/inventory'

/** 재고일수 계산: 현재 재고로 몇 일 버틸 수 있는지 */
export function calculateDaysOfSupply(currentStock: number, avgDailySales: number): number {
  if (avgDailySales <= 0) return currentStock > 0 ? Infinity : 0
  return Math.floor(currentStock / avgDailySales)
}

/** 재발주점 자동 계산: 리드타임 동안의 예상 판매량 + 안전재고 */
export function calculateReorderPoint(
  avgDailySales: number,
  leadTimeDays: number,
  safetyStockDays: number = 7
): number {
  return Math.ceil(avgDailySales * (leadTimeDays + safetyStockDays))
}

/** 재고 상태 분류 */
export function classifyStockStatus(
  currentStock: number,
  reorderPoint: number,
  safetyStock: number
): StockStatus {
  if (currentStock <= 0) return 'danger'
  if (currentStock <= safetyStock) return 'danger'
  if (currentStock <= reorderPoint) return 'warning'
  // 과잉재고: 재발주점의 3배 초과
  if (reorderPoint > 0 && currentStock > reorderPoint * 3) return 'overstock'
  return 'normal'
}

/** 재고 회전율 계산 (기간 내) */
export function calculateTurnoverRate(
  totalSold: number,
  avgInventory: number,
  periodDays: number = 30
): number {
  if (avgInventory <= 0) return 0
  // 연간 환산
  const annualizedSold = (totalSold / periodDays) * 365
  return Math.round((annualizedSold / avgInventory) * 100) / 100
}

/** 위험/경고 재고 필터링 및 정렬 (위험 우선, 재고일수 오름차순) */
export function getStockAlerts(items: InventoryItem[]): StockAlert[] {
  return items
    .filter((item) => item.stockStatus === 'danger' || item.stockStatus === 'warning')
    .map((item) => ({
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      currentStock: item.currentStock,
      reorderPoint: item.reorderPoint,
      daysOfSupply: item.daysOfSupply,
      daysUntilReorder: item.daysUntilReorder,
      reorderDate: item.reorderDate,
      leadTimeDays: item.leadTimeDays,
      leadTimeSource: item.leadTimeSource,
      supplierName: item.supplierName,
      status: item.stockStatus as 'danger' | 'warning',
    }))
    .sort((a, b) => {
      // 위험 > 경고
      if (a.status !== b.status) return a.status === 'danger' ? -1 : 1
      // 같은 상태면 재고일수 오름차순
      const aDays = a.daysOfSupply === Infinity ? Number.MAX_SAFE_INTEGER : a.daysOfSupply
      const bDays = b.daysOfSupply === Infinity ? Number.MAX_SAFE_INTEGER : b.daysOfSupply
      return aDays - bDays
    })
}
