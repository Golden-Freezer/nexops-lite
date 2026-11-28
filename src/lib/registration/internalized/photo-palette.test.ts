/**
 * 원천 사진 색 측정(08 §4.1 원안) — 합성 픽셀로 규칙을 고정한다. 실제 원천 사진(R1 P02·P03·P07)은 designcut-photo.test.ts.
 */

import { describe, expect, it } from 'vitest'
import { measurePhotoColors } from './photo-palette'
import { rgbToLch } from './designcut-palette'
import type { DesigncutPhoto } from '../pdp-state'

type Rgba = [number, number, number, number]

/** w×h 캔버스 — 바탕 색 위에 사각형들을 칠한다 */
function canvas(w: number, h: number, bg: Rgba, rects: Array<{ x: number; y: number; w: number; h: number; c: Rgba }>) {
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const r = rects.find((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h)
      px.set(r ? r.c : bg, (y * w + x) * 4)
    }
  return px
}
const lch = (hex: string | null) => {
  const n = parseInt(hex!.slice(1), 16)
  return rgbToLch([(n >> 16) & 255, (n >> 8) & 255, n & 255])
}
const measured = (px: Uint8Array, w = 48, h = 48) => measurePhotoColors(px, w, h) as DesigncutPhoto

const PINK: Rgba = [247, 206, 207, 255]
const GOLD: Rgba = [227, 176, 92, 255]
const GREEN: Rgba = [125, 150, 114, 255]

describe('measurePhotoColors — 촬영 배경·제품색', () => {
  it('분홍 연출 배경 위 금색 제품: 배경은 가장자리 링 중앙값, 제품은 배경 밖 최대 유채 군집', () => {
    const m = measured(canvas(48, 48, PINK, [{ x: 12, y: 10, w: 24, h: 28, c: GOLD }]))
    expect(m.backgroundTransparent).toBe(false)
    expect(lch(m.background).h).toBeLessThan(40)
    expect(lch(m.background).c).toBeGreaterThan(8)
    expect(Math.abs(lch(m.product).h - lch('#E3B05C').h)).toBeLessThan(3)
    expect(m.productShare).toBeCloseTo((24 * 28) / (48 * 48), 2)
  })

  it('투명 배경(링 알파 0)은 흰 배경으로 보고 알파 있는 픽셀만 잰다', () => {
    const m = measured(canvas(48, 48, [0, 0, 0, 0], [{ x: 10, y: 10, w: 28, h: 28, c: GREEN }]))
    expect(m.backgroundTransparent).toBe(true)
    expect(m.background).toBe('#FFFFFF')
    expect(m.productShare).toBe(1)
    expect(Math.abs(lch(m.product).h - lch('#7D9672').h)).toBeLessThan(3)
  })

  it('반투명 제품에 비친 배경(배경 색상각 25° 안·채도 배경+15 이하)은 더 넓어도 제품색이 아니다 — R1 P02 파우치', () => {
    const seeThrough: Rgba = [220, 169, 163, 255]
    const m = measured(
      canvas(48, 48, PINK, [
        { x: 10, y: 8, w: 28, h: 20, c: seeThrough },
        { x: 10, y: 28, w: 28, h: 10, c: GOLD },
      ])
    )
    expect(m.clusters[0].share).toBeGreaterThan(0.6)
    expect(Math.abs(lch(m.product).h - lch('#E3B05C').h)).toBeLessThan(3)
  })

  it('무채 제품(흰 배경 위 회색)은 제품색 없음(중립 모드), 하지만 측정 자체는 성공', () => {
    const m = measured(canvas(48, 48, [255, 255, 255, 255], [{ x: 12, y: 12, w: 24, h: 24, c: [128, 128, 128, 255] }]))
    expect(m.product).toBeNull()
    expect(m.productChroma).toBe(0)
    expect(m.productLightness).toBeLessThan(60)
  })

  it('배경뿐(제품 픽셀 5% 미만)·너무 작은 사진은 실패(null)', () => {
    expect(measurePhotoColors(canvas(48, 48, PINK, [{ x: 20, y: 20, w: 3, h: 3, c: GOLD }]), 48, 48)).toBeNull()
    expect(measurePhotoColors(canvas(6, 6, PINK, []), 6, 6)).toBeNull()
    expect(measurePhotoColors(new Uint8Array(10), 48, 48)).toBeNull()
  })

  it('결정론 — 같은 픽셀이면 같은 결과', () => {
    const px = canvas(48, 48, PINK, [
      { x: 8, y: 8, w: 16, h: 30, c: GOLD },
      { x: 24, y: 8, w: 16, h: 30, c: GREEN },
    ])
    expect(measurePhotoColors(px, 48, 48)).toEqual(measurePhotoColors(px, 48, 48))
  })
})
