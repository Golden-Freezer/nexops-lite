/**
 * 옵션 라인업(적용 K3 R-W6, 통합 11-03 05:38·08:1x) — 옵션 2~4개가 모두 실물 사진일 때만 같은 틀(사진·이름)을 반복하고, 그릴 수 있으면 후보 맨 앞 1자리다.
 * 실물 아닌 사진은 잡 입력을 읽을 때(lineInputsOf, 적용 K6 ①) 모두 이름만으로 바뀌어 기존 option.images 격자에도 실리지 않는다(상한 자르기는 그대로).
 * 사진이 입력값이라 컷을 만들지 않는다. AI 단계는 가짜다(유료 호출 0).
 */

import { describe, expect, it } from 'vitest'
import { PDP_TEST_PRODUCT_IDS, getPdpTestProduct } from '../__fixtures__/pdp-products'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { CONCEPTS, conceptById } from './concepts'
import { fillInputSlots, lineInputsOf, requiredInputsFit, type LineInputs } from './input-values'
import { TEMPLATES } from './library'
import { selectTemplateLine, type TemplateAgents } from './select-line'
import { candidatesFor, isLineup, type SelectionProfile } from './selection'
import { imageSlots, shotCountOf } from './selection-order'
import type { TemplateMeta } from './template-meta'
import { OPTION_LINEUP_INPUT, OPTION_NAME_INPUT, type Template } from './template-types'

const library = TEMPLATES as unknown as TemplateMeta[]
const lineups = TEMPLATES.filter((t) => isLineup(t as unknown as TemplateMeta))
const byId = (id: string) => TEMPLATES.find((t) => t.id === id)!
const photo = (i: number) => `https://cdn.example.com/option-${i}.jpg`
const options = (n: number, image: (i: number) => string | null = photo) => Array.from({ length: n }, (_, i) => ({ label: `옵션${i + 1}`, image: image(i) }))
const inputs = (opts: LineInputs['options']): LineInputs => ({ spec: { colorOptions: opts.map((o) => o.label) } as unknown as PdpSpecSheet, cards: [], options: opts })
const itemsOf = (t: Template, opts: LineInputs['options']) => fillInputSlots(t, inputs(opts)).swatches as Array<Record<string, string>> | undefined
/** 실제 잡 경로 — 등록 옵션 기록(optionSpec.variants[].sourceImage)과 options 기록이 있어야 lineInputsOf가 옵션 사진을 읽는다 */
const jobOf = (opts: LineInputs['options']) => {
  const labels = opts.map((o) => o.label)
  const optionSpec = {
    source: 'manual',
    axes: [{ kind: 'color', name: '색상', values: labels }],
    variants: opts.map((o) => ({ label: o.label, values: { color: o.label }, ...(o.image ? { sourceImage: o.image } : {}) })),
  }
  return { spec_sheet: { colorOptions: labels, optionSpec }, analysis: { enrichment: { version: 1, features: ['options'] } }, copy_sections: { final: { options: labels } } } as unknown as PdpJobRow
}

describe('라인업 템플릿', () => {
  it('2개 이상이고 모두 라인업 입력(사진 + 옵션 이름)만 쓴다 — 옵션별 설명 칸이 없다', () => {
    expect(lineups.length).toBeGreaterThanOrEqual(2)
    for (const t of lineups) {
      expect(t.section, t.id).toBe('option_gallery')
      expect(t.needs.evidence, t.id).toEqual(['option'])
      const list = t.slots.swatches
      expect(list.type === 'list' && list.input === OPTION_LINEUP_INPUT && list.min === 2 && list.max === 4, t.id).toBe(true)
      if (list.type !== 'list') continue
      const fields = Object.values(list.fields)
      expect(fields.map((f) => f.type).sort(), t.id).toEqual(['image', 'text'])
      expect(fields.every((f) => f.type === 'image' || (f.source === 'input' && f.input === OPTION_NAME_INPUT)), t.id).toBe(true)
      const copyTexts = Object.entries(t.slots).filter(([, s]) => s.type === 'text' && s.source === 'copy').map(([name]) => name)
      expect(copyTexts, t.id).toEqual(['headline'])
    }
  })

  it('사진이 입력값이라 컷을 만들지 않는다(imageSlots·shotCountOf 0)', () => {
    for (const t of lineups) {
      expect(imageSlots(t as unknown as TemplateMeta), t.id).toEqual([])
      expect(shotCountOf(t as unknown as TemplateMeta), t.id).toBe(0)
    }
  })
})

describe('라인업 칸 채우기 — 모두 실물·2~4개일 때만', () => {
  it.each([2, 3, 4])('옵션 %i개 모두 실물 사진이면 옵션마다 사진·이름 한 항목', (n) => {
    for (const t of lineups) {
      expect(requiredInputsFit(t, inputs(options(n))), t.id).toBe(true)
      expect(itemsOf(t, options(n)), t.id).toEqual(options(n).map((o) => ({ photo: o.image, name: o.label })))
    }
  })

  it('1개·5개 이상이면 비운다 — 5개 이상은 기존 격자가 받는다', () => {
    for (const t of lineups) for (const n of [1, 5, 6]) expect(requiredInputsFit(t, inputs(options(n))), `${t.id} ${n}`).toBe(false)
    expect(requiredInputsFit(byId('option_gallery.grid-three'), inputs(options(5)))).toBe(true)
  })

  it('실물이 아닌 사진(자리표시·생성 실패·사진 없음·http 아님)이 하나라도 있으면 목록 전체를 비운다', () => {
    const bad = ['https://placehold.co/600x800?text=Option', 'https://img.example.com/Image+Generation+Failed.png', null, '/uploads/option.jpg', 'data:image/png;base64,AAAA']
    for (const value of bad) {
      const mixed = options(3, (i) => (i === 1 ? value : photo(i)))
      for (const t of lineups) expect(requiredInputsFit(t, inputs(mixed)), `${t.id} ${value}`).toBe(false)
    }
  })

  it('칸보다 긴 이름이 하나라도 있으면 목록 전체를 비운다 — 자르지 않는다', () => {
    for (const t of lineups) {
      const list = t.slots.swatches
      const max = list.type === 'list' && list.fields.name.type === 'text' ? list.fields.name.maxChars : 0
      const long = options(3).map((o, i) => (i === 2 ? { ...o, label: '가'.repeat(max + 1) } : o))
      expect(requiredInputsFit(t, inputs(long)), t.id).toBe(false)
    }
  })

  it('기존 option.images 격자 — 칸 상한을 넘으면 앞 몇 장만 싣지 않고 비운다(적용 K14)', () => {
    const grid = byId('option_gallery.grid-two')
    expect(lineInputsOf(jobOf(options(6))).options).toEqual(options(6))
    expect(fillInputSlots(grid, lineInputsOf(jobOf(options(6)))).swatches).toBeUndefined()
    expect((fillInputSlots(grid, lineInputsOf(jobOf(options(4)))).swatches as unknown[]).length).toBe(4)
  })

  it('실물 아닌 사진(자리표시·생성 실패·http 아님·사진 없음)이 하나라도 섞인 잡은 모두 이름만 — 격자는 못 그리고 이름 칸 템플릿은 그린다(적용 K6 ①)', () => {
    const grid = byId('option_gallery.grid-two')
    const names = byId('option_gallery.names-offset')
    for (const bad of ['https://placehold.co/600x800', 'https://img.example.com/Image+Generation+Failed.png', '/uploads/option.jpg', null]) {
      const value = lineInputsOf(jobOf(options(3, (i) => (i === 0 ? bad : photo(i)))))
      expect(value.options, String(bad)).toEqual(options(3, () => null))
      expect(fillInputSlots(grid, value).swatches, String(bad)).toBeUndefined()
      expect(requiredInputsFit(grid, value), String(bad)).toBe(false)
      expect(requiredInputsFit(names, value), String(bad)).toBe(true)
      expect(fillInputSlots(names, value).names, String(bad)).toEqual(['옵션1', '옵션2', '옵션3'])
    }
  })
})

describe('후보 맨 앞 1자리', () => {
  const profile = (opts: LineInputs['options']): SelectionProfile => ({
    key: 'P01',
    categoryKey: 'household',
    photoCount: 10,
    productHex: null,
    evidence: new Set(['option']),
    drawable: (t) => requiredInputsFit(t as unknown as Template, inputs(opts)),
  })

  it('라인업을 그릴 수 있으면 컨셉과 상관없이 첫 후보가 라인업이다', () => {
    for (const concept of CONCEPTS) {
      const list = candidatesFor('option_gallery', library, profile(options(3)), concept)
      expect(isLineup(list[0]), concept.id).toBe(true)
      expect(list.filter(isLineup).length, concept.id).toBeLessThanOrEqual(lineups.length)
    }
  })

  it('그릴 수 없으면(5개·사진 없음) 라인업이 후보에 없다', () => {
    const concept = conceptById('clean-trust')!
    for (const opts of [options(5), options(3, () => null)]) expect(candidatesFor('option_gallery', library, profile(opts), concept).some(isLineup)).toBe(false)
  })
})

describe('시험 상품', () => {
  const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
  const run = async (id: string, opts: LineInputs['options'] | null, concept: (typeof CONCEPTS)[number]) => {
    const product = getPdpTestProduct(id)
    const base = lineInputsOf({ spec_sheet: product.specSheet, analysis: {}, copy_sections: { final: { options: product.specSheet.colorOptions ?? [] } } } as unknown as PdpJobRow)
    const spec = (opts ? { ...product.specSheet, colorOptions: opts.map((o) => o.label), optionSpec: undefined } : product.specSheet) as PdpSpecSheet
    const agents = {
      guideline: async () => free({ persona: '', tone: '', concept: { id: concept.id, reason: '' }, alternatives: [] }),
      compose: async () => free([]),
      select: async ({ slots }: { slots: Array<{ index: number; candidates: Array<{ id: string }> }> }) => free(slots.map((s) => ({ index: s.index, templateId: s.candidates[0].id, reason: '' }))),
    } as unknown as TemplateAgents
    const out = await selectTemplateLine(
      { key: id, categoryKey: product.categoryKey, productHex: null, spec, templates: library, inputs: opts ? { ...base, spec, options: opts } : base, product: { category: product.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] } },
      agents
    )
    return out.order.sections
  }

  it('시험 11상품은 옵션 사진이 없어 라인업을 그릴 수 없다', () => {
    for (const id of PDP_TEST_PRODUCT_IDS) {
      const product = getPdpTestProduct(id)
      const value = lineInputsOf({ spec_sheet: product.specSheet, analysis: {}, copy_sections: { final: { options: product.specSheet.colorOptions ?? [] } } } as unknown as PdpJobRow)
      for (const t of lineups) expect(requiredInputsFit(t, value), `${id} ${t.id}`).toBe(false)
    }
  })

  it(
    '실물 옵션 사진 3장이면 옵션 섹션이 라인업(첫 후보)으로 들고 그 섹션의 컷은 0이다, 5장이면 기존 격자다',
    async () => {
      for (const id of ['P01', 'P02', 'P07']) {
        for (const concept of CONCEPTS.slice(0, 2)) {
          const three = (await run(id, options(3), concept)).filter((s) => s.section === 'option_gallery')
          expect(three.length, id).toBeGreaterThan(0)
          for (const row of three) {
            expect(isLineup(byId(row.templateId) as unknown as TemplateMeta), `${id} ${row.templateId}`).toBe(true)
            expect(row.shots, id).toEqual([])
          }
          const five = (await run(id, options(5), concept)).filter((s) => s.section === 'option_gallery')
          for (const row of five) expect(isLineup(byId(row.templateId) as unknown as TemplateMeta), `${id} ${row.templateId}`).toBe(false)
        }
      }
    },
    30_000
  )
})
