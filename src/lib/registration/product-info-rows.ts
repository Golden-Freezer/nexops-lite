/**
 * 상품 정보 표 행의 정본(오너 지시 2026-11-01) — 디자인 컷 T9(infoRows)·조립 표(buildSpecTable)·편집기 표(legacySpecRows·specRowsFromInput)가 모두 이 함수를 쓴다.
 * 필수 행(이 순서): 상품명 · 브랜드 · 색상/수량 · 사이즈 · 소재 · 원산지 · 사용연령. 그 밖은 SPECIAL_INFO_KEY에 맞는 추가 스펙만 뒤에 붙인다.
 * 무게·등록 속성·추가 스펙을 자동으로 늘어놓지 않는다.
 * - 값이 비면 지어내지 않고 그 행만 뺀다(missingRequiredInfo가 빈 칸을 알려 준다 — H0).
 * - 사용연령은 표시만 '만 14세 이상'으로 고정한다(어린이 대상 상품이 아니라는 전제의 기본 표기, 상품명·후기의 어린이집·아이 표현과 무관 — 구매자가 학부모다).
 *   spec.minAgeYears는 읽지도 쓰지도 않는다 — 그 값은 연령 게이트(compliance-gate)·색(art-palette)을 바꾼다. 빼는 상품은 카테고리 표(AGE_EXEMPT_CATEGORIES)로만 정한다.
 * - 규제 표현이 든 행은 뺀다(claimSafeFactRows). 입력 값이 사용연령 행뿐이면 표를 만들지 않는다.
 */

import { isOptionSpec } from './options/option-spec'
import { claimSafeFactRows } from './eval/claim-lexicon'

export interface InfoRow {
  label: string
  value: string
}

export const AGE_LABEL = '사용연령'
export const AGE_VALUE = '만 14세 이상'
export const COLOR_QUANTITY_LABEL = '색상/수량'
export const REQUIRED_INFO_LABELS = ['상품명', '브랜드', COLOR_QUANTITY_LABEL, '사이즈', '소재', '원산지', AGE_LABEL] as const

/**
 * '특별한 내용' 허용 목록 — 추가 스펙 중 구매 판단에 꼭 필요한 이름만 표에 싣는다(공백 무시 앞부분 일치).
 * 구성품·용량·호환·전원·세탁 등(오너 예시)에 같은 뜻의 이름을 더했다. 무게·프레임 소재·무늬처럼 카피·사진으로 보이는 속성은 싣지 않는다.
 * 식품 내용량·화장품 사용기한은 값이 입력에 있을 때만 나온다(연구 A6 §11, 특별 행 3행 상한은 칸이 지킨다). 식품유형·원재료·영양·전성분은 싣지 않는다 — 법정표시는 쿠팡 고시 칸에 맡긴다(오너 답 2026-11-02)
 */
const SPECIAL_INFO_KEY = /^(구성품?|세트구성|내용량|용량|호환|전원|정격|소비전력|배터리|세탁|관리방법|보관방법|유통기한|소비기한|사용기한)/

/**
 * 사용연령 행을 빼는 카테고리 — 사용 대상이 사람이 아닌 카테고리(오너 2026-11-01)와 식품(오너 2026-11-02). 상품명 낱말이 아니라 카테고리 값으로만 판정하고, 비어 있으면 표기한다.
 * 판정 8종(spec.category)에 없는 구분은 세부 칸(spec.categoryDetail) 값으로 본다
 */
export const AGE_EXEMPT_CATEGORIES: ReadonlySet<string> = new Set([
  'pet', // 반려동물 용품
  'food', // 식품
  '식품', // 화면의 카테고리 직접 입력
])

/** 자동 감지 값 중 표시를 남기는 것 — 감지 프롬프트의 판정 값이라 직접 입력(식품)은 없다 */
const DETECTED_AGE_EXEMPT: ReadonlySet<string> = new Set(['pet', 'food'])

const LIST_MAX = 8
const LIST_CHARS_MAX = 80

const text = (value: unknown): string => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '')

/** 값 목록 → '데이지, 체리', 많거나 길면 'n가지' */
function listOf(values: readonly string[]): string {
  const unique = [...new Set(values.map((v) => v.trim()).filter(Boolean))]
  if (unique.length === 0) return ''
  const joined = unique.join(', ')
  return unique.length <= LIST_MAX && joined.length <= LIST_CHARS_MAX ? joined : `${unique.length}가지`
}

/** 색상/수량 행 값 — 등록 옵션 구조의 디자인·색상 축과 수량(축, 또는 모든 옵션이 같은 수량), 없으면 색상 옵션·색상 입력 */
function colorQuantityOf(spec: Record<string, unknown>): string {
  const option = spec.optionSpec
  if (isOptionSpec(option)) {
    const axis = (kind: 'design' | 'color' | 'quantity') => option.axes.find((a) => a.kind === kind)
    const looks = (['design', 'color'] as const).flatMap((kind) => axis(kind)?.values ?? [])
    const same = [...new Set(option.variants.map((v) => v.values.quantity ?? ''))]
    const quantity = axis('quantity')?.values ?? (same.length === 1 && same[0] ? same : [])
    return [listOf(looks), listOf(quantity)].filter(Boolean).join(' / ')
  }
  const colors = Array.isArray(spec.colorOptions) ? spec.colorOptions.map(text) : []
  return listOf(colors) || text(spec.color)
}

function sizeOf(spec: Record<string, unknown>): string {
  const typed = text(spec.size)
  if (typed) return typed
  const option = spec.optionSpec
  return isOptionSpec(option) ? listOf(option.axes.find((a) => a.kind === 'size')?.values ?? []) : ''
}

/** 사용연령 행을 빼는 상품인가 — 카테고리 표로만 판정. 사람이 고른 카테고리가 먼저이고, 비었을 때만 분석 단계가 남긴 감지 값을 본다 */
export function isAgeExempt(spec: Record<string, unknown> | object): boolean {
  const rec = spec as Record<string, unknown>
  return AGE_EXEMPT_CATEGORIES.has(text(rec.category) || text(rec.detectedCategory)) || AGE_EXEMPT_CATEGORIES.has(text(rec.categoryDetail))
}

/**
 * 자동 감지한 카테고리가 사용연령 면제(반려동물·식품)면 표시를 남긴 spec, 아니면 null — 표는 spec만 보는데 감지 값은 analysis에 있어 '카테고리 자동 감지'로 만든
 * 그런 잡에 사용연령 행이 남는다. 분석 단계가 한 번 남긴다. 사람이 고른 카테고리와 다른 카테고리는 건드리지 않는다.
 * category에는 쓰지 않는다 — 프롬프트 스펙 JSON에 들어가고 재실행 때 감지 콜을 건너뛰게 된다
 */
export function specWithDetectedExempt<T extends { productName: string; category?: string }>(spec: T, detectedCategory: unknown): (T & { detectedCategory: string }) | null {
  return typeof detectedCategory === 'string' && DETECTED_AGE_EXEMPT.has(detectedCategory) && !text(spec.category) ? { ...spec, detectedCategory } : null
}

/** 필수 행 값(비면 '') — 표와 H0 빈 칸이 같은 값을 본다. 사용연령은 넣지 않는다(고정 표기) */
function requiredValues(spec: Record<string, unknown>): Array<[string, string]> {
  return [
    ['상품명', text(spec.productName) || text(spec.name)],
    ['브랜드', text(spec.brandName)],
    [COLOR_QUANTITY_LABEL, colorQuantityOf(spec)],
    ['사이즈', sizeOf(spec)],
    ['소재', text(spec.material)],
    ['원산지', text(spec.origin)],
  ]
}

/** 추가 스펙(extraSpecs)·자유 필드(extra) 중 허용 목록에 맞는 행. 내부 값(카멜 표기)은 맞지 않는다 */
function specialRows(spec: Record<string, unknown>): InfoRow[] {
  const listed = Array.isArray(spec.extraSpecs) ? (spec.extraSpecs as Array<{ key?: unknown; value?: unknown }>).map((e) => [text(e?.key), text(e?.value)] as const) : []
  const free = spec.extra && typeof spec.extra === 'object' && !Array.isArray(spec.extra) ? Object.entries(spec.extra as Record<string, unknown>).map(([k, v]) => [k.trim(), text(v)] as const) : []
  const seen = new Set<string>()
  const rows: InfoRow[] = []
  for (const [label, value] of [...listed, ...free]) {
    if (!value || seen.has(label) || !SPECIAL_INFO_KEY.test(label.replace(/\s+/g, ''))) continue
    seen.add(label)
    rows.push({ label, value })
  }
  return rows
}

/** 표에 실어도 되는 행 이름인가 — 필수 7행 또는 특별한 내용(채점의 표 행 검사가 쓴다) */
export const isListedInfoLabel = (label: string): boolean =>
  (REQUIRED_INFO_LABELS as readonly string[]).includes(label) || SPECIAL_INFO_KEY.test(label.replace(/\s+/g, ''))

/** 상품 정보 표 행 */
export function productInfoRows(specSheet: Record<string, unknown> | object | undefined): InfoRow[] {
  if (!specSheet) return []
  const spec = specSheet as Record<string, unknown>
  const required = requiredValues(spec)
    .filter(([, value]) => value)
    .map(([label, value]) => ({ label, value }))
  const rows = claimSafeFactRows([...required, ...specialRows(spec)], spec.certificationInfo)
  if (rows.length === 0) return []
  // 고정 표기는 원산지 뒤, 특별한 내용 앞(필수 행 순서)
  if (isAgeExempt(spec)) return rows
  const at = rows.findIndex((r) => !(REQUIRED_INFO_LABELS as readonly string[]).includes(r.label))
  const age = { label: AGE_LABEL, value: AGE_VALUE }
  return at < 0 ? [...rows, age] : [...rows.slice(0, at), age, ...rows.slice(at)]
}

/** 필수 행 중 값이 없는 칸(H0 '필수 행 빈 칸') — 규제 표현으로 빠지는 행은 값이 있으니 세지 않는다 */
export function missingRequiredInfo(specSheet: Record<string, unknown> | object): string[] {
  return requiredValues(specSheet as Record<string, unknown>)
    .filter(([, value]) => !value)
    .map(([label]) => label)
}
