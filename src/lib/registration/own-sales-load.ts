/**
 * 우리 판매량 읽기(J51) — 잡 생성(POST /api/registration/pdp) 때 한 번 읽어 스냅숏하고, 생성 화면 고르기 목록을 준다. 읽기만.
 * - 격리: products·sales_transactions 모두 user_id = 잡 사용자 AND business_id = 잡 사업장. 사업장이 없으면 읽지 않는다.
 * - 판매 상품: products purpose='product'이고 등록상품ID(coupang_product_id)가 있는 행. ID가 없는 행은 어느 등록 상품인지 몰라 고르지 않는다.
 * - 판매 행: status='confirmed'만(취소 행은 수량 0), 음수 행(반품·정정)까지 순합 — 계산은 own-sales.ts.
 * 읽지 못해도 잡 생성은 이어 간다(outcome unavailable, 칸 없음).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PdpSpecSheet } from './pdp-state'
import {
  bundleQtyOfName,
  computeOwnSales,
  normalizeOwnSalesBundleQty,
  normalizeOwnSalesProductIds,
  ownSalesLine,
  type BundleQty,
  type OwnSalesOptionRow,
  type OwnSalesRow,
  type OwnSalesSnapshot,
} from './own-sales'

const PAGE_ROWS = 1_000
/** 판매 행 읽기 상한(페이지 수) — 상품 5개 × 옵션 수십 개 × 1년이면 수천 행이다 */
const MAX_PAGES = 50
const IN_CHUNK = 100
const ERROR_MAX = 200

type Paged<T> = (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>

async function readAll<T>(page: Paged<T>): Promise<T[]> {
  const rows: T[] = []
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await page(p * PAGE_ROWS, p * PAGE_ROWS + PAGE_ROWS - 1)
    if (error) throw new Error((error.message ?? '').slice(0, ERROR_MAX))
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE_ROWS) return rows
  }
  throw new Error(`행이 ${MAX_PAGES * PAGE_ROWS}개를 넘음`)
}

interface ProductRow {
  id: string
  coupang_product_id: string | null
  option_name: string | null
  product_name: string | null
  coupang_display_name: string | null
}

const PRODUCT_COLUMNS = 'id, coupang_product_id, option_name, product_name, coupang_display_name'

/** 고른 등록상품ID의 옵션 행과 confirmed 판매 행 */
export async function loadOwnSales(
  db: SupabaseClient,
  userId: string,
  businessId: string,
  productIds: readonly string[]
): Promise<{ options: OwnSalesOptionRow[]; sales: OwnSalesRow[] }> {
  const products = await readAll<ProductRow>((from, to) =>
    db
      .from('products')
      .select(PRODUCT_COLUMNS)
      .eq('user_id', userId)
      .eq('business_id', businessId)
      .eq('purpose', 'product')
      .in('coupang_product_id', [...productIds])
      .order('id', { ascending: true })
      .range(from, to)
  )
  const options = products
    .filter((p) => p.coupang_product_id)
    .map((p) => ({ rowId: p.id, productId: p.coupang_product_id as string, optionName: p.option_name }))
  const sales: OwnSalesRow[] = []
  const rowIds = options.map((o) => o.rowId)
  for (let i = 0; i < rowIds.length; i += IN_CHUNK) {
    const part = rowIds.slice(i, i + IN_CHUNK)
    const rows = await readAll<{ product_id: string; order_date: string; order_quantity: number | string | null }>((from, to) =>
      db
        .from('sales_transactions')
        .select('product_id, order_date, order_quantity')
        .eq('user_id', userId)
        .eq('business_id', businessId)
        .eq('status', 'confirmed')
        .in('product_id', part)
        .order('id', { ascending: true })
        .range(from, to)
    )
    for (const r of rows) sales.push({ rowId: r.product_id, orderDate: String(r.order_date).slice(0, 10), quantity: Number(r.order_quantity) || 0 })
  }
  return { options, sales }
}

/** 화면에서만 오는 칸과 서버가 쓰는 칸 — 입력의 서버 칸(ownSalesSnapshot·ownSales)은 버린다 */
const OWN_SALES_KEYS = ['ownSalesProductIds', 'ownSalesBundleQty', 'ownSalesSnapshot', 'ownSales'] as const

/**
 * 잡 생성 전 spec 정리 — 고른 등록상품ID가 있으면 판매량을 읽어 ownSalesSnapshot(서버 기록)과 ownSales(합·기간 문구)를 채운다.
 * 넷 다 없으면 같은 객체를 그대로 돌려준다(기존 잡 입력 불변)
 */
export async function attachOwnSales(
  db: SupabaseClient,
  userId: string,
  businessId: string | null,
  spec: PdpSpecSheet,
  now: Date
): Promise<PdpSpecSheet> {
  if (!OWN_SALES_KEYS.some((k) => k in spec)) return spec
  const { ownSalesProductIds, ownSalesBundleQty, ownSalesSnapshot: _snapshot, ownSales: _line, ...rest } = spec
  void _snapshot
  void _line
  const ids = normalizeOwnSalesProductIds(ownSalesProductIds)
  if (ids.length === 0) return rest
  const manual = normalizeOwnSalesBundleQty(ownSalesBundleQty)
  const out: PdpSpecSheet = { ...rest, ownSalesProductIds: ids, ...(Object.keys(manual).length > 0 ? { ownSalesBundleQty: manual } : {}) }
  const at = now.toISOString()
  const fail = (outcome: 'no_business' | 'unavailable'): OwnSalesSnapshot => ({ version: 1, at, productIds: ids, outcome, total: null, unit: null, from: null, to: null, options: [] })
  if (!businessId) {
    out.ownSalesSnapshot = fail('no_business')
    return out
  }
  try {
    const { options, sales } = await loadOwnSales(db, userId, businessId, ids)
    out.ownSalesSnapshot = computeOwnSales(ids, options, sales, manual, at)
  } catch (error) {
    console.error(`registration pdp: 우리 판매량을 읽지 못함 — 판매 칸 없이 잡을 만든다: ${error instanceof Error ? error.message : String(error)}`)
    out.ownSalesSnapshot = fail('unavailable')
  }
  const line = ownSalesLine(out.ownSalesSnapshot)
  if (line) out.ownSales = line
  return out
}

export interface OwnListing {
  productId: string
  name: string
  options: Array<{ rowId: string; name: string | null; bundle: BundleQty | null }>
}

/** 생성 화면 고르기 목록 — 사업장의 판매 상품을 등록상품ID로 묶는다. q가 있으면 상품명에 든 것만, 상한 limit개 */
export async function listOwnListings(db: SupabaseClient, userId: string, businessId: string, q: string, limit = 30): Promise<OwnListing[]> {
  const products = await readAll<ProductRow>((from, to) =>
    db
      .from('products')
      .select(PRODUCT_COLUMNS)
      .eq('user_id', userId)
      .eq('business_id', businessId)
      .eq('purpose', 'product')
      .order('id', { ascending: true })
      .range(from, to)
  )
  const needle = q.trim().toLowerCase()
  const byId = new Map<string, OwnListing>()
  for (const p of products) {
    if (!p.coupang_product_id) continue
    const name = (p.coupang_display_name || p.product_name || '').trim()
    if (needle && !name.toLowerCase().includes(needle) && p.coupang_product_id !== needle) continue
    const listing = byId.get(p.coupang_product_id) ?? { productId: p.coupang_product_id, name, options: [] }
    listing.options.push({ rowId: p.id, name: p.option_name, bundle: bundleQtyOfName(p.option_name) })
    byId.set(p.coupang_product_id, listing)
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.productId.localeCompare(b.productId)).slice(0, limit)
}
