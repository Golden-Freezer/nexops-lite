/**
 * 표본 슬롯 — 슬롯 규격대로 채운 값(검사기·목업·높이 계산 전용). 제품 경로에서 쓰지 않는다. 글자는 뜻 없는 음절이라 카피가 아니다.
 * 글자 수 상한 × factor로 채워 최대 글자 스트레스(1.2)도 같은 함수로 만든다. 순수·결정론.
 */

import type { Colors } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import { renderTemplate, type TemplateContext } from './engine'
import { ICON_NAMES } from './icons'
import { TAG_MAX_CHARS } from './slots'
import { ratingBarItems, scaleItems } from './input-values'
import { POINT_STEPS_NAME, RATING_BARS_INPUT, SIZE_SCALE_INPUT, type FlowNode, type ListSlot, type SlotDef, type SlotItem, type SlotValue, type SlotValues, type Template, type TextSlot } from './template-types'

const SYLLABLES = '가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허'
/** 한글 낱말 길이 — 실제 카피처럼 줄이 바뀌게 한다 */
const WORD_LEN = 4

/** 공백을 뺀 글자 수가 n인 음절 글(낱말 길이마다 띄어 실제 카피처럼 줄이 바뀐다) */
export function fillerText(n: number, wordLen: number = WORD_LEN): string {
  const chars = Array.from({ length: Math.max(1, Math.round(n)) }, (_, i) => SYLLABLES[i % SYLLABLES.length])
  const words: string[] = []
  for (let i = 0; i < chars.length; i += wordLen) words.push(chars.slice(i, i + wordLen).join(''))
  return words.join(' ')
}

/** 이름표 표본 — 장식 라벨 상한은 공백을 세므로 띄어 쓰지 않는다 */
const tagText = (n: number) => fillerText(n).replace(/\s/g, '')

type SlotRole = 'rating' | 'mark' | 'tags' | 'dimension'

/** 별점 분포 표본(적용 K7-b) — input-slots.sample.ts 자사 리뷰 rating_counts와 같은 값 */
const RATING_BARS_SAMPLE = { 5: 70, 4: 20, 3: 6, 2: 3, 1: 1 }

/**
 * 같은 축척 윤곽 표본(적용 K7 4d) — 입력 모양 그대로의 사이즈 표(가로·세로 cm, 크기가 고르게 커지는 다섯 행). 목록 수만큼 앞에서부터 쓴다.
 * 표본은 같은 축척 칸 채우기(scaleItems)를 그대로 지나야 한다 — 그리지 못하는 값이면 높이 계산이 0이 된다
 */
const SCALE_SAMPLE_ROWS = [
  { label: 'S', values: ['20cm', '24cm'] },
  { label: 'M', values: ['26cm', '30cm'] },
  { label: 'L', values: ['32cm', '36cm'] },
  { label: 'XL', values: ['38cm', '42cm'] },
  { label: '2XL', values: ['44cm', '48cm'] },
]

/** 원형 배지 표본(R-D1) — 입력 모양의 짧은 값. 인증은 실제 인증처럼 보이지 않는 중립 낱말이다 */
const BADGE_SAMPLES: Record<string, string> = { 'badge.rating': '4.8', 'badge.quantity': '20개', 'badge.certification': '인증이름' }

/** 흐름을 훑어 슬롯이 어떤 노드에 쓰이는지 — 별점은 숫자, 표시는 check 값이 필요하다 */
function rolesOf(nodes: readonly FlowNode[], roles = new Map<string, SlotRole>()): Map<string, SlotRole> {
  for (const node of nodes) {
    if (node.kind === 'rating') roles.set(node.slot, 'rating')
    if (node.kind === 'tags') roles.set(node.slot, 'tags')
    if (node.kind === 'dimension') {
      roles.set(node.widthSlot, 'dimension')
      roles.set(node.heightSlot, 'dimension')
      if (node.depthSlot) roles.set(node.depthSlot, 'dimension')
    }
    if (node.kind === 'mark' && node.slot) roles.set(node.slot, 'mark')
    // 진행 표시 이름(R-W7·T2-52)은 탭 낱말이라 이름표처럼 띄어 쓰지 않는다
    if (node.kind === 'steps') roles.set(node.field, 'tags')
    if (node.kind === 'capsule' && node.steps) {
      roles.set(node.steps.name, 'tags')
      roles.set(POINT_STEPS_NAME, 'tags')
    }
    if (node.kind === 'panel' || node.kind === 'repeat') rolesOf(node.nodes, roles)
    if (node.kind === 'row') for (const column of node.columns) rolesOf(column.nodes, roles)
  }
  return roles
}

export interface SampleOptions {
  /** required = 필수 슬롯만·목록 min개, full = 모든 슬롯·목록 max개 */
  mode: 'required' | 'full'
  /** 글자 수 상한에 곱할 값 */
  factor?: number
}

/** 견본 색 칸(choices hex, 적용 C5 ③) 표본 — 짙은·옅은·흰 견본이 섞이게(옅은 테두리가 W 바탕에서 보이는지) */
export const SAMPLE_HEX = ['#5A7D5A', '#D9C7A7', '#FFFFFF', '#2F3A4A', '#C8553D', '#E8E4DC']

const textValue = (def: TextSlot, role: SlotRole | undefined, factor: number, index = 0): string => {
  if (def.choices === 'icon') return ICON_NAMES[index % ICON_NAMES.length]
  if (def.choices === 'hex') return SAMPLE_HEX[index % SAMPLE_HEX.length]
  if (role === 'rating') return '4.8'
  if (role === 'mark') return 'check'
  if (def.input === 'chapter') return '2'
  if (def.input === 'review.rating') return '4.8'
  if (def.input && def.input in BADGE_SAMPLES) return BADGE_SAMPLES[def.input]
  // 이름표는 장식 라벨이라 공백까지 글자 수에 든다
  if (role === 'dimension' || role === 'tags') return tagText(def.maxChars * factor)
  return fillerText(def.maxChars * factor)
}

function slotValue(name: string, def: SlotDef, roles: Map<string, SlotRole>, opts: Required<SampleOptions>): SlotValue {
  if (def.type === 'image') return `sample-${name}`
  if (def.type === 'text') return textValue(def, roles.get(name), opts.factor)
  // 별점 분포(적용 K7-b) — 입력 모양 그대로 5줄, 표본 분포는 input-slots.sample.ts와 같다(70·20·6·3·1)
  if (def.input === RATING_BARS_INPUT) return ratingBarItems({ reviewFiles: { own: { stats: { rating_counts: RATING_BARS_SAMPLE } } } } as never)
  const count = opts.mode === 'full' ? def.max : Math.max(def.min, 1)
  if (def.input === SIZE_SCALE_INPUT) return scaleItems(def, { spec: { sizeMatrix: { columns: ['가로', '세로'], rows: SCALE_SAMPLE_ROWS.slice(0, count) } } as never })
  if (Object.keys(def.fields).length === 0) return Array.from({ length: count }, () => tagText(TAG_MAX_CHARS * opts.factor))
  return Array.from({ length: count }, (_, i): SlotItem => itemValue(def, i, roles, opts))
}

function itemValue(def: ListSlot, index: number, roles: Map<string, SlotRole>, opts: Required<SampleOptions>): SlotItem {
  const item: SlotItem = {}
  for (const [name, field] of Object.entries(def.fields)) {
    if (opts.mode === 'required' && !field.required) continue
    item[name] = field.type === 'image' ? `sample-${name}-${index}` : textValue(field, roles.get(name), opts.factor, index)
  }
  return item
}

export function sampleSlots(t: Pick<Template, 'flow' | 'slots'>, options: SampleOptions): SlotValues {
  const opts = { factor: 1, ...options }
  const roles = rolesOf(t.flow)
  const values: SlotValues = {}
  for (const [name, def] of Object.entries(t.slots)) {
    if (opts.mode === 'required' && !def.required) continue
    values[name] = slotValue(name, def, roles, opts)
  }
  return values
}

/** 높이 계산·검사용 중립 색 — 높이는 색과 무관하다 */
export const SAMPLE_COLORS: Colors = {
  base: '#FFFFFF',
  accent: '#2F6FED',
  accentText: '#1F4FB0',
  deep: '#14233F',
  tint: '#EEF3FE',
  ink: '#1A1A1A',
  photo: '#F1F3F7',
  onDeep: '#FFFFFF',
  onAccent: '#FFFFFF',
  neutral: '#F4F5F7',
  heading: '#14233F',
  highlight: false,
}

export const sampleContext = (over: Partial<TemplateContext> = {}): TemplateContext => ({
  colors: SAMPLE_COLORS,
  radius: { capsule: 32, card: 28, bubble: 36, chip: 999 },
  image: (key) => (key ? `https://sample.invalid/${key}.png` : null),
  ...over,
})

const HEIGHT_STEP = 10
const roundStep = (v: number) => Math.round(v / HEIGHT_STEP) * HEIGHT_STEP
/** 최소 높이를 잴 때 글자 양 — 필수 슬롯을 상한의 절반으로 채운 짧은 글 */
const MIN_FILL = 0.5

/**
 * 예상 높이(860 폭, px) — min은 필수 슬롯만 짧은 글로, max는 모든 슬롯을 상한까지 채운 값. 사진은 슬롯의 첫 비율이다.
 * typical은 그 가운데다. 순서 풀이가 페이지 높이를 계산할 때와 검사기가 메타데이터를 대조할 때 쓴다. 그리지 못하면 0이다.
 */
export function heightRange(t: Template): { min: number; max: number; typical: number } {
  const ctx = sampleContext()
  const min = renderTemplate(t, sampleSlots(t, { mode: 'required', factor: MIN_FILL }), ctx)
  const max = renderTemplate(t, sampleSlots(t, { mode: 'full' }), ctx)
  const low = roundStep(min?.height ?? 0)
  const high = roundStep(max?.height ?? 0)
  return { min: low, max: high, typical: roundStep((low + high) / 2) }
}
