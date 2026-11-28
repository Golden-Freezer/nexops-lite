/**
 * 원본 합성 순수 계산(묶음 4) — 흰 배경 키잉, 알파 지표·커버리지·경계 상자, 고르기 규칙(B §4-4 가설)·알파 게이트,
 * isnet 전처리·후처리, 자격 판정 응답 파서·프롬프트(NEXFIT 원문 + 덧붙임).
 */

import { describe, expect, it } from 'vitest'
import { keyWhiteBackground } from './key-white'
import { alphaBBox, alphaCoverage, alphaStats, selectCutout } from './cutout-select'
import { ISNET_SIZE, isnetInputTensor, isnetMask } from './isnet-tensor'
import { CUTOUT_SELECT_RULE } from './composite-types'
import { parseCompositeEligibility } from '@/lib/agents/registration/pdp-composite-eligibility-agent'
import {
  buildCompositeEligibilityPrompt,
  COMPOSITE_ELIGIBILITY_ADDENDUM,
  COMPOSITE_ELIGIBILITY_PROMPT,
} from '@/lib/agents/registration/prompts/pdp-composite-eligibility-prompts'

/** w×h RGB, 바탕색 bg 위에 가운데 정사각(한 변 size) 색 fg */
function squareImage(w: number, h: number, size: number, bg: number[], fg: number[]): Uint8Array {
  const data = new Uint8Array(w * h * 3)
  const x0 = Math.floor((w - size) / 2)
  const y0 = Math.floor((h - size) / 2)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = x >= x0 && x < x0 + size && y >= y0 && y < y0 + size
      data.set(inside ? fg : bg, (y * w + x) * 3)
    }
  }
  return data
}

describe('흰 배경 키잉(keyWhiteBackground)', () => {
  it('흰 바탕은 투명, 가운데 상품은 불투명 — 흰 단색 바탕이라 전제에 맞다', () => {
    const r = keyWhiteBackground(squareImage(40, 40, 20, [255, 255, 255], [200, 30, 30]), 40, 40)
    expect(r.applicable).toBe(true)
    expect(r.background).toEqual([255, 255, 255])
    expect(r.alpha[0]).toBe(0)
    expect(r.alpha[20 * 40 + 20]).toBe(255)
    expect(alphaStats(r.alpha).opaque).toBeCloseTo(0.25, 2)
  })

  it('상품 안쪽 흰 면은 테두리와 이어지지 않아 남는다', () => {
    const data = squareImage(40, 40, 20, [255, 255, 255], [200, 30, 30])
    // 상품 가운데에 흰 구멍(4×4)
    for (let y = 18; y < 22; y++) for (let x = 18; x < 22; x++) data.set([255, 255, 255], (y * 40 + x) * 3)
    const r = keyWhiteBackground(data, 40, 40)
    expect(r.alpha[20 * 40 + 20]).toBe(255)
  })

  it('바탕과 이어진 반투명 가장자리는 알파를 거리 비례로 주고 바탕색을 빼서 색을 되돌린다', () => {
    // 흰 바탕(퍼짐 0 → lo 10·hi 40) 테두리에 밝기 230 픽셀 — 거리 25 → 알파 0.5, 색 255 + (230 − 255)/0.5 = 205
    const data = new Uint8Array(10 * 10 * 3).fill(255)
    data.set([230, 230, 230], (5 * 10 + 0) * 3)
    const r = keyWhiteBackground(data, 10, 10)
    expect(r.alpha[5 * 10]).toBe(128)
    expect(Array.from(r.rgb.subarray(5 * 10 * 3, 5 * 10 * 3 + 3))).toEqual([205, 205, 205])
  })

  it('어두운 바탕은 전제(밝기 ≥ 200)에 맞지 않는다', () => {
    expect(keyWhiteBackground(squareImage(40, 40, 20, [60, 60, 60], [200, 30, 30]), 40, 40).applicable).toBe(false)
  })
})

describe('알파 지표', () => {
  it('B 정의 — 불투명 ≥250·투명 ≤5·반투명 그 사이, NEXFIT 커버리지는 128 이상', () => {
    const alpha = Uint8Array.from([255, 250, 249, 128, 127, 6, 5, 0])
    expect(alphaStats(alpha)).toEqual({ opaque: 2 / 8, clear: 2 / 8, soft: 4 / 8 })
    expect(alphaCoverage(alpha)).toBe(4 / 8)
    expect(alphaCoverage(new Uint8Array(0))).toBe(0)
  })

  it('경계 상자는 알파 128 이상 영역의 0~1 비율, 없으면 null', () => {
    const alpha = new Uint8Array(10 * 10)
    for (let y = 2; y < 5; y++) for (let x = 3; x < 7; x++) alpha[y * 10 + x] = 255
    expect(alphaBBox(alpha, 10, 10)).toEqual({ x: 0.3, y: 0.2, w: 0.4, h: 0.3 })
    expect(alphaBBox(new Uint8Array(100), 10, 10)).toBeNull()
  })
})

describe('고르기 규칙·알파 게이트(selectCutout)', () => {
  const W = 20
  const rgb = squareImage(W, W, 10, [255, 255, 255], [200, 30, 30])
  const key = keyWhiteBackground(rgb, W, W)
  /** 가운데 10×10 불투명, 나머지는 fill 값 */
  const mask = (fill: number) => {
    const a = new Uint8Array(W * W).fill(fill)
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) a[y * W + x] = 255
    return a
  }

  it('isnet 반투명 비율이 문턱 이하면 isnet(원본 RGB)', () => {
    const choice = selectCutout({ rgb, isnetAlpha: mask(0), key })
    expect(choice).toMatchObject({ ok: true, method: 'isnet' })
    if (choice.ok) expect(choice.rgb).toBe(rgb)
    expect(choice.metrics.coverage).toBeCloseTo(0.25)
  })

  it('isnet이 흐리면 키잉이 전제에 맞고 불투명 비율이 2배 이상일 때 키잉', () => {
    const soft = new Uint8Array(W * W).fill(100)
    for (let y = 5; y < 15; y++) for (let x = 5; x < 10; x++) soft[y * W + x] = 255
    const choice = selectCutout({ rgb, isnetAlpha: soft, key })
    expect(choice).toMatchObject({ ok: true, method: 'key' })
    expect(choice.metrics.isnetSoft).toBeGreaterThan(CUTOUT_SELECT_RULE.isnetSoftMax)
  })

  it('둘 다 아니면 생성 경로 — 키잉 전제가 깨졌거나 불투명 비율이 2배에 못 미친다', () => {
    const blurry = new Uint8Array(W * W).fill(100)
    const darkKey = keyWhiteBackground(squareImage(W, W, 10, [60, 60, 60], [200, 30, 30]), W, W)
    expect(selectCutout({ rgb, isnetAlpha: blurry, key: darkKey })).toMatchObject({ ok: false })
    const halfOpaque = mask(100)
    expect(selectCutout({ rgb, isnetAlpha: halfOpaque, key })).toMatchObject({ ok: false })
  })

  it('고른 결과의 커버리지가 5~90% 밖이면 생성 경로', () => {
    expect(selectCutout({ rgb, isnetAlpha: new Uint8Array(W * W).fill(255), key })).toMatchObject({
      ok: false,
      metrics: { coverage: 1 },
    })
    const tiny = new Uint8Array(W * W)
    tiny[0] = 255
    expect(selectCutout({ rgb, isnetAlpha: tiny, key })).toMatchObject({ ok: false })
  })
})

describe('isnet 전처리·후처리', () => {
  it('최댓값으로 나누고 0.5를 빼 CHW로 둔다', () => {
    const size = 2
    const resized = Uint8Array.from([200, 100, 0, 50, 50, 50, 0, 0, 0, 200, 200, 200])
    const t = isnetInputTensor(resized, size)
    expect(t[0]).toBeCloseTo(0.5) // R 첫 픽셀 200/200 − 0.5
    expect(t[4]).toBeCloseTo(0) // G 첫 픽셀 100/200 − 0.5
    expect(t[8]).toBeCloseTo(-0.5) // B 첫 픽셀 0/200 − 0.5
    expect(() => isnetInputTensor(new Uint8Array(3), size)).toThrow()
  })

  it('출력은 min-max로 0~255(반올림)', () => {
    expect(Array.from(isnetMask(Float32Array.from([-1, 0, 1, 0.5]), 2))).toEqual([0, 128, 255, 191])
    expect(() => isnetMask(new Float32Array(3))).toThrow()
    expect(ISNET_SIZE).toBe(1024)
  })
})

describe('자격 판정 응답·프롬프트', () => {
  it('키가 정확히 true일 때만 참으로 읽는다', () => {
    expect(
      parseCompositeEligibility(
        '```json\n{"has_person": true, "flat_print": "true", "supplier_marks": false, "collage": 1, "reason": "a hand"}\n```'
      )
    ).toStrictEqual({ has_person: true, flat_print: false, supplier_marks: false, collage: false, reason: 'a hand' })
    // 참처럼 보이는 다른 값('yes'·1)도 참이 아니다
    expect(
      parseCompositeEligibility('{"has_person": "yes", "flat_print": 1, "supplier_marks": "true", "collage": true}')
    ).toMatchObject({
      has_person: false,
      flat_print: false,
      supplier_marks: false,
      collage: true,
    })
    expect(parseCompositeEligibility('no json here')).toBeNull()
  })

  it('NEXFIT 원문을 그대로 두고 덧붙임으로 공급처 표기·콜라주 키를 더한다', () => {
    const prompt = buildCompositeEligibilityPrompt()
    expect(prompt.startsWith(COMPOSITE_ELIGIBILITY_PROMPT)).toBe(true)
    expect(COMPOSITE_ELIGIBILITY_PROMPT).toContain('Even a single hand holding the product counts as true.')
    expect(prompt).toContain(COMPOSITE_ELIGIBILITY_ADDENDUM)
    expect(COMPOSITE_ELIGIBILITY_ADDENDUM).toContain('"supplier_marks": false, "collage": false')
  })
})
