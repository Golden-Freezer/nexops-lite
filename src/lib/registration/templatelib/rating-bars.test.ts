/**
 * 별점 분포 막대(적용 K7-b T1-69·T2-19) — 자사 리뷰 파일 rating_counts 원본만 쓰는지, 합계 문턱(5건) 아래면 칸이 빠지는지,
 * 막대 폭이 비율대로인지(0%는 채움 없음·100%는 트랙 끝까지), 린트가 자리·개수·칸 모양을 잡는지 본다. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { reflowSectionLayout } from '@/lib/registration/editor/utils/reflowSectionLayout'
import type { PdpSpecSheet } from '../pdp-state'
import { BARS, BARS_H, renderTemplate } from './engine'
import { ratingBarItems, requiredInputsFit, type LineInputs } from './input-values'
import { TEMPLATES, templateById } from './library'
import { lintTemplate } from './lint'
import { sampleContext, sampleSlots } from './sample'
import { RATING_BARS_INPUT, RATING_BARS_MIN_TOTAL, type FlowNode, type ListSlot, type SlotItem, type Template } from './template-types'

const NEW_CELLS = ['perf_metric.score-bars', 'review.bars-quotes']
const own = (counts: Record<string, unknown>) => ({ reviewFiles: { own: { stats: { rating_counts: counts } } } }) as unknown as PdpSpecSheet
const CARD = (text: string) => ({ text, author: '김**', rating: 5 })
/** 평점·후기 수·후기 글은 다 있는 상품 — 분포만 바꿔 본다 */
const inputs = (counts?: Record<string, unknown>): LineInputs => ({
  spec: { rating: 4.8, reviewCount: 120, ...(counts ? own(counts) : {}) } as unknown as PdpSpecSheet,
  cards: [CARD('포장이 금방 끝나요'), CARD('아이들이 좋아해요'), CARD('튼튼해요')],
  options: [],
})
const cell = (id: string): Template => {
  const found = templateById(id)
  if (!found) throw new Error(`라이브러리에 없음: ${id}`)
  return structuredClone(found)
}
const hasBars = (nodes: readonly FlowNode[]): boolean =>
  nodes.some((n) => n.kind === 'bars' || ((n.kind === 'panel' || n.kind === 'repeat') && hasBars(n.nodes)) || (n.kind === 'row' && n.columns.some((c) => hasBars(c.nodes))))
const named = (els: CanvasElement[], name: string) => els.filter((e) => e.name === name)
const draw = (t: Template, bars: SlotItem[]) => renderTemplate(t, { ...sampleSlots(t, { mode: 'full' }), bars }, sampleContext())
const details = (t: Template) => lintTemplate(t).map((v) => `${v.rule}:${v.detail}`)

describe('분포 줄(ratingBarItems)', () => {
  it('5점부터 1점까지 다섯 줄이고, share 합은 1이다', () => {
    const rows = ratingBarItems(own({ 5: 70, 4: 20, 3: 6, 2: 3, 1: 1 }))
    expect(rows.map((r) => [r.star, r.count])).toEqual([['5', '70'], ['4', '20'], ['3', '6'], ['2', '3'], ['1', '1']])
    expect(rows.reduce((sum, r) => sum + Number(r.share), 0)).toBeCloseTo(1, 10)
    expect(Number(rows[0].share)).toBeCloseTo(0.7, 10)
  })

  it(`합계 ${RATING_BARS_MIN_TOTAL - 1}건이면 비고 ${RATING_BARS_MIN_TOTAL}건이면 나온다`, () => {
    expect(RATING_BARS_MIN_TOTAL).toBe(5)
    expect(ratingBarItems(own({ 5: 3, 4: 1 }))).toEqual([])
    expect(ratingBarItems(own({ 5: 4, 4: 1 }))).toHaveLength(5)
  })

  it('0건인 점수 줄도 남기고 share는 0이다 — 줄을 빼면 분포가 달라 보인다', () => {
    const rows = ratingBarItems(own({ 5: 5 }))
    expect(rows.map((r) => [r.star, r.count, Number(r.share)])).toEqual([['5', '5', 1], ['4', '0', 0], ['3', '0', 0], ['2', '0', 0], ['1', '0', 0]])
  })

  it('원본 rating_counts만 쓴다 — 평점 숫자만 있거나 값이 망가졌으면 만들지 않는다(#289)', () => {
    expect(ratingBarItems({ rating: 4.8, reviewCount: 120 } as unknown as PdpSpecSheet)).toEqual([])
    expect(ratingBarItems(own({ 5: -3, 4: 'x', 3: 1.5, 6: 99 }))).toEqual([])
    expect(ratingBarItems(own({ '5': '6', 4: null }))).toHaveLength(5)
  })
})

describe('후보 잠금', () => {
  it('막대가 든 칸은 새 칸 둘뿐이고, 칸은 필수 입력 목록 5줄이다', () => {
    const withBars = TEMPLATES.filter((t) => hasBars(t.flow)).map((t) => t.id)
    expect(withBars.sort()).toEqual([...NEW_CELLS].sort())
    for (const id of NEW_CELLS) {
      const def = cell(id).slots.bars as ListSlot
      expect([def.type, def.required, def.source, def.input, def.min, def.max], id).toEqual(['list', true, 'input', RATING_BARS_INPUT, 5, 5])
    }
  })

  it.each(NEW_CELLS)('%s: 분포가 없으면 못 그려 후보에서 빠지고, 있으면 후보에 든다', (id) => {
    const t = cell(id)
    expect(requiredInputsFit(t, inputs())).toBe(false)
    expect(requiredInputsFit(t, inputs({ 5: 3, 4: 1 }))).toBe(false)
    expect(requiredInputsFit(t, inputs({ 5: 4, 4: 1 }))).toBe(true)
  })

  it('분포 입력은 다른 칸의 후보를 바꾸지 않는다', () => {
    const others = TEMPLATES.filter((t) => !NEW_CELLS.includes(t.id))
    const before = others.map((t) => requiredInputsFit(t, inputs()))
    expect(others.map((t) => requiredInputsFit(t, inputs({ 5: 70, 4: 20, 3: 6, 2: 3, 1: 1 })))).toEqual(before)
  })
})

describe('그리기', () => {
  it.each(NEW_CELLS)('%s: 줄마다 라벨·트랙·퍼센트, 채움 폭은 비율대로이고 0%는 채움이 없다', (id) => {
    const t = cell(id)
    const out = draw(t, ratingBarItems(own({ 5: 6, 4: 3, 3: 1 })))!
    expect(out).not.toBeNull()
    expect(named(out.elements, 'designcut-bars-label').map((e) => e.textProps?.content)).toEqual(['5점', '4점', '3점', '2점', '1점'])
    expect(named(out.elements, 'designcut-bars-pct').map((e) => e.textProps?.content)).toEqual(['60%', '30%', '10%', '0%', '0%'])
    const tracks = named(out.elements, 'designcut-bars-track')
    const fills = named(out.elements, 'designcut-bars-fill')
    expect(tracks).toHaveLength(5)
    expect(fills).toHaveLength(3)
    const trackW = tracks[0].transform.width
    expect(new Set(tracks.map((e) => e.transform.width))).toEqual(new Set([trackW]))
    expect(fills.map((e) => e.transform.width)).toEqual([0.6, 0.3, 0.1].map((share) => Math.round(trackW * share)))
    fills.forEach((fill, i) => {
      expect(fill.transform.x).toBe(tracks[i].transform.x)
      expect(fill.transform.y).toBe(tracks[i].transform.y)
    })
    // 줄 간격이 고정이라 막대 다섯 줄 높이가 BARS_H(5)다
    const labels = named(out.elements, 'designcut-bars-label')
    expect(labels[4].transform.y - labels[0].transform.y + BARS.rowH).toBe(BARS_H(5))
  })

  it('100%면 채움이 트랙 끝까지다', () => {
    const out = draw(cell('perf_metric.score-bars'), ratingBarItems(own({ 5: 9 })))!
    const [track] = named(out.elements, 'designcut-bars-track')
    const fills = named(out.elements, 'designcut-bars-fill')
    expect(fills).toHaveLength(1)
    expect(fills[0].transform.width).toBe(track.transform.width)
    expect(named(out.elements, 'designcut-bars-pct')[0].textProps?.content).toBe('100%')
  })

  it.each(NEW_CELLS)('%s: 분포 칸이 비면 그리지 않는다', (id) => {
    const t = cell(id)
    expect(draw(t, [])).toBeNull()
  })

  it.each(NEW_CELLS)('%s: 표본(목업·render 씨앗)은 입력 모양 그대로 70·20·6·3·1 분포다', (id) => {
    const t = cell(id)
    for (const mode of ['full', 'required'] as const) {
      const bars = sampleSlots(t, { mode }).bars as SlotItem[]
      expect(bars.map((r) => [r.star, r.count]), mode).toEqual([['5', '70'], ['4', '20'], ['3', '6'], ['2', '3'], ['1', '1']])
    }
    const out = renderTemplate(t, sampleSlots(t, { mode: 'full' }), sampleContext())!
    expect(named(out.elements, 'designcut-bars-pct').map((e) => e.textProps?.content)).toEqual(['70%', '20%', '6%', '3%', '1%'])
  })

  it.each(NEW_CELLS)('%s: 글 상자는 줄 안에 들고, 줄마다 투명 행 상자가 그 줄 요소를 묶는다', (id) => {
    const out = draw(cell(id), ratingBarItems(own({ 5: 6, 4: 3, 3: 1 })))!
    const texts = [...named(out.elements, 'designcut-bars-label'), ...named(out.elements, 'designcut-bars-pct')]
    for (const text of texts) expect(text.transform.height).toBeLessThanOrEqual(BARS.rowH)
    const labels = named(out.elements, 'designcut-bars-label')
    const boxes = out.elements.filter((e) => e.name === 'designcut-row' && e.containerOf?.includes(labels[0].id))
    expect(boxes).toHaveLength(1)
    const rowBoxes = labels.map((label) => out.elements.find((e) => e.name === 'designcut-row' && e.containerOf?.includes(label.id))!)
    // 채움이 있는 줄은 라벨·트랙·채움·퍼센트 넷, 0% 줄은 셋
    expect(rowBoxes.map((b) => b.containerOf!.length)).toEqual([4, 4, 4, 3, 3])
    rowBoxes.forEach((b, i) => expect([b.transform.y, b.transform.height]).toEqual([labels[i].transform.y, BARS.rowH]))
  })

  // -30은 줄이는 차가 줄 사이(BARS.gap 18)보다 큰 경우다 — 행 상자 없이는 라벨·퍼센트 두 글이 따로 끌어올려 다음 줄 막대만 한 번 더 옮겨진다.
  // render 41596478661(줄 54·글 상자 64)에서는 줄 사이 여유가 8이라 실측 -10에서 같은 어긋남이 났다
  it.each([
    ['실측이 추정보다 작을 때(폰 390)', -10],
    ['실측이 추정보다 클 때(글꼴이 커짐)', 14],
    ['실측이 줄 사이보다 많이 작을 때', -30],
  ])('마운트 리플로우 뒤에도 줄마다 라벨·막대·퍼센트 간격이 같다 — %s(render 41596478661 어긋남)', (_, delta) => {
    const out = draw(cell('perf_metric.score-bars'), ratingBarItems(own({ 5: 70, 4: 20, 3: 6, 2: 3, 1: 1 })))!
    const section = { id: 's', canvas: { width: 860, height: out.height, backgroundColor: '#FFFFFF' }, elements: structuredClone(out.elements), preserveBottomPad: true } as unknown as CanvasSection
    for (const el of section.elements) if (el.name === 'designcut-bars-label' || el.name === 'designcut-bars-pct') el.measuredHeight = el.transform.height + delta
    reflowSectionLayout(section)
    const labels = named(section.elements, 'designcut-bars-label')
    const tracks = named(section.elements, 'designcut-bars-track')
    const pcts = named(section.elements, 'designcut-bars-pct')
    const before = named(out.elements, 'designcut-bars-track')[0].transform.y - named(out.elements, 'designcut-bars-label')[0].transform.y
    expect(tracks.map((t, i) => t.transform.y - labels[i].transform.y)).toEqual(Array(5).fill(before))
    expect(pcts.map((p, i) => p.transform.y - labels[i].transform.y)).toEqual(Array(5).fill(0))
    // 줄 사이도 고르다 — 줄마다 한 번만 옮긴다
    const pitches = labels.slice(1).map((l, i) => l.transform.y - labels[i].transform.y)
    expect(new Set(pitches).size).toBe(1)
  })

  it('막대는 글 한 줄 가운데에 있다', () => {
    const out = draw(cell('perf_metric.score-bars'), ratingBarItems(own({ 5: 9 })))!
    const [label] = named(out.elements, 'designcut-bars-label')
    const [track] = named(out.elements, 'designcut-bars-track')
    const line = label.textProps!.fontSize * label.textProps!.lineHeight!
    expect(Math.abs(track.transform.y + track.transform.height / 2 - (label.transform.y + line / 2))).toBeLessThanOrEqual(1)
  })

  it('BARS_H는 줄 수로만 정해진다', () => {
    expect(BARS_H(0)).toBe(0)
    expect(BARS_H(5)).toBe(5 * BARS.rowH + 4 * BARS.gap)
  })
})

describe('린트', () => {
  it.each(NEW_CELLS)('%s: 라이브러리 칸은 위반 0', (id) => {
    expect(lintTemplate(cell(id))).toEqual([])
  })

  it('후기·평점 섹션 밖에 두면 막는다', () => {
    const t = cell('perf_metric.score-bars')
    t.section = 'faq'
    t.id = 'faq.score-bars'
    expect(details(t)).toContain('evidence:별점 분포 막대는 review·perf_metric에만')
  })

  it('한 템플릿에 둘이면 막는다', () => {
    const t = cell('perf_metric.score-bars')
    t.flow.push({ kind: 'bars', slot: 'bars' })
    expect(details(t)).toContain('evidence:별점 분포 막대 2개(템플릿당 하나)')
  })

  it.each([
    ['입력 키가 다르면', (def: ListSlot) => (def.input = 'review.items')],
    ['선택 칸이면', (def: ListSlot) => (def.required = false)],
    ['5줄이 아니면', (def: ListSlot) => (def.min = 4)],
    ['최대가 5가 아니면', (def: ListSlot) => (def.max = 6)],
  ])('칸이 %s 막는다', (_, change) => {
    const t = cell('review.bars-quotes')
    change(t.slots.bars as ListSlot)
    expect(details(t)).toContain(`evidence:별점 분포 칸 bars은 ${RATING_BARS_INPUT} 필수 목록 5줄`)
  })

  it('첫 화면에는 쓰지 않는다', () => {
    const hook = TEMPLATES.find((t) => t.section === 'hook_3step')!
    const t = structuredClone(hook)
    t.flow.push({ kind: 'bars', slot: 'bars' })
    t.slots.bars = structuredClone(cell('perf_metric.score-bars').slots.bars)
    expect(details(t)).toContain('hook:첫 화면에 bars 금지')
    // 섹션 자리 검사도 함께 잡는다
    expect(details(t)).toContain('evidence:별점 분포 막대는 review·perf_metric에만')
  })
})
