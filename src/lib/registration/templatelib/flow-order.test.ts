import { describe, expect, it } from 'vitest'
import { buildComposePrompt, SECTION_PURPOSES } from '../../agents/registration/prompts/pdp-template-prompts'
import { getPdpTestProduct, PDP_TEST_PRODUCT_IDS } from '../__fixtures__/pdp-products'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { CONCEPTS } from './concepts'
import { hasSizeDiagram, lineInputsOf, type LineInputs } from './input-values'
import { TEMPLATES, templateById } from './library'
import { selectTemplateLine, type TemplateAgents } from './select-line'
import { candidatesFor, repairComposition, type SelectionProfile } from './selection'
import { solveOrder, type OrderInput } from './selection-order'
import { PAGE_SECTIONS, type TemplateMeta } from './template-meta'
import { yieldToEventLoop } from './__test__/yield'

const library = TEMPLATES as unknown as TemplateMeta[]
const concept = CONCEPTS[0]
const stub = (section: string, zone: TemplateMeta['order']['zone'] = 'value', id = `${section}.a`): TemplateMeta => ({
  id,
  section,
  name: id,
  surfaces: ['W'],
  slots: {},
  signature: { columns: 1, photo: id, align: 'left', container: id },
  needs: { photos: 0, evidence: [] },
  height: 1000,
  fit: { concepts: [concept.id], density: 'mid', categoryBlock: [] },
  order: { zone, notNextTo: [] },
  check: { avgScore: null, usedIn: 0 },
})
const one = (section: string, zone?: TemplateMeta['order']['zone'], id?: string): OrderInput => ({ section, candidates: [stub(section, zone, id)] })
const sectionsOf = (inputs: OrderInput[]) => solveOrder(inputs, concept).sections.map((s) => s.section)

describe('자리 띠', () => {
  it('근거를 큰 POINT 뒤로, 옵션·추천을 뒤로, 표를 맨 끝으로 놓는다', () => {
    const order = sectionsOf([
      one('spec_table', 'trust'),
      one('cta', 'decision'),
      one('faq', 'trust'),
      one('direction_suggest'),
      one('option_gallery'),
      one('certification', 'trust'),
      one('sub_div'),
      one('review', 'trust'),
      one('point_div', 'value', 'point_div.a'),
      one('solution_guide'),
      one('problem_raise', 'problem'),
      one('main_cut', 'intro'),
      one('hook_3step', 'intro'),
    ])
    expect(order).toEqual(['hook_3step', 'main_cut', 'problem_raise', 'solution_guide', 'point_div', 'review', 'certification', 'sub_div', 'option_gallery', 'direction_suggest', 'faq', 'cta', 'spec_table'])
  })

  it('같은 띠는 들어온 순서이고, 표에 없는 섹션은 구역으로 자리를 정한다', () => {
    expect(sectionsOf([one('hidden_page'), one('compare')])).toEqual(['hidden_page', 'compare'])
    expect(sectionsOf([one('compare'), one('hidden_page')])).toEqual(['compare', 'hidden_page'])
    expect(sectionsOf([one('new_section', 'decision'), one('sub_div'), one('other_section', 'intro')])).toEqual(['other_section', 'sub_div', 'new_section'])
  })

  it('how_to는 추천 뒤, 크기 컷 앞이다(분석 2차 A1 2절, 표에 없으면 구역 자리로 밀려 추천 앞에 온다)', () => {
    expect(sectionsOf([one('product_exposure'), one('how_to'), one('direction_suggest')])).toEqual(['direction_suggest', 'how_to', 'product_exposure'])
  })

  it('how_to 구성 설명은 입력에 없는 순서를 쓰지 말라고 말한다', () => {
    expect(SECTION_PURPOSES.how_to).toContain('입력에 없는 순서')
  })

  it('쓰는 법 근거가 없는 상품은 how_to 후보가 없고, 있으면 5개다 — 사용 순서 입력 칸(K7-c (나))은 입력 맞춤을 고를 때 본다', () => {
    const profile = (evidence: string[]): SelectionProfile => ({ key: 'x', categoryKey: 'household', photoCount: 10, productHex: null, evidence: new Set(evidence) })
    expect(candidatesFor('how_to', library, profile([]), concept, 5)).toEqual([])
    expect(candidatesFor('how_to', library, profile(['usage']), concept, 5)).toHaveLength(5)
  })

  it('둘째 후기는 질문 자리로 간다', () => {
    const order = sectionsOf([one('review', 'trust', 'review.a'), one('faq', 'trust'), one('review', 'trust', 'review.b'), one('sub_div'), one('point_div', 'value', 'point_div.a')])
    expect(order).toEqual(['point_div', 'review', 'sub_div', 'faq', 'review'])
  })

  it('전환 섹션은 마무리에 붙지 않고, 놓은 뒤에 붙으면 앞으로 옮긴다', () => {
    expect(sectionsOf([one('cta', 'decision'), one('convert_div', 'decision'), one('sub_div')])).toEqual(['convert_div', 'sub_div', 'cta'])
    // 앞이 큰 POINT면 옮기지 않는다
    expect(sectionsOf([one('cta', 'decision'), one('convert_div', 'decision'), one('point_div', 'value', 'point_div.a')])).toEqual(['point_div', 'convert_div', 'cta'])
    expect(sectionsOf([one('cta', 'decision'), one('convert_div', 'decision')])).toEqual(['convert_div', 'cta'])
  })
})

describe('구성 고치기', () => {
  const open = ['hook_3step', 'problem_raise', 'problem_empathy', 'event_offer', 'spec_table', 'cta']

  it('고민 섹션은 합쳐 하나, 행사는 하나만 남긴다', () => {
    const { sections, removed } = repairComposition(['hook_3step', 'problem_empathy', 'problem_raise', 'event_offer', 'event_offer', 'spec_table', 'cta'], new Set(), open)
    expect(sections.filter((s) => s.startsWith('problem_'))).toEqual(['problem_empathy'])
    expect(sections.filter((s) => s === 'event_offer')).toHaveLength(1)
    expect(removed).toEqual(['problem_raise', 'event_offer'])
  })

  it('구성 프롬프트가 같은 규칙을 말하고, 첫 화면 목적이 고민으로 밀지 않는다', () => {
    const prompt = buildComposePrompt({
      product: { category: 'x', persona: null, summary: '', keywords: [], usps: [], pains: [] },
      guideline: { persona: '', tone: '' },
      open: ['hook_3step'],
      facts: { count: 3, places: 3 },
      range: { min: 18, max: 22 },
    })
    expect(prompt).toContain('problem_raise·problem_empathy는 합쳐 한 번만')
    expect(SECTION_PURPOSES.hook_3step).not.toContain('고민')
  })
})

describe('치수 끝자리', () => {
  const profile = (over: Partial<SelectionProfile> = {}): SelectionProfile => ({ key: 'P', categoryKey: getPdpTestProduct('P07').categoryKey, photoCount: 9, productHex: null, evidence: new Set(['size']), ...over })

  it('방향이 확실한 치수가 있으면 표 후보는 치수 도식이 있는 것뿐이다', () => {
    // 치수 도식 표는 셋이다 — 좌우 표(dimension)와 가운데 줄 표(dimension-center, K11 치수 변형), 3축 상자 + 왼쪽 줄 표(dimension-box, K7-c 4c — 깊이 입력이 있을 때만)
    const diagrams = ['spec_table.dimension', 'spec_table.dimension-box', 'spec_table.dimension-center']
    expect(candidatesFor('spec_table', library, profile({ sizeDiagram: true }), concept).map((t) => t.id).sort()).toEqual(diagrams)
    expect(candidatesFor('spec_table', library, profile(), concept).length).toBeGreaterThan(1)
    // 그런 템플릿을 못 쓰면 전체에서 고른다 — 표가 빠지지 않는다
    expect(candidatesFor('spec_table', library, profile({ sizeDiagram: true, drawable: (t) => !diagrams.includes(t.id) }), concept).length).toBeGreaterThan(1)
    // 다른 섹션은 그대로다
    expect(candidatesFor('faq', library, profile({ sizeDiagram: true, evidence: new Set(['size', 'faq']) }), concept).length).toBeGreaterThan(1)
  })

  it('방향을 모르는 값은 도식을 열지 않는다', () => {
    const inputsOf = (size: string) => ({ spec: { size } as PdpSpecSheet })
    expect(hasSizeDiagram(inputsOf('34cm x 19.5cm x 12.5cm'))).toBe(true)
    expect(hasSizeDiagram(inputsOf('고리 21.4cm, 펼침 37.3cm'))).toBe(false)
    expect(hasSizeDiagram({ spec: {} as PdpSpecSheet })).toBe(false)
  })
})

describe('시험 상품', () => {
  const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
  const agents = {
    guideline: async ({ concepts }: { concepts: Array<{ id: string }> }) => free({ persona: '', tone: '', concept: { id: concepts[0].id, reason: '' }, alternatives: [] }),
    compose: async () => free([]),
    select: async ({ slots }: { slots: Array<{ index: number; candidates: Array<{ id: string }> }> }) => free(slots.map((s) => ({ index: s.index, templateId: s.candidates[0].id, reason: '' }))),
  } as unknown as TemplateAgents
  const CLOSERS = new Set(['convert_div', 'cta', 'event_offer'])
  const QUOTES = [1, 2, 3, 4].map((i) => ({ text: `후기 ${i}`, source: 'own' }))
  const CARDS = [1, 2, 3, 4].map((i) => ({ text: `후기 글 ${i}`, author: `고객${i}`, rating: 5 }))

  const selectFor = async (id: (typeof PDP_TEST_PRODUCT_IDS)[number], withProof: boolean) => {
    const product = getPdpTestProduct(id)
    const spec = (withProof ? { ...product.specSheet, reviewQuotes: QUOTES, rating: 4.8, reviewCount: 120, certificationInfo: '시험 성적서 있음' } : product.specSheet) as PdpSpecSheet
    const base = lineInputsOf({ spec_sheet: spec, analysis: {}, copy_sections: { final: { options: spec.colorOptions ?? [] } } } as unknown as PdpJobRow)
    const inputs: LineInputs = withProof ? { ...base, cards: CARDS } : base
    return selectTemplateLine(
      { key: id, categoryKey: product.categoryKey, productHex: null, spec, templates: library, inputs, product: { category: product.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] } },
      agents
    )
  }

  it('11상품 구성이 자리 규칙을 지킨다', async () => {
    for (const id of PDP_TEST_PRODUCT_IDS) {
      await yieldToEventLoop()
      const { order, warnings } = await selectFor(id, false)
      const sections = order.sections.map((s) => s.section)
      expect(sections.at(-1), id).toBe('spec_table')
      expect(sections[0], id).toBe('hook_3step')
      expect(sections.slice(-4, -1).filter((s) => CLOSERS.has(s)).length, id).toBeLessThanOrEqual(2)
      expect(sections.some((s, i) => s === 'cta' && sections[i - 1] === 'convert_div'), id).toBe(false)
      const problems = sections.filter((s) => s.startsWith('problem_')).length
      const excepted = warnings.some((w) => w.startsWith('고민 상한 예외'))
      expect(problems, id).toBe(excepted ? 2 : 1)
      if (excepted) expect(order.height.estimated, id).toBeGreaterThan(0)
      const inputs = lineInputsOf({ spec_sheet: getPdpTestProduct(id).specSheet, analysis: {}, copy_sections: { final: {} } } as unknown as PdpJobRow)
      if (hasSizeDiagram(inputs)) expect(['spec_table.dimension', 'spec_table.dimension-center', 'spec_table.dimension-box'], id).toContain(order.sections.at(-1)?.templateId)
      expect(templateById(order.sections.at(-1)?.templateId ?? ''), id).toBeTruthy()
    }
  }, 60000)

  it('섹션이 18개 미만이면 길이가 합격점이어도 고민 섹션을 하나 더한다(K12 #5, P11)', async () => {
    const { order, warnings } = await selectFor('P11', false)
    expect(warnings.filter((w) => w.startsWith('고민 상한 예외'))).toEqual([expect.stringMatching(/, 섹션 17 → 18$/)])
    expect(order.sections).toHaveLength(PAGE_SECTIONS.min)
    expect(order.sections.filter((s) => s.section.startsWith('problem_'))).toHaveLength(2)
    expect(order.height.meetsRequired).toBe(true)
  }, 60000)

  it('근거가 있으면 첫 근거 0.45 이하, 인증 0.6 이하다', async () => {
    for (const id of PDP_TEST_PRODUCT_IDS) {
      await yieldToEventLoop()
      const { order } = await selectFor(id, true)
      const sections = order.sections.map((s) => s.section)
      const at = (test: (s: string) => boolean) => sections.findIndex(test) / (sections.length - 1)
      expect(sections, id).toContain('review')
      expect(at((s) => s === 'review' || s === 'certification' || s === 'perf_metric'), id).toBeLessThanOrEqual(0.45)
      if (sections.includes('certification')) expect(at((s) => s === 'certification'), id).toBeLessThanOrEqual(0.6)
    }
  }, 60000)
})
