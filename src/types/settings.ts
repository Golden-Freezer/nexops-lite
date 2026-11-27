import type { ImportType } from '@/types/import'

export const CONFIGURABLE_IMPORT_TYPES = [
  'sales',
  'inventory_health',
  'ad_billing',
  'product',
  'purchase',
] as const satisfies readonly ImportType[]

export type ConfigurableImportType = (typeof CONFIGURABLE_IMPORT_TYPES)[number]

export type ImportColumnMappings = Partial<
  Record<ConfigurableImportType, Record<string, string>>
>

export interface BusinessSettings {
  businessId: string
  defaultCommissionRate: number
  defaultReturnRate: number
  inventoryAlertThresholdDays: number
  inventoryNotificationsEnabled: boolean
  importColumnMappings: ImportColumnMappings
  updatedAt: string | null
}

export interface BusinessSettingsUpdate {
  defaultCommissionRate?: number
  defaultReturnRate?: number
  inventoryAlertThresholdDays?: number
  inventoryNotificationsEnabled?: boolean
  importColumnMappings?: ImportColumnMappings
}
