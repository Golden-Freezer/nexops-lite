/**
 * Wing 비즈니스 인사이트 응답 원문 착지 (J08, 확장 1.17.21).
 *
 * 확장이 화면이 스스로 부른 응답(직접 호출 아님)을 엔드포인트·기간·파라미터와 함께 보낸다 → wing_insight_raw.
 * 모양이 확인된 것만 따로 풀어 저장한다: category-insight/items 중 기간 180일 이상 → wing_rank_history.
 * (brands·by-item-id·date-wise 등은 이번엔 원문만 — 파서는 응답 모양을 원문 표에서 확인한 뒤)
 *
 * 서버 쪽에서도 확장과 같은 방어를 다시 한다: 허용 엔드포인트, 비밀 키 제거, 응답 크기 상한, 기간 검증.
 * 표/칸 이름은 supabase/migrations/20261103123000_wing_insight_raw_rank_history.sql.
 */

/** 확장 wing-insight-harvest.js LANDING 목록과 같다 (src/lib/extension/wing-insight-harvest.test.ts가 같은지 확인) */
export const RAW_ENDPOINTS = [
  'category-insight/items',
  'category-insight/items/date-wise',
  'category-insight/keywords',
  'category-insight/keywords/date-wise',
  'category-insight/brands',
  'category-insight/brands/date-wise',
  'category-insight/metric',
  'category-insight/metric/date-wise',
  'brand-insight/items/by-brand-name',
  'business-insight/keywords/by-item-id',
  'business-insight/keywords/category-keyword-summary',
  'business-insight/keywords/items',
  'business-insight/keywords/items/date-wise',
  'business-insight/item-winner',
] as const

/** 응답 JSON 글자 수 상한 — 확장과 같다 (넘으면 거절) */
export const RAW_MAX_CHARS = 2_000_000
/** 한 번 요청의 항목 수 상한 */
export const RAW_MAX_ITEMS = 40
/** 이 기간(포함 일수) 이상의 상품 목록은 wing_rank_history로 풀어 저장 */
export const RANK_HISTORY_MIN_DAYS = 180
/**
 * market_insights에 '30일 스냅샷'으로 저장하는 기간(포함 일수). Wing 30일 프리셋=30일, 확장 기본(오늘-30~오늘)=31일.
 * 이 밖의 기간(7·60·90·180·360일)은 읽는 쪽 10여 곳이 30일로 가정하고 카테고리별 최신 회차를 고르므로 섞이지 않게
 * market_insights에는 넣지 않고 원문 착지(wing_insight_raw)·순위 이력(wing_rank_history)으로만 남긴다. (확장 wing-insight-harvest.js와 같다)
 */
export const SNAPSHOT_MIN_DAYS = 28
export const SNAPSHOT_MAX_DAYS = 32

export function isSnapshotPeriodDays(days: number): boolean {
  return days >= SNAPSHOT_MIN_DAYS && days <= SNAPSHOT_MAX_DAYS
}

const SECRET_KEY_RE = /token|auth|xsrf|csrf|cookie|secret|passw|pwd|session|credential|signature|api.?key|bearer|jwt/i
const JWT_LIKE_RE = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export interface WingInsightRawRow {
  /** 착지 직전 만든 uuid(route) 또는 읽어 온 행 id — 풀어 저장한 표의 source_raw_id */
  id?: string
  user_id: string
  business_id: string | null
  endpoint: string
  category_code: number | null
  keyword: string | null
  period_start: string | null
  period_end: string | null
  period_days: number | null
  params: Record<string, unknown>
  response: unknown
  collected_at: string
}

export interface WingRankHistoryRow {
  user_id: string
  category_code: number
  period_start: string
  period_end: string
  rank: number
  item_id: number | null
  product_id: number | null
  vendor_item_id: number | null
  product_name: string | null
  price: number | null
  rating_count: number | null
  metrics: Record<string, unknown>
  collected_at: string
}

export interface RawRejection {
  index: number
  reason: string
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function str(v: unknown): string | null {
  if (v == null) return null
  const s = typeof v === 'string' ? v : String(v)
  return s === '' ? null : s
}

function cleanValue(v: unknown, depth: number): Json | undefined {
  if (v == null) return undefined
  if (typeof v === 'string') {
    if (JWT_LIKE_RE.test(v)) return undefined
    return v.length > 200 ? v.slice(0, 200) : v
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) {
    const out: Json[] = []
    for (const x of v.slice(0, 50)) {
      const c = cleanValue(x, depth + 1)
      if (c !== undefined) out.push(c)
    }
    return out
  }
  if (isRecord(v) && depth < 2) return sanitizeParams(v, depth + 1) as Json
  return undefined
}

/** 파라미터에서 비밀 키(토큰·쿠키·인증 등)와 JWT 모양 값을 뺀 사본. 긴 문자열 200자, 배열 50개까지 */
export function sanitizeParams(src: unknown, depth = 0): Record<string, Json> {
  const out: Record<string, Json> = {}
  if (!isRecord(src)) return out
  for (const k of Object.keys(src)) {
    if (SECRET_KEY_RE.test(k)) continue
    const c = cleanValue(src[k], depth)
    if (c !== undefined) out[k] = c
  }
  return out
}

/** 'YYYY-MM-DD' → 날짜 번호. 달력에 없는 날(2026-13-40 등)은 NaN */
function dayNumber(s: string): number {
  const [y, m, d] = s.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d)
  const back = new Date(t)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return Number.NaN
  return Math.floor(t / DAY_MS)
}

/** 'YYYY-MM-DD' 두 개가 올바르고 끝 ≥ 시작이면 포함 일수, 아니면 null */
export function periodDaysOf(start: unknown, end: unknown): number | null {
  if (typeof start !== 'string' || typeof end !== 'string') return null
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) return null
  const a = dayNumber(start)
  const b = dayNumber(end)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  return b - a + 1
}

function toIso(v: unknown, fallback: string): string {
  if (typeof v === 'string') {
    const t = Date.parse(v)
    if (Number.isFinite(t)) return new Date(t).toISOString()
  }
  return fallback
}

export interface NormalizedRaw {
  rows: WingInsightRawRow[]
  rejected: RawRejection[]
}

/** 요청 본문 items를 표 행으로. 거절 사유는 항목 순번과 함께 돌려준다(전체를 실패시키지 않는다). */
export function normalizeRawItems(userId: string, body: unknown, now: Date = new Date()): NormalizedRaw {
  const rows: WingInsightRawRow[] = []
  const rejected: RawRejection[] = []
  const items = isRecord(body) && Array.isArray(body.items) ? body.items : null
  if (!items) return { rows, rejected: [{ index: -1, reason: 'ITEMS_REQUIRED' }] }
  const fallbackIso = now.toISOString()

  items.slice(0, RAW_MAX_ITEMS).forEach((raw, index) => {
    if (!isRecord(raw)) {
      rejected.push({ index, reason: 'NOT_OBJECT' })
      return
    }
    const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint : ''
    if (!(RAW_ENDPOINTS as readonly string[]).includes(endpoint)) {
      rejected.push({ index, reason: 'ENDPOINT_NOT_ALLOWED' })
      return
    }
    const response = raw.response
    const emptyResponse =
      response == null ||
      (Array.isArray(response) && response.length === 0) ||
      (isRecord(response) && Object.keys(response).length === 0)
    if (emptyResponse || typeof response !== 'object') {
      rejected.push({ index, reason: 'EMPTY_RESPONSE' })
      return
    }
    let size = 0
    try {
      size = JSON.stringify(response).length
    } catch {
      rejected.push({ index, reason: 'NOT_SERIALIZABLE' })
      return
    }
    if (size > RAW_MAX_CHARS) {
      rejected.push({ index, reason: 'TOO_LARGE' })
      return
    }

    const periodStart = typeof raw.periodStart === 'string' && DATE_RE.test(raw.periodStart) ? raw.periodStart : null
    const periodEnd = typeof raw.periodEnd === 'string' && DATE_RE.test(raw.periodEnd) ? raw.periodEnd : null
    const days = periodDaysOf(periodStart, periodEnd)
    // 날짜가 서로 맞지 않으면 기간 칸을 모두 비운다(일수만 믿고 저장하지 않는다)
    const validPeriod = days != null

    const category = num(raw.categoryCode)
    rows.push({
      user_id: userId,
      business_id: typeof raw.businessId === 'string' && raw.businessId ? raw.businessId : null,
      endpoint,
      category_code: category != null && Number.isInteger(category) ? category : null,
      keyword: str(raw.keyword),
      period_start: validPeriod ? periodStart : null,
      period_end: validPeriod ? periodEnd : null,
      period_days: validPeriod ? days : null,
      params: sanitizeParams(raw.params),
      response,
      collected_at: toIso(raw.collectedAt, fallbackIso),
    })
  })
  return { rows, rejected }
}

/** 글자 수 합계 상한으로 행을 나눈다(PostgREST 한 번 요청이 너무 커지지 않게) */
export function chunkRowsBySize<T extends { response: unknown }>(rows: T[], maxChars: number): T[][] {
  const chunks: T[][] = []
  let cur: T[] = []
  let sum = 0
  for (const r of rows) {
    let s = 0
    try {
      s = JSON.stringify(r.response).length
    } catch {
      s = 0
    }
    if (cur.length > 0 && sum + s > maxChars) {
      chunks.push(cur)
      cur = []
      sum = 0
    }
    cur.push(r)
    sum += s
  }
  if (cur.length > 0) chunks.push(cur)
  return chunks
}

export function unwrapList(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v.filter(isRecord)
  if (isRecord(v)) {
    for (const k of ['data', 'result', 'items', 'content', 'list', 'records']) {
      const inner = v[k]
      if (Array.isArray(inner)) return inner.filter(isRecord)
    }
  }
  return []
}

/**
 * category-insight/items 원문 중 기간 180일 이상인 것을 순위 이력 행으로 푼다. 아니면 빈 배열.
 * 응답 모양(2026-04 실측, P0 표): { itemDetail: { rank, itemId, avgPrice, ... }, metricsDetail: { srpClicks, glanceView, impression, ... } }
 */
export function buildRankHistoryRows(raw: WingInsightRawRow): WingRankHistoryRow[] {
  if (raw.endpoint !== 'category-insight/items') return []
  if (raw.category_code == null || !raw.period_start || !raw.period_end) return []
  if ((raw.period_days ?? 0) < RANK_HISTORY_MIN_DAYS) return []

  const list = unwrapList(raw.response)
  const out: WingRankHistoryRow[] = []
  const seenRank = new Set<number>()
  list.forEach((item, idx) => {
    const detail = isRecord(item.itemDetail) ? item.itemDetail : {}
    const metrics = isRecord(item.metricsDetail) ? item.metricsDetail : isRecord(item.metrics) ? item.metrics : {}
    const rank = num(detail.rank) ?? idx + 1
    if (!Number.isInteger(rank) || rank <= 0 || seenRank.has(rank)) return
    seenRank.add(rank)
    const price = num(detail.avgPrice ?? detail.price ?? detail.salePrice)
    out.push({
      user_id: raw.user_id,
      category_code: raw.category_code as number,
      period_start: raw.period_start as string,
      period_end: raw.period_end as string,
      rank,
      item_id: num(detail.itemId ?? item.itemId),
      product_id: num(detail.productId),
      vendor_item_id: num(detail.vendorItemId),
      product_name: str(detail.productName ?? detail.itemName),
      price: price == null ? null : Math.round(price),
      rating_count: num(detail.ratingCount ?? detail.reviewCount),
      // 지표 원값 + 상품 상세에서 순위 해석에 쓸 칸(출시일·내 상품 여부)을 함께 남긴다
      metrics: {
        ...metrics,
        ...(detail.launchDate != null ? { launchDate: detail.launchDate } : {}),
        ...(detail.isBelongToVendor != null ? { isBelongToVendor: detail.isBelongToVendor } : {}),
      },
      collected_at: raw.collected_at,
    })
  })
  return out
}

/** 표가 아직 없을 때(마이그레이션 적용 전)의 오류인가 — Postgres 42P01 · PostgREST PGRST205 */
export function isMissingTableError(
  error: { code?: string; message?: string } | null | undefined,
  table: string,
): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return /does not exist|Could not find the table/i.test(error.message ?? '') && (error.message ?? '').includes(table)
}

/** market_insights에 새 기간 칸이 아직 없을 때(마이그레이션 적용 전)의 오류인가 */
export function isMissingPeriodColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const message = error.message ?? ''
  const columnError =
    error.code === '42703' || error.code === 'PGRST204' || /does not exist|Could not find the .* column/i.test(message)
  return columnError && /period_(start|end|days)/.test(message)
}
