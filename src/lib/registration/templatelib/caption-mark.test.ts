/**
 * K4 작은 묶음 — CAPTION 수준(T1-09), 후기 작성자 CAPTION, mark 경고 값·색 역할 onFill(T1-67, 연구 A5 #13·규격 3절).
 * CAPTION은 예전에 본문 수준이라 빌더 판독 하한(본문 45)으로 올라가 줄 간격 규칙(45는 1.7)에 걸렸다 — caption 수준이면 36 그대로다
 */

import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { surfaceOf } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import { K_TYPE, renderTemplate } from './engine'
import { COLORS, ctxOf, templateOf, textSlot } from './engine.fixture'
import { TEMPLATES } from './library'
import { lintTemplate } from './lint'
import { sampleContext, sampleSlots } from './sample'
import { COLOR_ROLES, MARK_VALUES, type FlowNode, type Template } from './template-types'

const AUTHOR_SLOTS = ['name', 'topName']

function textNodes(nodes: readonly FlowNode[], out: Extract<FlowNode, { kind: 'text' }>[] = []) {
  for (const node of nodes) {
    if (node.kind === 'text') out.push(node)
    else if (node.kind === 'panel' || node.kind === 'repeat') textNodes(node.nodes, out)
    else if (node.kind === 'row') for (const column of node.columns) textNodes(column.nodes, out)
    else if (node.kind === 'image' && node.overlay) textNodes(node.overlay.nodes, out)
  }
  return out
}

const markTemplate = (value: string): Template =>
  templateOf({ flow: [{ kind: 'mark', value } as FlowNode, { kind: 'text', slot: 'body', token: 'BODY' }], slots: { body: textSlot({ required: true }) } })

describe('CAPTION 토큰', () => {
  it('caption 수준이다 — 본문 수준이면 빌더가 45로 올린다', () => {
    expect(K_TYPE.CAPTION).toMatchObject({ size: 36, weight: 500, lineHeight: 1.5, level: 'caption' })
  })

  it('후기 섹션의 작성자 글(name·topName)은 모두 CAPTION이다', () => {
    const reviews = TEMPLATES.filter((t) => t.section === 'review')
    const authors = reviews.flatMap((t) => textNodes(t.flow).filter((n) => AUTHOR_SLOTS.includes(n.slot)).map((n) => [t.id, n.token]))
    expect(authors.length).toBeGreaterThanOrEqual(17)
    expect(authors.filter(([, token]) => token !== 'CAPTION')).toEqual([])
  })

  it('후기 템플릿에서 작성자 글이 36·줄 간격 1.5·caption 수준으로 그려진다(45로 올라가지 않음)', () => {
    for (const t of TEMPLATES.filter((x) => x.section === 'review')) {
      const out = renderTemplate(t, sampleSlots(t, { mode: 'full' }), sampleContext())!
      const names = out.elements.filter((e) => e.name === 'designcut-name' || e.name === 'designcut-topName')
      expect(names.length, t.id).toBeGreaterThan(0)
      for (const el of names) expect([el.textProps?.fontSize, el.textProps?.lineHeight, el.textProps?.typoLevel], t.id).toEqual([36, 1.5, 'caption'])
    }
  })

  it('CAPTION을 쓴 후기 템플릿은 전수 검사 위반이 없다', () => {
    const reviews = TEMPLATES.filter((t) => t.section === 'review')
    expect(reviews.flatMap((t) => lintTemplate(t))).toEqual([])
  })
})

describe('mark 경고 값', () => {
  it('값 목록에 warn이 있다', () => {
    expect(MARK_VALUES).toContain('warn')
  })

  it.each(['W', 'N', 'T', 'D'] as const)('바탕 %s: 테두리 상자와 느낌표를 그리고 색은 바탕 대비 3 이상이다', (bg) => {
    const out = renderTemplate(markTemplate('warn'), { body: '물에 닿지 않게 보관해 주세요' }, ctxOf({ bg }))!
    const warn = out.elements.find((e) => e.name === 'designcut-mark-warn')!
    expect(warn).toBeDefined()
    expect(out.elements.some((e) => e.name === 'designcut-mark-cross')).toBe(false)
    const ink = /stroke="(#[0-9A-Fa-f]{6})"/.exec(warn.svgProps?.svgString ?? '')?.[1]
    expect(ink).toBeDefined()
    const fill = surfaceOf(bg, COLORS).fill
    expect(contrastRatio(parseColor(ink!)!, parseColor(fill)!)).toBeGreaterThanOrEqual(3)
    const box = out.elements.find((e) => e.name === 'designcut-mark')!
    expect(box.shapeProps?.fill).toBe('transparent')
    expect(box.shapeProps?.stroke).toBe(ink)
  })

  it('전수 검사가 모르는 표식 값을 막고 warn은 받는다', () => {
    expect(lintTemplate(markTemplate('warn')).filter((v) => v.detail.includes('표식 값'))).toEqual([])
    expect(lintTemplate(markTemplate('alert')).map((v) => v.detail)).toContain('없는 표식 값: alert')
  })
})

describe('색 역할 onFill(규격 3절)', () => {
  const colorTemplate = (color: string): Template =>
    templateOf({ flow: [{ kind: 'panel', fill: 'A', bleed: true, nodes: [{ kind: 'text', slot: 'body', token: 'H2', color } as FlowNode] }], slots: { body: textSlot({ required: true, maxChars: 12, maxLines: 2 }) } })

  it('역할 목록에 onFill이 있다', () => {
    expect(COLOR_ROLES).toEqual(['text', 'heading', 'accent', 'onFill'])
  })

  it('onFill은 강조색 상자 위 제목을 그 면의 글자색으로 그린다(text와 같고, 상자 색과 대비 4.5 이상)', () => {
    const out = (color: string) => renderTemplate(colorTemplate(color), { body: '오늘만 무료 배송' }, ctxOf())!.elements
    const colorOfBody = (color: string) => out(color).find((e) => e.name === 'designcut-body')!.textProps!.color!
    const fill = out('onFill').find((e) => e.name === 'designcut-panel')!.shapeProps!.fill!
    expect(colorOfBody('onFill')).toBe(colorOfBody('text'))
    expect(contrastRatio(parseColor(colorOfBody('onFill'))!, parseColor(fill)!)).toBeGreaterThanOrEqual(4.5)
  })

  it('전수 검사가 모르는 색 역할을 막고 onFill은 받는다', () => {
    expect(lintTemplate(colorTemplate('onFill')).filter((v) => v.detail.includes('색 역할'))).toEqual([])
    expect(lintTemplate(colorTemplate('onfill')).map((v) => v.detail)).toContain('body: 없는 색 역할 onfill')
  })

  it('라이브러리의 onFill은 모두 강조색 상자 안에 있다', () => {
    const uses: string[] = []
    const walk = (nodes: readonly FlowNode[], fill: string | null, id: string) => {
      for (const node of nodes) {
        if (node.kind === 'text' && node.color === 'onFill') uses.push(`${id}:${fill}`)
        if (node.kind === 'panel') walk(node.nodes, node.fill, id)
        else if (node.kind === 'repeat') walk(node.nodes, fill, id)
        else if (node.kind === 'row') for (const column of node.columns) walk(column.nodes, fill, id)
      }
    }
    for (const t of TEMPLATES) walk(t.flow, null, t.id)
    expect(uses.length).toBeGreaterThan(0)
    expect(uses.filter((u) => !u.endsWith(':A'))).toEqual([])
  })
})
