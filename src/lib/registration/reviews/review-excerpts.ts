// 후기 발췌 카드(Track S '실제 구매 후기' 경로 — 오너가 인용 카드를 고르지 않은 잡, P1-6 커밋 B, 통합 결정 2026-10-31).
// LLM이 고른 발췌(validateReviewQuotes)나 결정적 폴백 발췌를 마무리한다.
//
// - 규칙(늘): 자사 리뷰 파일 직렬화 텍스트에서 발췌의 출처 리뷰를 찾으면 그 리뷰의 원본 평점·작성 월·가린 작성자를 붙인다. 못 찾으면
//   평점·작성 월 없이 '구매고객'이다(평점·이름을 지어내지 않는다). 붙여 넣은 원문은 리뷰 경계를 알 수 없어 찾지 않는다.
// - 후기 요약(스위치 기본 on, review-quote-cards reviewSummaryEnabled): 발췌를 자르지 않고(예전 60자 자르기는 문장 가운데서 끊었다)
//   원문 문장 1~2개(70자, summarizeReviewSentences)로 다시 고른다. 고를 문장이 없으면 그 발췌는 뺀다. 출처 리뷰보다 짧으면
//   '후기 요약'으로 표기하고 원문(출처 리뷰 본문)을 남긴다.
// - 별점(2026-11-02, R17 P06): 출처 리뷰의 별점을 알고 3점 이하면 싣지 않는다. 붙여 넣은 원문은 별점을 알 수 없어 그대로다.

import { reviewSentences, summarizeReviewSentences, type ReviewQuote } from '../review-scrubber'
import { REVIEW_SUMMARY_MAX_CHARS } from './review-quote-cards'
import { REVIEW_QUOTE_MIN_RATING, isLowRating } from './review-types'

export interface SerializedReview {
  rating: number | null
  /** 작성 월('YYYY.MM') — 직렬화 메타에 있을 때만 */
  month?: string
  /** 가린 작성자('김**') — 직렬화 메타에 있을 때만 */
  author?: string
  helped: number
  title: string
  body: string
}

export interface ExcerptHighlight {
  text: string
  author: string
  rating?: number
  month?: string
  summary?: true
  original?: string
}

const META_LINE_RE = /^\[리뷰\d+\] 평점 (?:(\d)\/5|평점없음) · 도움 (\d+)(.*)$/
const MONTH_IN_META_RE = / · 작성 (\d{4}\.\d{2})(?= ·|$)/
const AUTHOR_IN_META_RE = / · 작성자 (\S+?)(?= ·|$)/
const MASKED_RE = /^[^*\s]\*{1,3}$/u

/** 자사 리뷰 파일 직렬화(reviews/review-sample serializeReviews) → 리뷰 목록. 형식이 아니면 빈 목록 */
export function parseSerializedReviewList(text: string): SerializedReview[] {
  const out: SerializedReview[] = []
  let current: SerializedReview | null = null
  // CRLF로 붙여 넣은 텍스트도 같은 리뷰로 읽는다
  for (const line of (text ?? '').split(/\r?\n/)) {
    const meta = META_LINE_RE.exec(line)
    if (meta) {
      const month = MONTH_IN_META_RE.exec(meta[3])?.[1]
      const author = AUTHOR_IN_META_RE.exec(meta[3])?.[1]
      current = {
        rating: meta[1] ? Number(meta[1]) : null,
        helped: Number(meta[2]),
        title: '',
        body: '',
        ...(month ? { month } : {}),
        // 직렬화된 작성자도 가린 꼴만 받는다 — 손으로 고친 텍스트의 원래 이름이 카드에 실리지 않게
        ...(author && MASKED_RE.test(author) ? { author } : {}),
      }
      out.push(current)
    } else if (current && line.startsWith('제목: ')) current.title = line.slice(4)
    else if (current && line.startsWith('내용: ')) current.body = line.slice(4)
  }
  return out.filter((r) => r.body)
}

const compact = (text: string) => (text ?? '').replace(/[\s.,!?~…'"‘’“”·]+/g, '')

/** 발췌가 든 리뷰(제목·본문에 공백·문장부호를 빼고 들어 있으면) — 없으면 undefined */
export function sourceReviewOf(text: string, reviews: readonly SerializedReview[]): SerializedReview | undefined {
  const key = compact(text)
  if (key.length < 6) return undefined
  return reviews.find((r) => compact(r.body).includes(key) || compact(r.title).includes(key))
}

/** 출처 후기의 별점을 알고 그 값이 낮으면 참 — 붙여 넣은 원문은 별점을 알 수 없어 거짓 */
export function fromLowRatedReview(quote: string, reviews: readonly SerializedReview[]): boolean {
  return isLowRating(sourceReviewOf(quote, reviews)?.rating)
}

/** 모델 후보에서 별점 낮은 후기의 문장을 뺀다 — 원문 대조 상한(3건) 전에 빼서 다음 후보가 자리를 잇는다. 낮은 후보가 없으면 후보 그대로다 */
export function withoutLowRatedExcerpts(candidates: readonly unknown[], reviewsText: string): { kept: unknown[]; lowRated: number } {
  const reviews = parseSerializedReviewList(reviewsText)
  const kept = candidates.filter((c) => {
    const text = typeof c === 'string' ? c : (c as { text?: unknown } | null)?.text
    return !(typeof text === 'string' && fromLowRatedReview(text, reviews))
  })
  return { kept, lowRated: candidates.length - kept.length }
}

/**
 * 요약 폴백 — LLM 발췌가 하나도 남지 않았을 때. 직렬화 텍스트면 고평점(4~5)·도움 수 순(원본 폴백 랭킹)으로 리뷰마다 원문 문장 1~2개
 * (70자), 붙여 넣은 원문은 리뷰 경계를 알 수 없어 문장마다 한 장(예전 폴백과 같은 단위). 문장을 자르지 않는다(예전 폴백은 말끝
 * '요·다'에서 나눠 '사진보다'에서 끊겼다)
 */
export function pickSummaryFallbacks(reviewsText: string, limit = 3): ReviewQuote[] {
  const reviews = parseSerializedReviewList(reviewsText)
  const bodies =
    reviews.length > 0
      ? reviews
          .filter((r) => (r.rating ?? 0) >= REVIEW_QUOTE_MIN_RATING)
          .sort((a, b) => b.helped - a.helped || (b.rating ?? 0) - (a.rating ?? 0))
          .map((r) => r.body)
      : (reviewsText ?? '').split(/\r?\n+/).flatMap(reviewSentences)
  const picked: ReviewQuote[] = []
  const seen = new Set<string>()
  for (const body of bodies) {
    const summary = summarizeReviewSentences(body, REVIEW_SUMMARY_MAX_CHARS)
    if (!summary || seen.has(compact(summary))) continue
    seen.add(compact(summary))
    picked.push({ text: summary, author: '구매고객' })
    if (picked.length >= limit) break
  }
  return picked
}

/** 발췌 마무리 — 출처 리뷰의 원본 평점·작성 월·가린 작성자(늘), 요약이 켜지면 원문 문장 1~2개·'후기 요약'·원문. dropped = 요약 문장이 없어 뺀 발췌 */
export function finishExcerptHighlights(
  excerpts: readonly ReviewQuote[],
  reviewsText: string,
  options: { summary: boolean }
): { highlights: ExcerptHighlight[]; dropped: number; lowRated: number } {
  const reviews = parseSerializedReviewList(reviewsText)
  const highlights: ExcerptHighlight[] = []
  const seen = new Set<string>()
  let dropped = 0
  let lowRated = 0
  for (const excerpt of excerpts) {
    const text = options.summary ? summarizeReviewSentences(excerpt.text, REVIEW_SUMMARY_MAX_CHARS) : excerpt.text
    if (!text) {
      dropped += 1
      continue
    }
    if (seen.has(compact(text))) continue
    seen.add(compact(text))
    const source = sourceReviewOf(text, reviews)
    const rating = source?.rating
    // 요약 문장이 다른 후기에서 먼저 찾힌 경우까지 막는다
    if (isLowRating(rating)) {
      lowRated += 1
      continue
    }
    // 본문에서 찾은 발췌가 본문보다 짧을 때만 '후기 요약'(제목에서 찾았으면 원문 본문과 대조할 수 없다)
    const inBody = source !== undefined && compact(source.body).includes(compact(text))
    const shortened = options.summary && inBody && compact(text) !== compact(source!.body)
    highlights.push({
      text,
      author: source?.author ?? '구매고객',
      ...(rating && rating >= 1 && rating <= 5 ? { rating } : {}),
      ...(source?.month ? { month: source.month } : {}),
      ...(shortened ? { summary: true as const, original: source!.body } : {}),
    })
  }
  return { highlights, dropped, lowRated }
}
