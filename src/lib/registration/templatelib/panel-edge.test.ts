/**
 * 곡선 판(적용 K1 T1-33·T2-46) — 풀폭 띠 곡선 경계(덮개)·윤곽선 카드·좌우 번갈아 반복. 높이는 그대로이고, 덮개 색은 맞닿은 같은 섹션 바탕이며,
 * 섹션 끝 쪽은 곧은 가장자리다(통합 22:3x 조건). LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { reflowSectionLayout } from '@/lib/registration/editor/utils/reflowSectionLayout'
import { breatheKSeams } from '@/lib/registration/editor/utils/sectionConverter/designCut/k-breath'
import { surfaceOf } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import { renderTemplate } from './engine'
import { COLORS, ctxOf, imageSlot, templateOf, textSlot } from './engine.fixture'
import { TEMPLATES, templateById } from './library'
import { lintTemplate, lintTemplateLibrary } from './lint'
import { PANEL_EDGE, PANEL_EDGE_NAME, panelEdgeSvg } from './panel-edge'
import { sampleContext, sampleSlots } from './sample'
import type { FlowNode, PanelEdge, PanelNode, RepeatNode, Template } from './template-types'

const EDGED: Record<string, PanelEdge> = {
  'key_message.band-bleed': { side: 'bottom', shape: 'arc' },
  'key_message.photo-accent': { side: 'top', shape: 'slant' },
  'main_cut.band-left': { side: 'bottom', shape: 'slant' },
  // wave는 라이브러리 1칸까지 — 계획 484쪽에서 0번 뽑히는 칸에 둬 페이지 영향이 없다(통합 22:3x 'wave는 페이지 한 번')
  'concept_desc.photo-light-band': { side: 'top', shape: 'wave' },
}

const render = (t: Template, ctx = sampleContext()) => renderTemplate(t, sampleSlots(t, { mode: 'full' }), ctx)!
const sectionOf = (t: Template, out = render(t)): CanvasSection =>
  ({ id: t.id, sectionType: t.section, groupType: 'modules', order: 0, isVisible: true, layoutId: `designcut_k_${t.id}`, canvas: { width: 860, height: out.height, backgroundColor: out.background }, elements: out.elements }) as unknown as CanvasSection
const strip = (t: Template): Template => ({ ...t, flow: t.flow.map((n) => (n.kind === 'panel' ? { ...n, edge: undefined } : n)) as FlowNode[] })
const bandOf = (els: readonly CanvasElement[]) => els.find((e) => e.name === 'designcut-panel' && e.transform.width === 860)!
const coverOf = (els: readonly CanvasElement[]) => els.find((e) => e.name === PANEL_EDGE_NAME)

describe('덮개 SVG', () => {
  it('아래쪽은 곡선 아래를, 위쪽은 뒤집어 곡선 위를 칠한다 — 곡선 깊이 64 + 띠 밖 내민 4, 세 변은 상자 밖 4까지 칠해 잘린다', () => {
    const arc = panelEdgeSvg({ side: 'bottom', shape: 'arc' }, '#FFFFFF', 860)
    expect(arc).toContain('viewBox="0 0 860 68" preserveAspectRatio="none"')
    expect(arc).toContain('overflow="hidden"')
    expect(arc).toContain('M-4 0L0 0Q430 128 860 0L864 0V72H-4V0Z')
    expect(arc).toContain('fill="#FFFFFF"')
    expect(arc).not.toContain('scale(1 -1)')
    expect(panelEdgeSvg({ side: 'top', shape: 'slant' }, '#000', 860)).toContain('M-4 0L0 0L860 64L864 64V72H-4V0Z" fill="#000" transform="translate(0 68) scale(1 -1)"')
    expect(panelEdgeSvg({ side: 'bottom', shape: 'wave' }, '#000', 860)).toMatch(/^.*M-4 32L0 32C.*S.*L864 32V72H-4V32Z/)
    expect(PANEL_EDGE.overhang).toBe(4)
  })
})

describe('엔진 — 곡선 경계', () => {
  it.each(Object.entries(EDGED))('%s — 사진 쪽 띠 여백 안에 섹션 바탕색 덮개, 높이·요소 위치는 덮개 없을 때와 같다', (id, edge) => {
    const t = templateById(id)!
    for (const bg of t.surfaces) {
      const ctx = { ...sampleContext(), bg }
      const out = render(t, ctx)
      const plain = render(strip(t), ctx)
      expect(out.height).toBe(plain.height)
      const band = bandOf(out.elements)
      const cover = coverOf(out.elements)!
      expect(cover, `${id} ${bg}`).toBeDefined()
      expect(cover.transform).toMatchObject({ x: 0, width: 860, height: PANEL_EDGE.depth + PANEL_EDGE.overhang })
      // 띠 안쪽 깊이 64 + 간격 쪽으로 내민 4 — 띠 경계 줄이 덮개 안쪽이라 실선이 비치지 않는다
      const want = edge.side === 'top' ? band.transform.y - PANEL_EDGE.overhang : band.transform.y + band.transform.height - PANEL_EDGE.depth
      expect(cover.transform.y).toBe(want)
      expect(cover.overhang).toBe(true)
      expect(cover.svgProps!.svgString).toContain(`fill="${surfaceOf(bg, COLORS).fill}"`)
      // 띠 상자 식구 — 글이 늘면 함께 움직인다
      expect(band.containerOf).toContain(cover.id)
      // 곡선(띠 안쪽 깊이)은 글과 겹치지 않는다(여백 − 깊이 ≥ 48)
      const curveEnd = edge.side === 'top' ? band.transform.y + PANEL_EDGE.depth : band.transform.y + band.transform.height - PANEL_EDGE.depth
      for (const text of out.elements.filter((e) => e.type === 'text' && band.containerOf!.includes(e.id))) {
        const gap = edge.side === 'top' ? text.transform.y - curveEnd : curveEnd - (text.transform.y + text.transform.height)
        expect(gap).toBeGreaterThanOrEqual(PANEL_EDGE.minClear)
      }
      // 덮개 말고는 같다
      expect(out.elements.filter((e) => e.name !== PANEL_EDGE_NAME).map((e) => [e.name, e.transform.y, e.transform.height])).toEqual(
        plain.elements.map((e) => [e.name, e.transform.y, e.transform.height])
      )
    }
  })

  it('그쪽이 섹션 끝이면(이웃 섹션 바탕을 모름) 덮개 없이 곧은 가장자리다', () => {
    const band: PanelNode = { kind: 'panel', fill: 'D', bleed: true, gapAfter: 'blockGap', edge: { side: 'bottom', shape: 'arc' }, nodes: [{ kind: 'text', slot: 'headline', token: 'H1' }] }
    const t = templateOf({ flow: [band, { kind: 'image', slot: 'photo', bleed: true }], slots: { headline: textSlot({ required: true }), photo: imageSlot() } })
    const ctx = ctxOf()
    expect(coverOf(renderTemplate(t, { headline: '가볍게 들고 나가요', photo: 'p' }, ctx)!.elements)).toBeDefined()
    // 사진이 비면 띠가 섹션 끝에 닿는다
    expect(coverOf(renderTemplate(t, { headline: '가볍게 들고 나가요' }, ctx)!.elements)).toBeUndefined()
    const top = templateOf({ flow: [{ ...band, edge: { side: 'top', shape: 'arc' } }], slots: { headline: textSlot({ required: true }) } })
    expect(coverOf(renderTemplate(top, { headline: '가볍게 들고 나가요' }, ctx)!.elements)).toBeUndefined()
  })

  it('리플로우로 띠 글이 늘어도 아래 덮개는 띠 바닥을 4 넘겨 붙어 내려가고, 띠는 내민 덮개만큼 커지지 않는다(아래 여백 그대로)', () => {
    const t = templateById('key_message.band-bleed')!
    const section = sectionOf(t)
    const before = bandOf(section.elements)
    const padBefore = before.transform.y + before.transform.height
    const texts = section.elements.filter((e) => e.type === 'text' && before.containerOf!.includes(e.id))
    for (const el of texts) el.measuredHeight = el.transform.height + 60
    reflowSectionLayout(section)
    const band = bandOf(section.elements)
    const cover = coverOf(section.elements)!
    expect(cover.transform.y + cover.transform.height).toBe(band.transform.y + band.transform.height + PANEL_EDGE.overhang)
    expect(band.transform.y + band.transform.height).toBe(padBefore + 60 * texts.length)
    // 한 번 더 돌려도 그대로다(멱등)
    reflowSectionLayout(section)
    expect(bandOf(section.elements).transform.y + bandOf(section.elements).transform.height).toBe(padBefore + 60 * texts.length)
    const last = Math.max(...texts.map((e) => e.transform.y + e.transform.height))
    expect(cover.transform.y - last).toBe(t.spacing.bottom - PANEL_EDGE.depth)
  })

  it('#597 여백 호흡 — 덮개가 있어도 띠·사진이 끝에 닿은 쪽 판정(bottomFlush·topFlush)과 경계 결과가 같다', () => {
    const next = TEMPLATES.find((x) => x.id === 'hidden_page.side-rows')!
    for (const id of Object.keys(EDGED)) {
      const t = templateById(id)!
      for (const pair of [
        [t, next],
        [next, t],
      ]) {
        const withEdge = breatheKSeams(pair.map((x) => sectionOf(x)))
        const without = breatheKSeams(pair.map((x) => (x === t ? sectionOf(t, render(strip(t))) : sectionOf(x))))
        expect(withEdge.map((s) => s.canvas.height), id).toEqual(without.map((s) => s.canvas.height))
        expect(withEdge.map((s) => bandOrFirst(s)), id).toEqual(without.map((s) => bandOrFirst(s)))
      }
    }
  })
})
const bandOrFirst = (s: CanvasSection) => Math.min(...s.elements.map((e) => e.transform.y))

describe('엔진 — 윤곽선 카드', () => {
  it('event_offer.box-left — 채움 없이 선 2px, 글은 바깥 바탕 글자색, 높이는 채운 카드와 같다', () => {
    const t = templateById('event_offer.box-left')!
    for (const bg of t.surfaces) {
      const ctx = { ...sampleContext(), bg }
      const out = render(t, ctx)
      const card = out.elements.find((e) => e.name === 'designcut-panel')!
      expect(card.shapeProps).toMatchObject({ fill: 'transparent', strokeWidth: 2 })
      expect(card.shapeProps!.stroke).toBeTruthy()
      // 채움이 없어 글은 섹션 바탕 위에 선다 — 그 바탕에서 본문 대비 4.5를 지킨다
      const surf = surfaceOf(bg, COLORS)
      for (const text of out.elements.filter((e) => e.type === 'text')) {
        expect(contrastRatio(parseColor(text.textProps!.color)!, parseColor(surf.fill)!)).toBeGreaterThanOrEqual(4.5)
      }
      const filled = render({ ...t, flow: t.flow.map((n) => (n.kind === 'panel' ? { ...n, outline: undefined } : n)) as FlowNode[] }, ctx)
      expect(out.height).toBe(filled.height)
    }
  })
})

describe('엔진 — 좌우 번갈아', () => {
  // sub_div.item-rows가 아닌 이유: sub_div에는 이미 사진·글 지그재그(sub_div.zigzag)가 있어 같은 섹션에 같은 화면이 된다
  it('hidden_page.side-rows — 첫 항목은 사진 오른쪽, 둘째만 왼쪽, 셋째는 다시 오른쪽, 높이·글 폭은 그대로다', () => {
    const t = templateById('hidden_page.side-rows')!
    const slots = sampleSlots(t, { mode: 'full' })
    const items = (slots.items as Array<Record<string, string>>).slice(0, 3)
    expect(items.length).toBe(3)
    const out = renderTemplate(t, { ...slots, items }, sampleContext())!
    const photos = out.elements.filter((e) => e.type === 'framed-image' || e.type === 'image')
    const titles = out.elements.filter((e) => e.name === 'designcut-title')
    expect(photos.map((p, i) => p.transform.x < titles[i].transform.x)).toEqual([false, true, false])
    const repeat = t.flow.find((n): n is RepeatNode => n.kind === 'repeat')!
    const straight = renderTemplate({ ...t, flow: t.flow.map((n) => (n === repeat ? { ...repeat, alternate: undefined } : n)) as FlowNode[] }, { ...slots, items }, sampleContext())!
    expect(out.height).toBe(straight.height)
    expect(titles.map((e) => e.transform.width)).toEqual(straight.elements.filter((e) => e.name === 'designcut-title').map((e) => e.transform.width))
  })
})

describe('린트', () => {
  const rules = (t: Template) => lintTemplate(t).map((v) => v.detail)
  const band = (over: Partial<PanelNode>): PanelNode => ({ kind: 'panel', fill: 'D', bleed: true, gapAfter: 'blockGap', nodes: [{ kind: 'text', slot: 'headline', token: 'H1' }], ...over })
  const photo: FlowNode = { kind: 'image', slot: 'photo', bleed: true }
  const of = (flow: FlowNode[]) => templateOf({ flow, slots: { headline: textSlot({ required: true }), photo: imageSlot() } })

  it('곡선 경계는 풀폭 띠의 같은 섹션 간격 쪽에만, 띠 여백에서 글까지 48을 남긴다', () => {
    expect(rules(of([band({ edge: { side: 'bottom', shape: 'arc' } }), photo])).filter((d) => d.includes('곡선 경계'))).toEqual([])
    expect(rules(of([band({ bleed: undefined, edge: { side: 'bottom', shape: 'arc' } }), photo]))).toContain('edge(곡선 경계)는 풀폭 띠(bleed)에만')
    expect(rules(of([photo, band({ edge: { side: 'bottom', shape: 'arc' } })]))).toContain('곡선 경계 bottom가 흐름 끝이라 늘 섹션 끝(그리지 않는다)')
    expect(rules(of([band({ gapAfter: undefined, edge: { side: 'bottom', shape: 'arc' } }), photo]))).toContain('곡선 경계 bottom 쪽에 섹션 바탕 간격(gapAfter)이 없음')
    expect(rules(of([band({ pad: 'itemGap', edge: { side: 'bottom', shape: 'arc' } }), photo])).some((d) => d.startsWith('곡선 경계 깊이'))).toBe(true)
    expect(rules(of([photo, band({ edge: { side: 'top', shape: 'arc' } })])).filter((d) => d.includes('곡선 경계'))).toContain('곡선 경계 top 쪽에 섹션 바탕 간격(gapAfter)이 없음')
  })

  it('윤곽선은 카드에만, 번갈아는 한 줄 반복의 2칸 가로 칸 항목에만', () => {
    expect(rules(of([band({ outline: true })]))).toContain('outline(윤곽선)은 카드에만 — 풀폭 띠는 바탕을 덮는 면이다')
    const list = (over: Partial<RepeatNode>): Template =>
      templateOf({
        flow: [{ kind: 'repeat', slot: 'items', nodes: [{ kind: 'row', columns: [{ w: 336, nodes: [{ kind: 'image', slot: 'photo' }] }, { w: 380, nodes: [{ kind: 'text', slot: 'title', token: 'H3' }] }] }], ...over }],
        slots: { items: { type: 'list', required: true, min: 2, max: 4, fields: { photo: imageSlot(), title: textSlot() } } },
      })
    const msg = '좌우 번갈아(alternate)는 한 줄 반복의 2칸 가로 칸 항목에만(행 높이 맞춤과 함께 쓰지 않는다)'
    expect(rules(list({ alternate: true }))).not.toContain(msg)
    expect(rules(list({ alternate: true, columns: 2 }))).toContain(msg)
  })

  // 전수 린트 위반 0은 lint.test.ts가 라이브러리 전체로 본다(여기서 다시 돌리면 5초를 넘는다)
  it('wave는 라이브러리에서 POINT 아닌 칸 하나까지(페이지 한 번)', () => {
    const wave = (id: string, section: Template['section'] = 'key_message'): Template => ({
      ...templateById('key_message.band-bleed')!,
      id,
      section,
      flow: templateById('key_message.band-bleed')!.flow.map((n) => (n.kind === 'panel' ? { ...n, edge: { side: 'bottom', shape: 'wave' } } : n)) as FlowNode[],
    })
    const waveDetails = (list: Template[]) => lintTemplateLibrary(list).violations.filter((v) => v.detail.startsWith('wave'))
    expect(waveDetails([wave('key_message.w1')])).toEqual([])
    expect(waveDetails([wave('key_message.w1'), wave('key_message.w2')])).toHaveLength(2)
    expect(waveDetails([wave('point_div.w1', 'point_div')])).toHaveLength(1)
  })

  it('적용 칸 — 곡선 4칸·윤곽선 2칸(K7-c 묶음 2 sub_div.outline-pair 더함)·번갈아 1칸만', () => {
    const found = { edge: [] as string[], outline: [] as string[], alternate: [] as string[] }
    const visit = (id: string, nodes: readonly FlowNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'panel' && n.edge) found.edge.push(id)
        if (n.kind === 'panel' && n.outline) found.outline.push(id)
        if (n.kind === 'repeat' && n.alternate) found.alternate.push(id)
        if (n.kind === 'panel' || n.kind === 'repeat') visit(id, n.nodes)
        if (n.kind === 'row') for (const c of n.columns) visit(id, c.nodes)
      }
    }
    for (const t of TEMPLATES) visit(t.id, t.flow as readonly FlowNode[])
    expect(found.edge.sort()).toEqual(Object.keys(EDGED).sort())
    for (const [id, edge] of Object.entries(EDGED)) expect((templateById(id)!.flow.find((n) => n.kind === 'panel') as PanelNode).edge).toEqual(edge)
    expect(found.outline.sort()).toEqual(['event_offer.box-left', 'sub_div.outline-pair'])
    expect(found.alternate).toEqual(['hidden_page.side-rows'])
    // 번갈아 칸이 든 섹션에 이미 지그재그 칸이 없다(같은 화면 두 칸 방지)
    const zigzag = (t: Template) => {
      const sides = t.flow.filter((n) => n.kind === 'row').map((r) => (r as Extract<FlowNode, { kind: 'row' }>).columns.findIndex((c) => c.nodes.some((n) => n.kind === 'image')))
      return sides.includes(0) && sides.some((i) => i > 0)
    }
    expect(TEMPLATES.filter((t) => t.section === 'hidden_page' && zigzag(t)).map((t) => t.id)).toEqual([])
  })
})
