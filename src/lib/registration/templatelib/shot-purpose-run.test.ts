import { describe, expect, it } from 'vitest'
import { getPdpTestProduct, PDP_TEST_PRODUCT_IDS } from '../__fixtures__/pdp-products'
import type { PdpJobRow } from '../pdp-state'
import { CONCEPTS } from './concepts'
import { lineInputsOf } from './input-values'
import { TEMPLATES, templatesOf } from './library'
import { selectTemplateLine, type TemplateAgents } from './select-line'
import type { ImageSlot } from './template-types'
import type { TemplateMeta } from './template-meta'
import { yieldToEventLoop } from './__test__/yield'

const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
const agentsFor = (conceptId: string) =>
  ({
    guideline: async () => free({ persona: '', tone: '', concept: { id: conceptId, reason: '' }, alternatives: [] }),
    compose: async () => free([]),
    select: async ({ slots }: { slots: Array<{ index: number; candidates: Array<{ id: string }> }> }) => free(slots.map((s) => ({ index: s.index, templateId: s.candidates[0].id, reason: '' }))),
  }) as unknown as TemplateAgents

const imageDefs = (slots: (typeof TEMPLATES)[number]['slots']): ImageSlot[] =>
  Object.values(slots).flatMap((slot) => (slot.type === 'image' ? [slot] : slot.type === 'list' ? Object.values(slot.fields).filter((def): def is ImageSlot => def.type === 'image') : []))

const hasRunOfThree = (purposes: readonly string[]) => purposes.some((p, i) => i >= 2 && p === purposes[i - 1] && p === purposes[i - 2])

describe('사진 목적 넓히기', () => {
  it('POINT 사진은 비교표 말고 목적이 둘 이상이고, 고민 사진은 고민 장면으로만 남는다', () => {
    for (const t of templatesOf('point_div')) {
      if (t.id === 'point_div.compare-marks') continue
      for (const def of imageDefs(t.slots)) expect(def.purpose.length, t.id).toBeGreaterThanOrEqual(2)
    }
    for (const section of ['problem_raise', 'problem_empathy'] as const) {
      for (const t of templatesOf(section)) for (const def of imageDefs(t.slots)) expect(def.purpose, t.id).toEqual(['problem'])
    }
    for (const t of templatesOf('direction_suggest')) for (const def of imageDefs(t.slots)) expect(def.purpose, t.id).toContain('scene')
  })

  it('11상품 × 44컨셉에서 같은 목적 3연속이 있는 페이지가 20% 이하고 POINT끼리는 생기지 않는다', async () => {
    let pages = 0
    let withRun = 0
    for (const id of PDP_TEST_PRODUCT_IDS) {
      const product = getPdpTestProduct(id)
      const inputs = lineInputsOf({ spec_sheet: product.specSheet, analysis: {}, copy_sections: { final: { options: product.specSheet.colorOptions ?? [] } } } as unknown as PdpJobRow)
      for (const concept of CONCEPTS) {
        await yieldToEventLoop()
        const { order } = await selectTemplateLine(
          {
            key: id,
            categoryKey: product.categoryKey,
            productHex: null,
            spec: product.specSheet,
            templates: TEMPLATES as unknown as TemplateMeta[],
            inputs,
            product: { category: product.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] },
          },
          agentsFor(concept.id)
        )
        pages++
        if (hasRunOfThree(order.sections.flatMap((s) => s.shots.map((shot) => shot.purpose)))) withRun++
        const points = order.sections.filter((s) => s.section === 'point_div').flatMap((s) => s.shots.map((shot) => shot.purpose))
        expect(hasRunOfThree(points), `${id}·${concept.id}`).toBe(false)
      }
    }
    expect(pages).toBe(PDP_TEST_PRODUCT_IDS.length * CONCEPTS.length)
    expect(withRun / pages).toBeLessThanOrEqual(0.2)
  }, 120000)
})
