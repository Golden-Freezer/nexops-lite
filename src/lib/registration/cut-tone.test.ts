/**
 * 컷 밝기·채도 기록(결정 카드 c29) — 화소 평균·sharp 측정·페이지 편차(중앙값과의 차)·문턱 경고(기록만).
 */

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  hasImageSignature,
  measureCutTone,
  pageToneSpread,
  TONE_OUTLIER,
  toneFromPixels,
  toneSpreadLedger,
  toneWarningOf,
  type ToneCut,
} from './cut-tone'

const solidPng = async (r: number, g: number, b: number, alpha = 1) =>
  (await sharp({ create: { width: 200, height: 120, channels: 4, background: { r, g, b, alpha } } }).png().toBuffer()).toString('base64')

describe('toneFromPixels — 휘도(Rec.709)·HSV 채도 평균', () => {
  it('흰색 1·0, 검정 0·0, 빨강 0.213·1, 회색은 채도 0', () => {
    expect(toneFromPixels(Uint8Array.from([255, 255, 255]), 3)).toEqual({ brightness: 1, saturation: 0 })
    expect(toneFromPixels(Uint8Array.from([0, 0, 0]), 3)).toEqual({ brightness: 0, saturation: 0 })
    expect(toneFromPixels(Uint8Array.from([255, 0, 0]), 3)).toEqual({ brightness: 0.213, saturation: 1 })
    expect(toneFromPixels(Uint8Array.from([128, 128, 128]), 3)!.saturation).toBe(0)
  })

  it('화소 평균 — 흰색 반·검정 반이면 밝기 0.5, 4채널(RGBA)도 앞 세 채널만', () => {
    expect(toneFromPixels(Uint8Array.from([255, 255, 255, 0, 0, 0]), 3)).toEqual({ brightness: 0.5, saturation: 0 })
    expect(toneFromPixels(Uint8Array.from([255, 0, 0, 7, 255, 0, 0, 7]), 4)).toEqual({ brightness: 0.213, saturation: 1 })
  })

  it('화소가 없거나 채널이 3 아래면 null', () => {
    expect(toneFromPixels(new Uint8Array(0), 3)).toBeNull()
    expect(toneFromPixels(Uint8Array.from([10, 20]), 2)).toBeNull()
  })
})

describe('measureCutTone — sharp로 줄여 잰다($0)', () => {
  it('단색 이미지는 그 색의 값, 투명은 흰 바탕으로', async () => {
    expect(await measureCutTone(await solidPng(255, 255, 255))).toEqual({ brightness: 1, saturation: 0 })
    expect(await measureCutTone(await solidPng(0, 0, 255))).toEqual({ brightness: 0.072, saturation: 1 })
    expect(await measureCutTone(await solidPng(0, 0, 0, 0))).toEqual({ brightness: 1, saturation: 0 })
  })

  it('이미지가 아니면 null — 기록 없이 지나간다', async () => {
    expect(await measureCutTone(Buffer.from('not an image').toString('base64'))).toBeNull()
    // 머리는 PNG인데 깨진 파일도 null
    expect(await measureCutTone(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40)]).toString('base64'))).toBeNull()
  })

  it('hasImageSignature — PNG·JPEG·WebP·GIF 머리만, 시험의 가짜 바이트(AA·img)는 아니다', async () => {
    expect(hasImageSignature(await solidPng(1, 2, 3))).toBe(true)
    const jpeg = (await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).jpeg().toBuffer()).toString('base64')
    const webp = (await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).webp().toBuffer()).toString('base64')
    const gif = (await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).gif().toBuffer()).toString('base64')
    for (const b of [jpeg, webp, gif]) expect(hasImageSignature(b)).toBe(true)
    for (const fake of ['AA', 'aW1n', 'AAAA', '']) expect(hasImageSignature(fake), fake).toBe(false)
  })
})

describe('pageToneSpread — 페이지 중앙값과의 차, 문턱을 넘은 컷은 경고만', () => {
  const cut = (section: string, brightness: number, saturation: number): ToneCut => ({ section, tone: { brightness, saturation } })
  const page = [
    cut('hero', 0.72, 0.2),
    cut('k1_photo_0', 0.7, 0.18),
    cut('k2_photo_0', 0.74, 0.22),
    cut('k3_dark_0', 0.3, 0.05), // 어두운 배경 — 밝기 −0.42
    cut('k4_blue_0', 0.5, 0.8), // 진한 단색 배경 — 채도 +0.6
    { section: 'k5_icon_0' }, // tone 없는 컷은 세지 않는다
  ]

  it('tone 컷만 세고 중앙값·최대 차·넘은 컷을 낸다', () => {
    const spread = pageToneSpread(page)!
    expect(spread.cuts).toBe(5)
    expect(spread.median).toEqual({ brightness: 0.7, saturation: 0.2 })
    expect(spread.maxDelta).toEqual({ brightness: 0.4, saturation: 0.6 })
    expect(spread.outliers.map((o) => o.section)).toEqual(['k3_dark_0', 'k4_blue_0'])
    expect(spread.outliers[0]).toEqual({ section: 'k3_dark_0', brightness: 0.3, saturation: 0.05, dBrightness: -0.4, dSaturation: -0.15 })
  })

  it('문턱(실측 밝기 0.25·채도 0.3) 바로 아래는 걸리지 않는다 — 제품 색 탓 클로즈업(밝기 −0.21)', () => {
    expect(TONE_OUTLIER).toEqual({ brightness: 0.25, saturation: 0.3 })
    const close = [cut('a', 0.7, 0.2), cut('b', 0.72, 0.21), cut('c', 0.49, 0.45)]
    expect(pageToneSpread(close)!.outliers).toEqual([])
    expect(pageToneSpread(close, { brightness: 0.2, saturation: 0.2 })!.outliers.map((o) => o.section)).toEqual(['c'])
  })

  it('tone 컷이 2장 아래면 null(비교할 짝 없음)', () => {
    expect(pageToneSpread([cut('hero', 0.7, 0.2), { section: 'x' }])).toBeNull()
    expect(pageToneSpread([])).toBeNull()
  })

  it('원장 칸과 경고 한 줄 — 넘은 컷이 없으면 경고 없음', () => {
    const ledger = toneSpreadLedger(page)!
    expect(ledger).toEqual({
      cuts: 5,
      median: { brightness: 0.7, saturation: 0.2 },
      maxDelta: { brightness: 0.4, saturation: 0.6 },
      outliers: 2,
      outlierSections: ['k3_dark_0', 'k4_blue_0'],
    })
    expect(toneWarningOf(ledger)).toContain('톤 경고 2컷(k3_dark_0·k4_blue_0)')
    expect(toneWarningOf(toneSpreadLedger(page.slice(0, 3)))).toBeNull()
    expect(toneWarningOf(null)).toBeNull()
  })
})
