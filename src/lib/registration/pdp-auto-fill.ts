// 상세페이지 자동 작성(PDP-W2W3 계약 v1 §2-2) — 요청 정리·응답 정리. 순수 함수(라우트·에이전트·시험이 함께 쓴다).
//
// - POST /api/registration/pdp/auto-fill이 상품 정보로 타겟 페르소나·브랜드 보이스·브랜드 컬러 제안을 돌려준다. 제안만 준다 —
//   덮어쓸지는 화면이 정한다(계약 §4: 빈 칸만 채우고, 이미 쓴 칸은 '바꾸기').
// - 규제 표현(인증·인허가·의학·기능성)은 프롬프트로 막고, 응답에 남아 있으면 그 문장을 뺀다(남는 문장이 없으면 칸을 버린다 — 규제 사전
//   eval/claim-lexicon, 인용 차단·카피 검출과 같은 사전). 사용 효익은 살린다. 보이스 가이드는
//   카피 프롬프트에 그대로 들어가므로(pdp-copy-agent brandVoiceGuide) 거기에 의학·인증 주장이 섞이면 카피 전체로 번진다.

import { isDiseaseNameTerm, quoteDiseaseTermsIn, regulatedClaimTermsIn } from './eval/claim-lexicon'
import { normalizeSpecInputs } from './spec-inputs'
import { isAchromaticExtreme } from './reference-image-quality'
import type { PdpSpecSheet } from './pdp-state'
import { clipUtf16 } from './text-clip'

/** ai_usage_log agent·stage 이름(계약 §2-2) */
export const AUTO_FILL_AGENT = 'registration/pdp-auto-fill'
/** 리뷰 원문은 앞 4,000자만 쓴다(계약) */
export const AUTO_FILL_REVIEWS_MAX_CHARS = 4000
export const AUTO_FILL_IMAGE_LIMIT = 2
export const AUTO_FILL_PERSONA_MAX_CHARS = 200
export const AUTO_FILL_VOICE_MAX_CHARS = 400

const NAME_MAX = 200
const CATEGORY_MAX = 100
const BRAND_MAX = 60
const TEXT_FIELD_MAX = 200
const LIST_LIMIT = 20
const LIST_ITEM_MAX = 100

/** 요청 specSheet에서 읽는 칸(계약) — 나머지 키는 버린다 */
export type AutoFillSpecInput = Pick<
  PdpSpecSheet,
  'material' | 'size' | 'weight' | 'origin' | 'extraSpecs' | 'keyFeatures' | 'colorOptions' | 'usageLocation'
>

export interface AutoFillRequest {
  productName: string
  category?: string
  brandName?: string
  specSheet: AutoFillSpecInput
  reviewsText?: string
  imageUrls: string[]
}

export interface AutoFillSuggestions {
  targetPersona?: string
  brandVoiceGuide?: string
  brandHexColor?: string
}

export type AutoFillField = keyof AutoFillSuggestions

/** 응답(계약 §2-2). warnings는 덧붙임 — 버린 제안·읽지 못한 이미지 */
export interface AutoFillResponse {
  suggestions: AutoFillSuggestions
  model: string
  costUsd: number
  warnings?: string[]
}

const oneLine = (v: string) => v.replace(/\s+/g, ' ').trim()

function optionalText(v: unknown, max: number): string | undefined | null {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') return null
  const text = clipUtf16(oneLine(v), max).trim()
  return text || undefined
}

function textList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const items = [
    ...new Set(
      v
        .filter((x): x is string => typeof x === 'string')
        .map((x) => clipUtf16(oneLine(x), LIST_ITEM_MAX).trim())
        .filter(Boolean)
    ),
  ].slice(0, LIST_LIMIT)
  return items.length ? items : undefined
}

function cleanSpec(raw: unknown): AutoFillSpecInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const r = raw as Record<string, unknown>
  // 무게·원산지·추가 스펙은 잡 저장과 같은 한도로 정리한다(spec-inputs)
  const { weight, origin, extraSpecs } = normalizeSpecInputs({
    productName: '-',
    weight: r.weight as string,
    origin: r.origin as string,
    extraSpecs: r.extraSpecs as AutoFillSpecInput['extraSpecs'],
  })
  const out: AutoFillSpecInput = {}
  for (const key of ['material', 'size', 'usageLocation'] as const) {
    const text = optionalText(r[key], TEXT_FIELD_MAX)
    if (text) out[key] = text
  }
  if (weight) out.weight = weight
  if (origin) out.origin = origin
  if (extraSpecs) out.extraSpecs = extraSpecs
  const keyFeatures = textList(r.keyFeatures)
  if (keyFeatures) out.keyFeatures = keyFeatures
  const colorOptions = textList(r.colorOptions)
  if (colorOptions) out.colorOptions = colorOptions
  return out
}

type Parsed = { ok: true; value: AutoFillRequest } | { ok: false; error: string }

/** 요청 본문 → 정리한 요청. 상품명은 필수, 이미지는 http(s) 2장 이하(서버가 내려받는다), 리뷰는 앞 4,000자 */
export function parseAutoFillRequest(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '요청 본문이 필요합니다.' }
  const body = raw as Record<string, unknown>
  const productName = optionalText(body.productName, NAME_MAX)
  if (!productName) return { ok: false, error: '상품명(productName)은 필수입니다.' }
  const category = optionalText(body.category, CATEGORY_MAX)
  const brandName = optionalText(body.brandName, BRAND_MAX)
  if (category === null || brandName === null) return { ok: false, error: 'category·brandName은 문자열이어야 합니다.' }
  if (body.reviewsText !== undefined && body.reviewsText !== null && typeof body.reviewsText !== 'string') {
    return { ok: false, error: 'reviewsText는 문자열이어야 합니다.' }
  }
  const reviewsText =
    typeof body.reviewsText === 'string' ? clipUtf16(body.reviewsText.trim(), AUTO_FILL_REVIEWS_MAX_CHARS).trim() : ''
  if (body.imageUrls !== undefined && body.imageUrls !== null && !Array.isArray(body.imageUrls)) {
    return { ok: false, error: 'imageUrls는 배열이어야 합니다.' }
  }
  const imageUrls = (Array.isArray(body.imageUrls) ? body.imageUrls : []).map((u) => String(u).trim()).filter(Boolean)
  if (imageUrls.length > AUTO_FILL_IMAGE_LIMIT) {
    return { ok: false, error: `이미지는 ${AUTO_FILL_IMAGE_LIMIT}장까지 보낼 수 있습니다.` }
  }
  // 서버가 내려받는 URL이므로 http(s)만 받는다(잡 생성 참조 이미지와 같은 규칙)
  if (imageUrls.some((u) => !/^https?:\/\//i.test(u))) {
    return { ok: false, error: '이미지는 http(s) URL이어야 합니다.' }
  }
  return {
    ok: true,
    value: {
      productName,
      ...(category ? { category } : {}),
      ...(brandName ? { brandName } : {}),
      specSheet: cleanSpec(body.specSheet),
      ...(reviewsText ? { reviewsText } : {}),
      imageUrls,
    },
  }
}

// ── 응답 정리 ──

/**
 * 제안 글에서 찾은 규제 표현(인증·인허가·의학·기능성 — eval/claim-lexicon 규제 사전, 고지·부정 문맥 제외). 없으면 빈 배열.
 * 사용 효익('냄새 제거'·'시원함')은 규제 표현이 아니라 남긴다(2026-10-30 오너 지시)
 */
export function autoFillClaimTerms(text: string): string[] {
  // 규제 사전의 질병·증상명 단독(2026-10-31부터 medical)도 고객의 고민 서술('탈모 고민이 있는 30대' — 오너 계약 예시)이면 남긴다
  const regulated = regulatedClaimTermsIn(text, { negation: true })
    .map((c) => c.term)
    .filter((t) => !(isDiseaseNameTerm(t) && onlyAsWorry(text, t)))
  // 질병·증상명 단독(인용 묶음 — 비듬 포함)도 뺀다 — 리뷰에서 온 '턱드름' 같은 말이 제안 글로 넘어가지 않게(2026-10-30).
  // 규제 표현에 이미 든 이름('탈모 예방'의 탈모)은 다시 세지 않고, 고객의 고민 서술은 남긴다
  const disease = quoteDiseaseTermsIn(text).filter(
    (d) => !regulated.some((t) => t.includes(d)) && !onlyAsWorry(text, d)
  )
  return [...new Set([...regulated, ...disease])]
}

/**
 * 이름이 나오는 자리마다 바로 뒤가 고민 서술(조사 + 고민·걱정·신경·스트레스)인가 — 고민이 사라진다는 말('걱정 없는'·'고민 해결'·
 * '걱정 끝')이 이어지면 효능 암시라 고민 서술로 보지 않는다
 */
const WORRY_AFTER_RE =
  /^\s*(?:이|가|을|를|에|의|로|으로|때문에)?\s*(?:고민|걱정|신경|스트레스)(?!\S*\s*(?:이|가|을|를|은|는)?\s*(?:없|끝|해결|해소|사라|덜|줄|안녕|탈출|그만))/
function onlyAsWorry(text: string, name: string): boolean {
  const ends = [...text.matchAll(new RegExp(name, 'g'))].map((m) => (m.index ?? 0) + name.length)
  return ends.length > 0 && ends.every((end) => WORRY_AFTER_RE.test(text.slice(end)))
}

/** 문장 끝(문장부호 뒤 띄어쓰기)에서 나눈다 */
const splitSentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean)

function cleanHex(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const m = v.trim().match(/^#?([0-9a-f]{6})$/i)
  return m ? `#${m[1].toUpperCase()}` : undefined
}

const FIELD_LABEL: Record<AutoFillField, string> = {
  targetPersona: '타겟 페르소나',
  brandVoiceGuide: '브랜드 보이스',
  brandHexColor: '브랜드 컬러',
}

/**
 * 모델 응답 JSON → 제안. 글은 공백을 한 칸으로 줄이고 상한으로 자른다. 인증·의학 표현이 있는 문장은 빼고(남은 문장이 없으면
 * 칸을 버린다 — 고지 문장 하나 때문에 보이스 전체를 잃지 않게), #RRGGBB가 아니거나 검정·흰색에 가까운 컬러는 버린다.
 * 뺀 것은 경고로 남긴다(화면은 경고를 보여 준다)
 */
export function normalizeAutoFillSuggestions(raw: Record<string, unknown> | null): {
  suggestions: AutoFillSuggestions
  warnings: string[]
} {
  const suggestions: AutoFillSuggestions = {}
  const warnings: string[] = []
  const r = raw ?? {}
  const texts: Array<['targetPersona' | 'brandVoiceGuide', number]> = [
    ['targetPersona', AUTO_FILL_PERSONA_MAX_CHARS],
    ['brandVoiceGuide', AUTO_FILL_VOICE_MAX_CHARS],
  ]
  for (const [field, max] of texts) {
    const text = typeof r[field] === 'string' ? clipUtf16(oneLine(r[field] as string), max).trim() : ''
    if (!text) continue
    const terms = autoFillClaimTerms(text)
    if (!terms.length) {
      suggestions[field] = text
      continue
    }
    const sentences = splitSentences(text)
    const kept = sentences.filter((s) => autoFillClaimTerms(s).length === 0)
    const shown = terms.slice(0, 3).join(', ')
    // 문장 경계를 넘는 표현이라 어느 문장에서도 안 잡히면 칸을 통째로 버린다
    if (!kept.length || kept.length === sentences.length) {
      warnings.push(`${FIELD_LABEL[field]} 제안에 인증·의학 표현(${shown})이 있어 뺐습니다.`)
      continue
    }
    suggestions[field] = kept.join(' ')
    warnings.push(`${FIELD_LABEL[field]} 제안에서 인증·의학 표현(${shown})이 있는 문장을 뺐습니다.`)
  }
  if (r.brandHexColor !== undefined && r.brandHexColor !== null && r.brandHexColor !== '') {
    const hex = cleanHex(r.brandHexColor)
    if (!hex) warnings.push(`${FIELD_LABEL.brandHexColor} 제안이 #RRGGBB 형식이 아니라 뺐습니다.`)
    else if (isAchromaticExtreme(hex))
      warnings.push(`${FIELD_LABEL.brandHexColor} 제안(${hex})이 검정·흰색에 가까워 뺐습니다.`)
    else suggestions.brandHexColor = hex
  }
  return { suggestions, warnings }
}
