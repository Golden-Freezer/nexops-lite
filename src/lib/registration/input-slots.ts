// 상세페이지 입력 칸(적용 JOB C1, 오너 답 2026-11-02 '입력 없는 항목은 칸·부품·시험까지 만들고 값이 있을 때만 표시. 지어내지 않는다').
// 주의·보관, 제품 수치, 사용 순서, 사이즈 행렬, 층, 색값, 실제 사진, 제품 색, 비교 근거·출처, 주기(C5)의 타입과 정리 규칙, 화면 글 ↔ 값 변환이다. 순수 함수이고 화면·서버가 함께 쓴다.
// 정리 규칙을 못 넘긴 값은 조용히 버린다(반쪽 값을 그리지 않는다). 상한을 넘는 글도 자르지 않고 버린다 — 주의 문구를 자르면 뜻이 바뀐다. 읽기(규제 표현 거르기·기존 칸과 합치기)는 input-slots-read.ts에 있다.
// 프롬프트 스펙 JSON에는 넣지 않는다(SPEC_PROMPT_EXCLUDED_KEYS). 값이 있어도 R 라인과 앞 단계가 바뀌지 않는다. 문서: docs/plans/pdp-enrichment/INPUT-SLOTS.md

export type NoticeKind = 'caution' | 'storage' | 'care'
export interface NoticeItem {
  kind: NoticeKind
  text: string
}
export interface ProductMetric {
  name: string
  value: string
  unit: string
}
export interface UsageStep {
  title: string
  description?: string
}
export interface SizeMatrix {
  columns: string[]
  rows: Array<{ label: string; values: string[] }>
}
export interface ProductLayer {
  name: string
  note?: string
}
export interface ColorSwatch {
  name: string
  hex: string
}
export type RealPhotoKind = 'origin' | 'factory' | 'material' | 'storage'
export interface RealPhoto {
  kind: RealPhotoKind
  url: string
  caption?: string
}
/** 비교 근거 한 행(적용 C5 R-D2) — 기존 제품과 견주는 사실. 기존 칸이 비면 그리는 쪽이 중립 줄표로 둔다 */
export interface CompareBasisRow {
  label: string
  ours: string
  other?: string
}
/** 사용·교체·배송 주기 한 줄(적용 C5 R-D3) — 이름·기간 입력 글 그대로 */
export interface ScheduleItem {
  label: string
  period: string
}

export interface InputSlotFields {
  /** 주의·보관·관리 줄. 법정표시·배송·교환은 넣지 않는다(오너 답) */
  noticeItems?: NoticeItem[]
  /** 제품 수치(이름·값·단위). 크기 입력에 이름이 적힌 값은 metricsOf가 따로 읽는다 */
  productMetrics?: ProductMetric[]
  /** 사용 순서 2~5단계 */
  usageSteps?: UsageStep[]
  /** 사이즈 표 */
  sizeMatrix?: SizeMatrix
  /** 층·단면 2~5개 */
  layers?: ProductLayer[]
  /** 색상·질감 칩 값 */
  swatches?: ColorSwatch[]
  /** 산지·제조·재료·보관 실제 사진 주소. AI 컷으로 대신하지 않는다 */
  realPhotos?: RealPhoto[]
  /** 제품 색(#RRGGBB). 없으면 사진 측정값을 쓰는 지금 그대로다 */
  productColor?: string
  /** 비교 근거(적용 C5) — 기존 제품과 견주는 사실 행 1~5개. 깎아내리기 금지·비교 상대는 기존 제품(오너) — 거르기는 읽기(input-slots-read) */
  compareBasis?: CompareBasisRow[]
  /** 비교 근거 출처(40자) — 시험 성적서·자사 측정처럼 근거가 어디서 왔는지 */
  compareSource?: string
  /** 사용·교체·배송 주기(적용 C5) 2~6줄. 기간을 지어내지 않는다 — 효과 시간표(기간 → 몸·피부 변화)는 읽기에서 뺀다 */
  schedule?: ScheduleItem[]
}

export const INPUT_SLOT_KEYS = [
  'noticeItems',
  'productMetrics',
  'usageSteps',
  'sizeMatrix',
  'layers',
  'swatches',
  'realPhotos',
  'productColor',
  'compareBasis',
  'compareSource',
  'schedule',
] as const satisfies ReadonlyArray<keyof InputSlotFields>

export const INPUT_SLOT_LIMITS = {
  notice: { max: 6, chars: 80 },
  metric: { max: 6, name: 12, value: 12, unit: 6 },
  step: { min: 2, max: 5, title: 30, description: 80 },
  matrix: { columns: 8, rows: 12, cell: 12 },
  layer: { min: 2, max: 5, name: 20, note: 50 },
  swatch: { min: 2, max: 12, name: 16 },
  photo: { max: 4, caption: 40, url: 500 },
  compare: { min: 1, max: 5, label: 12, value: 24, source: 40 },
  schedule: { min: 2, max: 6, label: 16, period: 20 },
} as const

const NOTICE_KINDS: readonly NoticeKind[] = ['caution', 'storage', 'care']
const PHOTO_KINDS: readonly RealPhotoKind[] = ['origin', 'factory', 'material', 'storage']
const HEX = /^#[0-9a-fA-F]{6}$/
const PHOTO_URL = /^https:\/\/\S+$/

/** 한 줄로 편 글. 상한을 넘으면 빈 값 */
const textOf = (v: unknown, max: number): string => {
  const text = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  return text.length <= max ? text : ''
}
const recordsOf = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object') : [])

export function cleanNoticeItems(v: unknown): NoticeItem[] {
  const seen = new Set<string>()
  const out: NoticeItem[] = []
  for (const row of recordsOf(v)) {
    const text = textOf(row.text, INPUT_SLOT_LIMITS.notice.chars)
    if (!text || seen.has(text) || !NOTICE_KINDS.includes(row.kind as NoticeKind)) continue
    seen.add(text)
    out.push({ kind: row.kind as NoticeKind, text })
  }
  return out.slice(0, INPUT_SLOT_LIMITS.notice.max)
}

export function cleanProductMetrics(v: unknown): ProductMetric[] {
  const { max, name: nameMax, value: valueMax, unit: unitMax } = INPUT_SLOT_LIMITS.metric
  return recordsOf(v)
    .map((row) => ({ name: textOf(row.name, nameMax), value: textOf(row.value, valueMax), unit: textOf(row.unit, unitMax) }))
    .filter((m) => m.name && /^\d/.test(m.value) && m.unit)
    .slice(0, max)
}

/** 순서는 한 단계만 빠져도 뜻이 달라진다 — 빈 단계가 하나라도 있거나 수가 안 맞으면 통째로 없앤다 */
export function cleanUsageSteps(v: unknown): UsageStep[] {
  const { min, max, title: titleMax, description: descMax } = INPUT_SLOT_LIMITS.step
  const rows = recordsOf(v)
  const steps = rows.map((row) => {
    const description = textOf(row.description, descMax)
    return { title: textOf(row.title, titleMax), ...(description ? { description } : {}) }
  })
  return steps.length >= min && steps.length <= max && steps.every((s) => s.title) ? steps : []
}

/** 칸 수가 머리와 다른 행은 값이 밀려 틀린 사이즈가 되므로 버린다. 남은 행이 없으면 null */
export function cleanSizeMatrix(v: unknown): SizeMatrix | null {
  if (!v || typeof v !== 'object') return null
  const { columns: columnsMax, rows: rowsMax, cell } = INPUT_SLOT_LIMITS.matrix
  const raw = v as { columns?: unknown; rows?: unknown }
  const columns = (Array.isArray(raw.columns) ? raw.columns : []).map((c) => textOf(c, cell))
  if (columns.length === 0 || columns.length > columnsMax || columns.some((c) => !c)) return null
  const rows = recordsOf(raw.rows)
    .map((row) => ({ label: textOf(row.label, cell), values: (Array.isArray(row.values) ? row.values : []).map((c) => textOf(c, cell)) }))
    .filter((row) => row.label && row.values.length === columns.length && row.values.every(Boolean))
    .slice(0, rowsMax)
  return rows.length > 0 ? { columns, rows } : null
}

export function cleanLayers(v: unknown): ProductLayer[] {
  const { min, max, name: nameMax, note: noteMax } = INPUT_SLOT_LIMITS.layer
  const layers = recordsOf(v)
    .map((row) => {
      const note = textOf(row.note, noteMax)
      return { name: textOf(row.name, nameMax), ...(note ? { note } : {}) }
    })
    .filter((layer) => layer.name)
    .slice(0, max)
  return layers.length >= min ? layers : []
}

export function cleanSwatches(v: unknown): ColorSwatch[] {
  const { min, max, name: nameMax } = INPUT_SLOT_LIMITS.swatch
  const swatches = recordsOf(v)
    .map((row) => ({ name: textOf(row.name, nameMax), hex: typeof row.hex === 'string' ? row.hex.trim() : '' }))
    .filter((s) => s.name && HEX.test(s.hex))
    .slice(0, max)
  return swatches.length >= min ? swatches : []
}

const nameKey = (text: string) => text.replace(/\s+/g, '').toLowerCase()

/**
 * 견본 ↔ 옵션 짝(C5 T1-99, 통합 11-04 01:14 ①) — 옵션 이름이 있으면 옵션 순서대로 이름이 맞는 견본만 남긴다(공백·대소문자 무시, 옵션 이름에
 * 견본 이름이 들면 맞음 — '데이지 화이트' ↔ '화이트'). 옵션 이름이 없으면 견본 그대로. 사진에서 색을 뽑지 않는다. 짝이 2개 미만이면 빈 목록.
 * K 견본 칩(templatelib input-values)·D 옵션 칸 점(designcut-structure markSwatches)이 같은 함수를 쓴다(적용 C5 ③). input-slots-read가 다시 내보낸다
 */
export function pairedSwatches(swatches: readonly ColorSwatch[], optionNames: readonly string[]): Array<ColorSwatch & { option?: string }> {
  const options = optionNames.map((name) => name.trim()).filter(Boolean)
  if (options.length === 0) return swatches.length >= INPUT_SLOT_LIMITS.swatch.min ? [...swatches] : []
  const used = new Set<ColorSwatch>()
  const paired = options.flatMap((option) => {
    const key = nameKey(option)
    const hit = swatches.find((s) => !used.has(s) && (nameKey(s.name) === key || key.includes(nameKey(s.name))))
    if (!hit) return []
    used.add(hit)
    return [{ ...hit, option }]
  })
  return paired.length >= INPUT_SLOT_LIMITS.swatch.min ? paired : []
}

export function cleanRealPhotos(v: unknown): RealPhoto[] {
  const { max, caption: captionMax, url: urlMax } = INPUT_SLOT_LIMITS.photo
  const out: RealPhoto[] = []
  for (const row of recordsOf(v)) {
    const url = typeof row.url === 'string' ? row.url.trim() : ''
    if (!PHOTO_KINDS.includes(row.kind as RealPhotoKind) || url.length > urlMax || !PHOTO_URL.test(url)) continue
    const caption = textOf(row.caption, captionMax)
    out.push({ kind: row.kind as RealPhotoKind, url, ...(caption ? { caption } : {}) })
  }
  return out.slice(0, max)
}

export const cleanProductColor = (v: unknown): string | null => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : null)

/** 비교 근거 — 항목·우리 값이 있는 행만, 같은 항목은 한 번. 기존 값은 있을 때만 둔다 */
export function cleanCompareBasis(v: unknown): CompareBasisRow[] {
  const { min, max, label: labelMax, value: valueMax } = INPUT_SLOT_LIMITS.compare
  const seen = new Set<string>()
  const rows: CompareBasisRow[] = []
  for (const row of recordsOf(v)) {
    const label = textOf(row.label, labelMax)
    const ours = textOf(row.ours, valueMax)
    const other = textOf(row.other, valueMax)
    if (!label || !ours || seen.has(label)) continue
    seen.add(label)
    rows.push({ label, ours, ...(other ? { other } : {}) })
  }
  return rows.length >= min ? rows.slice(0, max) : []
}

export const cleanCompareSource = (v: unknown): string | null => textOf(v, INPUT_SLOT_LIMITS.compare.source) || null

/** 주기 — 이름·기간이 다 있는 줄만, 2개 미만이면 없음 */
export function cleanSchedule(v: unknown): ScheduleItem[] {
  const { min, max, label: labelMax, period: periodMax } = INPUT_SLOT_LIMITS.schedule
  const items = recordsOf(v)
    .map((row) => ({ label: textOf(row.label, labelMax), period: textOf(row.period, periodMax) }))
    .filter((item) => item.label && item.period)
    .slice(0, max)
  return items.length >= min ? items : []
}

/**
 * 입력 칸을 정리한 spec. 칸이 하나도 없으면 같은 객체를 돌려준다(저장 바이트 불변). 정리한 결과가 비면 그 키를 지운다
 */
export function normalizeInputSlots<T extends InputSlotFields>(spec: T): T {
  if (!INPUT_SLOT_KEYS.some((key) => key in spec)) return spec
  const out = { ...spec }
  for (const key of INPUT_SLOT_KEYS) delete out[key]
  const noticeItems = cleanNoticeItems(spec.noticeItems)
  const productMetrics = cleanProductMetrics(spec.productMetrics)
  const usageSteps = cleanUsageSteps(spec.usageSteps)
  const sizeMatrix = cleanSizeMatrix(spec.sizeMatrix)
  const layers = cleanLayers(spec.layers)
  const swatches = cleanSwatches(spec.swatches)
  const realPhotos = cleanRealPhotos(spec.realPhotos)
  const productColor = cleanProductColor(spec.productColor)
  const compareBasis = cleanCompareBasis(spec.compareBasis)
  const compareSource = cleanCompareSource(spec.compareSource)
  const schedule = cleanSchedule(spec.schedule)
  if (noticeItems.length) out.noticeItems = noticeItems
  if (productMetrics.length) out.productMetrics = productMetrics
  if (usageSteps.length) out.usageSteps = usageSteps
  if (sizeMatrix) out.sizeMatrix = sizeMatrix
  if (layers.length) out.layers = layers
  if (swatches.length) out.swatches = swatches
  if (realPhotos.length) out.realPhotos = realPhotos
  if (productColor) out.productColor = productColor
  if (compareBasis.length) out.compareBasis = compareBasis
  if (compareSource) out.compareSource = compareSource
  if (schedule.length) out.schedule = schedule
  return out
}

// ── 화면 글 ↔ 값(줄마다 한 항목). 화면은 입력 중에 글을 그대로 두고 값만 바꾼다 ──

const linesOf = (raw: string) => raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
/** 'a | b' — 두 번째 칸이 없으면 '' */
const pipe = (line: string): [string, string] => {
  const at = line.indexOf('|')
  return at === -1 ? [line.trim(), ''] : [line.slice(0, at).trim(), line.slice(at + 1).trim()]
}
/** '앞말: 나머지' — 앞말이 없으면 null */
const colon = (line: string): [string, string] | null => {
  const m = /^([^:：]+)[:：](.*)$/.exec(line)
  return m ? [m[1].trim(), m[2].trim()] : null
}

const NOTICE_WORDS: Record<NoticeKind, string> = { caution: '주의', storage: '보관', care: '관리' }
const PHOTO_WORDS: Record<RealPhotoKind, string> = { origin: '산지', factory: '제조', material: '재료', storage: '보관' }
const kindOfWord = <K extends string>(words: Record<K, string>, word: string): K | null =>
  (Object.keys(words) as K[]).find((kind) => words[kind] === word) ?? null

/** '보관: 서늘한 곳' — 앞말이 없거나 모르는 말이면 주의로 본다 */
export const parseNoticeLines = (raw: string): NoticeItem[] =>
  cleanNoticeItems(
    linesOf(raw).map((line) => {
      const head = colon(line)
      const kind = head ? kindOfWord(NOTICE_WORDS, head[0]) : null
      return head && kind ? { kind, text: head[1] } : { kind: 'caution', text: line }
    })
  )
export const formatNoticeLines = (items: NoticeItem[] | undefined) => (items ?? []).map((i) => `${NOTICE_WORDS[i.kind]}: ${i.text}`).join('\n')

/** '길이: 7.3cm' */
export const parseMetricLines = (raw: string): ProductMetric[] =>
  cleanProductMetrics(
    linesOf(raw).flatMap((line) => {
      const head = colon(line)
      const m = head && /^(\d+(?:[.,]\d+)?)\s*(\S+)$/.exec(head[1])
      return head && m ? [{ name: head[0], value: m[1], unit: m[2] }] : []
    })
  )
export const formatMetricLines = (items: ProductMetric[] | undefined) => (items ?? []).map((m) => `${m.name}: ${m.value}${m.unit}`).join('\n')

/** '제목 | 설명' */
export const parseStepLines = (raw: string): UsageStep[] =>
  cleanUsageSteps(linesOf(raw).map((line) => { const [title, description] = pipe(line); return { title, description } }))
export const formatStepLines = (items: UsageStep[] | undefined) => (items ?? []).map((s) => (s.description ? `${s.title} | ${s.description}` : s.title)).join('\n')

/** 첫 줄이 머리(첫 칸은 표 이름이라 버린다), 다음 줄부터 행. 쉼표·탭으로 나눈다 */
export function parseMatrixLines(raw: string): SizeMatrix | null {
  const [head, ...rows] = linesOf(raw).map((line) => line.split(/[,\t]/).map((cell) => cell.trim()))
  if (!head || head.length < 2) return null
  return cleanSizeMatrix({ columns: head.slice(1), rows: rows.map(([label, ...values]) => ({ label, values })) })
}
export const formatMatrixLines = (m: SizeMatrix | undefined) =>
  m ? [['사이즈', ...m.columns].join(', '), ...m.rows.map((row) => [row.label, ...row.values].join(', '))].join('\n') : ''

/** '이름 | 설명' */
export const parseLayerLines = (raw: string): ProductLayer[] =>
  cleanLayers(linesOf(raw).map((line) => { const [name, note] = pipe(line); return { name, note } }))
export const formatLayerLines = (items: ProductLayer[] | undefined) => (items ?? []).map((l) => (l.note ? `${l.name} | ${l.note}` : l.name)).join('\n')

/** '이름: #RRGGBB' */
export const parseSwatchLines = (raw: string): ColorSwatch[] =>
  cleanSwatches(linesOf(raw).flatMap((line) => { const head = colon(line); return head ? [{ name: head[0], hex: head[1] }] : [] }))
export const formatSwatchLines = (items: ColorSwatch[] | undefined) => (items ?? []).map((s) => `${s.name}: ${s.hex}`).join('\n')

/** '산지: https://… | 설명'. 주소에 콜론이 있어 첫 콜론만 나눈다 */
export const parsePhotoLines = (raw: string): RealPhoto[] =>
  cleanRealPhotos(
    linesOf(raw).flatMap((line) => {
      const head = colon(line)
      const kind = head ? kindOfWord(PHOTO_WORDS, head[0]) : null
      if (!head || !kind) return []
      const [url, caption] = pipe(head[1])
      return [{ kind, url, caption }]
    })
  )
export const formatPhotoLines = (items: RealPhoto[] | undefined) =>
  (items ?? []).map((p) => `${PHOTO_WORDS[p.kind]}: ${p.url}${p.caption ? ` | ${p.caption}` : ''}`).join('\n')

/** '항목: 우리 | 기존' — 기존이 없으면 '항목: 우리' */
export const parseCompareLines = (raw: string): CompareBasisRow[] =>
  cleanCompareBasis(
    linesOf(raw).flatMap((line) => {
      const head = colon(line)
      if (!head) return []
      const [ours, other] = pipe(head[1])
      return [{ label: head[0], ours, other }]
    })
  )
export const formatCompareLines = (items: CompareBasisRow[] | undefined) =>
  (items ?? []).map((r) => `${r.label}: ${r.ours}${r.other ? ` | ${r.other}` : ''}`).join('\n')

/** '이름: 기간' */
export const parseScheduleLines = (raw: string): ScheduleItem[] =>
  cleanSchedule(linesOf(raw).flatMap((line) => { const head = colon(line); return head ? [{ label: head[0], period: head[1] }] : [] }))
export const formatScheduleLines = (items: ScheduleItem[] | undefined) => (items ?? []).map((i) => `${i.label}: ${i.period}`).join('\n')
