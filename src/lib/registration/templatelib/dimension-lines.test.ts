/**
 * 치수선(적용 K14, 오너 11-04 13:4x) — 빈 사각형 대신 사이즈 단독 컷의 제품 경계에 가로·세로 선을 긋는다. 경계를 못 쟀거나 비율이 입력과 다르면 선 없이 사진과 글만 둔다. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import type { ProductBox } from '../pdp-state'
import { renderTemplate } from './engine'
import { ctxOf, imageSlot, templateOf, textSlot } from './engine.fixture'
import { templateById } from './library'
import { lineShotsOf } from './line-plan'
import { assignShots, type OrderedSection } from './selection-order'
import type { DimensionNode } from './template-types'

/** 3:4 사진 안에서 제품이 0.6×0.6 — 제품 가로:세로 = 0.45:0.6 = 3:4 */
const BOX: ProductBox = { left: 0.2, top: 0.2, width: 0.6, height: 0.6, aspect: 0.75, background: '#F5F5F5' }
const ctx = (box: ProductBox | null) => ctxOf({ productBoxOf: () => box })
const template = (node: Partial<DimensionNode> = {}) =>
  templateOf({
    flow: [{ kind: 'dimension', slot: 'photo', widthSlot: 'width', heightSlot: 'height', ...node }],
    slots: {
      photo: imageSlot({ required: true, aspect: ['3:4'] }),
      width: textSlot({ source: 'input', input: 'spec.size', facts: 1 }),
      height: textSlot({ source: 'input', input: 'spec.size', facts: 1 }),
      depth: textSlot({ source: 'input', input: 'spec.size.depth', facts: 1 }),
    },
  })
const draw = (values: Record<string, string>, box: ProductBox | null = BOX, node: Partial<DimensionNode> = {}) => renderTemplate(template(node), { photo: 'a', ...values }, ctx(box))!
const leaders = (out: ReturnType<typeof draw>) => out.elements.filter((e) => e.name.startsWith('annotation-leader-'))
const labels = (out: ReturnType<typeof draw>) => out.elements.filter((e) => e.name.startsWith('annotation-label-')).map((e) => e.textProps?.content)
const FITS = { width: '가로 30cm', height: '세로 40cm' }

describe('제품 경계에 긋는다', () => {
  it('선은 사진 틀 위에 그리고 빈 사각형이 없다 — 가로선은 제품 폭, 세로선은 제품 높이다', () => {
    const out = draw(FITS)
    const [photo] = out.elements.filter((e) => e.name === 'designcut-scene')
    expect(leaders(out)).toHaveLength(1)
    const [line] = leaders(out)
    expect(line.transform).toMatchObject({ x: photo.transform.x, y: photo.transform.y, width: photo.transform.width, height: photo.transform.height })
    const svg = line.svgProps?.svgString ?? ''
    // 닫힌 도형(Z)이 없다 — 지금까지의 윤곽 상자
    expect(svg).not.toContain('Z')
    const { width: w, height: h } = photo.transform
    // 사진은 틀 안에 contain — 제품 경계는 그 사진 넓이의 비율이다(sizeLines.ts)
    const fullH = Math.min(h, w / BOX.aspect)
    const fullW = fullH * BOX.aspect
    const left = Math.round(photo.transform.x + (w - fullW) / 2 + BOX.left * fullW) - photo.transform.x
    const top = Math.round(photo.transform.y + (h - fullH) / 2 + BOX.top * fullH) - photo.transform.y
    const [right, bottom] = [left + Math.round(BOX.width * fullW), top + Math.round(BOX.height * fullH)]
    expect(svg).toContain(`M${left} `)
    expect(svg).toContain(`H${right}`)
    expect(svg).toContain(` ${top}V${bottom}`)
    expect(labels(out)).toEqual(['가로 30cm', '세로 40cm'])
  })

  it('한 축만 있으면 그 선만 긋는다', () => {
    const only = leaders(draw({ width: '가로 30cm' }))[0].svgProps?.svgString ?? ''
    expect((only.match(/M/g) ?? []).length).toBe(3)
  })

  it('제품이 틀에 가까우면 선을 사진 안으로 당긴다', () => {
    const big: ProductBox = { ...BOX, left: 0.01, top: 0.01, width: 0.98, height: 0.98 }
    const out = draw(FITS, big)
    const [photo] = out.elements.filter((e) => e.name === 'designcut-scene')
    const numbers = (leaders(out)[0].svgProps?.svgString ?? '').match(/d="([^"]+)"/)![1].match(/-?\d+(\.\d+)?/g)!.map(Number)
    expect(Math.max(...numbers)).toBeLessThanOrEqual(Math.max(photo.transform.width, photo.transform.height))
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0)
  })

  it('짙은 바탕 사진에는 흰 선을 긋는다', () => {
    expect(leaders(draw(FITS, { ...BOX, background: '#101010' }))[0].svgProps?.svgString).toContain('stroke="#FFFFFF"')
    expect(leaders(draw(FITS))[0].svgProps?.svgString).not.toContain('stroke="#FFFFFF"')
  })
})

describe('믿을 수 없으면 선을 긋지 않는다 — 틀린 선보다 낫다', () => {
  it('경계를 못 쟀거나(옛 잡 포함) 믿기 어렵거나 비율이 입력과 다르면 사진과 글만 남는다', () => {
    for (const out of [draw(FITS, null), draw(FITS, { ...BOX, uncertain: true }), draw({ width: '가로 30cm', height: '세로 90cm' })]) {
      expect(leaders(out)).toEqual([])
      expect(out.elements.filter((e) => e.name === 'designcut-scene')).toHaveLength(1)
      expect(labels(out)).toHaveLength(2)
    }
  })

  it('두 축 가운데 단위가 없으면 비율을 믿지 않는다', () => {
    expect(leaders(draw({ width: '가로 30', height: '세로 40cm' }))).toEqual([])
  })

  it('치수가 하나도 없으면 그리지 않는다', () => {
    expect(renderTemplate(template(), { photo: 'a' }, ctx(BOX))).toBeNull()
  })
})

describe('깊이·나란히', () => {
  it('깊이는 선 없이 글로만 적는다 — 이름표 셋, 선은 가로·세로뿐', () => {
    const out = draw({ ...FITS, depth: '깊이 10cm' }, BOX, { depthSlot: 'depth' })
    expect(labels(out)).toEqual(['가로 30cm', '세로 40cm', '깊이 10cm'])
    expect(leaders(out)).toHaveLength(1)
    expect((leaders(out)[0].svgProps?.svgString?.match(/M/g) ?? []).length).toBe(6)
  })

  it('나란히 칸은 사진 옆 반 칸에 치수 글을 둔다 — 사진과 겹치지 않고 칸 안이다', () => {
    const out = draw(FITS, BOX, { side: true })
    const [photo] = out.elements.filter((e) => e.name === 'designcut-scene')
    for (const chip of out.elements.filter((e) => e.name.startsWith('annotation-chip-'))) {
      expect(chip.transform.x).toBeGreaterThanOrEqual(photo.transform.x + photo.transform.width)
      expect(chip.transform.x + chip.transform.width).toBeLessThanOrEqual(800)
      expect(chip.transform.y).toBeGreaterThanOrEqual(photo.transform.y)
      expect(chip.transform.y + chip.transform.height).toBeLessThanOrEqual(photo.transform.y + photo.transform.height)
    }
  })

  it('나란히 칸에 글이 넘치면 사진 아래 전체 폭으로 내린다', () => {
    const long = '가로 1234567890123456789012345cm'
    const out = draw({ width: long, height: '세로 40cm' }, BOX, { side: true })
    const [photo] = out.elements.filter((e) => e.name === 'designcut-scene')
    for (const chip of out.elements.filter((e) => e.name.startsWith('annotation-chip-'))) expect(chip.transform.y).toBeGreaterThanOrEqual(photo.transform.y + photo.transform.height)
  })
})

describe('계획 기록', () => {
  const rowOf = (id: string): OrderedSection => {
    const t = templateById(id)!
    return { section: t.section, templateId: id, bg: 'W', shots: assignShots([t])[0] }
  }

  it('치수 칸 컷에만 사이즈 컷 표시가 붙는다', () => {
    const shots = lineShotsOf([rowOf('spec_table.dimension'), rowOf('petit_div.hashtag-grid')], new Map(), [])
    expect(shots.filter((shot) => shot.sizeCut).map((shot) => shot.section)).toEqual(['spec_table'])
    expect(shots.some((shot) => !shot.sizeCut)).toBe(true)
  })
})
