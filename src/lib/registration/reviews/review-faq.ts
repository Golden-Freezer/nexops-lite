/**
 * 후기 속 실제 질문(구매 전 질문 표, reviewfaq 스위치, docs/plans/pdp-enrichment/REVIEW-FAQ.md) — 산출 검사. 순수·결정론.
 * 모델이 고른 항목 가운데 실제 후기로 확인되는 것만 남긴다.
 * - worry·answer는 자사 후기 원문 그대로여야 한다(reviewHighlights와 같은 원문 대조·인용 금지 표현 검사).
 * - answer는 낱말 첫머리에서 시작해 완결된 말로 끝나고 70자 이내다. 자르지 않는다(자르면 문장 가운데서 끊긴다).
 * - worry·answer의 출처 후기 평점을 알면 4점 이상만 쓴다. 불만 후기를 답으로 싣지 않고, 불만 문장을 '걱정'으로 삼아 좋은 후기로
 *   덮지 않는다(실제 불만이 있는 점을 괜찮다고 답하게 된다).
 * - answer가 아쉬움·불만·단점·바라는 점을 말하면 뺀다(isDrawbackAnswer). 평점이 높은 후기 안의 아쉬운 문장도 답이 될 수 없다.
 * - question은 모델이 다듬은 말이라 페이지에 보이는 유일한 비원문이다. 짧은 물음이어야 하고 worry가 원문에 있어야 한다.
 * - 규제 표현은 인용 안전 검사(isQuoteSafe)가, 입력·후기에 없는 숫자·단위는 카피와 같은 대조가 뺀다.
 * - 답이 질문과 같은 주제인지는 코드가 판단하지 않는다(프롬프트만, REVIEW-FAQ.md 알려진 한계).
 */

import { findChildTerms, isAgeRestricted } from '../compliance-gate'
import { buildNumberSources, findUnsupportedNumbers } from '../copy-numbers'
import type { CopywritingResult, PdpSpecSheet } from '../pdp-state'
import { blocksPurchase, isQuoteSafe, validateReviewQuotes } from '../review-scrubber'
import { fromLowRatedReview, parseSerializedReviewList, type SerializedReview } from './review-excerpts'

/** 표에 싣는 후기 질문 수 상한 — 나머지는 고정 질문이 채운다 */
export const REVIEW_FAQ_MAX_ITEMS = 3
/** 모델에게 받는 후보 수 — 검사에서 빠질 몫을 둔다 */
export const REVIEW_FAQ_CANDIDATES = 6
export const REVIEW_FAQ_QUESTION_MAX_CHARS = 32
const QUESTION_MIN_CHARS = 6
export const REVIEW_FAQ_ANSWER_MAX_CHARS = 70
/** 글 후기가 이보다 적으면 부르지 않는다 — 질문이 나올 재료가 없다 */
export const REVIEW_FAQ_MIN_REVIEWS = 3

/** 말이 끝났다는 표시 — '~하고'·'~라서'처럼 이어지는 말은 답이 아니다 */
const COMPLETE_ANSWER_RE = /(?:[요다죠네음함임어아용당][.!?~ㅎㅋ^♡♥\s]*|[.!?~ㅎㅋ^♡♥]|\p{Extended_Pictographic})$/u

/**
 * 답에서 아쉬움·불편·단점을 말하는 낱말(K4 P01 — 평점 4점 이상 후기 안의 아쉬운 문장이 답이 됐다).
 * 후기 카드의 blocksPurchase보다 넓게 잡는다. 답은 걱정을 풀어 주는 말이어야 하고, 빼면 고정 질문이 채울 뿐이다.
 * 낱말 바로 뒤가 이런 말이면 치지 않는다.
 * - 부정: '불편하지 않아요'·'단점이 없어요'·'단점은 못 느꼈어요'·'여닫기 어려운 정도는 아니에요'
 * - 기대했던 것: '약할까 했는데'·'어려울 줄 알았는데'
 * - 지난 일이 풀렸다: '힘들었는데 만족해요'·'불편했는데 해결됐어요'·'어렵던데 이건 쉬워요'
 *   지금 아쉽다는 말('아쉬운데 ~')은 풀린 일로 보지 않는다.
 * 앞에 '안'이 있어도 치지 않는다('안 힘들어요'). '약'은 낱말 첫머리일 때만 센다('예약해요'·'절약돼요'는 아니다).
 */
const DRAWBACK_WORD_RE =
  /(?<!안\s?)(?:아쉽|아쉬[운워웠울움]|불편|별로|(?<![가-힣])약[해하한함했]|힘[들듭듦든]|어렵|어려[워웠운울움]|단점|실망|그닥|그다지)/g
const NEGATED_AFTER_RE = /^[^.!?]{0,8}(?:없|않|안\s|아니|못|모르)/
const EXPECTED_AFTER_RE = /^[가-힣]{0,2}\s?(?:까|줄\s?알|거라|것\s?같)/
const RESOLVED_TAIL = '[^.!?]*?(?:이건|이거|이 제품|여기|해결|만족|편해|편리|좋|쉽|멀쩡|깔끔|딱)'
const RESOLVED_AFTER_RE = new RegExp(`^(?:[가-힣]{0,3}(?:었|았|였|했)(?:는데|지만)|[가-힣]{0,2}던데)${RESOLVED_TAIL}`)
/** 바라는 점 — '더 컸으면 좋겠어요'·'있으면 더 좋을 것 같아요'는 지금 모자란 점을 말한다 */
const ANSWER_WISH_RE = /면\s*(?:더\s*)?좋겠|면\s*더\s*좋[을았겠]/

function saysDrawback(answer: string): boolean {
  for (const m of answer.matchAll(DRAWBACK_WORD_RE)) {
    const after = answer.slice((m.index ?? 0) + m[0].length)
    if (!NEGATED_AFTER_RE.test(after) && !EXPECTED_AFTER_RE.test(after) && !RESOLVED_AFTER_RE.test(after)) return true
  }
  return false
}

/** 답이 아쉬움·불만·단점·바라는 점을 말하는가 — 구매를 막는 문장(다른 판매자·불만·반품·망가짐)도 포함한다 */
export function isDrawbackAnswer(answer: string): boolean {
  return blocksPurchase(answer) || saysDrawback(answer) || ANSWER_WISH_RE.test(answer)
}

export interface ReviewFaqItem {
  question: string
  answer: string
}

/** 설계 기록용 수 — 실패도 조용히 지나가지 않게 남긴다(R 회차 판독) */
export interface ReviewFaqStats {
  kept: number
  dropped: number
  failed?: true
}

export interface ReviewFaqResult {
  items: ReviewFaqItem[]
  dropped: number
}

const asText = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
const isVerbatim = (quote: string, reviewsText: string) =>
  validateReviewQuotes([quote], reviewsText, 1, { clip: false }).length === 1

/** 원문에서 낱말 첫머리부터 옮겼는지 — 낱말 가운데서 자른 답은 부분 문자열이라 원문 대조만으로는 걸러지지 않는다 */
function startsAtWordBoundary(answer: string, reviewsText: string): boolean {
  const source = reviewsText.replace(/\s+/g, ' ')
  const at = source.indexOf(answer)
  return at === 0 || (at > 0 && !/[\p{L}\p{N}]/u.test(source[at - 1]))
}

function checkItem(raw: unknown, reviewsText: string, reviews: readonly SerializedReview[], spec: PdpSpecSheet): ReviewFaqItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const rec = raw as Record<string, unknown>
  const question = asText(rec.question)
  const worry = asText(rec.worry)
  const answer = asText(rec.answer)
  if (question.length < QUESTION_MIN_CHARS || question.length > REVIEW_FAQ_QUESTION_MAX_CHARS) return null
  if (!question.endsWith('?') || !isQuoteSafe(question)) return null
  if (answer.length > REVIEW_FAQ_ANSWER_MAX_CHARS || !COMPLETE_ANSWER_RE.test(answer)) return null
  if (!isVerbatim(worry, reviewsText) || !isVerbatim(answer, reviewsText)) return null
  if (!startsAtWordBoundary(answer, reviewsText)) return null
  if (fromLowRatedReview(worry, reviews) || fromLowRatedReview(answer, reviews)) return null
  if (isDrawbackAnswer(answer)) return null
  // 연령 제한 잡(만 14세 이상)은 어린이 표현이 든 질문·답을 싣지 않는다 — 답은 후기 원문이라 고쳐 쓸 수 없어 D 후기 발췌(stripChildReviewHighlights)처럼
  // 뺀다. K 후기 질문 FAQ와 D 긴 페이지 질문 표가 이 기록을 함께 쓴다(결정 카드 c03). 페이지에 보이는 질문·답만 본다(worry는 대조용 원문)
  if (isAgeRestricted(spec) && findChildTerms(`${question} ${answer}`).length > 0) return null
  const shown = { reviewFaq: [{ question, answer }] } as unknown as CopywritingResult
  if (findUnsupportedNumbers(shown, buildNumberSources(spec)).length > 0) return null
  return { question, answer }
}

/** 모델 산출 → 페이지에 실어도 되는 항목(앞에서부터 상한까지). 같은 질문·같은 답은 한 번 */
export function validateReviewFaq(rawItems: readonly unknown[], reviewsText: string, spec: PdpSpecSheet): ReviewFaqResult {
  const items: ReviewFaqItem[] = []
  const seen = new Set<string>()
  const reviews = parseSerializedReviewList(reviewsText)
  let dropped = 0
  for (const raw of rawItems) {
    const item = items.length < REVIEW_FAQ_MAX_ITEMS ? checkItem(raw, reviewsText, reviews, spec) : null
    if (!item || seen.has(item.question) || seen.has(item.answer)) {
      dropped += 1
      continue
    }
    seen.add(item.question)
    seen.add(item.answer)
    items.push(item)
  }
  return { items, dropped }
}

/** 부를 만큼 글 후기가 있는지 — 직렬화 텍스트는 건수로, 붙여 넣은 원문은 경계를 알 수 없어 글이 있으면 부른다 */
export function hasReviewFaqMaterial(reviewsText: string | undefined): boolean {
  const text = reviewsText?.trim()
  if (!text) return false
  const reviews = parseSerializedReviewList(text)
  return reviews.length === 0 || reviews.length >= REVIEW_FAQ_MIN_REVIEWS
}
