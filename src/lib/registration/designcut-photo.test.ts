/**
 * 원천 사진 색 측정(서버) — R1 P02·P03·P07 오너 원천 사진의 64px 축소본으로 실제 디코딩 경로를 고정한다(네트워크·유료 0).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { measureDesigncutPhoto } from './designcut-photo'
import { rgbToLch } from './internalized/designcut-palette'
import type { DesigncutPhoto } from './pdp-state'

const FIXTURES = join(__dirname, 'internalized/__fixtures__/designcut-v2')
const photo = (name: string) => ({
  data: readFileSync(join(FIXTURES, `${name}-source-64.png`)).toString('base64'),
  mediaType: 'image/png' as const,
})
const lch = (hex: string | null) => {
  const n = parseInt(hex!.slice(1), 16)
  return rgbToLch([(n >> 16) & 255, (n >> 8) & 255, n & 255])
}

describe('measureDesigncutPhoto — 오너 원천 사진(R1)', () => {
  it('P02 반투명 데이지 파우치: 배경 분홍, 제품색 금색 끈·내용물(비친 분홍 군집이 아니다), 하이키', async () => {
    const m = (await measureDesigncutPhoto(photo('p02'))) as DesigncutPhoto
    expect(lch(m.background).h).toBeLessThan(40)
    expect(lch(m.background).c).toBeGreaterThan(8)
    expect(lch(m.product).h).toBeGreaterThan(60)
    expect(lch(m.product).h).toBeLessThan(100)
    expect(m.productLightness).toBeGreaterThanOrEqual(70)
  })

  it('P03 세이지 두피 브러시: 흰·회 배경, 제품색은 저채도 녹색(C* 10 안팎)', async () => {
    const m = (await measureDesigncutPhoto(photo('p03'))) as DesigncutPhoto
    expect(lch(m.background).c).toBeLessThan(8)
    expect(lch(m.product).h).toBeGreaterThan(130)
    expect(lch(m.product).h).toBeLessThan(180)
    expect(m.productChroma).toBeLessThan(30)
  })

  it('P07 녹색 식기대: 흰 배경, 제품색 녹색', async () => {
    const m = (await measureDesigncutPhoto(photo('p07'))) as DesigncutPhoto
    expect(m.background).toBe('#FFFFFF')
    expect(lch(m.product).h).toBeGreaterThan(110)
    expect(lch(m.product).h).toBeLessThan(160)
  })

  it('사진 없음·디코딩 실패는 사유만 기록한다(계획은 카피 팔레트로 폴백)', async () => {
    expect(await measureDesigncutPhoto(undefined)).toEqual({ version: 1, failed: 'no_source_photo' })
    expect(
      await measureDesigncutPhoto({ data: Buffer.from('not an image').toString('base64'), mediaType: 'image/png' })
    ).toEqual({
      version: 1,
      failed: 'decode_failed',
    })
  })
})

describe('measureDesigncutPhoto — sharp를 불러오지 못하면', () => {
  afterEach(() => {
    vi.doUnmock('sharp')
    vi.resetModules()
  })

  it('측정을 건너뛰고 사유만 기록한다(모듈 로드는 성공 — run 라우트가 죽지 않는다)', async () => {
    vi.resetModules()
    vi.doMock('sharp', () => {
      throw new Error('Cannot find module')
    })
    const fresh = await import('./designcut-photo')
    expect(await fresh.measureDesigncutPhoto(photo('p02'))).toEqual({ version: 1, failed: 'sharp_unavailable' })
  })
})
