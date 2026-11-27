/**
 * Supabase 타입 안전 쿼리 헬퍼
 *
 * @supabase/ssr v0.5와 @supabase/supabase-js v2.101의 제네릭 파라미터
 * 불일치로 Insert/Update 타입이 `never`로 해석되는 이슈 우회.
 * `as any`를 이 파일에 격리하여 라우트 파일의 타입 안전성 유지.
 */
import type {
  ProductNameInsert,
  ProductNameUpdate,
  ProductInsert,
  ProductUpdate,
  ProductCostInsert,
  InventoryUpdate,
  InventoryMovementInsert,
  SettlementInsert,
  SettlementUpdate,
  SupplierInsert,
  SupplierUpdate,
} from "@/types/database-aliases";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

/** product_names INSERT */
export function insertProductName(
  supabase: SupabaseClient,
  data: ProductNameInsert,
) {
  return supabase.from("product_names").insert(data).select().single();
}

/** product_names UPDATE — draft 라이프사이클(id 보유 시 upsert) */
export function updateProductName(
  supabase: SupabaseClient,
  id: string,
  userId: string,
  data: ProductNameUpdate,
) {
  return supabase
    .from("product_names")
    .update(data)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();
}

/** products INSERT */
export function insertProduct(supabase: SupabaseClient, data: ProductInsert) {
  return supabase.from("products").insert(data).select().single();
}

/** products UPDATE */
export function updateProduct(
  supabase: SupabaseClient,
  id: string,
  data: ProductUpdate,
) {
  return supabase.from("products").update(data).eq("id", id).select().single();
}

/** 소싱 전용 products 작명 동기화 — 운영 상품은 조건에서 제외 */
export function updateSourcingProductNaming(
  supabase: SupabaseClient,
  id: string,
  userId: string,
  data: Pick<ProductUpdate, "coupang_display_name" | "search_tags">,
) {
  return supabase
    .from("products")
    .update(data)
    .eq("id", id)
    .eq("user_id", userId)
    .eq("purpose", "sourcing")
    .is("business_id", null)
    .select("id")
    .maybeSingle();
}

/** 소싱 전용 products 작명 반영 직전 이름 조회 */
export function getSourcingProductNaming(
  supabase: SupabaseClient,
  id: string,
  userId: string,
) {
  return supabase
    .from("products")
    .select("id, business_id, coupang_display_name")
    .eq("id", id)
    .eq("user_id", userId)
    .eq("purpose", "sourcing")
    .is("business_id", null)
    .maybeSingle();
}

interface ProductNameHistoryInsert {
  user_id: string;
  business_id: string | null;
  product_id: string;
  product_name_record_id: string;
  previous_name: string | null;
  new_name: string;
  source: "naming";
}

/** product_name_history INSERT — 신규 DDL 적용 전에는 호출자가 오류를 fail-safe로 흡수한다. */
export function insertProductNameHistory(
  supabase: SupabaseClient,
  data: ProductNameHistoryInsert,
) {
  return supabase.from("product_name_history").insert(data);
}

/** product_costs INSERT */
export function insertProductCost(
  supabase: SupabaseClient,
  data: ProductCostInsert,
) {
  return supabase.from("product_costs").insert(data).select().single();
}

// ─── Phase 2: 재고 + 정산 쿼리 ───

/** inventory_movements INSERT */
export function insertInventoryMovement(
  supabase: SupabaseClient,
  data: InventoryMovementInsert,
) {
  return supabase.from("inventory_movements").insert(data).select().single();
}

/** inventory UPDATE (current_stock, last_inbound_at 등) */
export function updateInventoryStock(
  supabase: SupabaseClient,
  inventoryId: string,
  data: InventoryUpdate,
) {
  return supabase
    .from("inventory")
    .update(data)
    .eq("id", inventoryId)
    .select()
    .single();
}

/** settlements INSERT */
export function insertSettlement(
  supabase: SupabaseClient,
  data: SettlementInsert,
) {
  return supabase.from("settlements").insert(data).select().single();
}

/** settlements UPDATE */
export function updateSettlement(
  supabase: SupabaseClient,
  id: string,
  data: SettlementUpdate,
) {
  return supabase
    .from("settlements")
    .update(data)
    .eq("id", id)
    .select()
    .single();
}

// ─── 소싱업체 쿼리 ───

/** suppliers INSERT */
export function insertSupplier(supabase: SupabaseClient, data: SupplierInsert) {
  return supabase.from("suppliers").insert(data).select().single();
}

/** suppliers UPDATE */
export function updateSupplier(
  supabase: SupabaseClient,
  id: string,
  data: SupplierUpdate,
) {
  return supabase.from("suppliers").update(data).eq("id", id).select().single();
}

/** suppliers SELECT single (screenshots 등 특정 컬럼) */
export function selectSupplier(
  supabase: SupabaseClient,
  id: string,
  columns = "*",
) {
  return supabase.from("suppliers").select(columns).eq("id", id).single();
}
