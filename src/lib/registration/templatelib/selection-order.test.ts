/**
 * K 라인 순서 풀이 — 흐름·모양·사실 예산·긴 페이지·채움 다양성·바탕·구도. 템플릿은 시험용 가짜 메타데이터다. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { CONCEPTS, conceptById } from './concepts'
import { one, tpl } from './selection.fixture'
import { FACT_FREE_FILLERS, FILLER_MAX, PAGE_SHOT_MAX, PHOTO_ONLY_FILLER_MAX, POINT_MAX, RENDER_HEIGHT_RATIO, SHORT_SECTION_HEIGHT, assignShots, assignSurfaces, estimatePageHeight, solveOrder } from './selection-order'
import { K_SECTIONS, PAGE_MIN_HEIGHT, PAGE_PASS_HEIGHT, PAGE_SECTIONS, TEMPLATE_ZONES, signatureOf, type TemplateMeta } from './template-meta'

const concept = conceptById('clean-trust')!
const facts = (narrative: number, table = 0) => [
  ...Array.from({ length: table }, (_, i) => ({ text: `표${i}`, inTable: true })),
  ...Array.from({ length: narrative }, (_, i) => ({ text: `글${i}`, inTable: false })),
]

describe('순서 풀이', () => {
  it('흐름 순서로 놓는다 — 같은 구역 안에서는 들어온 순서', () => {
    const { sections, issues } = solveOrder(
      [
        one('cta', tpl('cta.a', { zone: 'decision' })),
        one('point_div', tpl('point_div.a', { zone: 'value' })),
        one('main_cut', tpl('main_cut.a', { zone: 'intro' })),
        one('sub_div', tpl('sub_div.a', { zone: 'value' })),
        one('problem_raise', tpl('problem_raise.a', { zone: 'problem' })),
      ],
      concept
    )
    expect(issues).toEqual([])
    expect(sections.map((s) => s.section)).toEqual(['main_cut', 'problem_raise', 'point_div', 'sub_div', 'cta'])
    expect(TEMPLATE_ZONES[0]).toBe('intro')
  })

  it('상품 정보 표는 구역과 상관없이 맨 끝이다 — 마무리·권유·후기·질문이 모두 그 앞이다(오너 지시 11-01)', () => {
    const { sections } = solveOrder(
      [
        one('spec_table', tpl('spec_table.a', { zone: 'trust' })),
        one('review', tpl('review.a', { zone: 'trust' })),
        one('faq', tpl('faq.a', { zone: 'trust' })),
        one('convert_div', tpl('convert_div.a', { zone: 'decision' })),
        one('cta', tpl('cta.a', { zone: 'decision' })),
        one('point_div', tpl('point_div.a', { zone: 'value' })),
      ],
      concept
    )
    expect(sections.map((s) => s.section)).toEqual(['point_div', 'review', 'convert_div', 'faq', 'cta', 'spec_table'])
  })

  it('큰 POINT는 앞 3개만 남긴다', () => {
    const inputs = [1, 2, 3, 4, 5].map((i) => one('point_div', tpl(`point_div.t${i}`)))
    const { sections } = solveOrder(inputs, concept)
    expect(sections.map((s) => s.templateId)).toEqual(['point_div.t1', 'point_div.t2', 'point_div.t3'])
    expect(sections).toHaveLength(POINT_MAX)
  })

  it('같은 모양 3연속이면 다음 후보로 넘어가고 기록한다', () => {
    const same = (id: string) => tpl(id, { shape: 'same' })
    const { sections, issues } = solveOrder(
      [one('a', same('a.1')), one('b', same('b.1')), one('c', same('c.1'), tpl('c.2', { shape: 'other' }))],
      concept
    )
    expect(issues).toEqual([])
    expect(sections[2]).toMatchObject({ templateId: 'c.2', fallbackFrom: 'c.1' })
    expect(sections[0]).not.toHaveProperty('fallbackFrom')
    expect(signatureOf(same('x'))).toBe(signatureOf(same('y')))
  })

  it('같은 모양이 두 번까지는 그대로 둔다', () => {
    const same = (id: string) => tpl(id, { shape: 'same' })
    const { sections } = solveOrder([one('a', same('a.1')), one('b', same('b.1'))], concept)
    expect(sections.map((s) => s.templateId)).toEqual(['a.1', 'b.1'])
  })

  it('이웃 금지는 양쪽 어느 쪽에 적혀 있어도 피한다, 후보가 있으면 같은 템플릿을 두 번 쓰지 않는다', () => {
    const near = solveOrder([one('a', tpl('a.1', { notNextTo: ['b.1'] })), one('b', tpl('b.1'), tpl('b.2'))], concept)
    expect(near.sections[1].templateId).toBe('b.2')
    const reverse = solveOrder([one('a', tpl('a.1')), one('b', tpl('b.1', { notNextTo: ['a.1'] }), tpl('b.2'))], concept)
    expect(reverse.sections[1].templateId).toBe('b.2')
    const twice = solveOrder([one('point_div', tpl('point_div.a')), one('point_div', tpl('point_div.a'), tpl('point_div.b'))], concept)
    expect(twice.sections.map((s) => s.templateId)).toEqual(['point_div.a', 'point_div.b'])
  })

  it('숨 고르기 섹션은 이어지지 않는다 — 다음 후보로 넘어간다', () => {
    const low = SHORT_SECTION_HEIGHT - 10
    const { sections, issues } = solveOrder([one('a', tpl('a.1', { height: low })), one('b', tpl('b.1', { height: low }), tpl('b.2'))], concept)
    expect(issues).toEqual([])
    expect(sections[1]).toMatchObject({ templateId: 'b.2', fallbackFrom: 'b.1' })
    const blocked = solveOrder([one('a', tpl('a.1', { height: low })), one('b', tpl('b.1', { height: low }))], concept)
    expect(blocked.issues).toEqual(['풀리지 않음: b'])
  })

  it('후보가 없거나 풀리지 않으면 지어내지 않고 issues에 남긴다', () => {
    const { sections, issues } = solveOrder([one('a', tpl('a.1')), one('empty'), one('b', tpl('a.1'))], concept)
    expect(sections.map((s) => s.section)).toEqual(['a'])
    expect(issues).toEqual(['후보 없음: empty', '풀리지 않음: b'])
  })
})

describe('큰 POINT 머리(오너 지시 11-01)', () => {
  const point = (id: string, head: string, shape = id) => tpl(id, { section: 'point_div', head, shape })
  const pick = (...sets: Array<ReturnType<typeof point>[]>) => solveOrder(sets.map((set) => one('point_div', ...set)), concept)

  it('페이지 안의 POINT는 첫 POINT와 같은 머리만 고른다', () => {
    const r = pick([point('point_div.a', 'x')], [point('point_div.b', 'y'), point('point_div.c', 'x')], [point('point_div.d', 'y'), point('point_div.e', 'x')])
    expect(r.issues).toEqual([])
    expect(r.sections.map((s) => s.templateId)).toEqual(['point_div.a', 'point_div.c', 'point_div.e'])
  })

  it('머리가 같은 후보가 없으면 같은 템플릿을 다시 쓴다 — 재사용 금지의 예외다', () => {
    const a = point('point_div.a', 'x')
    const r = pick([a], [point('point_div.b', 'y')], [a])
    expect(r.issues).toEqual([])
    expect(r.sections.map((s) => s.templateId)).toEqual(['point_div.a', 'point_div.a', 'point_div.a'])
  })

  it('머리가 같으면 아래 배치가 없던 모양을 먼저 고르고, 다음은 안 쓴 템플릿이다', () => {
    const [a, same, other] = [point('point_div.a', 'x', 's1'), point('point_div.same', 'x', 's1'), point('point_div.other', 'x', 's2')]
    const r = pick([a], [same, other], [a, same])
    expect(r.sections.map((s) => s.templateId)).toEqual(['point_div.a', 'point_div.other', 'point_div.same'])
  })

  it('같은 모양 3연속·자기 이웃 금지도 POINT끼리는 막지 않는다', () => {
    const a = tpl('point_div.a', { section: 'point_div', head: 'x', shape: 'same', notNextTo: ['point_div.a'] })
    const r = pick([a], [a], [a])
    expect(r.issues).toEqual([])
    expect(r.sections).toHaveLength(3)
  })

  it('POINT 밖 섹션과는 이웃 금지·같은 모양 규칙이 그대로다', () => {
    const near = solveOrder([one('hook_3step', tpl('a.1', { shape: 'same' })), one('main_cut', tpl('b.1', { shape: 'same' })), one('point_div', tpl('point_div.a', { section: 'point_div', head: 'x', shape: 'same' }), tpl('point_div.b', { section: 'point_div', head: 'x', shape: 'other' }))], concept)
    expect(near.sections[2].templateId).toBe('point_div.b')
  })

  it('머리 칸이 없는 후보끼리는 같은 머리로 본다', () => {
    const r = pick([tpl('point_div.a', { section: 'point_div' })], [tpl('point_div.b', { section: 'point_div' })])
    expect(r.sections.map((s) => s.templateId)).toEqual(['point_div.a', 'point_div.b'])
  })
})

describe('사실 예산', () => {
  const fact = (id: string, min: number, max: number, zone: TemplateMeta['order']['zone'] = 'value') => tpl(id, { zone, facts: [min, max] })

  it('앞 섹션부터 최소 칸을 주고, 최소 칸을 못 받는 섹션은 뺀다 — 문제로 치지 않는다', () => {
    const r = solveOrder([one('a', fact('a.1', 2, 2)), one('b', fact('b.1', 2, 2)), one('c', fact('c.1', 2, 2))], concept, { facts: facts(0, 5) })
    expect(r.sections.map((s) => [s.section, s.factSlots])).toEqual([['a', 2], ['b', 2]])
    expect(r.droppedForFacts).toEqual(['c'])
    expect(r.issues).toEqual([])
  })

  it('최소 칸이 작은 다음 후보가 있으면 빼지 않고 넘어간다', () => {
    const r = solveOrder([one('a', fact('a.1', 4, 4)), one('b', fact('b.1', 2, 2), fact('b.2', 1, 1))], concept, { facts: facts(0, 5) })
    expect(r.sections[1]).toMatchObject({ templateId: 'b.2', fallbackFrom: 'b.1', factSlots: 1 })
    expect(r.droppedForFacts).toEqual([])
  })

  it('뒤 섹션 자리를 남기려고 칸이 적은 후보로 넘어간다 — 고른 것은 fallbackFrom에 남는다', () => {
    const r = solveOrder([one('a', fact('a.1', 4, 4), fact('a.2', 1, 1)), one('b', fact('b.1', 2, 2))], concept, { facts: facts(0, 4) })
    expect(r.sections.map((s) => s.templateId)).toEqual(['a.2', 'b.1'])
    expect(r.sections[0].fallbackFrom).toBe('a.1')
    expect(r.droppedForFacts).toEqual([])
  })

  it('뒤 섹션까지 자리가 있으면 고른 것을 그대로 쓴다', () => {
    const r = solveOrder([one('a', fact('a.1', 4, 4), fact('a.2', 1, 1)), one('b', fact('b.1', 2, 2))], concept, { facts: facts(0, 6) })
    expect(r.sections.map((s) => s.templateId)).toEqual(['a.1', 'b.1'])
    expect(r.sections[0]).not.toHaveProperty('fallbackFrom')
  })

  it('예산이 뒤까지 안 닿으면 앞에서부터 가장 적은 후보를 쓰고 뒤를 뺀다', () => {
    const r = solveOrder([one('a', fact('a.1', 3, 3), fact('a.2', 1, 1)), one('b', fact('b.1', 2, 2)), one('c', fact('c.1', 2, 2))], concept, { facts: facts(0, 3) })
    expect(r.sections.map((s) => s.templateId)).toEqual(['a.2', 'b.1'])
    expect(r.droppedForFacts).toEqual(['c'])
  })

  it('사실을 쓰지 않는 섹션은 남겨 둘 칸에 들지 않는다', () => {
    const r = solveOrder([one('a', fact('a.1', 3, 3), fact('a.2', 1, 1)), one('cta', tpl('cta.1', { zone: 'decision' }))], concept, { facts: facts(0, 3) })
    expect(r.sections.map((s) => s.templateId)).toEqual(['a.1', 'cta.1'])
  })

  it('남은 칸은 앞에서부터 상한까지 더 주고, 사실을 말하지 않는 섹션은 늘 남는다', () => {
    const r = solveOrder([one('a', fact('a.1', 1, 3)), one('b', fact('b.1', 1, 3)), one('cta', tpl('cta.1', { zone: 'decision' }))], concept, { facts: facts(0, 5) })
    expect(r.sections.map((s) => s.factSlots)).toEqual([3, 2, 0])
    const none = solveOrder([one('a', fact('a.1', 1, 1)), one('cta', tpl('cta.1', { zone: 'decision' }))], concept, { facts: [] })
    expect(none.sections.map((s) => s.section)).toEqual(['cta'])
    expect(none.droppedForFacts).toEqual(['a'])
  })

  it('코드가 채우는 표·후기는 예산이 0이어도 빠지지 않는다', () => {
    const table = tpl('spec_table.a', { zone: 'trust', slots: { value: { type: 'text', required: true, source: 'input', facts: 1 } } })
    const r = solveOrder([one('spec_table', table)], concept, { facts: [] })
    expect(r.sections.map((s) => [s.section, s.factSlots])).toEqual([['spec_table', 0]])
    expect(r.droppedForFacts).toEqual([])
  })

  it('사실을 주지 않으면 칸을 나누지 않고 빼지도 않는다', () => {
    const r = solveOrder([one('a', fact('a.1', 9, 9)), one('b', fact('b.1', 9, 9))], concept)
    expect(r.sections.map((s) => s.section)).toEqual(['a', 'b'])
    expect(r.sections[0]).not.toHaveProperty('factSlots')
    expect(r.droppedForFacts).toEqual([])
    expect(r.issues).toEqual([])
  })

  it('규칙 때문에 후보가 모두 막힌 것은 사실 부족이 아니라 풀리지 않음이다', () => {
    const r = solveOrder([one('a', fact('a.1', 1, 1)), one('b', fact('a.1', 1, 1))], concept, { facts: facts(0, 5) })
    expect(r.issues).toEqual(['풀리지 않음: b'])
    expect(r.droppedForFacts).toEqual([])
  })
})

describe('긴 페이지 — 18~22섹션, 세로 합격점 780 파일 25,000px(오너 11-02)', () => {
  const page = (n: number, height = 1600) => Array.from({ length: n }, (_, i) => one(`s${i}`, tpl(`s${i}.t`, { section: `s${i}`, height })))
  const fillers = (n: number, height = 1600) => Array.from({ length: n }, (_, i) => one(`f${i}`, tpl(`f${i}.t`, { section: `f${i}`, height })))
  const fillerRows = (r: { sections: Array<{ filler?: boolean; section: string }> }) => r.sections.filter((s) => s.filler).map((s) => s.section)
  /** n개면 겨우 합격점을 넘는 템플릿 높이 — 렌더 비율을 K1에서 다시 재도 시험의 전제가 그대로다 */
  const enoughAt = (n: number) => Math.ceil(PAGE_MIN_HEIGHT / RENDER_HEIGHT_RATIO / n)

  it('기준값', () => {
    expect(PAGE_SECTIONS).toEqual({ min: 18, target: 20, max: 22 })
    expect(PAGE_MIN_HEIGHT).toBe(27_565)
    // 860 합격점을 780으로 내림해도 25,000이고, 1px 낮으면 25,000 밑이다
    expect(Math.floor((PAGE_MIN_HEIGHT * 780) / 860)).toBe(25_000)
    expect(Math.floor(((PAGE_MIN_HEIGHT - 1) * 780) / 860)).toBe(24_999)
    expect(PAGE_PASS_HEIGHT).toBe(25_000)
    expect(PAGE_SHOT_MAX).toBe(32)
    for (const section of FACT_FREE_FILLERS) expect(K_SECTIONS as readonly string[]).toContain(section)
  })

  it('섹션이 모자라면 같은 말을 늘리지 않고 채움으로 20까지 채운다 — 채움은 기록한다', () => {
    const height = enoughAt(20)
    const r = solveOrder(page(16, height), concept, { fillers: fillers(8, height) })
    expect(r.sections).toHaveLength(20)
    expect(fillerRows(r)).toHaveLength(4)
    expect(r.sections.find((s) => s.section === 's0')).not.toHaveProperty('filler')
    expect(r.issues).toEqual([])
    expect(r.height).toEqual({ estimated: Math.round(20 * height * RENDER_HEIGHT_RATIO), meetsRequired: true })
  })

  it('20개여도 높이가 모자라면 22까지 더 채운다', () => {
    const height = enoughAt(22)
    const r = solveOrder(page(20, height), concept, { fillers: fillers(4, height) })
    expect(r.sections).toHaveLength(22)
    expect(r.height.estimated).toBe(Math.round(22 * height * RENDER_HEIGHT_RATIO))
    expect(r.issues).toEqual([])
    const stop = solveOrder(page(20, enoughAt(21)), concept, { fillers: fillers(4, enoughAt(21)) })
    expect(stop.sections).toHaveLength(21)
  })

  it('높이가 넉넉해도 목표 섹션 수까지 채운다, 사실이 많으면 목표가 22다', () => {
    expect(solveOrder(page(16, 3000), concept, { fillers: fillers(8, 3000) }).sections).toHaveLength(20)
    expect(solveOrder(page(18, 3000), concept, { facts: facts(10), fillers: fillers(8, 3000) }).sections).toHaveLength(22)
  })

  it('목표를 넘긴 페이지에는 더 넣지 않는다, 22개는 넘기지 않는다', () => {
    expect(solveOrder(page(20, enoughAt(20)), concept, { fillers: fillers(4, enoughAt(20)) }).sections).toHaveLength(20)
    const low = solveOrder(page(18, 800), concept, { fillers: fillers(9, 800) })
    expect(low.sections).toHaveLength(22)
    expect(low.height.meetsRequired).toBe(false)
  })

  it('채움은 상한까지만 넣고, 모자라면 억지로 채우지 않고 문제로 남긴다', () => {
    const r = solveOrder(page(6, 1500), concept, { fillers: fillers(16, 1500) })
    expect(fillerRows(r)).toHaveLength(FILLER_MAX)
    expect(r.sections).toHaveLength(6 + FILLER_MAX)
    expect(r.issues).toEqual([`섹션 ${6 + FILLER_MAX}개(18~22)`, `페이지 높이 ${Math.round((6 + FILLER_MAX) * 1500 * RENDER_HEIGHT_RATIO)}(통과선 25000 미달)`])
  })

  it('구성에서 고른 채움 섹션도 상한에 든다', () => {
    const chosen = ['sub2_div_page', 'petit_div', 'product_exposure'].map((section) => one(section, tpl(`${section}.t`, { section })))
    const r = solveOrder([...page(10), ...chosen], concept, { fillers: fillers(6) })
    expect(fillerRows(r)).toHaveLength(FILLER_MAX - chosen.length)
  })

  it('사진만 있는 채움은 상한이 따로 있다', () => {
    const photo = { type: 'image' as const, required: true, purpose: ['scene'], composition: ['front'] }
    const only = (id: string) => tpl(id, { slots: { photo } })
    const pool = [one('p', only('p.1'), only('p.2'), only('p.3'), only('p.4')), one('q', tpl('q.1'), tpl('q.2'))]
    const r = solveOrder(page(16), concept, { fillers: pool })
    const used = r.sections.filter((s) => s.filler).map((s) => s.templateId)
    expect(used.filter((id) => id.startsWith('p.'))).toHaveLength(PHOTO_ONLY_FILLER_MAX)
    expect(used).toHaveLength(FILLER_MAX)
  })

  it('채움은 큰 POINT 사이, 후기·상품 정보 표 곁에 들어가지 않는다', () => {
    const inputs = [
      one('intro', tpl('intro.t', { zone: 'intro' })),
      ...[1, 2, 3].map((i) => one('point_div', tpl(`point_div.t${i}`, { section: 'point_div', zone: 'value' }))),
      one('sub_div', tpl('sub_div.t', { zone: 'value' })),
      one('key_message', tpl('key_message.t', { zone: 'value' })),
      one('review', tpl('review.t', { zone: 'trust' })),
      one('spec_table', tpl('spec_table.t', { zone: 'trust' })),
      one('faq', tpl('faq.t', { zone: 'trust' })),
      one('cta', tpl('cta.t', { zone: 'decision' })),
    ]
    const r = solveOrder(inputs, concept, { fillers: fillers(6).map((f) => ({ ...f })) })
    const order = r.sections
    order.forEach((row, i) => {
      if (!row.filler) return
      const [prev, next] = [order[i - 1]?.section, order[i + 1]?.section]
      expect(prev === 'point_div' && next === 'point_div').toBe(false)
      for (const near of [prev, next]) expect(['review', 'spec_table']).not.toContain(near)
    })
    expect(order.filter((s) => s.filler).length).toBeGreaterThan(0)
  })

  it('들어갈 자리가 구역에 없으면 그 채움은 버린다', () => {
    const inputs = [one('review', tpl('review.t', { zone: 'trust' })), one('spec_table', tpl('spec_table.t', { zone: 'trust' }))]
    const r = solveOrder(inputs, concept, { fillers: [one('f', tpl('f.t', { zone: 'trust' }))] })
    expect(r.sections.map((s) => s.section)).toEqual(['review', 'spec_table'])
  })

  it('채워도 섹션 수·높이가 모자라면 문제로 남긴다', () => {
    const few = solveOrder(page(10), concept, { fillers: [] })
    expect(few.issues).toEqual(['섹션 10개(18~22)', `페이지 높이 ${Math.round(10 * 1600 * RENDER_HEIGHT_RATIO)}(통과선 25000 미달)`])
    const thin = solveOrder(page(22, 1000), concept, { fillers: [] })
    expect(thin.issues).toEqual([`페이지 높이 ${Math.round(22000 * RENDER_HEIGHT_RATIO)}(통과선 25000 미달)`])
    // 통과선은 넘었으나 합격점에 못 미치면 그렇게 적는다
    const passed = solveOrder(page(22, enoughAt(22) - 100), concept, { fillers: [] })
    expect(passed.issues).toEqual([`페이지 높이 ${passed.height.estimated}(합격점 ${PAGE_MIN_HEIGHT} 미달)`])
    expect(passed.height.estimated).toBeGreaterThanOrEqual(PAGE_PASS_HEIGHT)
    expect(passed.height.meetsRequired).toBe(false)
    const many = solveOrder(page(23, 2000), concept, { fillers: [] })
    expect(many.issues).toEqual(['섹션 23개(18~22)'])
    expect(many.height.meetsRequired).toBe(true)
  })

  it('채움에는 사실을 요구하는 후보를 쓰지 않는다 — 사실 칸이 남아 있어도 그렇다', () => {
    const r = solveOrder(page(19), concept, {
      facts: [{ text: '남은 사실', inTable: false }],
      fillers: [one('fy', tpl('fy.bad', { facts: [1, 1] }), tpl('fy.ok'))],
    })
    expect(r.sections.map((s) => s.templateId)).toContain('fy.ok')
    expect(r.sections.map((s) => s.templateId)).not.toContain('fy.bad')
  })

  it('사실 때문에 빠진 섹션 자리도 채운다', () => {
    const needy = Array.from({ length: 3 }, (_, i) => one(`n${i}`, tpl(`n${i}.t`, { section: `n${i}`, facts: [1, 1] })))
    const r = solveOrder([...page(17, enoughAt(20)), ...needy], concept, { facts: [], fillers: fillers(8, enoughAt(20)) })
    expect(r.droppedForFacts).toEqual(['n0', 'n1', 'n2'])
    expect(r.sections).toHaveLength(20)
    expect(fillerRows(r)).toHaveLength(3)
    expect(r.issues).toEqual([])
  })

  it('같은 채움 섹션을 다른 템플릿으로 여러 번 쓴다, 같은 템플릿은 다시 쓰지 않는다', () => {
    const sameSection = one('sub2_div_page', ...Array.from({ length: 6 }, (_, i) => tpl(`sub2_div_page.t${i}`, { height: enoughAt(20) })))
    const r = solveOrder(page(17, enoughAt(20)), concept, { fillers: [sameSection] })
    const used = r.sections.filter((s) => s.filler).map((s) => s.templateId)
    expect(used).toHaveLength(3)
    expect(new Set(used).size).toBe(3)
    const already = solveOrder([...page(19), one('dup', tpl('dup.t'))], concept, { fillers: [one('dup', tpl('dup.t'))] })
    expect(already.sections.filter((s) => s.templateId === 'dup.t')).toHaveLength(1)
  })

  it('채움은 페이지에 없던 구도를 먼저 고른다', () => {
    const base = [...page(18, enoughAt(18)), one('main', tpl('main.t', { shots: ['front'] }))]
    const r = solveOrder(base, concept, {
      fillers: [one('sub2_div_page', tpl('sub2_div_page.same', { shots: ['front'] }), tpl('sub2_div_page.new', { shots: ['in_use'] }))],
    })
    expect(r.sections.filter((s) => s.filler).map((s) => s.templateId)).toEqual(['sub2_div_page.new'])
  })

  it('앞 후보가 더 나으면 뒤 후보로 바꾸지 않는다', () => {
    const base = [...page(18, enoughAt(18)), one('main', tpl('main.t', { shots: ['front'] }))]
    const r = solveOrder(base, concept, {
      fillers: [one('sub2_div_page', tpl('sub2_div_page.new', { shots: ['in_use'] }), tpl('sub2_div_page.same', { shots: ['front'] }))],
    })
    expect(r.sections.filter((s) => s.filler).map((s) => s.templateId)).toEqual(['sub2_div_page.new'])
  })

  it('구도가 같으면 덜 쓴 섹션을 먼저 고른다', () => {
    const r = solveOrder(page(16), concept, {
      fillers: [
        one('a', tpl('a.1'), tpl('a.2'), tpl('a.3')),
        one('b', tpl('b.1'), tpl('b.2')),
      ],
    })
    const count = (section: string) => r.sections.filter((s) => s.filler && s.section === section).length
    expect(r.sections.filter((s) => s.filler)).toHaveLength(4)
    expect([count('a'), count('b')]).toEqual([2, 2])
  })

  it('높이가 모자라면 남은 자리로 맞출 만큼 큰 채움을 구도보다 먼저 고른다', () => {
    const height = enoughAt(22)
    const base = [...page(19, height), one('main', tpl('main.t', { shots: ['front'], height }))]
    const r = solveOrder(base, concept, {
      fillers: [one('f', tpl('f.small', { shots: ['in_use'], height: 800 }), tpl('f.tall', { shots: ['front'], height: 4200 }))],
    })
    expect(r.sections.filter((s) => s.filler).map((s) => s.templateId)).toEqual(['f.tall'])
  })

  it('큰 것을 고를 때는 작은 것들 가운데서도 더 큰 것을 먼저 고른다 — 높이가 넉넉하면 큰 것을 따지지 않는다', () => {
    const r = solveOrder(page(21, 1400), concept, {
      fillers: [one('f', tpl('f.a', { height: 300 }), tpl('f.b', { height: 500 }))],
    })
    expect(r.sections.filter((s) => s.filler).map((s) => s.templateId)).toEqual(['f.b'])
    const enough = solveOrder(page(19, 2000), concept, {
      fillers: [one('f', tpl('f.a', { height: 900 }), tpl('f.b', { height: 1100 }))],
    })
    expect(enough.sections.filter((s) => s.filler).map((s) => s.templateId)).toEqual(['f.a'])
  })

  it('채움은 한곳에 몰리지 않고 같은 구역 안에 흩어진다', () => {
    const r = solveOrder(page(16), concept, { fillers: fillers(8) })
    const at = r.sections.flatMap((s, i) => (s.filler ? [i] : []))
    expect(at).toHaveLength(4)
    for (let k = 1; k < at.length; k++) expect(at[k] - at[k - 1]).toBeGreaterThan(1)
    expect(at[0]).toBeGreaterThan(0)
    expect(at.at(-1)).toBeLessThan(r.sections.length - 1)
  })

  it('채움은 채움 구간 안에 들어간다 — 첫 화면 앞이나 마무리 뒤로 가지 않는다', () => {
    const inputs = [
      one('intro', tpl('intro.t', { zone: 'intro' })),
      one('v0', tpl('v0.t', { zone: 'value' })),
      one('v1', tpl('v1.t', { zone: 'value' })),
      one('end', tpl('end.t', { zone: 'decision' })),
    ]
    const r = solveOrder(inputs, concept, { fillers: [one('f', tpl('f.t', { zone: 'value' })), one('p', tpl('p.t', { zone: 'problem' })), one('t', tpl('t.t', { zone: 'trust' }))] })
    const placed = r.sections.map((s) => s.section)
    expect(placed[0]).toBe('intro')
    expect(placed.at(-1)).toBe('end')
    expect(placed).toEqual(expect.arrayContaining(['f', 'p', 't']))
    const far = solveOrder(
      [one('a', tpl('a.t', { zone: 'intro' })), ...['v0', 'v1', 'v2', 'v3'].map((id) => one(id, tpl(`${id}.t`))), one('d', tpl('d.t', { zone: 'decision' }))],
      concept,
      { fillers: [one('z', tpl('z.t', { zone: 'decision' }))] }
    )
    expect(far.sections[0].section).toBe('a')
    expect(far.sections.at(-1)?.section).toBe('d')
    expect(far.sections.map((s) => s.section)).toContain('z')
    const last = solveOrder([one('intro', tpl('intro.t', { zone: 'intro' }))], concept, { fillers: [one('z', tpl('z.t', { zone: 'decision' }))] })
    expect(last.sections.map((s) => s.section)).toEqual(['intro', 'z'])
  })

  it('들어갈 자리가 없는 채움은 버리고 다음 후보를 쓴다, 다른 섹션을 밀어내지 않는다', () => {
    const ids = Array.from({ length: 19 }, (_, i) => `s${i}.t`)
    const r = solveOrder(page(19, enoughAt(20)), concept, {
      fillers: [one('bad', tpl('bad.t', { notNextTo: ids, height: 9000 })), one('ok', tpl('ok.t', { height: enoughAt(20) }))],
    })
    expect(r.sections.map((s) => s.templateId)).toContain('ok.t')
    expect(r.sections.map((s) => s.templateId)).not.toContain('bad.t')
    expect(r.sections).toHaveLength(20)
    expect(r.issues).toEqual([])
  })

  it('높이 추정은 대표 높이의 합에 렌더 비율을 곱한다', () => {
    expect(estimatePageHeight([{ height: 1000 }, { height: 700 }])).toBe(1530)
    expect(estimatePageHeight([])).toBe(0)
  })
})

describe('바탕 리듬', () => {
  const page = (n: number, surfaces: TemplateMeta['surfaces'] = ['W', 'T', 'N', 'D']) => Array.from({ length: n }, () => ({ surfaces }))

  it('light는 짙은 면이 없고, 흰 바탕이 기본이다', () => {
    const bgs = assignSurfaces(page(16), 'light')
    expect(bgs).not.toContain('D')
    expect(bgs.filter((b) => b === 'W').length).toBeGreaterThan(bgs.length / 2)
  })

  it('짙은 면 비중: dark > mixed > light, 첫·끝 섹션은 짙은 면이 아니다', () => {
    const count = (r: 'light' | 'mixed' | 'dark') => assignSurfaces(page(16), r).filter((b) => b === 'D').length
    expect(count('dark')).toBeGreaterThan(count('mixed'))
    expect(count('mixed')).toBeGreaterThan(count('light'))
    for (const r of ['mixed', 'dark'] as const) {
      const bgs = assignSurfaces(page(15), r)
      expect(bgs[0]).not.toBe('D')
      expect(bgs.at(-1)).not.toBe('D')
      for (let i = 1; i < bgs.length; i++) if (bgs[i] === 'D') expect(bgs[i - 1]).not.toBe('D')
    }
  })

  it('템플릿이 받는 바탕 안에서만 고른다 — 못 받으면 그대로 둔다', () => {
    expect(assignSurfaces(page(4, ['W', 'N']), 'light')).toEqual(['W', 'N', 'W', 'W'])
    expect(assignSurfaces(page(3, ['W']), 'dark')).toEqual(['W', 'W', 'W'])
    expect(assignSurfaces([{ surfaces: ['N'] }, { surfaces: ['W', 'N'] }, { surfaces: ['N'] }], 'light')).toEqual(['N', 'W', 'N'])
  })

  it('짙은 면은 받는 템플릿에만 주고, 첫·끝에는 주지 않는다', () => {
    const light = { surfaces: ['W', 'N'] as TemplateMeta['surfaces'] }
    const dark = { surfaces: ['W', 'N', 'D'] as TemplateMeta['surfaces'] }
    expect(assignSurfaces([light, light, light, dark, light], 'dark')).toEqual(['W', 'W', 'W', 'D', 'W'])
    expect(assignSurfaces([dark, light, light, dark], 'dark').at(-1)).not.toBe('D')
    expect(assignSurfaces([dark, light, light, dark], 'dark')[0]).not.toBe('D')
  })

  it('밝은 바탕을 받지 않는 템플릿은 자기 바탕 그대로다', () => {
    expect(assignSurfaces([{ surfaces: ['P'] }, { surfaces: ['W'] }], 'light')).toEqual(['P', 'W'])
    expect(assignSurfaces([{ surfaces: ['D'] }, { surfaces: ['W'] }], 'light')).toEqual(['D', 'W'])
  })

  it('짙은 면이 없는 컨셉은 모두 light라 짙은 면을 받지 않는다', () => {
    for (const c of CONCEPTS.filter((x) => x.deep === null)) expect(assignSurfaces(page(16), c.rhythm)).not.toContain('D')
  })

  it('순서 풀이 결과의 바탕은 그 템플릿이 받는 값이다', () => {
    const inputs = Array.from({ length: 6 }, (_, i) => one(`s${i}`, tpl(`s${i}.t`, { surfaces: i % 2 ? ['W'] : ['W', 'N'] })))
    const { sections } = solveOrder(inputs, concept)
    sections.forEach((s, i) => expect((i % 2 ? ['W'] : ['W', 'N']) as string[]).toContain(s.bg))
  })
})

describe('구도 배정', () => {
  const image = (composition: string[], purpose = ['scene']) => ({ type: 'image' as const, required: true, purpose, composition })

  it('슬롯이 받는 값 가운데 페이지에서 가장 덜 쓴 구도를 준다', () => {
    const shots = assignShots([
      { slots: { a: image(['front', 'side']) } },
      { slots: { a: image(['front', 'side']) } },
      { slots: { a: image(['front', 'side']) } },
    ])
    expect(shots.map((s) => s[0].composition)).toEqual(['front', 'side', 'front'])
  })

  it('목적도 덜 쓴 값을 준다, 사진 슬롯이 없으면 빈 목록이다', () => {
    const shots = assignShots([
      { slots: { a: image(['front'], ['scene', 'action']), b: image(['side'], ['scene', 'action']) } },
      { slots: { t: { type: 'text', required: true, source: 'copy', facts: 0 } } },
    ])
    expect(shots[0]).toEqual([
      { slot: 'a', purpose: 'scene', composition: 'front' },
      { slot: 'b', purpose: 'action', composition: 'side' },
    ])
    expect(shots[1]).toEqual([])
  })

  it('목록 슬롯은 최소 항목 수만큼 서로 다른 구도를 주고, 구도 가짓수를 넘기지 않는다', () => {
    const list = (min: number) => ({ type: 'list' as const, required: true, min, max: 9, fields: { photo: image(['in_use', 'closeup', 'top']), name: { type: 'text' as const, required: false, source: 'copy' as const, facts: 0 } } })
    expect(assignShots([{ slots: { shots: list(3) } }])[0]).toEqual([
      { slot: 'shots.photo', purpose: 'scene', composition: 'in_use' },
      { slot: 'shots.photo', purpose: 'scene', composition: 'closeup' },
      { slot: 'shots.photo', purpose: 'scene', composition: 'top' },
    ])
    expect(assignShots([{ slots: { shots: list(2) } }])[0]).toHaveLength(2)
    expect(assignShots([{ slots: { shots: list(0) } }])[0]).toHaveLength(1)
    expect(assignShots([{ slots: { shots: list(9) } }])[0]).toHaveLength(3)
  })

  it('순서 풀이 결과에 섹션별로 담긴다', () => {
    const { sections } = solveOrder([one('a', tpl('a.1', { shots: ['front', 'side'] })), one('b', tpl('b.1', { shots: ['front', 'side'] })), one('c', tpl('c.1'))], concept)
    expect(sections.map((s) => s.shots.map((x) => x.composition))).toEqual([['front'], ['side'], []])
  })
})
