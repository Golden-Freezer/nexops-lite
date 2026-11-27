import { IMPORT_CONFIGS } from '@/types/import'
import type { ImportConfig, ImportType } from '@/types/import'
import {
  CONFIGURABLE_IMPORT_TYPES,
  type BusinessSettings,
  type BusinessSettingsUpdate,
  type ConfigurableImportType,
  type ImportColumnMappings,
} from '@/types/settings'

export const DEFAULT_COMMISSION_RATE = 0.108
export const DEFAULT_RETURN_RATE = 0.08
export const DEFAULT_INVENTORY_ALERT_THRESHOLD_DAYS = 14

export function defaultBusinessSettings(businessId: string): BusinessSettings {
  return {
    businessId,
    defaultCommissionRate: DEFAULT_COMMISSION_RATE,
    defaultReturnRate: DEFAULT_RETURN_RATE,
    inventoryAlertThresholdDays: DEFAULT_INVENTORY_ALERT_THRESHOLD_DAYS,
    inventoryNotificationsEnabled: true,
    importColumnMappings: {},
    updatedAt: null,
  }
}

function finiteNumber(value: unknown, field: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${field} 값이 올바르지 않습니다.`)
  return parsed
}

function normalizeRate(value: unknown, field: string): number {
  const parsed = finiteNumber(value, field)
  if (parsed < 0 || parsed > 1) {
    throw new Error(`${field}은(는) 0% 이상 100% 이하여야 합니다.`)
  }
  return Math.round(parsed * 10_000) / 10_000
}

function isConfigurableImportType(value: string): value is ConfigurableImportType {
  return (CONFIGURABLE_IMPORT_TYPES as readonly string[]).includes(value)
}

/** 사용자 매핑은 기존 임포트 대상 컬럼으로만 연결해 임의 DB 필드 주입을 막는다. */
export function normalizeImportColumnMappings(value: unknown): ImportColumnMappings {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Excel Import 매핑 형식이 올바르지 않습니다.')
  }

  const normalized: ImportColumnMappings = {}
  let aliasCount = 0

  for (const [type, aliases] of Object.entries(value as Record<string, unknown>)) {
    if (!isConfigurableImportType(type)) {
      throw new Error(`지원하지 않는 Import 유형입니다: ${type}`)
    }
    if (typeof aliases !== 'object' || aliases == null || Array.isArray(aliases)) {
      throw new Error(`${type} 매핑 형식이 올바르지 않습니다.`)
    }

    const allowedTargets = new Set(Object.values(IMPORT_CONFIGS[type].columnMapping))
    const typeMappings: Record<string, string> = {}
    for (const [rawHeader, rawTarget] of Object.entries(aliases as Record<string, unknown>)) {
      const header = rawHeader.trim()
      const target = String(rawTarget ?? '').trim()
      if (!header || header.length > 120) {
        throw new Error('Excel 컬럼명은 1~120자로 입력하세요.')
      }
      if (!allowedTargets.has(target)) {
        throw new Error(`${type}에서 허용되지 않는 대상 필드입니다: ${target}`)
      }
      typeMappings[header] = target
      aliasCount++
      if (aliasCount > 100) throw new Error('사용자 매핑은 최대 100개까지 저장할 수 있습니다.')
    }
    if (Object.keys(typeMappings).length > 0) normalized[type] = typeMappings
  }

  return normalized
}

export function normalizeBusinessSettingsUpdate(value: unknown): BusinessSettingsUpdate {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new Error('설정 요청 형식이 올바르지 않습니다.')
  }
  const body = value as Record<string, unknown>
  const update: BusinessSettingsUpdate = {}

  if (body.defaultCommissionRate !== undefined) {
    update.defaultCommissionRate = normalizeRate(body.defaultCommissionRate, '기본 수수료율')
  }
  if (body.defaultReturnRate !== undefined) {
    update.defaultReturnRate = normalizeRate(body.defaultReturnRate, '기본 반품율')
  }
  if (body.inventoryAlertThresholdDays !== undefined) {
    const days = finiteNumber(body.inventoryAlertThresholdDays, '재고 알림 임계값')
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      throw new Error('재고 알림 임계값은 0~365일 정수여야 합니다.')
    }
    update.inventoryAlertThresholdDays = days
  }
  if (body.inventoryNotificationsEnabled !== undefined) {
    if (typeof body.inventoryNotificationsEnabled !== 'boolean') {
      throw new Error('재고 알림 사용 여부가 올바르지 않습니다.')
    }
    update.inventoryNotificationsEnabled = body.inventoryNotificationsEnabled
  }
  if (body.importColumnMappings !== undefined) {
    update.importColumnMappings = normalizeImportColumnMappings(body.importColumnMappings)
  }

  return update
}

export function businessSettingsFromRow(
  businessId: string,
  row: Record<string, unknown> | null | undefined
): BusinessSettings {
  const defaults = defaultBusinessSettings(businessId)
  if (!row) return defaults
  return {
    businessId,
    defaultCommissionRate: Number(row.default_commission_rate ?? defaults.defaultCommissionRate),
    defaultReturnRate: Number(row.default_return_rate ?? defaults.defaultReturnRate),
    inventoryAlertThresholdDays: Number(
      row.inventory_alert_threshold_days ?? defaults.inventoryAlertThresholdDays
    ),
    inventoryNotificationsEnabled:
      row.inventory_notifications_enabled !== false,
    importColumnMappings: normalizeImportColumnMappings(row.import_column_mappings ?? {}),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  }
}

export function resolveImportConfig(
  importType: ImportType,
  customMappings?: ImportColumnMappings
): ImportConfig {
  const base = IMPORT_CONFIGS[importType]
  const aliases = customMappings?.[importType as ConfigurableImportType] ?? {}
  return {
    ...base,
    requiredColumns: [...base.requiredColumns],
    columnMapping: { ...base.columnMapping, ...aliases },
  }
}

export function isWithinInventoryAlertThreshold(
  daysUntilReorder: number | null,
  thresholdDays: number
): boolean {
  return daysUntilReorder !== null && daysUntilReorder <= Math.max(0, thresholdDays)
}

/**
 * 같은 사업장의 늦은 조회 응답은 사용자가 이미 편집한 초안을 덮지 않는다.
 * 사업장이 바뀐 경우에만 새 사업장 값으로 즉시 전환한다.
 */
export function shouldHydrateBusinessSettingsDraft(
  draftBusinessId: string | null,
  incomingBusinessId: string,
  dirty: boolean,
): boolean {
  return draftBusinessId !== incomingBusinessId || !dirty
}
