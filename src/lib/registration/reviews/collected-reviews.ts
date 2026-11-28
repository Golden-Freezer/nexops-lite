/**
 * 수집 리뷰 → spec_sheet.competitorReviews(오너 승인 2026-11-05, ops-lead 전달) — 잡 생성(POST /api/registration/pdp) 때 한 번 읽어 스냅숏한다.
 * - 읽기만: competitor_reviews에서 user_id = 잡 사용자, 상품마다 최신순 최대 1,500행(파이프라인은 기다리지 않는다).
 * - 표집은 오너가 올린 엑셀과 같은 길: 정화(sanitizeReviews) → 별점 층 표집(60건) → 본문 300자·합 10,000자(capCompetitorItems).
 *   별점 분포(stats)는 읽은 행 전부로 센다. 옵션은 싣지 않는다(상품·브랜드 이름이 섞이기 쉽다 — 엑셀 경쟁사와 같은 규칙).
 * - 엑셀 경쟁사 파일이 있으면 그쪽만 쓰고 수집 리뷰를 읽지 않는다(둘을 섞지 않는다).
 * - 쓴 상품 번호·행 수·collected_at은 spec_sheet.reviewSourceSnapshot에 남긴다. 표가 없거나 읽지 못해도 잡 생성은 이어 간다(unavailable).
 * 소구점 분석 전용 규칙(카피에 원문을 쓰지 않음)은 competitorReviews를 읽는 쪽이 그대로 지킨다.
 * 표 칸 정본: supabase/migrations/20261104180000_competitor_reviews.sql(DB 타입 파일에 아직 없다).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingTableError } from '@/lib/market-insight/raw-landing'
import type { PdpSpecSheet } from '../pdp-state'
import { capCompetitorItems } from './competitor-reviews'
import { sanitizeReviews } from './review-sanitize'
import { sampleReviews } from './review-sample'
import { normalizeReviewSourceProductIds, type ReviewSourceSnapshot } from './review-source'
import { COMPETITOR_SAMPLE_LIMIT, type CompetitorReviews, type ParsedReview, type ReviewStats } from './review-types'

export const COLLECTED_REVIEWS_TABLE = 'competitor_reviews'
/** 상품당 읽는 행 상한(최신순) */
export const COLLECTED_REVIEWS_PER_PRODUCT = 1_500
/** 한 번에 받는 행 — PostgREST 기본 최대 1,000행이라 나눠 받는다 */
const PAGE_ROWS = 1_000
const ERROR_MAX = 200

export interface CollectedReviewRow {
  rating: number | null
  title: string | null
  content: string | null
  helpful_count: number | null
  collected_at: string | null
}

export type CollectedRowsResult =
  | { ok: true; rows: Map<string, CollectedReviewRow[]> }
  | { ok: false; reason: 'TABLE_MISSING' | 'ERROR'; message: string }

/** 상품마다 최신순(작성 시각, 모르면 뒤) 최대 1,500행 — user_id 격리. 순서가 흔들리지 않게 id를 둘째 순서로 둔다 */
export async function loadCollectedReviewRows(db: SupabaseClient, userId: string, productIds: readonly string[]): Promise<CollectedRowsResult> {
  const rows = new Map<string, CollectedReviewRow[]>()
  for (const productId of productIds) {
    const got: CollectedReviewRow[] = []
    while (got.length < COLLECTED_REVIEWS_PER_PRODUCT) {
      const from = got.length
      const to = Math.min(from + PAGE_ROWS, COLLECTED_REVIEWS_PER_PRODUCT) - 1
      const { data, error } = await db
        .from(COLLECTED_REVIEWS_TABLE)
        .select('rating, title, content, helpful_count, collected_at')
        .eq('user_id', userId)
        .eq('product_id', productId)
        .order('reviewed_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true })
        .range(from, to)
      if (error) {
        const message = (error.message ?? '').slice(0, ERROR_MAX)
        return isMissingTableError(error, COLLECTED_REVIEWS_TABLE) ? { ok: false, reason: 'TABLE_MISSING', message } : { ok: false, reason: 'ERROR', message }
      }
      const page = (data ?? []) as CollectedReviewRow[]
      got.push(...page)
      if (page.length < to - from + 1) break
    }
    rows.set(productId, got)
  }
  return { ok: true, rows }
}

function statsOf(rows: readonly CollectedReviewRow[]): ReviewStats {
  const ratingCounts: Record<string, number> = {}
  let text = 0
  for (const r of rows) {
    if (typeof r.rating === 'number' && r.rating >= 1 && r.rating <= 5) {
      const key = String(Math.trunc(r.rating))
      ratingCounts[key] = (ratingCounts[key] ?? 0) + 1
    }
    if (r.content?.trim()) text += 1
  }
  return { total_rows: rows.length, text_review_count: text, rating_counts: ratingCounts }
}

/** 읽은 행 → competitorReviews(엑셀 경쟁사와 같은 표집·상한). 쓸 본문이 없으면 null */
export function buildCollectedCompetitorReviews(productIds: readonly string[], rows: ReadonlyMap<string, readonly CollectedReviewRow[]>): CompetitorReviews | null {
  const all = productIds.flatMap((id) => rows.get(id) ?? [])
  const parsed: ParsedReview[] = all
    .filter((r) => r.content?.trim())
    .map((r) => ({
      rating: typeof r.rating === 'number' && r.rating >= 1 && r.rating <= 5 ? Math.trunc(r.rating) : null,
      title: r.title ?? '',
      body: r.content ?? '',
      option: '',
      helped: typeof r.helpful_count === 'number' && r.helpful_count > 0 ? Math.trunc(r.helpful_count) : 0,
    }))
  const { reviews, dropped } = sanitizeReviews(parsed)
  const items = capCompetitorItems(sampleReviews(reviews, COMPETITOR_SAMPLE_LIMIT))
  if (items.length === 0) return null
  return {
    version: 1,
    fileName: `쿠팡 수집 리뷰(상품 ${productIds.join('·')})`,
    stats: statsOf(all),
    dropped,
    items,
    // 판매자명·상품명이 표에 없어 지울 이름이 없다
    removedNames: [],
    checkNames: [],
    origin: 'collected',
  }
}

const latest = (rows: readonly CollectedReviewRow[]): string | null =>
  rows.reduce<string | null>((max, r) => (r.collected_at && (!max || Date.parse(r.collected_at) > Date.parse(max)) ? r.collected_at : max), null)

/** 오너가 올린 엑셀 경쟁사 리뷰인가 — 수집으로 채운 값(origin collected)은 아니다 */
function hasExcelCompetitorReviews(spec: PdpSpecSheet): boolean {
  const raw = (spec as { competitorReviews?: unknown }).competitorReviews
  return typeof raw === 'object' && raw !== null && (raw as { origin?: unknown }).origin !== 'collected'
}

/**
 * 잡 생성 전 spec 정리 — 상품 번호가 있으면 수집 리뷰를 읽어 competitorReviews·reviewSourceSnapshot을 채운다.
 * 두 칸이 모두 없으면 같은 객체를 그대로 돌려준다(기존 잡 입력 불변). 입력의 reviewSourceSnapshot은 버린다(서버만 쓴다)
 */
export async function attachCollectedReviews(db: SupabaseClient, userId: string, spec: PdpSpecSheet, now: Date): Promise<PdpSpecSheet> {
  if (!('reviewSourceProductIds' in spec) && !('reviewSourceSnapshot' in spec)) return spec
  const { reviewSourceProductIds, reviewSourceSnapshot: _ignored, ...rest } = spec
  void _ignored
  const ids = normalizeReviewSourceProductIds(reviewSourceProductIds)
  if (ids.length === 0) return rest
  const at = now.toISOString()
  const out: PdpSpecSheet = { ...rest, reviewSourceProductIds: ids }
  if (hasExcelCompetitorReviews(rest)) {
    out.reviewSourceSnapshot = { version: 1, at, outcome: 'excel', products: ids.map((productId) => ({ productId, rows: null, collectedAt: null })), sampled: 0 }
    return out
  }
  // 앞 잡에서 옮겨 온 수집 값은 지금 다시 읽는다
  delete out.competitorReviews
  const loaded = await loadCollectedReviewRows(db, userId, ids)
  if (!loaded.ok) {
    console.error(`registration pdp: 수집 리뷰를 읽지 못함(${loaded.reason}) — 리뷰 없이 잡을 만든다: ${loaded.message}`)
    out.reviewSourceSnapshot = {
      version: 1,
      at,
      outcome: 'unavailable',
      products: ids.map((productId) => ({ productId, rows: null, collectedAt: null })),
      sampled: 0,
      error: loaded.reason === 'TABLE_MISSING' ? `${COLLECTED_REVIEWS_TABLE} 표 없음` : loaded.message,
    }
    return out
  }
  const reviews = buildCollectedCompetitorReviews(ids, loaded.rows)
  const snapshot: ReviewSourceSnapshot = {
    version: 1,
    at,
    outcome: reviews ? 'collected' : 'empty',
    products: ids.map((productId) => {
      const rows = loaded.rows.get(productId) ?? []
      return { productId, rows: rows.length, collectedAt: latest(rows) }
    }),
    sampled: reviews?.items.length ?? 0,
  }
  if (reviews) out.competitorReviews = reviews
  out.reviewSourceSnapshot = snapshot
  return out
}
