/**
 * K 라인 컷 상한 — 페이지당 컷을 PAGE_SHOT_MAX 안에 두되 첫 화면·표·마무리·후기·큰 POINT를 잃지 않는다.
 * 가짜 템플릿으로 규칙을 보고, 11상품은 실제 라이브러리·기본 구성 경로로 본다. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { PDP_TEST_PRODUCT_IDS, getPdpTestProduct } from '../__fixtures__/pdp-products'
import type { PdpJobRow } from '../pdp-state'
import { conceptById } from './concepts'
import { lineInputsOf } from './input-values'
import { TEMPLATES } from './library'
import { selectTemplateLine, type TemplateAgents } from './select-line'
import { one, tpl, type TplOptions } from './selection.fixture'
import { PAGE_SHOT_MAX, POINT_SECTION, REQUIRED_SECTIONS, shotCountOf, solveOrder, type OrderResult } from './selection-order'
import type { MetaSlot, TemplateMeta } from './template-meta'
import { OPTION_IMAGES_INPUT } from './template-types'

const concept = conceptById('clean-trust')!
const photos = (n: number): Record<string, MetaSlot> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`photo${i}`, { type: 'image' as const, required: true, purpose: ['scene'], composition: ['front'] }]))
/** 컷이 n장 드는 가짜 템플릿 */
const cut = (id: string, n: number, opts: Partial<TplOptions> = {}) => tpl(id, { ...opts, slots: photos(n) })
const totalShots = (r: Pick<OrderResult, 'sections'>) => r.sections.reduce((sum, s) => sum + s.shots.length, 0)
const names = (r: Pick<OrderResult, 'sections'>) => r.sections.map((s) => s.section)
/** 컷이 n장씩 드는 본문 k개 */
const body = (k: number, n: number) => Array.from({ length: k }, (_, i) => one(`s${i}`, cut(`s${i}.t`, n, { section: `s${i}` })))

describe('컷 수 세기', () => {
  it('사진 슬롯 수다 — 목록은 최소 항목 수만큼이고 구도 가짓수를 넘지 않는다, 글만 있으면 0이다', () => {
    const image = { type: 'image' as const, required: true, purpose: ['scene'], composition: ['front', 'side'] }
    const list = (min: number) => ({ type: 'list' as const, required: true, min, max: 9, fields: { photo: image } })
    expect(shotCountOf(cut('a.t', 3))).toBe(3)
    expect(shotCountOf(tpl('a.t'))).toBe(0)
    expect(shotCountOf(tpl('a.t', { slots: { rows: list(0) } }))).toBe(1)
    expect(shotCountOf(tpl('a.t', { slots: { rows: list(2) } }))).toBe(2)
    expect(shotCountOf(tpl('a.t', { slots: { rows: list(5) } }))).toBe(2)
  })

  it('옵션 사진 목록은 입력값이라 세지 않는다', () => {
    const image = { type: 'image' as const, required: true, purpose: ['scene'], composition: ['front'] }
    expect(shotCountOf(tpl('a.t', { slots: { options: { type: 'list', required: true, min: 2, max: 9, input: OPTION_IMAGES_INPUT, fields: { photo: image } } } }))).toBe(0)
  })

  it('순서 풀이가 나눠 주는 컷 줄 수와 같다 — 실제 라이브러리 전체', () => {
    for (const template of TEMPLATES as unknown as TemplateMeta[]) {
      const { sections } = solveOrder([one(template.section, template)], concept)
      expect(sections[0].shots, template.id).toHaveLength(shotCountOf(template))
    }
  })
})

describe('컷 상한(통합 결정 11-01)', () => {
  it('상한 안이면 후보 순서를 그대로 쓰고 아무것도 빼지 않는다', () => {
    const r = solveOrder([one('a', cut('a.many', 10), cut('a.few', 1)), ...body(3, 3)], concept)
    expect(r.sections[0].templateId).toBe('a.many')
    expect(r.sections[0]).not.toHaveProperty('fallbackFrom')
    expect(r.droppedForShots).toEqual([])
    expect(r.issues).toEqual([])
  })

  it('상한을 넘으면 컷이 적은 후보로 가고 fallbackFrom에 남긴다', () => {
    const r = solveOrder([...body(10, 3), one('x', cut('x.big', 4), cut('x.small', 2))], concept)
    expect(r.sections.at(-1)).toMatchObject({ templateId: 'x.small', fallbackFrom: 'x.big' })
    expect(totalShots(r)).toBe(PAGE_SHOT_MAX)
    expect(r.droppedForShots).toEqual([])
  })

  it('앞 섹션이 컷을 다 쓰지 않게 뒤 섹션 몫을 남긴다', () => {
    const r = solveOrder([one('a', cut('a.big', 10), cut('a.small', 2)), ...body(10, 3)], concept)
    expect(r.sections[0]).toMatchObject({ templateId: 'a.small', fallbackFrom: 'a.big' })
    expect(r.sections).toHaveLength(11)
    expect(totalShots(r)).toBe(PAGE_SHOT_MAX)
    expect(r.droppedForShots).toEqual([])
  })

  it('뒤 몫까지 못 남겨도 지금 넣을 수 있으면 컷이 가장 적은 후보로 간다', () => {
    const same = (id: string, n: number) => cut(id, n, { shape: 'same' })
    const r = solveOrder(
      [one('p', same('p.t', 1)), one('q', same('q.t', 1)), one('x', same('x.few', 1), cut('x.many', 20)), one('a', cut('a.big', 8), cut('a.small', 7)), one('b', cut('b.t', 5))],
      concept
    )
    expect(r.sections.find((s) => s.section === 'a')?.templateId).toBe('a.small')
    expect(r.droppedForShots).toEqual(['b'])
    expect(totalShots(r)).toBe(29)
  })

  it('최소 컷 합이 상한을 넘으면 필수가 아닌 섹션을 컷 많은 것부터, 같으면 뒤쪽부터 뺀다', () => {
    const r = solveOrder(
      [
        one('hook_3step', cut('hook_3step.t', 4, { zone: 'intro' })),
        one('a', cut('a.t', 6)),
        one('b', cut('b.t', 8)),
        one('c', cut('c.t', 8)),
        one('d', cut('d.t', 6)),
        one('e', cut('e.t', 7)),
        one('spec_table', tpl('spec_table.t', { zone: 'trust' })),
        one('cta', cut('cta.t', 2, { zone: 'decision' })),
      ],
      concept
    )
    expect(r.droppedForShots).toEqual(['c', 'b'])
    expect(names(r)).toEqual(['hook_3step', 'a', 'd', 'e', 'cta', 'spec_table'])
    expect(r.issues).toEqual([`컷 상한(${PAGE_SHOT_MAX}장)으로 뺌: c`, `컷 상한(${PAGE_SHOT_MAX}장)으로 뺌: b`])
    expect(totalShots(r)).toBeLessThanOrEqual(PAGE_SHOT_MAX)
  })

  it('첫 화면·표·마무리·후기·큰 POINT는 다른 섹션이 있는 동안 빠지지 않는다', () => {
    const r = solveOrder(
      [
        one('hook_3step', cut('hook_3step.t', 6, { zone: 'intro' })),
        ...[1, 2, 3].map((i) => one(POINT_SECTION, cut(`${POINT_SECTION}.t${i}`, 5, { section: POINT_SECTION }))),
        ...body(3, 4),
        one('review', cut('review.t', 5, { zone: 'trust' })),
        one('spec_table', cut('spec_table.t', 2, { zone: 'trust' })),
        one('cta', cut('cta.t', 4, { zone: 'decision' })),
      ],
      concept
    )
    expect(new Set(r.droppedForShots)).toEqual(new Set(['s0', 's1', 's2']))
    for (const section of [...REQUIRED_SECTIONS, 'review']) expect(names(r)).toContain(section)
    expect(names(r).filter((s) => s === POINT_SECTION)).toHaveLength(3)
    expect(totalShots(r)).toBe(PAGE_SHOT_MAX)
  })

  it('컷 없는 섹션은 뺄 이유가 없다', () => {
    const r = solveOrder([one('free', tpl('free.t')), ...body(4, 9)], concept)
    expect(names(r)).toContain('free')
    expect(r.droppedForShots).toEqual(['s3'])
  })

  it('같은 모양을 피하다 최소 컷보다 많이 써서 마무리가 빠질 자리면, 필수가 아닌 섹션을 더 빼고 다시 놓는다', () => {
    const same = (id: string, n: number) => cut(id, n, { shape: 'same' })
    const r = solveOrder(
      [one('p', same('p.t', 1)), one('q', same('q.t', 1)), one('a', same('a.few', 1), cut('a.many', 12)), one('n', cut('n.t', 10)), one('cta', cut('cta.t', 18, { zone: 'decision' }))],
      concept
    )
    expect(r.sections.find((s) => s.section === 'a')?.templateId).toBe('a.many')
    expect(r.droppedForShots).toEqual(['n'])
    expect(names(r)).toContain('cta')
    expect(totalShots(r)).toBeLessThanOrEqual(PAGE_SHOT_MAX)
  })

  it('보호 섹션만으로 상한을 넘으면 지어내지 않고 빠진 것을 기록한다', () => {
    const r = solveOrder(
      [
        one('hook_3step', cut('hook_3step.t', 20, { zone: 'intro' })),
        one('review', cut('review.t', 20, { zone: 'trust' })),
        one('cta', cut('cta.t', 4, { zone: 'decision' })),
      ],
      concept
    )
    expect(r.droppedForShots).toEqual(['review'])
    expect(r.issues).toEqual([`컷 상한(${PAGE_SHOT_MAX}장)으로 뺌: review`])
    expect(names(r)).toEqual(['hook_3step', 'cta'])
  })

  it('채움은 상한을 넘기지 않는다 — 안 맞는 채움은 버리고 기존 섹션을 밀어내지 않는다', () => {
    const r = solveOrder(
      [one('big', cut('big.t', 30)), ...Array.from({ length: 16 }, (_, i) => one(`s${i}`, tpl(`s${i}.t`, { section: `s${i}` })))],
      concept,
      { fillers: [one('f', cut('f.big', 4, { height: 5000 })), one('g', cut('g.ok', 2))] }
    )
    const used = r.sections.filter((s) => s.filler).map((s) => s.templateId)
    expect(used).toEqual(['g.ok'])
    expect(totalShots(r)).toBe(PAGE_SHOT_MAX)
    expect(r.droppedForShots).toEqual([])
  })
})

describe('시험 11상품 — 실제 라이브러리·기본 구성', () => {
  const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
  const agents: TemplateAgents = {
    guideline: async ({ concepts }) => free({ persona: '', tone: '', concept: { id: concepts[0].id, reason: '' }, alternatives: [] }),
    compose: async () => free([]),
    select: async ({ slots }) => free(slots.map((s) => ({ index: s.index, templateId: s.candidates[0].id, reason: '' }))),
  }

  it.each([...PDP_TEST_PRODUCT_IDS])('%s: 컷이 상한 안이고 첫 화면·표·마무리가 있으며 뺀 것을 기록한다', async (id) => {
    const product = getPdpTestProduct(id)
    const inputs = lineInputsOf({ spec_sheet: product.specSheet, analysis: {}, copy_sections: { final: { options: product.specSheet.colorOptions ?? [] } } } as unknown as PdpJobRow)
    const { order, record } = await selectTemplateLine(
      {
        key: id,
        categoryKey: product.categoryKey,
        productHex: null,
        spec: product.specSheet,
        templates: TEMPLATES as unknown as TemplateMeta[],
        inputs,
        product: { category: product.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] },
      },
      agents
    )
    expect(totalShots(order)).toBeLessThanOrEqual(PAGE_SHOT_MAX)
    for (const section of REQUIRED_SECTIONS) expect(names(order)).toContain(section)
    expect(record.droppedForShots).toEqual(order.droppedForShots)
    for (const section of order.droppedForShots) {
      expect(REQUIRED_SECTIONS).not.toContain(section)
      expect(order.issues).toContain(`컷 상한(${PAGE_SHOT_MAX}장)으로 뺌: ${section}`)
    }
  })
})
