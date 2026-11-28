/**
 * spec_sheet.competitorReviews 읽기 — 잡 생성 입력은 사용자 JSON이므로 모양을 다시 확인하고 상한을 다시 건다.
 * 엑셀 파서(xlsx)에 기대지 않는 가벼운 모듈이다(파이프라인이 쓴다).
 */

import type { PdpSpecSheet } from '../pdp-state'
import { serializeReviews } from './review-sample'
import {
  COMPETITOR_SAMPLE_LIMIT,
  COMPETITOR_TEXT_MAX_CHARS,
  REVIEW_BODY_MAX_CHARS,
  REVIEW_TITLE_MAX_CHARS,
  type CompetitorReviewItem,
  type CompetitorReviews,
  type ReviewStats,
  type SampledReview,
} from './review-types'

/** 경쟁사 콜 직렬화 상한 — 항목 본문·제목 합계 상한에 머리말·번호 줄 몫을 더한 값 */
const COMPETITOR_SERIALIZE_MAX_CHARS = COMPETITOR_TEXT_MAX_CHARS + 4_000

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0
}

function readStats(v: unknown): ReviewStats {
  const s = isObject(v) ? v : {}
  const counts: Record<string, number> = {}
  if (isObject(s.rating_counts)) {
    for (const k of ['1', '2', '3', '4', '5'])
      if (toCount(s.rating_counts[k]) > 0) counts[k] = toCount(s.rating_counts[k])
  }
  return { total_rows: toCount(s.total_rows), text_review_count: toCount(s.text_review_count), rating_counts: counts }
}

function readNames(v: unknown): string[] {
  return Array.isArray(v)
    ? v
        .filter((n): n is string => typeof n === 'string')
        .map((n) => n.trim())
        .filter((n) => n.length >= 2)
    : []
}

function readItem(v: unknown): CompetitorReviewItem | null {
  if (!isObject(v) || typeof v.body !== 'string' || !v.body.trim()) return null
  const id = toCount(v.id)
  if (id < 1) return null
  const rating = typeof v.rating === 'number' && v.rating >= 1 && v.rating <= 5 ? Math.trunc(v.rating) : null
  return {
    id,
    rating,
    helped: toCount(v.helped),
    title: typeof v.title === 'string' ? v.title.slice(0, REVIEW_TITLE_MAX_CHARS) : '',
    body: v.body.slice(0, REVIEW_BODY_MAX_CHARS),
  }
}

/**
 * 경쟁사 항목 상한 — 본문·제목을 자르고, 합계가 상한을 넘기 전까지만 싣는다(id는 표집 순서 그대로 1..n).
 * 오너가 올린 엑셀(review-intake.ts)과 수집 리뷰(collected-reviews.ts)가 같은 상한을 쓴다
 */
export function capCompetitorItems(sampled: SampledReview[]): CompetitorReviewItem[] {
  const items: CompetitorReviewItem[] = []
  let used = 0
  for (const r of sampled) {
    const title = r.title.slice(0, REVIEW_TITLE_MAX_CHARS)
    const body = r.body.slice(0, REVIEW_BODY_MAX_CHARS)
    if (used + title.length + body.length > COMPETITOR_TEXT_MAX_CHARS) break
    used += title.length + body.length
    items.push({ id: r.id, rating: r.rating, helped: r.helped, title, body })
  }
  return items
}

/** 경쟁사 리뷰가 있으면 정규화한 값, 없거나 모양이 틀리면 null */
export function readCompetitorReviews(spec: PdpSpecSheet): CompetitorReviews | null {
  const raw = (spec as { competitorReviews?: unknown }).competitorReviews
  if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.items)) return null
  const items: CompetitorReviewItem[] = []
  const ids = new Set<number>()
  let used = 0
  for (const v of raw.items.slice(0, COMPETITOR_SAMPLE_LIMIT)) {
    const item = readItem(v)
    if (!item || ids.has(item.id)) continue
    if (used + item.title.length + item.body.length > COMPETITOR_TEXT_MAX_CHARS) break
    used += item.title.length + item.body.length
    ids.add(item.id)
    items.push(item)
  }
  if (items.length === 0) return null
  return {
    version: 1,
    fileName: typeof raw.fileName === 'string' ? raw.fileName : '',
    stats: readStats(raw.stats),
    dropped: toCount(raw.dropped),
    items,
    removedNames: readNames(raw.removedNames),
    checkNames: readNames(raw.checkNames),
  }
}

/** 경쟁사 분석 콜에만 넣는 텍스트 — 옵션 없이 [리뷰N] 번호로 */
export function serializeCompetitorReviews(reviews: CompetitorReviews): string {
  return serializeReviews(
    reviews.items.map((it) => ({ ...it, option: '' })),
    reviews.stats,
    COMPETITOR_SERIALIZE_MAX_CHARS,
    { withOption: false }
  )
}
