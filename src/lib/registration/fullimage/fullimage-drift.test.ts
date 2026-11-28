/**
 * 통이미지 드리프트 — 글자 상자 밖에서만 두 이미지를 비교한다(안 A: 통이미지↔지운 바탕, 안 B: G↔글자 얹은 통이미지).
 * sharp로 만든 작은 PNG로 결정론 확인.
 */

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { DRIFT_THRESHOLD, computeDrift, inPaddedBox, maskedMeanAbsDiff } from './fullimage-drift'
import type { TextBox } from './fullimage-types'

const W = 120
const H = 160

/** 회색 바탕에 사각형을 칠한 PNG — 사각형은 이미지 비율 좌표 */
async function png(rects: Array<{ box: TextBox; v: number }>, bg = 128, width = W, height = H): Promise<Buffer> {
  const px = Buffer.alloc(width * height * 3, bg)
  for (const { box, v } of rects) {
    for (let y = Math.floor(box.y * height); y < Math.ceil((box.y + box.h) * height); y++) {
      for (let x = Math.floor(box.x * width); x < Math.ceil((box.x + box.w) * width); x++) px.fill(v, (y * width + x) * 3, (y * width + x) * 3 + 3)
    }
  }
  return sharp(px, { raw: { width, height, channels: 3 } }).png().toBuffer()
}

const TEXT: TextBox = { x: 0.2, y: 0.1, w: 0.6, h: 0.15 }
const PRODUCT: TextBox = { x: 0.3, y: 0.5, w: 0.4, h: 0.35 }

describe('maskedMeanAbsDiff — 순수 계산', () => {
  it('상자(여유 8% 포함) 안 화소는 빼고 나머지 평균 절대차', () => {
    const a = new Uint8Array([0, 0, 0, 0])
    const b = new Uint8Array([10, 10, 10, 10])
    expect(maskedMeanAbsDiff(a, b, 2, 2, [])).toEqual({ mad: 10, coverage: 1, aspectMismatch: false })
    expect(maskedMeanAbsDiff(a, b, 2, 2, [{ x: 0, y: 0, w: 1, h: 1 }])).toEqual({ mad: null, coverage: 0, aspectMismatch: false })
    expect(inPaddedBox(0.15, 0.1, [TEXT])).toBe(true)
    expect(inPaddedBox(0.05, 0.1, [TEXT])).toBe(false)
  })
})

describe('computeDrift — 두 이미지', () => {
  it('글자 상자 안만 바뀌면(지운 자리) 드리프트 0, 제품 자리가 바뀌면 문턱을 넘는다', async () => {
    const full = await png([{ box: TEXT, v: 20 }, { box: PRODUCT, v: 230 }])
    const erased = await png([{ box: PRODUCT, v: 230 }])
    const moved = await png([{ box: { ...PRODUCT, x: 0.05 }, v: 230 }])
    const ok = await computeDrift(full, erased, [TEXT])
    expect(ok.mad).toBe(0)
    expect(ok.coverage).toBeGreaterThan(0.5)
    const bad = await computeDrift(full, moved, [TEXT])
    expect(bad.mad!).toBeGreaterThan(DRIFT_THRESHOLD)
  })

  it('비율이 3% 넘게 다르면 같은 구도로 보지 않는다(mad null)', async () => {
    const a = await png([])
    const b = await png([], 128, W, 120)
    expect(await computeDrift(a, b, [])).toEqual({ mad: null, coverage: 0, aspectMismatch: true })
  })
})
