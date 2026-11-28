/**
 * 자사 리뷰 인용 후보(W2a, PDP-W2W3 계약 v1 §2-1) — 정화한 리뷰에서 후기 섹션 인용 카드로 고를 후보를 뽑는다.
 * - 평점 4~5점을 먼저, 그다음 본문 길이(긴 것)·도움 수 순. 평점이 없는 리뷰는 별점을 보일 수 없어 후보가 아니다.
 *   카드로 쓸 수 없는 글(인용 금지 표현 — 인증·인허가·의학·기능성·최상급·대가성, 정화 표지 '(연락처 삭제)' 등)은 사유(blocked)를 달아 맨 뒤로 보낸다
 *   (빼지는 않는다 — 화면이 흐리게 보이고 고를 수 없게 한다). 사유는 카드에 실릴 글(자른 본문)로 본다 — 카드 단계와 같은 기준.
 * - 같은 본문(정규화 기준)은 한 번만. id는 정규화한 본문의 해시라 같은 파일을 다시 올려도 같다.
 * - 본문은 정화 뒤 글 그대로이고, 150자를 넘으면 그 안의 마지막 문장 끝(없으면 띄어쓰기)에서 자른다. 리뷰어번호는 애초에 없고,
 *   이름은 파서가 가린 꼴(author)만 있다(P1-6).
 * - 요약 표시가 켜지면 자르기 전 본문 전체에서 효익으로 끝나는 문장을 골라 cardSummary에 둔다(2026-11-02). 후보 글(text)·순서·사유는 그대로다.
 */

import { createHash } from 'node:crypto'
import { normalizeReviewText } from './review-sanitize'
import {
  REVIEW_CANDIDATE_LIMIT,
  REVIEW_OPTION_MAX_CHARS,
  REVIEW_QUOTE_MAX_CHARS,
  type ParsedReview,
  type ReviewCandidate,
  type ReviewCandidateBlock,
} from './review-types'
import { clipUtf16, dropLoneSurrogates } from '../text-clip'
import { benefitReviewSentences, quoteBlockReason, summarizeReviewSentences } from '../review-scrubber'
import { REVIEW_SUMMARY_MAX_CHARS, hasRedactionMark } from './review-quote-cards'

/** 너무 짧게 잘리면 인용으로 쓸 수 없다 — 이보다 앞의 문장 끝·띄어쓰기에서는 자르지 않는다 */
const MIN_CLIP_CHARS = 40
/** 문장부호 끝 — 먼저 고른다 */
const PUNCT_END = /[.!?…]+(?=\s|$)/g
/**
 * 문장부호 없이 끝난 말('…좋아요 또 살게요') — 문장부호 끝이 없을 때만 쓴다. 조사 '보다'와 '필요·중요·주요·수요' 같은 낱말,
 * 띄어 쓴 부사 '다'는 문장 끝이 아니다
 */
const KOREAN_END = /(?<=[가-힣])(?<![필중주수])요(?=\s)|(?<=[가-힣])죠(?=\s)|(?<=[가-힣])(?<!보)다(?=\s)/g

/** 상한 안에서 패턴이 끝나는 마지막 자리(MIN_CLIP_CHARS 이상), 없으면 -1 */
function lastEnd(head: string, re: RegExp, max: number): number {
  let cut = -1
  for (const m of head.matchAll(re)) {
    const end = (m.index ?? 0) + m[0].length
    if (end <= max && end >= MIN_CLIP_CHARS) cut = end
  }
  return cut
}

/**
 * 상한 안의 마지막 문장 끝(문장부호 끝 → 문장부호 없는 말끝 → 띄어쓰기 → 상한 순)에서 자른다 — 말을 바꾸지 않고 줄이기만 한다
 */
export function clipQuote(text: string, max = REVIEW_QUOTE_MAX_CHARS): string {
  const clean = dropLoneSurrogates(text.replace(/\s+/g, ' ').trim())
  if (clean.length <= max) return clean
  const head = clean.slice(0, max + 1)
  let cut = lastEnd(head, PUNCT_END, max)
  if (cut < 0) cut = lastEnd(head, KOREAN_END, max)
  if (cut < 0) {
    const space = head.lastIndexOf(' ', max)
    cut = space >= MIN_CLIP_CHARS ? space : max
  }
  return clipUtf16(clean, cut).trim()
}

function candidateId(body: string): string {
  return createHash('sha256').update(normalizeReviewText(body), 'utf8').digest('hex').slice(0, 12)
}

/**
 * 카드로 쓸 수 없는 사유 — 카드 단계(quoteCardHighlights)와 같은 기준을 카드에 실릴 글(자른 본문)로 본다. 요약 표시가 켜지면
 * 한두 문장(70자)으로 줄일 수 없는 글도 카드 단계가 빼므로 '요약'(P1-6)
 */
function blockOf(text: string, summary: boolean): ReviewCandidateBlock | null {
  if (hasRedactionMark(text)) return '정화'
  const reason = quoteBlockReason(text)
  if (reason) return reason
  return summary && !summarizeReviewSentences(text, REVIEW_SUMMARY_MAX_CHARS) ? '요약' : null
}

/** 정화한 자사 리뷰 → 인용 후보(30건 이하) */
export function buildReviewCandidates(
  reviews: readonly ParsedReview[],
  options: { summary?: boolean } = {}
): ReviewCandidate[] {
  const rated = reviews
    .map((r, index) => {
      const body = r.body.replace(/\s+/g, ' ').trim()
      const text = clipQuote(body)
      return { r, index, body, text, blocked: blockOf(text, options.summary === true) }
    })
    .filter(({ r, body }) => typeof r.rating === 'number' && r.rating >= 1 && r.rating <= 5 && body.length > 0)
  rated.sort(
    (a, b) =>
      Number(Boolean(a.blocked)) - Number(Boolean(b.blocked)) ||
      Number((b.r.rating ?? 0) >= 4) - Number((a.r.rating ?? 0) >= 4) ||
      b.body.length - a.body.length ||
      b.r.helped - a.r.helped ||
      a.index - b.index
  )
  const seen = new Set<string>()
  const out: ReviewCandidate[] = []
  for (const { r, body, text, blocked } of rated) {
    const id = candidateId(body)
    if (seen.has(id)) continue
    seen.add(id)
    const option = clipUtf16(r.option.trim(), REVIEW_OPTION_MAX_CHARS)
    const cardSummary = options.summary === true && !blocked ? benefitReviewSentences(body, REVIEW_SUMMARY_MAX_CHARS) : null
    out.push({
      id,
      text,
      rating: Math.round(r.rating as number),
      ...(option ? { option } : {}),
      ...(r.month ? { month: r.month } : {}),
      ...(r.author ? { author: r.author } : {}),
      ...(cardSummary ? { cardSummary } : {}),
      ...(blocked ? { blocked } : {}),
    })
    if (out.length >= REVIEW_CANDIDATE_LIMIT) break
  }
  return out
}
