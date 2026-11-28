/**
 * 판매 옵션 빠짐 없음(적용 K14, V2 K2 P01·P10 입력 7개 화면 6개) — 고를 수 있는 템플릿은 입력 옵션을 모두 그린다. 잘라서 보여 주지 않고, 칸이 모자라면 고르지 않는다. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { getPdpTestProduct } from '@/lib/registration/__fixtures__/pdp-products'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { CONCEPTS } from './concepts'
import { renderTemplate } from './engine'
import { fillInputSlots, lineInputsOf, requiredInputsFit, type LineInputs } from './input-values'
import { TEMPLATES, templateById } from './library'
import { mockSlots } from './mock'
import { sampleContext } from './sample'
import { selectTemplateLine, type TemplateAgents } from './select-line'
import type { TemplateMeta } from './template-meta'
import type { Template } from './template-types'

const OPTION_LISTS = new Set(['option.names', 'option.images', 'option.lineup', 'option.swatches'])
const optionSlots = (template: Pick<Template, 'slots'>) => Object.entries(template.slots).filter(([, def]) => def.type === 'list' && def.input !== undefined && OPTION_LISTS.has(def.input))
const optionTemplates = TEMPLATES.filter((template) => optionSlots(template).length > 0)

const inputsOf = (count: number, photos: boolean): LineInputs => ({
  spec: {} as PdpSpecSheet,
  cards: [],
  options: Array.from({ length: count }, (_, i) => ({ label: `옵션${i + 1}`, image: photos ? `https://cdn.example.com/option-${i + 1}.jpg` : null })),
})

/** 이 템플릿이 그리는 옵션 수 — 옵션 칸 가운데 가장 많이 그리는 칸 */
function shownOf(template: Pick<Template, 'slots'>, inputs: LineInputs): number {
  const values = fillInputSlots(template, inputs)
  return Math.max(0, ...optionSlots(template).map(([name]) => (Array.isArray(values[name]) ? (values[name] as unknown[]).length : 0)))
}

describe('고를 수 있는 템플릿은 옵션을 모두 그린다', () => {
  for (const photos of [true, false]) {
    it(`옵션 1~14개 전수 — 사진 ${photos ? '있음' : '없음'}`, () => {
      expect(optionTemplates.length).toBeGreaterThan(0)
      for (let count = 1; count <= 14; count += 1) {
        const inputs = inputsOf(count, photos)
        for (const template of optionTemplates) {
          if (requiredInputsFit(template, inputs)) expect(shownOf(template, inputs), `${template.id} 옵션 ${count}개`).toBe(count)
        }
      }
    })
  }

  it('옵션 7개 사진 있음 — 3열 사진 칸은 7장과 이름 7개를 그리고, 사진 4칸 템플릿은 고르지 않는다', () => {
    const inputs = inputsOf(7, true)
    const gridThree = templateById('option_gallery.grid-three')!
    const values = fillInputSlots(gridThree, inputs)
    expect(values.swatches).toHaveLength(7)
    expect(values.names).toHaveLength(7)
    expect(requiredInputsFit(gridThree, inputs)).toBe(true)
    expect(requiredInputsFit(templateById('option_gallery.grid-two')!, inputs)).toBe(false)
    expect(requiredInputsFit(templateById('option_gallery.beauty-tone-pair')!, inputs)).toBe(false)
  })

  it('사진이 일부 옵션에만 있어도 이름 칸이 모두 그리면 고른다 — 이름 칸 없는 사진 칸은 고르지 않는다', () => {
    const inputs: LineInputs = { ...inputsOf(3, false), options: [{ label: '가', image: 'https://cdn.example.com/a.jpg' }, { label: '나', image: 'https://cdn.example.com/b.jpg' }, { label: '다', image: null }] }
    expect(requiredInputsFit(templateById('option_gallery.grid-two')!, inputs)).toBe(true)
    expect(requiredInputsFit(templateById('option_gallery.beauty-tone-pair')!, inputs)).toBe(false)
  })

  it('옵션 12개까지는 이름 칸 템플릿이 남고, 13개면 옵션 칸을 아예 고르지 않는다 — 잘라서 보여 주지 않는다', () => {
    expect(optionTemplates.filter((template) => requiredInputsFit(template, inputsOf(12, false))).length).toBeGreaterThan(0)
    expect(optionTemplates.filter((template) => requiredInputsFit(template, inputsOf(13, false))).map((template) => template.id)).toEqual([])
  })

  it('옵션이 없는 상품은 지금처럼 고른다 — 이름 칸이 선택인 템플릿은 이름 없이 그린다', () => {
    expect(requiredInputsFit(templateById('option_gallery.lead-bleed')!, inputsOf(0, false))).toBe(true)
  })

  it('늘린 칸 수만큼 그려진다 — 사진 9장·이름 12개에서 null이 아니고 세로가 늘어난다', () => {
    const template = templateById('option_gallery.grid-three')!
    const base = renderTemplate(template, mockSlots(template), sampleContext())!
    const swatches = Array.from({ length: 9 }, (_, i) => ({ photo: `option-${i + 1}` }))
    const names = Array.from({ length: 12 }, (_, i) => `옵션 이름 ${i + 1}`)
    const full = renderTemplate(template, { ...mockSlots(template), swatches, names }, sampleContext())!
    expect(full).not.toBeNull()
    expect(full.height).toBeGreaterThan(base.height)
  })

  it('입력을 받는 칸 수는 높이 표본(max)과 따로다 — 옵션 칸 상한을 넘겨도 계산 높이가 바뀌지 않게 max는 그대로다', () => {
    for (const template of optionTemplates) {
      for (const [name, def] of optionSlots(template)) {
        if (def.type === 'list' && def.input === 'option.names') expect([def.max, def.inputMax], `${template.id}.${name}`).toEqual([6, 12])
      }
    }
    expect((templateById('option_gallery.grid-three')!.slots.swatches as { inputMax?: number }).inputMax).toBe(9)
  })
})

describe('표본 P01·P10(옵션 7개) — 입력 옵션 수 = 화면 옵션 수', () => {
  const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
  const pages = async (id: 'P01' | 'P10', photos: boolean) => {
    const product = getPdpTestProduct(id)
    const base = lineInputsOf({ spec_sheet: product.specSheet, analysis: {}, copy_sections: { final: { options: product.specSheet.colorOptions ?? [] } } } as unknown as PdpJobRow)
    const inputs: LineInputs = photos ? { ...base, options: base.options.map((option, i) => ({ ...option, image: `https://cdn.example.com/${id}-${i + 1}.jpg` })) } : base
    expect(inputs.options).toHaveLength(7)
    const seen: Array<{ templateId: string; shown: number }> = []
    for (const concept of CONCEPTS.slice(0, 12)) {
      const agents = {
        guideline: async () => free({ persona: '', tone: '', concept: { id: concept.id, reason: '' }, alternatives: [] }),
        compose: async () => free([]),
        select: async ({ slots }: { slots: Array<{ index: number; candidates: Array<{ id: string }> }> }) => free(slots.map((slot) => ({ index: slot.index, templateId: slot.candidates[0].id, reason: '' }))),
      } as unknown as TemplateAgents
      const { order } = await selectTemplateLine(
        { key: id, categoryKey: product.categoryKey, productHex: null, spec: product.specSheet, templates: TEMPLATES as unknown as TemplateMeta[], inputs, product: { category: product.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] } },
        agents
      )
      for (const row of order.sections) {
        const template = templateById(row.templateId)
        if (template && optionSlots(template).length > 0) seen.push({ templateId: row.templateId, shown: shownOf(template, inputs) })
      }
    }
    return seen
  }

  for (const id of ['P01', 'P10'] as const) {
    for (const photos of [false, true]) {
      it(`${id} 옵션 사진 ${photos ? '있음' : '없음'} — 옵션 칸이 든 쪽은 7개를 모두 그린다`, async () => {
        const seen = await pages(id, photos)
        expect(seen.length).toBeGreaterThan(0)
        for (const { templateId, shown } of seen) expect(shown, templateId).toBe(7)
      })
    }
  }
})
