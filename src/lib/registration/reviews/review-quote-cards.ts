/**
 * 후기 섹션 인용 카드(W2b, PDP-W2W3 계약 v1 §3) — 오너가 고른 자사 리뷰 카드(spec_sheet.reviewQuotes)가 있으면 후기 섹션 인용은
 * 그 카드 글만 쓴다. 바꿔 쓰지 않고, 강조 조각(highlights)과 평점을 그대로 넘긴다(렌더러가 배지·별점으로 그린다).
 * 다음 카드는 뺀다 — 표시광고법 인용 금지 표현(인증·인허가·의학·기능성 — 규제 사전, 최상급·대가성 — review-scrubber isQuoteSafe), 정화 표지('(연락처 삭제)' 등 —
 * 기존 발췌 경로 validateReviewQuotes와 같은 기준). 옵션명은 넘기지 않는다(렌더러가 쓰지 않고, 연령 검수가 옵션 색 이름에 오탐한다).
 * 카드가 없으면 null(기존 경로).
 *
 * 후기 요약(P1-6, 오너 지시 2026-10-31 — 실제 리뷰를 쓰되 닉네임은 가리고 내용은 요약으로):
 * - 작성자는 가린 꼴('김**')만 쓰고, 없으면 '구매고객'이다(이름을 지어내지 않는다). 작성 월은 고른 카드에 있을 때만 넘긴다.
 * - 요약 표시가 켜지면(기본 on) 글을 원문 문장 1~2개(70자 이내, summarizeReviewSentences)로 바꾸고 원문을 함께 넘긴다(편집기 대조).
 *   문장을 자르거나 고쳐 쓰지 않으므로, 70자 안에 들어오는 쓸 수 있는 문장이 없는 카드는 뺀다.
 * - 후보를 만들 때 본문 전체에서 고른 문장(cardSummary)이 있으면 그 문장을 쓴다(2026-11-02). 같은 검사를 다시 거쳐 통과하지 못하면 글(text)에서 고른다.
 *   그 문장은 150자로 자른 글에 없을 수 있어, 원문(original)은 옵션 찾기 열쇠인 글(text) 그대로다.
 */

import { isHostedPdpEnv } from '../enrichment-switch'
import { isQuoteSafe, summarizeReviewSentences } from '../review-scrubber'
import { REVIEW_SUMMARY_MAX_CHARS, type ReviewQuote } from './review-types'

export { REVIEW_SUMMARY_MAX_CHARS }

/**
 * 후기 요약 표시 스위치(P1-6) — 기본 on(오너가 요청한 표시 방식, 통합 결정 2026-10-31). 로컬 실행(짝 회차 대조군)에서만
 * NEXOPS_PDP_REVIEW_SUMMARY=off로 끈다. Vercel 환경 표지에서는 무시한다. 카피 단계가 읽어 카드 데이터(summary)에 남기므로 한 잡
 * 안에서 섞이지 않고, 이미 만든 잡의 표시는 바뀌지 않는다
 */
export function reviewSummaryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !(env.NEXOPS_PDP_REVIEW_SUMMARY?.trim().toLowerCase() === 'off' && !isHostedPdpEnv(env))
}

/**
 * 정화 표지가 남은 글 — '(연락처 삭제)' 등. 인용 후보는 150자에서 잘리므로 표지 중간에서 잘린 '…(연락처'처럼 끝에 닫히지 않은 괄호도
 * 표지로 본다(인용 후보 사유 '정화'와 같은 기준 — review-candidates)
 */
const DELETED_MARK = /\([^)]*삭제\)|\([^)]*$/

export function hasRedactionMark(text: string): boolean {
  return DELETED_MARK.test(text ?? '')
}

export interface QuoteCardHighlight {
  text: string
  /** 가린 작성자('김**') — 없으면 '구매고객' */
  author: string
  rating: number
  highlights?: string[]
  /** 작성 월('YYYY.MM') — 고른 카드에 있을 때만 */
  month?: string
  /** 후기 요약이면 true — 카드에 '후기 요약'으로 표기한다 */
  summary?: true
  /** 요약이면 원문(대조용 — 편집기·검사. 옵션 찾기도 이 글로 한다) */
  original?: string
}

/** dropped = 인용 금지 표현·정화 표지로 뺀 카드, unsummarized = 요약 표시가 켜졌는데 쓸 수 있는 요약 문장이 없어 뺀 카드 */
export function quoteCardHighlights(
  quotes: readonly ReviewQuote[] | undefined,
  options: { summary?: boolean } = {}
): { highlights: QuoteCardHighlight[]; dropped: number; unsummarized: number } | null {
  if (!quotes?.length) return null
  const safe = quotes.filter((q) => isQuoteSafe(q.text) && !hasRedactionMark(q.text))
  const highlights: QuoteCardHighlight[] = []
  let unsummarized = 0
  for (const q of safe) {
    const base = { author: q.author ?? '구매고객', rating: q.rating, ...(q.month ? { month: q.month } : {}) }
    if (!options.summary) {
      highlights.push({ text: q.text, ...base, ...(q.highlights?.length ? { highlights: [...q.highlights] } : {}) })
      continue
    }
    const fromBody = q.cardSummary ? summarizeReviewSentences(q.cardSummary, REVIEW_SUMMARY_MAX_CHARS) : null
    const summary = fromBody ?? summarizeReviewSentences(q.text, REVIEW_SUMMARY_MAX_CHARS)
    if (!summary) {
      unsummarized += 1
      continue
    }
    // 이미 한두 문장이면 원문 그대로 — '후기 요약'으로 표기하지 않는다
    if (summary === q.text.replace(/\s+/g, ' ').trim()) {
      highlights.push({ text: q.text, ...base, ...(q.highlights?.length ? { highlights: [...q.highlights] } : {}) })
      continue
    }
    // 강조 조각은 요약에 남은 것만
    const kept = (q.highlights ?? []).filter((h) => summary.includes(h))
    highlights.push({
      text: summary,
      ...base,
      ...(kept.length ? { highlights: kept } : {}),
      summary: true,
      original: q.text,
    })
  }
  return { highlights, dropped: quotes.length - safe.length, unsummarized }
}
