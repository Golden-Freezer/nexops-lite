/**
 * K 라인 순서 풀이(계획 §5) — AI가 고른 후보를 흐름 순서로 놓고, 같은 모양 3연속·이웃 금지·POINT 3·사실 예산을 지키고, 긴 페이지(18~22섹션,
 * 세로 합격점 780 파일 25,000px)가 되도록 채운다. 채움은 상한까지만 넣고 모자라면 issues로 남겨 다시 고른다(R14: 사진 막 7~8개가 흐름 점수를 내렸다).
 * 큰 POINT 셋은 같은 머리에서 나온다. 바탕은 페이지 예산 안에서(surface-budget.ts), 사진 구도는 페이지 안에서 겹치지 않게 배정한다. 순수·결정론.
 */

import type { DesigncutBg } from '../pdp-state'
import type { Concept } from './concepts'
import { assignSurfaces, bandFits, visibleSurfaces, W_MAX_RUN } from './surface-budget'
import { copyFactRange, factBudget, type ProductFact } from './selection-facts'
import { devicesOf, PAGE_DEVICES, skeletonOf } from './page-mix'
import { INFO_CELL_MAX, isInfoCell } from './info-cells'
import { allowedCompositions, assignShotRows, HAND_OR_WORN, SHOT_MINIMUM, type ShotContext, type ShotPlan } from './shot-assign'
import { PAGE_MIN_HEIGHT, PAGE_PASS_HEIGHT, PAGE_SECTIONS, POINT_SECTION, TEMPLATE_ZONES, signatureOf, type MetaImageSlot, type TemplateMeta } from './template-meta'
import { INPUT_PHOTO_LISTS } from './template-types'

export { POINT_SECTION }
export { assignSurfaces }
export const POINT_MAX = 3
/** 페이지에 꼭 있어야 하는 섹션 — 첫 화면, 필수인 상품 정보 표, 마무리 */
export const REQUIRED_SECTIONS = ['hook_3step', 'spec_table', 'cta']
/** 같은 모양이 이어져도 되는 최대 수 */
const SAME_SHAPE_MAX_RUN = 2
/** 사실이 모자랄 때 채우는 섹션 — 같은 말을 늘리지 않고 보여 주는 섹션(사용 장면·구도가 다른 컷·디테일). 사실을 요구하지 않는 템플릿만 쓴다 */
export const FACT_FREE_FILLERS = ['sub2_div_page', 'product_exposure', 'petit_div'] as const
/** 페이지당 채움 상한(20섹션의 20%) — R14-L은 사진 막 7~8개에 r4가 3→2.17로 내렸다. 모자라면 억지로 채우지 않고 issues로 남긴다 */
export const FILLER_MAX = 4
/** 그래도 합격점 아래인 페이지만 한 번 더 받아 보는 채움 수(적용 K14, select-line이 부른다) — 사진만 있는 채움 상한은 그대로다 */
export const FILLER_SHORT_EXTRA = 1
/** 그중 글 칸 없이 사진만 있는 템플릿 상한 */
export const PHOTO_ONLY_FILLER_MAX = 2
/** 채움을 곁에 두지 않는 섹션 — 후기·상품 정보 표 흐름을 끊지 않는다. 큰 POINT 사이도 막는다 */
const NO_FILLER_BESIDE: ReadonlySet<string> = new Set(['review', 'spec_table'])
/** 이보다 낮은 섹션은 숨 고르기다 — 둘이 이어지면 페이지가 끊겨 보인다(A 시드 petit_div 430·510·690) */
export const SHORT_SECTION_HEIGHT = 700
/** 페이지 안 같은 뼈대 상한(최종 보고 개선 #4, 시작값) — 큰 POINT 셋은 빼고 2회까지, 같은 뼈대끼리 이웃하지 않는다 */
export const SKELETON_MAX = 2
/** 페이지당 부품 상한(개선 #6·연구 A5 #14, 시작값) — 비교·체크·말풍선과 원·아치 틀(K3 T1-50 사진 모양 상한) 각각 2곳까지 */
export const DEVICE_MAX = 2

export interface OrderInput {
  section: string
  /** AI가 고른 순서의 후보 — 맨 앞이 고른 것이고 뒤는 다음 후보다 */
  candidates: TemplateMeta[]
  filler?: boolean
}

export type { ShotContext, ShotPlan }

export interface OrderedSection {
  section: string
  templateId: string
  /** 규칙 때문에 처음 고른 것에서 넘어왔으면 그 템플릿 */
  fallbackFrom?: string
  /** 길이를 맞추려고 코드가 더한 섹션 */
  filler?: true
  bg: DesigncutBg
  /** 이 섹션이 카피로 새로 말할 사실 수 — 사실량을 준 경우만. 카피는 이 수만큼만 칸을 채우고 엔진은 빈 칸을 지운다 */
  factSlots?: number
  shots: ShotPlan[]
}

export interface OrderResult {
  sections: OrderedSection[]
  /** 지키지 못한 규칙 — 비어야 통과다. 호출자가 다른 구성으로 다시 고른다 */
  issues: string[]
  /** 새로 말할 사실이 남지 않아 뺀 섹션 — 규칙대로 뺀 것이라 문제가 아니다 */
  droppedForFacts: string[]
  /** 컷 상한 때문에 뺀 섹션 */
  droppedForShots: string[]
  height: { estimated: number; meetsRequired: boolean }
}

export interface OrderOptions {
  /** 상품 사실 — 주면 사실 예산을 나눈다 */
  facts?: readonly ProductFact[]
  /** 채움 후보(FACT_FREE_FILLERS의 후보) — 주면 긴 페이지 기준을 채우고 검사한다. 같은 섹션을 다른 템플릿으로 여러 번 쓸 수 있다 */
  fillers?: readonly OrderInput[]
  /** 컷 배정에 쓰는 상품 조건 — 주면 착용·여러 개·크기 규칙과 최소 장 수를 지킨다 */
  shots?: ShotContext
  /**
   * 채움 돌리기 값(상품·컨셉별, 개선 #5) — 주면 높이가 맞고 모자란 최소 장 수를 채우는 후보 안에서 이 값이 작은 것을 고른다.
   * 없으면 새 구도가 많은 것이 이겨 같은 채움이 페이지마다 뽑힌다(484페이지에 petit_div.hashtag-grid 68%)
   */
  fillerTurn?: (template: Pick<TemplateMeta, 'id'>) => number
  /** 상품 카테고리 — 주면 mixed·dark 리듬의 바탕 예산에 카테고리별 T 상한·D 보정을 얹는다(K3 T1-27, surfaceBudgetOf) */
  category?: string
  /** 채움 상한에 더하는 수 — 합격점 아래 페이지를 다시 풀 때만 준다(FILLER_SHORT_EXTRA). 없으면 FILLER_MAX 그대로다 */
  fillerExtra?: number
}

/**
 * 페이지 맨 끝 섹션(오너 지시 11-01 '사이즈와 상품 정보 섹션은 항상 맨 마지막 또는 맨 마지막 바로 앞') — 상품 정보 표는 구역과 상관없이 맨 끝이다.
 * 마무리·권유·후기·질문은 모두 그 앞이다. K에는 사이즈 전용 섹션이 없고 치수는 표 안에 든다(spec_table.dimension).
 */
export const PAGE_LAST_SECTION = 'spec_table'

/** 실제 렌더 높이 ÷ 대표 높이 합 — K0 R15 다섯 잡 평균 0.90(0.87~0.95). 빈 선택 칸이 섞인 값이라 K1 첫 잡에서 다시 잰다(통합 결정 11-01) */
export const RENDER_HEIGHT_RATIO = 0.9
/**
 * 페이지당 컷 상한(통합 결정 11-01) — 32장이면 R15 단가로 약 $1.04라 잡 상한 $1.5 안이다. 11상품 계산값 평균이 상한 없을 때와 약 280px 차이다.
 * 합격점 미달 수가 상한 없을 때와 같아지는 가장 작은 값이다(24장 4개, 28장 3개, 32장부터 2개).
 */
export const PAGE_SHOT_MAX = 32

/** 페이지 높이 추정 — 대표 높이의 합에 실제 렌더 비율을 곱한다. 계획의 합격점 판정은 이 값으로 한다 */
export function estimatePageHeight(templates: ReadonlyArray<Pick<TemplateMeta, 'height'>>): number {
  return Math.round(templates.reduce((sum, t) => sum + t.height, 0) * RENDER_HEIGHT_RATIO)
}

const factMin = (t: TemplateMeta) => copyFactRange(t).min

/**
 * 자리 띠(분석 2차 A1 2절) — 판매 페이지는 후기 첫 위치 0.21~0.37, 추천·옵션은 뒤쪽인데 구역 순서만 쓰면 근거가 끝에 몰리고 가치 구역 안 순서를 코드가 맞추지 못한다.
 * 칸이 아니라 띠다. 띠 안은 들어온 순서 그대로이고 값은 판단이다. 템플릿 order.zone은 건드리지 않고, 표에 없는 섹션만 구역으로 자리를 정한다.
 */
export const FLOW_RANK: Readonly<Record<string, number>> = {
  hook_3step: 1,
  main_cut: 2,
  problem_raise: 3,
  problem_empathy: 3,
  solution_guide: 4,
  point_div: 5,
  perf_metric: 8,
  review: 8,
  key_message: 8,
  certification: 9,
  sub_div: 10,
  hidden_page: 11,
  compare: 11,
  point_list_div: 11,
  concept_desc: 11,
  sub2_div_page: 12,
  petit_div: 12,
  option_gallery: 13,
  direction_suggest: 14,
  convert_div: 14,
  how_to: 15,
  // GIF 칸(움직이는 띠)은 사용법 바로 뒤 — 사용·변형 동작이나 옵션 밀기를 그 설명 아래에서 보인다(B DESIGN 1절). 첫 화면에서 멀다
  motion_band: 15.2,
  // 성분·원료(적용 K3 R-W8)는 사용법 바로 뒤 — 앞에 놓이면 풀폭 띠·사실 예산을 먼저 써 사용법이 빠졌다(표본 원재료 484쪽 중 7쪽). 입력 정보 섹션 순서와 같다
  ingredients: 15.5,
  // 주의·보관(적용 K7-c (가))은 사용법·성분 뒤 — D T9 주의·보관 표가 사용법 뒤인 것과 같은 자리, 입력 정보 섹션끼리 붙는다
  notice: 15.7,
  product_exposure: 16,
  faq: 17,
  event_offer: 18,
  cta: 19,
  [PAGE_LAST_SECTION]: 21,
}
const ZONE_FLOW_RANK: Readonly<Record<(typeof TEMPLATE_ZONES)[number], number>> = { intro: 2, problem: 3, value: 11, trust: 17, decision: 19 }
/** 둘째 후기는 질문과 같은 자리다 */
const SECOND_REVIEW_RANK = 17
/** 앞쪽 근거 섹션 — 채움이 그 앞에 들어가 근거를 뒤로 밀지 않게 한다. 둘째 후기는 뒤쪽이라 세지 않는다 */
const PROOF_SECTIONS: ReadonlySet<string> = new Set(['review', 'perf_metric', 'certification'])
/** 채움이 들어가는 구간 — 큰 POINT부터 마무리 묶음 앞까지. 근거가 있으면 앞쪽 근거 뒤부터다. fillerFits가 POINT 사이·후기·표 곁을 막는다 */
const FILLER_RANGE = { from: FLOW_RANK.point_div, to: FLOW_RANK.product_exposure }

const flowRank = (input: OrderInput) => FLOW_RANK[input.section] ?? ZONE_FLOW_RANK[input.candidates[0].order.zone]
const inFillerRange = (input: OrderInput) => flowRank(input) >= FILLER_RANGE.from && flowRank(input) <= FILLER_RANGE.to

/** 자리 띠 순서로 놓는다 — 같은 띠는 들어온 순서다 */
function sortByFlow(inputs: readonly OrderInput[]): OrderInput[] {
  let reviews = 0
  return inputs
    .map((input, i) => ({ input, i, rank: input.section === 'review' && ++reviews > 1 ? SECOND_REVIEW_RANK : flowRank(input) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(({ input }) => input)
}

/**
 * 권유 섹션을 마무리에 붙이지 않는다(A1 #4) — convert_div가 cta 바로 앞에 놓였으면 그 앞 섹션 앞으로 옮긴 목록을 돌려준다. 옮길 수 없으면 null이다.
 * 놓은 뒤에 본다. 사실 예산으로 사이 섹션이 빠지면 띠 순서만으로는 붙기 때문이다.
 */
function closerMoved(list: readonly OrderInput[], rows: ReadonlyArray<{ section: string }>): OrderInput[] | null {
  const at = rows.findIndex((row) => row.section === 'cta')
  if (at < 2 || rows[at - 1].section !== 'convert_div' || rows[at - 2].section === POINT_SECTION) return null
  const from = list.findIndex((input) => input.section === 'convert_div')
  const to = list.slice(0, from).map((input) => input.section).lastIndexOf(rows[at - 2].section)
  if (from < 0 || to < 0) return null
  return [...list.slice(0, to), list[from], ...list.slice(to, from), ...list.slice(from + 1)]
}
const isPoint = (t: Pick<TemplateMeta, 'section'>) => t.section === POINT_SECTION

/**
 * 같은 모양이 SAME_SHAPE_MAX_RUN을 넘겨 이어지는가, 이웃 금지인가, 이미 쓴 템플릿인가, 숨 고르기 섹션이 이어지는가.
 * 큰 POINT끼리는 예외다 — 같은 머리에서 나오므로(오너 지시 11-01) 같은 템플릿·같은 모양이 이어져도 된다. 다른 모양을 먼저 고르는 것은 pointCandidates 몫이다.
 */
function conflicts(candidate: TemplateMeta, placed: readonly TemplateMeta[]): boolean {
  if (!isPoint(candidate) && placed.some((t) => t.id === candidate.id)) return true
  const prev = placed.at(-1)
  if (prev && prev.height < SHORT_SECTION_HEIGHT && candidate.height < SHORT_SECTION_HEIGHT) return true
  if (prev && isPoint(prev) && isPoint(candidate)) return false
  if (prev && (prev.order.notNextTo.includes(candidate.id) || candidate.order.notNextTo.includes(prev.id))) return true
  const tail = placed.slice(-SAME_SHAPE_MAX_RUN)
  return tail.length === SAME_SHAPE_MAX_RUN && tail.every((t) => signatureOf(t) === signatureOf(candidate))
}

/**
 * 같은 뼈대·부품 상한을 지키는가(개선 #4·#6) — 같은 뼈대는 SKELETON_MAX번까지고 바로 앞과 같으면 안 된다. 비교·체크·말풍선·원·아치 틀은 각각 DEVICE_MAX곳까지다.
 * 큰 POINT는 같은 머리에서 나오므로 뼈대는 막지 않는다. 부품은 막는다 — 막지 않으면 첫 화면·메인 컷 말풍선 뒤 말풍선 POINT가 셋째가 됐다(K3, P08 candy-pop).
 * POINT 후보는 같은 머리 안에서만 넘어가고(pointCandidates), 지킬 후보가 없을 때의 처리는 놓아 보기(place)가 정한다.
 */
function mixFits(candidate: TemplateMeta, placed: readonly TemplateMeta[]): boolean {
  const devicesFit = [...devicesOf(candidate)].every((device) => placed.filter((t) => devicesOf(t).has(device)).length < DEVICE_MAX) && infoFits(candidate, placed)
  if (isPoint(candidate)) return devicesFit
  const skeleton = skeletonOf(candidate)
  const prev = placed.at(-1)
  if (skeleton !== null && prev && skeletonOf(prev) === skeleton) return false
  if (skeleton !== null && placed.filter((t) => skeletonOf(t) === skeleton).length >= SKELETON_MAX) return false
  return devicesFit
}

/**
 * 보이는 바탕의 가장 긴 흰 바탕 연속 — 채움을 더해 W_MAX_RUN을 새로 넘기면 그 채움은 버리고 다음 후보를 쓴다(개선 #5).
 * 돌린 채움이 흰 바탕만 받는 자리에 들어가면 바탕 예산을 다 쓴 페이지가 흰 바탕 5칸이 됐다(P09 밝은 리듬 7페이지)
 */
function whiteRun(placed: readonly TemplateMeta[], rhythm: Concept['rhythm'], category?: string): number {
  let run = 0
  let best = 0
  for (const cell of visibleSurfaces(placed, assignSurfaces(placed, rhythm, category))) {
    run = cell === 'W' ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}

/**
 * 페이지가 같은 뼈대·부품 상한을 넘긴 수 — 채움을 더해 이 값이 늘면 그 채움은 버린다. 채움이 앞자리에 들어가 상한을 먼저 쓰면
 * 뒤의 구성 섹션이 상한 없이 놓여 결국 넘기기 때문이다.
 */
function mixOver(placed: readonly TemplateMeta[]): number {
  const counts = new Map<string, number>()
  let over = 0
  let prev: string | null = null
  for (const t of placed) {
    const key = skeletonOf(t)
    if (key !== null) {
      const n = (counts.get(key) ?? 0) + 1
      counts.set(key, n)
      if (n > SKELETON_MAX) over++
      if (key === prev) over++
    }
    prev = key
  }
  for (const device of PAGE_DEVICES) over += Math.max(0, placed.filter((t) => devicesOf(t).has(device)).length - DEVICE_MAX)
  over += Math.max(0, placed.filter(isInfoCell).length - INFO_CELL_MAX)
  return over
}

/** 사진 아닌 정보 칸(infocells 잡만, 설계 I4) — 쪽당 INFO_CELL_MAX곳까지, 같은 정보 칸은 한 번. 꺼진 잡은 정보 칸 후보가 없어 늘 참이다 */
function infoFits(candidate: TemplateMeta, placed: readonly TemplateMeta[]): boolean {
  return !isInfoCell(candidate) || (placed.filter(isInfoCell).length < INFO_CELL_MAX && !placed.some((t) => t.id === candidate.id))
}

/**
 * 둘째·셋째 POINT의 후보 — 첫 POINT와 머리가 같은 것만, 아래 배치가 페이지 POINT에 없던 모양 → 안 쓴 템플릿 → 이미 쓴 템플릿 순서다.
 * 머리가 같은 후보가 없으면 첫 POINT 템플릿을 다시 쓴다(머리가 달라지는 것보다 낫다).
 */
function pointCandidates(candidates: readonly TemplateMeta[], placed: readonly TemplateMeta[]): readonly TemplateMeta[] {
  const points = placed.filter(isPoint)
  if (points.length === 0) return candidates
  const shapes = new Set(points.map(signatureOf))
  const rank = (t: TemplateMeta) => (points.some((p) => p.id === t.id) ? 2 : shapes.has(signatureOf(t)) ? 1 : 0)
  const same = candidates.filter((t) => t.headStyle === points[0].headStyle)
  return same.length > 0 ? [...same].sort((a, b) => rank(a) - rank(b)) : [points[0]]
}

/** 글 칸 없이 사진만 있는 템플릿 */
function isPhotoOnly(t: Pick<TemplateMeta, 'slots'>): boolean {
  const slots = Object.values(t.slots)
  return slots.length > 0 && slots.every((slot) => slot.type === 'image' || (slot.type === 'list' && Object.values(slot.fields).every((field) => field.type === 'image')))
}

/** 페이지의 사진 슬롯 하나하나 — 목록은 최소 항목 수만큼이다(컷마다 비용·시간이 들고, 구도 가짓수를 넘기면 같은 그림이 된다). 옵션 사진 목록은 입력값이라 뺀다 */
export function imageSlots(template: Pick<TemplateMeta, 'slots'>): Array<{ slot: string; def: MetaImageSlot }> {
  return Object.entries(template.slots).flatMap(([name, slot]) => {
    if (slot.type === 'image') return [{ slot: name, def: slot }]
    if (slot.type !== 'list' || INPUT_PHOTO_LISTS.includes(slot.input ?? '')) return []
    return Object.entries(slot.fields).flatMap(([field, def]) =>
      def.type === 'image' ? Array.from({ length: Math.min(Math.max(slot.min, 1), def.composition.length) }, () => ({ slot: `${name}.${field}`, def })) : []
    )
  })
}

/** 이 템플릿이 만들게 하는 컷 수 — assignShots가 나눠 주는 줄 수와 같다 */
export const shotCountOf = (template: Pick<TemplateMeta, 'slots'>): number => imageSlots(template).length

/** 구도·목적 배정 — 지문으로는 구도 반복을 잡지 못하므로(15_TEMPLATE_LINE §4) 처음부터 나눠 준다. 규칙은 shot-assign.ts다 */
export function assignShots(templates: ReadonlyArray<Pick<TemplateMeta, 'slots'> & Partial<Pick<TemplateMeta, 'section'>>>, context?: ShotContext): ShotPlan[][] {
  return assignShotRows(templates.map(imageSlots), context, templates.map((t) => t.section ?? ''))
}

const compositionsOf = (t: Pick<TemplateMeta, 'slots'>) => imageSlots(t).flatMap(({ def }) => def.composition)

/**
 * 채움을 돌릴 때 맞출 높이 여유 — 돌리면 합격점에 겨우 닿는 짧은 채움도 고르게 되어 11상품 평균이 564px 줄고 P11이 합격점 위 20px가 됐다.
 * 실제 렌더 비율(RENDER_HEIGHT_RATIO 0.87~0.95)이 흔들려도 합격점 아래로 내려가지 않게 둔다(시작값)
 */
const FILLER_TURN_MARGIN = 500

/** 컷 최소 장 수 가운데 구도로 정해지는 것(SHOT_MINIMUM) — 크기는 목적이라 뺀다 */
const SHOT_KINDS: ReadonlyArray<{ need: number; has: (composition: string) => boolean }> = [
  { need: SHOT_MINIMUM.handOrWorn, has: (c) => HAND_OR_WORN.has(c) },
  { need: SHOT_MINIMUM.closeup, has: (c) => c === 'closeup' },
  { need: SHOT_MINIMUM.group, has: (c) => c === 'group' },
]
/** 그 구도를 받을 수 있는 사진 칸 수 — 상품 조건(착용·여러 개)으로 막힌 구도는 세지 않는다 */
const slotSupply = (t: Pick<TemplateMeta, 'slots'>, has: (c: string) => boolean, context?: ShotContext) =>
  imageSlots(t).filter(({ def }) => allowedCompositions(def, context).some(has)).length

/**
 * 다음 채움 — 먼저 남은 자리로 높이를 맞출 만큼 큰 것, 그다음 페이지에 없던 구도가 많은 것, 덜 쓴 섹션, 높이가 모자라면 큰 것, 같으면 후보 순서다.
 * 사실이 없을 때 페이지가 같은 그림·같은 섹션으로 채워지지 않게 하는 자리다.
 * turn을 주면 돌린다(개선 #5) — 남은 채움 칸으로 나눈 부족 높이(합격점 + FILLER_TURN_MARGIN)를 채우는 것(맞는 것이 없으면 큰 것), 아직 모자란
 * 손·몸·근접·여러 개 최소 장 수를 채우는 것, 컷이 남은 컷 몫(남은 컷 ÷ 남은 채움 칸) 안인 것, 이 상품이 쓸 수 있는 새 구도가 있는 것, 덜 쓴 섹션,
 * 그다음 turn 값이 작은 것이다. 컷 몫은 앞 채움이 컷 상한을 다 써 뒤 칸에 글만 있는 짧은 채움이 들어가지 않게 한다(P07 본문 컷 25에서 4·3컷 채움 뒤 585·513).
 * 새 구도 수로 줄 세우면 사진 칸이 많은 템플릿이 늘 이긴다. 높이·최소 장 수를 먼저 보는 것은 돌리느라 페이지가 짧아지거나 손 컷이 모자라지 않게 하려는 것이다.
 */
function nextFiller(
  pool: ReadonlyArray<{ section: string; template: TemplateMeta }>,
  placed: readonly TemplateMeta[],
  fillersLeft: number,
  turn?: OrderOptions['fillerTurn'],
  context?: ShotContext
) {
  const height = estimatePageHeight(placed)
  const lacking = Math.max(0, PAGE_MIN_HEIGHT - height)
  const need = lacking / Math.max(1, PAGE_SECTIONS.max - placed.length)
  const shown = new Set(placed.flatMap(compositionsOf))
  if (!turn) {
    const rank = ({ section, template }: { section: string; template: TemplateMeta }) => [
      estimatePageHeight([template]) >= need ? 1 : 0,
      new Set(compositionsOf(template).filter((c) => !shown.has(c))).size,
      -placed.filter((t) => t.section === section).length,
      lacking > 0 ? template.height : 0,
    ]
    return bestBy(pool, rank)
  }
  // 모자란 최소 장 수는 지금 페이지의 실제 컷 배정으로 센다 — 칸이 받는 구도로 세면 한 칸을 손·근접에 겹쳐 세어 모자람을 놓친다
  const assigned = assignShots(placed, context).flat()
  const short = SHOT_KINDS.map(({ need: min, has }) => ({ has, left: Math.max(0, min - assigned.filter((shot) => has(shot.composition)).length) }))
  const aim = Math.max(0, PAGE_MIN_HEIGHT + FILLER_TURN_MARGIN - height)
  const shotShare = Math.floor(Math.max(0, PAGE_SHOT_MAX - placed.reduce((sum, t) => sum + shotCountOf(t), 0)) / Math.max(1, fillersLeft))
  const rank = ({ section, template }: { section: string; template: TemplateMeta }) => {
    const fits = estimatePageHeight([template]) >= aim / Math.max(1, fillersLeft)
    const fills = short.reduce((sum, { has, left }) => sum + Math.min(left, slotSupply(template, has, context)), 0)
    // 새 구도는 이 상품이 쓸 수 있는 구도만 센다 — 못 쓰는 착용 구도를 새 구도로 세면 그 템플릿이 페이지마다 뽑힌다(sub2_div_page.bottom-left)
    const opened = imageSlots(template).some(({ def }) => allowedCompositions(def, context).some((c) => !shown.has(c)))
    const spares = shotCountOf(template) <= shotShare
    return [fits ? 1 : 0, fits ? 0 : template.height, fills, spares ? 1 : 0, opened ? 1 : 0, -placed.filter((t) => t.section === section).length, -turn(template)]
  }
  return bestBy(pool, rank)
}

/** 순위가 가장 높은 것 — 앞 값부터 비교하고 같으면 먼저 온 것 */
function bestBy<T>(pool: readonly T[], rank: (item: T) => number[]): T {
  let best = pool[0]
  for (const item of pool.slice(1)) {
    const [a, b] = [rank(item), rank(best)]
    const diff = a.findIndex((value, i) => value !== b[i])
    if (diff >= 0 && a[diff] > b[diff]) best = item
  }
  return best
}

/** 이 자리에 채움을 넣어도 되는가 — 채움끼리 붙지 않고, 큰 POINT 사이·후기·표 곁이 아니다 */
function fillerFits(ordered: readonly OrderInput[], at: number): boolean {
  const [prev, next] = [ordered[at - 1], ordered[at]]
  if (prev?.filler || next?.filler) return false
  if (prev?.section === POINT_SECTION && next?.section === POINT_SECTION) return false
  return ![prev?.section, next?.section].some((section) => section !== undefined && NO_FILLER_BESIDE.has(section))
}

/**
 * 채움을 채움 구간 안, 채움끼리 가장 먼 자리의 가운데에 넣는다 — 한곳에 몰리면 페이지 끝이 사진 묶음이 된다.
 * 그 자리가 막혔으면(fillerFits) 구간 안에서 가장 가까운 자리로 옮기고, 구간 안에 자리가 없으면 null이다(이 채움은 버린다).
 */
function insertSpaced(ordered: readonly OrderInput[], filler: OrderInput): OrderInput[] | null {
  const firstReview = ordered.findIndex((input) => input.section === 'review')
  const proofEnd = ordered.reduce((end, input, i) => (PROOF_SECTIONS.has(input.section) && (input.section !== 'review' || i === firstReview) ? i : end), -1)
  const inZone = ordered.flatMap((input, i) => (i > proofEnd && inFillerRange(input) ? [i] : []))
  const placeAt = (preferred: number, from: number, to: number) => {
    const spots = Array.from({ length: to - from + 1 }, (_, i) => from + i).filter((spot) => fillerFits(ordered, spot))
    if (spots.length === 0) return null
    const spot = spots.reduce((best, s) => (Math.abs(s - preferred) < Math.abs(best - preferred) ? s : best), spots[0])
    return [...ordered.slice(0, spot), filler, ...ordered.slice(spot)]
  }
  if (inZone.length === 0) {
    const after = ordered.findIndex((input) => flowRank(input) > FILLER_RANGE.to)
    const spot = after < 0 ? ordered.length : after
    return placeAt(spot, spot, spot)
  }
  const anchors = [inZone[0] - 1, ...inZone.filter((i) => ordered[i].filler), inZone[inZone.length - 1] + 1]
  let at = anchors[0] + 1
  let longest = -1
  for (let k = 0; k + 1 < anchors.length; k++) {
    const length = anchors[k + 1] - anchors[k] - 1
    if (length > longest) {
      longest = length
      at = anchors[k] + 1 + Math.ceil(length / 2)
    }
  }
  return placeAt(at, inZone[0], inZone[inZone.length - 1] + 1)
}

/**
 * 컷 상한 때문에 빼지 않는 섹션 — 필수 섹션·후기·큰 POINT, 그리고 GIF 칸(컷 1장, 구성 고치기가 자리를 보장한 칸 — 세션 B ③ P5).
 * GIF 칸은 motionband 스위치 잡에만 있어 꺼진 잡은 지금과 같다
 */
const isShotProtected = (section: string) =>
  REQUIRED_SECTIONS.includes(section) || section === 'review' || section === POINT_SECTION || section === 'motion_band'

/**
 * 컷 상한 안에 들게 구성을 줄인다 — 섹션마다 가장 적은 컷의 합이 상한을 넘으면 뒤 섹션을 그냥 잃으므로, 먼저 뺄 것을 고른다.
 * 필수 섹션·후기·큰 POINT는 두고, 나머지에서 컷이 많은 것부터(같으면 뒤쪽부터) 뺀다.
 */
function trimForShots(list: readonly OrderInput[]): { kept: OrderInput[]; removed: string[] } {
  const kept = [...list]
  const removed: string[] = []
  const minShots = (input: OrderInput) => Math.min(...input.candidates.map(shotCountOf))
  while (kept.reduce((sum, input) => sum + minShots(input), 0) > PAGE_SHOT_MAX) {
    let at = -1
    kept.forEach((input, i) => {
      if (isShotProtected(input.section) || minShots(input) === 0) return
      if (at < 0 || minShots(input) >= minShots(kept[at])) at = i
    })
    if (at < 0) break
    removed.push(kept[at].section)
    kept.splice(at, 1)
  }
  return { kept, removed }
}

/**
 * 순서 풀이 — 자리 띠 순서로 놓고(같은 띠 안에서는 AI 순서 그대로, 상품 정보 표는 맨 끝), 큰 POINT는 앞 3개만 남기고, 같은 모양 3연속·이웃 금지·같은 템플릿 반복을 다음
 * 후보로 피한다. 후보로 풀리지 않으면 issues에 남긴다(지어내지 않는다).
 * facts를 주면 사실 예산을 나눈다 — 앞 섹션부터 최소 칸을 주되 뒤 섹션의 최소 칸을 남겨 두려고 칸이 적은 후보로 넘어갈 수 있다(fallbackFrom에 남는다).
 * 예산이 뒤까지 안 닿으면 앞에서부터 가장 적은 후보를 쓰고, 최소 칸을 못 받는 섹션은 뺀다. 남은 칸은 앞에서부터 상한까지 더 준다.
 * fillers를 주면 목표 섹션 수와 합격점 높이가 될 때까지(22개까지, 채움은 FILLER_MAX까지) 채운다. 그래도 18개나 합격점 높이에 못 미치면 issues에 남겨 다시 고르게 한다.
 */
export function solveOrder(inputs: readonly OrderInput[], concept: Pick<Concept, 'rhythm'>, options: OrderOptions = {}): OrderResult {
  const budgeted = options.facts !== undefined
  const budget = budgeted ? factBudget(options.facts!).places : Number.POSITIVE_INFINITY
  const issues: string[] = []
  let points = 0
  const kept = inputs.filter((input) => {
    if (input.candidates.length === 0) {
      issues.push(`후보 없음: ${input.section}`)
      return false
    }
    if (input.section !== POINT_SECTION) return true
    points++
    return points <= POINT_MAX
  })

  /** 놓아 보기 — 같은 모양·이웃 금지는 놓는 순서로 정해지므로 채움을 더한 목록은 처음부터 다시 놓는다 */
  const place = (list: readonly OrderInput[]) => {
    const placed: TemplateMeta[] = []
    const rows: Array<Omit<OrderedSection, 'bg' | 'shots'>> = []
    const unsolved: string[] = []
    const dropped: string[] = []
    const droppedShots: string[] = []
    let left = budget
    let shots = 0
    // 뒤 섹션의 가장 적은 컷 합 — 앞 섹션이 컷 상한을 다 써서 뒤 섹션이 빠지지 않게 남겨 둔다
    let shotReserve = list.reduce((sum, { candidates }) => sum + Math.min(...candidates.map(shotCountOf)), 0)
    // 뒤 섹션의 가장 적은 칸 합 — 앞 섹션이 예산을 다 써서 뒤 섹션이 빠지지 않게 남겨 둔다
    let reserve = list.reduce((sum, { candidates }) => sum + Math.min(...candidates.map(factMin)), 0)
    for (const [index, { section, candidates, filler }] of list.entries()) {
      reserve -= Math.min(...candidates.map(factMin))
      shotReserve -= Math.min(...candidates.map(shotCountOf))
      const unconflicted = (section === POINT_SECTION ? pointCandidates(candidates, placed) : candidates).filter((c) => !conflicts(c, placed))
      // 풀폭 상자는 페이지 예산 안에서 — 후보가 그것뿐이면 구성에서 고른 섹션은 그대로 쓰고, 코드가 더하는 채움은 더하지 않는다
      const inBudget = unconflicted.filter((c) => bandFits(c, placed, index === list.length - 1, concept.rhythm, options.category))
      const banded = inBudget.length > 0 || filler ? inBudget : unconflicted
      const choose = (from: readonly TemplateMeta[]) => {
        const withinCap = from.filter((c) => shots + shotCountOf(c) <= PAGE_SHOT_MAX)
        const factsFit = withinCap.filter((c) => factMin(c) + reserve <= left)
        const pick =
          factsFit.find((c) => shots + shotCountOf(c) + shotReserve <= PAGE_SHOT_MAX) ??
          // 뒤 섹션 컷 몫까지는 못 남겨도, 사실 칸이 맞으면 컷이 가장 적은 후보로 간다
          [...factsFit].sort((a, b) => shotCountOf(a) - shotCountOf(b))[0] ??
          withinCap.filter((c) => factMin(c) <= left).sort((a, b) => factMin(a) - factMin(b))[0]
        return { pick, withinCap }
      }
      // 같은 뼈대·부품 상한(개선 #4·#6) — 지키는 후보로 먼저 고르고, 못 고르면 구성에서 고른 섹션은 상한 없이 고른다. 코드가 더하는 채움은 더하지 않는다
      const mixed = banded.filter((c) => mixFits(c, placed))
      const first = choose(mixed)
      const fallback = first.pick || filler ? first : choose(banded)
      const free = first.pick || filler ? mixed : banded
      const { pick, withinCap } = fallback
      if (!pick) {
        if (free.length > 0 && withinCap.length === 0) droppedShots.push(section)
        else if (free.length > 0) dropped.push(section)
        else unsolved.push(section)
        continue
      }
      placed.push(pick)
      left -= factMin(pick)
      shots += shotCountOf(pick)
      rows.push({
        section,
        templateId: pick.id,
        ...(pick.id !== candidates[0].id ? { fallbackFrom: candidates[0].id } : {}),
        ...(filler ? { filler: true as const } : {}),
      })
    }
    return { placed, rows, unsolved, dropped, droppedShots, left }
  }

  const pool = (options.fillers ?? []).flatMap((f) => f.candidates.filter((c) => factMin(c) === 0).map((template) => ({ section: f.section, template })))
  const target = budgeted ? factBudget(options.facts!).targetSections : PAGE_SECTIONS.target
  const trimmed = trimForShots(sortByFlow(kept))
  let list = trimmed.kept
  let result = place(list)
  // 같은 모양을 피하다 최소 컷보다 많이 쓰면 필수 섹션이 빠질 수 있다 — 필수가 아닌 섹션을 뒤에서 하나씩 더 빼고 다시 놓는다
  while (result.droppedShots.some(isShotProtected)) {
    let at = -1
    list.forEach((input, i) => {
      if (!isShotProtected(input.section) && Math.min(...input.candidates.map(shotCountOf)) > 0) at = i
    })
    if (at < 0) break
    trimmed.removed.push(list[at].section)
    list = list.filter((_, i) => i !== at)
    result = place(list)
  }
  const rejected = new Set<string>()
  while (result.rows.length < PAGE_SECTIONS.max && (result.rows.length < target || estimatePageHeight(result.placed) < PAGE_MIN_HEIGHT)) {
    // 구성에서 고른 채움 섹션도 상한에 든다
    const added = list.filter((input) => input.filler || (FACT_FREE_FILLERS as readonly string[]).includes(input.section))
    const fillerCap = FILLER_MAX + (options.fillerExtra ?? 0)
    if (added.length >= fillerCap) break
    const photoOnlyFull = added.filter((input) => isPhotoOnly(input.candidates[0])).length >= PHOTO_ONLY_FILLER_MAX
    const open = pool.filter(({ template }) => !rejected.has(template.id) && !(photoOnlyFull && isPhotoOnly(template)))
    if (open.length === 0) break
    const { section, template } = nextFiller(open, result.placed, fillerCap - added.length, options.fillerTurn, options.shots)
    const tried = insertSpaced(list, { section, candidates: [template], filler: true })
    const outcome = tried && place(tried)
    // 이미 쓴 템플릿이거나, 들어갈 자리가 없거나, 기존 섹션을 밀어내거나, 같은 뼈대·부품 상한을 넘기게 하면 더하지 않는다
    const whiter = () => {
      const run = whiteRun(outcome!.placed, concept.rhythm, options.category)
      return run > W_MAX_RUN && run > whiteRun(result.placed, concept.rhythm, options.category)
    }
    if (!tried || !outcome || outcome.rows.length <= result.rows.length || mixOver(outcome.placed) > mixOver(result.placed) || whiter()) {
      rejected.add(template.id)
      continue
    }
    list = tried
    result = outcome
  }

  for (let tries = 0; tries < 3; tries++) {
    const moved = closerMoved(list, result.rows)
    const outcome = moved && place(moved)
    if (!moved || !outcome || outcome.rows.length < result.rows.length) break
    list = moved
    result = outcome
  }

  const { placed, rows } = result
  issues.push(...result.unsolved.map((section) => `풀리지 않음: ${section}`))
  const droppedForShots = [...trimmed.removed, ...result.droppedShots]
  issues.push(...droppedForShots.map((section) => `컷 상한(${PAGE_SHOT_MAX}장)으로 뺌: ${section}`))
  const slots = placed.map(factMin)
  if (budgeted) {
    let remaining = result.left
    placed.forEach((t, i) => {
      const extra = Math.min(remaining, copyFactRange(t).max - slots[i])
      if (extra > 0) {
        slots[i] += extra
        remaining -= extra
      }
    })
  }
  const estimated = estimatePageHeight(placed)
  if (options.fillers !== undefined) {
    if (rows.length < PAGE_SECTIONS.min || rows.length > PAGE_SECTIONS.max) issues.push(`섹션 ${rows.length}개(${PAGE_SECTIONS.min}~${PAGE_SECTIONS.max})`)
    if (estimated < PAGE_MIN_HEIGHT) issues.push(`페이지 높이 ${estimated}(${estimated < PAGE_PASS_HEIGHT ? `통과선 ${PAGE_PASS_HEIGHT}` : `합격점 ${PAGE_MIN_HEIGHT}`} 미달)`)
  }
  const backgrounds = assignSurfaces(placed, concept.rhythm, options.category)
  const shots = assignShots(placed, options.shots)
  return {
    sections: rows.map((row, i) => ({ ...row, bg: backgrounds[i], ...(budgeted ? { factSlots: slots[i] } : {}), shots: shots[i] })),
    issues,
    droppedForFacts: result.dropped,
    droppedForShots,
    height: { estimated, meetsRequired: estimated >= PAGE_MIN_HEIGHT },
  }
}
