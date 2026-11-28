// 상세페이지 입력 배선(W2a, PDP-W2W3 계약 v1 §1·§2-3) — 순수 함수만(화면·서버가 함께 쓴다, 런타임 의존 없음).
//
// - normalizeSpecInputs: 새 spec_sheet 필드(weight·origin·extraSpecs·reviewQuotes·draftPrefill·searchTags)를 계약 한도로 정리한다. 잡 생성
//   라우트(POST /api/registration/pdp)가 저장 전에 부른다. 이 필드가 없는 spec은 그대로 돌려준다(골든·기존 잡 불변).
// - draftToSpecPrefill: 등록 초안(소싱 → 등록 폼)의 고시정보·옵션·브랜드·상품명을 spec 칸으로 옮긴다. 근거는 세션 A 조사
//   (SPEC-FIELD-USAGE.md — PdpForm이 초안에서 상품명만 받아 고시정보·옵션·브랜드가 카피에 가지 않았다). 오너가 화면에서 확인·수정한다.
//   검색 태그는 화면 칸 없이 spec_sheet.searchTags로만 옮긴다 — 학부모 대리 구매형 판정(parent-proxy) 입력이고 프롬프트에는 넣지 않는다.

import type { PdpSpecSheet } from './pdp-state'
import type { RegistrationForm } from '@/lib/sourcing/registration/form'
import {
  REVIEW_OPTION_MAX_CHARS,
  REVIEW_QUOTE_HIGHLIGHT_LIMIT,
  REVIEW_QUOTE_HIGHLIGHT_MAX_CHARS,
  REVIEW_QUOTE_LIMIT,
  REVIEW_QUOTE_MAX_CHARS,
  type ReviewQuote,
  REVIEW_SUMMARY_MAX_CHARS,
} from './reviews/review-types'
import { clipUtf16, dropLoneSurrogates } from './text-clip'
import { INPUT_SLOT_KEYS, normalizeInputSlots } from './input-slots'

/** 무게·원산지 글자 수 상한 */
export const SPEC_SHORT_TEXT_MAX = 40
export const EXTRA_SPECS_LIMIT = 12
export const EXTRA_SPEC_KEY_MAX = 20
export const EXTRA_SPEC_VALUE_MAX = 60
/** 검색 태그 — 등록 폼과 같은 20개, 한 개 30자 */
export const SEARCH_TAG_LIMIT = 20
export const SEARCH_TAG_MAX = 30
const QUOTE_ID_MAX = 64

/** 초안 프리필이 채울 수 있는 칸 — draftPrefill에는 이 이름만 남긴다 */
export const PREFILL_FIELDS = [
  'productName',
  'brandName',
  'material',
  'size',
  'weight',
  'origin',
  'colorOptions',
  'extraSpecs',
] as const satisfies readonly (keyof PdpSpecSheet)[]
export type PrefillField = (typeof PREFILL_FIELDS)[number]

const oneLine = (v: string) => v.replace(/\s+/g, ' ').trim()
const isString = (v: unknown): v is string => typeof v === 'string'

function shortText(v: unknown, max: number): string | null {
  if (!isString(v)) return null
  const text = clipUtf16(oneLine(v), max).trim()
  return text ? text : null
}

/** 빈 행을 지우고, key가 겹치면 마지막 값(마지막 자리)을 쓰고, 한도로 자른다 */
function cleanExtraSpecs(v: unknown): Array<{ key: string; value: string }> {
  if (!Array.isArray(v)) return []
  const byKey = new Map<string, string>()
  for (const row of v) {
    if (!row || typeof row !== 'object') continue
    const key = shortText((row as { key?: unknown }).key, EXTRA_SPEC_KEY_MAX)
    const value = shortText((row as { value?: unknown }).value, EXTRA_SPEC_VALUE_MAX)
    if (!key || !value) continue
    byKey.delete(key)
    byKey.set(key, value)
  }
  return [...byKey.entries()].slice(0, EXTRA_SPECS_LIMIT).map(([key, value]) => ({ key, value }))
}

/** 한 줄로 펴고 30자에서 자른 뒤, 빈 태그·중복을 지우고 20개까지 */
function cleanSearchTags(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const tags = v.map((t) => shortText(t, SEARCH_TAG_MAX)).filter((t): t is string => t !== null)
  return [...new Set(tags)].slice(0, SEARCH_TAG_LIMIT)
}

const QUOTE_MONTH_RE = /^\d{4}\.(?:0[1-9]|1[0-2])$/
/** 가린 작성자 — 한 글자 + *1~3개 */
const QUOTE_MASKED_AUTHOR_RE = /^[^*\s]\*{1,3}$/u

/** 카드 6장 이하·글 150자 이하·평점 1~5 정수·강조는 글 안에 있는 12자 이하 조각 3개까지. id가 겹치면 앞 카드만 */
function cleanReviewQuotes(v: unknown): ReviewQuote[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: ReviewQuote[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const q = raw as Record<string, unknown>
    const id = shortText(q.id, QUOTE_ID_MAX)
    const text = shortText(q.text, REVIEW_QUOTE_MAX_CHARS)
    const rating = typeof q.rating === 'number' ? Math.round(q.rating) : NaN
    if (!id || !text || !(rating >= 1 && rating <= 5) || seen.has(id)) continue
    seen.add(id)
    const option = shortText(q.option, REVIEW_OPTION_MAX_CHARS)
    // 카드에 실을 문장은 자르면 문장이 끊긴다 — 상한을 넘으면 버린다(카드 단계가 글에서 다시 고른다)
    const summaryText = typeof q.cardSummary === 'string' ? dropLoneSurrogates(q.cardSummary).trim() : ''
    const cardSummary = summaryText.length <= REVIEW_SUMMARY_MAX_CHARS ? summaryText : ''
    const highlights = Array.isArray(q.highlights)
      ? [
          ...new Set(
            q.highlights
              .filter(isString)
              .map((h) => dropLoneSurrogates(h).trim())
              .filter(
                (h) =>
                  h.length > 0 &&
                  h.length <= REVIEW_QUOTE_HIGHLIGHT_MAX_CHARS &&
                  (text.includes(h) || cardSummary.includes(h))
              )
          ),
        ].slice(0, REVIEW_QUOTE_HIGHLIGHT_LIMIT)
      : []
    // 작성 월은 'YYYY.MM'만, 작성자는 가린 꼴('김**' — *가 있는 짧은 글)만 남긴다(P1-6 — 원래 이름이 저장되지 않게)
    const month = typeof q.month === 'string' && QUOTE_MONTH_RE.test(q.month) ? q.month : ''
    const author = typeof q.author === 'string' && QUOTE_MASKED_AUTHOR_RE.test(q.author.trim()) ? q.author.trim() : ''
    out.push({
      id,
      text,
      rating,
      ...(option ? { option } : {}),
      ...(highlights.length ? { highlights } : {}),
      ...(month ? { month } : {}),
      ...(author ? { author } : {}),
      ...(cardSummary ? { cardSummary } : {}),
    })
    if (out.length >= REVIEW_QUOTE_LIMIT) break
  }
  return out
}

/**
 * 새 입력 필드를 계약 한도로 정리한 spec — 다른 필드는 그대로다. 정리한 결과가 비면 그 키를 지운다.
 * 새 필드가 하나도 없으면 같은 객체를 돌려준다(저장 바이트 불변)
 */
export function normalizeSpecInputs(spec: PdpSpecSheet): PdpSpecSheet {
  const keys = ['weight', 'origin', 'extraSpecs', 'reviewQuotes', 'draftPrefill', 'searchTags', ...INPUT_SLOT_KEYS] as const
  if (!keys.some((k) => k in spec)) return spec
  const { weight, origin, extraSpecs, reviewQuotes, draftPrefill, searchTags, ...rest } = spec
  const out: PdpSpecSheet = normalizeInputSlots({ ...rest })
  const w = shortText(weight, SPEC_SHORT_TEXT_MAX)
  if (w) out.weight = w
  const o = shortText(origin, SPEC_SHORT_TEXT_MAX)
  if (o) out.origin = o
  const specs = cleanExtraSpecs(extraSpecs)
  if (specs.length) out.extraSpecs = specs
  const quotes = cleanReviewQuotes(reviewQuotes)
  if (quotes.length) out.reviewQuotes = quotes
  const filled = Array.isArray(draftPrefill)
    ? [
        ...new Set(
          draftPrefill.filter((f): f is PrefillField => (PREFILL_FIELDS as readonly string[]).includes(f as string))
        ),
      ]
    : []
  if (filled.length) out.draftPrefill = filled
  const tags = cleanSearchTags(searchTags)
  if (tags.length) out.searchTags = tags
  return out
}

// ── 초안 프리필 ──

/** 초안에서 읽는 칸 — 등록 폼(RegistrationForm)의 일부. 검색 태그는 예전 초안·시험 입력에 없을 수 있다 */
export type DraftPrefillSource = Pick<RegistrationForm, 'productName' | 'brand' | 'options' | 'notice'> &
  Partial<Pick<RegistrationForm, 'searchTags'>>

/** 고시 항목명 → spec 칸(앞 규칙 먼저, 한 칸은 첫 값만). 용량은 크기가 아니라 추가 스펙으로 둔다 */
const NOTICE_FIELD_RULES: Array<{ field: 'origin' | 'weight' | 'material' | 'size'; re: RegExp }> = [
  { field: 'origin', re: /원산지|제조국/ },
  { field: 'weight', re: /무게|중량/ },
  { field: 'material', re: /소재|재질/ },
  { field: 'size', re: /크기|치수|사이즈|규격/ },
]
/** 스펙이 아닌 행정 항목 — 추가 스펙에도 넣지 않는다. A/S는 영문 낱말 속('CLASS')에서는 잡지 않는다 */
const NOTICE_SKIP =
  /(?<![A-Za-z])A\/?S(?![A-Za-z])|전화|품질\s*보증|주의\s*사항|제조(?:자|사|업자)|수입자|판매(?:자|업자)|책임자|소비자\s*상담|인증|허가|신고|제조\s*(?:연월|일자)|출시\s*년월/
/**
 * 값이 아닌 자리 표시('상세페이지 참조'·'별도 표기'·'해당 사항 없음' 등) — 고시 문구는 사실이 아니다. 평가 상품 준비
 * (scripts/pdp-eval/prepare-products.mjs EMPTY_NOTICE)와 같은 기준이고, 떠넘기는 문구가 사실 값처럼 카피에 다시 들어가지 않게 한다
 */
const PLACEHOLDER = /참조|참고|별도\s*표기|상세.*표기|해당\s*(?:사항\s*)?없|^\s*(?:[-.·]|없음|정보\s*없음|n\/?a)\s*$/i
/** 등록 옵션이 많아도 colorOptions는 이만큼만 */
const OPTION_PREFILL_LIMIT = 50

/**
 * 등록 초안 → spec 프리필. patch는 채울 칸만, filled는 그 칸 이름(화면 '초안' 표시·draftPrefill). 빈 값·자리 표시·행정 항목은 넣지 않는다.
 * 검색 태그는 patch에만 넣는다(화면 칸이 없어 filled·draftPrefill에는 없다)
 */
export function draftToSpecPrefill(draft: DraftPrefillSource): {
  patch: Partial<PdpSpecSheet>
  filled: PrefillField[]
} {
  const patch: Partial<PdpSpecSheet> = {}
  const productName = shortText(draft.productName, 200)
  if (productName) patch.productName = productName
  const brandName = shortText(draft.brand, 60)
  if (brandName) patch.brandName = brandName

  const extraSpecs: Array<{ key: string; value: string }> = []
  for (const [rawKey, rawValue] of Object.entries(draft.notice ?? {})) {
    const key = oneLine(rawKey)
    const value = isString(rawValue) ? oneLine(rawValue) : ''
    if (!key || !value || PLACEHOLDER.test(value) || NOTICE_SKIP.test(key)) continue
    const rule = NOTICE_FIELD_RULES.find((r) => r.re.test(key))
    if (rule) {
      const max = rule.field === 'origin' || rule.field === 'weight' ? SPEC_SHORT_TEXT_MAX : 200
      if (patch[rule.field] === undefined) patch[rule.field] = clipUtf16(value, max).trim()
      continue
    }
    extraSpecs.push({ key, value })
  }
  const specs = cleanExtraSpecs(extraSpecs)
  if (specs.length) patch.extraSpecs = specs

  const options = [
    ...new Set((draft.options ?? []).map((o) => (isString(o?.value) ? oneLine(o.value) : '')).filter(Boolean)),
  ].slice(0, OPTION_PREFILL_LIMIT)
  if (options.length) patch.colorOptions = options
  const tags = cleanSearchTags(draft.searchTags)
  if (tags.length) patch.searchTags = tags

  const filled = PREFILL_FIELDS.filter((f) => patch[f] !== undefined)
  return { patch, filled }
}
