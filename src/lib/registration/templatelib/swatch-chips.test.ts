/**
 * C5 ③ 견본 색 칩(T1-99 K) — option_gallery.swatch-chips는 입력 견본이 모든 옵션 이름과 짝지어질 때만(2개 이상) 채워지고 고를 수 있다.
 * 색은 입력 #RRGGBB 그대로 mark color로만 칠한다(사진·옵션 이름에서 색을 짓지 않는다). 넘치거나 이름이 길면 칸을 비워 후보에서 빠진다. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import { getPdpTestProduct, PDP_TEST_PRODUCT_IDS } from '../__fixtures__/pdp-products'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { renderTemplate } from './engine'
import { ctxOf } from './engine.fixture'
import { fillInputSlots, lineInputsOf, requiredInputsFit } from './input-values'
import { templateById, templatesOf } from './library'
import { lintTemplate } from './lint'
import type { SlotValues, Template } from './template-types'

const ID = 'option_gallery.swatch-chips'
const cell = (): Template => {
  const found = templateById(ID)
  if (!found) throw new Error(`라이브러리에 없음: ${ID}`)
  return found
}
const BASE = { productName: '표본 상품' } as unknown as PdpSpecSheet
const sw = (name: string, hex: string) => ({ name, hex })
const inputsOf = (spec: PdpSpecSheet, options: string[] = []) =>
  lineInputsOf({ spec_sheet: spec, analysis: {}, copy_sections: { final: { options } } } as unknown as PdpJobRow)
const chipsOf = (spec: PdpSpecSheet, options: string[] = []) => fillInputSlots(cell(), inputsOf(spec, options)).chips as Array<Record<string, string>> | undefined
const withSwatches = (swatches: Array<{ name: string; hex: string }>) => ({ ...BASE, swatches }) as unknown as PdpSpecSheet
const TWO = [sw('화이트', '#FFFFFF'), sw('네이비', '#1F2A44')]

describe('C5 ③ — 견본 색 칩', () => {
  it('option_gallery에 칩 칸이 하나 있고 사진·사실을 쓰지 않는다, 린트 위반 0', () => {
    expect(templatesOf('option_gallery').filter((t) => t.id === ID)).toHaveLength(1)
    expect(cell().needs).toMatchObject({ evidence: ['option'], photos: 0 })
    expect(lintTemplate(cell()).map((v) => `${v.rule}:${v.detail}`)).toEqual([])
  })

  it('입력 견본이 없으면 칩이 비고 칸을 고를 수 없다', () => {
    expect(chipsOf(BASE, ['데이지 화이트', '데이지 네이비'])).toBeUndefined()
    expect(requiredInputsFit(cell(), inputsOf(BASE, ['데이지 화이트', '데이지 네이비']))).toBe(false)
  })

  it('모든 옵션이 짝이면 옵션 순서·옵션 이름으로, 색은 입력 그대로 채운다(옵션과 안 맞는 견본은 뺀다)', () => {
    const spec = withSwatches([...TWO, sw('그린', '#3A6B47')])
    expect(chipsOf(spec, ['데이지 네이비', '데이지 화이트'])).toEqual([
      { name: '데이지 네이비', hex: '#1F2A44' },
      { name: '데이지 화이트', hex: '#FFFFFF' },
    ])
    expect(requiredInputsFit(cell(), inputsOf(spec, ['데이지 네이비', '데이지 화이트']))).toBe(true)
  })

  it('짝 없는 옵션이 하나라도 있으면 칩이 비고 칸을 고를 수 없다 — 일부 색만 보여 색 수를 줄여 보이지 않게(통합 06:2x DECISION)', () => {
    const spec = withSwatches([...TWO, sw('그린', '#3A6B47')])
    expect(chipsOf(spec, ['데이지 네이비', '데이지 화이트', '데이지 핑크'])).toBeUndefined()
    expect(requiredInputsFit(cell(), inputsOf(spec, ['데이지 네이비', '데이지 화이트', '데이지 핑크']))).toBe(false)
  })

  it('옵션이 없으면 견본 이름 그대로, 짝이 2개 미만이면 칸을 고르지 않는다', () => {
    expect(chipsOf(withSwatches(TWO))).toEqual([{ name: '화이트', hex: '#FFFFFF' }, { name: '네이비', hex: '#1F2A44' }])
    expect(chipsOf(withSwatches(TWO), ['데이지 화이트', '데이지 핑크'])).toBeUndefined()
  })

  it('이름 하나라도 칸보다 길거나 칸 상한을 넘으면 자르지 않고 전체를 비운다', () => {
    // 이름 상한 8자(공백 뺌) — 8자는 그대로, 9자는 그 이름만 자르거나 빼지 않고 목록 전체가 빈다(칸을 고르지 않는다)
    expect(cell().slots.chips).toMatchObject({ fields: { name: { maxChars: 8, maxLines: 1 } } })
    expect(chipsOf(withSwatches(TWO), ['가나다라마 화이트', '데이지 네이비'])).toEqual([
      { name: '가나다라마 화이트', hex: '#FFFFFF' },
      { name: '데이지 네이비', hex: '#1F2A44' },
    ])
    expect(chipsOf(withSwatches(TWO), ['가나다라마바 화이트', '데이지 네이비'])).toBeUndefined()
    expect(requiredInputsFit(cell(), inputsOf(withSwatches(TWO), ['가나다라마바 화이트', '데이지 네이비']))).toBe(false)
    expect(chipsOf(withSwatches(TWO), ['아주 긴 데이지 화이트 옵션', '데이지 네이비'])).toBeUndefined()
    const seven = Array.from({ length: 7 }, (_, i) => sw(`색${i + 1}`, '#123456'))
    expect(chipsOf(withSwatches(seven))).toBeUndefined()
  })

  it('입력 색으로 칠한 도형(옅은 테두리)과 이름만 그리고, #RRGGBB가 아니면 그 점을 그리지 않는다', () => {
    const values: SlotValues = { headline: '색상을 골라 보세요', chips: [{ name: '화이트', hex: '#FFFFFF' }, { name: '네이비', hex: '#1F2A44' }] }
    const out = renderTemplate(cell(), values, ctxOf({ bg: 'W' }))
    const dots = (out?.elements ?? []).filter((e) => e.name === 'designcut-swatch')
    expect(dots.map((e) => (e as { shapeProps?: { fill?: string } }).shapeProps?.fill)).toEqual(['#FFFFFF', '#1F2A44'])
    expect(dots.every((e) => Boolean((e as { shapeProps?: { stroke?: string } }).shapeProps?.stroke))).toBe(true)
    const bad = renderTemplate(cell(), { ...values, chips: [{ name: '화이트', hex: 'white' }, { name: '네이비', hex: '#1F2A44' }] }, ctxOf({ bg: 'W' }))
    expect((bad?.elements ?? []).filter((e) => e.name === 'designcut-swatch')).toHaveLength(1)
  })

  it('시험 상품 11개에는 견본 입력이 없어 칸이 채워지지 않는다(기본 입력 페이지 그대로)', () => {
    for (const id of PDP_TEST_PRODUCT_IDS) {
      const product = getPdpTestProduct(id)
      expect(chipsOf(product.specSheet, (product.specSheet.colorOptions ?? []).map(String)), id).toBeUndefined()
    }
  })
})
