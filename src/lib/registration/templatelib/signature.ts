/**
 * 모양 서명 계산 — 흐름에서 사진 위치·열 수·정렬·용기를 읽는다(15_TEMPLATE_LINE §8). 작성자가 적은 값을 믿지 않고 이 값과 대조한다.
 * 같은 섹션 템플릿이 정말 다른 모양인지 보는 기준이고, 순서 풀이의 '같은 모양 3연속 금지'도 이 값을 본다. 순수·결정론.
 */

import { CONTENT_W, MARGIN } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import type { FlowNode, Signature, Template } from './template-types'

interface Found {
  columns: number
  images: Array<{ node: FlowNode; inRow: boolean; rowImages: number; repeatColumns: number; top: boolean }>
  containers: Set<Signature['container']>
  align: Signature['align'] | null
}

const CONTAINER_ORDER: Signature['container'][] = ['overlay', 'band', 'bubble', 'tile', 'table', 'card', 'plate']

const imagesIn = (nodes: readonly FlowNode[]): number =>
  nodes.filter((n) => n.kind === 'image' || n.kind === 'dimension').length

function scan(nodes: readonly FlowNode[], found: Found, ctx: { inRow: boolean; rowImages: number; repeatColumns: number; topFirst: boolean }) {
  nodes.forEach((node, i) => {
    switch (node.kind) {
      case 'text':
        if (!found.align) found.align = node.align === 'center' ? 'center' : 'left'
        break
      case 'image':
      case 'dimension':
        found.images.push({ node, inRow: ctx.inRow, rowImages: ctx.rowImages, repeatColumns: ctx.repeatColumns, top: ctx.topFirst && i === 0 })
        if (node.kind === 'image' && node.plate) found.containers.add('plate')
        // 반 띠(적용 K7-c 4a) — 섹션 위 절반을 덮는 풀폭 면이라 풀폭 판과 같은 띠로 센다
        if (node.kind === 'image' && node.half) found.containers.add('band')
        if (node.kind === 'image' && node.overlay) {
          found.containers.add('overlay')
          scan(node.overlay.nodes, found, { ...ctx, topFirst: false })
        }
        break
      case 'row': {
        found.columns = Math.max(found.columns, node.columns.length)
        const rowImages = node.columns.reduce((sum, c) => sum + imagesIn(c.nodes), 0)
        if (node.columns.some((c) => c.nodes.some((n) => n.kind === 'panel'))) found.containers.add('tile')
        for (const column of node.columns) scan(column.nodes, found, { ...ctx, inRow: true, rowImages, topFirst: false })
        break
      }
      case 'panel':
        if (node.bleed) found.containers.add('band')
        else if (node.radius === 'bubble') found.containers.add('bubble')
        else found.containers.add('card')
        scan(node.nodes, found, { ...ctx, topFirst: false })
        break
      case 'repeat':
        found.columns = Math.max(found.columns, node.columns ?? 1)
        if (node.rule) found.containers.add('table')
        // 층 띠(T1-85)는 내용 폭의 채운 상자를 쌓는다 — 카드와 같은 상자다
        if (node.layer) found.containers.add('card')
        scan(node.nodes, found, { ...ctx, repeatColumns: node.columns ?? 1, topFirst: false })
        break
      case 'divider':
        found.containers.add('table')
        break
      default:
        break
    }
  })
}

function photoOf(found: Found): Signature['photo'] {
  const first = found.images[0]
  if (!first) return 'none'
  if (found.images.some((img) => img.repeatColumns >= 2)) return 'grid'
  if (found.images.some((img) => img.inRow && img.rowImages >= 2)) return 'pair'
  if (found.images.some((img) => img.inRow)) return 'side'
  if (first.node.kind === 'image') {
    if (first.node.bleed) return first.top ? 'bleed-top' : 'bleed-bottom'
    const offsetBox = (first.node.x ?? MARGIN) !== MARGIN || (first.node.w ?? CONTENT_W) !== CONTENT_W
    if (first.node.plate || offsetBox) return 'offset'
  }
  return 'inset'
}

export function deriveSignature(t: Pick<Template, 'flow'>): Signature {
  const found: Found = { columns: 1, images: [], containers: new Set(), align: null }
  scan(t.flow, found, { inRow: false, rowImages: 0, repeatColumns: 1, topFirst: true })
  return {
    columns: Math.min(3, found.columns) as Signature['columns'],
    photo: photoOf(found),
    align: found.align ?? 'left',
    container: CONTAINER_ORDER.find((c) => found.containers.has(c)) ?? 'none',
  }
}

export const signatureKey = (s: Signature) => [s.columns, s.photo, s.align, s.container].join('|')
