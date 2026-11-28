/**
 * K7-c (나) 입력 잠금 칸(T1-83 K·T2-58 구성품, T1-61 사용 순서, T1-65 K 사이즈 표 — 통합 11-04 00:4x 승인, 판단 3개 ⓐ).
 * 입력이 있을 때만 채우고(inputSlotsOf와 같은 거르기), 넘치거나 하나라도 길면 목록 전체를 비워 그 칸을 고르지 않는다. 입력이 없으면 아무것도 바뀌지 않는다.
 * 사용 순서는 대표 동작 컷 1장 + 번호 단계 줄이고, 그 컷 글 앞에 단계 제목이 온다(입력 있을 때만). 사이즈 표는 줄 모드(D 사이즈표 matrixRows와 같은 글)다. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import type { CanvasElement } from '@/lib/registration/editor/types/canvas'
import { withSampleInputSlots } from '../__fixtures__/input-slots.sample'
import { inputSlotsOf } from '../input-slots-read'
import { matrixRows } from '../internalized/designcut-long'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { renderTemplate } from './engine'
import { fillInputSlots, lineInputsOf, PARTS_MIN, requiredInputsFit } from './input-values'
import { lineShotsOf } from './line-plan'
import { templateById, templatesOf } from './library'
import { lintTemplate } from './lint'
import { sampleContext, sampleSlots } from './sample'
import type { OrderedSection } from './selection-order'
import { USAGE_STEPS_INPUT, type Template } from './template-types'

const NEW_CELLS = ['product_exposure.parts-numbered', 'product_exposure.parts-side', 'how_to.input-steps', 'option_gallery.size-rows']
const cell = (id: string): Template => {
  const found = templateById(id)
  if (!found) throw new Error(`라이브러리에 없음: ${id}`)
  return found
}
const BASE = { productName: '표본 상품' } as unknown as PdpSpecSheet
const inputsOf = (spec: PdpSpecSheet) => lineInputsOf({ spec_sheet: spec, analysis: {}, copy_sections: { final: {} } } as unknown as PdpJobRow)
const withParts = (value: string) => ({ ...BASE, extraSpecs: [{ key: '구성품', value }] }) as unknown as PdpSpecSheet
const listOf = (id: string, spec: PdpSpecSheet, slot: string) => fillInputSlots(cell(id), inputsOf(spec))[slot] as Array<Record<string, string>> | undefined
const named = (els: CanvasElement[], name: string) => els.filter((e) => e.name === name)
const drawn = (id: string) => {
  const t = cell(id)
  const slots = sampleSlots(t, { mode: 'full' })
  return { slots, out: renderTemplate(t, slots, sampleContext())! }
}

describe('K7-c (나) — 입력 잠금 새 칸', () => {
  it.each(NEW_CELLS)('%s — 린트 위반 0', (id) => {
    expect(lintTemplate(cell(id)).map((v) => `${v.rule}:${v.detail}`)).toEqual([])
  })

  it.each(NEW_CELLS)('%s — 입력이 없으면 고르지 않고, 표본 입력이 있으면 고른다', (id) => {
    expect(requiredInputsFit(cell(id), inputsOf(BASE))).toBe(false)
    expect(requiredInputsFit(cell(id), inputsOf(withSampleInputSlots(BASE)))).toBe(true)
  })

  it('구성품 — inputSlotsOf.parts와 같은 이름, PARTS_MIN 미만·상한 초과·칸보다 긴 이름이면 목록 전체를 비운다', () => {
    const sample = withSampleInputSlots(BASE)
    expect(listOf('product_exposure.parts-numbered', sample, 'parts')?.map((item) => item.name)).toEqual(inputSlotsOf(sample).parts)
    expect(PARTS_MIN).toBe(2)
    expect(listOf('product_exposure.parts-numbered', withParts('연결 태그 포함'), 'parts')).toBeUndefined()
    expect(listOf('product_exposure.parts-numbered', withParts('가, 나, 다, 라, 마, 바, 사'), 'parts')).toBeUndefined()
    expect(listOf('product_exposure.parts-numbered', withParts('본체, 아주아주 긴 이름의 받침 부품 하나'), 'parts')).toBeUndefined()
    expect(listOf('product_exposure.parts-numbered', withParts('본체, 받침, 덮개'), 'parts')).toHaveLength(3)
  })

  it('구성품 — 칸 목록 최소가 PARTS_MIN이고, 칸 최소가 더 낮아도 이름 하나는 구성이 아니라 비운다(D6 구성품 펼침과 같은 문턱)', () => {
    for (const id of ['product_exposure.parts-numbered', 'product_exposure.parts-side']) expect((cell(id).slots.parts as { min: number }).min, id).toBe(PARTS_MIN)
    const loose = structuredClone(cell('product_exposure.parts-numbered'))
    ;(loose.slots.parts as { min: number }).min = 1
    expect(fillInputSlots(loose, inputsOf(withParts('연결 태그 포함'))).parts).toBeUndefined()
    expect(fillInputSlots(loose, inputsOf(withParts('본체, 받침'))).parts).toHaveLength(2)
  })

  it('사용 순서 — inputSlotsOf.usageSteps와 같은 제목, 제목이 긴 단계가 하나라도 있으면 전체를 비운다', () => {
    const sample = withSampleInputSlots(BASE)
    expect(listOf('how_to.input-steps', sample, 'steps')?.map((item) => item.title)).toEqual(inputSlotsOf(sample).usageSteps.map((step) => step.title))
    const long = { ...sample, usageSteps: [{ title: '첫째' }, { title: '가'.repeat(25) }] } as unknown as PdpSpecSheet
    expect(listOf('how_to.input-steps', long, 'steps')).toBeUndefined()
  })

  it('사이즈 줄 — D 사이즈표 matrixRows와 같은 글, 줄 모드', () => {
    const sample = withSampleInputSlots(BASE)
    const expected = matrixRows(inputSlotsOf(sample).sizeMatrix!).map((row) => ({ label: row.label, value: row.value }))
    expect(listOf('option_gallery.size-rows', sample, 'sizes')).toEqual(expected)
  })

  it.each([
    ['product_exposure.parts-numbered', 'parts'],
    ['product_exposure.parts-side', 'parts'],
    ['how_to.input-steps', 'steps'],
  ])('%s — 번호 표식이 항목 수만큼, 항목 사이 구분선', (id, list) => {
    const { slots, out } = drawn(id)
    const count = (slots[list] as unknown[]).length
    expect(named(out.elements, 'designcut-rule')).toHaveLength(count - 1)
    expect(named(out.elements, 'designcut-mark-number').map((e) => e.textProps?.content)).toEqual(Array.from({ length: count }, (_, i) => String(i + 1)))
  })

  it.each(['product_exposure.parts-numbered', 'product_exposure.parts-side', 'how_to.input-steps'])('%s — 번호 원과 같은 줄 글 사이가 비어 있다(원이 글에 닿지 않는다)', (id) => {
    const { out } = drawn(id)
    const marks = named(out.elements, 'designcut-mark')
    const texts = out.elements.filter((e) => e.type === 'text' && !e.name.startsWith('designcut-mark'))
    expect(marks.length).toBeGreaterThan(0)
    for (const mark of marks) {
      const right = mark.transform.x + mark.transform.width
      const row = texts.filter((t) => t.transform.x > mark.transform.x && t.transform.y < mark.transform.y + mark.transform.height && t.transform.y + t.transform.height > mark.transform.y)
      expect(row.length).toBeGreaterThan(0)
      expect(Math.min(...row.map((t) => t.transform.x)) - right).toBeGreaterThanOrEqual(16)
    }
  })

  it('how_to 번호 — 번호를 쓰는 칸은 순서 있는 사용 순서 입력(usage.steps) 필수 칸뿐이고, 그 입력이 없으면 쓰는 법 근거가 있어도 고르지 않는다', () => {
    const numbered = templatesOf('how_to').filter((t) => JSON.stringify(t.flow).includes('"value":"index"'))
    // how_to.flow-steps는 infocells 스위치 잡만 쓰는 화살표 순서 도식(세션 B) — 같은 usage.steps 필수 칸이다
    expect(numbered.map((t) => t.id)).toEqual(['how_to.input-steps', 'how_to.flow-steps'])
    const usageOnly = { ...BASE, usageLocation: '욕실' } as unknown as PdpSpecSheet
    for (const t of numbered) {
      expect(Object.values(t.slots).some((slot) => slot.type === 'list' && slot.input === USAGE_STEPS_INPUT && slot.required), t.id).toBe(true)
      expect(requiredInputsFit(t, inputsOf(usageOnly)), t.id).toBe(false)
    }
  })

  it('사용 순서 대표 컷 글 — 입력이 있으면 단계 제목이 앞에 오고, 없으면 전과 같다', () => {
    const row = { section: 'how_to', templateId: 'how_to.input-steps', shots: [{ slot: 'photo', purpose: 'action', composition: 'in_use' }] } as unknown as OrderedSection
    const copy = new Map([[0, { headline: '표본 제목' }]]) as never
    const [plain] = lineShotsOf([row], copy, [])
    const [none] = lineShotsOf([row], copy, [], inputsOf(BASE))
    const [withSteps] = lineShotsOf([row], copy, [], inputsOf(withSampleInputSlots(BASE)))
    expect(none.show).toBe(plain.show)
    expect(withSteps.show.startsWith('순서 표본 첫째 단계 → 표본 둘째 단계 → 표본 셋째 단계')).toBe(true)
  })
})
