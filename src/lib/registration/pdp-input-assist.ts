/**
 * 생성 화면 입력 보조(W3, PDP-W2W3-CONTRACT v1) — 자동 작성·리뷰 인용 카드·초안 프리필의 화면 쪽 순수 함수.
 * 타입·한도는 W2a(A)의 정본을 그대로 쓴다(review-types·spec-inputs). 저장 직전 정리(빈 행·같은 키·한도)는 잡 생성 라우트의
 * normalizeSpecInputs가 한다 — 화면은 입력 중 한도만 지킨다.
 * - 자동 작성: API는 제안만 준다. 빈 칸만 채우고, 이미 쓴 다른 값은 '바꾸기'로 고르게 한다(오너가 고친다)
 * - 인용 카드: 후보 30개 이하에서 6장 이하. 글은 바꿔 쓰지 않는다(150자). 강조는 글 안에 실제로 있는 조각 3개·12자 이하
 *   글자 수는 서버(normalizeSpecInputs)와 같은 UTF-16 단위로 세되, 자를 때 이모지(서로게이트 쌍) 가운데를 자르지 않는다
 */

import type { PdpSpecSheet } from './pdp-state'
import {
  EXTRA_SPEC_KEY_MAX as KEY_MAX,
  EXTRA_SPEC_VALUE_MAX as VALUE_MAX,
  EXTRA_SPECS_LIMIT,
  PREFILL_FIELDS,
  draftToSpecPrefill,
  type DraftPrefillSource,
  type PrefillField,
} from './spec-inputs'
import {
  REVIEW_CANDIDATE_LIMIT,
  REVIEW_QUOTE_HIGHLIGHT_LIMIT,
  REVIEW_QUOTE_HIGHLIGHT_MAX_CHARS,
  REVIEW_QUOTE_LIMIT,
  REVIEW_QUOTE_MAX_CHARS,
  type ReviewCandidate,
  type ReviewCandidateBlock,
  type ReviewQuote,
} from './reviews/review-types'

export type { ReviewCandidate, ReviewQuote }
export type ExtraSpec = NonNullable<PdpSpecSheet['extraSpecs']>[number]

export const EXTRA_SPEC_MAX_ROWS = EXTRA_SPECS_LIMIT
export const EXTRA_SPEC_KEY_MAX = KEY_MAX
export const EXTRA_SPEC_VALUE_MAX = VALUE_MAX
export const QUOTE_CANDIDATE_MAX = REVIEW_CANDIDATE_LIMIT
export const QUOTE_MAX = REVIEW_QUOTE_LIMIT
export const QUOTE_TEXT_MAX = REVIEW_QUOTE_MAX_CHARS
export const HIGHLIGHT_MAX = REVIEW_QUOTE_HIGHLIGHT_LIMIT
export const HIGHLIGHT_CHARS_MAX = REVIEW_QUOTE_HIGHLIGHT_MAX_CHARS
/** 자동 작성 요청의 리뷰 원문 앞부분(계약 §2-2) */
export const AUTO_FILL_REVIEWS_CHARS = 4_000

export interface AutoFillSuggestions {
  targetPersona?: string
  brandVoiceGuide?: string
  brandHexColor?: string
}

/** POST /api/registration/pdp/auto-fill 응답(A, 계약 v1.1) — warnings: 버린 제안(효능 표현)·틀린 컬러·읽지 못한 사진 안내 */
export interface AutoFillResponse {
  suggestions: AutoFillSuggestions
  model: string
  costUsd: number
  warnings?: string[]
}

export type AutoFillField = keyof AutoFillSuggestions

export const AUTO_FILL_FIELDS: AutoFillField[] = ['targetPersona', 'brandVoiceGuide', 'brandHexColor']

const HEX = /^#[0-9a-f]{6}$/i

/** UTF-16 길이 max 이하로 자르되 서로게이트 쌍(이모지 등) 가운데는 자르지 않는다 — 서버 slice와 같은 상한, 깨진 글자 없이 */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text
  let out = ''
  for (const ch of text) {
    if (out.length + ch.length > max) break
    out += ch
  }
  return out
}

/** 자동 작성 요청 본문(계약 §2-2) — 지금 spec에서 만든다. 이미지는 선택이라 보내지 않는다 */
export function autoFillRequestBody(spec: PdpSpecSheet) {
  return {
    productName: spec.productName.trim(),
    ...(spec.category ? { category: spec.category } : {}),
    ...(spec.brandName ? { brandName: spec.brandName } : {}),
    specSheet: {
      material: spec.material,
      size: spec.size,
      weight: spec.weight,
      origin: spec.origin,
      extraSpecs: spec.extraSpecs,
      keyFeatures: spec.keyFeatures,
      colorOptions: spec.colorOptions,
      usageLocation: spec.usageLocation,
    },
    ...(spec.reviewsText ? { reviewsText: clipText(spec.reviewsText, AUTO_FILL_REVIEWS_CHARS) } : {}),
  }
}

/**
 * 자동 작성 계획 — 빈 칸은 채우고(fill), 이미 쓴 다른 값은 바꿀지 묻는다(conflicts). 빈 제안·같은 값은 무시하고,
 * 브랜드 컬러는 #RRGGBB가 아니면 쓰지 않는다.
 */
export function planAutoFill(
  current: Partial<Record<AutoFillField, string | undefined>>,
  suggestions: AutoFillSuggestions
): { fill: AutoFillSuggestions; conflicts: Array<{ field: AutoFillField; current: string; suggested: string }> } {
  const fill: AutoFillSuggestions = {}
  const conflicts: Array<{ field: AutoFillField; current: string; suggested: string }> = []
  for (const field of AUTO_FILL_FIELDS) {
    const suggested = suggestions[field]?.trim()
    if (!suggested || (field === 'brandHexColor' && !HEX.test(suggested))) continue
    const now = current[field]?.trim() ?? ''
    if (!now) fill[field] = suggested
    else if (now !== suggested) conflicts.push({ field, current: now, suggested })
  }
  return { fill, conflicts }
}

/** '초안' 표시 — 오너가 그 칸을 고치면 이름을 뺀다(다 빠지면 undefined) */
export function clearDraftMark(draftPrefill: readonly string[] | undefined, field: string): string[] | undefined {
  const rest = (draftPrefill ?? []).filter((f) => f !== field)
  return rest.length > 0 ? rest : undefined
}

const isEmpty = (v: unknown) => v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

/**
 * 등록 초안 → 지금 spec(W2a draftToSpecPrefill). 상품명은 초안이 있으면 초안이 이긴다(기존 규칙), 나머지 칸은 비어 있을 때만 채운다.
 * draftPrefill에는 실제로 채운 칸 이름만(PREFILL_FIELDS 8개 안) 남긴다 — 서버가 다른 이름을 버린다
 */
export function applyDraftPrefill(spec: PdpSpecSheet, draft: DraftPrefillSource): PdpSpecSheet {
  const { patch, filled } = draftToSpecPrefill(draft)
  const next: PdpSpecSheet = { ...spec }
  const applied: PrefillField[] = []
  for (const field of filled) {
    const value = patch[field]
    if (value === undefined || (field !== 'productName' && !isEmpty(spec[field]))) continue
    ;(next as unknown as Record<string, unknown>)[field] = value
    applied.push(field)
  }
  // 검색 태그는 화면 칸이 없는 판정 입력(parent-proxy) — 비어 있을 때만 옮기고 초안 표시는 하지 않는다
  if (patch.searchTags && !spec.searchTags?.length) next.searchTags = patch.searchTags
  const marks = [...new Set([...(spec.draftPrefill ?? []), ...applied])].filter((f) => (PREFILL_FIELDS as readonly string[]).includes(f))
  if (marks.length > 0) next.draftPrefill = marks
  return next
}

/** 인용 카드 고르기 — 고른 것이면 빼고, 아니면 6장까지 더한다(글은 150자에서 자르기만) */
/**
 * 인용 카드로 쓸 수 없는 후보(W2a blocked)의 사유 칩 문구 — 카드 단계가 어차피 빼는 글이라 화면은 흐리게 두고 고를 수 없게 한다.
 * 사유는 화면 표시용이고 고른 카드(reviewQuotes)에는 남기지 않는다(toggleQuote가 id·글·별점·옵션·작성 월·가린 작성자만 옮긴다)
 */
export const QUOTE_BLOCK_LABELS: Record<ReviewCandidateBlock, string> = {
  '인증·인허가': '인증·인허가 표현 — 인용 불가',
  '의학·기능성': '의학·기능성 효능 표현 — 인용 불가',
  최상급: '최상급 표현 — 인용 불가',
  대가성: '체험단·협찬 후기 — 인용 불가',
  정화: '개인정보 삭제 표시 — 인용 불가',
  요약: '한두 문장(70자)으로 줄일 수 없음 — 인용 불가',
}

export function toggleQuote(selected: readonly ReviewQuote[], candidate: ReviewCandidate): ReviewQuote[] {
  if (selected.some((q) => q.id === candidate.id)) return selected.filter((q) => q.id !== candidate.id)
  if (selected.length >= QUOTE_MAX || candidate.blocked) return [...selected]
  const { id, text, rating, option, month, author, cardSummary } = candidate
  return [
    ...selected,
    {
      id,
      text: clipText(text, QUOTE_TEXT_MAX),
      rating,
      ...(option ? { option } : {}),
      ...(month ? { month } : {}),
      ...(author ? { author } : {}),
      ...(cardSummary ? { cardSummary } : {}),
    },
  ]
}

/** 페이지 카드에 실릴 글 — 본문에서 고른 문장이 있으면 그 문장. 강조 조각은 이 글에서 고른다(요약에 없는 조각은 카드 단계가 버린다) */
export function quoteCardText(quote: Pick<ReviewQuote, 'text' | 'cardSummary'>): string {
  return quote.cardSummary ?? quote.text
}

/** 강조 후보 조각 — 공백으로 나눈 낱말에서 앞뒤 문장부호를 떼고, 두 글자 이상·12자 이하만(중복 없이, 나온 순서) */
export function highlightChips(text: string): string[] {
  const seen = new Set<string>()
  for (const raw of text.split(/\s+/)) {
    const word = raw.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')
    if ([...word].length >= 2 && word.length <= HIGHLIGHT_CHARS_MAX) seen.add(word)
  }
  return [...seen]
}

/** 강조 켜고 끄기 — 글 안에 실제로 있는 12자 이하 조각만, 3개까지 */
export function toggleHighlight(quote: ReviewQuote, chip: string): ReviewQuote {
  const current = quote.highlights ?? []
  if (current.includes(chip)) {
    const rest = current.filter((h) => h !== chip)
    return { ...quote, highlights: rest.length > 0 ? rest : undefined }
  }
  if (current.length >= HIGHLIGHT_MAX || chip.length > HIGHLIGHT_CHARS_MAX || !quoteCardText(quote).includes(chip)) return quote
  return { ...quote, highlights: [...current, chip] }
}
