/**
 * PDP 리뷰 원문 대조 — NEXFIT agents/review_scrubber.py 부분 이식(PROMPT-INVENTORY.md §8 D-3).
 * reviewHighlights(카피 4단계 산출)가 실제 리뷰 원문에서만 나오도록 결정적으로 검증한다.
 * LLM 호출 없음 — 순수 문자열 대조·정규식 필터 계층.
 *
 * 원본과의 입력 모델 차이(중요): NEXFIT은 엑셀 파싱으로 리뷰가 {body, author, rating, helped}
 * 구조화 배열(reviews_structured)로 들어오지만, NexOps spec_sheet.reviewsText는 텍스트 하나다 —
 * 사용자가 붙여넣은 원문이거나, 자사 리뷰 파일(reviews/*, pdp-review-input)을 정화·표집한 직렬화 텍스트다.
 * 그래서:
 * - validateReviewQuotes: 원문 대조를 리뷰 배열이 아닌 텍스트 하나(정규화된 단일 haystack)로 수행.
 *   직렬화 텍스트면 머리말·[리뷰N] 메타 줄을 빼고 줄마다(제목·내용·덧붙인 평문) 따로 대조한다.
 * - pickQuoteFallbacks: 붙여넣은 원문은 리뷰별 평점(rating)·도움수(helped) 랭킹이 불가능하므로
 *   문장 등장 순서대로 조건을 만족하는 첫 N개 문장을 선택한다(랭킹 로직만 생략, 안전 필터는 1:1).
 *   직렬화 텍스트면 평점·도움 수를 되살려 원본 랭킹을 쓴다.
 * - author: 여기서는 늘 "구매고객"(원본의 기본 폴백값과 동일). LLM이 candidate에 author를 채워 보내도 쓰지 않는다. 직렬화 텍스트에서
 *   출처 리뷰를 찾으면 발췌 마무리(reviews/review-excerpts)가 가린 작성자·원본 평점·작성 월을 붙인다(P1-6). 파일의 이름 칸은 파서가
 *   읽는 즉시 maskAuthor로 가린다.
 */

import { quoteDiseaseTermsIn, regulatedClaimTermsIn, type RegulatedKind } from './eval/claim-lexicon'
import { endsWithBenefit } from './reviews/review-benefit'

const _NORMALIZE_RE = /[\s.,!?~…'"''""·]+/g
/** 다운스트림 길이 절단으로 잘린 untrusted 종료 경계를 복원 — review_scrubber.py:118-122 */
const UNTRUSTED_REVIEWS_HEADER_FIRST_WORD = '[고객'
const UNTRUSTED_REVIEWS_FOOTER = '[고객 리뷰 데이터 끝]'

/**
 * 인용 금지 사유 — 인증·인허가(인증·허가·시험 사칭), 의학·기능성(질병·치료·의학적 효능·기능성 화장품 효능), 최상급(최상급·최초 단정),
 * 대가성(체험단·협찬). 사용 경험·체감 효익('엉키지 않아요'·'두피가 시원해요'·'효과')은 막지 않는다(2026-10-30 오너 지시)
 */
export type QuoteBlockReason = '인증·인허가' | '의학·기능성' | '최상급' | '대가성'

/** 규제 표현 종류 → 인용 금지 사유(화면 칩) */
const REGULATED_REASON: Record<RegulatedKind, QuoteBlockReason> = {
  certification: '인증·인허가',
  medical: '의학·기능성',
}

// review_scrubber.py:42-52 — 인용 금지 패턴 중 최상급·단정 / 대가성. 효능·의료 묶음은 규제 표현 사전(eval/claim-lexicon
// REGULATED_CLAIM_PATTERNS)으로 옮겼다(질병·의학·인증만, '효과 봤어요' 같은 체감은 허용). '효과 보장'은 단정이라 최상급
const QUOTE_BANNED_PATTERNS: Array<{ reason: QuoteBlockReason; re: RegExp }> = [
  { reason: '최상급', re: /최고|최상|최강|제일\s*좋|가장\s*좋|1\s*위|유일|완벽|효과\s*보장/ },
  { reason: '최상급', re: /(국내|세계|업계)\s*최초/ },
  { reason: '대가성', re: /체험단|협찬|원고료|서포터즈|제공\s*받/ },
]

// review_scrubber.py:185-196 — 문장 분리기 + 조각 문장 가드
const SENTENCE_SPLIT_RE = /(?<=[.!?요다])\s+/
const PURCHASE_CONTEXT_RE = /구매|구입|샀|시켰|주문|배송|택배|도착/
const LEADING_NOISE_RE = /^[^\w가-힣"']+/
const FRAGMENT_TAIL_RE = /(?:^|\s)(다|좀|더|안|잘|못|꽤|참)$/

function normalizeForMatch(text: string): string {
  return (text ?? '').replace(_NORMALIZE_RE, '')
}

/**
 * 작성자명 가림 — 앞 한 글자만 남기고 나머지는 *(3개까지). 원본 review_scrubber.py:62-71은 둘째 글자만 가렸다('김*수') —
 * 오너 지시(2026-10-31, P1-6)로 앞 한 글자만 보인다('김**'). 쿠팡이 이미 가운데를 가린 이름('김*희')도 끝 글자가 보여 다시 가린다.
 * 한 글자 이름은 가려도 다 보이고, 글자·숫자로 시작하지 않는 칸('*희'·'(탈퇴회원)')은 이름이 아니라 '구매고객'
 */
export function maskAuthor(name: string | undefined): string {
  const glyphs = [...(name ?? '').trim()]
  if (glyphs.length < 2 || !/[\p{L}\p{N}]/u.test(glyphs[0])) return '구매고객'
  return glyphs[0] + '*'.repeat(Math.min(glyphs.length - 1, 3))
}

/** 다운스트림 절단으로 untrusted 종료 경계가 잘렸으면 복원 — review_scrubber.py:118-122 */
export function ensureUntrustedFooter(text: string): string {
  if (text.includes(UNTRUSTED_REVIEWS_HEADER_FIRST_WORD) && !text.includes(UNTRUSTED_REVIEWS_FOOTER)) {
    return text + '\n' + UNTRUSTED_REVIEWS_FOOTER
  }
  return text
}

/**
 * 인용 금지 사유 — 규제 표현(eval/claim-lexicon regulatedClaimTermsIn, 고지·부정 문맥도 센다)의 첫 표현 사유, 질병·증상명 단독
 * (quoteDiseaseTermsIn)이면 의학·기능성, 없으면 최상급·대가성
 * 패턴에서 첫 번째로 걸린 사유. 둘 다 없으면 null
 */
export function quoteBlockReason(text: string): QuoteBlockReason | null {
  const regulated = regulatedClaimTermsIn(text ?? '')[0]
  if (regulated) return REGULATED_REASON[regulated.kind]
  // 질병·증상명이 홀로 나와도 질병 효능을 암시한다(인용 전용 묶음, 2026-10-30)
  if (quoteDiseaseTermsIn(text ?? '').length > 0) return '의학·기능성'
  return QUOTE_BANNED_PATTERNS.find((p) => p.re.test(text ?? ''))?.reason ?? null
}

/** 인용 안전성 — 규제(인증·인허가·의학·기능성)·최상급·대가성 표현이 없어야 true. review_scrubber.py:125-127 */
export function isQuoteSafe(text: string): boolean {
  return quoteBlockReason(text) === null
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
  options: { clip?: boolean } = {},
): ReviewQuote[] {
  const haystacks = quoteHaystacks(reviewsText ?? '')
    .map(normalizeForMatch)
    .filter(Boolean)
  const verified: ReviewQuote[] = []
  const seen = new Set<string>()
  if (haystacks.length === 0) return verified

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
    // 정화 표시('(연락처 삭제)' 등)가 든 문장은 인용하지 않는다
    if (text.includes('삭제)')) continue
    if (!haystacks.some((haystack) => matchesReviewsText(text, haystack))) continue
    if (!isQuoteSafe(text)) continue
    seen.add(normalizeForMatch(text))
    // 후기 요약(P1-6)이 켜지면 자르지 않는다 — 발췌 마무리(review-excerpts)가 원문 문장 1~2개로 다시 고른다
    verified.push({ text: options.clip === false ? text : text.slice(0, 60), author: '구매고객' })
    if (verified.length >= limit) break
  }
  return verified
}

/** 후기 요약 문장 최소 글자 — 짧은 감탄('좋아요')만으로는 요약이 되지 않는다 */
const SUMMARY_MIN_SENTENCE = 8
/**
 * 후기 요약 문장 나누기 — 문장부호(. ! ? ~) 뒤(띄어 쓰지 않아도 — '1.5'의 소수점·'...' 가운데는 아니다)와 'ㅎㅎ'·'ㅋㅋ'·'^^'·이모지
 * 뒤 띄어쓰기에서. 발췌 폴백의 SENTENCE_SPLIT_RE는 말끝 '요·다' 뒤에서도 나눠 '사진보다'·'필요' 같은 낱말 뒤에서 문장이 끊긴다 —
 * 요약은 문장을 자르지 않아야 하므로 쓰지 않는다
 */
const SUMMARY_SPLIT_RE = /(?<=[.!?~])(?![.!?~\d])\s*|(?<=[ㅎㅋ^]|\p{Extended_Pictographic})\s+/u
/**
 * 문장이 끝났다는 표시 — 여러 조각 가운데 마지막 조각은 이것으로 끝날 때만 쓴다. 인용 후보는 150자 안의 말끝('…쓰다 ')에서
 * 잘릴 수 있어(review-candidates clipQuote) 표시 없는 마지막 조각은 잘린 꼬리일 수 있다. '…'로 끝나면 늘 잘린 조각이다
 */
const SUMMARY_SENTENCE_END_RE = /(?:[.!?~ㅎㅋ^]|\p{Extended_Pictographic})$/u
/**
 * 문장부호 없이 이어 쓴 글의 말끝('…잘 열려요 출근이 잦아서…') — 효익 문장을 찾을 때만 더 나눈다. '필요·중요·주요·수요' 같은 낱말과
 * 이어 주는 '…다 보니'에서는 나누지 않는다
 */
const SPOKEN_END_SPLIT_RE = /(?<=(?<![필중주수])요|니다|죠)\s+(?=[가-힣])/

/** 후기 문장 나누기(요약과 같은 기준) — 공백을 정리하고 SUMMARY_SPLIT_RE로 나눈다 */
export function reviewSentences(text: string): string[] {
  return (text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(SUMMARY_SPLIT_RE)
    .map((s) => s.trim())
}

/** 문장 목록과, 문장마다 요약에 쓸 수 있는 글(쓸 수 없으면 null) — 잘린 꼬리일 수 있는 조각은 쓸 수 없다 */
function summaryUnits(text: string, maxLen: number): { sentences: string[]; complete: boolean[]; usable: Array<string | null> } {
  const sentences = reviewSentences(text)
  const complete = sentences.map(
    (s, i) => !s.endsWith('…') && (sentences.length === 1 || i < sentences.length - 1 || SUMMARY_SENTENCE_END_RE.test(s))
  )
  const usable = sentences.map((s, i) => (complete[i] ? acceptQuoteSentence(s, SUMMARY_MIN_SENTENCE, maxLen) : null))
  return { sentences, complete, usable }
}

/**
 * 효익으로 끝나는 원문 문장 1~2개(2026-11-02) — 처음으로 효익으로 끝나는 문장 하나, 바로 뒤 문장도 그렇고 합쳐 maxLen 이내면 두 문장.
 * 문장부호 없이 이어 써서 통째로 쓸 수 없는 문장은 말끝에서 나눈 조각 하나. 없으면 null. 문장을 자르거나 고쳐 쓰지 않는다
 */
export function benefitReviewSentences(text: string, maxLen = 70): string | null {
  const { sentences, complete, usable } = summaryUnits(text, maxLen)
  const isBenefit = (s: string | null | undefined): s is string => Boolean(s) && endsWithBenefit(s as string)
  for (let i = 0; i < sentences.length; i++) {
    const first = usable[i]
    if (isBenefit(first)) {
      const next = usable[i + 1]
      return isBenefit(next) && first.length + 1 + next.length <= maxLen ? `${first} ${next}` : first
    }
    const pieces = complete[i] ? sentences[i].split(SPOKEN_END_SPLIT_RE) : []
    if (pieces.length < 2) continue
    const piece = pieces.map((p) => acceptQuoteSentence(p, SUMMARY_MIN_SENTENCE, maxLen)).find(isBenefit)
    if (piece) return piece
  }
  return null
}

/**
 * 후기 요약(P1-6, 발췌형 — 통합 승인 2026-10-31) — 효익으로 끝나는 문장(benefitReviewSentences)을 먼저 고른다(2026-11-02). 없으면 원문에서
 * 처음으로 쓸 수 있는 문장 하나, 바로 뒤 문장도 쓸 수 있고 합쳐 maxLen 이내면 두 문장. 쓸 수 있는 문장 = 경험 문장(구매·배송 정황 아님)·
 * 인용 안전(규제·최상급·대가성 없음)·조각 아님·정화 표지 없음·구매를 막지 않음. 문장을 자르거나 고쳐 쓰지 않는다(원문에 없는 숫자·효과가
 * 생길 수 없다). 문장부호 없이 maxLen을 넘는 글처럼 쓸 수 있는 문장이 없으면 null — 그 리뷰는 카드에서 뺀다. null인지는 효익 기준과
 * 상관없다(카드 수·인용 후보 사유 '요약'이 효익 기준으로 움직이지 않게)
 */
export function summarizeReviewSentences(text: string, maxLen = 70): string | null {
  const { usable } = summaryUnits(text, maxLen)
  const at = usable.findIndex(Boolean)
  if (at < 0) return null
  const benefit = benefitReviewSentences(text, maxLen)
  if (benefit) return benefit
  const first = usable[at] as string
  const next = usable[at + 1]
  return next && first.length + 1 + next.length <= maxLen ? `${first} ${next}` : first
}

/** 다른 판매자로 보내는 말 — 평점과 상관없이 인용하지 않는다 */
const OTHER_SELLER_RE = /다른\s*(?:판매자|판매처|셀러|업체|쇼핑몰)|타\s*(?:판매자|판매처|업체)/
/** 불만·반품을 직접 말하는 낱말 — 바로 뒤에 부정이 오면('후회 없어요'·'불량 없이') 효익이다 */
const COMPLAINT_RE =
  /(?:아쉽|아쉬[운워웠울]|실망|불만|환불|반품|후회|비추천|비추(?:해요|합니다|예요|에요)|돈\s*아[깝까]|기대\s*이하|불량|하자가|고장)(?![^.!?]{0,8}(?:없|않|안\s))/
/** 망가졌다는 말 — 앞에 '안'이 있으면('안 깨졌어요') 효익이다. '찢어질 걱정 없음'처럼 앞으로의 일은 치지 않는다 */
const BROKEN_RE = /(?<!안\s?)(?:찢어졌|찢어져서|망가졌|망가져서|부러졌|부러져서|깨졌|깨져서|터졌|터져서)/

/**
 * 구매를 막는 후기 문장(R15 P02 — 5점 후기의 '다른 판매자…' 문장이 요약 카드가 됐다). 판매 페이지에 다른 판매자·불만·반품을 싣지 않는다.
 * 오너 지시(체감 효익은 살린다)에 맞춰 좁게 잡는다 — 불편·얇다·작다처럼 효익이나 산 계기에도 쓰는 낱말은 치지 않는다
 */
export function blocksPurchase(sentence: string): boolean {
  return OTHER_SELLER_RE.test(sentence) || COMPLAINT_RE.test(sentence) || BROKEN_RE.test(sentence)
}

/** 발췌 후보 문장 정리·판정 — 안전 필터·경험 문장·조각 문장·구매를 막는 문장 가드. 쓸 수 없으면 null */
function acceptQuoteSentence(rawSentence: string, minLen: number, maxLen: number): string | null {
  const sentence = rawSentence.trim().replace(LEADING_NOISE_RE, '').trim()
  if (sentence.length < minLen || sentence.length > maxLen) return null
  if (sentence.includes('삭제)') || !isQuoteSafe(sentence) || blocksPurchase(sentence)) return null
  if (!isExperienceSentence(sentence) || FRAGMENT_TAIL_RE.test(sentence)) return null
  return sentence
}

/**
 * 자사 리뷰 파일 직렬화 형식(reviews/review-sample.ts serializeReviews) — `[리뷰N] 평점 r/5 · 도움 h …` 줄,
 * 선택 `제목:` 줄, `내용:` 줄. 이 형식이면 리뷰별 평점·도움 수를 되살려 원본 랭킹을 쓸 수 있다.
 */
const SERIALIZED_REVIEW_RE = /^\[리뷰\d+\] 평점 (\d)\/5 · 도움 (\d+)[^\n]*\n(?:제목: [^\n]*\n)?내용: ([^\n]*)$/gm

function parseSerializedReviews(text: string): Array<{ rating: number; helped: number; body: string }> {
  return [...text.matchAll(SERIALIZED_REVIEW_RE)].map((m) => ({
    rating: Number(m[1]),
    helped: Number(m[2]),
    body: m[3],
  }))
}

const SERIALIZED_META_RE = /^\[리뷰\d+\] 평점 /m
const SERIALIZED_SKIP_LINE_RE = /^(?:\[리뷰\d+\] 평점 |리뷰 전체: |표집: |\(길이 상한으로 )/

/**
 * 인용 대조 대상 — 붙여넣은 원문은 전체 하나(기존 동작). 직렬화 텍스트면 줄마다 따로 대조한다:
 * 머리말·[리뷰N] 메타 줄은 빼고 제목·내용 접두를 뗀다(두 리뷰에 걸친 조각이 통과하지 않게, 뒤에 덧붙인 평문 줄은 남긴다).
 */
function quoteHaystacks(text: string): string[] {
  if (!SERIALIZED_META_RE.test(text)) return [text]
  return text
    .split('\n')
    .filter((line) => line.trim() && !SERIALIZED_SKIP_LINE_RE.test(line))
    .map((line) => line.replace(/^(?:제목|내용): /, ''))
}

/** 직렬화 형식 폴백 — review_scrubber.py:206-241 그대로: 고평점(4~5) 우선, 도움 수 내림차순, 리뷰당 한 문장 */
function pickStructuredFallbacks(
  reviews: Array<{ rating: number; helped: number; body: string }>,
  limit: number,
  maxLen: number,
  minLen: number,
): ReviewQuote[] {
  const ranked = reviews.filter((r) => r.rating >= 4).sort((a, b) => b.helped - a.helped || b.rating - a.rating)
  const picked: ReviewQuote[] = []
  const seen = new Set<string>()
  for (const r of ranked) {
    // 직렬화에서 잘린 본문(…로 끝남)의 마지막 문장은 미완성이라 쓰지 않는다
    const sentences = r.body.trim().split(SENTENCE_SPLIT_RE)
    if (r.body.endsWith('…')) sentences.pop()
    for (const rawSentence of sentences) {
      const sentence = acceptQuoteSentence(rawSentence, minLen, maxLen)
      if (!sentence || seen.has(normalizeForMatch(sentence))) continue
      seen.add(normalizeForMatch(sentence))
      picked.push({ text: sentence, author: '구매고객' })
      break
    }
    if (picked.length >= limit) break
  }
  return picked
}

/**
 * 검증 통과 인용이 없을 때의 결정적 폴백 — 리뷰 원문에서 직접 발췌한다.
 * review_scrubber.py:206-241의 단일-텍스트 대응판(리뷰별 평점 랭킹은 구조화 데이터 부재로 생략,
 * 문장 등장 순서로 대체 — 안전 필터·경험 문장 판정은 원본 그대로).
 * 자사 리뷰 파일에서 온 직렬화 텍스트면 리뷰별 평점·도움 수 랭킹(원본 그대로)을 쓴다(pdp-review-input).
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

  const structured = parseSerializedReviews(raw)
  if (structured.length > 0) return pickStructuredFallbacks(structured, limit, maxLen, minLen)

  for (const rawSentence of raw.split(SENTENCE_SPLIT_RE)) {
    const sentence = acceptQuoteSentence(rawSentence, minLen, maxLen)
    if (!sentence) continue
    const key = normalizeForMatch(sentence)
    if (seen.has(key)) continue
    seen.add(key)
    picked.push({ text: sentence, author: '구매고객' })
    if (picked.length >= limit) break
  }
  return picked
}
