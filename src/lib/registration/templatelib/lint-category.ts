/**
 * 카테고리 템플릿 전수 검사 — A·C 합의(보드 11-01 18:13). 공용 템플릿은 fit.categories가 비어 있고 지금 규칙 그대로다.
 * fit만 다른 복제본으로 수량을 채우지 못하게 하고, 컨셉 일관성을 지킨다. POINT 머리·첫 화면 글 양·표 끝 자리·근거 잠금은 lintTemplate이 모든 템플릿에 똑같이 본다.
 */

import { conceptById, CONCEPTS } from './concepts'
import { PRODUCT_FAMILIES } from './product-family'
import screenKnown from './screen-known.json'
import { sectionLocks } from './selection-facts'
import { deriveSignature, signatureKey } from './signature'
import type { DimensionNode, FlowNode, ImageNode, RepeatNode, SlotDef, Template, TokenName } from './template-types'

export interface CategoryViolation {
  template: string
  rule: 'category' | 'signature' | 'evidence'
  detail: string
}

const FAMILY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const categoriesOf = (t: Template) => t.fit.categories ?? []
const isCategoryTemplate = (t: Template) => categoriesOf(t).length > 0
const shapeOf = (t: Template) => signatureKey(deriveSignature(t))
/**
 * 첫 화면은 복제 검사 예외(적용 K13, 오너 11-04 18:11 ④) — 첫 화면 기본형이 제목 + 풀폭 사진 한 장이라 카테고리 차이를 모양이 아니라 사진 종류로 낸다.
 * 이 검사가 후킹 칸을 비슷하게 못 두게 해서 카테고리 후킹 15종에 풀폭 사진 꼴이 0종이었다
 */
const SAME_SHAPE_ALLOWED: ReadonlySet<string> = new Set(['hook_3step'])
const flowOf = (t: Template) => JSON.stringify(t.flow)

/**
 * 뼈대+글자 단계 — 노드 종류와 묶음, 글자 토큰·정렬, 판의 색·풀폭, 반복의 열·구분선만 남긴다. 슬롯 이름·문구·여백·사진 목적은 뺀다.
 * 서명은 열 수·사진 위치·정렬·용기만 봐서 글 구조를 못 가른다. 그래서 공용과 화면이 같아도 사진 목적 낱말 하나로 통과했다(파일럿 beauty-tone-pair).
 * 구역 연결 표식(link, R-W9)은 아래 여백 안의 장식이라 뼈대에 넣지 않는다 — 같은 뼈대 칸이 표식 하나로 달라 보이게 세지 않는다.
 */
export function skeletonKey(nodes: readonly FlowNode[]): string {
  return nodes
    .filter((n) => n.kind !== 'link')
    .map((n) => {
      switch (n.kind) {
        case 'row':
          return `row[${n.columns.map((c) => skeletonKey(c.nodes)).join('|')}]`
        case 'panel':
          return `panel:${n.fill}${n.bleed ? ':bleed' : ''}(${skeletonKey(n.nodes)})`
        case 'repeat':
          return `repeat${n.columns ?? 1}${n.rule ? ':rule' : ''}${n.layer ? ':layer' : ''}(${skeletonKey(n.nodes)})`
        case 'text':
          return `text:${n.token}:${n.align ?? 'left'}`
        case 'image':
          if (n.frame === 'circle' || n.frame === 'arch') return `image:${n.frame}`
          if (n.half) return 'image:half'
          return n.overlay ? `image[overlay:${n.overlay.anchor}:${n.overlay.ink}(${skeletonKey(n.overlay.nodes)})]` : n.kind
        case 'dimension':
          return dimensionKey(n)
        default:
          return n.kind
      }
    })
    .join(',')
}

/** 치수 칸 — 깊이 글이 있는 3축 칸(적용 K7-c 4c, K14부터 그림 없이 글로만)은 2축 칸과 화면을 따로 센다. 2축은 지금 키 그대로 */
const dimensionKey = (n: DimensionNode) => (n.depthSlot ? 'dimension:box' : 'dimension')

const TITLE_TOKENS: readonly TokenName[] = ['HOOK', 'H1', 'H2', 'H3', 'DISPLAY']
const TITLE_BLOCK = 'H'
const SMALL_BLOCK = 's'

/** 글 블록으로 합치는 노드 — 글·이름표·표시·캡슐과, 그것만 든 가로 칸(POINT 머리) */
function isTextual(n: FlowNode): boolean {
  if (n.kind === 'row') return n.columns.every((c) => c.nodes.every(isTextual))
  return n.kind === 'text' || n.kind === 'label' || n.kind === 'mark' || n.kind === 'capsule'
}
function hasTitle(n: FlowNode): boolean {
  if (n.kind === 'row') return n.columns.some((c) => c.nodes.some(hasTitle))
  return n.kind === 'text' && TITLE_TOKENS.includes(n.token)
}
function hasPhoto(nodes: readonly FlowNode[]): boolean {
  return nodes.some((n) => {
    if (n.kind === 'image' || n.kind === 'dimension') return true
    if (n.kind === 'row') return n.columns.some((c) => hasPhoto(c.nodes))
    return n.kind === 'panel' || n.kind === 'repeat' ? hasPhoto(n.nodes) : false
  })
}
/**
 * 원·아치 틀(K-FRAME.md)은 사각 사진과 화면이 다르다 — 틀을 키에 넣는다. 넣지 않으면 원·아치 칸과 블록이 같은 사각 칸이 같은 화면으로 막혔다
 * (예: 사각 2장 카테고리 칸이 공용 sub_div.arch-pair와 같은 H,list2(photo)). decor·plain은 사각이라 그대로다
 */
const frameKey = (n: ImageNode) => (n.frame === 'circle' || n.frame === 'arch' ? `:${n.frame}` : '')
function photoKey(n: ImageNode): string {
  if (n.bleed) return n.overlay ? `photo:bleed:overlay:${n.overlay.anchor}` : 'photo:bleed'
  // 반 띠(적용 K7-c 4a) — 위 절반 풀폭 면 위 사진이라 고객 눈에 판 사진과 다르다
  if (n.half) return 'photo:half'
  if (n.plate) return `photo:plate${frameKey(n)}`
  return (n.x !== undefined || n.w !== undefined ? 'photo:offset' : 'photo') + frameKey(n)
}
interface ScreenContext {
  photo: boolean
  slots: Readonly<Record<string, SlotDef>>
}
/** 반복 — 최소 항목이 한 줄에 다 들면 같은 폭 가로 칸과 같게 보일 수 있어 list다. 항상 여러 줄이면 격자다(같은 폭 2장 ≠ 2×2) */
function repeatKey(n: RepeatNode, ctx: ScreenContext): string {
  const columns = n.columns ?? 1
  const slot = ctx.slots[n.slot]
  const least = slot?.type === 'list' ? slot.min : 0
  // 층 띠는 맞닿은 강조색 단계 띠라 글 목록과 화면이 다르다
  if (n.layer) return `layer${columns}`
  return columns > 1 && least > columns ? `grid${columns}x${Math.ceil(least / columns)}` : `list${columns}`
}
function screenNode(n: FlowNode, ctx: ScreenContext): string {
  const inner = (nodes: readonly FlowNode[]) => screenBlocks(nodes, ctx).join(',')
  switch (n.kind) {
    case 'image':
      return photoKey(n)
    case 'row': {
      const widths = n.columns.map((c) => c.w)
      const ratio = (Math.max(...widths) / widths.reduce((sum, w) => sum + w, 0)).toFixed(1)
      const cells = n.columns.map((c) => inner(c.nodes)).sort()
      // 같은 폭에 같은 내용이면 한 줄 반복과 화면이 같다(packaging 첫 안 rep2 ↔ 공용 pair-actions row)
      if (cells.every((c) => c === cells[0]) && ratio === (1 / cells.length).toFixed(1)) return `list${cells.length}(${cells[0]})`
      return `row@${ratio}(${cells.join('|')})`
    }
    case 'panel':
      return `panel:${n.fill}${n.bleed ? ':bleed' : ''}(${inner(n.nodes)})`
    case 'repeat':
      return `${repeatKey(n, ctx)}(${inner(n.nodes)})`
    case 'dimension':
      return dimensionKey(n)
    default:
      return n.kind
  }
}
/** 한 곳의 블록 목록 — 이웃 글은 하나로 합치고, 사진이 있는 템플릿은 작은 글·태그·구분선을 뺀다. 작은 글뿐인 곳은 비우지 않는다 */
function screenBlocks(nodes: readonly FlowNode[], ctx: ScreenContext): string[] {
  const blocks: string[] = []
  for (const n of nodes) {
    if (ctx.photo && (n.kind === 'tags' || n.kind === 'divider')) continue
    if (!isTextual(n)) {
      blocks.push(screenNode(n, ctx))
      continue
    }
    const block = hasTitle(n) ? TITLE_BLOCK : SMALL_BLOCK
    const last = blocks[blocks.length - 1]
    if (last === TITLE_BLOCK || last === SMALL_BLOCK) blocks[blocks.length - 1] = last === TITLE_BLOCK ? TITLE_BLOCK : block
    else blocks.push(block)
  }
  if (!ctx.photo) return blocks
  const kept = blocks.filter((b) => b !== SMALL_BLOCK)
  return kept.length > 0 ? kept : blocks
}
const screenBlocksOf = (t: Pick<Template, 'flow' | 'slots'>) => screenBlocks(t.flow, { photo: hasPhoto(t.flow), slots: t.slots ?? {} })

/**
 * 화면 단계 — 고객 눈에 같은 칸이면 같은 키다. skeletonKey가 가르는 글 정렬·이름표·작은 글·글자 단계 차이는 뺀다.
 * 대신 skeletonKey가 안 보는 풀폭 사진·사진 위 글 위치·어긋난 사진·칸 폭 구간·격자 줄 수를 넣는다. 칸 폭은 큰 칸 비율을 0.1로 반올림한 값이고 좌우 반전은 같게 본다.
 * 줄 수는 슬롯의 최소 항목에서 읽어 slots가 필요하다. 파일럿 뒤 '판정은 통과인데 공용과 같아 보임'이 반복돼 생겼다(첫 안 10건은 lint-screen.test.ts).
 */
export function screenKey(flow: readonly FlowNode[], slots: Readonly<Record<string, SlotDef>> = {}): string {
  return screenBlocks(flow, { photo: hasPhoto(flow), slots }).join(',')
}
const screenOf = (t: Pick<Template, 'flow' | 'slots'>) => screenBlocksOf(t).join(',')

/** 사진 목적 묶음 — 공용과 모양이 같을 때 '무엇이 다른지'를 잰다. 착용 구도도 실제 사진이 달라 함께 본다. 글만 있는 템플릿은 빈 값이라 공용과 같은 모양을 쓸 수 없다 */
function purposesOf(t: Template): string {
  const found = new Set<string>()
  for (const slot of Object.values(t.slots ?? {})) {
    const defs = slot.type === 'list' ? Object.values(slot.fields) : [slot]
    for (const def of defs) {
      if (def.type !== 'image') continue
      for (const purpose of def.purpose) found.add(purpose)
      if (def.composition.includes('worn')) found.add('구도:worn')
    }
  }
  return [...found].sort().join(',')
}

/** 칸 값 — 카테고리 키, 그 카테고리의 제품군, 묶음 id, 그 카테고리의 컨셉 */
function lintValues(t: Template): CategoryViolation[] {
  const out: CategoryViolation[] = []
  const add = (detail: string) => out.push({ template: t.id, rule: 'category', detail })
  const categories = categoriesOf(t)
  const families = t.fit.productFamilies ?? []
  if (categories.length === 0) {
    if (families.length > 0) add('제품군을 지정하면 fit.categories도 필요')
    if (t.family) add('family는 카테고리 템플릿에만 쓴다')
    return out
  }
  for (const category of categories) {
    if (!PRODUCT_FAMILIES[category]) {
      add(`없는 카테고리: ${category}`)
      continue
    }
    if (!t.fit.concepts.some((id) => conceptById(id)?.categories.includes(category))) add(`fit.concepts에 ${category} 컨셉이 없음(컨셉 +3을 못 넘어 뽑히지 않는다)`)
  }
  for (const family of families) {
    if (!categories.some((category) => PRODUCT_FAMILIES[category]?.includes(family))) add(`지정한 카테고리의 제품군이 아님: ${family}`)
  }
  if (t.family !== undefined && !FAMILY_ID.test(t.family)) add(`family 형식: ${t.family}`)
  return out
}

/** 근거를 입력 글로만 싣는 섹션 — FAQ는 상품 사실로 답을 써서(selection-facts FAQ_FACT_FIELDS) 뺀다. 성분·원료는 입력 재료 이름만 싣는다(적용 K3 R-W8) */
export const INPUT_ONLY_SECTIONS: readonly string[] = ['review', 'certification', 'event_offer', 'perf_metric', 'ingredients', 'notice']

const isRequiredInput = (def: SlotDef) => def.required && (def.type === 'text' || def.type === 'list') && def.source === 'input'

/**
 * 근거 잠금 칸(R-W3) — 근거 입력이 있어야 그려진다. 카테고리 칸은 섹션이 요구하는 자료(SECTION_EVIDENCE)를 needs.evidence에 적는다(lintTemplate은 빈 값만 막는다).
 * 후기·인증·혜택·평점 칸은 필수 입력 칸이 있어야 하고, 사실을 싣는 글(facts > 0)은 입력만 쓴다 — 입력이 없으면 칸이 빠지고, 모델이 후기·인증·혜택·수치를 지어내지 않는다.
 * compare는 잠금 섹션이 아니다. 기존 제품과 나란히 두지 않고 우리 장점만 체크하는 칸은 evidence가 비어도 되고, 나란히 두는 칸은 lintTemplate이 compare_basis를 요구한다.
 */
export function lintEvidenceLock(t: Template): CategoryViolation[] {
  if (!isCategoryTemplate(t)) return []
  const out: CategoryViolation[] = []
  const add = (detail: string) => out.push({ template: t.id, rule: 'evidence', detail })
  const locks = sectionLocks(t.section)
  if (locks.length > 0 && !locks.some((lock) => (t.needs?.evidence ?? []).includes(lock))) {
    add(`${t.section} 칸은 needs.evidence에 ${locks.join(' 또는 ')} 필수(근거 입력이 있어야 그려진다)`)
  }
  if (!INPUT_ONLY_SECTIONS.includes(t.section)) return out
  const slots = Object.entries(t.slots ?? {})
  if (!slots.some(([, def]) => isRequiredInput(def))) add(`${t.section} 칸은 필수 입력 칸이 있어야 한다(입력이 없으면 칸이 빠진다)`)
  for (const [name, def] of slots) {
    const texts = def.type === 'text' ? [[name, def] as const] : def.type === 'list' ? Object.entries(def.fields).map(([field, f]) => [`${name}.${field}`, f] as const) : []
    for (const [field, d] of texts) {
      if (d.type === 'text' && d.facts > 0 && d.source !== 'input') add(`${field}: 근거 글은 입력만(source input) — 모델 글로 지어내지 않는다`)
    }
  }
  return out
}

/**
 * 같은 섹션의 모양 — 카테고리가 겹치는 템플릿끼리는 같은 페이지에 나올 수 있어 서명이 달라야 한다(조합이 달라도 겹치면 같다).
 * 공용과 서명이 같으면 사진 목적이 달라야 하고, 공용과 뼈대+글자 단계까지 같으면 사진 목적이 달라도 막는다(화면이 같다).
 * 공용과 화면 단계가 같아도 막되 알려진 목록의 짝은 통과시킨다(화면 단계 키는 사진 목적을 안 본다).
 */
function lintShapes(templates: readonly Template[], known: ReadonlySet<string>): CategoryViolation[] {
  const out: CategoryViolation[] = []
  const category = templates.filter(isCategoryTemplate)
  const common = templates.filter((t) => !isCategoryTemplate(t))
  category.forEach((t, i) => {
    if (SAME_SHAPE_ALLOWED.has(t.section)) return
    for (const other of category.slice(0, i)) {
      if (other.section !== t.section) continue
      const shared = categoriesOf(t).filter((c) => categoriesOf(other).includes(c))
      if (shared.length > 0 && shapeOf(other) === shapeOf(t)) out.push({ template: t.id, rule: 'signature', detail: `${other.id}와 카테고리 ${shared.join('·')}가 겹치는데 모양이 같음` })
      if (shared.length === 0 && flowOf(other) === flowOf(t) && purposesOf(other) === purposesOf(t)) {
        out.push({ template: t.id, rule: 'category', detail: `${other.id}와 흐름·사진 목적이 같음(키끼리 fit만 다른 복제)` })
      }
    }
    for (const base of common) {
      if (base.section !== t.section) continue
      if (skeletonKey(base.flow) === skeletonKey(t.flow)) {
        out.push({ template: t.id, rule: 'category', detail: `공용 ${base.id}와 뼈대·글자 단계가 같음(사진 목적만 달라도 화면이 같다)` })
      } else if (shapeOf(base) === shapeOf(t) && purposesOf(base) === purposesOf(t)) {
        out.push({ template: t.id, rule: 'category', detail: `공용 ${base.id}와 모양·사진 목적이 같음(fit만 다른 복제)` })
      } else if (screenOf(base) === screenOf(t) && !known.has(pairId(t.id, base.id))) {
        out.push({ template: t.id, rule: 'category', detail: `공용 ${base.id}와 화면 단계가 같음(${screenOf(t)})` })
      }
    }
  })
  return out
}

/** 알려진 목록 점검 — 더 안 걸리는 짝은 실패시켜 고친 칸이 목록에 남지 않게 한다. 일부 템플릿만 넣은 검사에서 빠진 짝은 묻지 않는다 */
function lintKnownList(templates: readonly Template[], known: ReadonlySet<string>): CategoryViolation[] {
  const ids = new Set(templates.map((t) => t.id))
  const found = new Set(screenDuplicates(templates).map((p) => pairId(p.cell, p.common)))
  const out: CategoryViolation[] = []
  for (const entry of known) {
    const [cell, common] = entry.split('|')
    if (ids.has(cell) && ids.has(common) && !found.has(entry)) out.push({ template: cell, rule: 'category', detail: `알려진 목록의 공용 ${common} 항목이 더 안 걸림(목록에서 뺀다)` })
  }
  return out
}

export interface ConceptCoverage {
  category: string
  section: string
  covered: number
  total: number
  missing: string[]
}

/**
 * 칸별 컨셉 덮기 보고(실패 아님) — 컨셉이 안 맞는 카테고리 템플릿은 공용 5개가 찬 컨셉에서 후보에 못 든다(A6 §348).
 * 키×섹션마다 fit.concepts 합이 그 카테고리의 컨셉을 얼마나 덮는지 낸다. 카테고리 템플릿이 없는 칸은 나오지 않는다.
 */
export function conceptCoverage(templates: readonly Template[]): ConceptCoverage[] {
  const out: ConceptCoverage[] = []
  const cells = new Map<string, { category: string; section: string; concepts: Set<string> }>()
  for (const t of templates.filter(isCategoryTemplate)) {
    for (const category of categoriesOf(t)) {
      const key = `${category}|${t.section}`
      const cell = cells.get(key) ?? { category, section: t.section, concepts: new Set<string>() }
      for (const concept of t.fit.concepts) cell.concepts.add(concept)
      cells.set(key, cell)
    }
  }
  for (const { category, section, concepts } of cells.values()) {
    const fitting = CONCEPTS.filter((c) => c.categories.includes(category)).map((c) => c.id)
    const missing = fitting.filter((id) => !concepts.has(id))
    out.push({ category, section, covered: fitting.length - missing.length, total: fitting.length, missing })
  }
  return out.sort((a, b) => a.category.localeCompare(b.category) || a.section.localeCompare(b.section))
}

export interface SkeletonGroup {
  key: string
  templates: string[]
}
export interface SkeletonReport {
  /** 같은 섹션 안에서 뼈대+글자 단계가 같은 공용 묶음 */
  withinSection: SkeletonGroup[]
  /** 섹션을 넘어 같은 공용 묶음 */
  acrossSections: SkeletonGroup[]
}

/** 공용 템플릿의 같은 뼈대 보고(실패 아님) — 공용은 지우지 않고 바꾸는 대상이라 막지 않고 수만 낸다 */
export function skeletonReport(templates: readonly Template[]): SkeletonReport {
  const groups = new Map<string, Template[]>()
  for (const t of templates.filter((x) => !isCategoryTemplate(x))) {
    const key = skeletonKey(t.flow)
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const withinSection: SkeletonGroup[] = []
  const acrossSections: SkeletonGroup[] = []
  for (const [key, list] of groups) {
    if (list.length < 2) continue
    const sections = new Set(list.map((t) => t.section))
    if (sections.size > 1) acrossSections.push({ key, templates: list.map((t) => t.id) })
    for (const section of sections) {
      const inSection = list.filter((t) => t.section === section)
      if (inSection.length > 1) withinSection.push({ key, templates: inSection.map((t) => t.id) })
    }
  }
  return { withinSection, acrossSections }
}

export interface ScreenPair {
  cell: string
  common: string
  section: string
  key: string
}

const pairId = (cell: string, common: string) => `${cell}|${common}`

/** 카테고리 칸과 같은 섹션 공용의 짝을 키 함수로 찾는다 */
function pairsBy(templates: readonly Template[], matches: (cell: Template, base: Template) => boolean): ScreenPair[] {
  const common = templates.filter((t) => !isCategoryTemplate(t))
  return templates
    .filter((cell) => isCategoryTemplate(cell) && !SAME_SHAPE_ALLOWED.has(cell.section))
    .flatMap((cell) => common.filter((base) => base.section === cell.section && matches(cell, base)).map((base) => ({ cell: cell.id, common: base.id, section: cell.section, key: screenOf(cell) })))
}

/** 공용과 화면 단계가 같은 카테고리 칸의 짝 — 알려진 목록의 정본이다 */
export function screenDuplicates(templates: readonly Template[]): ScreenPair[] {
  return pairsBy(templates, (cell, base) => screenOf(cell) === screenOf(base))
}

/** 블록은 같고 순서만 다른 짝(보고, 실패 아님) — 제목이 사진 위냐 아래냐는 칸마다 일부러 고른 차이일 수 있어 막지 않고 수만 낸다 */
export function screenOrderPairs(templates: readonly Template[]): ScreenPair[] {
  const sorted = (t: Template) => [...screenBlocksOf(t)].sort().join(',')
  return pairsBy(templates, (cell, base) => screenOf(cell) !== screenOf(base) && sorted(cell) === sorted(base))
}

export function lintCategoryTemplates(templates: readonly Template[], knownPairs: readonly string[] = screenKnown): CategoryViolation[] {
  const known = new Set(knownPairs)
  return [...templates.flatMap(lintValues), ...templates.flatMap(lintEvidenceLock), ...lintShapes(templates, known), ...lintKnownList(templates, known)]
}
