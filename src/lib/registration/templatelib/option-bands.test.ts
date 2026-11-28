/**
 * 옵션 색 띠(partsbands 스위치, 하네스 J54 — 통합 decide 32, J52 대조표 ②-4) — 쿠팡 경쟁 골프티처럼 옵션마다 그 옵션 사진 색을 딴 띠 + 판매자 옵션 이름.
 * 이름은 입력 그대로(별명 짓지 않음), 색은 사진 측정값이다. 꺼진 잡은 입력·근거가 지금과 같아 이 템플릿이 후보에 오르지 않는다. 모델 콜 0(유료 0).
 */

import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { measureOptionColors } from '../option-colors'
import type { DesigncutPhotoRecord, PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { ITEM_BAND_SEPARATION_MIN, itemBandSurface, renderTemplate } from './engine'
import { fillInputSlots, lineInputsOf, requiredInputsFit, type LineInputs } from './input-values'
import { templateById } from './library'
import { lintTemplate } from './lint'
import { sampleContext, sampleSlots } from './sample'
import { lineEvidenceOf, OPTION_BANDS_EVIDENCE } from './select-line'
import type { Template } from './template-types'

const BANDS_ID = 'option_gallery.named-bands'
const bands = () => templateById(BANDS_ID) as Template
const photo = (i: number) => `https://cdn.example.com/option-${i}.jpg`
const options = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `옵션${i + 1}`, image: photo(i) }))
const spec = { productName: '골프티', colorOptions: ['옵션1', '옵션2', '옵션3'] } as unknown as PdpSpecSheet
const inputs = (opts: LineInputs['options'], colors?: LineInputs['optionColors']): LineInputs => ({ spec, cards: [], options: opts, ...(colors ? { optionColors: colors } : {}) })
const colorsOf = (opts: LineInputs['options'], hexes = ['#1E5AA8', '#D93A2B', '#2E8B57', '#F2C230']) => opts.map((o, i) => ({ label: o.label, hex: hexes[i] }))

describe('옵션 사진 색 재기(measureOptionColors)', () => {
  const measured = (hex: string | null): DesigncutPhotoRecord => ({ product: hex }) as unknown as DesigncutPhotoRecord
  const deps = (hexes: Array<string | null>, failAt = -1) => {
    let i = 0
    return {
      fetchImage: async (url: string) => (i === failAt ? (i++, null) : { data: url, mediaType: 'image/jpeg' as const }),
      measure: async () => measured(hexes[i++] ?? null),
    }
  }

  it('옵션마다 사진에서 잰 색을 이름과 함께 남긴다', async () => {
    const record = await measureOptionColors(options(3), deps(['#111111', '#222222', '#333333']) as never)
    expect(record).toEqual({
      version: 1,
      colors: [
        { label: '옵션1', image: photo(0), hex: '#111111' },
        { label: '옵션2', image: photo(1), hex: '#222222' },
        { label: '옵션3', image: photo(2), hex: '#333333' },
      ],
    })
  })

  it('옵션 하나·다섯 개 이상·사진 없는 옵션·내려받기 실패·색 없음은 failed — 일부만 칠하지 않는다', async () => {
    expect(await measureOptionColors(options(1), deps(['#111111']) as never)).toEqual({ version: 1, failed: 'options_under_two' })
    expect(await measureOptionColors(options(5), deps([]) as never)).toEqual({ version: 1, failed: 'options_over_max' })
    expect(await measureOptionColors([...options(2), { label: '옵션3', image: null }], deps([]) as never)).toEqual({ version: 1, failed: 'option_photo_missing' })
    expect(await measureOptionColors(options(2), deps(['#111111', '#222222'], 1) as never)).toEqual({ version: 1, failed: 'fetch_failed' })
    expect(await measureOptionColors(options(2), deps(['#111111', null]) as never)).toEqual({ version: 1, failed: 'no_product_color' })
  })
})

describe('옵션 색 띠 입력(option.bands)', () => {
  it('모든 옵션이 잰 색을 가지면 판매자 옵션 이름 그대로 색과 짝짓는다', () => {
    const opts = options(3)
    expect(fillInputSlots(bands(), inputs(opts, colorsOf(opts))).bands).toEqual([
      { name: '옵션1', hex: '#1E5AA8' },
      { name: '옵션2', hex: '#D93A2B' },
      { name: '옵션3', hex: '#2E8B57' },
    ])
    expect(requiredInputsFit(bands(), inputs(opts, colorsOf(opts)))).toBe(true)
  })

  it('색이 없거나 일부 옵션만 색이 있거나 다섯 개 이상이면 그리지 않는다', () => {
    const opts = options(3)
    expect(requiredInputsFit(bands(), inputs(opts))).toBe(false)
    expect(requiredInputsFit(bands(), inputs(opts, colorsOf(opts).slice(0, 2)))).toBe(false)
    const five = options(5)
    expect(requiredInputsFit(bands(), inputs(five, five.map((o) => ({ label: o.label, hex: '#1E5AA8' }))))).toBe(false)
  })

  it('잡 입력: partsbands 잡이고 잰 기록이 있을 때만 옵션 색을 싣는다 — 꺼진 잡은 기록이 있어도 입력이 지금과 같다', () => {
    const record = { version: 1 as const, colors: options(2).map((o, i) => ({ label: o.label, image: o.image as string, hex: ['#1E5AA8', '#D93A2B'][i] })) }
    const jobOf = (features: string[]) =>
      ({ spec_sheet: spec, analysis: { enrichment: { version: 1, features } }, copy_sections: { final: {} }, section_plan: { option_colors: record } }) as unknown as PdpJobRow
    expect(lineInputsOf(jobOf(['templatelib'])).optionColors).toBeUndefined()
    expect('optionColors' in lineInputsOf(jobOf(['templatelib']))).toBe(false)
    expect(lineInputsOf(jobOf(['templatelib', 'partsbands'])).optionColors).toEqual([
      { label: '옵션1', hex: '#1E5AA8' },
      { label: '옵션2', hex: '#D93A2B' },
    ])
  })

  it('근거 option_bands는 켠 잡에만 선다 — 꺼진 잡은 근거 잠금으로 후보에 오르지 않는다', () => {
    expect(lineEvidenceOf({ spec }).has(OPTION_BANDS_EVIDENCE)).toBe(false)
    expect(lineEvidenceOf({ spec, partsBands: true }).has(OPTION_BANDS_EVIDENCE)).toBe(true)
    expect(bands().needs.evidence).toContain(OPTION_BANDS_EVIDENCE)
  })
})

describe('옵션 색 띠 그리기', () => {
  it('띠 면은 옵션 색을 바탕 쪽으로 섞고 바탕 글자색 대비 4.5를 지킨다 — 색이 아니면 null', () => {
    const parent = { fill: '#FFFFFF', text: '#1A1A1A', dark: false }
    for (const hex of ['#1E5AA8', '#D93A2B', '#2E8B57', '#F2C230', '#000000', '#FFFFFF']) {
      const surf = itemBandSurface(hex, parent)
      expect(surf, hex).not.toBeNull()
      expect(contrastRatio(parseColor(surf!.text)!, parseColor(surf!.fill)!), hex).toBeGreaterThanOrEqual(4.5)
      expect(surf!.text).toBe(parent.text)
    }
    for (const bad of [undefined, '', 'red', '#12', 42]) expect(itemBandSurface(bad, parent), String(bad)).toBeNull()
  })

  it('바탕과 같은 색 옵션(흰 옵션 × 흰 바탕)도 띠가 바탕과 구분된다 — render-check 42848359713 PB-bands-4 화이트', () => {
    for (const parent of [
      { fill: '#FFFFFF', text: '#1A1A1A', dark: false },
      { fill: '#F5F1EA', text: '#2B2B2B', dark: false },
    ]) {
      for (const hex of ['#FFFFFF', parent.fill, '#FEFEFE']) {
        const surf = itemBandSurface(hex, parent)!
        expect(contrastRatio(parseColor(surf.fill)!, parseColor(parent.fill)!), `${hex} on ${parent.fill}`).toBeGreaterThanOrEqual(ITEM_BAND_SEPARATION_MIN)
        expect(contrastRatio(parseColor(surf.text)!, parseColor(surf.fill)!), `${hex} on ${parent.fill}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('항목마다 다른 색 띠를 칠한다(표본 채움)', () => {
    const t = bands()
    const out = renderTemplate(t, sampleSlots(t, { mode: 'full' }), sampleContext())!
    const fills = out.elements.filter((el) => el.name === 'designcut-panel').map((el) => (el as { shapeProps?: { fill?: string } }).shapeProps?.fill)
    expect(fills.length).toBeGreaterThanOrEqual(2)
    expect(new Set(fills).size).toBeGreaterThan(1)
  })

  it('전수 검사 위반이 없다', () => {
    expect(lintTemplate(bands())).toEqual([])
  })
})
