/**
 * USP 아이콘 후처리(NEXFIT icon_postprocess.py 이식) — 키잉·노이즈 바닥·획 팽창·잉크 가드·원본 유지.
 * 기대값은 NEXFIT 원본(PIL)과 같은 식에서 나온다: 휘도 = (R·19595 + G·38470 + B·7471 + 0x8000) >> 16,
 * 알파 = 파이썬 round(차이 × 255 / 48), 26 미만은 0. 실제 R2 P03 아이콘 4장(1024)은 원본과 픽셀 차이 0을 오프라인으로 확인했다.
 */

import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ICON_INK_HEX, isUspIconSection, toTransparentInk } from './usp-icon-alpha'

type Rgb = [number, number, number]
const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]
const INK: Rgb = [26, 26, 26]

/** 단색 바탕에 painter가 칠한 픽셀만 바꾼 RGB 그림 */
async function canvas(size: number | [number, number], bg: Rgb, paint: (x: number, y: number) => Rgb | null, format: 'png' | 'jpeg' = 'png') {
  const [w, h] = Array.isArray(size) ? size : [size, size]
  const raw = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) raw.set(paint(x, y) ?? bg, (y * w + x) * 3)
  }
  const img = sharp(raw, { raw: { width: w, height: h, channels: 3 } })
  const bytes = format === 'png' ? await img.png().toBuffer() : await img.jpeg({ quality: 95 }).toBuffer()
  return { base64: bytes.toString('base64'), mimeType: format === 'png' ? 'image/png' : 'image/jpeg' }
}

/** 흰 배경 + 검정 사각 테두리 라인아트(모델 산출물 대역) */
function lineArt(size = 256, { bg = WHITE, stroke = BLACK, width = 6, format = 'png' as 'png' | 'jpeg' } = {}) {
  const m = Math.floor(size / 4)
  return canvas(size, bg, (x, y) => {
    const inOuter = x >= m && x <= size - m && y >= m && y <= size - m
    const inInner = x >= m + width && x <= size - m - width && y >= m + width && y <= size - m - width
    return inOuter && !inInner ? stroke : null
  }, format)
}

async function decode(base64: string) {
  const { data, info } = await sharp(Buffer.from(base64, 'base64')).raw().toBuffer({ resolveWithObject: true })
  const at = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x + 1) * info.channels))
  const alphas = Array.from({ length: info.width * info.height }, (_, i) => data[i * info.channels + 3])
  return { info, at, alphas }
}

afterEach(() => vi.restoreAllMocks())

describe('투명화 — 키잉·잉크 단색', () => {
  it('흰 배경 라인아트는 배경이 완전 투명하고 잉크는 고정색 하나인 RGBA PNG가 된다', async () => {
    const out = await toTransparentInk(await lineArt())
    expect(out).toMatchObject({ converted: true, mimeType: 'image/png' })
    const { info, at } = await decode(out.base64)
    expect(info.channels).toBe(4)
    expect(at(0, 0)[3]).toBe(0)
    expect(at(info.width - 1, info.height - 1)[3]).toBe(0)
    const opaque = []
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (at(x, y)[3] > 200) opaque.push(at(x, y).slice(0, 3))
    expect(opaque.length).toBeGreaterThan(0)
    expect(opaque.every((p) => p.join() === INK.join())).toBe(true)
    expect(ICON_INK_HEX).toBe('#1a1a1a')
  })

  it('JPEG 생성물도 PNG(알파)로 바뀌고, 정사각 1024는 512로 맞춘다 — 정사각이 아니면 크기를 두고 키잉만 한다', async () => {
    const square = await toTransparentInk(await lineArt(1024, { width: 24, format: 'jpeg' }))
    expect(square.mimeType).toBe('image/png')
    const sq = await decode(square.base64)
    expect([sq.info.width, sq.info.height, sq.info.channels]).toEqual([512, 512, 4])
    expect(sq.at(0, 0)[3]).toBe(0)

    const wide = await toTransparentInk(await canvas([300, 200], WHITE, (x, y) => (x > 100 && x < 110 && y > 50 && y < 150 ? BLACK : null)))
    const wd = await decode(wide.base64)
    expect([wd.info.width, wd.info.height]).toEqual([300, 200])
  })

  it('배경색은 테두리 중앙값이다 — 크림 바탕도 투명해지고 잉크만 남는다', async () => {
    const out = await toTransparentInk(await lineArt(256, { bg: [241, 236, 226] }))
    const { info, at, alphas } = await decode(out.base64)
    expect(out.converted).toBe(true)
    expect(at(0, 0)[3]).toBe(0)
    expect(at(info.width / 2, info.height / 2)[3]).toBe(0) // 사각 테두리 안쪽 빈 곳도 배경
    expect(alphas.some((a) => a === 255)).toBe(true)
  })

  it('안티에일리어싱된 가장자리는 반투명으로 남는다', async () => {
    const blurred = await sharp(Buffer.from((await lineArt()).base64, 'base64')).blur(2).png().toBuffer()
    const out = await toTransparentInk({ base64: blurred.toString('base64'), mimeType: 'image/png' }, { thickenPx: 0, size: 0 })
    const { alphas } = await decode(out.base64)
    expect(alphas.filter((a) => a > 0 && a < 255).length).toBeGreaterThan(100)
  })
})

describe('NEXFIT 원본과 같은 수치', () => {
  it('휘도 정수식·파이썬 짝수 반올림·노이즈 바닥 26이 원본과 같다', async () => {
    // 차이 8 → 42.5 → 42(Math.round면 43), 차이 4 → 21 → 바닥 아래라 0, 빨강만 30 차이 → 휘도 9 → 48
    const img = await canvas(64, WHITE, (x, y) => {
      if (y < 20 || y >= 44) return null
      if (x >= 10 && x < 20) return [247, 247, 247]
      if (x >= 27 && x < 37) return [251, 251, 251]
      if (x >= 44 && x < 54) return [225, 255, 255]
      return null
    })
    const out = await toTransparentInk(img, { thickenPx: 0, size: 0 })
    const { at } = await decode(out.base64)
    expect(at(15, 30)[3]).toBe(42)
    expect(at(32, 30)[3]).toBe(0)
    expect(at(49, 30)[3]).toBe(48)
    expect(at(0, 0)[3]).toBe(0)
  })

  it('획 팽창은 반경 3의 정사각 최댓값 필터다 — 1px 선이 7px이 된다', async () => {
    const img = await canvas(64, WHITE, (x, y) => (x === 32 && y >= 16 && y < 48 ? BLACK : null))
    const { at } = await decode((await toTransparentInk(img, { size: 0 })).base64)
    for (const x of [29, 32, 35]) expect(at(x, 30)[3]).toBe(255)
    expect(at(28, 30)[3]).toBe(0)
    expect(at(36, 30)[3]).toBe(0)
    expect(at(32, 13)[3]).toBe(255)
    expect(at(32, 12)[3]).toBe(0)

    const thin = await decode((await toTransparentInk(img, { size: 0, thickenPx: 0 })).base64)
    expect(thin.at(31, 30)[3]).toBe(0)
  })
})

describe('원본 유지 — 아이콘이 없는 것보다 배경이 있는 아이콘이 낫다', () => {
  it('잉크가 55%를 넘는 채워진 그림은 변환하지 않고 사유를 남긴다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const filled = await canvas(100, WHITE, (x, y) => (x >= 5 && x < 95 && y >= 5 && y < 95 ? BLACK : null), 'jpeg')
    const out = await toTransparentInk(filled)
    expect(out).toMatchObject({ converted: false, base64: filled.base64, mimeType: 'image/jpeg' })
    expect(out.reason).toContain('잉크 커버리지')
    expect(out.coverage).toBeGreaterThan(0.55)
    expect(warn.mock.calls[0]?.[0]).toContain('원본 유지')
  })

  it('디코딩 실패도 원본 그대로다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await toTransparentInk({ base64: 'aW1n', mimeType: 'image/jpeg' })
    expect(out).toMatchObject({ converted: false, base64: 'aW1n', mimeType: 'image/jpeg' })
    expect(out.reason).toContain('디코딩 실패')
  })

  it('커버리지는 팽창 전에 잰다 — 팽창하면 55%를 넘는 촘촘한 선 그림도 변환한다', async () => {
    // 2칸마다 1px 세로줄: 팽창 전 41%, 팽창 뒤에는 칠한 영역(81%)이 다 덮인다
    const stripes = await canvas(100, WHITE, (x, y) => (x >= 5 && x <= 95 && y >= 5 && y <= 95 && x % 2 === 0 ? BLACK : null))
    const out = await toTransparentInk(stripes, { size: 0 })
    expect(out.converted).toBe(true)
    expect(out.coverage).toBeCloseTo(0.4095, 3)
  })

  it('sharp를 불러오지 못해도 이 모듈을 가져오는 쪽은 깨지지 않고, 아이콘은 원본 그대로다', async () => {
    const img = await lineArt()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.resetModules()
    vi.doMock('sharp', () => {
      throw new Error('Could not load the "sharp" module using the linux-x64 runtime')
    })
    try {
      const mod = await import('./usp-icon-alpha')
      const out = await mod.toTransparentInk(img)
      expect(out).toMatchObject({ converted: false, base64: img.base64, mimeType: 'image/png' })
      expect(out.reason).toContain('sharp 로드 실패')
    } finally {
      vi.doUnmock('sharp')
      vi.resetModules()
    }
  })
})

describe('대상 섹션', () => {
  it('usp_icons 컷만 후처리한다', () => {
    expect(isUspIconSection('usp_icons:0')).toBe(true)
    expect(isUspIconSection('usp_icons:3')).toBe(true)
    for (const s of ['hero', 'features:0', 'how_to:1', 'rating_bg', 'designcut:hook']) expect(isUspIconSection(s)).toBe(false)
  })
})
