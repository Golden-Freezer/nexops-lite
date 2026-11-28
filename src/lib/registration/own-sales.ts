/**
 * 우리 판매량 × 묶음 수량(J51, 오너 11-10 23:5x · 통합 decide 28·30) — 쿠팡에서 실제로 파는 우리 상품만, 판매 수 × 1묶음 수량으로 센다. 순수.
 *
 * - 판매 수: 판매장부 Import(sales_transactions)의 confirmed order_quantity 순합(음수 행 = 반품·정정 포함). 옵션 합이 음수면 0.
 *   order_quantity는 이미 총 수량 − 취소 수량이고, 반품은 따로 표 없이 음수 행으로만 들어온다(11-11 운영 읽기 결과).
 * - 묶음 수량: 오너가 화면에서 옵션마다 넣은 값이 이기고, 없으면 등록 옵션명을 classifyOptionLabel로 읽어 '숫자+낱개 단위' 조각 하나일 때만 쓴다.
 *   '20매 x 3팩'·'20개입 2세트'처럼 수량 조각이 둘 이상이거나 묶음 단위(세트·팩)뿐이면 모른다(지어내기 0).
 * - 칸을 쓰지 않는 경우: 판매가 있는 옵션 중 하나라도 수량을 모름 · 옵션끼리 단위가 다름 · 합이 OWN_SALES_MIN 미만 · 판매 0.
 * - 화면·프롬프트에는 합(예 '35,600개')과 기간 문구(예 '2026.02~2026.11 쿠팡 누적 판매')만 간다(ownSalesLine). 옵션별 내역은 서버 스냅숏에만 남는다.
 */

import { classifyOptionLabel } from './options/option-spec'

/** 합이 이보다 작으면 칸을 쓰지 않는다 — 작은 수를 크게 보이면 역효과(통합 decide 30) */
export const OWN_SALES_MIN = 100
/** 고를 수 있는 등록상품ID 수 — 같은 상품이 등록상품ID 여럿에 나뉘어 있다(11-11 읽기: '20개 데이지(S)'가 4개 ID) */
export const OWN_SALES_MAX_PRODUCTS = 5
/** 묶음 수량 상한 */
export const OWN_SALES_QTY_MAX = 100_000
/** 낱개 단위 — 화면에 그대로 쓰는 단위로 맞춘다 */
const UNIT_ALIAS: Readonly<Record<string, string>> = { 개입: '개', 개: '개', 입: '개', ea: '개', p: '개', 매입: '매', 매: '매', 장: '장', 구: '구', 쌍: '쌍', 켤레: '켤레' }
/** 화면 수동 입력이 고를 수 있는 단위 — 옵션명에서 읽은 단위(구·쌍·켤레)는 그 옵션에서 그대로 고를 수 있다 */
export const OWN_SALES_UNITS = ['개', '매', '장'] as const
const KNOWN_UNITS: ReadonlySet<string> = new Set(Object.values(UNIT_ALIAS))

const QTY_PIECE = /^(\d{1,3}(?:,\d{3})+|\d+)\s*(개입|매입|켤레|개|입|ea|p|매|장|구|쌍)$/i

export interface BundleQty {
  qty: number
  unit: string
}

/** 옵션명의 1묶음 수량 — 수량 조각이 '숫자+낱개 단위' 하나일 때만. 모르면 null */
export function bundleQtyOfName(optionName: string | null | undefined): BundleQty | null {
  if (!optionName?.trim()) return null
  // 천 단위 쉼표('1,000장')는 옵션 분류기가 수량으로 읽지 못해 먼저 뗀다
  const quantity = classifyOptionLabel(optionName.replace(/(\d),(?=\d{3}(?!\d))/g, '$1')).quantity?.trim()
  const m = quantity ? QTY_PIECE.exec(quantity) : null
  if (!m) return null
  const qty = Number(m[1].replace(/,/g, ''))
  const unit = UNIT_ALIAS[m[2].toLowerCase()]
  return Number.isInteger(qty) && qty >= 1 && qty <= OWN_SALES_QTY_MAX && unit ? { qty, unit } : null
}

/** 판매 옵션 행(products 한 행 = 등록 옵션 하나) */
export interface OwnSalesOptionRow {
  /** products.id */
  rowId: string
  /** 등록상품ID */
  productId: string
  optionName: string | null
}

/** 판매 행(confirmed만) */
export interface OwnSalesRow {
  rowId: string
  orderDate: string
  quantity: number
}

export interface OwnSalesOption {
  rowId: string
  productId: string
  name: string | null
  qty: number | null
  unit: string | null
  qtySource: 'manual' | 'name' | null
  sold: number
  from: string | null
  to: string | null
}

export type OwnSalesOutcome = 'ok' | 'no_sales' | 'unknown_qty' | 'mixed_unit' | 'below_min' | 'no_business' | 'unavailable'

/** 잡 생성 때 서버가 남기는 기록 — 서버만 쓰고 프롬프트에 넣지 않는다 */
export interface OwnSalesSnapshot {
  version: 1
  at: string
  productIds: string[]
  outcome: OwnSalesOutcome
  total: number | null
  unit: string | null
  from: string | null
  to: string | null
  options: OwnSalesOption[]
}

/** 화면·프롬프트에 가는 값 — 합과 기간 문구만 */
export interface OwnSalesLine {
  total: string
  basis: string
}

/** 화면 고르기 입력 — 등록상품ID만, 숫자 문자열, 중복 없이 상한까지 */
export function normalizeOwnSalesProductIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const ids = raw.map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '')).filter((v) => /^\d{1,20}$/.test(v))
  return [...new Set(ids)].slice(0, OWN_SALES_MAX_PRODUCTS)
}

/** 화면 수동 묶음 수량 — {products.id: {qty, unit}}, 단위는 낱개 단위(개·매·장·구·쌍·켤레)만 */
export function normalizeOwnSalesBundleQty(raw: unknown): Record<string, BundleQty> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, BundleQty> = {}
  for (const [rowId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[0-9a-f-]{36}$/i.test(rowId) || !value || typeof value !== 'object') continue
    const qty = Number((value as { qty?: unknown }).qty)
    const unit = (value as { unit?: unknown }).unit
    if (!Number.isInteger(qty) || qty < 1 || qty > OWN_SALES_QTY_MAX) continue
    if (typeof unit !== 'string' || !KNOWN_UNITS.has(unit)) continue
    out[rowId] = { qty, unit }
  }
  return out
}

/**
 * 옵션 행·판매 행 → 스냅숏. 판매가 있는 옵션(sold > 0)만 합에 넣고 수량·단위를 따진다. 판매가 없는 옵션은 기록만 한다.
 * 기간은 판매가 있는 옵션의 첫·마지막 판매일(수량 0 행은 보지 않는다)
 */
export function computeOwnSales(
  productIds: readonly string[],
  options: readonly OwnSalesOptionRow[],
  sales: readonly OwnSalesRow[],
  manual: Readonly<Record<string, BundleQty>>,
  at: string
): OwnSalesSnapshot {
  const lines: OwnSalesOption[] = options.map((o) => {
    const rows = sales.filter((s) => s.rowId === o.rowId && Number.isFinite(s.quantity) && s.quantity !== 0)
    const net = rows.reduce((sum, s) => sum + s.quantity, 0)
    const dates = rows.map((s) => s.orderDate).sort()
    const hand = manual[o.rowId]
    const named = hand ? null : bundleQtyOfName(o.optionName)
    const bundle = hand ?? named
    return {
      rowId: o.rowId,
      productId: o.productId,
      name: o.optionName,
      qty: bundle?.qty ?? null,
      unit: bundle?.unit ?? null,
      qtySource: hand ? 'manual' : named ? 'name' : null,
      sold: Math.max(0, net),
      from: dates[0] ?? null,
      to: dates.at(-1) ?? null,
    }
  })
  const base = { version: 1 as const, at, productIds: [...productIds], options: lines }
  const sold = lines.filter((l) => l.sold > 0)
  const empty = { total: null, unit: null, from: null, to: null }
  if (sold.length === 0) return { ...base, outcome: 'no_sales', ...empty }
  if (sold.some((l) => l.qty === null || l.unit === null)) return { ...base, outcome: 'unknown_qty', ...empty }
  if (new Set(sold.map((l) => l.unit)).size > 1) return { ...base, outcome: 'mixed_unit', ...empty }
  const total = sold.reduce((sum, l) => sum + l.sold * (l.qty as number), 0)
  const from = sold.map((l) => l.from as string).sort()[0]
  const to = sold.map((l) => l.to as string).sort().at(-1) as string
  return { ...base, outcome: total >= OWN_SALES_MIN ? 'ok' : 'below_min', total, unit: sold[0].unit, from, to }
}

/** 'YYYY-MM-DD' → 'YYYY.MM' */
const monthOf = (date: string) => `${date.slice(0, 4)}.${date.slice(5, 7)}`

/** 화면·프롬프트 값 — outcome ok일 때만. 기간이 한 달이면 그 달만 */
export function ownSalesLine(snapshot: OwnSalesSnapshot | undefined): OwnSalesLine | null {
  if (!snapshot || snapshot.outcome !== 'ok' || snapshot.total === null || !snapshot.unit || !snapshot.from || !snapshot.to) return null
  const from = monthOf(snapshot.from)
  const to = monthOf(snapshot.to)
  return {
    total: `${snapshot.total.toLocaleString('en-US')}${snapshot.unit}`,
    basis: `${from === to ? from : `${from}~${to}`} 쿠팡 누적 판매`,
  }
}
