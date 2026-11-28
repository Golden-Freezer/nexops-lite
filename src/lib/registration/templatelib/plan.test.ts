/**
 * K 계획 기록 — 실제 라이브러리·실제 조립으로 본다. 카피는 시험용 값이고, 유료 호출·DB는 없다.
 */

import { describe, expect, it } from 'vitest'
import { composeDesignCut } from '@/lib/registration/editor/utils/sectionConverter/designCut/compose'
import { readDesignCut } from '@/lib/registration/editor/utils/sectionConverter/designCut/contract'
import { designCutPlanForB } from '@/lib/registration/editor/utils/sectionConverter/designCut/designCut.fixture'
import { PDP_TEST_PRODUCT_IDS, getPdpTestProduct } from '../__fixtures__/pdp-products'
import { checkStructure } from '../eval/structure-checks'
import type { DesigncutPlan, PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { colorSetsOf } from './color-sets'
import { CONCEPTS } from './concepts'
import { FONT_PAIR_IDS, FONT_PAIR_TABLE } from './font-pairs'
import { lineInputsOf, type LineInputs } from './input-values'
import { templateById, TEMPLATES } from './library'
import { buildTemplatelibPlan, templatelibSectionKey } from './plan'
import { keyedShots, shotKey } from './section-values'
import { selectTemplateLine, type TemplateAgents } from './select-line'
import { FILLER_MAX, type OrderedSection } from './selection-order'
import { copySlotsOf, type CopyValues } from './slot-copy'
import type { TemplateMeta } from './template-meta'

const base = () => designCutPlanForB() as unknown as DesigncutPlan
const palette = colorSetsOf(CONCEPTS[0]).sets[0]
const SPEC = { productName: '시험 상품', material: '면', size: '10cm', keyFeatures: ['가볍다', '접힌다'] } as unknown as PdpSpecSheet
const inputs: LineInputs = { spec: SPEC, cards: [], options: [] }

const row = (templateId: string, over: Partial<OrderedSection> = {}): OrderedSection => {
  const template = templateById(templateId)!
  return { section: template.section, templateId, bg: template.surfaces[0], shots: [], ...over }
}

/** 첫 번째로 찾은, 사진·입력값·목록 칸이 없는 템플릿 — 시험 카피만으로 그려진다 */
const textOnly = (section: string) =>
  (TEMPLATES as unknown as TemplateMeta[]).find(
    (t) => t.section === section && Object.values(t.slots).every((slot) => slot.type === 'text' && slot.source === 'copy')
  )

/** 글 칸이 모두 있는 카피 */
const copyOf = (id: string): CopyValues =>
  Object.fromEntries(copySlotsOf(templateById(id) as unknown as TemplateMeta).map((slot) => [slot.name, '시험 문구']))

const plain = textOnly('convert_div')!
const compose = (plan: DesigncutPlan, stats?: { rendered: number; fallbacks: Array<{ key: string; template: string; to: string }> }) =>
  composeDesignCut([], readDesignCut({ designcut: plan })!, { images: {}, sectionOrder: [], stats: stats as never })

describe('K 계획 기록', () => {
  it('페이지 구성은 K 값이고, 잡 값은 기준 계획 그대로다', () => {
    const before = base()
    const plan = buildTemplatelibPlan(before, { sections: [row(plain.id)], palette, fontPair: 'gothic-suit', copy: new Map([[0, copyOf(plain.id)]]), inputs })
    expect(plan.sections.map((s) => s.key)).toEqual([templatelibSectionKey(0, 'convert_div')])
    expect(plan.order).toEqual(plan.sections.map((s) => s.key))
    expect(plan.kept).toEqual([])
    expect(plan.omitted).toEqual([])
    expect(plan.layout).toBe(2)
    expect(plan.templateColors).toEqual(palette.colors)
    expect(plan.palette).toEqual(before.palette)
    expect(plan.motif).toEqual(before.motif)
  })

  it('큰 POINT만 장 번호를 받고 바탕은 순서 풀이가 정한 값이다', () => {
    const point = (TEMPLATES as unknown as TemplateMeta[]).find((t) => t.section === 'point_div')!
    const sections = [row(plain.id, { bg: 'T' }), row(point.id), row(point.id)]
    const plan = buildTemplatelibPlan(base(), { sections, palette, fontPair: 'gothic-suit', copy: new Map(), inputs })
    expect(plan.sections.map((s) => s.chapter)).toEqual([null, 1, 2])
    expect(plan.sections[0].bg).toBe('T')
  })

  it('라이브러리에 없는 템플릿은 빼되 뒤 섹션 번호는 그대로다 — 컷 키가 섹션 번호를 쓴다', () => {
    const sections = [row(plain.id), { ...row(plain.id), templateId: 'none.none' }, row(plain.id)]
    const plan = buildTemplatelibPlan(base(), { sections, palette, fontPair: 'gothic-suit', copy: new Map(), inputs })
    expect(plan.sections.map((s) => s.key)).toEqual([templatelibSectionKey(0, 'convert_div'), templatelibSectionKey(2, 'convert_div')])
  })

  it('사진 칸에는 섹션 번호로 만든 컷 키가 들어간다', () => {
    const photo = (TEMPLATES as unknown as TemplateMeta[]).find((t) => t.section === 'main_cut' && t.slots.photo?.type === 'image')!
    const shots = [{ slot: 'photo', purpose: 'p', composition: 'c' }]
    const plan = buildTemplatelibPlan(base(), { sections: [row(plain.id), row(photo.id, { shots })], palette, fontPair: 'gothic-suit', copy: new Map(), inputs })
    expect(plan.sections[1].templateRef?.slots.photo).toBe(shotKey(1, 'photo', 0))
  })
})

describe('K 계획이 조립을 지나간다', () => {
  it('기록을 읽어 엔진으로 그린다 — 대체 없음', () => {
    const stats = { rendered: 0, fallbacks: [] as Array<{ key: string; template: string; to: string }> }
    const plan = buildTemplatelibPlan(base(), { sections: [row(plain.id)], palette, fontPair: 'gothic-suit', copy: new Map([[0, copyOf(plain.id)]]), inputs })
    const out = compose(plan, stats)
    expect(out.map((s) => s.layoutId)).toEqual([`designcut_k_${plain.id}`])
    expect(stats.fallbacks).toEqual([])
    expect(stats.rendered).toBe(1)
  })

  it('필수 칸이 비어 엔진이 못 그리면 D 템플릿으로 대체하지 않고 뺀다', () => {
    const stats = { rendered: 0, fallbacks: [] as Array<{ key: string; template: string; to: string }> }
    const out = compose(buildTemplatelibPlan(base(), { sections: [row(plain.id)], palette, fontPair: 'gothic-suit', copy: new Map(), inputs }), stats)
    expect(out).toEqual([])
    expect(stats.rendered).toBe(0)
    expect(stats.fallbacks.map((f) => f.to)).toEqual(['template-fallback', 'none'])
  })

  it('고른 글꼴 짝이 제목에 들고 본문은 그대로다', () => {
    const plan = buildTemplatelibPlan(base(), { sections: [row(plain.id)], palette, fontPair: 'serif-noto', copy: new Map([[0, copyOf(plain.id)]]), inputs })
    const { heading, weight } = FONT_PAIR_TABLE['serif-noto']
    const texts = compose(plan).flatMap((s) => s.elements).filter((el) => el.textProps)
    const titles = texts.filter((el) => ['display', 'h1', 'h2'].includes(el.textProps?.typoLevel ?? ''))
    expect(titles.length).toBeGreaterThan(0)
    expect(titles.every((el) => el.textProps?.fontFamily === heading && el.textProps?.fontWeight === weight)).toBe(true)
    expect(texts.filter((el) => !titles.includes(el)).every((el) => el.textProps?.fontFamily !== heading)).toBe(true)
  })

  it('글꼴 짝 15개는 모두 기록을 지나간다, 표에 없는 값은 칸을 두지 않는다', () => {
    for (const id of FONT_PAIR_IDS) {
      const plan = buildTemplatelibPlan(base(), { sections: [row(plain.id)], palette, fontPair: id, copy: new Map(), inputs })
      const { heading, weight } = FONT_PAIR_TABLE[id]
      expect(readDesignCut({ designcut: plan })?.templateFontPair).toEqual({ heading, weight })
    }
    const wrong = { ...buildTemplatelibPlan(base(), { sections: [row(plain.id)], palette, fontPair: 'gothic-suit', copy: new Map(), inputs }), templateFontPair: { heading: '없는 글꼴', weight: 700 } }
    expect(readDesignCut({ designcut: wrong })).not.toHaveProperty('templateFontPair')
  })

  it('글꼴 짝이 없는 계획은 지금 그리기 그대로다', () => {
    const plan = designCutPlanForB() as unknown as DesigncutPlan
    expect(readDesignCut({ designcut: plan })).not.toHaveProperty('templateFontPair')
  })
})

/**
 * 계획 높이만 재면 그려지지 않을 섹션까지 센다(#467에서 한 번 틀렸다). 실제 라이브러리로 11상품을 끝까지 조립해 계획한 섹션이 모두 그려지는지 본다.
 * 콜은 가짜이고 기본 구성·후보 첫째 경로다. 카피는 칸마다 최소 항목을 채운 시험 값이라 실제 카피 검사가 칸을 지우는 경우는 여기서 재지 못한다.
 */
describe('실제 라이브러리 — 계획한 섹션이 모두 그려진다', () => {
  const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
  const agents: TemplateAgents = {
    guideline: async ({ concepts }) => free({ persona: '', tone: '', concept: { id: concepts[0].id, reason: '' }, alternatives: [] }),
    compose: async () => free([]),
    select: async ({ slots }) => free(slots.map((slot) => ({ index: slot.index, templateId: slot.candidates[0].id, reason: '' }))),
  }
  const fullCopy = (id: string): CopyValues =>
    Object.fromEntries(
      copySlotsOf(templateById(id) as unknown as TemplateMeta).map((slot): [string, CopyValues[string]] => {
        if (slot.list) {
          const item = Object.fromEntries(slot.list.fields.map((field) => [field.name, '시험 문구']))
          return [slot.name, Array.from({ length: Math.max(slot.list.min, 1) }, () => ({ ...item }))]
        }
        return [slot.name, slot.tags ? Array.from({ length: Math.max(slot.tags.min, 1) }, () => '문구') : '시험 문구']
      })
    )

  it.each(PDP_TEST_PRODUCT_IDS)('%s', async (id) => {
    const product = getPdpTestProduct(id)
    const spec = product.specSheet
    const job = { spec_sheet: spec, analysis: {}, copy_sections: { final: { options: spec.colorOptions ?? [] } } } as unknown as PdpJobRow
    const inputs = lineInputsOf(job)
    const brief = { category: product.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] }
    const line = await selectTemplateLine(
      { key: id, categoryKey: product.categoryKey, productHex: null, spec, templates: TEMPLATES as unknown as TemplateMeta[], product: brief, inputs },
      agents
    )
    const { sections } = line.order
    expect(sections.filter((row) => row.filler).length).toBeLessThanOrEqual(FILLER_MAX)
    const copy = new Map(sections.map((row, index) => [index, fullCopy(row.templateId)]))
    const plan = buildTemplatelibPlan(base(), { sections, palette: line.palette, fontPair: line.concept.fontPair, copy, inputs })
    const images = Object.fromEntries(sections.flatMap((row, index) => keyedShots(index, row).map((shot) => [shot.key, `https://img.test/${shot.key}.png`])))
    const stats = { rendered: 0, fallbacks: [] as Array<{ key: string; template: string; to: string }> }
    const out = composeDesignCut([], readDesignCut({ designcut: plan })!, { images, sectionOrder: [], stats: stats as never, specSheet: spec as never })
    expect(stats.fallbacks).toEqual([])
    expect(stats.rendered).toBe(sections.length)
    // 오너 지시 11-01: 상품 정보가 맨 끝이다. 구매 전 확인 표가 들어가도 그 바로 앞이고, 채점 기록도 같은 판정이다
    expect(out.at(-1)?.layoutId).toMatch(/^designcut_k_spec_table\./)
    const { pageTail, pointBadges } = checkStructure({ ...job, section_plan: { designcut: plan } } as unknown as PdpJobRow, out)
    expect(pageTail.ok).toBe(true)
    expect(pageTail.infoFromEnd).toContain(0)
    expect(pointBadges.count).toBe(sections.filter((row) => row.section === 'point_div').length)
  })
})
