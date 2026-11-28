/**
 * 구도 지문(dHash) — 회색조 지문·거리·같은 페이지 짝 찾기·이월 표지, sharp로 만든 작은 그림의 실제 지문. 생성 호출 없음.
 */

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { SectionImage } from './pdp-state'
import {
  DHASH_TWIN_MAX,
  anglePendingError,
  anglePendingOf,
  dHashDistance,
  dHashFromGray,
  dHashOf,
  findCompositionTwin,
  isCompositionCut,
  isCompositionTarget,
} from './shot-composition'

/** 왼쪽이 밝고 오른쪽으로 어두워지는 64×64 그림(reverse면 반대) */
async function gradientPng(reverse = false): Promise<string> {
  const w = 64
  const raw = Buffer.alloc(w * w * 3)
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const v = Math.round(((reverse ? x : w - 1 - x) / (w - 1)) * 255)
      raw.fill(v, (y * w + x) * 3, (y * w + x) * 3 + 3)
    }
  const png = await sharp(raw, { raw: { width: w, height: w, channels: 3 } }).png().toBuffer()
  return png.toString('base64')
}

/** 비트 n개를 뒤집은 지문 */
const flip = (hex: string, n: number) =>
  hex
    .split('')
    .map((ch, i) => {
      const k = Math.max(0, Math.min(4, n - i * 4))
      return (parseInt(ch, 16) ^ ((1 << k) - 1)).toString(16)
    })
    .join('')

describe('dHash 지문·거리', () => {
  it('행마다 왼쪽이 오른쪽보다 밝으면 1 — 밝기 내림 그림은 모두 1, 오름 그림은 모두 0', () => {
    const down = Uint8Array.from({ length: 72 }, (_, i) => 255 - (i % 9) * 20)
    const up = Uint8Array.from({ length: 72 }, (_, i) => (i % 9) * 20)
    expect(dHashFromGray(down)).toBe('ffffffffffffffff')
    expect(dHashFromGray(up)).toBe('0000000000000000')
    expect(dHashDistance('ffffffffffffffff', '0000000000000000')).toBe(64)
    expect(dHashDistance('00ff00ff00ff00ff', '00ff00ff00ff00ff')).toBe(0)
    expect(dHashDistance('0000000000000000', flip('0000000000000000', 3))).toBe(3)
    expect(dHashDistance('xyz', '0000000000000000')).toBe(64)
  })

  it('sharp로 잰 같은 그림은 거리 0, 좌우가 뒤집힌 그림은 멀다. 그림이 아니면 지문이 없다', async () => {
    const a = await dHashOf(await gradientPng())
    const b = await dHashOf(await gradientPng())
    const c = await dHashOf(await gradientPng(true))
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(dHashDistance(a!, b!)).toBe(0)
    expect(dHashDistance(a!, c!)).toBeGreaterThan(DHASH_TWIN_MAX)
    expect(await dHashOf('AAAA')).toBeNull()
  })
})

describe('findCompositionTwin — 같은 페이지 상품 컷끼리', () => {
  const base = 'f0f0f0f0f0f0f0f0'
  const img = (section: string, dhash?: string, url = `https://x/${section}.png`): SectionImage => ({
    section,
    url,
    ...(dhash ? { dhash } : {}),
  })

  it('상품 컷만 지문을 남기고, 첫 화면은 기준일 뿐 다시 만들지 않는다', () => {
    expect(['hero', 'features:3', 'howto:0', 'long_scene:1'].every(isCompositionCut)).toBe(true)
    expect(['plate:T3c', 'usp_icons:0', 'problem', 'cta'].some(isCompositionCut)).toBe(false)
    expect(isCompositionTarget('hero')).toBe(false)
    expect(isCompositionTarget('features:0')).toBe(true)
  })

  it('문턱 안에서 가장 가까운 컷을 고르고, 문턱 밖·지문 없음·url 없음·효과 컷은 보지 않는다', () => {
    const images = [
      img('hero', flip(base, 8)),
      img('features:0', flip(base, 4)),
      img('features:2', flip(base, 1), ''),
      img('plate:T3c', base),
      img('howto:0'),
    ]
    expect(findCompositionTwin({ section: 'features:1', dhash: base }, images)).toEqual({ of: 'features:0', distance: 4 })
    expect(findCompositionTwin({ section: 'features:1', dhash: base }, [img('hero', flip(base, DHASH_TWIN_MAX))])).toEqual({
      of: 'hero',
      distance: DHASH_TWIN_MAX,
    })
    expect(findCompositionTwin({ section: 'features:1', dhash: base }, [img('hero', flip(base, DHASH_TWIN_MAX + 1))])).toBeNull()
    // 자기 자신·첫 화면 자신·지문 없는 컷은 판정하지 않는다
    expect(findCompositionTwin({ section: 'features:0', dhash: base }, [img('features:0', base)])).toBeNull()
    expect(findCompositionTwin({ section: 'hero', dhash: base }, [img('features:0', base)])).toBeNull()
    expect(findCompositionTwin({ section: 'features:1' }, images)).toBeNull()
  })

  it('이월 표지는 재생성 대기일 때만 읽히고, 다른 대기 사유는 구도 중복이 아니다', () => {
    const error = anglePendingError('features:0')
    expect(anglePendingOf({ pendingRegen: true, error })).toBe('features:0')
    expect(anglePendingOf({ pendingRegen: false, error })).toBeNull()
    expect(anglePendingOf({ pendingRegen: true, error: '게이트 미달 — 재생성 대기: warped' })).toBeNull()
  })
})
