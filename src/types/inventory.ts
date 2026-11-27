// Phase 2: 재고 관리 타입 정의

import type { Tables } from './database'
import type { LeadTimeSource } from '@/lib/inventory/reorder'

/** 재고 현황 (inventory 테이블 Row + 상품명) */
export interface InventoryItem {
  id: string
  productId: string
  productName: string
  optionName: string | null
  barcode: string | null
  sku: string | null
  productGrade: string | null
  isRefurbished: boolean
  currentStock: number
  coupangStock: number
  // 기간별 일평균판매
  avgSales7d: number
  avgSales14d: number
  avgSales30d: number
  avgDailySales: number  // 현재 선택된 기간 기준
  reorderPoint: number
  safetyStock: number
  leadTimeDays: number
  leadTimeWeeks: number
  leadTimeSource: LeadTimeSource
  supplierName: string | null
  daysUntilReorder: number | null
  reorderDate: string | null
  lastInboundAt: string | null
  avgCostKrw: number
  stockValue: number
  // 계산 필드
  daysOfSupply: number
  stockStatus: StockStatus
  salesStatus: string
}

/** 재고 상태 분류 */
export type StockStatus = 'danger' | 'warning' | 'normal' | 'overstock'

/** 입출고 이력 */
export interface InventoryMovement {
  id: string
  inventoryId: string
  productId: string
  productName?: string
  movementType: MovementType
  quantity: number
  quantityMode?: 'delta' | 'absolute'
  referenceNo: string | null
  unitCost: number | null
  notes: string | null
  movementDate: string
  createdAt: string
}

export type MovementType = 'inbound' | 'outbound' | 'adjustment'

/** 입고 등록 폼 */
export interface InboundFormData {
  operationId: string
  productId: string
  inventoryId: string
  quantity: number
  unitCost?: number
  referenceNo?: string
  notes?: string
  movementDate?: string
}

/** 재고 알림 */
export interface StockAlert {
  productId: string
  productName: string
  sku: string | null
  currentStock: number
  reorderPoint: number
  daysOfSupply: number
  daysUntilReorder: number | null
  reorderDate: string | null
  leadTimeDays: number
  leadTimeSource: LeadTimeSource
  supplierName: string | null
  status: 'danger' | 'warning'
}

/** 재고 요약 KPI */
export interface InventorySummary {
  totalSku: number
  dangerCount: number
  warningCount: number
  totalStockValue: number
}
