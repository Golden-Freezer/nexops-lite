/**
 * 페이지 구성 지표(적용 K12·K3, 최종 보고 개선 #4·#6) — 한 페이지에 같은 뼈대가 몇 번 나오는지, 비교·체크·말풍선 부품과 원·아치 틀이 몇 곳인지 센다.
 * 뼈대는 검사기(lint-category skeletonKey)와 같은 키다. 큰 POINT 셋은 같은 머리에서 나오므로(오너 지시 11-01) 뼈대 반복에서 뺀다. 순수·결정론.
 */

import { skeletonKey } from './lint-category'
import { POINT_SECTION, type TemplateMeta } from './template-meta'
import type { FlowNode } from './template-types'

/**
 * 페이지당 부품 종류 — 비교(우리·기존 제품 나란히), 체크(체크·엑스 표식 목록), 말풍선(bubble 판), 원·아치 틀(사진 모양 상한, 적용 K3 T1-50·A4 #4).
 * 틀은 사진 칸 수가 아니라 섹션 수로 센다 — 원 셋 목록(circle-trio)도 한 곳이다
 */
export const PAGE_DEVICES = ['compare', 'check', 'bubble', 'frame'] as const
export type PageDevice = (typeof PAGE_DEVICES)[number]

type MixTemplate = Pick<TemplateMeta, 'id' | 'section' | 'flow'>

const flowOf = (t: MixTemplate) => (t.flow ?? []) as readonly FlowNode[]

function visit(nodes: readonly FlowNode[], seen: (node: FlowNode) => void) {
  for (const node of nodes) {
    seen(node)
    if (node.kind === 'row') for (const column of node.columns) visit(column.nodes, seen)
    else if (node.kind === 'panel' || node.kind === 'repeat') visit(node.nodes, seen)
    else if (node.kind === 'image' && node.overlay) visit(node.overlay.nodes, seen)
  }
}

/** 순서 풀이가 후보마다 여러 번 묻는다 — 템플릿 객체는 라이브러리에서 그대로라 객체로 기억한다 */
const deviceCache = new WeakMap<object, ReadonlySet<PageDevice>>()
const skeletonCache = new WeakMap<object, string | null>()

/** 이 템플릿이 쓰는 부품 — 비교 섹션이거나 비교 이름표가 있으면 비교, 체크·엑스 표식이 있으면 체크, bubble 판이 있으면 말풍선, 원·아치 틀 사진이 있으면 틀 */
export function devicesOf(t: MixTemplate): ReadonlySet<PageDevice> {
  const cached = deviceCache.get(t)
  if (cached) return cached
  const found = new Set<PageDevice>()
  if (t.section === 'compare') found.add('compare')
  visit(flowOf(t), (node) => {
    if (node.kind === 'label') found.add('compare')
    if (node.kind === 'mark' && (node.value === 'check' || node.value === 'cross')) found.add('check')
    if (node.kind === 'panel' && node.radius === 'bubble') found.add('bubble')
    if (node.kind === 'image' && (node.frame === 'circle' || node.frame === 'arch')) found.add('frame')
  })
  deviceCache.set(t, found)
  return found
}

/** 뼈대 키 — 큰 POINT와 흐름이 없는 메타데이터(시험용 가짜)는 null(세지 않는다) */
export function skeletonOf(t: MixTemplate): string | null {
  if (skeletonCache.has(t)) return skeletonCache.get(t) ?? null
  const key = t.section === POINT_SECTION || flowOf(t).length === 0 ? null : skeletonKey(flowOf(t))
  skeletonCache.set(t, key)
  return key
}

export interface PageMix {
  /** 같은 뼈대가 가장 많이 나온 횟수(POINT 뺌, 1이면 반복 없음) */
  skeletonMax: number
  /** 처음 뒤에 다시 나온 수의 합 */
  skeletonRepeats: number
  /** 바로 앞과 뼈대가 같은 이웃 수 */
  skeletonAdjacent: number
  /** 부품마다 그 부품을 쓴 섹션 수 */
  devices: Record<PageDevice, number>
}

export function pageMix(templates: readonly MixTemplate[]): PageMix {
  const counts = new Map<string, number>()
  let adjacent = 0
  let prev: string | null = null
  for (const t of templates) {
    const key = skeletonOf(t)
    if (key !== null) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
      if (key === prev) adjacent++
    }
    prev = key
  }
  const devices = Object.fromEntries(PAGE_DEVICES.map((d) => [d, 0])) as Record<PageDevice, number>
  for (const t of templates) for (const d of devicesOf(t)) devices[d]++
  const values = [...counts.values()]
  return {
    skeletonMax: values.length ? Math.max(...values) : 0,
    skeletonRepeats: values.reduce((sum, n) => sum + n - 1, 0),
    skeletonAdjacent: adjacent,
    devices,
  }
}
