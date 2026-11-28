/**
 * 층 띠(적용 K1 T1-85·T2-59, 통합 23:4x 승인 설계) — spec_sheet.layers를 칸 폭 띠로 쌓는다. 위가 옅고 아래가 짙은 같은 강조색 단계, 띠마다 글 대비 4.5.
 * 값이 있을 때만 그린다(오너 11-02 '입력 없는 항목은 값이 있을 때만 표시'). LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { mix, surfaceOf } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import { rgbToLch } from '../internalized/designcut-palette'
import type { PdpSpecSheet } from '../pdp-state'
import { colorSetsOf, isDarkYellow } from './color-sets'
import { CONCEPTS } from './concepts'
import { LAYER_BAND_NAME, renderTemplate } from './engine'
import { fillInputSlots, requiredInputsFit, type LineInputs } from './input-values'
import { LAYER_MIN_CONTRAST, LAYER_MIN_DELTA_E, LAYER_MIX, deltaE, layerInks, layerSteps } from './layer-band'
import { templateById } from './library'
import { LAYER_SURFACES, lintTemplate } from './lint'
import { screenKey, skeletonKey } from './lint-category'
import { sampleContext, sampleSlots } from './sample'
import { slotLinesOf } from './slot-lines'
import type { RepeatNode, SlotItem, Template } from './template-types'

interface El {
  id: string
  name: string
  transform: { x: number; y: number; width: number; height: number }
  textProps?: { color?: string; content?: string }
  shapeProps?: { fill?: string }
  containerOf?: string[]
}
const els = (out: { elements: unknown[] }) => out.elements as El[]
const ratio = (a: string, b: string) => contrastRatio(parseColor(a)!, parseColor(b)!)
const TEMPLATE = templateById('sub_div.layer-stack') as Template
const inputsOf = (spec: Partial<PdpSpecSheet>): LineInputs => ({ spec: spec as PdpSpecSheet, cards: [], options: [] })
const layersOf = (values: ReturnType<typeof fillInputSlots>) => values.layers as SlotItem[] | undefined
/** 입력 정리 상한(INPUT_SLOT_LIMITS.layer) min 2 ~ max 5 */
const LAYER_COUNTS = [2, 3, 4, 5]

describe('층 띠 색 단계', () => {
  it('단계는 위 0.10에서 아래로 같은 간격으로 짙어지고, 한 층이면 가운데 값이다', () => {
    expect(layerSteps(3, 0.46)).toEqual([0.1, 0.28, 0.46].map((v) => expect.closeTo(v, 6)))
    expect(layerSteps(1, 0.46)[0]).toBeCloseTo(0.28, 6)
    expect(LAYER_MIX.bottoms[0]).toBe(0.46)
  })

  it('44컨셉 모든 색 조합·밝은 바탕(W·N·T)·층 2~5개에서 띠 글 대비 4.5 이상, 첫 띠·이웃 띠 색차 3 이상, 탁한 노랑 면 없음, 위 → 아래로 짙어진다', () => {
    let checked = 0
    let low = Infinity
    let lowDelta = Infinity
    let sets = 0
    let deeper = 0
    expect(CONCEPTS.length).toBe(44)
    for (const concept of CONCEPTS) {
      for (const set of colorSetsOf(concept).sets) {
        sets++
        for (const bg of LAYER_SURFACES) {
          const surf = surfaceOf(bg, set.colors)
          for (const count of LAYER_COUNTS) {
            const where = `${set.id} ${bg} ${count}층`
            const inks = layerInks(surf, set.colors, count)
            expect(inks, where).not.toBeNull()
            expect(inks, where).toHaveLength(count)
            // 옅은 강조색이라 짙은 강조 글자색으로 섞은 조합 수(보고)
            if (deltaE(inks![0].fill, mix(surf.fill, set.colors.accent, LAYER_MIX.top)) > 0.5) deeper++
            inks!.forEach((ink, i) => {
              checked++
              const r = ratio(ink.text, ink.fill)
              low = Math.min(low, r)
              expect(r, `${where} 띠 ${i + 1} 대비`).toBeGreaterThanOrEqual(LAYER_MIN_CONTRAST)
              expect(isDarkYellow(rgbToLch(parseColor(ink.fill)!)), `${where} 탁한 노랑 면`).toBe(false)
              const delta = deltaE(ink.fill, i === 0 ? surf.fill : inks![i - 1].fill)
              lowDelta = Math.min(lowDelta, delta)
              expect(delta, `${where} 띠 ${i + 1} 색차`).toBeGreaterThanOrEqual(LAYER_MIN_DELTA_E)
              // 아래가 더 짙다 — 섹션 바탕에서 더 멀다(같은 색을 더 섞었다)
              if (i > 0) expect(deltaE(ink.fill, surf.fill), where).toBeGreaterThan(deltaE(inks![i - 1].fill, surf.fill))
            })
          }
        }
      }
    }
    expect(checked).toBe(sets * LAYER_SURFACES.length * LAYER_COUNTS.reduce((sum, n) => sum + n, 0))
    expect(low).toBeGreaterThanOrEqual(LAYER_MIN_CONTRAST)
    expect(lowDelta).toBeGreaterThanOrEqual(LAYER_MIN_DELTA_E)
    console.log(`[층 띠] 색 조합 ${sets} × 바탕 ${LAYER_SURFACES.length} × 층 ${LAYER_COUNTS.join('·')}: 최저 대비 ${low.toFixed(2)} · 최저 색차 ${lowDelta.toFixed(2)} · 짙은 강조 글자색으로 섞은 경우 ${deeper}`)
    // 1,037 × 3 × 14띠 전수라 단독 약 3초 — 넓은 실행(작업자 1)에서 기본 5초를 넘지 않게 둔다(steps·icons 전수 시험의 흔들림과 같은 종류)
  }, 20_000)

  it('렌더 — 컨셉마다 첫 색 조합·W·N·T·2층과 5층에서 띠 수, 맞닿음, 띠 안 글색 = 계산한 글색(대비 4.5)', () => {
    const t: Template = { ...TEMPLATE, surfaces: [...LAYER_SURFACES] }
    let drawn = 0
    for (const concept of CONCEPTS) {
      const set = colorSetsOf(concept).sets[0]
      for (const bg of LAYER_SURFACES) {
        for (const count of [2, 5]) {
          const where = `${set.id} ${bg} ${count}층`
          const values = { ...sampleSlots(t, { mode: 'full' }) }
          values.layers = (values.layers as SlotItem[]).slice(0, count)
          const out = renderTemplate(t, values, sampleContext({ colors: set.colors, bg }))
          expect(out, where).not.toBeNull()
          const all = els(out!)
          const bands = all.filter((e) => e.name === LAYER_BAND_NAME)
          const inks = layerInks(surfaceOf(bg, set.colors), set.colors, count)!
          expect(bands.map((b) => b.shapeProps!.fill), where).toEqual(inks.map((ink) => ink.fill))
          bands.forEach((band, i) => {
            const texts = all.filter((e) => e.textProps && band.containerOf?.includes(e.id))
            expect(texts, where).toHaveLength(2)
            for (const text of texts) expect(ratio(text.textProps!.color!, band.shapeProps!.fill!), `${where} 띠 ${i + 1}`).toBeGreaterThanOrEqual(LAYER_MIN_CONTRAST)
            // 맞닿음 — 앞 띠 끝이 이 띠 시작이다
            if (i > 0) expect(band.transform.y, where).toBe(bands[i - 1].transform.y + bands[i - 1].transform.height)
          })
          drawn++
        }
      }
    }
    expect(drawn).toBe(CONCEPTS.length * LAYER_SURFACES.length * 2)
  })

  it('색을 못 맞추는 바탕이면 null — 엔진이 목록을 그리지 않는다(지어낸 대비로 그리지 않는다)', () => {
    const c = sampleContext().colors
    // 바탕·강조색·글자 후보가 모두 같은 중간 회색이면 어떤 단계도 대비 4.5가 안 된다
    const grey = { ...c, accent: '#777777', ink: '#777777', onDeep: '#777777' }
    expect(layerInks({ fill: '#777777', text: '#777777' }, grey, 3)).toBeNull()
  })
})

describe('층 띠 그리기', () => {
  it('띠는 칸 폭(740)이고 글은 안쪽 여백 40 안 660 폭이다 — slot-lines 폭과 같다', () => {
    const out = renderTemplate(TEMPLATE, sampleSlots(TEMPLATE, { mode: 'full' }), sampleContext({ bg: 'W' }))!
    const band = els(out).find((e) => e.name === LAYER_BAND_NAME)!
    expect(band.transform).toMatchObject({ x: 60, width: 740 })
    const name = els(out).find((e) => e.name === 'designcut-name')!
    expect(name.transform).toMatchObject({ x: 100, width: 660 })
    expect(slotLinesOf(TEMPLATE.flow).get('layers.name')?.width).toBe(660)
    expect(slotLinesOf(TEMPLATE.flow).get('layers.note')?.width).toBe(660)
  })

  it('목록이 최소 수 미만이면 그리지 않는다(필수라 템플릿도 안 그려진다)', () => {
    const values = { ...sampleSlots(TEMPLATE, { mode: 'full' }), layers: [{ name: '겉감' }] }
    expect(renderTemplate(TEMPLATE, values, sampleContext({ bg: 'W' }))).toBeNull()
  })
})

describe('층 입력값(spec_sheet.layers)', () => {
  const spec = (layers: unknown): Partial<PdpSpecSheet> => ({ layers: layers as PdpSpecSheet['layers'], certificationInfo: '' })

  it('값이 없으면 칸을 채우지 않고 필수라 템플릿을 고르지 않는다 — 시험 상품 11개(값 없음)의 계획은 그대로다', () => {
    expect(layersOf(fillInputSlots(TEMPLATE, inputsOf({})))).toBeUndefined()
    expect(requiredInputsFit(TEMPLATE, inputsOf({}))).toBe(false)
  })

  it('층 이름·설명을 순서대로 채우고, 칸보다 긴 설명은 그 층 설명만 뺀다', () => {
    const value = layersOf(
      fillInputSlots(
        TEMPLATE,
        inputsOf(
          spec([
            { name: '겉감 폴리에스터', note: '물방울이 스며들지 않아요' },
            { name: '충전재', note: '가볍고 따뜻한 구스다운 충전재가 고르게 들어 있어 어느 쪽으로 눕혀도 두께가 같아요' },
            { name: '안감' },
          ])
        )
      )
    )
    expect(value).toEqual([{ name: '겉감 폴리에스터', note: '물방울이 스며들지 않아요' }, { name: '충전재' }, { name: '안감' }])
    expect(requiredInputsFit(TEMPLATE, inputsOf(spec([{ name: '겉감' }, { name: '안감' }])))).toBe(true)
  })

  it('칸보다 긴 이름의 층이 하나라도 있으면 목록 전체를 비우고, 그 템플릿은 고르지 않는 칸이 되며 빈 띠도 그리지 않는다', () => {
    const over = inputsOf(spec([{ name: '겉감' }, { name: '열세글자가넘는아주긴층이름' }, { name: '안감' }]))
    const value = fillInputSlots(TEMPLATE, over)
    // 한 층만 빼면 단면이 틀린다 — 목록 전체가 빈다
    expect(layersOf(value)).toBeUndefined()
    // 고르기 전에 걸러진다(필수 입력 칸이 빔)
    expect(requiredInputsFit(TEMPLATE, over)).toBe(false)
    // 카피·사진을 다 채워 억지로 그려도 섹션이 그려지지 않는다 — 빈 띠·제목만 남은 칸이 없다
    const rest = { ...sampleSlots(TEMPLATE, { mode: 'full' }) }
    delete rest.layers
    expect(renderTemplate(TEMPLATE, { ...rest, ...value }, sampleContext({ bg: 'W' }))).toBeNull()
  })

  it('규제 표현이 든 층은 입력 정리(inputSlotsOf)와 같이 빼고, 남은 층이 최소 수 미만이면 비운다', () => {
    const value = layersOf(fillInputSlots(TEMPLATE, inputsOf(spec([{ name: '겉감' }, { name: '건강기능식품' }, { name: '안감' }]))))
    expect(value).toEqual([{ name: '겉감' }, { name: '안감' }])
    expect(layersOf(fillInputSlots(TEMPLATE, inputsOf(spec([{ name: '겉감' }, { name: '건강기능식품' }]))))).toBeUndefined()
  })
})

describe('층 띠 린트·키', () => {
  const variant = (patch: Partial<RepeatNode>, surfaces = TEMPLATE.surfaces): Template => {
    const t = JSON.parse(JSON.stringify(TEMPLATE)) as Template
    Object.assign(t.flow.find((n) => n.kind === 'repeat')!, patch)
    return { ...t, surfaces }
  }
  const details = (t: Template) => lintTemplate(t).map((v) => v.detail)
  const LAYER_RULE = '층 띠(layer)는 한 줄 반복의 글 항목에만(간격·구분선·화살표·행 맞춤·번갈아와 함께 쓰지 않는다)'

  it('라이브러리 칸은 위반 0이다', () => {
    expect(lintTemplate(TEMPLATE)).toEqual([])
  })

  it('간격·구분선·여러 열·사진 항목과 함께 쓰면 걸린다', () => {
    expect(details(variant({ rule: true }))).toContain(LAYER_RULE)
    expect(details(variant({ gap: 'itemGap' }))).toContain(LAYER_RULE)
    expect(details(variant({ columns: 2 }))).toContain(LAYER_RULE)
    expect(details(variant({ nodes: [{ kind: 'image', slot: 'name' }] }))).toContain(LAYER_RULE)
  })

  it('짙은 면·사진 바탕을 두면 걸린다', () => {
    expect(details(variant({}, ['W', 'D'])).some((d) => d.startsWith('층 띠(layer) 템플릿은 밝은 바탕'))).toBe(true)
  })

  it('뼈대·화면 키가 일반 목록과 다르다', () => {
    const plain = variant({ layer: undefined })
    expect(skeletonKey(TEMPLATE.flow)).not.toBe(skeletonKey(plain.flow))
    expect(screenKey(TEMPLATE.flow, TEMPLATE.slots)).not.toBe(screenKey(plain.flow, plain.slots))
    expect(TEMPLATE.signature.container).toBe('card')
  })
})
