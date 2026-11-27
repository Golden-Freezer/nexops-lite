// 편의용 Row/Insert/Update alias
// 이 파일은 수동 유지. `npx supabase gen types` 가 database.ts 를 덮어써도
// 이 파일은 영향받지 않으므로 alias 가 안전하게 보존된다.

import type { Database } from './database'

// products
export type ProductRow = Database['public']['Tables']['products']['Row']
export type ProductInsert = Database['public']['Tables']['products']['Insert']
export type ProductUpdate = Database['public']['Tables']['products']['Update']

// product_costs
export type ProductCostRow = Database['public']['Tables']['product_costs']['Row']
export type ProductCostInsert = Database['public']['Tables']['product_costs']['Insert']

// product_names
export type ProductNameRow = Database['public']['Tables']['product_names']['Row']
export type ProductNameInsert = Database['public']['Tables']['product_names']['Insert']
export type ProductNameUpdate = Database['public']['Tables']['product_names']['Update']

// suppliers
export type SupplierRow = Database['public']['Tables']['suppliers']['Row']
export type SupplierInsert = Database['public']['Tables']['suppliers']['Insert']
export type SupplierUpdate = Database['public']['Tables']['suppliers']['Update']

// inventory
export type InventoryRow = Database['public']['Tables']['inventory']['Row']
export type InventoryUpdate = Database['public']['Tables']['inventory']['Update']

// inventory_movements
export type InventoryMovementRow = Database['public']['Tables']['inventory_movements']['Row']
export type InventoryMovementInsert = Database['public']['Tables']['inventory_movements']['Insert']

// settlements
export type SettlementRow = Database['public']['Tables']['settlements']['Row']
export type SettlementInsert = Database['public']['Tables']['settlements']['Insert']
export type SettlementUpdate = Database['public']['Tables']['settlements']['Update']
