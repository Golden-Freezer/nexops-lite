// 다옵션 상품 데이터 계약 + 등록 옵션명 파서 (05_OPTIONS.md §3, T6a)
// 등록 옵션명("20개 생일답례-04", "20개 데이지(S)", "1개 검정 Free")은 축이 문자열에 섞여 있다.
// 결정론 규칙으로 수량·디자인·색상·사이즈 축으로 나누고, 나누지 못하면 단일 디자인 축 + 경고(추측 금지).

export type OptionAxisKind = 'quantity' | 'design' | 'color' | 'size'

/** 설득 플래너가 optionSpec으로 옵션 카탈로그를 넣을 때의 포함 사유 — 카피 블록(설득 흐름)이 이 사유로 옵션 카피 규칙을 붙인다(T6b) */
export const OPTION_SPEC_CATALOG_REASON = 'variants ≥ 2(등록 옵션 구조)'

/** 정규 순서 — axes는 항상 이 순서로 담는다 */
export const OPTION_AXIS_KINDS: readonly OptionAxisKind[] = ['quantity', 'design', 'color', 'size']

export const OPTION_AXIS_NAMES: Record<OptionAxisKind, string> = {
  quantity: '수량',
  design: '디자인',
  color: '색상',
  size: '사이즈',
}

export interface OptionAxis {
  kind: OptionAxisKind
  name: string
  values: string[]
}

export interface OptionVariant {
  /** 등록 옵션명 그대로(정규화 금지) */
  label: string
  /** 파싱된 모든 종류(변하지 않는 종류 포함) */
  values: Partial<Record<OptionAxisKind, string>>
  /** 이 옵션의 실제 사진(스토리지 경로). 디자인·색상 축이면 필수 */
  sourceImage?: string
  /** 근거 있는 차이만(예: '사이즈 S 12×16cm') */
  facts?: string[]
}

export interface OptionSpec {
  axes: OptionAxis[]
  variants: OptionVariant[]
  source: 'products' | 'openapi' | 'manual'
}

export type OptionParseWarningCode =
  | 'empty'
  | 'duplicate_label'
  | 'duplicate_combination'
  | 'too_many_axes'
  | 'inconsistent_axis'

export interface OptionParseWarning {
  code: OptionParseWarningCode
  labels: string[]
  detail?: string
}

export interface ParsedOptionLabels {
  spec: OptionSpec
  warnings: OptionParseWarning[]
  fallback: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// 토큰 규칙
// ─────────────────────────────────────────────────────────────────────────────

const QUANTITY_UNIT = '(?:개입|개|매입|매|장|P|p|팩|세트|셋트|set|SET|입|구|켤레|쌍|롤|박스|box|ea|EA)'
const QUANTITY_RE = new RegExp(`^\\d+${QUANTITY_UNIT}$`)
const QUANTITY_UNIT_RE = new RegExp(`^${QUANTITY_UNIT}$`)
const CONNECTOR_RE = /^[+\-/&·]+$/
const LETTER_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL'] as const
const FREE_SIZES = ['F', 'FREE', 'Free', 'free', '프리'] as const
const LETTER_SIZE_ALT = LETTER_SIZES.join('|')
const SIZE_TOKEN_RE = new RegExp(`^(?:${LETTER_SIZE_ALT}|${FREE_SIZES.join('|')})$`)
const SIZE_RANGE_RE = new RegExp(`^(?:${LETTER_SIZE_ALT})-(?:${LETTER_SIZE_ALT})$`)

// 치수: 단위(mm|cm|m) 붙은 숫자, 또는 x·×·* 로 이은 묶음(한쪽만 단위가 있어도 묶음 전체).
// 한글이 바로 붙은 치수("지름12cm")는 한글까지 한 값으로 본다. 라틴 문자·숫자 뒤는 치수가 아니다.
const NUM = String.raw`\d+(?:\.\d+)?`
const UNIT = '(?:mm|cm|m)'
const DIM_HEAD = String.raw`(?<![A-Za-z0-9.])\p{Script=Hangul}*`
const DIM_GROUP_RE = new RegExp(
  String.raw`${DIM_HEAD}${NUM}\s*${UNIT}?(?:\s*[xX×*]\s*${NUM}\s*${UNIT}?)+(?![\p{L}\p{N}])`,
  'gu',
)
const DIM_SINGLE_RE = new RegExp(String.raw`${DIM_HEAD}${NUM}\s*${UNIT}(?![\p{L}\p{N}])`, 'gu')
const HAS_UNIT_RE = /\d\s*(?:mm|cm|m)(?![a-z])/

// 색 이름은 토큰 끝에 올 때만 색으로 본다("피치핑크"·"챠콜그레이"·"반투명" ○, "Bluetooth"·"와인잔" ×).
// 다른 뜻의 합성어가 흔한 약한 색 이름은 앞부분이 비었거나 색 수식어·색일 때만("라이트크림" ○, "아이스크림" ×).
const STRONG_COLOR_WORDS = [
  '블랙', '화이트', '그레이', '그린', '브라운', '베이지', '핑크', '레드', '블루', '네이비', '퍼플',
  '라벤더', '옐로우', '옐로', '오렌지', '실버', '골드', '아이보리', '카키', '차콜', '챠콜', '검정',
  '검은색', '흰색', '회색', '빨강', '파랑', '노랑', '초록', '보라', '분홍', '갈색', '남색', '투명',
  '버건디', '코랄',
]
const WEAK_COLOR_WORDS = ['크림', '스킨', '와인', '하늘', '하늘색', '살구', '민트', '연두']
const ENGLISH_COLOR_WORDS = new Set([
  'black', 'white', 'gray', 'grey', 'pink', 'blue', 'red', 'green', 'brown', 'beige', 'navy', 'ivory',
])
const COLOR_MODIFIERS = new Set([
  '딥', '시크', '라이트', '다크', '모던', '오가닉', '세이지', '올리브', '러블리', '파스텔', '피치',
  '베이비', '매트', '무광', '유광', '밝은', '어두운', '스모키', '웜', '쿨',
])

function isColorWord(part: string): boolean {
  if (!part) return false
  if (ENGLISH_COLOR_WORDS.has(part.toLowerCase())) return true
  if (STRONG_COLOR_WORDS.some((w) => part.endsWith(w))) return true
  return WEAK_COLOR_WORDS.some((w) => {
    if (!part.endsWith(w)) return false
    const head = part.slice(0, -w.length)
    return head === '' || COLOR_MODIFIERS.has(head) || isColorWord(head)
  })
}

function isSizeText(text: string): boolean {
  const t = text.trim()
  return SIZE_TOKEN_RE.test(t) || SIZE_RANGE_RE.test(t)
}

function hasDimension(text: string): boolean {
  DIM_SINGLE_RE.lastIndex = 0
  const found = DIM_SINGLE_RE.test(text)
  DIM_SINGLE_RE.lastIndex = 0
  return found
}

type TokenKind = OptionAxisKind | 'modifier' | 'connector'

/** 단일 토큰 분류(문맥 없음). 색 수식어·연결 기호는 호출부가 문맥으로 정한다 */
function classifyToken(token: string): TokenKind {
  if (CONNECTOR_RE.test(token)) return 'connector'
  if (QUANTITY_RE.test(token)) return 'quantity'
  if (isSizeText(token)) return 'size'
  if (token.includes('-')) return token.split('-').every(isColorWord) ? 'color' : 'design'
  if (token.includes('+')) return token.split('+').every(isColorWord) ? 'color' : 'design'
  if (isColorWord(token)) return 'color'
  if (COLOR_MODIFIERS.has(token)) return 'modifier'
  return 'design'
}

interface Piece {
  kind: OptionAxisKind
  text: string
  index: number
}

/** 공백 토큰 목록 → 조각. 띄어 쓴 수량 합치기, 색 수식어·연결 기호 문맥 판정 */
function classifyTokens(raw: Array<{ text: string; index: number }>): Piece[] {
  const tokens: Array<{ text: string; index: number; kind: TokenKind }> = []
  for (let i = 0; i < raw.length; i += 1) {
    const next = raw[i + 1]
    if (/^\d+$/.test(raw[i].text) && next && QUANTITY_UNIT_RE.test(next.text)) {
      tokens.push({ text: `${raw[i].text} ${next.text}`, index: raw[i].index, kind: 'quantity' }) // "20 개"
      i += 1
    } else {
      tokens.push({ ...raw[i], kind: classifyToken(raw[i].text) })
    }
  }
  // 색 수식어는 바로 뒤 토큰이 색일 때만 색에 합친다(뒤에서부터 전파: "다크 딥 블랙")
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (tokens[i].kind === 'modifier') tokens[i].kind = tokens[i + 1]?.kind === 'color' ? 'color' : 'design'
  }
  // 띄어 쓴 연결 기호("블랙 + 화이트")는 양옆이 같은 종류일 때만 그 값에 남기고, 아니면 버린다
  const pieces: Piece[] = []
  tokens.forEach((t, i) => {
    if (t.kind !== 'connector') {
      pieces.push(t as Piece)
      return
    }
    const prev = tokens[i - 1]?.kind
    if (prev && prev !== 'connector' && prev === tokens[i + 1]?.kind) pieces.push({ ...t, kind: prev as OptionAxisKind })
  })
  return pieces
}

function tokensOf(text: string): Array<{ text: string; index: number }> {
  return [...text.matchAll(/\S+/g)].map((m) => ({ text: m[0], index: m.index ?? 0 }))
}

/** 이미 처리한 구간을 같은 길이 공백으로 지워 이후 인덱스를 보존한다 */
function blank(text: string, start: number, length: number): string {
  return text.slice(0, start) + ' '.repeat(length) + text.slice(start + length)
}

function toAxisKind(kind: TokenKind): OptionAxisKind {
  return kind === 'modifier' || kind === 'connector' ? 'design' : kind
}

function classifyParenGroup(x: string, y: string, whole: string, index: number): Piece[] {
  if (x && isSizeText(x)) return [{ kind: 'size', text: whole, index }]
  const inner = y.trim()
  const innerPieces = classifyTokens(tokensOf(inner))
  let yKind: OptionAxisKind | null = null
  if (isSizeText(inner) || hasDimension(inner)) yKind = 'size'
  else if (innerPieces.length > 0 && innerPieces.every((p) => p.kind === 'quantity')) yKind = 'quantity'
  else if (innerPieces.length > 0 && innerPieces.every((p) => p.kind === 'color')) yKind = 'color' // "20개(블랙)"
  const xKind = x ? toAxisKind(classifyToken(x)) : 'design'
  if (!yKind) return [{ kind: xKind, text: whole, index }]
  const yPiece: Piece = { kind: yKind, text: inner, index: index + x.length + 1 }
  return x ? [{ kind: xKind, text: x, index }, yPiece] : [yPiece]
}

/** 등록 옵션명 하나 → 종류별 값. 같은 종류는 나온 순서대로 공백 하나로 잇는다 */
export function classifyOptionLabel(label: string): Partial<Record<OptionAxisKind, string>> {
  const PAREN_RE = /(\S*?)\(([^()]*)\)/gu
  let rest = label
  const pieces: Piece[] = []
  const dimEnds = new Map<number, Piece>()

  // 1) 괄호 밖 치수를 먼저 뗀다(괄호 안은 가린다 — "FREE(지름 12cm)"는 괄호 규칙이 처리)
  let masked = label.replace(PAREN_RE, (m, x: string) => x + ' '.repeat(m.length - x.length))
  for (const re of [DIM_GROUP_RE, DIM_SINGLE_RE]) {
    for (const m of masked.matchAll(re)) {
      const index = m.index ?? 0
      if (re === DIM_GROUP_RE && !HAS_UNIT_RE.test(m[0])) continue
      const piece: Piece = { kind: 'size', text: m[0].trim(), index }
      pieces.push(piece)
      dimEnds.set(index + m[0].length, piece)
      masked = blank(masked, index, m[0].length)
      rest = blank(rest, index, m[0].length)
    }
  }
  // 2) 괄호: 치수 바로 뒤 괄호는 치수에 붙인다("30cm(대형)")
  for (const m of rest.matchAll(PAREN_RE)) {
    const index = m.index ?? 0
    const dim = m[1] === '' ? dimEnds.get(index) : undefined
    if (dim) dim.text += m[0]
    else pieces.push(...classifyParenGroup(m[1], m[2], m[0], index))
    rest = blank(rest, index, m[0].length)
  }
  // 3) 나머지 공백 토큰
  pieces.push(...classifyTokens(tokensOf(rest)))

  pieces.sort((a, b) => a.index - b.index)
  const out: Partial<Record<OptionAxisKind, string>> = {}
  for (const p of pieces) out[p.kind] = out[p.kind] ? `${out[p.kind]} ${p.text}` : p.text
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 정렬
// ─────────────────────────────────────────────────────────────────────────────

/** 자연 정렬. localeCompare가 같다고 보는 값('꽃-1'·'꽃-01', NFC·NFD)은 코드 단위로 갈라 입력 순서와 무관하게 한다 */
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'ko', { numeric: true }) || (a < b ? -1 : a > b ? 1 : 0)
}

function firstInt(text: string): number {
  const m = text.match(/\d+/)
  return m ? Number(m[0]) : Number.POSITIVE_INFINITY
}

function sizeRank(value: string): number {
  if ((FREE_SIZES as readonly string[]).includes(value) || /^free/i.test(value)) return 1000
  const exact = LETTER_SIZES.indexOf(value as (typeof LETTER_SIZES)[number])
  const normalized = (i: number) => (LETTER_SIZES[i] === '2XL' ? 5 : LETTER_SIZES[i] === '3XL' ? 6 : i)
  if (exact >= 0) return normalized(exact)
  if (SIZE_RANGE_RE.test(value)) {
    const head = LETTER_SIZES.indexOf(value.split('-')[0] as (typeof LETTER_SIZES)[number])
    return normalized(head) + 0.5
  }
  return 500
}

function compareAxisValues(kind: OptionAxisKind, a: string, b: string): number {
  if (kind === 'quantity') return firstInt(a) - firstInt(b) || naturalCompare(a, b)
  if (kind === 'size') return sizeRank(a) - sizeRank(b) || naturalCompare(a, b)
  return naturalCompare(a, b)
}

// ─────────────────────────────────────────────────────────────────────────────
// 파서
// ─────────────────────────────────────────────────────────────────────────────

const MISSING = '\u0000'

function fallbackResult(
  labels: string[],
  source: OptionSpec['source'],
  warnings: OptionParseWarning[],
): ParsedOptionLabels {
  const sorted = [...labels].sort(naturalCompare)
  return {
    spec: {
      axes: [{ kind: 'design', name: OPTION_AXIS_NAMES.design, values: sorted }],
      variants: sorted.map((label) => ({ label, values: { design: label } })),
      source,
    },
    warnings,
    fallback: true,
  }
}

export function parseOptionLabels(
  labels: readonly string[],
  source: OptionSpec['source'] = 'products',
): ParsedOptionLabels {
  const warnings: OptionParseWarning[] = []
  const unique: string[] = []
  const duplicates = new Set<string>()
  for (const label of labels) {
    if (typeof label !== 'string' || !label.trim()) continue
    if (unique.includes(label)) duplicates.add(label)
    else unique.push(label)
  }
  for (const label of duplicates) warnings.push({ code: 'duplicate_label', labels: [label] })
  if (unique.length === 0) {
    warnings.push({ code: 'empty', labels: [] })
    return { spec: { axes: [], variants: [], source }, warnings, fallback: false }
  }

  const parsed: OptionVariant[] = unique.map((label) => ({ label, values: classifyOptionLabel(label) }))
  const varying = OPTION_AXIS_KINDS.filter(
    (kind) => new Set(parsed.map((v) => v.values[kind] ?? MISSING)).size > 1,
  )

  if (varying.length > 2) {
    warnings.push({ code: 'too_many_axes', labels: [...unique], detail: varying.join(',') })
    return fallbackResult(unique, source, warnings)
  }
  const incomplete = parsed.filter((v) => varying.some((kind) => v.values[kind] === undefined))
  if (incomplete.length > 0) {
    warnings.push({ code: 'inconsistent_axis', labels: incomplete.map((v) => v.label), detail: varying.join(',') })
    return fallbackResult(unique, source, warnings)
  }

  const axes: OptionAxis[] = varying.map((kind) => ({
    kind,
    name: OPTION_AXIS_NAMES[kind],
    values: [...new Set(parsed.map((v) => v.values[kind] as string))].sort((a, b) => compareAxisValues(kind, a, b)),
  }))
  const variants = [...parsed].sort((a, b) => {
    for (const axis of axes) {
      const diff = axis.values.indexOf(a.values[axis.kind] as string) - axis.values.indexOf(b.values[axis.kind] as string)
      if (diff !== 0) return diff
    }
    return naturalCompare(a.label, b.label)
  })

  // 변하는 축이 없어도(빈 조합) 라벨이 둘 이상이면 구분할 수 없으므로 경고한다
  const groups = new Map<string, string[]>()
  for (const v of variants) {
    const key = axes.map((axis) => v.values[axis.kind]).join('\u0001')
    groups.set(key, [...(groups.get(key) ?? []), v.label])
  }
  for (const group of groups.values()) {
    if (group.length > 1) warnings.push({ code: 'duplicate_combination', labels: group })
  }

  return { spec: { axes, variants, source }, warnings, fallback: false }
}

// ─────────────────────────────────────────────────────────────────────────────
// 조회·호환·검사
// ─────────────────────────────────────────────────────────────────────────────

/** 카드로 보여 줄 형태 축(design > color > size). 형태 축이 없으면 null */
export function primaryFormAxis(spec: OptionSpec): OptionAxis | null {
  for (const kind of ['design', 'color', 'size'] as const) {
    const axis = spec.axes.find((a) => a.kind === kind)
    if (axis) return axis
  }
  return null
}

/** 기존 spec_sheet.colorOptions 호환 — variant label 목록 그대로 */
export function toColorOptions(spec: OptionSpec): string[] {
  return spec.variants.map((v) => v.label)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** JSONB(spec_sheet.optionSpec) 읽기용 구조 검사 */
export function isOptionSpec(value: unknown): value is OptionSpec {
  if (!isRecord(value)) return false
  if (!['products', 'openapi', 'manual'].includes(value.source as string)) return false
  if (!Array.isArray(value.axes) || !Array.isArray(value.variants)) return false
  const axesOk = value.axes.every(
    (a) =>
      isRecord(a) &&
      OPTION_AXIS_KINDS.includes(a.kind as OptionAxisKind) &&
      typeof a.name === 'string' &&
      isStringArray(a.values),
  )
  const variantsOk = value.variants.every(
    (v) =>
      isRecord(v) &&
      typeof v.label === 'string' &&
      isRecord(v.values) &&
      Object.entries(v.values).every(([k, val]) => OPTION_AXIS_KINDS.includes(k as OptionAxisKind) && typeof val === 'string') &&
      (v.sourceImage === undefined || typeof v.sourceImage === 'string') &&
      (v.facts === undefined || isStringArray(v.facts)),
  )
  return axesOk && variantsOk
}

export type OptionSpecIssueCode =
  | 'too_many_axes'
  | 'duplicate_label'
  | 'missing_axis_value'
  | 'unknown_axis_value'
  | 'missing_source_image'
  | 'empty_axis'

export interface OptionSpecIssue {
  code: OptionSpecIssueCode
  label?: string
  detail?: string
}

export function validateOptionSpec(spec: OptionSpec): OptionSpecIssue[] {
  const issues: OptionSpecIssue[] = []
  if (spec.axes.length > 2) issues.push({ code: 'too_many_axes', detail: String(spec.axes.length) })
  for (const axis of spec.axes) {
    if (axis.values.length === 0) issues.push({ code: 'empty_axis', detail: axis.kind })
  }
  const seen = new Set<string>()
  const needsImage = spec.axes.some((a) => a.kind === 'design' || a.kind === 'color')
  for (const v of spec.variants) {
    if (seen.has(v.label)) issues.push({ code: 'duplicate_label', label: v.label })
    seen.add(v.label)
    for (const axis of spec.axes) {
      const value = v.values[axis.kind]
      if (value === undefined) issues.push({ code: 'missing_axis_value', label: v.label, detail: axis.kind })
      else if (!axis.values.includes(value)) issues.push({ code: 'unknown_axis_value', label: v.label, detail: `${axis.kind}:${value}` })
    }
    if (needsImage && !v.sourceImage) issues.push({ code: 'missing_source_image', label: v.label })
  }
  return issues
}
