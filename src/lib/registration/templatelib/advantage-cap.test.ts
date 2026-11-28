/**
 * 장점류 상한(적용 K3 T1-43, 통합 11-03 05:38·09:1x) — 놓인 페이지의 장점류가 7개·높이 비중 0.40을 넘으면 빠진 입력 정보 섹션으로 끝쪽 장점류 하나를 바꿔
 * 다시 풀고, 못 바꾸면 그대로 두며 사유를 남긴다(자르지 않음). 넘지 않은 페이지는 손대지 않는다. AI 단계는 가짜다(유료 호출 0).
 */

import { describe, expect, it } from 'vitest'
import { getPdpTestProduct } from '../__fixtures__/pdp-products'
import { POINT_FAMILY_SECTIONS } from '../eval/plan-metrics'
import type { PdpJobRow } from '../pdp-state'
import { ADVANTAGE_MAX, ADVANTAGE_SECTIONS, ADVANTAGE_SHARE_MAX, advantageOf, capAdvantages, overAdvantage } from './advantage-cap'
import { conceptById } from './concepts'
import { lineInputsOf } from './input-values'
import { TEMPLATES } from './library'
import { selectTemplateLine, type TemplateAgents } from './select-line'
import type { OrderInput, OrderResult } from './selection-order'
import type { TemplateMeta } from './template-meta'

const H = 1000
const heightOf = () => H
const orderOf = (sections: readonly string[], meetsRequired = true): OrderResult => ({
  sections: sections.map((section) => ({ section, templateId: section, bg: 'W', shots: [] })),
  issues: [],
  droppedForFacts: [],
  droppedForShots: [],
  height: { estimated: sections.length * H, meetsRequired },
})
const inputOf = (section: string): OrderInput => ({ section, candidates: [] })
const BASE = ['hook_3step', 'main_cut', 'problem_raise', 'solution_guide', 'review', 'faq', 'convert_div', 'cta', 'spec_table']
const EIGHT = ['key_message', 'point_div', 'point_div', 'point_div', 'sub_div', 'hidden_page', 'compare', 'point_list_div']
/** 장점류 8개 + 본문 12개 = 20섹션(비중 0.40) */
const PAGE = [...BASE.slice(0, 4), ...EIGHT, 'option_gallery', 'petit_div', 'sub2_div_page', ...BASE.slice(4)]
/** 시험용 순서 풀이 — 입력을 그대로 놓되 drop에 든 섹션은 뺀다 */
const solveAs = (drop: readonly string[] = [], meetsRequired = true) => (inputs: readonly OrderInput[]) =>
  orderOf(inputs.map((i) => i.section).filter((s) => !drop.includes(s)), meetsRequired)

describe('장점류 묶음', () => {
  it('평가(plan-metrics 장점 묶음)와 같은 6종이고 상한은 7개·0.40이다', () => {
    expect([...ADVANTAGE_SECTIONS].sort()).toEqual([...POINT_FAMILY_SECTIONS].sort())
    expect([ADVANTAGE_MAX, ADVANTAGE_SHARE_MAX]).toEqual([7, 0.4])
  })

  it('개수·높이 비중을 센다', () => {
    expect(advantageOf(orderOf(PAGE).sections, heightOf)).toEqual({ count: 8, share: 0.4 })
    expect(overAdvantage({ count: 8, share: 0.3 })).toBe(true)
    expect(overAdvantage({ count: 7, share: 0.41 })).toBe(true)
    expect(overAdvantage({ count: 7, share: 0.4 })).toBe(false)
  })
})

describe('고치기', () => {
  const inputs = PAGE.map(inputOf)

  it('넘지 않으면 손대지 않는다(경고 없음)', () => {
    const seven = PAGE.filter((s) => s !== 'point_list_div')
    expect(capAdvantages(orderOf(seven), seven.map(inputOf), ['how_to'], inputOf, solveAs(), heightOf)).toBeNull()
  })

  it('빠진 정보 섹션이 있으면 끝쪽 장점류 하나를 바꿔 다시 푼다 — 큰 POINT 3 그대로', () => {
    const out = capAdvantages(orderOf(PAGE), inputs, ['how_to'], inputOf, solveAs(), heightOf)!
    expect(out.warning).toBe('장점류 8개·비중 0.4 → 7개·0.35: point_list_div 대신 how_to')
    const placed = out.order.sections.map((s) => s.section)
    expect(placed).toContain('how_to')
    expect(placed).not.toContain('point_list_div')
    expect(placed.filter((s) => s === 'point_div').length).toBe(3)
    expect(placed.length).toBe(PAGE.length)
    expect(out.inputs.map((i) => i.section)).toContain('how_to')
  })

  it('입력에 이미 있는 정보 섹션(순서 풀이가 뺀 것)은 다시 더하지 않고 장점류만 뺀다', () => {
    const withHowTo = [...inputs, inputOf('how_to')]
    const out = capAdvantages(orderOf(PAGE), withHowTo, ['how_to'], inputOf, solveAs(), heightOf)!
    expect(out.inputs.filter((i) => i.section === 'how_to').length).toBe(1)
    expect(out.warning).toContain('point_list_div 대신 how_to')
  })

  it('바꿀 정보 섹션이 없으면 그대로 두고 사유를 남긴다 — 자르지 않는다', () => {
    const order = orderOf(PAGE)
    for (const info of [[], ['option_gallery']]) {
      const out = capAdvantages(order, inputs, info, inputOf, solveAs(), heightOf)!
      expect(out.order).toBe(order)
      expect(out.warning).toBe('장점류 8개·비중 0.4 그대로: 바꿀 입력 정보 섹션 없음')
    }
  })

  it('다시 풀어도 정보 섹션이 빠지거나 합격점이 새로 미달이면 그대로 둔다(사유)', () => {
    const order = orderOf(PAGE)
    expect(capAdvantages(order, inputs, ['how_to'], inputOf, solveAs(['how_to']), heightOf)!.warning).toBe('장점류 8개·비중 0.4 그대로: point_list_div 대신 how_to 다시 빠짐')
    expect(capAdvantages(order, inputs, ['how_to'], inputOf, solveAs([], false), heightOf)!.warning).toBe('장점류 8개·비중 0.4 그대로: point_list_div 대신 how_to 합격점 미달')
  })

  it('다른 규칙을 나쁘게 하면(guard 사유) 그대로 둔다 — 선택 흐름은 짙은 면 수', () => {
    const out = capAdvantages(orderOf(PAGE), inputs, ['how_to'], inputOf, solveAs(), heightOf, () => '짙은 면 줄어듦')!
    expect(out.warning).toBe('장점류 8개·비중 0.4 그대로: point_list_div 대신 how_to 짙은 면 줄어듦')
  })

  it('첫 정보 섹션이 안 되면 다음 것을 해 본다', () => {
    const out = capAdvantages(orderOf(PAGE), inputs, ['how_to', 'ingredients'], inputOf, solveAs(['how_to']), heightOf)!
    expect(out.warning).toContain('point_list_div 대신 ingredients')
  })

  it('큰 POINT만 남았으면 빼지 않는다', () => {
    const points = [...BASE, 'point_div', 'point_div', 'point_div', 'point_div', 'point_div', 'point_div', 'point_div', 'point_div']
    expect(capAdvantages(orderOf(points), points.map(inputOf), ['how_to'], inputOf, solveAs(), heightOf)!.warning).toContain('뺄 수 있는 장점류 없음')
  })
})

describe('시험 상품 — 쪽마다 사유', () => {
  const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
  const run = async (id: string, conceptId: string) => {
    const product = getPdpTestProduct(id)
    const concept = conceptById(conceptId)!
    const agents = {
      guideline: async () => free({ persona: '', tone: '', concept: { id: concept.id, reason: '' }, alternatives: [] }),
      compose: async () => free([]),
      select: async ({ slots }: { slots: Array<{ index: number; candidates: Array<{ id: string }> }> }) => free(slots.map((s) => ({ index: s.index, templateId: s.candidates[0].id, reason: '' }))),
    } as unknown as TemplateAgents
    const inputs = lineInputsOf({ spec_sheet: product.specSheet, analysis: {}, copy_sections: { final: { options: product.specSheet.colorOptions ?? [] } } } as unknown as PdpJobRow)
    return selectTemplateLine(
      { key: id, categoryKey: product.categoryKey, productHex: null, spec: product.specSheet, templates: TEMPLATES as unknown as TemplateMeta[], inputs, product: { category: product.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] } },
      agents
    )
  }
  const heights = new Map(TEMPLATES.map((t) => [t.id, (t as unknown as TemplateMeta).height]))
  const loadOf = (out: Awaited<ReturnType<typeof run>>) => advantageOf(out.order.sections, (id) => heights.get(id) ?? 0)

  it(
    '사용법 근거 상품(P09)은 끝쪽 장점류를 사용법으로 바꾸고, 근거 없는 상품(P02)은 그대로 두며 사유를 남긴다, 넘지 않은 쪽은 경고가 없다',
    async () => {
      // cool-aqua — editorial은 K7-c 고민 칸(problem_raise.photo-arrow)이 고민 자리에 들면서 구성이 바뀌어 같은 바꿈이 짙은 면 가드에 걸린다(그대로 경고).
      // 전에 쓰던 champagne은 digital 키 칸(K5 ④)이 들어 장점류 7개(상한 안)가 되어 바꾸지 않는다 — 아래에서 따로 본다
      const p09 = await run('P09', 'cool-aqua')
      expect(p09.warnings.some((w) => /^장점류 8개·비중 [\d.]+ → 7개·[\d.]+: \w+ 대신 how_to$/.test(w)), p09.warnings.join('\n')).toBe(true)
      expect(p09.order.sections.map((s) => s.section)).toContain('how_to')
      expect(loadOf(p09).count).toBeLessThanOrEqual(ADVANTAGE_MAX)
      const champagne = await run('P09', 'champagne')
      expect(loadOf(champagne).count).toBe(ADVANTAGE_MAX)
      expect(champagne.warnings.some((w) => w.startsWith('장점류')), champagne.warnings.join('\n')).toBe(false)
      const p02 = await run('P02', 'clean-trust')
      expect(p02.warnings.some((w) => /^장점류 8개·비중 [\d.]+ 그대로: 바꿀 입력 정보 섹션 없음$/.test(w)), p02.warnings.join('\n')).toBe(true)
      const p01 = await run('P01', 'clean-trust')
      expect(overAdvantage(loadOf(p01))).toBe(false)
      expect(p01.warnings.some((w) => w.startsWith('장점류'))).toBe(false)
    },
    30_000
  )
})
