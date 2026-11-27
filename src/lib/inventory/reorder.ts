import {
  calculateDaysOfSupply,
  calculateReorderPoint,
  classifyStockStatus,
} from './stock'

export type LeadTimeSource =
  | 'supplier'
  | 'purchase_history'
  | 'purchase'
  | 'product'
  | 'default'

export interface PurchaseLeadTimeRow {
  product_id: string | null
  order_date: string
  arrival_date: string | null
  lead_time_weeks: number | string | null
  suppliers:
    | { name?: string | null; lead_time_days?: number | string | null; is_active?: boolean | null }
    | { name?: string | null; lead_time_days?: number | string | null; is_active?: boolean | null }[]
    | null
}

export interface PurchaseLeadTimeSummary {
  supplierName: string | null
  supplierLeadTimeDays: number | null
  averageActualLeadTimeDays: number | null
  purchaseLeadTimeDays: number | null
}

export interface LeadTimeProfile {
  leadTimeDays: number
  leadTimeWeeks: number
  leadTimeSource: LeadTimeSource
  supplierName: string | null
}

export interface ReorderPlan {
  daysOfSupply: number
  safetyStock: number
  reorderPoint: number
  daysUntilReorder: number | null
  reorderDate: string | null
  stockStatus: 'danger' | 'warning' | 'normal' | 'overstock'
}

function positiveNumber(value: number | string | null | undefined): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function supplierOf(row: PurchaseLeadTimeRow) {
  if (Array.isArray(row.suppliers)) return row.suppliers[0] ?? null
  return row.suppliers
}

function daysBetween(start: string, end: string): number | null {
  const startMs = Date.parse(`${start}T00:00:00Z`)
  const endMs = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null
  const days = Math.round((endMs - startMs) / 86_400_000)
  return days > 0 && days <= 365 ? days : null
}

/** 매입 이력에서 상품별 공급처/실입고/수동 리드타임 후보를 만든다. */
export function buildPurchaseLeadTimeMap(
  rows: PurchaseLeadTimeRow[]
): Map<string, PurchaseLeadTimeSummary> {
  const grouped = new Map<string, PurchaseLeadTimeRow[]>()
  for (const row of rows) {
    if (!row.product_id) continue
    const items = grouped.get(row.product_id) ?? []
    items.push(row)
    grouped.set(row.product_id, items)
  }

  const result = new Map<string, PurchaseLeadTimeSummary>()
  for (const [productId, purchases] of grouped) {
    const sorted = [...purchases].sort((a, b) => b.order_date.localeCompare(a.order_date))
    const supplierRow = sorted.find((row) => {
      const supplier = supplierOf(row)
      return supplier?.is_active !== false && positiveNumber(supplier?.lead_time_days) !== null
    })
    const supplier = supplierRow ? supplierOf(supplierRow) : null
    const actualDays = sorted
      .map((row) => row.arrival_date ? daysBetween(row.order_date, row.arrival_date) : null)
      .filter((days): days is number => days !== null)
    const purchaseLead = sorted
      .map((row) => positiveNumber(row.lead_time_weeks))
      .find((weeks) => weeks !== null)

    result.set(productId, {
      supplierName: supplier?.name?.trim() || null,
      supplierLeadTimeDays: positiveNumber(supplier?.lead_time_days),
      averageActualLeadTimeDays: actualDays.length > 0
        ? Math.max(1, Math.round(actualDays.reduce((sum, days) => sum + days, 0) / actualDays.length))
        : null,
      purchaseLeadTimeDays: purchaseLead !== undefined && purchaseLead !== null
        ? Math.max(1, Math.round(purchaseLead * 7))
        : null,
    })
  }

  return result
}

/** 공급처 → 실입고 평균 → 매입 입력 → 상품 기본값 → 14일 순으로 리드타임을 결정한다. */
export function resolveLeadTimeProfile(
  summary: PurchaseLeadTimeSummary | undefined,
  productLeadTimeWeeks: number | string | null | undefined
): LeadTimeProfile {
  if (summary?.supplierLeadTimeDays) {
    return {
      leadTimeDays: summary.supplierLeadTimeDays,
      leadTimeWeeks: summary.supplierLeadTimeDays / 7,
      leadTimeSource: 'supplier',
      supplierName: summary.supplierName,
    }
  }
  if (summary?.averageActualLeadTimeDays) {
    return {
      leadTimeDays: summary.averageActualLeadTimeDays,
      leadTimeWeeks: summary.averageActualLeadTimeDays / 7,
      leadTimeSource: 'purchase_history',
      supplierName: summary.supplierName,
    }
  }
  if (summary?.purchaseLeadTimeDays) {
    return {
      leadTimeDays: summary.purchaseLeadTimeDays,
      leadTimeWeeks: summary.purchaseLeadTimeDays / 7,
      leadTimeSource: 'purchase',
      supplierName: summary.supplierName,
    }
  }

  const productDays = positiveNumber(productLeadTimeWeeks)
  if (productDays) {
    return {
      leadTimeDays: Math.max(1, Math.round(productDays * 7)),
      leadTimeWeeks: productDays,
      leadTimeSource: 'product',
      supplierName: summary?.supplierName ?? null,
    }
  }

  return {
    leadTimeDays: 14,
    leadTimeWeeks: 2,
    leadTimeSource: 'default',
    supplierName: summary?.supplierName ?? null,
  }
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

/** 현재 재고·판매속도·리드타임으로 재발주점과 발주 예정일을 계산한다. */
export function calculateReorderPlan(
  currentStock: number,
  avgDailySales: number,
  leadTimeDays: number,
  today: string
): ReorderPlan {
  const normalizedStock = Math.max(0, Number(currentStock) || 0)
  const normalizedSales = Math.max(0, Number(avgDailySales) || 0)
  const normalizedLeadTime = Math.max(1, Math.round(Number(leadTimeDays) || 14))

  if (normalizedSales <= 0) {
    return {
      daysOfSupply: calculateDaysOfSupply(normalizedStock, 0),
      safetyStock: 0,
      reorderPoint: 0,
      daysUntilReorder: null,
      reorderDate: null,
      stockStatus: normalizedStock <= 0 ? 'danger' : 'normal',
    }
  }

  const safetyStockDays = Math.max(1, Math.ceil(normalizedLeadTime * 0.5))
  const safetyStock = Math.ceil(normalizedSales * normalizedLeadTime)
  const reorderPoint = calculateReorderPoint(
    normalizedSales,
    normalizedLeadTime,
    safetyStockDays
  )
  const daysUntilReorder = normalizedStock <= reorderPoint
    ? 0
    : Math.max(0, Math.floor((normalizedStock - reorderPoint) / normalizedSales))

  return {
    daysOfSupply: calculateDaysOfSupply(normalizedStock, normalizedSales),
    safetyStock,
    reorderPoint,
    daysUntilReorder,
    reorderDate: addDays(today, daysUntilReorder),
    stockStatus: classifyStockStatus(normalizedStock, reorderPoint, safetyStock),
  }
}
