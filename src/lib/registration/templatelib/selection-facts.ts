/**
 * K 라인 사실 예산과 근거(계획 §15, 15_TEMPLATE_LINE §2·§4) — 상품이 가진 사실·자료를 세고, 템플릿이 카피로 쓰는 사실 수를 잰다. 순수·결정론.
 */

import { pageCompareBasis } from '../compare-basis-read'
import { isFactClaimSafe } from '../eval/claim-lexicon'
import { cleanUsageSteps } from '../input-slots'
import { isOptionSpec } from '../options/option-spec'
import type { PdpSpecSheet } from '../pdp-state'
import { INGREDIENT_MIN, namedIngredientsOf, pageNoticesOf, scheduleOf } from './input-values'
import { PAGE_SECTIONS, type MetaImageSlot, type MetaTextSlot, type TemplateMeta } from './template-meta'
import { COMPARE_BASIS } from './template-types'

/** 한 사실을 실어도 되는 곳 수(계획 §15). 상품 정보 표에 실리면 그것도 한 곳이다 */
export const FACT_MAX_PLACES = 2
/** 카피로 사실을 새로 말하지 않는 자리 수 — 대표 컷·문제 제기·후기·상품 정보 표·마무리 등 */
const FACT_FREE_SECTIONS = 6

export interface ProductFact {
  text: string
  /** 상품 정보 표(필수 7행)에 실리는 사실 — 표가 한 곳을 쓴다 */
  inTable: boolean
}

const trimmed = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/**
 * 페이지에 실을 수 있는 상품 사실 — 규제 표현이 든 값은 세지 않는다. 옵션은 묶어서 하나다.
 * 상품명·브랜드와 고정 값인 사용연령은 표에만 실리고 이야기 칸을 쓰지 않아 세지 않는다.
 * usps는 장점 후보를 사실로 세는 잡(uspfacts 스위치, K4)만 준다 — 표에 실리지 않는 사실이고, 이미 있는 사실과 같은 글은 한 번만 센다.
 */
export function factsOf(spec: PdpSpecSheet, usps: readonly unknown[] = []): ProductFact[] {
  const rows: ProductFact[] = [
    ...[spec.material, spec.size, spec.origin].map((v) => ({ text: trimmed(v), inTable: true })),
    ...[spec.weight, spec.usageLocation].map((v) => ({ text: trimmed(v), inTable: false })),
    ...(spec.keyFeatures ?? []).map((v) => ({ text: trimmed(v), inTable: false })),
    ...(spec.extraSpecs ?? []).map((e) => ({ text: trimmed(e?.key) && trimmed(e?.value) ? `${trimmed(e.key)} ${trimmed(e.value)}` : '', inTable: false })),
    ...((spec.colorOptions?.length ?? 0) > 0 || spec.optionSpec ? [{ text: '옵션', inTable: true }] : []),
  ]
  const safe = rows.filter((row) => row.text && isFactClaimSafe(row.text, spec.certificationInfo))
  const seen = new Set(safe.map((row) => squashFact(row.text)))
  const extra = usps.flatMap((usp) => {
    const text = trimmed(usp)
    const key = squashFact(text)
    if (!text || seen.has(key) || !isFactClaimSafe(text, spec.certificationInfo)) return []
    seen.add(key)
    return [{ text, inTable: false }]
  })
  return [...safe, ...extra]
}

const squashFact = (text: string) => text.replace(/\s+/g, '').toLowerCase()

/**
 * 사실 예산 — 표에 실리는 사실은 한 곳, 나머지는 두 곳이 이야기 칸이다. 목표 섹션 수는 사실을 말하지 않는 자리 + 이야기 칸을
 * 20~22로 맞춘 값이다. 긴 페이지가 사실 예산보다 먼저이므로, 사실이 적어도 20개를 채움 섹션으로 맞춘다.
 */
export function factBudget(facts: readonly ProductFact[]): { places: number; targetSections: number } {
  const places = facts.reduce((sum, fact) => sum + (fact.inTable ? FACT_MAX_PLACES - 1 : FACT_MAX_PLACES), 0)
  return { places, targetSections: Math.min(PAGE_SECTIONS.max, Math.max(PAGE_SECTIONS.target, FACT_FREE_SECTIONS + places)) }
}

/** 한 사실이 FACT_MAX_PLACES를 넘는 섹션에 나오는가 — 입력 값이 글에 그대로 있을 때만 잡는다(바꿔 쓴 말은 카피 반복 검사 몫이다) */
export function factOveruse(facts: readonly string[], sectionTexts: readonly string[]): Array<{ fact: string; places: number }> {
  const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  const texts = sectionTexts.map(squash)
  return facts.flatMap((fact) => {
    const key = squash(fact)
    const places = key.length < 2 ? 0 : texts.filter((t) => t.includes(key)).length
    return places > FACT_MAX_PLACES ? [{ fact, places }] : []
  })
}

const copyFacts = (slot: MetaTextSlot | MetaImageSlot) => (slot.type === 'text' && slot.source !== 'input' ? slot.facts : 0)

/**
 * 템플릿이 카피로 쓰는 사실 수 — min은 필수만(목록은 min개 × 필수 칸), max는 전부(목록은 max개 × 전체 칸).
 * needs.facts와 다르게 입력값 슬롯을 뺀다. 후기 원문·표 값은 코드가 넣으므로 이야기 예산을 쓰지 않는다.
 */
export function copyFactRange(template: Pick<TemplateMeta, 'slots'>): { min: number; max: number } {
  let min = 0
  let max = 0
  for (const slot of Object.values(template.slots)) {
    if (slot.type !== 'list') {
      if (slot.required) min += copyFacts(slot)
      max += copyFacts(slot)
      continue
    }
    if (slot.source === 'input') continue
    const fields = Object.values(slot.fields)
    if (slot.required) min += slot.min * fields.reduce((sum, field) => sum + (field.required ? copyFacts(field) : 0), 0)
    max += slot.max * fields.reduce((sum, field) => sum + copyFacts(field), 0)
  }
  return { min, max }
}

/**
 * 쓰는 법을 말할 입력 칸 — 어디에 어떻게 쓰는지의 사실이고 순서는 아니다. 입력에 순서가 없어 how_to 템플릿은 번호를 쓰지 않는다.
 * 하네스 H0(availableEvidence)의 USAGE_SPEC_KEYS와 같은 목록이다
 */
const USAGE_SPEC_KEYS: readonly string[] = ['용도', '사용법', '사용 방법', '사용 부위', '착용']

/**
 * 쓰는 법을 말하는 특징 글(K만, 통합 11-03 07:0x) — 사용 동사는 끝맺음까지 붙은 꼴만(바르는·바르면·발라·눌러), '하면'류는 앞에 사용 동작 낱말이 있을 때만 본다.
 * D 공용 규칙(persuasion-signals USAGE_FEATURE_RE)은 '바르'·'하면' 조각이라 '바르게 세워지는'·'바르셀로나'·'편하면서도'에도 걸린다. K에서는 usage가 열리면
 * 구성 고치기가 사용법 섹션을 더하므로(T1-38) 근거 없는 섹션이 된다. D 규칙은 D 운영 영향과 함께 D3에서 본다. 하네스 H0(availableEvidence)와 같은 식이다
 */
export const USAGE_WORDING_RE =
  /(?:사용|세척|부착|설치|조립|착용|충전|보관|교체|분리|결합|연결|장착|세탁|밀봉|건조|흡착|고정)\s?(?:하면|하기만|하고|하는|해서|해 ?주|하세요|하시면)|바르(?:는|면|고|기|시면|세요)|발라|붙이(?:는|면|고|기|시면|세요)|붙여|끼우(?:는|면|고|기|시면|세요)|끼워|돌리(?:는|면|고|기|시면|세요)|돌려|누르(?:는|면|고|기|시면|세요)|눌러|당기(?:는|면|고|기|시면|세요)|당겨|뿌리(?:는|면|고|시면|세요)|뿌려|씌우(?:는|면|고|기|시면|세요)|씌워|여미(?:는|면|고|기|시면|세요)|여며|걸어\s?(?:두|놓)|거는|걸면|사용법|사용 방법|간편 사용|원터치/

/** 근거 잠금 섹션이 요구하는 자료 이름(규격 §2 needs.evidence) */
export const SECTION_EVIDENCE: Readonly<Record<string, string>> = {
  certification: 'certification',
  event_offer: 'offer',
  perf_metric: 'rating',
  review: 'review',
  faq: 'faq',
  ingredients: 'ingredient',
  notice: 'notice',
  // GIF 칸(움직이는 띠) — 근거 motion은 motionband 스위치 잡에만 select-line(lineEvidenceOf)이 세운다. 스펙만 보는 evidenceOf에는 없다
  motion_band: 'motion',
}

/**
 * 잠금 섹션을 함께 여는 다른 근거(J51b, 통합 decide 33) — 성과 섹션은 평점 또는 우리 판매량(sales)으로 연다.
 * 섹션은 SECTION_EVIDENCE나 여기 근거 가운데 하나만 있으면 열리고, 템플릿은 needs.evidence에 적은 근거가 모두 있어야 고른다
 */
export const SECTION_EVIDENCE_ALSO: Readonly<Record<string, readonly string[]>> = {
  perf_metric: ['sales'],
}

/** 섹션을 여는 근거 이름들 — 잠금이 아닌 섹션은 빈 목록 */
export function sectionLocks(section: string): string[] {
  const lock = SECTION_EVIDENCE[section]
  return lock ? [lock, ...(SECTION_EVIDENCE_ALSO[section] ?? [])] : []
}

/** 섹션이 열리는가 — 잠금이 아니거나 여는 근거가 하나라도 있으면 */
export function sectionOpen(section: string, evidence: ReadonlySet<string>): boolean {
  const locks = sectionLocks(section)
  return locks.length === 0 || locks.some((key) => evidence.has(key))
}

/**
 * 판매 칸 글자 상한(J51b) — 판매 템플릿의 sales·salesBasis 칸 maxChars와 같다(sales-cells.test가 맞춘다). 넘는 값은 어느 판매 템플릿에도 안 들어가므로
 * 근거를 세우지 않는다. 그래야 구성 고치기가 성과 섹션을 억지로 넣지 않고 판매 없는 잡처럼 간다(평점 템플릿이나 섹션 없음, 통합 decide 36)
 */
export const SALES_TOTAL_MAX_CHARS = 8
export const SALES_BASIS_MAX_CHARS = 24
const charsOf = (value: string) => value.replace(/\s+/g, '').length

/** 우리 판매량 합·기간 문구가 있고 판매 칸에 들어가는가 */
export function salesFits(line: { total?: unknown; basis?: unknown } | undefined): boolean {
  const total = trimmed(line?.total)
  const basis = trimmed(line?.basis)
  return total !== '' && basis !== '' && charsOf(total) <= SALES_TOTAL_MAX_CHARS && charsOf(basis) <= SALES_BASIS_MAX_CHARS
}

/** FAQ로 답할 수 있는 사실 칸 — 하네스 H0(availableEvidence)와 같은 목록이다 */
const FAQ_FACT_FIELDS = ['brandName', 'keyFeatures', 'material', 'size', 'weight', 'origin', 'usageLocation', 'colorOptions', 'extraSpecs', 'minAgeYears'] as const

const filled = (value: unknown) => {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') return value.trim() !== ''
  return value !== undefined && value !== null
}

/**
 * 상품이 가진 근거 — 규격 §2의 이름이고, 여는 기준은 하네스 H0(availableEvidence)와 같다. 수치·자료가 입력에 실제로 있을 때만 세운다.
 * 평점은 별점 칸이 빈 채 나오지 않게 평점과 후기 수가 함께 있거나 자사 리뷰 파일 집계에 평점이 있어야 한다.
 * 우리 판매량(sales, J51)은 잡 생성 때 서버가 남긴 합·기간 문구(ownSales)가 둘 다 있을 때만이다 — 판매 기록이 없거나 묶음 수량을 모르거나 합이 100 미만이면 서버가 남기지 않는다.
 */
export function evidenceOf(spec: PdpSpecSheet): Set<string> {
  const out = new Set<string>()
  const option = isOptionSpec(spec.optionSpec) ? spec.optionSpec : null
  const hasAxis = (kind: 'size' | 'quantity') => option?.axes.some((axis) => axis.kind === kind) ?? false
  const sameQuantity = new Set(option?.variants.map((variant) => variant.values.quantity ?? '') ?? [])
  const quantityOnAll = sameQuantity.size === 1 && !sameQuantity.has('')
  const ownReviews = Number(spec.reviewFiles?.own?.sampled ?? 0) > 0 || trimmed(spec.reviewsText) !== ''
  const ownRated = Object.values(spec.reviewFiles?.own?.stats?.rating_counts ?? {}).some((count) => Number(count) > 0)
  const answerable = FAQ_FACT_FIELDS.filter((field) => filled(spec[field])).length

  if ((spec.reviewQuotes?.length ?? 0) > 0) out.add('review')
  if (salesFits(spec.ownSales)) out.add('sales')
  if ((Number(spec.rating) > 0 && Number(spec.reviewCount) > 0) || ownRated) out.add('rating')
  if (trimmed(spec.certificationInfo)) out.add('certification')
  if (trimmed(spec.eventBannerInfo)) out.add('offer')
  if (ownReviews || answerable >= 2) out.add('faq')
  if (trimmed(spec.size) || hasAxis('size')) out.add('size')
  if ((spec.colorOptions?.length ?? 0) > 0 || option) out.add('option')
  if (hasAxis('quantity') || quantityOnAll) out.add('quantity')
  const usageSpec = (spec.extraSpecs ?? []).some((e) => USAGE_SPEC_KEYS.includes(trimmed(e?.key)) && trimmed(e?.value))
  const usageWords = (spec.keyFeatures ?? []).some((feature) => typeof feature === 'string' && USAGE_WORDING_RE.test(feature))
  // 사용 순서 입력(적용 K7-c (나) T1-61)·사용 주기 입력(적용 C5 ④) — 정리 뒤 남는 단계·주기가 있으면 쓰는 법 근거다
  if (usageWords || trimmed(spec.usageLocation) || usageSpec || cleanUsageSteps(spec.usageSteps).length > 0 || scheduleOf(spec).length > 0) out.add('usage')
  // 입력에 적힌 재료 이름이 둘 이상(적용 K3 R-W8) — 하네스 H0와 같은 식이다. 규제 표현 거르기는 칸을 채울 때 한다(input-values ingredient.*)
  if (namedIngredientsOf(spec).length >= INGREDIENT_MIN) out.add('ingredient')
  // 주의·보관 줄(적용 K7-c (가)) — 상품 정보 표가 싣지 않는 줄이 하나라도 있으면(칸 채우기와 같은 값). 규제 표현 거르기는 칸을 채울 때 한다
  if (pageNoticesOf(spec).length > 0) out.add('notice')
  // 비교 근거 입력(적용 C5 ② R-D2, 통합 11-04 03:3x ②) — 깎아내리기·타사 표식·규제 표현을 거르고 남는 행이 있으면. 어느 비교 칸을 고를지는
  // 칸마다 입력 꼴(행 수·기존 유무·글자 상한)이 맞을 때만이다(requiredInputsFit). 입력이 없으면 지금처럼 비교 잠금 칸을 고르지 않는다
  if (pageCompareBasis(spec).length > 0) out.add(COMPARE_BASIS)
  return out
}
