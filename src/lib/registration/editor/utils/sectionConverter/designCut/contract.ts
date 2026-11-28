/**
 * 디자인 컷 데이터 계약(D1 → D2) 읽기 — `section_plan.designcut`. 타입은 파이프라인 정본(pdp-state.ts DesigncutPlan, D1 #107).
 * 파이프라인(D1)이 기록하고 편집기(D2)가 읽는다. 형태가 어긋난 값은 버리고(섹션 단위), version이 다르거나 섹션이 0이면 null.
 * - sections: 템플릿이 배정된 섹션만, 페이지 순서. usp는 POINT별로 `point_div:<i>`·`sub_div:<i>` 키와 pointIndex로 나뉜다
 * - kept: 기존 빌더로 그리는 섹션 키, omitted: 데이터 규칙 때문에 뺀 섹션(그리지 않음), order: sections·kept를 섞은 페이지 순서
 * - text: copy_sections.final에서 그대로 옮긴 글자(빈 값 null — 그 줄은 그리지 않음)
 * 템플릿은 모듈을 종류별로 편 보기(CutSection)로 받는다.
 */

import type {
  DesigncutArtDirection,
  DesigncutBg,
  DesigncutFontPair,
  DesigncutHeadVariant,
  DesigncutLayoutVariant,
  DesigncutPalette2,
  DesigncutModule,
  DesigncutPlan,
  DesigncutSection,
  DesigncutTemplate,
} from '@/lib/registration/pdp-state'
import { INPUT_SLOT_LIMITS } from '@/lib/registration/input-slots'
import { hasWorryPhrase, withoutWorryPhrase } from '@/lib/registration/pdp-copy-labels'
import { FONT_PAIR_TABLE } from '@/lib/registration/templatelib/font-pairs'
import { isIconName } from '@/lib/registration/templatelib/icons'
import { PARTS_MIN } from '@/lib/registration/templatelib/input-values'
import type { SlotValues } from '@/lib/registration/templatelib/template-types'
import { acceptAccent } from './accent'
import { EMPHASIS_STYLES, type Colors } from './tokens'

export type { DesigncutArtDirection, DesigncutBg, DesigncutModule, DesigncutPlan, DesigncutSection, DesigncutTemplate }

/** 상품 정보 표 계획 키(designcut-long 'long:' + 'info', infoRows INFO_TABLE_KEY와 같은 값) — 좌우 줄 칸은 이 표에만 받는다 */
const INFO_TABLE_KEY = 'long:info'
/** 사이즈 칸 수치 줄 상한(metricRows METRIC_ROWS_MAX와 같은 값 — 그리기 모듈이 이 파일을 거꾸로 부르지 않게 따로 둔다) */
const METRIC_ROWS_MAX = 3

/** 수치 줄(D6 P7) — 줄이 1~3개이고 줄마다 이름·값 글이 있을 때만. 칸에 드는지는 그릴 때 다시 본다(fitsMetricRows) */
function readMetricRows(v: unknown): Array<{ name: string; value: string }> | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > METRIC_ROWS_MAX) return null
  const rows = v.map((r) => (isObj(r) && str(r.name) && str(r.value) ? { name: String(r.name), value: String(r.value) } : null))
  return rows.every((r) => r !== null) ? (rows as Array<{ name: string; value: string }>) : null
}

/** 주기 줄 상한(scheduleRows SCHEDULE_ROWS_MIN·MAX와 같은 값 — 그리기 모듈을 거꾸로 부르지 않게 따로 둔다) */
const SCHEDULE_ROWS_MIN = 2
const SCHEDULE_ROWS_MAX = 6

/** 주기 줄(C5 ④) — 줄이 2~6개이고 줄마다 이름·기간 글이 있을 때만. 칸에 드는지는 그릴 때 다시 본다(fitsScheduleRows) */
function readScheduleRows(v: unknown): Array<{ label: string; period: string }> | null {
  if (!Array.isArray(v) || v.length < SCHEDULE_ROWS_MIN || v.length > SCHEDULE_ROWS_MAX) return null
  const rows = v.map((r) => (isObj(r) && str(r.label) && str(r.period) ? { label: String(r.label), period: String(r.period) } : null))
  return rows.every((r) => r !== null) ? (rows as Array<{ label: string; period: string }>) : null
}

/** 옵션 칸 색 점(C5 ③) — 2~12개(옵션 칩 상한)이고 짝마다 옵션 이름 글과 #RRGGBB가 있을 때만. 하나라도 형식이 틀리면 칸이 없다 */
const SWATCH_HEX = /^#[0-9A-Fa-f]{6}$/
function readSwatches(v: unknown): Array<{ option: string; hex: string }> | null {
  if (!Array.isArray(v) || v.length < 2 || v.length > 12) return null
  const rows = v.map((r) => (isObj(r) && str(r.option) && typeof r.hex === 'string' && SWATCH_HEX.test(r.hex) ? { option: String(r.option), hex: r.hex } : null))
  return rows.every((r) => r !== null) ? (rows as Array<{ option: string; hex: string }>) : null
}

/** 원형 배지(D6 R-D1) — 배지 입력 둘 중 하나와 값 글이 있을 때만. 원 안에 드는지는 그릴 때 다시 본다(badgeLayout) */
function readBadge(v: unknown): DesigncutSection['badge'] | null {
  if (!isObj(v) || (v.input !== 'badge.certification' && v.input !== 'badge.rating') || !str(v.value)) return null
  return { input: v.input, value: String(v.value) }
}

/** 층 띠(D6 T1-85) — 층이 2~5개이고 층마다 이름 글이 있을 때만(설명은 글일 때만 둔다). 칸에 드는지는 그릴 때 다시 본다(fitsLayerRows) */
function readLayers(v: unknown): DesigncutSection['layers'] | null {
  const { min, max } = INPUT_SLOT_LIMITS.layer
  if (!Array.isArray(v) || v.length < min || v.length > max) return null
  const layers = v.map((l) => (isObj(l) && str(l.name) ? { name: String(l.name), ...(str(l.note) ? { note: String(l.note) } : {}) } : null))
  return layers.every((l) => l !== null) ? (layers as NonNullable<DesigncutSection['layers']>) : null
}

/** 구성품 줄 상한(inputDevices PARTS_MAX와 같은 값 — 그리기 모듈이 이 파일을 거꾸로 부르지 않게 따로 둔다) */
const PARTS_MAX = 6

/** 기존 제품과 비교 줄(C5 ②) — 행이 1~5개(입력 상한)이고 행마다 항목·우리 글이 있을 때만(기존·출처는 글일 때만 둔다). 칸에 드는지는 그릴 때 다시 본다(fitsCompareRows) */
function readCompare(v: unknown): DesigncutSection['compare'] | null {
  const { min, max } = INPUT_SLOT_LIMITS.compare
  if (!isObj(v) || !Array.isArray(v.rows) || v.rows.length < min || v.rows.length > max) return null
  const rows = v.rows.map((r) => (isObj(r) && str(r.label) && str(r.ours) ? { label: String(r.label), ours: String(r.ours), ...(str(r.other) ? { other: String(r.other) } : {}) } : null))
  if (!rows.every((r) => r !== null)) return null
  return { rows: rows as NonNullable<DesigncutSection['compare']>['rows'], ...(str(v.source) ? { source: String(v.source) } : {}) }
}

/** 구성품 펼침(D6 T1-83) — 이름이 2(K PARTS_MIN)~6개이고 모두 글일 때만. 한 줄에 드는지는 그릴 때 다시 본다(fitsPartRows) */
function readParts(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length < PARTS_MIN || v.length > PARTS_MAX || !v.every((p) => str(p) !== null)) return null
  return v.map(String)
}

export const DESIGN_CUT_TEMPLATES: readonly DesigncutTemplate[] = [
  'T1',
  'T2',
  'T3a',
  'T3b',
  'T3c',
  'T4',
  'T4Q',
  'T5',
  'T6',
  'T7',
  'T8',
  'T9',
  'T10',
  'T11',
  'T12',
]
const LAYOUT_VARIANTS: readonly DesigncutLayoutVariant[] = ['scene', 'zigzag', 'list', 'grid', 'card', 'half', 'cards']
const HEAD_VARIANTS: readonly DesigncutHeadVariant[] = ['band', 'rule']

type ModuleData<T extends DesigncutModule['type']> = Extract<DesigncutModule, { type: T }>['data']

/**
 * 사진 측정 팔레트 필드(계획 v2 #136) — 기록에 있을 때만 온다.
 * photoBackground는 원천 사진의 촬영 배경색: 상품 사진 섹션(P)을 이 색으로 이어 칠해 사진이 액자처럼 보이지 않게 한다.
 */
export type PhotoPalette = Pick<DesigncutPlan['palette'], 'source' | 'highKey' | 'photoBackground'>
/** 렌더러가 읽는 계획(파이프라인 정본과 같다) */
export type CutPlan = DesigncutPlan
/** 옵션 칩 — image는 등록 옵션의 실물 사진(T7 카드). 사진 없는 옵션은 null(이름만 그린다) */
export type CutChip = ModuleData<'M8'>['chips'][number]

/** 모듈을 종류별로 편 것 — 같은 종류는 첫 것만 */
export interface FlatModules {
  chapter?: number
  imageKey?: string
  lines?: string[]
  items?: string[]
  steps?: ModuleData<'M7'>['steps']
  dims?: ModuleData<'M4'>['dims']
  /** 치수 입력 글 — 방향을 모르는 치수는 이 글을 그대로 적는다(T6) */
  sizeRaw?: string
  chips?: CutChip[]
  /** 긴 페이지 사실 표 행(T9) */
  rows?: ModuleData<'M9'>['rows']
  /** D2 사이즈 행렬(long:matrix) — 입력 행렬 그대로(T9가 격자 또는 행 블록으로 그린다) */
  matrix?: NonNullable<ModuleData<'M9'>['matrix']>
  /** 긴 페이지 구석구석 보면(T10) */
  scenes?: ModuleData<'M10'>['scenes']
  /** D2 자세히 보기(T11) 특징 묶음 */
  details?: ModuleData<'M11'>['items']
  /** D2 후기(T12) 카드·평점 */
  reviews?: ModuleData<'M12'>
}

/** 템플릿이 받는 섹션 보기 */
export type CutSection = Omit<DesigncutSection, 'modules'> & { modules: FlatModules }

export function flattenModules(modules: readonly DesigncutModule[]): FlatModules {
  const out: FlatModules = {}
  for (const m of modules) {
    if (m.type === 'M6' && out.chapter === undefined) out.chapter = m.data.chapter
    if (m.type === 'M2b' && out.imageKey === undefined) out.imageKey = m.data.imageKey
    if (m.type === 'M2a' && !out.lines) out.lines = m.data.lines
    if (m.type === 'M1' && !out.items) out.items = m.data.items
    if (m.type === 'M7' && !out.steps) out.steps = m.data.steps
    if (m.type === 'M4' && !out.dims) {
      out.dims = m.data.dims
      out.sizeRaw = m.data.raw
    }
    if (m.type === 'M8' && !out.chips) out.chips = m.data.chips
    if (m.type === 'M9' && !out.rows) {
      out.rows = m.data.rows
      if (m.data.matrix) out.matrix = m.data.matrix
    }
    if (m.type === 'M10' && !out.scenes) out.scenes = m.data.scenes
    if (m.type === 'M11' && !out.details) out.details = m.data.items
    if (m.type === 'M12' && !out.reviews) out.reviews = m.data
  }
  return out
}

export const toCutSection = (s: DesigncutSection): CutSection => ({ ...s, modules: flattenModules(s.modules) })

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const noWorry = (text: string | null) => text && withoutWorryPhrase(text)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const HEX = /^#[0-9a-f]{6}$/i
const HTTP_URL = /^https?:\/\/\S+$/i
const strList = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.map(str).filter((s): s is string => s !== null) : undefined

/** 별점 분포 막대를 그리는 최소 리뷰 수 — 계획(designcut-structure REVIEW_BARS_MIN_TOTAL)과 같은 5건 */
const REVIEW_BARS_MIN = 5

/**
 * 별점 분포(적용 D6 P1) — 5점→1점 다섯 줄, 개수는 0 이상 정수, 합계 5건 이상일 때만. 하나라도 틀리면 통째로 null(막대 없이 지금 그리기)
 */
function reviewBarsOf(v: unknown): NonNullable<ModuleData<'M12'>['bars']> | null {
  if (!Array.isArray(v) || v.length !== 5) return null
  const bars = v.map((bar, i) => {
    const star = 5 - i
    return isObj(bar) && bar.star === star && typeof bar.count === 'number' && Number.isInteger(bar.count) && bar.count >= 0
      ? { star: star as 1 | 2 | 3 | 4 | 5, count: bar.count }
      : null
  })
  if (bars.some((bar) => bar === null)) return null
  const ok = bars as NonNullable<ModuleData<'M12'>['bars']>
  return ok.reduce((sum, bar) => sum + bar.count, 0) >= REVIEW_BARS_MIN ? ok : null
}

/** 사이즈 행렬 — 머리 칸이 있고 줄마다 이름과 머리 수만큼 값이 있어야 한다. 틀리면 null(표 행은 그대로 쓴다) */
function matrixOf(v: unknown): NonNullable<ModuleData<'M9'>['matrix']> | null {
  if (!isObj(v) || !Array.isArray(v.columns) || !Array.isArray(v.rows)) return null
  const columns = strList(v.columns) ?? []
  if (columns.length === 0 || columns.length !== v.columns.length) return null
  const rows = v.rows.filter(isObj).map((r) => ({ label: str(r.label), values: Array.isArray(r.values) ? (strList(r.values) ?? []) : [] }))
  const ok = rows.length > 0 && rows.length === v.rows.length && rows.every((r) => r.label !== null && r.values.length === columns.length)
  return ok ? { columns, rows: rows.map((r) => ({ label: r.label!, values: r.values })) } : null
}

/** 모듈 하나를 계약 형태로 맞춘다 — 값이 틀리면 null(그 모듈만 버림) */
function readModule(m: unknown): DesigncutModule | null {
  if (!isObj(m) || !isObj(m.data)) return null
  const d = m.data
  switch (m.type) {
    case 'M6':
      return typeof d.chapter === 'number' ? { type: 'M6', data: { chapter: d.chapter } } : null
    case 'M2b':
      return str(d.imageKey) ? { type: 'M2b', data: { imageKey: String(d.imageKey) } } : null
    case 'M2a':
      return { type: 'M2a', data: { lines: strList(d.lines) ?? [] } }
    case 'M1':
      return { type: 'M1', data: { items: strList(d.items) ?? [] } }
    case 'M7': {
      const steps = (Array.isArray(d.steps) ? d.steps : [])
        .filter(isObj)
        .map((s) => ({ title: str(s.title) ?? '', description: str(s.description) }))
        .filter((s) => s.title || s.description)
      return { type: 'M7', data: { steps } }
    }
    case 'M4': {
      // 값은 숫자 또는 숫자 문자열("5")을 받고, 0 이하·숫자가 아닌 값은 버린다(치수를 지어내지 않는다)
      const dims = (Array.isArray(d.dims) ? d.dims : [])
        .filter(isObj)
        .map((x) => ({
          axis: x.axis,
          value: typeof x.value === 'string' ? Number(x.value) : x.value,
          unit: str(x.unit),
        }))
        .filter(
          (x) =>
            ['w', 'h', 'd'].includes(String(x.axis)) &&
            typeof x.value === 'number' &&
            Number.isFinite(x.value) &&
            x.value > 0 &&
            x.unit
        )
        .map((x) => ({ axis: x.axis as 'w' | 'h' | 'd', value: x.value as number, unit: x.unit as string }))
      return { type: 'M4', data: { dims, raw: typeof d.raw === 'string' ? d.raw : '' } }
    }
    case 'M8': {
      const chips = (Array.isArray(d.chips) ? d.chips : [])
        .filter(isObj)
        .filter((c) => str(c.label))
        .map(
          (c): CutChip => ({
            label: String(c.label),
            color: typeof c.color === 'string' && HEX.test(c.color) ? c.color : null,
            image: typeof c.image === 'string' && HTTP_URL.test(c.image) ? c.image : null,
          })
        )
      return { type: 'M8', data: { chips } }
    }
    case 'M9': {
      const rows = (Array.isArray(d.rows) ? d.rows : [])
        .filter(isObj)
        .map((r) => ({ label: str(r.label), value: str(r.value) }))
        .filter((r): r is { label: string; value: string } => r.label !== null && r.value !== null)
      const matrix = matrixOf(d.matrix)
      return { type: 'M9', data: { rows, ...(matrix ? { matrix } : {}) } }
    }
    case 'M10': {
      // 컷 키는 이미지 쪽 기록(extra_shots)이 쓰는 두 꼴(피처 매크로 자리 features:N·사용 장면 long_scene:i)만. 캡션은 없어도 된다(사진만)
      const scenes = (Array.isArray(d.scenes) ? d.scenes : [])
        .filter(isObj)
        .map((s) => ({ imageKey: str(s.imageKey), caption: str(s.caption) ?? '' }))
        .filter(
          (s): s is { imageKey: string; caption: string } =>
            s.imageKey !== null && /^(features|long_scene):\d+$/.test(s.imageKey)
        )
      return { type: 'M10', data: { scenes } }
    }
    case 'M11': {
      // 컷 키는 피처 컷(features:N)만 — 없으면 null(글만)
      const items = (Array.isArray(d.items) ? d.items : [])
        .filter(isObj)
        .filter((i) => str(i.title))
        .map((i) => ({
          title: String(i.title),
          description: str(i.description),
          imageKey: typeof i.imageKey === 'string' && /^features:\d+$/.test(i.imageKey) ? i.imageKey : null,
          // 아이콘은 K 사전 이름만(적용 T1-60 D) — 모르는 이름은 버린다. 없으면 칸을 두지 않아 예전 문서와 같은 값이다
          ...(typeof i.icon === 'string' && isIconName(i.icon) ? { icon: i.icon } : {}),
        }))
      return { type: 'M11', data: { items } }
    }
    case 'M12': {
      // 평점은 1~5 숫자만(없으면 null — 별을 지어내지 않는다), 리뷰 수는 0보다 큰 정수만
      const stars = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 5 ? v : null)
      const cards = (Array.isArray(d.cards) ? d.cards : [])
        .filter(isObj)
        .filter((c) => str(c.text))
        .map((c) => ({
          text: String(c.text),
          author: str(c.author) ?? '구매고객',
          rating: stars(c.rating),
          ...(str(c.month) ? { month: String(c.month) } : {}),
          ...(c.summary === true ? { summary: true as const } : {}),
        }))
        .slice(0, 5)
      const count = typeof d.count === 'number' && Number.isInteger(d.count) && d.count > 0 ? d.count : null
      const bars = reviewBarsOf(d.bars)
      return { type: 'M12', data: { cards, rating: stars(d.rating), count, ...(bars ? { bars } : {}) } }
    }
    default:
      return null
  }
}

/** K 강조 구절(T1-17) — 저장된 칸 글 가운데 하나의 부분 문자열일 때만 받는다. 어긋나면 칸을 두지 않는다(지금 규칙으로 그린다) */
const slotAccent = (slots: Record<string, unknown>, phrase: unknown): string | null =>
  Object.values(slots).reduce<string | null>((hit, value) => hit ?? (typeof value === 'string' ? acceptAccent(value, phrase) : null), null)

function readSection(raw: unknown): DesigncutSection | null {
  if (!isObj(raw) || !str(raw.key) || !DESIGN_CUT_TEMPLATES.includes(raw.template as DesigncutTemplate)) return null
  const text = isObj(raw.text) ? raw.text : {}
  const headline = noWorry(str(text.headline))
  // D 강조 구절(T1-17) — 다시 그릴 제목(이런 고민을 뺀 뒤)의 부분 문자열로 다시 검사한다. 없거나 어긋나면 지금 규칙
  const accent = acceptAccent(headline, text.accent)
  const refAccent = isObj(raw.templateRef) && isObj(raw.templateRef.slots) ? slotAccent(raw.templateRef.slots, raw.templateRef.accent) : null
  const metricRows = raw.template === 'T6' ? readMetricRows(raw.metricRows) : null
  const scheduleRows = raw.template === 'T5' ? readScheduleRows(raw.scheduleRows) : null
  const swatches = raw.template === 'T7' ? readSwatches(raw.swatches) : null
  const badge = raw.template === 'T8' ? readBadge(raw.badge) : null
  const layers = raw.template === 'T11' ? readLayers(raw.layers) : null
  const parts = raw.template === 'T6' ? readParts(raw.parts) : null
  const compare = raw.template === 'T9' && raw.key === INFO_TABLE_KEY ? readCompare(raw.compare) : null
  return {
    key: String(raw.key),
    role: str(raw.role) ?? '',
    template: raw.template as DesigncutTemplate,
    bg: (['W', 'T', 'N', 'D', 'P'].includes(String(raw.bg)) ? raw.bg : 'W') as DesigncutBg,
    chapter: typeof raw.chapter === 'number' ? raw.chapter : null,
    ...(typeof raw.pointIndex === 'number' ? { pointIndex: raw.pointIndex } : {}),
    plateKey: str(raw.plateKey),
    plateAspect: (['1:1', '2:3', '3:2'].includes(String(raw.plateAspect))
      ? raw.plateAspect
      : null) as DesigncutSection['plateAspect'],
    productImageKey: str(raw.productImageKey),
    // 배경 제거 단계가 없어 편집기는 항상 액자 대체안으로 그린다(통합 결정) — 값은 기록 그대로 둔다
    productAlpha: raw.productAlpha === true,
    text: {
      // 저장 계획에 든 '이런 고민'도 다시 그릴 때 뺀다(오너 지시 11-01) — 라벨은 통째로, 문장은 그 말만
      eyebrow: hasWorryPhrase(String(text.eyebrow ?? '')) ? null : str(text.eyebrow),
      headline,
      sub: noWorry(str(text.sub)),
      ...(str(text.hook) ? { hook: String(text.hook) } : {}),
      ...(accent ? { accent } : {}),
    },
    modules: (Array.isArray(raw.modules) ? raw.modules : [])
      .map(readModule)
      .filter((m): m is DesigncutModule => m !== null),
    // 모르는 변형 이름은 칸을 두지 않는다(편집기는 scene으로 그린다)
    ...(LAYOUT_VARIANTS.includes(raw.layoutVariant as DesigncutLayoutVariant)
      ? { layoutVariant: raw.layoutVariant as DesigncutLayoutVariant }
      : {}),
    // 채움 메시지 머리 변형(D6 P3) — 장 번호 없는 칸만, 모르는 이름은 칸을 두지 않는다(지금 머리)
    ...(HEAD_VARIANTS.includes(raw.headVariant as DesigncutHeadVariant) && raw.chapter == null
      ? { headVariant: raw.headVariant as DesigncutHeadVariant }
      : {}),
    // 구역 연결 표식(D6 P5) — 고민(T2) 칸만, true일 때만 칸을 둔다
    ...(raw.linkBelow === true && raw.template === 'T2' ? { linkBelow: true as const } : {}),
    // 상품 정보 좌우 줄 표(D6 P6) — 상품 정보 표(T9 long:info)의 'rows'만, 짙은 머리 띠는 좌우 줄일 때 true만 칸을 둔다
    ...(raw.tableShape === 'rows' && raw.template === 'T9' && raw.key === INFO_TABLE_KEY
      ? { tableShape: 'rows' as const, ...(raw.tableBand === true ? { tableBand: true as const } : {}) }
      : {}),
    // 사이즈 칸 수치 줄(D6 P7) — 사이즈 칸(T6)만, 형식이 맞을 때만 칸을 둔다
    ...(metricRows ? { metricRows } : {}),
    // 사용 방법 칸 주기 줄(C5 ④) — 사용 방법 칸(T5)만, 형식이 맞을 때만 칸을 둔다
    ...(scheduleRows ? { scheduleRows } : {}),
    // 옵션 칸 색 점(C5 ③) — 옵션 칸(T7)만, 형식이 맞을 때만 칸을 둔다
    ...(swatches ? { swatches } : {}),
    // 원형 배지(D6 R-D1)는 마무리(T8)만, 층 띠(D6 T1-85)는 자세히 보기(T11)만, 구성품(D6 T1-83)은 사이즈 칸(T6)만 — 형식이 맞을 때만 칸을 둔다
    ...(badge ? { badge } : {}),
    ...(layers ? { layers } : {}),
    ...(parts ? { parts } : {}),
    // 기존 제품과 비교 줄(C5 ②)은 상품 정보 표(T9 long:info)만 — 형식이 맞을 때만 칸을 둔다
    ...(compare ? { compare } : {}),
    // 템플릿 조합 라인 선택 기록(15_TEMPLATE_LINE §10) — 형식이 맞을 때만 칸을 둔다. 없는 잡은 지금 그리기 그대로
    ...(isObj(raw.templateRef) && str(raw.templateRef.id) && isObj(raw.templateRef.slots)
      ? {
          templateRef: {
            id: String(raw.templateRef.id),
            version: typeof raw.templateRef.version === 'number' ? raw.templateRef.version : 1,
            slots: raw.templateRef.slots as SlotValues,
            ...(refAccent ? { accent: refAccent } : {}),
          },
        }
      : {}),
  }
}

/** 템플릿 조합 라인 글꼴 짝 — 표에 있는 글꼴·굵기만 받는다. 틀리면 칸을 두지 않는다 */
function readTemplateFontPair(raw: unknown): { heading: string; weight: number } | undefined {
  if (!isObj(raw)) return undefined
  const known = Object.values(FONT_PAIR_TABLE).some((pair) => pair.heading === raw.heading && pair.weight === raw.weight)
  return known ? { heading: String(raw.heading), weight: Number(raw.weight) } : undefined
}

/**
 * 템플릿 조합 라인 색 — 칸이 하나라도 틀리면 통째로 두지 않는다(반쪽 색으로 그리지 않는다).
 * 강조 방식(T1-18)은 선택 칸이라 모르는 값이면 그 칸만 버린다(지금 규칙으로 그림). 옛 계획은 칸이 없어 그대로다
 */
function readTemplateColors(raw: unknown): Colors | undefined {
  if (!isObj(raw) || typeof raw.highlight !== 'boolean') return undefined
  const names = ['base', 'accent', 'accentText', 'deep', 'tint', 'ink', 'photo', 'onDeep', 'onAccent', 'neutral', 'heading'] as const
  if (!names.every((name) => typeof raw[name] === 'string' && HEX.test(raw[name] as string))) return undefined
  const emphasisStyle = EMPHASIS_STYLES.find((style) => style === raw.emphasisStyle)
  return { ...Object.fromEntries(names.map((name) => [name, raw[name]])), highlight: raw.highlight, ...(emphasisStyle ? { emphasisStyle } : {}) } as unknown as Colors
}

/** 템플릿 조합 라인 모서리(T1-28) — 카드·사진은 필수, 캡슐은 선택. 0 이상 유한 숫자만이고 하나라도 틀리면 통째로 두지 않는다(계획 모서리 그대로) */
function readTemplateRadius(raw: unknown): { card: number; photo: number; capsule?: number } | undefined {
  if (!isObj(raw)) return undefined
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
  if (!ok(raw.card) || !ok(raw.photo) || (raw.capsule !== undefined && !ok(raw.capsule))) return undefined
  return { card: raw.card, photo: raw.photo, ...(raw.capsule !== undefined ? { capsule: raw.capsule as number } : {}) }
}

/** 사진 측정 필드 — 형식이 맞는 값만(#RRGGBB·boolean·'photo'), 아니면 필드를 두지 않는다 */
function readPhotoPalette(p: Record<string, unknown>): PhotoPalette {
  return {
    ...(p.source === 'photo' ? { source: 'photo' as const } : {}),
    ...(typeof p.highKey === 'boolean' ? { highKey: p.highKey } : {}),
    ...(typeof p.photoBackground === 'string' && HEX.test(p.photoBackground) ? { photoBackground: p.photoBackground } : {}),
  }
}

/** 세트 기술 한 칸 — 프롬프트·화면에 그대로 쓰지 않는 기록이지만 길이를 묶는다 */
const SET_TEXT_MAX = 200

/**
 * palette2(D2 아트 디렉션 v2, PALETTE2.md) — 톤이 맞고, playful이면 여섯 색(주·보조 2·스튜디오·강조 글자·제목·짙은 색)이 모두
 * #RRGGBB일 때만. 아니면 null(필드를 두지 않는다 — 지금 렌더)
 */
function readPalette2(raw: unknown): DesigncutPalette2 | null {
  if (!isObj(raw) || (raw.tone !== 'playful' && raw.tone !== 'calm')) return null
  const basis = raw.basis === 'parent_proxy' || raw.basis === 'target_terms' ? raw.basis : 'default'
  if (raw.tone === 'calm') return { tone: 'calm', basis }
  const c = isObj(raw.colors) ? raw.colors : null
  const hex = (v: unknown) => (typeof v === 'string' && HEX.test(v) ? v : null)
  const secondary = Array.isArray(c?.secondary) ? c.secondary.map(hex) : []
  const [primary, studio, accentText, heading, deep] = [c?.primary, c?.studio, c?.accentText, c?.heading, c?.deep].map(hex)
  if (!primary || !studio || !accentText || !heading || !deep || secondary.length !== 2) return null
  const [s1, s2] = secondary
  if (!s1 || !s2) return null
  return { tone: 'playful', basis, colors: { primary, secondary: [s1, s2], studio, accentText, heading, deep } }
}

/**
 * fontpair(internalized/art-fonts.ts FONT_PAIRS) — 톤이 맞고 (제목 글꼴, 굵기)가 짝 표의 값일 때만(주아 800 같은 합성 볼드 짝을 버린다).
 * 아니면 null(필드를 두지 않는다 — 지금 렌더)
 */
const FONT_PAIR_WEIGHTS: Record<string, number> = { Jua: 400, Hahmlet: 700, Gaegu: 400, 'SUIT Variable': 800 }
const FONT_PAIR_BASES = new Set(['parent_proxy', 'target_terms', 'category', 'premium_terms', 'hand_terms', 'default'])
function readFontPair(raw: unknown): DesigncutFontPair | null {
  if (!isObj(raw) || (raw.tone !== 'playful' && raw.tone !== 'premium' && raw.tone !== 'handwritten' && raw.tone !== 'everyday')) return null
  if (typeof raw.heading !== 'string' || FONT_PAIR_WEIGHTS[raw.heading] === undefined || raw.weight !== FONT_PAIR_WEIGHTS[raw.heading])
    return null
  const basis = typeof raw.basis === 'string' && FONT_PAIR_BASES.has(raw.basis) ? (raw.basis as DesigncutFontPair['basis']) : 'default'
  return { tone: raw.tone, basis, heading: raw.heading, weight: raw.weight, body: 'Pretendard' }
}

/**
 * D2 아트 디렉션(C1, designcut2 잡만) — 세트 글 네 칸이 있고 바탕 체계 세 색이 #RRGGBB일 때만. 정렬 축은 고정값, 모서리는 'sharp'만
 * 그대로(그 밖은 'soft'). 형태가 맞지 않으면 null(필드를 두지 않는다 — 기존 D 문서 그대로)
 */
function readArtDirection(raw: unknown): DesigncutArtDirection | null {
  if (!isObj(raw) || !isObj(raw.set) || !isObj(raw.background)) return null
  const set = raw.set
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, SET_TEXT_MAX) : null)
  const [floor, wall, win, season] = [text(set.floor), text(set.wall), text(set.window), text(set.season)]
  if (!floor || !wall || !win || !season) return null
  const bg = raw.background
  const hex = (v: unknown) => (typeof v === 'string' && HEX.test(v) ? v : null)
  const [base, studio, accent] = [hex(bg.base), hex(bg.studio), hex(bg.accent)]
  if (!base || !studio || !accent) return null
  const props = (strList(set.props) ?? []).map((p) => p.slice(0, SET_TEXT_MAX)).slice(0, 3)
  const palette2 = readPalette2(raw.palette2)
  const fontPair = readFontPair(raw.fontPair)
  return {
    set: { floor, wall, window: win, season, props },
    background: { base, studio, accent },
    alignment: { hero: 'center', closing: 'center', body: 'left' },
    corners: raw.corners === 'sharp' ? 'sharp' : 'soft',
    ...(palette2 ? { palette2 } : {}),
    ...(fontPair ? { fontPair } : {}),
  }
}

/** section_plan → 디자인 컷 계획. 기록이 없거나(대부분 잡) 형태가 맞지 않으면 null — 기존 편집기 문서 그대로 */
export function readDesignCut(sectionPlan: unknown): CutPlan | null {
  const raw = isObj(sectionPlan) ? sectionPlan.designcut : null
  if (!isObj(raw) || raw.version !== 1 || !isObj(raw.palette)) return null
  const p = raw.palette
  const color = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v : fallback)
  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .map(readSection)
    .filter((s): s is DesigncutSection => s !== null)
  if (sections.length === 0) return null
  const artDirection = readArtDirection(raw.artDirection)
  const templateColors = readTemplateColors(raw.templateColors)
  const templateFontPair = readTemplateFontPair(raw.templateFontPair)
  const templateRadius = readTemplateRadius(raw.templateRadius)
  return {
    version: 1,
    palette: {
      accent: color(p.accent, '#3F6FD8'),
      accentText: color(p.accentText, '#2A4FA8'),
      deep: color(p.deep, '#1E2A44'),
      tint: color(p.tint, '#EEF2FB'),
      ink: color(p.ink, '#1A1A1A'),
      mode: p.mode === 'neutral' ? 'neutral' : 'color',
      ...readPhotoPalette(p),
    },
    motif: { badge: isObj(raw.motif) && raw.motif.badge === 'SHARP' ? 'SHARP' : 'SOFT' },
    sections,
    kept: strList(raw.kept) ?? [],
    order: strList(raw.order) ?? [],
    omitted: (Array.isArray(raw.omitted) ? raw.omitted : [])
      .filter(isObj)
      .filter((o) => str(o.key))
      .map((o) => ({ key: String(o.key), reason: str(o.reason) ?? '' })),
    ...(artDirection ? { artDirection } : {}),
    ...(raw.layout === 2 ? { layout: 2 as const } : {}),
    ...(raw.factsLast === true ? { factsLast: true as const } : {}),
    ...(templateColors ? { templateColors } : {}),
    ...(templateRadius ? { templateRadius } : {}),
    ...(templateFontPair ? { templateFontPair } : {}),
  }
}

/** `point_div:1` → `point_div` */
export const baseKeyOf = (key: string) => key.split(':')[0]
