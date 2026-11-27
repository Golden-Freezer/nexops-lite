/**
 * PDP 리뷰 원문 대조 — NEXFIT agents/review_scrubber.py 부분 이식(PROMPT-INVENTORY.md §8 D-3).
 * reviewHighlights(카피 4단계 산출)가 실제 리뷰 원문에서만 나오도록 결정적으로 검증한다.
 * LLM 호출 없음 — 순수 문자열 대조·정규식 필터 계층.
 *
 * 원본과의 입력 모델 차이(중요): NEXFIT은 엑셀 파싱으로 리뷰가 {body, author, rating, helped}
 * 구조화 배열(reviews_structured)로 들어오지만, NexOps spec_sheet.reviewsText는 사용자가
 * 붙여넣은 리뷰 원문 통짜 텍스트다(review_excel_parser.py 이식 없음 — 인벤토리 §8 D-3 범위 밖).
 * 그래서:
 * - validateReviewQuotes: 원문 대조를 리뷰 배열이 아닌 reviewsText 전체(정규화된 단일 haystack)로 수행.
 * - pickQuoteFallbacks: 리뷰별 평점(rating)·도움수(helped) 랭킹이 불가능하므로(구조화 정보 없음)
 *   문장 등장 순서대로 조건을 만족하는 첫 N개 문장을 선택한다(랭킹 로직만 생략, 안전 필터는 1:1).
 * - author: 구조화된 마스킹 작성자명이 없으므로 항상 "구매고객"(원본의 기본 폴백값과 동일).
 *   LLM이 candidate에 author를 채워 보내도 마스킹 규칙(maskAuthor)만 적용하고 신뢰하지 않는다.
 */

const _NORMALIZE_RE = /[\s.,!?~…'"''""·]+/g
/** 다운스트림 길이 절단으로 잘린 untrusted 종료 경계를 복원 — review_scrubber.py:118-122 */
const UNTRUSTED_REVIEWS_HEADER_FIRST_WORD = '[고객'
const UNTRUSTED_REVIEWS_FOOTER = '[고객 리뷰 데이터 끝]'

// review_scrubber.py:42-52 — 인용 금지 패턴(효능·의료 / 최상급·단정 / 대가성)
const QUOTE_BANNED_PATTERNS: RegExp[] = [
  /치료|완치|효능|처방|병원|의사|약사|의학|질환|염증|항염|살균|멸균|면역/,
  /통증|진통|아토피|디톡스|해독|다이어트|살이\s*빠|지방\s*분해|혈액|혈압|혈당/,
  /부작용|임상|검증된\s*효과|효과\s*봤|효과\s*보장/,
  /최고|최상|최강|제일\s*좋|가장\s*좋|1\s*위|유일|완벽/,
  /(국내|세계|업계)\s*최초/,
  /체험단|협찬|원고료|서포터즈|제공\s*받/,
]

// review_scrubber.py:185-196 — 문장 분리기 + 조각 문장 가드
const SENTENCE_SPLIT_RE = /(?<=[.!?요다])\s+/
const PURCHASE_CONTEXT_RE = /구매|구입|샀|시켰|주문|배송|택배|도착/
const LEADING_NOISE_RE = /^[^\w가-힣"']+/
const FRAGMENT_TAIL_RE = /(?:^|\s)(다|좀|더|안|잘|못|꽤|참)$/

function normalizeForMatch(text: string): string {
  return (text ?? '').replace(_NORMALIZE_RE, '')
}

/** 작성자명 마스킹 보장 — review_scrubber.py:62-71 1:1 */
export function maskAuthor(name: string | undefined): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return '구매고객'
  if (trimmed.includes('*')) return trimmed
  if (trimmed.length === 1) return trimmed + '*'
  return trimmed[0] + '*' + trimmed.slice(2)
}

/** 다운스트림 절단으로 untrusted 종료 경계가 잘렸으면 복원 — review_scrubber.py:118-122 */
export function ensureUntrustedFooter(text: string): string {
  if (text.includes(UNTRUSTED_REVIEWS_HEADER_FIRST_WORD) && !text.includes(UNTRUSTED_REVIEWS_FOOTER)) {
    return text + '\n' + UNTRUSTED_REVIEWS_FOOTER
  }
  return text
}

/** 인용 안전성 — 효능·의료·최상급·대가성 표현이 없어야 true. review_scrubber.py:125-127 */
export function isQuoteSafe(text: string): boolean {
  return !QUOTE_BANNED_PATTERNS.some((p) => p.test(text ?? ''))
}

function isExperienceSentence(sentence: string): boolean {
  if (sentence.includes('재구매')) return true
  return !PURCHASE_CONTEXT_RE.test(sentence)
}

/** 인용 후보가 리뷰 원문(통짜 텍스트)의 부분 문자열인지 정규화 비교로 대조 */
function matchesReviewsText(quote: string, reviewsTextNormalized: string, minLen = 8): boolean {
  const normalized = normalizeForMatch(quote)
  if (normalized.length < minLen) return false
  return reviewsTextNormalized.includes(normalized)
}

export interface ReviewQuote {
  text: string
  author: string
}

/**
 * reviewHighlights 후보를 리뷰 원문과 대조해 (a) 원문에 없는 문장(창작·재작성) 폐기,
 * (b) 인용 금지 표현 포함 폐기 — review_scrubber.py:147-182의 단일-텍스트 대응판.
 */
export function validateReviewQuotes(
  candidates: unknown[],
  reviewsText: string,
  limit = 3,
): ReviewQuote[] {
  const haystack = normalizeForMatch(reviewsText ?? '')
  const verified: ReviewQuote[] = []
  const seen = new Set<string>()
  if (!haystack) return verified

  for (const cand of candidates) {
    let text = ''
    if (cand && typeof cand === 'object') {
      text = String((cand as { text?: unknown }).text ?? '').trim()
    } else if (typeof cand === 'string') {
      text = cand.trim()
    } else {
      continue
    }
    if (!text || seen.has(normalizeForMatch(text))) continue
    if (!matchesReviewsText(text, haystack)) continue
    if (!isQuoteSafe(text)) continue
    seen.add(normalizeForMatch(text))
    verified.push({ text: text.slice(0, 60), author: '구매고객' })
    if (verified.length >= limit) break
  }
  return verified
}

/**
 * 검증 통과 인용이 없을 때의 결정적 폴백 — 리뷰 원문에서 직접 발췌한다.
 * review_scrubber.py:206-241의 단일-텍스트 대응판(리뷰별 평점 랭킹은 구조화 데이터 부재로 생략,
 * 문장 등장 순서로 대체 — 안전 필터·경험 문장 판정은 원본 그대로).
 */
export function pickQuoteFallbacks(
  reviewsText: string,
  limit = 3,
  maxLen = 60,
  minLen = 10,
): ReviewQuote[] {
  const picked: ReviewQuote[] = []
  const seen = new Set<string>()
  const raw = (reviewsText ?? '').trim()
  if (!raw) return picked

  for (const rawSentence of raw.split(SENTENCE_SPLIT_RE)) {
    const sentence = rawSentence.trim().replace(LEADING_NOISE_RE, '').trim()
    if (sentence.length < minLen || sentence.length > maxLen) continue
    if (sentence.includes('삭제)') || !isQuoteSafe(sentence)) continue
    if (!isExperienceSentence(sentence) || FRAGMENT_TAIL_RE.test(sentence)) continue
    const key = normalizeForMatch(sentence)
    if (seen.has(key)) continue
    seen.add(key)
    picked.push({ text: sentence, author: '구매고객' })
    if (picked.length >= limit) break
  }
  return picked
}
