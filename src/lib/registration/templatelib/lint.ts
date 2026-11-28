/**
 * K 라인 템플릿 전수 검사(H7, 15_TEMPLATE_LINE §7) — 위반이면 라이브러리에 들어가지 못한다. 유료 호출·렌더 없이 돌고 CI에 들어간다.
 * 진입점: lintTemplate(하나), lintTemplateLibrary(전체·섹션별 개수·높이 보고). B의 H7이 이 함수를 감싼다.
 * 글자 높이는 추정값이다 — 실제 글꼴과의 차이는 render-check가 본다.
 */

import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { checkMobileReadability, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { reflowSectionLayout } from '@/lib/registration/editor/utils/reflowSectionLayout'
import { measureCutText } from '@/lib/registration/editor/utils/sectionConverter/designCut/build'
import { CONTENT_W, MARGIN, W } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import { rgbToLch } from '@/lib/registration/internalized/designcut-palette'
import { lintKPageColors } from './color-lint'
import { colorSetsOf, isDarkYellow } from './color-sets'
import { CONCEPTS, CONCEPT_FAMILY_IDS, conceptById } from './concepts'
import { K_HOOK_STEP_SIZES, K_SPACE, K_TYPE, renderTemplate, TAG, type TemplateContext } from './engine'
import { HOOK_BEATS_PHOTO_SHARE_MIN, HOOK_BEATS_SPACING, HOOK_BEATS_TEXT, isHookBeats } from './hook-beats'
import { ICON_SIZES } from './icons'
import { BADGE, BADGE_INPUTS, BADGE_MIN_PHOTO, BADGE_SECTIONS, isBadgeInput, textsOnBadge } from './medal'
import { TEMPLATES } from './library'
import { lintCategoryTemplates } from './lint-category'
import { OVERLAY_SCRIM_MAX, OVERLAY_SECTIONS, scrimIssues, textsOnScrim } from './overlay'
import { PANEL_EDGE } from './panel-edge'
import { FACT_FREE_FILLERS } from './selection-order'
import { POINT_SECTION } from './template-meta'
import { fillerText, heightRange, sampleContext, sampleSlots } from './sample'
import { deriveSignature, signatureKey } from './signature'
import { factRange, requiredPhotos } from './slots'
import { STEPS_MIN, STEPS_NAME_FIELD } from './steps'
import {
  COLOR_ROLES,
  COMPARE_BASIS,
  COMPARE_LABELS,
  COMPARE_OTHER_LABEL,
  D_SECTION_HEIGHT,
  EVIDENCE_LOCKED,
  HOOK_TEXT,
  MARK_VALUES,
  PAGE_MIN_HEIGHT,
  PAGE_SECTIONS,
  PAIN_MARK_SECTIONS,
  POINT_HEAD_STYLES,
  POINT_STEP_SLOT,
  POINT_STEPS_INPUT,
  SECTION_TABLE,
  RATING_BARS_INPUT,
  SCALE_SET_LIMITS,
  SIZE_SCALE_HEIGHT_INPUT,
  SIZE_SCALE_INPUT,
  SIZE_SCALE_LABEL_INPUT,
  SIZE_SCALE_WIDTH_INPUT,
  SPEC_ROWS_INPUT,
  SPEC_ROWS_MAX,
  SPEC_SPECIAL_INPUT,
  STRUCTURE_LABELS,
  TEMPLATE_SECTION_IDS,
  type FlowNode,
  type ImageNode,
  type SlotDef,
  type SurfaceName,
  type Template,
  type TemplateSectionId,
  INPUT_NAMED_PURPOSES,
  SHOT_PURPOSES,
} from './template-types'

export const LINT_RULES = [
  'meta',
  'category',
  'type',
  'space',
  'lines',
  'chars',
  'stress',
  'empty',
  'color',
  'photo',
  'signature',
  'evidence',
  'facts',
  'hook',
  'specRows',
  'height',
  'headStyle',
  'overlay',
] as const
export type LintRule = (typeof LINT_RULES)[number]

export interface TemplateViolation {
  template: string
  rule: LintRule
  detail: string
}

export const STRESS_FACTOR = 1.2
/** estimatedHeight와 계산값의 허용 차이 */
const HEIGHT_TOLERANCE = 0.1
/** 줄 간격 규격(오너 지시) — 토큰값과 비교하면 토큰이 틀어져도 못 잡으므로 숫자로 고정한다 */
const LINE_RULE = { body: 1.7, titleMin: 1.4, titleMax: 1.5, hookMin: 1.35 }
const BODY_SIZE = 52
/** 표 값(K10) — 본문과 같은 줄 간격 1.7을 지킨다 */
const TABLE_SIZE = 45
const TITLE_SIZES = [92, 74, 62]
/** 첫 화면 큰 제목 크기 — 단계로 줄어드는 값까지(fitHookToken) */
const HOOK_SIZES = [K_TYPE.HOOK.size, ...K_HOOK_STEP_SIZES]
/**
 * 글자 위계 — 본문 대비 비율 하한(판매 페이지 역할별 1.72~2.40보다 낮게 둔 선)과 폰 판독 하한(860 기준, 폰 390의 약 0.45배).
 * 토큰을 바꿔 위계가 무너지거나 안 읽히는 크기가 되면 잡는다. M1은 그려진 글자의 하한만 본다
 */
const TYPE_RATIO_MIN = { HOOK: 2, H1: 1.7, H2: 1.4 } as const
const TYPE_SMALL_RATIO = [0.65, 0.8] as const
/** TABLE 하한은 편집기 폰 판독 M1의 본문 하한(MIN_FONT_SIZES.body 45)이다 */
const TYPE_SIZE_MIN = { BODY: 44, BODY_BOLD: 44, TABLE: 45, H3: 62, LABEL: 36, CAPTION: 36 } as const
const CAPTION_MAX_LINES = 2
const SPACING_RANGE = { top: [120, 140], titleGap: [40, 60], photoGap: [80, 200], bottom: [120, 140] } as const
const GAP_NAMES = new Set(['titleGap', 'photoGap', ...Object.keys(K_SPACE)])
const HOOK_BLOCKED_SLOT = /product|option|category|eyebrow|brand/i
/** 소제목·컨셉·해결 섹션의 구조어 머리(A2 9-1, 개선 #12) — 장 표식이 아니라 읽는 방식을 알리는 낱말만 쓴다 */
const HEAD_LABELS: Readonly<Record<string, readonly string[]>> = {
  sub_div: ['CHECK', 'DETAIL', 'TIP'],
  concept_desc: ['CHECK', 'DETAIL', 'TIP'],
  solution_guide: ['CHECK', 'DETAIL', 'TIP'],
}
const SURFACES = new Set(['W', 'N', 'T', 'D', 'P'])
const ZONES = new Set(['intro', 'problem', 'value', 'trust', 'decision'])
const CONTENT_RIGHT = MARGIN + CONTENT_W

const hasValue = (v: unknown) => v !== undefined && v !== null

interface NodeVisit {
  node: FlowNode
  /** 이 노드가 쌓이는 칸의 폭 */
  width: number
  defs: Record<string, SlotDef>
  bleedOk: boolean
}

/** 흐름 전체 방문 — 칸 폭과 그 칸의 슬롯 정의를 함께 넘긴다 */
function walk(nodes: readonly FlowNode[], visit: (v: NodeVisit) => void, ctx: { width: number; defs: Record<string, SlotDef>; bleedOk: boolean }) {
  for (const node of nodes) {
    visit({ node, ...ctx })
    if (node.kind === 'row') {
      for (const column of node.columns) walk(column.nodes, visit, { ...ctx, width: column.w, bleedOk: false })
    } else if (node.kind === 'panel') {
      const width = node.bleed ? CONTENT_W : (node.w ?? ctx.width) - K_SPACE.cardPad * 2
      walk(node.nodes, visit, { ...ctx, width, bleedOk: false })
    } else if (node.kind === 'repeat') {
      const def = ctx.defs[node.slot]
      const columns = node.columns ?? 1
      // 층 띠는 띠 안쪽 여백(cardPad)만큼 좁다(engine drawLayers)
      const width = Math.floor((ctx.width - K_SPACE.columnGap * (columns - 1)) / columns) - (node.layer ? K_SPACE.cardPad * 2 : 0)
      walk(node.nodes, visit, { ...ctx, width, defs: def?.type === 'list' ? def.fields : {}, bleedOk: false })
    } else if (node.kind === 'image' && node.overlay) {
      walk(node.overlay.nodes, visit, { ...ctx, width: CONTENT_W, bleedOk: false })
    }
  }
}

const rootVisit = (t: Template) => ({ width: CONTENT_W, defs: t.slots, bleedOk: true })

/** 노드가 쓰는 슬롯 이름 */
const slotsOfNode = (node: FlowNode): string[] => {
  // 3축(적용 K7-c 4c)이면 깊이 칸도 센다
  if (node.kind === 'dimension') return [node.slot, node.widthSlot, node.heightSlot, ...(node.depthSlot ? [node.depthSlot] : [])]
  if (node.kind === 'steps') return [node.field]
  if (node.kind === 'capsule' && node.steps) return [...(node.slot ? [node.slot] : []), node.steps.slot, node.steps.current, node.steps.name]
  if (node.kind === 'image' && node.badge) return [node.slot, node.badge.slot]
  // 견본 색 표식(적용 C5 ③)은 칸 이름을 color로 받는다
  if (node.kind === 'mark' && node.color) return [node.color]
  return 'slot' in node && node.slot ? [node.slot] : []
}
const expectedType = (node: FlowNode, slot: string): SlotDef['type'] => {
  if (node.kind === 'image') return slot === node.slot ? 'image' : 'text'
  if (node.kind === 'dimension') return slot === node.slot ? 'image' : 'text'
  if (node.kind === 'capsule' && node.steps?.slot === slot) return 'list'
  if (node.kind === 'repeat' || node.kind === 'tags' || node.kind === 'bars' || node.kind === 'scaleSet') return 'list'
  return 'text'
}

function lintMeta(t: Template, add: (rule: LintRule, detail: string) => void) {
  if (!/^[a-z0-9_]+\.[a-z0-9-]+$/.test(t.id ?? '')) add('meta', `id 형식: ${t.id}`)
  if (!TEMPLATE_SECTION_IDS.includes(t.section)) add('meta', `없는 섹션: ${t.section}`)
  if (t.id && t.section && !t.id.startsWith(`${t.section}.`)) add('meta', 'id가 섹션 이름으로 시작하지 않음')
  if (!t.name?.trim()) add('meta', 'name 없음')
  if (!Number.isInteger(t.version) || t.version < 1) add('meta', 'version은 1 이상 정수')
  if (!t.surfaces?.length || t.surfaces.some((s) => !SURFACES.has(s))) add('meta', 'surfaces 형식')
  if (!Array.isArray(t.flow) || t.flow.length === 0) add('meta', 'flow 비어 있음')
  if (!t.slots || Object.keys(t.slots).length === 0) add('meta', 'slots 비어 있음')
  if (!t.signature) add('meta', 'signature 없음')
  if (!t.needs || !Number.isInteger(t.needs.photos) || !Array.isArray(t.needs.evidence)) add('meta', 'needs 형식')
  if (!t.estimatedHeight) add('meta', 'estimatedHeight 없음')
  if (!t.fit?.concepts?.length) add('meta', 'fit.concepts 비어 있음')
  for (const id of t.fit?.concepts ?? []) if (!conceptById(id)) add('meta', `없는 컨셉: ${id}`)
  if (!['low', 'mid', 'high'].includes(t.fit?.density)) add('meta', 'fit.density 형식')
  if (!t.fit?.personaTags?.length) add('meta', 'fit.personaTags 비어 있음')
  if (!Array.isArray(t.fit?.categoryBlock)) add('meta', 'fit.categoryBlock 배열 아님')
  if (!ZONES.has(t.order?.zone)) add('meta', 'order.zone 형식')
  if (!Array.isArray(t.order?.notNextTo)) add('meta', 'order.notNextTo 배열 아님')
  if (t.tokens?.color !== 'concept' || t.tokens?.type !== 'scene' || t.tokens?.radius !== 'concept') add('meta', 'tokens 고정값 아님')
  if (t.check?.stress !== STRESS_FACTOR || t.check?.lint !== 'ci' || !hasValue(t.check?.usedIn)) add('meta', 'check 고정값 아님')
  if (t.preview !== `mock/${t.id}.html`) add('meta', `preview는 mock/${t.id}.html`)
}

/** 아치가 받는 비율 — 세로 사진이어야 위 반원 아래로 몸통이 남는다 */
const ARCH_ASPECTS: readonly string[] = ['3:4', '2:3']

/** 원·아치 틀 — 모양이 깨지는 조합을 막는다. 모서리가 잘리므로 대표 컷(별도 프롬프트라 잘림을 모른다)을 받지 않고, 직각 문법 컨셉에는 쓰지 않는다 */
function lintPhotoFrame(t: Template, node: ImageNode, def: SlotDef | undefined, width: number, add: (rule: LintRule, detail: string) => void) {
  if (node.frame !== 'circle' && node.frame !== 'arch') return
  const name = `${node.slot}: ${node.frame} 틀`
  if (node.bleed) add('photo', `${name}은 풀폭 금지`)
  if (node.plate) add('photo', `${name}에 뒤 판 금지`)
  if (node.overlay) add('photo', `${name}에 사진 위 글 금지`)
  if (node.fit === 'contain') add('photo', `${name}은 cover만`)
  if (t.section === 'hook_3step') add('photo', `${name}은 첫 화면 금지`)
  const square = (t.fit?.concepts ?? []).filter((id) => conceptById(id)?.shape === 'square')
  if (square.length > 0) add('photo', `${name}은 직각 컨셉 금지: ${square.join('·')}`)
  if (def?.type !== 'image') return
  if (def.purpose.includes('hero')) add('photo', `${name}은 대표 컷을 받지 않음`)
  if (node.frame === 'circle') {
    if (def.aspect.join() !== '1:1') add('photo', `${name}은 비율 1:1만: ${def.aspect.join('·')}`)
    if (def.minHeight > (node.w ?? width)) add('photo', `${name} 최소 높이 ${def.minHeight}가 폭 ${node.w ?? width}보다 큼`)
  } else if (def.aspect.some((aspect) => !ARCH_ASPECTS.includes(aspect))) {
    add('photo', `${name}은 세로 비율만: ${def.aspect.join('·')}`)
  }
}

/**
 * 원형 배지(R-D1) — 장치 표 자리(certification·main_cut)의 폭 480 이상 네모 사진에만(좁은 사진은 원이 절반을 덮는다), 칸은 배지 입력만(모델 글·지어낸 수치 금지)이고 선택 칸이다.
 * 위쪽 모서리에 놓이므로 위쪽 사진 위 글과 함께 쓰지 않는다
 */
function lintBadge(t: Template, node: ImageNode, def: SlotDef | undefined, width: number, add: (rule: LintRule, detail: string) => void) {
  if (!node.badge) return
  const name = `${node.badge.slot}: 원형 배지`
  if (!BADGE_SECTIONS.includes(t.section)) add('photo', `${name}는 ${BADGE_SECTIONS.join('·')}에만`)
  if (def?.type !== 'text' || def.source !== 'input' || !isBadgeInput(def.input)) {
    add('evidence', `${name} 칸은 배지 입력(${Object.keys(BADGE_INPUTS).join('·')})만 — 모델 글·지어낸 수치 금지`)
  } else {
    if (def.required) add('evidence', `${name} 칸은 선택(required false) — 입력이 없으면 사진만 둔다`)
    if (def.maxChars > BADGE.maxChars || def.maxLines !== 1) add('chars', `${name} 값은 ${BADGE.maxChars}자 한 줄`)
  }
  const photoW = node.bleed ? W : (node.w ?? width)
  if (photoW < BADGE_MIN_PHOTO) add('photo', `${name}는 폭 ${BADGE_MIN_PHOTO} 이상 사진에만(지금 ${photoW})`)
  if (node.frame === 'circle' || node.frame === 'arch') add('photo', `${name}는 원·아치 틀 금지`)
  if (node.overlay?.anchor === 'top') add('overlay', `${name}와 위쪽 사진 위 글이 겹침`)
}

/** 흐름 안 배지 사진 — 반복 안 배지는 항목마다 그려지므로 따로 표시한다 */
const badgeNodes = (nodes: readonly FlowNode[], inRepeat = false): boolean[] =>
  nodes.flatMap((n) => {
    if (n.kind === 'image') return n.badge ? [inRepeat] : []
    if (n.kind === 'repeat') return badgeNodes(n.nodes, true)
    if (n.kind === 'panel') return badgeNodes(n.nodes, inRepeat)
    if (n.kind === 'row') return n.columns.flatMap((c) => badgeNodes(c.nodes, inRepeat))
    return []
  })

/** 배지는 템플릿에 하나, 반복 밖. 배지 입력 키는 배지 칸에서만 쓴다(목록 항목 칸 포함) */
function lintBadgeCount(t: Template, add: (rule: LintRule, detail: string) => void) {
  const badges = badgeNodes(t.flow)
  if (badges.length > 1) add('photo', `원형 배지는 템플릿에 하나(지금 ${badges.length})`)
  if (badges.some(Boolean)) add('photo', '원형 배지는 반복 칸 밖에만')
  const badgeSlots = new Set<string>()
  const collect = (nodes: readonly FlowNode[]): void =>
    nodes.forEach((n) => {
      if (n.kind === 'image' && n.badge) badgeSlots.add(n.badge.slot)
      if (n.kind === 'repeat' || n.kind === 'panel') collect(n.nodes)
      if (n.kind === 'row') n.columns.forEach((c) => collect(c.nodes))
    })
  collect(t.flow)
  for (const [name, def] of Object.entries(t.slots)) {
    if (def.type === 'text' && isBadgeInput(def.input) && !badgeSlots.has(name)) add('evidence', `${name}: 배지 입력은 원형 배지 칸에서만`)
    if (def.type === 'list') for (const [field, f] of Object.entries(def.fields)) if (f.type === 'text' && isBadgeInput(f.input)) add('evidence', `${name}.${field}: 배지 입력은 원형 배지 칸에서만`)
  }
}

/** 흐름 어디든 반 띠 사진 — 안쪽(판·반복·가로 칸)까지 센다 */
const halfImages = (nodes: readonly FlowNode[], top: boolean): Array<{ node: ImageNode; top: boolean }> =>
  nodes.flatMap((n) => {
    if (n.kind === 'image') return n.half ? [{ node: n, top }] : []
    if (n.kind === 'repeat' || n.kind === 'panel') return halfImages(n.nodes, false)
    if (n.kind === 'row') return n.columns.flatMap((c) => halfImages(c.nodes, false))
    return []
  })

/**
 * 반 띠(적용 K7-c 4a T2-42) — 흐름 맨 위 단계의 본문 폭 사진 하나에만. 면이 섹션 위 48에서 사진 절반까지라 풀폭·원·아치·뒤 판·사진 위 글과 함께 쓰지 않고,
 * 사진이 빠지면 면만 남으므로 사진 칸은 필수다
 */
function lintHalf(t: Template, add: (rule: LintRule, detail: string) => void) {
  const halves = halfImages(t.flow, true)
  if (halves.length > 1) add('photo', `반 띠는 템플릿에 하나(지금 ${halves.length})`)
  for (const { node, top } of halves) {
    if (!top) add('photo', '반 띠는 흐름 맨 위 단계 사진에만(판·반복·가로 칸 안 금지)')
    if (node.bleed || node.x !== undefined || node.w !== undefined) add('photo', '반 띠 사진은 본문 폭만(풀폭·어긋난 폭 금지)')
    if (node.plate || node.overlay || node.badge || node.frame === 'circle' || node.frame === 'arch') add('photo', '반 띠 사진에 뒤 판·사진 위 글·배지·원·아치 금지')
    const def = t.slots[node.slot]
    if (def?.type === 'image' && !def.required) add('photo', `${node.slot}: 반 띠 사진은 필수(빠지면 면만 남는다)`)
  }
}

/** 3축 치수 도식(적용 K7-c 4c)의 깊이 입력 키 — 이 입력이 없는 상품에서는 칸을 고르지 않는다(필수 칸) */
const DEPTH_INPUT = 'spec.size.depth'

/**
 * 3축 치수 도식(적용 K7-c 4c T1-41) — 깊이 칸은 입력 spec.size.depth 필수 글 칸이어야 3축 입력 상품에만 후보가 된다(484 사전 탐침: 근거 거름이 후보 자르기 앞).
 * 선택 칸이면 깊이 없는 상품에서도 후보가 되어 다른 쪽의 고름을 바꾼다
 */
function lintDimension(t: Template, add: (rule: LintRule, detail: string) => void) {
  walk(
    t.flow,
    ({ node, defs }) => {
      if (node.kind !== 'dimension' || node.depthSlot === undefined) return
      const def = defs[node.depthSlot]
      if (def?.type !== 'text' || def.input !== DEPTH_INPUT || !def.required) add('meta', `${node.depthSlot}: 깊이 칸은 입력 ${DEPTH_INPUT} 필수 글 칸`)
    },
    rootVisit(t)
  )
}

const LINK_MIN_BOTTOM = 120
const isBleedNode = (n: FlowNode) => (n.kind === 'image' || n.kind === 'panel') && n.bleed === true

/** 흐름 어디든 구역 연결 표식이 몇 개인지 — 안쪽(판·반복·가로 칸)까지 센다 */
const countLinks = (nodes: readonly FlowNode[]): number =>
  nodes.reduce((sum, n) => {
    if (n.kind === 'link') return sum + 1
    if (n.kind === 'repeat' || n.kind === 'panel') return sum + countLinks(n.nodes)
    if (n.kind === 'row') return sum + n.columns.reduce((s, c) => s + countLinks(c.nodes), 0)
    return sum
  }, 0)

/**
 * 구역 연결 표식(R-W9) — 최상위 흐름 맨 끝에 하나만, 아래 여백 120 이상(여백 호흡 좁음 88에서도 원이 들어간다), 바로 앞이 풀폭이면
 * 아래 여백이 없어 그려지지 않는다
 */
function lintLink(t: Template, add: (rule: LintRule, detail: string) => void) {
  const total = countLinks(t.flow)
  if (total === 0) return
  const last = t.flow[t.flow.length - 1]
  if (total > 1 || last.kind !== 'link') add('space', '구역 연결 표식(link)은 최상위 흐름 맨 끝에 하나만')
  if (t.spacing.bottom < LINK_MIN_BOTTOM) add('space', `구역 연결 표식은 아래 여백 ${LINK_MIN_BOTTOM} 이상(지금 ${t.spacing.bottom})`)
  const before = t.flow[t.flow.length - 2]
  if (before && isBleedNode(before)) add('space', '구역 연결 표식 앞이 풀폭 — 아래 여백이 없어 그려지지 않는다')
  if (last.gapAfter) add('space', '구역 연결 표식에는 gapAfter를 두지 않는다')
}

/** 반복 칸 밖의 진행 표시 — 이름과 지금 항목을 그 반복 목록에서 읽는다(T2-52) */
const badSteps = (nodes: readonly FlowNode[], inRepeat: boolean): boolean =>
  nodes.some((n) => {
    if (n.kind === 'steps') return !inRepeat
    if (n.kind === 'repeat') return badSteps(n.nodes, true)
    if (n.kind === 'panel') return badSteps(n.nodes, inRepeat)
    if (n.kind === 'row') return n.columns.some((c) => badSteps(c.nodes, inRepeat))
    return false
  })

/**
 * POINT 진행 표시 칸(R-W7) — 목록은 코드가 채우는 POINT 진행(항목 칸 name 한 줄), 순번은 chapter, 이름은 모델 글 한 줄·사실 0이다.
 * 캡슐 줄 오른쪽에 두므로 왼쪽 캡슐에만 붙인다
 */
function lintCapsuleSteps(node: Extract<FlowNode, { kind: 'capsule' }>, defs: Record<string, SlotDef>, add: (rule: LintRule, detail: string) => void) {
  const steps = node.steps!
  if (node.align === 'center') add('space', '진행 표시는 왼쪽 캡슐 줄에만')
  const list = defs[steps.slot]
  if (list?.type === 'list') {
    const field = list.fields[STEPS_NAME_FIELD]
    if (list.source !== 'input' || list.input !== POINT_STEPS_INPUT) add('meta', `${steps.slot}: 진행 목록은 입력 ${POINT_STEPS_INPUT}`)
    if (field?.type !== 'text' || field.maxLines !== 1 || Object.keys(list.fields).length !== 1) add('meta', `${steps.slot}: 항목 칸은 한 줄 ${STEPS_NAME_FIELD} 하나`)
    if (list.min < STEPS_MIN) add('meta', `${steps.slot}: 진행 목록 min ${STEPS_MIN} 이상`)
  }
  const current = defs[steps.current]
  if (current && (current.type !== 'text' || current.input !== 'chapter')) add('meta', `${steps.current}: 순번 칸은 입력 chapter`)
  if (steps.name !== POINT_STEP_SLOT) add('meta', `소구 이름 칸은 ${POINT_STEP_SLOT}(카피 프롬프트 규칙이 이 이름에 붙는다)`)
  const name = defs[steps.name]
  if (name && (name.type !== 'text' || name.source !== 'copy' || name.maxLines !== 1 || name.facts !== 0 || name.claimRisk !== 'none')) {
    add('meta', `${steps.name}: 소구 이름은 모델 글 한 줄·사실 0·위험 없음`)
  }
}

/** 앞 목록과 잇는 선(joinRule)은 구분선 있는 반복 바로 뒤의 구분선 있는 반복에만 — 다른 자리면 선이 엉뚱한 곳에 그어진다(K8) */
const badJoin = (nodes: readonly FlowNode[]): boolean =>
  nodes.some((n, i) => {
    if (n.kind === 'repeat' && n.joinRule === true) {
      const prev = nodes[i - 1]
      if (!n.rule || prev?.kind !== 'repeat' || !prev.rule) return true
    }
    if (n.kind === 'panel' || n.kind === 'repeat') return badJoin(n.nodes)
    if (n.kind === 'row') return n.columns.some((c) => badJoin(c.nodes))
    return false
  })

/** 행 높이 맞춤(even)은 한 줄 반복의 글 항목(글뿐이거나 글만 있는 가로 칸 하나)에만 — 사진·상자가 끼면 가운데 맞춤이 그것까지 옮긴다 */
const textOnly = (nodes: readonly FlowNode[]): boolean => nodes.every((n) => n.kind === 'text')
const badEven = (nodes: readonly FlowNode[]): boolean =>
  nodes.some((n) => {
    if (n.kind === 'repeat' && n.even === true) {
      const single = n.nodes.length === 1 && n.nodes[0].kind === 'row' ? n.nodes[0] : null
      if ((n.columns ?? 1) !== 1 || !(single ? single.columns.every((c) => textOnly(c.nodes)) : textOnly(n.nodes))) return true
    }
    if (n.kind === 'panel' || n.kind === 'repeat') return badEven(n.nodes)
    if (n.kind === 'row') return n.columns.some((c) => badEven(c.nodes))
    return false
  })

/** 좌우 번갈아는 한 줄 반복의 2칸 가로 칸 항목에만 — 다른 항목은 뒤집을 칸이 없거나 3칸이면 가운데가 그대로라 번갈아 보이지 않는다 */
const badAlternate = (nodes: readonly FlowNode[]): boolean =>
  nodes.some((n) => {
    if (n.kind === 'repeat' && n.alternate === true) {
      const single = n.nodes.length === 1 && n.nodes[0].kind === 'row' ? n.nodes[0] : null
      if ((n.columns ?? 1) !== 1 || n.even === true || single?.columns.length !== 2) return true
    }
    if (n.kind === 'panel' || n.kind === 'repeat') return badAlternate(n.nodes)
    if (n.kind === 'row') return n.columns.some((c) => badAlternate(c.nodes))
    return false
  })

/**
 * 층 띠는 한 줄 반복의 글 항목에만 — 띠끼리 맞닿아 간격·구분선·화살표가 없고, 사진·상자가 들면 띠 단계가 아니라 카드 목록이 된다.
 * 바탕은 밝은 면만이다 — 44컨셉 전수 시험(layer-band.test)이 이 바탕에서 모든 띠 대비 4.5를 지킨다
 */
export const LAYER_SURFACES: readonly SurfaceName[] = ['W', 'N', 'T']
const badLayer = (nodes: readonly FlowNode[]): boolean =>
  nodes.some((n) => {
    if (n.kind === 'repeat' && n.layer === true) {
      if ((n.columns ?? 1) !== 1 || n.gap || n.rule || n.joinRule || n.connector || n.even || n.alternate || !textOnly(n.nodes)) return true
    }
    if (n.kind === 'panel' || n.kind === 'repeat') return badLayer(n.nodes)
    if (n.kind === 'row') return n.columns.some((c) => badLayer(c.nodes))
    return false
  })
const hasLayer = (nodes: readonly FlowNode[]): boolean =>
  nodes.some((n) => (n.kind === 'repeat' && n.layer === true) || ((n.kind === 'panel' || n.kind === 'repeat') && hasLayer(n.nodes)) || (n.kind === 'row' && n.columns.some((c) => hasLayer(c.nodes))))

/**
 * 곡선 경계(K1 T1-33·T2-46) — 덮개는 띠 안쪽 여백 안이라 여백 − 깊이가 글까지 minClear 이상 남아야 하고, 그쪽에 같은 섹션 간격이 있어야 덮개 색(섹션 바탕)이 맞는다.
 * 흐름 맨 위·맨 아래 쪽은 늘 섹션 끝이라 엔진이 그리지 않는다
 */
function lintPanelEdges(t: Template, add: (rule: LintRule, detail: string) => void) {
  t.flow.forEach((node, i) => {
    if (node.kind !== 'panel' || !node.edge || !node.bleed) return
    const { side, shape } = node.edge
    if (!EDGE_SHAPES.has(shape) || (side !== 'top' && side !== 'bottom')) add('meta', `없는 곡선 경계: ${side} ${shape}`)
    const pad = node.pad ? K_SPACE[node.pad] : t.spacing[side]
    if (pad - PANEL_EDGE.depth < PANEL_EDGE.minClear) add('space', `곡선 경계 깊이 ${PANEL_EDGE.depth}가 띠 여백 ${pad}에서 글까지 ${PANEL_EDGE.minClear}를 못 남김`)
    const neighbor = side === 'top' ? t.flow[i - 1] : node
    const atEnd = side === 'top' ? i === 0 : i === t.flow.length - 1
    if (atEnd) add('space', `곡선 경계 ${side}가 흐름 끝이라 늘 섹션 끝(그리지 않는다)`)
    // 덮개가 간격 쪽으로 내미므로 간격이 그보다 넓어야 이웃 요소를 덮지 않는다
    else if (!neighbor?.gapAfter || gapValue(t, neighbor.gapAfter) <= PANEL_EDGE.overhang) add('space', `곡선 경계 ${side} 쪽에 섹션 바탕 간격(gapAfter)이 없음`)
  })
}
const EDGE_SHAPES: ReadonlySet<string> = new Set(['arc', 'slant', 'wave'])
const gapValue = (t: Template, name: NonNullable<FlowNode['gapAfter']>) =>
  name === 'titleGap' || name === 'photoGap' ? t.spacing[name] : K_SPACE[name]

/** wave는 페이지에 한 번까지(통합 22:3x, 색 점검 조사 '장식 겹침이 촌스러움') — POINT 아닌 템플릿은 한 페이지에 반복되지 않아 라이브러리 한 칸이면 지켜진다 */
export const WAVE_EDGE_MAX = 1
function waveTemplates(templates: readonly Template[]): Template[] {
  const hasWave = (nodes: readonly FlowNode[]): boolean =>
    nodes.some((n) => (n.kind === 'panel' && n.edge?.shape === 'wave') || ((n.kind === 'panel' || n.kind === 'repeat') && hasWave(n.nodes)))
  return templates.filter((t) => hasWave(t.flow))
}

function lintStructure(t: Template, add: (rule: LintRule, detail: string) => void) {
  const used = new Set<string>()
  walk(
    t.flow,
    ({ node, width, defs, bleedOk }) => {
      for (const slot of slotsOfNode(node)) {
        const def = defs[slot]
        if (!def) add('meta', `없는 슬롯을 씀: ${slot}`)
        // 이름표는 문자열 목록이거나, 반복 칸 안에서 항목마다 이름 하나다
        else if (def.type !== expectedType(node, slot) && !(node.kind === 'tags' && def.type === 'text')) add('meta', `슬롯 형식 불일치: ${slot}(${def.type})`)
        used.add(slot)
      }
      // 항목 색 띠(J54) — fillFrom은 반복 칸 항목의 hex 글 칸이어야 한다(그 칸을 쓴 것으로 센다)
      if (node.kind === 'panel' && node.fillFrom !== undefined) {
        const def = defs[node.fillFrom]
        if (def?.type !== 'text' || def.choices !== 'hex') add('meta', `항목 색 띠 칸 ${node.fillFrom}은 hex 글 칸(반복 칸 항목)`)
        used.add(node.fillFrom)
      }
      if (node.kind === 'text') {
        if (!(node.token in K_TYPE)) add('type', `없는 토큰: ${node.token}`)
        // 모르는 색 역할은 조용히 본문 색이 된다 — 규격 3절의 역할만 받는다(K4 T1-67)
        if (node.color !== undefined && !COLOR_ROLES.includes(node.color)) add('color', `${node.slot}: 없는 색 역할 ${node.color}`)
        const def = defs[node.slot]
        if (def?.type === 'text') {
          if (node.token === 'LABEL' && def.maxLines !== 1) add('type', `${node.slot}: LABEL은 한 줄`)
          if (node.token === 'CAPTION' && def.maxLines > CAPTION_MAX_LINES) add('type', `${node.slot}: CAPTION은 ${CAPTION_MAX_LINES}줄까지`)
          if (node.token === 'DISPLAY' && def.maxChars > 4) add('type', `${node.slot}: DISPLAY는 4자 이하`)
          lintChars(node.slot, def, node.token, node.w ?? width, add)
        }
      }
      if (node.kind === 'image') {
        lintPhotoFrame(t, node, defs[node.slot], width, add)
        lintBadge(t, node, node.badge ? defs[node.badge.slot] : undefined, width, add)
      }
      if (node.kind === 'label' && !COMPARE_LABELS.includes(node.label)) add('type', `비교 이름표 아님: ${node.label}`)
      // 모르는 표식 값은 엔진에서 엑스로 그려진다 — 정해진 값만 받는다(K4 T1-67)
      if (node.kind === 'mark' && node.value !== undefined && !MARK_VALUES.includes(node.value)) add('meta', `없는 표식 값: ${node.value}`)
      // 견본 색(적용 C5 ③) — 입력 #RRGGBB 칸(choices hex)만 칠한다. 표식 값·표식 칸과 섞으면 무엇을 그릴지 둘이 된다
      if (node.kind === 'mark' && node.color !== undefined) {
        const def = defs[node.color]
        if (!(def?.type === 'text' && def.choices === 'hex' && def.source === 'input')) add('meta', `${node.color}: 견본 색은 입력 hex 칸만`)
        if (node.value !== undefined || node.slot !== undefined) add('meta', `${node.color}: 견본 색 표식에 값·칸을 함께 둠`)
      }
      // 풀폭 띠는 바탕을 덮는다 — C면 T 바탕에서 흰 띠가 되어 T로 세어도 흰 섹션으로 보인다
      if (node.kind === 'panel' && node.bleed && node.fill === 'C') add('color', '풀폭 상자에 카드 색 C 금지')
      // 띠 안쪽 여백 바꾸기는 풀폭 띠에만 — 카드는 cardPad 고정이다(K11 T2-27)
      if (node.kind === 'panel' && node.pad && !node.bleed) add('meta', 'pad는 풀폭 띠(bleed)에만')
      // 곡선 경계는 섹션 바탕을 덮개로 칠해 깎으므로 풀폭 띠에만, 윤곽선은 채움을 빼는 카드에만(K1 T1-33)
      if (node.kind === 'panel' && node.edge && !node.bleed) add('meta', 'edge(곡선 경계)는 풀폭 띠(bleed)에만')
      if (node.kind === 'panel' && node.outline && node.bleed) add('meta', 'outline(윤곽선)은 카드에만 — 풀폭 띠는 바탕을 덮는 면이다')
      // 별점 분포 막대(K7-b)는 항목 칸(star·count·share)을 자식 노드 없이 직접 그린다
      if (node.kind === 'bars' || node.kind === 'scaleSet') {
        const def = defs[node.slot]
        if (def?.type === 'list') for (const field of Object.keys(def.fields)) used.add(field)
      }
      if (node.kind === 'capsule') {
        if (node.label && !STRUCTURE_LABELS.includes(node.label)) add('type', `구조 라벨 아님: ${node.label}`)
        if (!node.label && !node.slot) add('meta', '캡슐에 label·slot이 없음')
        if (PAIN_MARK_SECTIONS.includes(t.section)) add('type', `고민 섹션에 캡슐 금지('이런 고민' 머리말): ${node.label ?? node.slot}`)
        const heads = HEAD_LABELS[t.section]
        if (heads && !(node.label && heads.includes(node.label))) add('type', `${t.section} 머리 라벨은 ${heads.join('·')}만: ${node.label ?? node.slot}`)
        const def = node.slot ? defs[node.slot] : null
        if (def?.type === 'text' && def.maxLines !== 1) add('type', `${node.slot}: 캡슐은 한 줄`)
        if (node.steps) {
          lintCapsuleSteps(node, defs, add)
          used.add(STEPS_NAME_FIELD)
        }
      }
      if (node.kind === 'steps') {
        const def = defs[node.field]
        if (def?.type === 'text' && def.maxLines !== 1) add('type', `${node.field}: 진행 표시 이름은 한 줄`)
      }
      if (node.kind === 'icon') {
        const def = defs[node.slot]
        if (def?.type === 'text' && def.choices !== 'icon') add('meta', `${node.slot}: 아이콘 칸은 choices icon`)
        if (!ICON_SIZES.includes(node.size)) add('type', `${node.slot}: 아이콘 크기 ${node.size}(${ICON_SIZES.join('·')})`)
        if (node.size > width) add('type', `${node.slot}: 아이콘 ${node.size}px가 칸 폭 ${width}px를 넘음`)
      }
      if (node.kind === 'text') {
        const def = defs[node.slot]
        if (def?.type === 'text' && def.choices) add('meta', `${node.slot}: 아이콘 이름을 글로 찍음`)
        // 표 이름은 장식 이름표 규칙(한 줄)으로 값 옆에 선다 — 두 줄을 허락하면 본문 2열(M6)이 된다
        if (node.nameTag && (node.token !== 'LABEL' || (def?.type === 'text' && def.maxLines !== 1))) add('type', `${node.slot}: 표 이름은 LABEL 한 줄`)
      }
      if (node.kind === 'tags') {
        const def = defs[node.slot]
        if (def?.type === 'list' && Object.keys(def.fields).length > 0) add('type', `${node.slot}: 이름표 슬롯은 문자열 목록`)
        if (def?.type === 'text') {
          if (def.maxLines !== 1) add('type', `${node.slot}: 이름표는 한 줄`)
          // 이름표는 줄을 안 바꿔 칸을 넘으면 옆 칸 이름표와 겹친다 — 스트레스 글자 수로 잰다
          const chipW = Math.round(def.maxChars * STRESS_FACTOR) * K_TYPE.LABEL.size + TAG.pad * 2
          if (chipW > width) add('type', `${node.slot}: 이름표 ${chipW}px가 칸 폭 ${width}px를 넘음`)
        }
      }
      if (node.gapAfter && !GAP_NAMES.has(node.gapAfter)) add('space', `없는 간격: ${node.gapAfter}`)
      if (node.kind === 'repeat' && node.gap && !GAP_NAMES.has(node.gap)) add('space', `없는 간격: ${node.gap}`)
      if ((node.kind === 'image' || node.kind === 'panel') && node.bleed && !bleedOk) add('space', '풀폭은 흐름 맨 위 단계에만')
      if (node.kind === 'image' || node.kind === 'panel' || node.kind === 'divider' || node.kind === 'text') {
        const bleed = 'bleed' in node && node.bleed === true
        const x = node.x ?? MARGIN
        const w = node.w ?? 0
        if (!bleed && bleedOk && (x < MARGIN || x + w > CONTENT_RIGHT)) add('space', `좌우 여백 60: x ${x}, w ${w}`)
      }
      if (node.kind === 'row' && node.valign === 'center' && JSON.stringify(node.columns).includes('"kind":"text"')) {
        // 마운트 리플로우는 글자 높이만 실측으로 줄인다. 가운데 위치는 추정 높이 기준으로 남아 옆 사진·표식이 어긋난다(render-check 41275046580)
        add('space', '글자가 있는 가로 칸은 가운데 맞춤 금지(위 맞춤)')
      }
      if (node.kind === 'row') {
        const total = node.columns.reduce((sum, c) => sum + c.w, 0) + (node.gap ?? K_SPACE.columnGap) * (node.columns.length - 1)
        if (total > width) add('space', `가로 칸 합 ${total} > 칸 폭 ${width}`)
      }
    },
    rootVisit(t)
  )
  if (badSteps(t.flow, false)) add('meta', '진행 표시(steps)는 반복 칸 안에만 — 밖에서는 목록이 없어 그리지 않는다')
  lintLink(t, add)
  lintBadgeCount(t, add)
  lintHalf(t, add)
  lintDimension(t, add)
  if (badJoin(t.flow)) add('space', '앞 목록과 잇는 선(joinRule)은 구분선 있는 반복 바로 뒤의 구분선 있는 반복에만')
  if (badEven(t.flow)) add('space', '행 높이 맞춤(even)은 한 줄 반복의 글 항목(글뿐이거나 글만 있는 가로 칸 하나)에만')
  if (badAlternate(t.flow)) add('space', '좌우 번갈아(alternate)는 한 줄 반복의 2칸 가로 칸 항목에만(행 높이 맞춤과 함께 쓰지 않는다)')
  if (badLayer(t.flow)) add('space', '층 띠(layer)는 한 줄 반복의 글 항목에만(간격·구분선·화살표·행 맞춤·번갈아와 함께 쓰지 않는다)')
  if (hasLayer(t.flow) && t.surfaces.some((s) => !LAYER_SURFACES.includes(s))) add('color', `층 띠(layer) 템플릿은 밝은 바탕(${LAYER_SURFACES.join('·')})만 — 짙은 면·사진 바탕은 섞은 색이 중간 밝기라 대비 단계를 못 지킨다`)
  lintPanelEdges(t, add)
  const declared = (defs: Record<string, SlotDef>) => Object.keys(defs)
  for (const name of declared(t.slots)) if (!used.has(name)) add('meta', `쓰지 않는 슬롯: ${name}`)
  for (const def of Object.values(t.slots)) {
    if (def.type !== 'list') continue
    for (const name of declared(def.fields)) if (!used.has(name)) add('meta', `쓰지 않는 항목 칸: ${name}`)
    if (def.min > def.max || def.max < 1) add('meta', '목록 min·max 형식')
  }
  // 값 직접 입력 금지 — 색은 역할 이름만
  if (/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(JSON.stringify(t.flow))) add('color', '흐름에 색 값이 있음')
  for (const [key, range] of Object.entries(SPACING_RANGE)) {
    const value = t.spacing?.[key as keyof typeof SPACING_RANGE]
    const zeroOk = (key === 'top' || key === 'bottom') && value === 0 && edgeIsBleed(t, key)
    // 안 B 표지 첫 화면만 위 80·아래 40(예외 ③, hook-beats.ts) — 그 밖 템플릿은 범위 그대로
    const beatsValue = key === 'top' || key === 'bottom' ? HOOK_BEATS_SPACING[key] : undefined
    const beatsOk = t.section === 'hook_3step' && isHookBeats(t) && typeof beatsValue === 'number' && value === beatsValue
    if (!zeroOk && !beatsOk && (typeof value !== 'number' || value < range[0] || value > range[1])) add('space', `${key} ${value} 범위 ${range.join('~')}`)
  }
}

function edgeIsBleed(t: Template, edge: 'top' | 'bottom') {
  const node = edge === 'top' ? t.flow[0] : t.flow[t.flow.length - 1]
  return Boolean(node && (node.kind === 'image' || node.kind === 'panel') && node.bleed)
}

/** 표본 낱말 길이는 한 줄 글자 수에 맞춘다 — 큰 제목은 한 줄이 7자라 4자 낱말이면 한 줄에 하나만 들어가 실제보다 줄이 많게 잰다 */
const wordLenFor = (size: number, width: number) => Math.max(2, Math.min(4, Math.floor((Math.floor(width / size) - 1) / 2)))

function lintChars(slot: string, def: Extract<SlotDef, { type: 'text' }>, tokenName: keyof typeof K_TYPE, width: number, add: (rule: LintRule, detail: string) => void) {
  const token = K_TYPE[tokenName]
  // 장 번호는 숫자 표식이라 한글 폭으로 재지 않는다(그린 뒤 기하 검사가 본다)
  if (!token || def.input === 'chapter') return
  const perLine = Math.floor(width / token.size)
  if (def.maxChars > perLine * def.maxLines) add('chars', `${slot}: ${def.maxChars}자 > 폭 ${width} ÷ ${token.size} × ${def.maxLines}줄`)
  const height = measureCutText(fillerText(def.maxChars, wordLenFor(token.size, width)), token.size, token.lineHeight, width)
  const lines = Math.round((height - 10) / (token.size * token.lineHeight))
  if (lines > def.maxLines) add('chars', `${slot}: ${def.maxChars}자가 ${lines}줄(상한 ${def.maxLines})`)
}

const sectionOf = (t: Template, out: NonNullable<ReturnType<typeof renderTemplate>>) =>
  ({
    id: t.id,
    sectionType: SECTION_TABLE[t.section]?.proType ?? t.section,
    groupType: 'modules',
    order: 0,
    isVisible: true,
    layoutId: `designcut_k_${t.id}`,
    canvas: { width: W, height: out.height, backgroundColor: out.background },
    elements: out.elements,
    needsInitialReflow: false,
  }) as unknown as CanvasSection

const intersects = (a: CanvasElement, b: CanvasElement) =>
  a.transform.x < b.transform.x + b.transform.width - 1 &&
  b.transform.x < a.transform.x + a.transform.width - 1 &&
  a.transform.y < b.transform.y + b.transform.height - 1 &&
  b.transform.y < a.transform.y + a.transform.height - 1

/** 그린 결과의 기하 위반 — 캔버스 밖, 상자 밖 글자, 글자·사진 겹침(스크림 위에 온전히 얹힌 글자는 사진과 겹쳐도 된다) */
function geometryIssues(out: NonNullable<ReturnType<typeof renderTemplate>>): string[] {
  const issues: string[] = []
  const byId = new Map(out.elements.map((el) => [el.id, el]))
  for (const el of out.elements) {
    const t = el.transform
    if (t.x < 0 || t.x + t.width > W) issues.push(`${el.name}: 캔버스 밖(x ${t.x}, w ${t.width})`)
    if (t.y < 0 || t.y + t.height > out.height) issues.push(`${el.name}: 섹션 밖(y ${t.y}, h ${t.height}, 섹션 ${out.height})`)
    for (const id of el.containerOf ?? []) {
      const child = byId.get(id)
      if (!child || child.type !== 'text') continue
      const c = child.transform
      if (c.x < t.x || c.x + c.width > t.x + t.width || c.y < t.y || c.y + c.height > t.y + t.height) {
        issues.push(`${child.name}: 상자 ${el.name} 밖`)
      }
    }
  }
  const onScrim = new Set([...textsOnScrim(out.elements), ...textsOnBadge(out.elements)])
  const solid = out.elements.filter((el) => el.type === 'text' || el.type === 'framed-image')
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const [a, b] = [solid[i], solid[j]]
      const overPhoto = (a.type === 'framed-image' && onScrim.has(b.id)) || (b.type === 'framed-image' && onScrim.has(a.id))
      if (!overPhoto && intersects(a, b)) issues.push(`겹침: ${a.name} · ${b.name}`)
    }
  }
  return issues
}

/** 첫 화면 가장 큰 사진 넓이 하한(적용 K13, 오너 11-04 18:11 ②) — 풀폭 3:4가 0.617, 여백 둔 사진이 0.457. 레퍼런스 값이 아니라 우리 계산값에서 정했다 */
export const HOOK_PHOTO_SHARE_MIN = 0.55
const SCREEN_H = 1860

/** 폰 첫 화면(860×1860)에서 가장 큰 사진 한 장의 넓이 비율 — 사진 안 제품 넓이가 아니다. 화면 밖으로 나간 부분은 뺀다 */
export function firstScreenPhotoShare(elements: ReadonlyArray<{ type: string; transform: { x: number; y: number; width: number; height: number } }>): number {
  const areas = elements
    .filter((el) => el.type === 'framed-image' || el.type === 'image')
    .map(({ transform: t }) => Math.max(0, Math.min(W, t.x + t.width) - Math.max(0, t.x)) * Math.max(0, Math.min(SCREEN_H, t.y + t.height) - Math.max(0, t.y)))
  return Math.max(0, ...areas) / (W * SCREEN_H)
}

/** 첫 화면 사진 검사 — 긴 글(글자 상한 시험)과 가장 넓은 사진 비율에서도 하한을 넘어야 한다 */
function lintHookPhoto(t: Template, add: (rule: LintRule, detail: string) => void) {
  const values = sampleSlots(t, { mode: 'full', factor: STRESS_FACTOR })
  const shares = [sampleContext(), sampleContext({ aspectOf: () => 100 })].flatMap((ctx) => {
    const out = renderTemplate(t, values, ctx)
    return out ? [firstScreenPhotoShare(out.elements)] : []
  })
  const share = shares.length > 0 ? Math.min(...shares) : 0
  // 안 B 표지 템플릿만 하한 0.45(예외 ②, 오너 11-04 0.55의 예외 — 풀폭 1:1 대표 0.462)
  const min = isHookBeats(t) ? HOOK_BEATS_PHOTO_SHARE_MIN : HOOK_PHOTO_SHARE_MIN
  if (share < min) add('hook', `첫 화면 가장 큰 사진 ${share.toFixed(3)} < ${min}`)
}

const SHRINK_MAX = 120
const SHORT_FILL = 0.5

/**
 * 글이 추정보다 짧을 때 — 실제 글꼴·짧은 카피로 글 상자마다 최대 120px(리플로우 표류 경고 문턱)까지 줄어도 사진·구분선이 서로 덮지 않는다.
 * 겹침 검사는 글자 상자만 봐서 이 결함을 못 잡는다(render-check 41285031668: 구분선이 옆 줄 사진 위로 올라옴)
 */
function shrunkIssues(t: Template, out: NonNullable<ReturnType<typeof renderTemplate>>): string[] {
  const section = sectionOf(t, out)
  for (const el of section.elements) {
    const props = el.textProps
    if (el.type === 'text' && props?.fontSize && props.lineHeight) {
      el.measuredHeight = Math.max(Math.round(props.fontSize * props.lineHeight) + 10, el.transform.height - SHRINK_MAX)
    }
  }
  reflowSectionLayout(section)
  const solid = section.elements.filter((el) => el.type === 'framed-image' || el.name === 'designcut-rule')
  const issues: string[] = []
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      if (intersects(solid[i], solid[j])) issues.push(`글이 짧을 때 겹침: ${solid[i].name} · ${solid[j].name}`)
    }
  }
  return issues
}

const STRESS_RULES = new Set(['M1', 'M2', 'M4', 'M5', 'M6', 'M7'])

function mobileIssues(t: Template, out: NonNullable<ReturnType<typeof renderTemplate>>): string[] {
  const rules = t.order?.zone === 'intro' ? new Set([...STRESS_RULES, 'M3']) : STRESS_RULES
  return checkMobileReadability({ sections: [sectionOf(t, out)] })
    .violations.filter((v) => rules.has(v.rule))
    .map((v) => `${v.rule} ${v.element ?? ''} ${v.detail}`)
}

/** 검사에 쓸 색 조합 표본 — 계열마다 하나 + 형광 띠 조합(노랑 주색) */
function sampleColorContexts(): TemplateContext[] {
  const sets = CONCEPT_FAMILY_IDS.flatMap((family) => {
    const concept = CONCEPTS.find((c) => c.family === family)
    const first = concept ? colorSetsOf(concept).sets[0] : undefined
    return first ? [first] : []
  })
  const highlight = CONCEPTS.flatMap((c) => colorSetsOf(c).sets).find((s) => s.colors.highlight)
  return [...sets, ...(highlight ? [highlight] : [])].map((set) => sampleContext({ colors: set.colors }))
}

const COLOR_CSS = /color:\s*(#[0-9a-fA-F]{6})/g

/** 글자색·강조 구절 색의 어두운 노랑 */
export function darkYellowIn(out: Pick<NonNullable<ReturnType<typeof renderTemplate>>, 'elements'>): string[] {
  const issues: string[] = []
  for (const el of out.elements) {
    if (!el.textProps) continue
    const colors = [el.textProps.color, ...[...(el.textProps.richContent ?? '').matchAll(COLOR_CSS)].map((m) => m[1])]
    for (const color of colors) {
      const rgb = parseColor(color)
      if (rgb && isDarkYellow(rgbToLch(rgb))) issues.push(`${el.name}: 어두운 노랑 ${color}`)
    }
  }
  return issues
}

function lintRendered(t: Template, add: (rule: LintRule, detail: string) => void) {
  // 최대 글자 × 1.2 — 모든 슬롯을 채워 어느 바탕에서도 위반 0
  const stress = sampleSlots(t, { mode: 'full', factor: STRESS_FACTOR })
  for (const bg of t.surfaces ?? []) {
    const out = renderTemplate(t, stress, sampleContext({ bg }))
    if (!out) {
      add('stress', `바탕 ${bg}: 최대 글자로 그리지 못함`)
      continue
    }
    for (const issue of [...mobileIssues(t, out), ...geometryIssues(out)]) add('stress', `바탕 ${bg}: ${issue}`)
    for (const el of out.elements) {
      if (!el.textProps) continue
      const { fontSize: size, lineHeight: lh } = el.textProps
      if (size === undefined || lh === undefined) continue
      // 제목 1.4~1.5(첫 화면 1.35 이상), 본문 1.7. 라벨·번호 표식(LABEL·DISPLAY)은 줄 간격 규칙 밖이다
      if ((size === BODY_SIZE || size === TABLE_SIZE) && lh !== LINE_RULE.body) add('lines', `${el.name}: 본문 ${lh}`)
      if (TITLE_SIZES.includes(size) && (lh < LINE_RULE.titleMin || lh > LINE_RULE.titleMax)) add('lines', `${el.name}: 제목 ${lh}`)
      // 번호 표식(DISPLAY 96)은 크기가 큰 제목 단계와 겹쳐도 줄 간격 규칙 밖이다
      if (HOOK_SIZES.includes(size) && el.textProps.typoLevel !== 'display' && lh < LINE_RULE.hookMin) add('lines', `${el.name}: 첫 화면 ${lh}`)
    }
  }
  // 짧은 글 — 사진이 줄 높이를 정하는 경우는 글이 상한보다 짧을 때 생긴다
  const short = renderTemplate(t, sampleSlots(t, { mode: 'full', factor: SHORT_FILL }), sampleContext())
  if (short) for (const issue of shrunkIssues(t, short)) add('stress', issue)
  // 최소 — 필수 슬롯만 채워도 위반 0
  const minimal = sampleSlots(t, { mode: 'required' })
  const out = renderTemplate(t, minimal, sampleContext())
  if (!out) add('empty', '필수 슬롯만으로 그리지 못함')
  else for (const issue of [...mobileIssues(t, out), ...geometryIssues(out)]) add('empty', issue)
  // 필수가 비면 그리지 않는다
  const required = Object.values(t.slots ?? {}).filter((d) => d.required)
  if (required.length === 0) add('empty', '필수 슬롯이 없음 — 모두 비면 빈 섹션이 된다')
  else if (renderTemplate(t, {}, sampleContext())) add('empty', '필수가 비었는데 그려짐')
  if (out) {
    const blank = out.elements.filter((el) => el.type === 'text' && !el.textProps?.content?.trim())
    if (blank.length > 0) add('empty', `빈 글자 요소 ${blank.length}개`)
  }
  // 색 조합 표본 — 대비·어두운 노랑
  for (const ctx of COLOR_CONTEXTS()) {
    for (const bg of t.surfaces ?? []) {
      const colored = renderTemplate(t, sampleSlots(t, { mode: 'full' }), { ...ctx, bg, usp: [fillerText(5)] })
      if (!colored) continue
      const m2 = checkMobileReadability({ sections: [sectionOf(t, colored)] }).violations.filter((v) => v.rule === 'M2')
      for (const v of m2) add('color', `바탕 ${bg}: ${v.element ?? ''} ${v.detail}`)
      for (const issue of darkYellowIn(colored)) add('color', `바탕 ${bg}: ${issue}`)
    }
  }
}

let colorContexts: TemplateContext[] | null = null
const COLOR_CONTEXTS = () => (colorContexts ??= sampleColorContexts())

function lintPhotos(t: Template, add: (rule: LintRule, detail: string) => void) {
  walk(
    t.flow,
    ({ node, defs }) => {
      if (node.kind !== 'image' && node.kind !== 'dimension') return
      const def = defs[node.slot]
      if (def?.type !== 'image') return
      if (!def.purpose?.length) add('photo', `${node.slot}: purpose 없음`)
      for (const purpose of def.purpose ?? []) if (!SHOT_PURPOSES.includes(purpose)) add('photo', `${node.slot}: 등록 안 된 목적 ${purpose}`)
      if (def.purpose?.length && def.purpose.every((p) => INPUT_NAMED_PURPOSES.includes(p))) add('photo', `${node.slot}: ${def.purpose.join('·')}만 있으면 입력 없는 상품에서 칸이 빈다`)
      if (!def.composition?.length) add('photo', `${node.slot}: composition(구도) 없음`)
      if (!def.aspect?.length) add('photo', `${node.slot}: aspect 없음`)
    },
    rootVisit(t)
  )
  const required = requiredPhotos(t)
  if (t.needs && t.needs.photos !== required) add('photo', `needs.photos ${t.needs.photos} ≠ 필수 사진 ${required}`)
  // 사진을 가장 납작한 비율로 받아도 폭 300 이상이면 높이 500 이상(M5보다 넓게 모든 섹션에)
  const out = renderTemplate(t, sampleSlots(t, { mode: 'full' }), sampleContext({ aspectOf: () => 100 }))
  for (const el of out?.elements ?? []) {
    if (el.type !== 'framed-image') continue
    if (el.transform.width >= 300 && el.transform.height < 500) add('photo', `${el.name}: 폭 ${el.transform.width}·높이 ${el.transform.height} < 500`)
  }
}

/** 별점 분포 막대가 놓이는 섹션(적용 K7-b) */
const BARS_SECTIONS: readonly string[] = ['review', 'perf_metric']

/** 별점 분포 막대 — 후기·평점 섹션에만, 템플릿당 하나, 칸은 RATING_BARS_INPUT 필수 목록(5줄)이다. 입력이 없으면 템플릿째 후보에서 빠진다 */
function lintBars(t: Template, add: (rule: LintRule, detail: string) => void) {
  const bars: Array<Extract<FlowNode, { kind: 'bars' }>> = []
  walk(t.flow, ({ node }) => node.kind === 'bars' && bars.push(node), rootVisit(t))
  if (bars.length === 0) return
  if (!BARS_SECTIONS.includes(t.section)) add('evidence', `별점 분포 막대는 ${BARS_SECTIONS.join('·')}에만`)
  if (bars.length > 1) add('evidence', `별점 분포 막대 ${bars.length}개(템플릿당 하나)`)
  for (const node of bars) {
    const def = t.slots[node.slot]
    if (def?.type !== 'list' || def.input !== RATING_BARS_INPUT || !def.required || def.min !== 5 || def.max !== 5) add('evidence', `별점 분포 칸 ${node.slot}은 ${RATING_BARS_INPUT} 필수 목록 5줄`)
  }
}

/** 같은 축척 윤곽이 놓이는 섹션(적용 K7 4d) — 옵션 사이즈와 상품 정보 표 */
export const SCALE_SET_SECTIONS: readonly string[] = ['option_gallery', 'spec_table']

/**
 * 같은 축척 윤곽(적용 K7 4d) — 옵션·상품 정보 표 섹션에만, 템플릿당 하나, 흐름 맨 위 단계(판·반복·가로 칸 안 금지 — 전체 폭 열이 축척을 정한다).
 * 칸은 SIZE_SCALE_INPUT 필수 목록(2~5)이고 항목 칸은 이름·가로·세로 입력 셋이다. 입력이 그릴 꼴이 아니면 목록이 비어 템플릿째 후보에서 빠진다
 */
function lintScaleSet(t: Template, add: (rule: LintRule, detail: string) => void) {
  const nodes: Array<Extract<FlowNode, { kind: 'scaleSet' }>> = []
  walk(t.flow, ({ node }) => node.kind === 'scaleSet' && nodes.push(node), rootVisit(t))
  if (nodes.length === 0) return
  if (!SCALE_SET_SECTIONS.includes(t.section)) add('evidence', `같은 축척 윤곽은 ${SCALE_SET_SECTIONS.join('·')}에만`)
  if (nodes.length > 1) add('evidence', `같은 축척 윤곽 ${nodes.length}개(템플릿당 하나)`)
  for (const node of nodes) {
    if (!t.flow.includes(node)) add('meta', '같은 축척 윤곽은 흐름 맨 위 단계에만(판·반복·가로 칸 안 금지)')
    const def = t.slots[node.slot]
    const { min, max, labelMax } = SCALE_SET_LIMITS
    if (def?.type !== 'list' || def.input !== SIZE_SCALE_INPUT || !def.required || def.min !== min || def.max !== max) {
      add('evidence', `같은 축척 칸 ${node.slot}은 ${SIZE_SCALE_INPUT} 필수 목록 ${min}~${max}`)
      continue
    }
    const inputs = Object.values(def.fields).map((f) => (f.type === 'text' && f.source === 'input' && f.required ? f.input : undefined))
    for (const want of [SIZE_SCALE_LABEL_INPUT, SIZE_SCALE_WIDTH_INPUT, SIZE_SCALE_HEIGHT_INPUT]) {
      if (inputs.filter((v) => v === want).length !== 1) add('evidence', `같은 축척 칸 ${node.slot}: 필수 입력 칸 ${want} 하나`)
    }
    if (Object.keys(def.fields).length !== 3) add('evidence', `같은 축척 칸 ${node.slot}: 항목 칸은 이름·가로·세로 셋만`)
    const label = Object.values(def.fields).find((f) => f.type === 'text' && f.input === SIZE_SCALE_LABEL_INPUT)
    if (label?.type === 'text' && label.maxChars !== labelMax) add('evidence', `같은 축척 이름 칸은 ${labelMax}자(열마다 한 줄 표식)`)
  }
}

/** 사진 위 글 — 자리·모양을 막고, 최대 글자를 가장 납작한 사진에 그려 스크림이 사진을 얼마나 가리는지 본다 */
function lintOverlay(t: Template, add: (rule: LintRule, detail: string) => void) {
  let found = false
  // 상한은 슬롯 글자 수·줄 수를 지킨 실제 최대 글로 잰다(lintChars와 같은 낱말 길이). 기본 표본은 줄이 더 많이 나와 막을 과장한다
  const fullValues = sampleSlots(t, { mode: 'full' })
  walk(
    t.flow,
    ({ node, bleedOk }) => {
      if (node.kind !== 'image' || !node.overlay) return
      found = true
      for (const text of node.overlay.nodes) {
        const def = text.kind === 'text' ? t.slots[text.slot] : null
        if (def?.type === 'text') fullValues[text.slot] = fillerText(def.maxChars, wordLenFor(K_TYPE[text.token].size, CONTENT_W))
      }
      if (!OVERLAY_SECTIONS.includes(t.section)) add('overlay', `${t.section}: 사진 위 글을 쓰지 않는 섹션`)
      if (!bleedOk || !node.bleed) add('overlay', '사진 위 글은 흐름 맨 위 풀폭 사진에만')
      if (node.plate) add('overlay', '사진 위 글에 뒤 판 금지')
      if (node.fit === 'contain') add('overlay', '사진 위 글은 cover만 — 남는 자리가 비치면 막 계산이 어긋난다')
      if (node.overlay.nodes.length === 0) add('overlay', '사진 위 글이 비어 있음')
      for (const text of node.overlay.nodes) {
        if (text.kind !== 'text') add('overlay', `사진 위에는 글만: ${(text as FlowNode).kind}`)
        else if (text.emphasis || text.color === 'accent') add('overlay', `${text.slot}: 강조색 금지 — 막은 글자 본색의 대비만 보장한다`)
      }
    },
    rootVisit(t)
  )
  if (!found) return
  const flat = sampleContext({ aspectOf: () => 100 })
  const stress = renderTemplate(t, sampleSlots(t, { mode: 'full', factor: STRESS_FACTOR }), flat)
  for (const issue of scrimIssues(stress?.elements ?? [])) add('overlay', `글자 ${STRESS_FACTOR}배: ${issue}`)
  const full = renderTemplate(t, fullValues, flat)
  for (const issue of scrimIssues(full?.elements ?? [], OVERLAY_SCRIM_MAX)) add('overlay', issue)
}

/** 첫 화면에 쓰지 않는 노드 — 목록·번호·표시·위 작은 글은 1~3초에 읽히지 않는다 */
const HOOK_BLOCKED_NODES = new Set<FlowNode['kind']>(['repeat', 'mark', 'icon', 'tags', 'divider', 'capsule', 'rating', 'bars', 'scaleSet', 'dimension', 'label'])

/** 첫 화면 글의 양 — 큰 제목 하나(2줄) + 보조 하나(한 줄)까지. 보조 자리에는 수량 표식도 든다 */
function lintHookText(t: Template, add: (rule: LintRule, detail: string) => void) {
  let titles = 0
  let others = 0
  let lines = 0
  let chars = 0
  walk(
    t.flow,
    ({ node, defs }) => {
      if (HOOK_BLOCKED_NODES.has(node.kind)) add('hook', `첫 화면에 ${node.kind} 금지`)
      if (node.kind !== 'text') return
      const def = defs[node.slot]
      if (def?.type !== 'text') return
      lines += def.maxLines
      chars += def.maxChars
      if (node.token === 'HOOK') {
        titles += 1
        if (def.maxChars > HOOK_TEXT.titleChars || def.maxLines > HOOK_TEXT.titleLines) add('hook', `${node.slot}: 큰 제목은 ${HOOK_TEXT.titleChars}자·${HOOK_TEXT.titleLines}줄 이하`)
        return
      }
      others += 1
      if (def.maxChars > HOOK_TEXT.subChars || def.maxLines > HOOK_TEXT.subLines) add('hook', `${node.slot}: 보조는 ${HOOK_TEXT.subChars}자·${HOOK_TEXT.subLines}줄 이하`)
    },
    rootVisit(t)
  )
  if (titles > 1) add('hook', `큰 제목 ${titles}개 — 하나만`)
  // 안 B 표지 템플릿만 큰 제목 하나 + 첫 화면 글 3줄·36자 이하면 보조 둘(예외 ①, hook-beats.ts)
  const beats = isHookBeats(t) && titles === 1 && lines <= HOOK_BEATS_TEXT.lines && chars <= HOOK_BEATS_TEXT.chars
  const subsMax = beats ? HOOK_BEATS_TEXT.subs : 1
  if (others > subsMax) add('hook', `보조 글 ${others}개 — ${subsMax === 1 ? '하나만' : `${subsMax}개까지`}`)
}

/** 기존 제품과 나란히 놓는 칸 — 표식이 없어도 비교 주장이다. from은 비교 섹션에서만 그렇다(direction_suggest의 from은 고객의 전후) */
const isContrastSlot = (t: Template, name: string) => name === 'otherLabel' || name === 'others' || (t.section === 'compare' && name === 'from')

const nodeKey = (node: FlowNode): string => {
  if (node.kind === 'capsule') return `capsule:${node.label ?? node.slot}`
  if (node.kind === 'text') return `text:${node.slot}:${node.token}`
  if (node.kind === 'row') return `row[${node.columns.flatMap((c) => c.nodes.map(nodeKey)).join(',')}]`
  return node.kind
}
/** 흐름의 모양 문자열 — 머리 구조 대조용 */
export const headKeyOf = (flow: readonly FlowNode[]) => flow.map(nodeKey).join('|')

function lintRules(t: Template, add: (rule: LintRule, detail: string) => void) {
  // 모양 서명
  if (t.signature) {
    const derived = deriveSignature(t)
    if (signatureKey(derived) !== signatureKey(t.signature)) add('signature', `선언 ${signatureKey(t.signature)} ≠ 계산 ${signatureKey(derived)}`)
  }
  // 근거 잠금
  if (EVIDENCE_LOCKED.includes(t.section) && !t.needs?.evidence?.length) add('evidence', `${t.section}는 needs.evidence 필수`)
  if (t.section === 'perf_metric') {
    for (const [name, def] of Object.entries(t.slots ?? {})) {
      if (def.type === 'text' && def.facts > 0 && def.source !== 'input') add('evidence', `${name}: 수치 슬롯은 input`)
    }
  }
  // 고민 섹션 밖에서 엑스는 쓰지 않는다. 기존 제품 칸의 중립 표식·이름표는 비교 주장이라 근거가 있어야 고를 수 있다
  if (!PAIN_MARK_SECTIONS.includes(t.section)) {
    const hasBasis = t.needs?.evidence?.includes(COMPARE_BASIS)
    let cross = false
    let dash = false
    let other = false
    walk(
      t.flow,
      ({ node }) => {
        if (node.kind === 'mark' && node.value === 'cross') cross = true
        if (node.kind === 'mark' && node.value === 'dash') dash = true
        if (node.kind === 'label' && node.label === COMPARE_OTHER_LABEL) other = true
      },
      rootVisit(t)
    )
    if (cross) add('evidence', '엑스 표식은 고민 섹션에서만 쓴다. 기존 제품 칸은 dash')
    if (dash && !hasBasis) add('evidence', `dash 표식은 needs.evidence에 ${COMPARE_BASIS} 필수`)
    if (other && !hasBasis) add('evidence', `'${COMPARE_OTHER_LABEL}' 이름표는 needs.evidence에 ${COMPARE_BASIS} 필수`)
  }
  // 기존 제품과 나란히 놓는 칸 — 비교 카피 측정(11-01)에서 칸이 대비를 강제해 근거 없는 비교 글이 나왔다
  if (!t.needs?.evidence?.includes(COMPARE_BASIS)) {
    const names = Object.entries(t.slots ?? {}).flatMap(([name, def]) => (def.type === 'list' ? [name, ...Object.keys(def.fields)] : [name]))
    for (const name of names) if (isContrastSlot(t, name)) add('evidence', `${name}: 기존 제품과 나란히 놓는 칸은 needs.evidence에 ${COMPARE_BASIS} 필수`)
  }
  // 사실 수
  for (const [name, def] of Object.entries(t.slots ?? {})) {
    const texts = def.type === 'text' ? [[name, def] as const] : def.type === 'list' ? Object.entries(def.fields) : []
    for (const [field, d] of texts) {
      if (d.type === 'text' && (!Number.isInteger(d.facts) || d.facts < 0)) add('facts', `${field}: facts 없음`)
    }
  }
  if (t.needs?.facts) {
    const range = factRange(t)
    if (t.needs.facts.min !== range.min || t.needs.facts.max !== range.max) {
      add('facts', `needs.facts ${t.needs.facts.min}~${t.needs.facts.max} ≠ 계산 ${range.min}~${range.max}`)
    }
  } else add('facts', 'needs.facts 없음')
  // 첫 화면
  if (t.section === 'hook_3step') {
    for (const name of Object.keys(t.slots ?? {})) if (HOOK_BLOCKED_SLOT.test(name)) add('hook', `상품명·옵션·분류 슬롯 금지: ${name}`)
    let hasHook = false
    walk(t.flow, ({ node }) => {
      if (node.kind !== 'text') return
      if (node.token === 'HOOK') hasHook = true
      if (node.token === 'CAPTION') add('hook', `첫 화면에 CAPTION 금지: ${node.slot}`)
    }, rootVisit(t))
    if (!hasHook) add('hook', 'HOOK 토큰 제목 없음')
    lintHookText(t, add)
    lintHookPhoto(t, add)
  }
  // 상품 정보 표
  if (t.section === 'spec_table') {
    const rows = t.slots?.rows
    if (rows?.type !== 'list' || !rows.required || rows.input !== SPEC_ROWS_INPUT || rows.max !== SPEC_ROWS_MAX) add('specRows', `rows는 필수 목록(${SPEC_ROWS_INPUT}, 최대 ${SPEC_ROWS_MAX})`)
    // 같은 축척 윤곽(적용 K7 4d, 통합 06:0x ②)이 읽는 목록은 표 내용이 아니라 도식이다 — 그 노드 하나만 예외
    const scaleSlots = new Set<string>()
    walk(t.flow, ({ node }) => node.kind === 'scaleSet' && scaleSlots.add(node.slot), rootVisit(t))
    for (const [name, def] of Object.entries(t.slots ?? {})) {
      if (def.type !== 'list' || name === 'rows' || (scaleSlots.has(name) && def.input === SIZE_SCALE_INPUT)) continue
      if (name !== 'special' || def.required || def.input !== SPEC_SPECIAL_INPUT) add('specRows', `${name}: 표 내용은 special(${SPEC_SPECIAL_INPUT}, 선택)만`)
    }
  }
  // POINT 머리 구조 — 페이지 안에서 같아야 하므로 point_div는 정해진 머리로 시작한다
  if (t.section === 'point_div') {
    const want = t.headStyle ? POINT_HEAD_STYLES[t.headStyle] : undefined
    if (!want) add('headStyle', `point_div는 headStyle 필수(${Object.keys(POINT_HEAD_STYLES).join(', ')})`)
    else if (!headKeyOf(t.flow).startsWith(want)) add('headStyle', `머리 ${headKeyOf(t.flow)} ≠ ${want}`)
  } else if (t.headStyle) add('headStyle', 'headStyle은 point_div에만')
  // 예상 높이
  if (t.estimatedHeight) {
    const range = heightRange(t)
    const near = (a: number, b: number) => b > 0 && Math.abs(a - b) / b <= HEIGHT_TOLERANCE
    if (!near(t.estimatedHeight.min, range.min) || !near(t.estimatedHeight.max, range.max)) {
      add('height', `estimatedHeight ${t.estimatedHeight.min}~${t.estimatedHeight.max} ≠ 계산 ${range.min}~${range.max}`)
    }
    if (!near(t.height, range.typical)) add('height', `height ${t.height} ≠ 계산 ${range.typical}`)
  }
}

/** 템플릿 하나의 위반. 형식이 크게 틀리면 그리기 검사 전에 돌려준다 */
export function lintTemplate(t: Template): TemplateViolation[] {
  const violations: TemplateViolation[] = []
  const add = (rule: LintRule, detail: string) => violations.push({ template: t.id, rule, detail })
  lintMeta(t, add)
  if (violations.length > 0 && (!t.flow?.length || !t.slots)) return violations
  lintStructure(t, add)
  // 슬롯 참조가 틀리면 그리기 검사는 뜻이 없다
  if (violations.some((v) => v.rule === 'meta' && /없는 슬롯|슬롯 형식/.test(v.detail))) return violations
  lintPhotos(t, add)
  lintOverlay(t, add)
  lintBars(t, add)
  lintScaleSet(t, add)
  lintRules(t, add)
  lintRendered(t, add)
  return violations
}

export interface LibraryReport {
  ok: boolean
  total: number
  violations: TemplateViolation[]
  counts: Record<LintRule, number>
  sections: Array<{ section: TemplateSectionId; count: number; target: number }>
  /** 예상 높이 — D 섹션(약 1,900px)과의 비교, 페이지 높이 합 추정(섹션 18·20·22개 × 평균 대표 높이) */
  heights: {
    avgMin: number
    avgMax: number
    avgTypical: number
    ratioToD: number
    page: { sections: typeof PAGE_SECTIONS; atMin: number; atTarget: number; atMax: number; required: number; meetsAtTarget: boolean }
    /** 채움(사실 요구 0 섹션) 없이 본문 섹션만의 평균 — 채움에 기대지 않고 합격점에 닿는지, 어느 섹션을 키울지의 근거 */
    withoutFillers: { avgTypical: number; atTarget: number; meetsAtTarget: boolean }
    bySection: Array<{ section: TemplateSectionId; avgMin: number; avgMax: number; avgTypical: number; ratioToD: number }>
  }
  /** 색 경고(L10 후보 7, 보고만 — 막지 않음) — 컨셉마다 색 조합과 그 컨셉에 맞는 템플릿 장식으로 lintKPageColors를 돌린 벌 수 */
  colors: { sets: number; warned: number; byConcept: Array<{ concept: string; sets: number; warned: number }> }
}

/** 색 경고 보고 — 놓일 페이지를 모르므로 컨셉의 색 조합 하나를 한 페이지로, 그 컨셉에 맞는 템플릿을 놓일 후보로 본다 */
function colorReport(templates: readonly Template[]): LibraryReport['colors'] {
  const byConcept = CONCEPTS.map((concept) => {
    const sets = colorSetsOf(concept).sets
    const fitting = templates.filter((t) => t.fit?.concepts?.includes(concept.id))
    return { concept: concept.id, sets: sets.length, warned: sets.filter((set) => lintKPageColors(set.colors, fitting).length > 0).length }
  })
  return { sets: byConcept.reduce((sum, c) => sum + c.sets, 0), warned: byConcept.reduce((sum, c) => sum + c.warned, 0), byConcept }
}

const mean =(values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0)

/** 글자 토큰 위계 — 템플릿이 아니라 토큰 표를 본다 */
export function typeScaleIssues(): string[] {
  const issues: string[] = []
  const body = K_TYPE.BODY.size
  for (const [name, min] of Object.entries(TYPE_RATIO_MIN)) {
    const ratio = K_TYPE[name as keyof typeof TYPE_RATIO_MIN].size / body
    if (ratio < min) issues.push(`${name}÷본문 ${ratio.toFixed(2)} < ${min}`)
  }
  for (const name of ['LABEL', 'CAPTION'] as const) {
    const ratio = K_TYPE[name].size / body
    if (ratio < TYPE_SMALL_RATIO[0] || ratio > TYPE_SMALL_RATIO[1]) issues.push(`${name}÷본문 ${ratio.toFixed(2)}: ${TYPE_SMALL_RATIO.join('~')} 밖`)
  }
  for (const [name, min] of Object.entries(TYPE_SIZE_MIN)) {
    const size = K_TYPE[name as keyof typeof TYPE_SIZE_MIN].size
    if (size < min) issues.push(`${name} ${size} < 하한 ${min}`)
  }
  return issues
}

export function lintTemplateLibrary(templates: readonly Template[] = TEMPLATES): LibraryReport {
  const violations = templates.flatMap((t) => lintTemplate(t))
  for (const detail of typeScaleIssues()) violations.push({ template: 'K_TYPE', rule: 'type', detail })
  const seenIds = new Set<string>()
  for (const t of templates) {
    if (seenIds.has(t.id)) violations.push({ template: t.id, rule: 'meta', detail: 'id 중복' })
    seenIds.add(t.id)
  }
  // 공용끼리는 섹션 안에서 모양이 모두 달라야 한다. 카테고리 템플릿은 lintCategoryTemplates가 본다
  violations.push(...lintCategoryTemplates(templates))
  const waves = waveTemplates(templates)
  if (waves.length > WAVE_EDGE_MAX || waves.some((t) => t.section === POINT_SECTION)) {
    for (const t of waves) violations.push({ template: t.id, rule: 'space', detail: `wave 곡선 경계는 POINT 아닌 템플릿 ${WAVE_EDGE_MAX}칸까지(페이지 한 번): ${waves.length}칸` })
  }
  const signatures = new Map<string, string>()
  for (const t of templates) {
    if (t.fit?.categories?.length) continue
    const key = `${t.section}|${signatureKey(deriveSignature(t))}`
    const other = signatures.get(key)
    if (other) violations.push({ template: t.id, rule: 'signature', detail: `같은 섹션 ${other}와 모양이 같음(${key})` })
    else signatures.set(key, t.id)
  }
  const counts = Object.fromEntries(LINT_RULES.map((r) => [r, 0])) as Record<LintRule, number>
  for (const v of violations) counts[v.rule]++
  const ranges = templates.map((t) => ({ section: t.section, ...heightRange(t) }))
  const avgMin = mean(ranges.map((r) => r.min))
  const avgMax = mean(ranges.map((r) => r.max))
  const avgTypical = mean(ranges.map((r) => r.typical))
  const bodyTypical = mean(ranges.filter((r) => !(FACT_FREE_FILLERS as readonly string[]).includes(r.section)).map((r) => r.typical))
  const ratio = (v: number) => Math.round((v / D_SECTION_HEIGHT) * 100) / 100
  const present = TEMPLATE_SECTION_IDS.filter((s) => ranges.some((r) => r.section === s))
  return {
    ok: violations.length === 0,
    total: templates.length,
    violations,
    counts,
    sections: TEMPLATE_SECTION_IDS.map((section) => ({
      section,
      count: templates.filter((t) => t.section === section).length,
      target: SECTION_TABLE[section].target,
    })),
    heights: {
      avgMin,
      avgMax,
      avgTypical,
      ratioToD: ratio(avgTypical),
      page: {
        sections: PAGE_SECTIONS,
        atMin: avgTypical * PAGE_SECTIONS.min,
        atTarget: avgTypical * PAGE_SECTIONS.target,
        atMax: avgTypical * PAGE_SECTIONS.max,
        required: PAGE_MIN_HEIGHT,
        meetsAtTarget: avgTypical * PAGE_SECTIONS.target >= PAGE_MIN_HEIGHT,
      },
      withoutFillers: {
        avgTypical: bodyTypical,
        atTarget: bodyTypical * PAGE_SECTIONS.target,
        meetsAtTarget: bodyTypical * PAGE_SECTIONS.target >= PAGE_MIN_HEIGHT,
      },
      bySection: present.map((section) => {
        const list = ranges.filter((r) => r.section === section)
        const typical = mean(list.map((r) => r.typical))
        return { section, avgMin: mean(list.map((r) => r.min)), avgMax: mean(list.map((r) => r.max)), avgTypical: typical, ratioToD: ratio(typical) }
      }),
    },
    colors: colorReport(templates),
  }
}
