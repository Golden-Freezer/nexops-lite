/**
 * K 라인 선택 흐름 — 단계 연결, 콜 실패 때 코드 후보로 끝까지, 구성 고치기. AI 단계는 가짜다(유료 호출 0).
 */

import { describe, expect, it, vi } from 'vitest'
import { PDP_TEST_PRODUCT_IDS, getPdpTestProduct } from '../__fixtures__/pdp-products'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { templateLineLedger } from '../__e2e__/template-ledger'
import { CONCEPTS } from './concepts'
import { lineInputsOf } from './input-values'
import { TEMPLATES } from './library'
import { CONCEPTS_SHOWN, lineFactsOf, selectLineInputOf, selectTemplateLine, type TemplateAgents } from './select-line'
import { compositionIssues, defaultComposition, repairComposition, stableHash } from './selection'
import { evidenceOf, factsOf } from './selection-facts'
import { tpl } from './selection.fixture'
import { FACT_FREE_FILLERS, FILLER_MAX, FILLER_SHORT_EXTRA, RENDER_HEIGHT_RATIO } from './selection-order'
import { K_SECTIONS, PAGE_MIN_HEIGHT, PAGE_SECTIONS, type TemplateMeta } from './template-meta'

const product = { category: 'household', persona: '자취생', summary: '', keywords: [], usps: [], pains: [] }
const spec = { material: '면', size: '10cm', keyFeatures: ['가벼워요', '접혀요'] } as unknown as PdpSpecSheet
const zoneOf: Record<string, TemplateMeta['order']['zone']> = { hook_3step: 'intro', problem_raise: 'problem', review: 'trust', spec_table: 'trust', cta: 'decision' }

/** 섹션마다 템플릿 몇 개 — 모양이 다르다 */
const library = (height = 1700, count = 6): TemplateMeta[] =>
  K_SECTIONS.flatMap((section) =>
    Array.from({ length: count }, (_, i) => tpl(`${section}.t${i}`, { section, zone: zoneOf[section] ?? 'value', height, evidence: section === 'review' ? ['review'] : [] }))
  )

const input = (over = {}) => ({ key: 'P01', categoryKey: 'household', productHex: null, spec, product, templates: library(), ...over })

const okAgents = (over: Partial<TemplateAgents> = {}): TemplateAgents => ({
  guideline: async ({ concepts }) => ({
    value: { persona: '자취생', tone: '담백', concept: { id: concepts[1].id, reason: '이유' }, alternatives: [concepts[2].id] },
    usedFallback: false,
    error: null,
    costUsd: 0.01,
  }),
  compose: async () => ({ value: ['hook_3step', 'main_cut', 'problem_raise', 'solution_guide', 'key_message', 'point_div', 'point_div', 'point_div', 'sub_div', 'hidden_page', 'option_gallery', 'concept_desc', 'convert_div', 'spec_table', 'cta'], usedFallback: false, error: null, costUsd: 0.02 }),
  select: async ({ slots }) => ({
    value: slots.filter((s) => s.section === 'cta').map((s) => ({ index: s.index, templateId: s.candidates.at(-1)!.id, reason: '마무리' })),
    usedFallback: false,
    error: null,
    costUsd: 0.03,
  }),
  ...over,
})

describe('카테고리 글꼴 짝 — 식품 손글씨(적용 T1-81)', () => {
  const guideline = async () => ({ value: { persona: 'p', tone: 't', concept: { id: 'honest-kraft', reason: 'r' }, alternatives: [] }, usedFallback: false, error: null, costUsd: 0 })

  it('식품에서 손맛 컨셉을 고르면 계획·기록 모두 손글씨 짝이다', async () => {
    const out = await selectTemplateLine(input({ categoryKey: 'food' }), okAgents({ guideline }))
    expect(out.concept.id).toBe('honest-kraft')
    expect(out.concept.fontPair).toBe('hand-gaegu')
    expect(out.record.fontPair).toEqual({ id: 'hand-gaegu' })
  })

  it('같은 컨셉도 식품이 아니면 지금 짝 그대로다', async () => {
    const out = await selectTemplateLine(input({ categoryKey: 'household' }), okAgents({ guideline }))
    expect(out.concept.id).toBe('honest-kraft')
    expect(out.concept.fontPair).toBe('gothic-paperlogy')
    expect(out.record.fontPair).toEqual({ id: 'gothic-paperlogy' })
  })
})

describe('첫 화면 붙인 컷 템플릿(적용 K6 R-K15)', () => {
  const attached = {
    must: { type: 'text' as const, required: true, source: 'copy' as const, facts: 0 },
    photo: { type: 'image' as const, required: true, purpose: ['state', 'hero'], composition: ['in_use', 'top', 'front'] },
  }
  /** hook 템플릿 앞 count개의 첫 사진 칸을 붙인 컷(맨 앞 목적 state)으로 */
  const withAttached = (count: number) => library().map((t) => (t.section === 'hook_3step' && Number(t.id.slice(-1)) < count ? { ...t, slots: attached } : t))
  const attachedIds = (count: number) => Array.from({ length: count }, (_, i) => `hook_3step.t${i}`)
  const hookOf = async (over: object) => {
    let seen: string[] = []
    const select: TemplateAgents['select'] = async ({ slots }) => {
      seen = slots.find((s) => s.section === 'hook_3step')!.candidates.map((c) => c.id)
      return { value: slots.map((s) => ({ index: s.index, templateId: s.candidates[0].id, reason: '' })), usedFallback: false, error: null, costUsd: 0 }
    }
    const out = await selectTemplateLine(input(over), okAgents({ select }))
    return { seen, placed: out.order.sections[0].templateId }
  }

  it('첫 화면 유형이 스튜디오면 붙인 컷 hook 템플릿을 후보에서 빼고, 쓰는 모습 유형이면 후보가 그대로다', async () => {
    const plain = await hookOf({ categoryKey: 'stationery', templates: library() })
    expect(plain.seen.some((id) => attachedIds(2).includes(id))).toBe(true)
    const studio = await hookOf({ categoryKey: 'stationery', templates: withAttached(2) })
    expect(studio.seen.length).toBeGreaterThan(0)
    expect(studio.seen.filter((id) => attachedIds(2).includes(id))).toEqual([])
    expect(attachedIds(2)).not.toContain(studio.placed)
    const inUse = await hookOf({ categoryKey: 'household', templates: withAttached(2) })
    expect(inUse.seen).toEqual((await hookOf({ categoryKey: 'household', templates: library() })).seen)
  })

  it('화장품은 K 첫 화면 유형이 스튜디오라 붙인 컷을 뺀다 — 같은 뷰티라도 도구는 쓰는 모습 그대로다(적용 K6 T1-80 ②)', async () => {
    const cosmetic = { categoryKey: 'beauty', spec: { ...spec, productName: '수분 크림' } }
    const tool = { categoryKey: 'beauty', spec: { ...spec, productName: '두피 브러쉬' } }
    expect((await selectTemplateLine(input(cosmetic), okAgents())).shotContext.heroKind).toBe('studio')
    expect((await selectTemplateLine(input(tool), okAgents())).shotContext.heroKind).toBe('in_use')
    const studio = await hookOf({ ...cosmetic, templates: withAttached(2) })
    expect(studio.seen.length).toBeGreaterThan(0)
    expect(studio.seen.filter((id) => attachedIds(2).includes(id))).toEqual([])
    expect((await hookOf({ ...tool, templates: withAttached(2) })).seen).toEqual((await hookOf({ ...tool, templates: library() })).seen)
  })

  it('빼서 hook 후보가 비면 지금 후보 그대로 둔다', async () => {
    const all = await hookOf({ categoryKey: 'stationery', templates: withAttached(6) })
    const plain = await hookOf({ categoryKey: 'stationery', templates: library() })
    expect(all.seen.length).toBeGreaterThan(0)
    expect(all.seen).toEqual(plain.seen)
    expect(all.placed).toBe(plain.placed)
  })
})

describe('선택 흐름', () => {
  it('재료 이름이 입력에 있을 때만 재료 컷을 고른다', async () => {
    const slots = {
      must: { type: 'text' as const, required: true, source: 'copy' as const, facts: 0 },
      photo: { type: 'image' as const, required: true, purpose: ['ingredient', 'scene'], composition: ['front'] },
    }
    const templates = library().map((t) => ({ ...t, slots }))
    const purposes = async (extra: Partial<PdpSpecSheet>) => {
      const out = await selectTemplateLine(input({ templates, spec: { ...spec, ...extra } }), okAgents())
      return out.order.sections.flatMap((section) => section.shots).map((shot) => shot.purpose)
    }
    expect(await purposes({})).not.toContain('ingredient')
    expect(await purposes({ extraSpecs: [{ key: '원재료', value: '상세페이지 참조' }] })).not.toContain('ingredient')
    expect(await purposes({ extraSpecs: [{ key: '소재', value: '면' }] })).not.toContain('ingredient')
    expect(await purposes({ extraSpecs: [{ key: '원재료', value: '설탕, 소금' }] })).toContain('ingredient')
  })

  it('세 단계를 이어 기록을 만든다 — 비용을 더하고, 컨셉·대안·색·글꼴을 남기고, 원장이 읽는다', async () => {
    const guideline = vi.fn(okAgents().guideline)
    const out = await selectTemplateLine(input(), okAgents({ guideline }))
    expect(out.costUsd).toBeCloseTo(0.06)
    expect(out.concept.id).toBe(guideline.mock.calls[0][0].concepts[1].id)
    expect(out.record.concept.id).toBe(out.concept.id)
    expect(out.record.concept.reason).toBe('이유')
    expect(out.record.guideline).toEqual({ persona: '자취생', tone: '담백' })
    expect(out.record.palette.id).toBe(out.palette.id)
    expect(out.palette.conceptId).toBe(out.concept.id)
    expect(templateLineLedger({ templatelib: out.record }).templateLine?.concept).toBe(out.concept.id)
    expect(out.warnings).toEqual([])
    expect(JSON.parse(JSON.stringify(out.record))).toEqual(out.record)
  })

  it('고른 템플릿을 그 자리의 첫 후보로 쓰고 이유를 남긴다', async () => {
    const select = vi.fn(okAgents().select)
    const out = await selectTemplateLine(input(), okAgents({ select }))
    const slot = select.mock.calls[0][0].slots.find((s) => s.section === 'cta')!
    const cta = out.record.sections.find((s) => s.section === 'cta')!
    expect(cta.templateId).toBe(slot.candidates.at(-1)!.id)
    expect(cta.reason).toBe('마무리')
    expect(cta).not.toHaveProperty('fallbackFrom')
  })

  it('구성이 적어도 채움으로 긴 페이지 기준을 맞춘다', async () => {
    const out = await selectTemplateLine(input(), okAgents())
    expect(out.order.sections.length).toBeGreaterThanOrEqual(PAGE_SECTIONS.min)
    expect(out.order.sections.length).toBeLessThanOrEqual(PAGE_SECTIONS.max)
    expect(out.order.height.estimated).toBeGreaterThanOrEqual(PAGE_MIN_HEIGHT)
    expect(out.order.issues).toEqual([])
    expect(out.order.sections.some((s) => s.filler)).toBe(true)
  })

  it('컨셉 후보를 앞줄만 보여 주고 막힌 컨셉을 뺀다', async () => {
    const guideline = vi.fn(okAgents().guideline)
    await selectTemplateLine(input({ categoryKey: 'pet' }), okAgents({ guideline }))
    const shown = guideline.mock.calls[0][0].concepts
    expect(shown).toHaveLength(CONCEPTS_SHOWN)
    expect(shown.map((c) => c.id)).not.toContain('black-gold')
  })

  it('구성 모델에는 고를 수 있는 섹션만 보여 준다 — 근거 없는 잠금 섹션은 없다', async () => {
    const compose = vi.fn(okAgents().compose)
    await selectTemplateLine(input(), okAgents({ compose }))
    const { open, facts, range } = compose.mock.calls[0][0]
    expect(open).not.toContain('review')
    expect(open).toContain('cta')
    expect(facts).toEqual({ count: 4, places: 6 })
    expect(range).toEqual(PAGE_SECTIONS)
  })

  it('원천 사진 수로 템플릿을 거르지 않는다 — 사진을 여럿 요구하는 템플릿도 후보다', async () => {
    const select = vi.fn(okAgents().select)
    const templates = [...library(), tpl('cta.grid', { section: 'cta', zone: 'decision', photos: 3, concepts: CONCEPTS.map((c) => c.id) })]
    await selectTemplateLine(input({ templates }), okAgents({ select }))
    const slot = select.mock.calls[0][0].slots.find((s) => s.section === 'cta')!
    expect(slot.candidates.map((t) => t.id)).toContain('cta.grid')
  })

  it('채움은 상위 5개에 들지 않은 후보까지 쓴다', async () => {
    const onlyPetit = (id: string) => tpl(id, { section: 'petit_div', zone: 'value', height: 1700 })
    const templates = [...library(1700, 1).filter((t) => t.section !== 'petit_div'), ...Array.from({ length: 9 }, (_, i) => onlyPetit(`petit_div.t${i}`))]
    const pickFirst = (ids: string[]) => ids.filter((id) => id.startsWith('petit_div.'))
    const out = await selectTemplateLine(input({ templates }), okAgents())
    const used = pickFirst(out.record.sections.filter((s) => s.filler).map((s) => s.templateId))
    expect(used.length).toBeGreaterThan(0)
    expect(out.record.sections.filter((s) => s.filler).length).toBe(FILLER_MAX)
  })

  it('구성 고치기가 채움 섹션을 상한까지만 남긴다', () => {
    const open = ['hook_3step', 'sub2_div_page', 'petit_div', 'spec_table', 'cta']
    const { sections, removed } = repairComposition(['hook_3step', ...Array.from({ length: 6 }, () => 'sub2_div_page'), 'spec_table', 'cta'], new Set(), open)
    expect(sections.filter((s) => s === 'sub2_div_page')).toHaveLength(FILLER_MAX)
    expect(removed).toEqual(['sub2_div_page', 'sub2_div_page'])
  })

  it('합격점 위 페이지는 채움을 더 받지 않는다(적용 K14)', async () => {
    const out = await selectTemplateLine(input({ templates: library(2000, 6) }), okAgents())
    expect(out.order.height.meetsRequired).toBe(true)
    expect(out.warnings.some((w) => w.startsWith('합격점 아래 채움 더함'))).toBe(false)
    expect(out.record.sections.filter((s) => s.filler).length).toBeLessThanOrEqual(FILLER_MAX)
  })

  it('예외를 다 보고도 합격점 아래인 페이지만 채움을 하나 더 받고, 그래도 모자라면 issues로 남긴다(적용 K14)', async () => {
    const compose: TemplateAgents['compose'] = async () => ({ value: ['hook_3step', 'point_div', 'sub_div', 'key_message', 'hidden_page', 'concept_desc', 'spec_table', 'cta'], usedFallback: false, error: null, costUsd: 0 })
    const out = await selectTemplateLine(input(), okAgents({ compose }))
    const count = out.record.sections.length
    expect(out.record.sections.filter((s) => s.filler).length).toBe(FILLER_MAX + FILLER_SHORT_EXTRA)
    expect(out.warnings.some((w) => w.startsWith('합격점 아래 채움 더함'))).toBe(true)
    expect(out.order.issues).toEqual([`섹션 ${count}개(18~22)`, `페이지 높이 ${Math.round(count * 1700 * RENDER_HEIGHT_RATIO)}(통과선 25000 미달)`])
    expect(out.warnings).toEqual(expect.arrayContaining(out.order.issues))
  })

  it('사실 예산을 넘겨 사실이 없는 상품은 사실을 요구하는 섹션을 뺀다', async () => {
    const needy = K_SECTIONS.map((section) => tpl(`${section}.fact`, { section, zone: zoneOf[section] ?? 'value', facts: section === 'point_div' ? [3, 3] : [0, 0], evidence: section === 'review' ? ['review'] : [] }))
    const compose: TemplateAgents['compose'] = async () => ({ value: ['hook_3step', 'point_div', 'spec_table', 'cta'], usedFallback: false, error: null, costUsd: 0 })
    const out = await selectTemplateLine(input({ spec: {} as PdpSpecSheet, templates: needy }), okAgents({ compose }))
    expect(out.order.droppedForFacts).toEqual(['point_div'])
    expect(out.record.sections.every((s) => s.factSlots === 0)).toBe(true)
  })

  it('자료가 있으면 후기가 빠져도 넣고, 고친 내용을 경고로 남긴다', async () => {
    const out = await selectTemplateLine(input({ spec: { ...spec, reviewQuotes: [{ text: 'x' }] } }), okAgents())
    expect(out.record.sections.map((s) => s.section)).toContain('review')
    expect(out.warnings).toEqual(['구성 고침: 뺌 - / 더함 review'])
  })

  it('뺀 섹션도 경고에 적는다', async () => {
    const compose: TemplateAgents['compose'] = async () => ({ value: [...['hook_3step', 'main_cut', 'problem_raise', 'solution_guide', 'key_message', 'point_div', 'point_div', 'point_div', 'sub_div', 'hidden_page', 'option_gallery', 'concept_desc', 'convert_div', 'spec_table', 'cta'], 'review'], usedFallback: false, error: null, costUsd: 0 })
    const out = await selectTemplateLine(input(), okAgents({ compose }))
    expect(out.warnings).toEqual(['구성 고침: 뺌 review / 더함 -'])
  })

  it('고른 것 말고 다른 후보도 뒤에 남아 규칙에 걸리면 넘어간다', async () => {
    const select: TemplateAgents['select'] = async ({ slots }) => ({
      value: slots.filter((s) => s.section === 'point_div').map((s) => ({ index: s.index, templateId: 'point_div.t0', reason: '' })),
      usedFallback: false,
      error: null,
      costUsd: 0,
    })
    const out = await selectTemplateLine(input(), okAgents({ select }))
    const points = out.record.sections.filter((s) => s.section === 'point_div' && !s.filler)
    // 머리 칸이 같아 같은 머리 후보 가운데 안 쓴 템플릿을 먼저 쓴다
    expect(new Set(points.map((s) => s.templateId)).size).toBe(points.length)
    expect(points[0].templateId).toBe('point_div.t0')
    expect(points[1].fallbackFrom).toBe('point_div.t0')
  })

  it('이유가 빈 선택은 이유를 남기지 않는다', async () => {
    const select: TemplateAgents['select'] = async ({ slots }) => ({
      value: slots.filter((s) => s.section === 'cta').map((s) => ({ index: s.index, templateId: s.candidates[0].id, reason: '' })),
      usedFallback: false,
      error: null,
      costUsd: 0,
    })
    const out = await selectTemplateLine(input(), okAgents({ select }))
    expect(out.record.sections.find((s) => s.section === 'cta')).not.toHaveProperty('reason')
    expect(Object.keys(out.record.sections[0])).not.toContain('reason')
  })

  it('콜이 모두 실패해도 코드 후보로 끝까지 가고 사유와 비용을 남긴다', async () => {
    const out = await selectTemplateLine(
      input(),
      okAgents({
        guideline: async ({ concepts }) => ({ value: { persona: '', tone: '', concept: { id: concepts[0].id, reason: '' }, alternatives: [] }, usedFallback: true, error: '가이드 실패', costUsd: 0.001 }),
        compose: async () => ({ value: [], usedFallback: true, error: '구성 실패', costUsd: 0.001 }),
        select: async () => ({ value: [], usedFallback: true, error: '선택 실패', costUsd: 0.001 }),
      })
    )
    // 기본 구성은 장점류 8개라 상한(적용 K3 T1-43) 사유 한 줄이 더 붙는다 — 이 상품은 바꿀 입력 정보 섹션이 없다
    expect(out.warnings.slice(0, 3)).toEqual(['가이드라인: 가이드 실패', '섹션 구성: 구성 실패', '템플릿 선택: 선택 실패'])
    expect(out.warnings.slice(3)).toEqual([expect.stringMatching(/^장점류 8개·비중 [\d.]+ 그대로: 바꿀 입력 정보 섹션 없음$/)])
    expect(out.costUsd).toBeCloseTo(0.003)
    expect(out.order.issues).toEqual([])
    expect(out.record.sections.map((s) => s.section)).toEqual(expect.arrayContaining(['hook_3step', 'spec_table', 'cta']))
    expect(out.record.sections.map((s) => s.section)).not.toContain('review')
  })

  it('모델이 없는 컨셉을 내도 후보 첫째로 간다', async () => {
    const guideline: TemplateAgents['guideline'] = async () => ({ value: { persona: '', tone: '', concept: { id: '없음', reason: '' }, alternatives: [] }, usedFallback: false, error: null, costUsd: 0 })
    const out = await selectTemplateLine(input(), okAgents({ guideline }))
    expect(CONCEPTS.map((c) => c.id)).toContain(out.concept.id)
  })

  it('높이가 모자라면 멈추지 않고 경고로 남긴다', async () => {
    const out = await selectTemplateLine(input({ templates: library(500) }), okAgents())
    expect(out.order.height.meetsRequired).toBe(false)
    expect(out.warnings.join(' ')).toContain('페이지 높이')
  })

  it('상품 정보 표 템플릿이 없으면 구성 검사가 한 번만 경고한다', async () => {
    const templates = library().filter((t) => t.section !== 'spec_table')
    const out = await selectTemplateLine(input({ templates }), okAgents())
    expect(out.warnings.filter((w) => w === '상품 정보 표가 없음')).toHaveLength(1)
    expect(out.order.issues.filter((w) => w === '상품 정보 표가 없음')).toHaveLength(1)
  })

  it('풀이와 구성 검사가 같은 문제를 내도 경고는 한 번이다', async () => {
    const few = library().filter((t) => !['sub2_div_page', 'product_exposure', 'petit_div', 'option_gallery', 'convert_div'].includes(t.section))
    const compose: TemplateAgents['compose'] = async () => ({ value: ['hook_3step', 'spec_table', 'cta'], usedFallback: false, error: null, costUsd: 0 })
    const out = await selectTemplateLine(input({ templates: few }), okAgents({ compose }))
    expect(out.order.issues.filter((issue) => issue === '섹션 3개(18~22)')).toHaveLength(1)
    expect(new Set(out.order.issues).size).toBe(out.order.issues.length)
    const duplicated = out.warnings.filter((w) => w === '섹션 3개(18~22)')
    expect(duplicated).toHaveLength(1)
  })

  it('입력값으로 못 그리는 템플릿은 후보에서 빠진다 — 그 섹션이 후보를 잃으면 구성에도 들지 않는다', async () => {
    const needsOptions = (id: string, section = 'option_gallery') =>
      tpl(id, { section, slots: { names: { type: 'list', required: true, source: 'input', input: 'option.names', min: 2, max: 6, fields: {} } as never } })
    const templates = [...library().filter((t) => t.section !== 'option_gallery'), needsOptions('option_gallery.a')]
    const composeInput = vi.fn<TemplateAgents['compose']>(async () => ({ value: [], usedFallback: false, error: null, costUsd: 0 }))
    const inputsOf = (labels: string[]) => ({ spec, cards: [], options: labels.map((label) => ({ label, image: null })) })
    const none = await selectTemplateLine(input({ templates, inputs: inputsOf(['빨강']) }), okAgents({ compose: composeInput }))
    expect(composeInput.mock.calls[0][0].open).not.toContain('option_gallery')
    expect(none.order.sections.map((s) => s.section)).not.toContain('option_gallery')
    const two = await selectTemplateLine(input({ templates, inputs: inputsOf(['빨강', '파랑']) }), okAgents())
    expect(two.order.sections.map((s) => s.section)).toContain('option_gallery')
  })

  it('입력값을 주지 않으면 입력값 조건을 따지지 않는다', async () => {
    const list = { type: 'list', required: true, source: 'input', input: 'option.names', min: 2, max: 6, fields: {} } as never
    const templates = [...library().filter((t) => t.section !== 'option_gallery'), tpl('option_gallery.a', { section: 'option_gallery', slots: { names: list } })]
    const out = await selectTemplateLine(input({ templates }), okAgents())
    expect(out.order.sections.map((s) => s.section)).toContain('option_gallery')
  })

  it('같은 입력은 같은 결과다', async () => {
    const [a, b] = await Promise.all([selectTemplateLine(input(), okAgents()), selectTemplateLine(input(), okAgents())])
    expect(a.record).toEqual(b.record)
  })

  it('채움 돌리기 — 조건이 같은 채움 가운데 상품·컨셉별 turn 값이 가장 작은 것이 들어간다(개선 #5)', async () => {
    // 합성 라이브러리의 채움은 높이·사진이 같아 turn만 가른다. turn을 안 넘기면 후보 순서 첫째가 늘 들어간다
    const pool = library()
      .filter((t) => (FACT_FREE_FILLERS as readonly string[]).includes(t.section))
      .map((t) => t.id)
    const firsts = new Set<string>()
    for (const key of ['P01', 'P02', 'P03', 'P04', 'P05', 'P06']) {
      const out = await selectTemplateLine(input({ key }), okAgents())
      const turn = (id: string) => stableHash(`${key}:${out.concept.id}:${id}`)
      const first = [...pool].sort((a, b) => turn(a) - turn(b))[0]
      expect(out.order.sections.filter((s) => s.filler).map((s) => s.templateId), key).toContain(first)
      firsts.add(first)
    }
    expect(firsts.size).toBeGreaterThan(1)
  })

  it('고민 상한 예외 — 섹션이 18개 미만이면 길이가 합격점이어도 고민 섹션을 하나 더한다, 18개면 더하지 않는다(K12 #5)', async () => {
    const full = ['hook_3step', 'main_cut', 'problem_raise', 'solution_guide', 'key_message', 'point_div', 'point_div', 'point_div', 'sub_div', 'hidden_page', 'option_gallery', 'concept_desc', 'convert_div', 'spec_table', 'cta']
    // 구성에서 POINT 뒤 섹션을 drop개 뺀다 — 높이 2000이라 섹션이 모자라도 길이는 합격점 위다
    const run = (drop: number) => {
      const compose = async () => ({ value: full.filter((_, i) => i < 5 || i >= 5 + drop), usedFallback: false, error: null, costUsd: 0 })
      return selectTemplateLine(input({ templates: library(2000) }), okAgents({ compose }))
    }
    const problems = (out: Awaited<ReturnType<typeof run>>) => out.order.sections.filter((s) => s.section.startsWith('problem_')).length
    const excepted = (out: Awaited<ReturnType<typeof run>>) => out.warnings.filter((w) => w.startsWith('고민 상한 예외'))
    const at18 = await run(1)
    expect(at18.order.sections).toHaveLength(PAGE_SECTIONS.min)
    expect(excepted(at18)).toEqual([])
    expect(problems(at18)).toBe(1)
    const at17 = await run(2)
    expect(excepted(at17)).toEqual([expect.stringMatching(/, 섹션 17 → 18$/)])
    expect(at17.order.sections).toHaveLength(PAGE_SECTIONS.min)
    expect(at17.order.height.meetsRequired).toBe(true)
    expect(problems(at17)).toBe(2)
    // 더하는 고민 섹션은 하나까지다 — 그래도 모자라면 문제로 남긴다
    const at16 = await run(3)
    expect(excepted(at16)).toEqual([expect.stringMatching(/, 섹션 16 → 17$/)])
    expect(problems(at16)).toBe(2)
    expect(at16.warnings).toContain(`섹션 17개(${PAGE_SECTIONS.min}~${PAGE_SECTIONS.max})`)
  })
})

describe('실제 라이브러리 — 상품 정보 표는 맨 끝이다(오너 지시 11-01)', () => {
  const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
  const agents = (composed: string[]): TemplateAgents => ({
    guideline: async ({ concepts }) => free({ persona: '', tone: '', concept: { id: concepts[0].id, reason: '' }, alternatives: [] }),
    compose: async () => free(composed),
    select: async ({ slots }) => free(slots.map((slot) => ({ index: slot.index, templateId: slot.candidates[0].id, reason: '' }))),
  })
  const run = (id: string, composed: string[]) => {
    const item = getPdpTestProduct(id)
    const job = { spec_sheet: item.specSheet, analysis: {}, copy_sections: { final: { options: item.specSheet.colorOptions ?? [] } } } as unknown as PdpJobRow
    return selectTemplateLine(
      {
        key: id,
        categoryKey: item.categoryKey,
        productHex: null,
        spec: item.specSheet,
        templates: TEMPLATES as unknown as TemplateMeta[],
        product: { category: item.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] },
        inputs: lineInputsOf(job),
      },
      agents(composed)
    )
  }

  it.each(PDP_TEST_PRODUCT_IDS)('%s 기본 구성', async (id) => {
    const placed = (await run(id, [])).order.sections.map((s) => s.section)
    expect(placed.at(-1)).toBe('spec_table')
    expect(placed.filter((s) => s === 'spec_table')).toHaveLength(1)
    expect(placed).toContain('cta')
  })

  it('장점 후보를 사실로 세기(uspfacts)는 스위치가 기록된 잡만 — 끈 잡은 입력·사실 예산이 지금 그대로다', async () => {
    const item = getPdpTestProduct('P08')
    const usps = ['손에 잘 맞아요', '어디든 두기 좋아요', '선물하기 좋아요']
    const jobOf = (features: string[]) =>
      ({
        id: 'P08',
        spec_sheet: item.specSheet,
        analysis: { usp_candidates: usps, enrichment: { version: 1, features } },
        copy_sections: { final: { options: item.specSheet.colorOptions ?? [] } },
        section_plan: {},
      }) as unknown as PdpJobRow
    const off = selectLineInputOf(jobOf(['designcut', 'templatelib']), TEMPLATES as unknown as TemplateMeta[])
    const on = selectLineInputOf(jobOf(['designcut', 'templatelib', 'uspfacts']), TEMPLATES as unknown as TemplateMeta[])
    expect(off.uspFacts).toBeUndefined()
    expect(on.uspFacts).toEqual(usps)
    expect(lineFactsOf(off)).toEqual(factsOf(item.specSheet))
    expect(lineFactsOf(on).map((fact) => fact.text)).toEqual([...factsOf(item.specSheet).map((fact) => fact.text), ...usps])
    const placed = async (line: typeof on) => (await selectTemplateLine({ ...line, categoryKey: item.categoryKey }, agents([]))).order.sections.reduce((sum, s) => sum + (s.factSlots ?? 0), 0)
    expect(await placed(on)).toBeGreaterThan(await placed(off))
  })

  it('장점 후보 근거 대조(uspaudit, J22)는 기록된 잡만 — 사실 감사 근거 없음과 겹치는 후보만 사실 목록에서 빼고 수를 남기며, 꺼진 잡·감사 없는 잡은 그대로다', () => {
    const item = getPdpTestProduct('P08')
    const usps = ['미끄럼 방지 패드로 밀리지 않아요', '어디든 두기 좋아요', '선물하기 좋아요']
    const factAudit = {
      version: 1,
      stage: 'factAudit',
      status: 'done',
      result: {
        items: [
          { id: 'a', claim: '미끄럼 방지 패드로 밀리지 않는다', verdict: 'unsupported', evidence: '', fix: '', regulated: false },
          { id: 'b', claim: '어디든 두기 좋다', verdict: 'supported', evidence: '어디든', fix: '', regulated: false },
        ],
        summary: { checked: 2, unsupported: 1, regulated: 0 },
      },
    }
    const jobOf = (features: string[], audit?: unknown) =>
      ({
        id: 'P08',
        spec_sheet: item.specSheet,
        analysis: { usp_candidates: usps, enrichment: { version: 1, features } },
        copy_sections: { final: { options: item.specSheet.colorOptions ?? [] }, ...(audit ? { fact_audit: audit } : {}) },
        section_plan: {},
      }) as unknown as PdpJobRow
    const templates = TEMPLATES as unknown as TemplateMeta[]
    const off = selectLineInputOf(jobOf(['designcut', 'templatelib', 'uspfacts'], factAudit), templates)
    expect(off.uspFacts).toEqual(usps)
    expect(off).not.toHaveProperty('uspAudit')
    const on = selectLineInputOf(jobOf(['designcut', 'templatelib', 'uspfacts', 'uspaudit'], factAudit), templates)
    expect(on.uspFacts).toEqual(usps.slice(1))
    expect(on.uspAudit).toEqual({ audit: 'done', candidates: 3, dropped: 1, unsupported: 1 })
    // 칸 카피가 받는 장점 후보(product.usps)는 그대로다 — 이 스위치는 사실 목록만 거른다
    expect(on.product.usps).toEqual(usps)
    const noAudit = selectLineInputOf(jobOf(['designcut', 'templatelib', 'uspfacts', 'uspaudit']), templates)
    expect(noAudit.uspFacts).toEqual(usps)
    expect(noAudit.uspAudit).toEqual({ audit: 'none', candidates: 3, dropped: 0, unsupported: 0 })
  })

  it('구성 콜이 표를 앞에 두어도 맨 끝이고, 마무리·권유는 그 앞이다', async () => {
    const placed = (await run('P01', ['spec_table', 'hook_3step', 'cta', 'convert_div', 'point_div'])).order.sections.map((s) => s.section)
    expect(placed.at(-1)).toBe('spec_table')
    expect(placed.indexOf('cta')).toBeLessThan(placed.indexOf('spec_table'))
    expect(placed.indexOf('convert_div')).toBeLessThan(placed.indexOf('spec_table'))
  })
})

describe('구성 고치기', () => {
  const open = ['hook_3step', 'point_div', 'review', 'spec_table', 'cta', ...Array.from({ length: 30 }, (_, i) => `s${i}`)]
  const none = new Set<string>()

  it('고를 수 없는 섹션과 넘친 POINT를 뺀다', () => {
    const r = repairComposition(['hook_3step', 'faq', 'point_div', 'point_div', 'point_div', 'point_div', 'spec_table', 'cta'], none, open)
    expect(r.removed).toEqual(['faq', 'point_div'])
    expect(r.added).toEqual([])
    expect(r.sections.filter((s) => s === 'point_div')).toHaveLength(3)
  })

  it('필수 섹션을 더한다 — 후기는 자료가 있을 때만, 고를 수 없으면 더하지 않는다', () => {
    expect(repairComposition(['s0'], none, open).added).toEqual(['hook_3step', 'spec_table', 'cta'])
    expect(repairComposition(['s0'], new Set(['review']), open).added).toEqual(['hook_3step', 'spec_table', 'cta', 'review'])
    expect(repairComposition(['s0'], none, ['s0', 'cta']).added).toEqual(['cta'])
  })

  it('상한을 넘으면 필수가 아닌 것을 뒤에서부터 뺀다', () => {
    const long = Array.from({ length: 24 }, (_, i) => `s${i}`)
    const r = repairComposition([...long, 'hook_3step', 'spec_table', 'cta'], none, open)
    expect(r.sections).toHaveLength(PAGE_SECTIONS.max)
    expect(r.sections).toEqual(expect.arrayContaining(['hook_3step', 'spec_table', 'cta', 's0']))
    expect(r.removed).toEqual(['s23', 's22', 's21', 's20', 's19'])
  })

  it('자리가 있으면 사실을 쓰지 않는 본문을 더한다 — 고를 수 있을 때만, 이미 있으면 그대로', () => {
    const body = [...open, 'option_gallery', 'convert_div']
    const base = ['hook_3step', 'spec_table', 'cta']
    expect(repairComposition(base, none, body).added).toEqual(['option_gallery', 'convert_div'])
    expect(repairComposition([...base, 'convert_div'], none, body).added).toEqual(['option_gallery'])
    expect(repairComposition(base, none, [...open, 'convert_div']).added).toEqual(['convert_div'])
  })

  it('상한이 차 있으면 본문을 더하지 않고, 남은 자리만큼만 더한다', () => {
    const body = [...open, 'option_gallery', 'convert_div']
    const fill = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`)
    const full = repairComposition([...fill(PAGE_SECTIONS.max - 3), 'hook_3step', 'spec_table', 'cta'], none, body)
    expect(full.added).toEqual([])
    expect(full.sections).toHaveLength(PAGE_SECTIONS.max)
    const room = repairComposition([...fill(PAGE_SECTIONS.max - 4), 'hook_3step', 'spec_table', 'cta'], none, body)
    expect(room.added).toEqual(['option_gallery'])
    expect(room.sections).toHaveLength(PAGE_SECTIONS.max)
  })

  it('기본 구성에는 사실을 요구하는 본문과 쓰지 않는 본문이 함께 든다', () => {
    const list = defaultComposition(K_SECTIONS)
    expect(list).toEqual(expect.arrayContaining(['sub_div', 'hidden_page', 'point_list_div', 'option_gallery', 'convert_div']))
  })

  it('사용법은 근거 usage가 있고 고를 수 있는데 빠졌을 때만 더한다 — 사실을 쓰지 않는 본문보다 앞, 자리가 있을 때만(적용 K3 T1-38)', () => {
    const body = [...open, 'how_to', 'option_gallery', 'convert_div']
    const base = ['hook_3step', 'spec_table', 'cta']
    const usage = new Set(['usage'])
    expect(repairComposition(base, usage, body).added).toEqual(['how_to', 'option_gallery', 'convert_div'])
    expect(repairComposition(base, none, body).added).toEqual(['option_gallery', 'convert_div'])
    expect(repairComposition(base, usage, [...open, 'option_gallery', 'convert_div']).added).toEqual(['option_gallery', 'convert_div'])
    expect(repairComposition([...base, 'how_to'], usage, body).sections.filter((s) => s === 'how_to')).toHaveLength(1)
    const fill = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`)
    expect(repairComposition([...fill(PAGE_SECTIONS.max - 3), ...base], usage, body).added).toEqual([])
    const room = repairComposition([...fill(PAGE_SECTIONS.max - 4), ...base], usage, body)
    expect(room.added).toEqual(['how_to'])
    expect(room.sections).toHaveLength(PAGE_SECTIONS.max)
  })

  it('사용법은 필수가 아니다 — 상한을 넘으면 필수 아닌 것과 같이 빠지고, 빠져도 구성 검사 문제로 세지 않는다', () => {
    const long = Array.from({ length: 24 }, (_, i) => `s${i}`)
    const r = repairComposition(['how_to', ...long, 'hook_3step', 'spec_table', 'cta'], new Set(['usage']), [...open, 'how_to'])
    expect(r.sections).toHaveLength(PAGE_SECTIONS.max)
    expect(r.added).toEqual([])
    const page = ['hook_3step', ...Array.from({ length: 16 }, (_, i) => `s${i}`), 'spec_table', 'cta']
    expect(compositionIssues(page, new Set(['usage']))).toEqual(compositionIssues(page, new Set()))
  })

  it('기본 구성은 사용법을 고를 수 있을 때만 넣는다', () => {
    expect(defaultComposition(K_SECTIONS)).toContain('how_to')
    expect(defaultComposition(K_SECTIONS.filter((s) => s !== 'how_to'))).not.toContain('how_to')
  })

  it('기본 구성은 고를 수 있는 것만 남기고 POINT 3개를 지킨다', () => {
    const list = defaultComposition(['hook_3step', 'point_div', 'cta'])
    expect(list).toEqual(['hook_3step', 'point_div', 'point_div', 'point_div', 'cta'])
    expect(defaultComposition([])).toEqual([])
  })
})

describe('사용법 섹션 — 시험 상품(적용 K3 T1-38)', () => {
  const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
  /** 근거 usage가 있는 P09·P10과 없는 셋 — 11상품 × 8컨셉은 전체 실행 부하 때 기본 시간 한도(5초)를 넘었다(통합 11-03 07:18) */
  const ids = ['P09', 'P10', 'P02', 'P05', 'P11']
  it('모델 구성이 비면 기본 구성으로 — 사용법은 근거 usage가 있는 상품의 계획에만 든다', { timeout: 30_000 }, async () => {
    expect(ids.map((id) => evidenceOf(getPdpTestProduct(id).specSheet).has('usage'))).toEqual([true, true, false, false, false])
    const pages: Array<{ id: string; usage: boolean; howTo: boolean }> = []
    for (const id of ids) {
      const product = getPdpTestProduct(id)
      const inputs = lineInputsOf({ spec_sheet: product.specSheet, analysis: {}, copy_sections: { final: { options: product.specSheet.colorOptions ?? [] } } } as unknown as PdpJobRow)
      for (const concept of CONCEPTS.slice(0, 8)) {
        const agents = {
          guideline: async () => free({ persona: '', tone: '', concept: { id: concept.id, reason: '' }, alternatives: [] }),
          compose: async () => free([]),
          select: async ({ slots }: { slots: Array<{ index: number; candidates: Array<{ id: string }> }> }) => free(slots.map((s) => ({ index: s.index, templateId: s.candidates[0].id, reason: '' }))),
        } as unknown as TemplateAgents
        const out = await selectTemplateLine(
          { key: id, categoryKey: product.categoryKey, productHex: null, spec: product.specSheet, templates: TEMPLATES as unknown as TemplateMeta[], inputs, product: { category: product.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] } },
          agents
        )
        pages.push({ id, usage: evidenceOf(product.specSheet).has('usage'), howTo: out.order.sections.some((s) => s.section === 'how_to') })
      }
    }
    expect(pages.filter((p) => p.howTo && !p.usage)).toEqual([])
    expect(pages.some((p) => p.howTo)).toBe(true)
  })
})
