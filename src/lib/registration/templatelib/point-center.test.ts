/**
 * 가운데 POINT 머리 point-center(적용 K4 T1-31, 연구 A3 #12) — 가운데 작은 단추 → 번호 → 큰 제목 → 짧은 글.
 * 아래 배치는 많이 뽑히는 기본판 다섯을 그대로 두고 머리만 바꾼다. 진행 표시 탭은 두지 않는다(캡슐이 가운데라 탭이 한쪽으로 쏠린다 — 큰 번호가 순번).
 * 페이지 안 POINT는 첫 POINT 머리를 따른다(selection-order pointCandidates).
 */

import { describe, expect, it } from 'vitest'
import { getPdpTestProduct, PDP_TEST_PRODUCT_IDS } from '../__fixtures__/pdp-products'
import type { PdpJobRow } from '../pdp-state'
import { CONCEPTS } from './concepts'
import { renderTemplate } from './engine'
import { lineInputsOf } from './input-values'
import { TEMPLATES, templateById } from './library'
import { headKeyOf } from './lint'
import { sampleContext, sampleSlots } from './sample'
import { selectTemplateLine, type TemplateAgents } from './select-line'
import type { TemplateMeta } from './template-meta'
import { POINT_HEAD_STYLES, type Template } from './template-types'
import { yieldToEventLoop } from './__test__/yield'

const ALL = TEMPLATES as unknown as Template[]
const CENTER = ALL.filter((t) => t.headStyle === 'point-center')
const BASES = ['grid-two-card', 'offset-rule', 'inset-card', 'pair-photos', 'grid-three']
const HEAD_NODES = 4
const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })

describe('point-center 템플릿', () => {
  it('머리 값이 있고 가운데판 다섯이 그 머리로 시작한다', () => {
    expect(POINT_HEAD_STYLES['point-center']).toBe('capsule:POINT|text:chapter:DISPLAY|text:headline:H1|text:sub:BODY')
    expect(CENTER.map((t) => t.id).sort()).toEqual(BASES.map((b) => `point_div.center-${b}`).sort())
    for (const t of CENTER) {
      expect(t.section, t.id).toBe('point_div')
      expect(headKeyOf(t.flow).startsWith(POINT_HEAD_STYLES['point-center']), t.id).toBe(true)
    }
  })

  it('머리 넷이 모두 가운데이고 진행 표시·그 칸이 없다', () => {
    for (const t of CENTER) {
      expect(t.flow[0], t.id).toEqual({ kind: 'capsule', label: 'POINT', align: 'center', gapAfter: 'rowGap' })
      for (const node of t.flow.slice(1, HEAD_NODES)) expect(node.kind === 'text' && node.align, t.id).toBe('center')
      expect(t.slots.progress, t.id).toBeUndefined()
      expect(t.slots.step, t.id).toBeUndefined()
    }
  })

  it('아래 배치·사진 칸·바탕·컨셉은 기본판과 같다(머리만 다르다)', () => {
    for (const base of BASES) {
      const from = templateById(`point_div.${base}`) as unknown as Template
      const center = templateById(`point_div.center-${base}`) as unknown as Template
      expect(center.flow.slice(HEAD_NODES), base).toEqual(from.flow.slice(3))
      const slots = Object.fromEntries(Object.entries(from.slots).filter(([name]) => name !== 'progress' && name !== 'step'))
      expect(center.slots, base).toEqual(slots)
      expect(center.surfaces, base).toEqual(from.surfaces)
      expect(center.fit, base).toEqual(from.fit)
    }
  })

  it('가운데판이 놓이는 컨셉은 44개의 절반 이상이다', () => {
    const concepts = new Set(CENTER.flatMap((t) => t.fit.concepts))
    expect(concepts.size).toBeGreaterThanOrEqual(CONCEPTS.length / 2)
  })

  it('단추(POINT 캡슐) 색과 글자는 기본판과 같고 가운데에 놓인다', () => {
    const ctx = sampleContext()
    for (const base of BASES) {
      const draw = (id: string) => {
        const t = templateById(id) as unknown as Template
        return renderTemplate(t, sampleSlots(t, { mode: 'full' }), ctx)!.elements
      }
      const capsuleOf = (els: ReturnType<typeof draw>) => els.find((e) => e.name === 'designcut-capsule-bg')!
      const from = capsuleOf(draw(`point_div.${base}`))
      const center = capsuleOf(draw(`point_div.center-${base}`))
      expect(center.shapeProps?.fill, base).toBe(from.shapeProps?.fill)
      const mid = center.transform.x + center.transform.width / 2
      expect(Math.abs(mid - 430), base).toBeLessThanOrEqual(2)
      const texts = draw(`point_div.center-${base}`).filter((e) => ['designcut-chapter', 'designcut-headline', 'designcut-sub'].includes(e.name))
      expect(texts.length, base).toBe(3)
      for (const el of texts) expect(el.textProps?.textAlign, `${base} ${el.name}`).toBe('center')
    }
  })
})

describe('페이지 안 POINT 머리', () => {
  it('11상품 × 44컨셉(첫 후보 고름)에서 한 페이지의 POINT는 머리가 하나이고, 가운데 머리 페이지가 생긴다', async () => {
    let centerPages = 0
    let pages = 0
    for (const id of PDP_TEST_PRODUCT_IDS) {
      const product = getPdpTestProduct(id)
      const inputs = lineInputsOf({ spec_sheet: product.specSheet, analysis: {}, copy_sections: { final: { options: product.specSheet.colorOptions ?? [] } } } as unknown as PdpJobRow)
      for (const concept of CONCEPTS) {
        await yieldToEventLoop()
        const agents = {
          guideline: async () => free({ persona: '', tone: '', concept: { id: concept.id, reason: '' }, alternatives: [] }),
          compose: async () => free([]),
          select: async ({ slots }: { slots: Array<{ index: number; candidates: Array<{ id: string }> }> }) =>
            free(slots.map((s) => ({ index: s.index, templateId: s.candidates[0].id, reason: '' }))),
        } as unknown as TemplateAgents
        const { order } = await selectTemplateLine(
          { key: id, categoryKey: product.categoryKey, productHex: null, spec: product.specSheet, templates: ALL as unknown as TemplateMeta[], inputs, product: { category: product.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] } },
          agents
        )
        const heads = new Set(order.sections.filter((s) => s.section === 'point_div').map((s) => templateById(s.templateId)?.headStyle))
        if (heads.size === 0) continue
        pages++
        expect(heads.size, `${id}·${concept.id}`).toBe(1)
        if (heads.has('point-center')) centerPages++
      }
    }
    expect(pages).toBeGreaterThan(0)
    expect(centerPages).toBeGreaterThan(0)
  }, 120_000)
})
