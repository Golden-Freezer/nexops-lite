/**
 * 말풍선 꼬리(적용 T1-66 K, 연구 A5 6.8) — 사람 말 칸(고민·후기·질문)의 bubble 판만 한 모서리를 작게(8) 그려 꼬리로 읽히게 한다.
 * speechBubble 도형은 늘어나며 꼬리가 찌그러져 쓰지 않는다. 편집기·내보내기는 shapeProps.borderRadii [왼위, 오위, 오아래, 왼아래]를 그린다
 */

import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { reflowSectionLayout } from '@/lib/registration/editor/utils/reflowSectionLayout'
import { renderTemplate } from './engine'
import { ctxOf, templateOf, textSlot } from './engine.fixture'
import { TEMPLATES } from './library'
import { sampleContext, sampleSlots } from './sample'
import type { FlowNode, PanelNode, TailCorner, Template } from './template-types'

/** 사람 말인 bubble 칸 — 이 8개만 꼬리를 단다(혜택·마무리 같은 말이 아닌 글에는 달지 않는다) */
const SPEECH = ['faq.bubbles', 'faq.center-bubble', 'hidden_page.qa-bubble', 'problem_empathy.bubble-bleed', 'problem_raise.bubbles', 'problem_raise.bubbles-answer', 'problem_raise.bubble-bleed', 'review.bubbles']
const BUBBLE_R = ctxOf().radius.bubble

const panelTemplate = (over: Partial<PanelNode> = {}): Template =>
  templateOf({ flow: [{ kind: 'panel', fill: 'C', radius: 'bubble', nodes: [{ kind: 'text', slot: 'body', token: 'BODY' }], ...over }], slots: { body: textSlot({ required: true }) } })
const panelOf = (t: Template, ctx = ctxOf()) => renderTemplate(t, { body: '손이 편해서 매일 써요' }, ctx)!.elements.find((e) => e.name === 'designcut-panel')!

function panels(nodes: readonly FlowNode[], out: PanelNode[] = []): PanelNode[] {
  for (const node of nodes) {
    if (node.kind === 'panel') {
      out.push(node)
      panels(node.nodes, out)
    } else if (node.kind === 'repeat') panels(node.nodes, out)
    else if (node.kind === 'row') for (const column of node.columns) panels(column.nodes, out)
    else if (node.kind === 'image' && node.overlay) panels(node.overlay.nodes, out)
  }
  return out
}

describe('엔진 — 꼬리 모서리', () => {
  it.each<[TailCorner, number]>([
    ['tl', 0],
    ['tr', 1],
    ['br', 2],
    ['bl', 3],
  ])('%s → 그 모서리만 8, 나머지는 말풍선 반경', (tail, index) => {
    const shape = panelOf(panelTemplate({ tail })).shapeProps!
    const want = [BUBBLE_R, BUBBLE_R, BUBBLE_R, BUBBLE_R]
    want[index] = 8
    expect(shape.borderRadii).toEqual(want)
    expect(shape.borderRadius).toBeUndefined()
    expect(shape.shapeType).toBe('roundedRect')
  })

  it('꼬리가 없으면 지금처럼 네 모서리 같은 반경이다', () => {
    const shape = panelOf(panelTemplate()).shapeProps!
    expect(shape.borderRadius).toBe(BUBBLE_R)
    expect(shape.borderRadii).toBeUndefined()
  })

  it('반경이 8 이하(각진 컨셉)거나 풀폭 띠면 꼬리를 그리지 않는다', () => {
    const sharp = panelOf(panelTemplate({ tail: 'bl' }), ctxOf({ radius: { capsule: 4, card: 4, bubble: 4, chip: 4 } })).shapeProps!
    expect(sharp.borderRadii).toBeUndefined()
    expect(sharp.borderRadius).toBe(4)
    const bleed = panelOf(panelTemplate({ tail: 'bl', bleed: true })).shapeProps!
    expect(bleed.borderRadii).toBeUndefined()
    expect(bleed.shapeType).toBe('rect')
  })

  it('리플로우 뒤에도 모서리 모양이 남는다(높이만 바뀐다)', () => {
    const out = renderTemplate(panelTemplate({ tail: 'bl' }), { body: '손이 편해서 매일 써요' }, ctxOf())!
    const section = { id: 's', sectionType: 'review', groupType: 'modules', order: 0, isVisible: true, layoutId: 'designcut_k_x', canvas: { width: 860, height: out.height, backgroundColor: out.background }, elements: out.elements } as unknown as CanvasSection
    for (const el of section.elements) if (el.type === 'text') el.measuredHeight = 400
    reflowSectionLayout(section)
    const shape = section.elements.find((e) => e.name === 'designcut-panel')!.shapeProps!
    expect(shape.borderRadii).toEqual([BUBBLE_R, BUBBLE_R, BUBBLE_R, 8])
  })
})

describe('라이브러리 — 사람 말 칸에만', () => {
  it('꼬리는 bubble 판에만 있고, 사람 말 8개 칸의 bubble 판은 모두 꼬리가 있다', () => {
    let tails = 0
    for (const t of TEMPLATES) {
      const bubbles = panels(t.flow as readonly FlowNode[]).filter((p) => p.radius === 'bubble')
      for (const p of panels(t.flow as readonly FlowNode[])) if (p.tail) expect(p.radius, t.id).toBe('bubble')
      if (SPEECH.includes(t.id)) {
        expect(bubbles.length, t.id).toBeGreaterThan(0)
        expect(bubbles.every((p) => p.tail), t.id).toBe(true)
      } else expect(bubbles.some((p) => p.tail), t.id).toBe(false)
      tails += bubbles.filter((p) => p.tail).length
    }
    expect(tails).toBe(8)
  })

  it.each(SPEECH)('%s — 표본 렌더의 말풍선 판이 한 모서리만 작다', (id) => {
    const t = TEMPLATES.find((x) => x.id === id)!
    const out = renderTemplate(t, sampleSlots(t, { mode: 'full' }), sampleContext())!
    const shapes = out.elements.filter((e) => e.name === 'designcut-panel' && e.shapeProps?.borderRadii)
    expect(shapes.length, id).toBeGreaterThan(0)
    for (const s of shapes) expect(s.shapeProps!.borderRadii!.filter((r) => r === 8)).toHaveLength(1)
  })
})
