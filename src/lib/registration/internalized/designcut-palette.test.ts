/**
 * 디자인 컷 색면 토큰(D1) — 08_DESIGN_CUTS.md §4.1·§4.2, 확정 사항 2(카피 확정 팔레트에서 파생).
 */

import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from '../editor/utils/mobileReadability'
import { deriveDesigncutPalette, isHighKeyPhoto, lchToHex, rgbToLch } from './designcut-palette'
import type { DesigncutPhoto } from '../pdp-state'

const WHITE: [number, number, number] = [255, 255, 255]
const onWhite = (hex: string) => contrastRatio(parseColor(hex)!, WHITE)
const hueOf = (hex: string) => rgbToLch(parseColor(hex)!).h
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

describe('deriveDesigncutPalette — 대비·색상각', () => {
  it.each(['#d63384', '#c2410c', '#2563eb', '#16a34a', '#7c3aed'])(
    '%s: 대비 기준(그래픽 3:1·글자 4.5:1)을 넘고 색상각을 지킨다',
    (primary) => {
      const p = deriveDesigncutPalette(primary, 'household')
      expect(p.mode).toBe('color')
      expect(onWhite(p.accent)).toBeGreaterThanOrEqual(3)
      expect(onWhite(p.accentText)).toBeGreaterThanOrEqual(4.5)
      expect(onWhite(p.deep)).toBeGreaterThanOrEqual(4.5) // 짙은 면 위 흰 글자
      expect(onWhite(p.ink)).toBeGreaterThanOrEqual(4.5)
      expect(onWhite(p.tint)).toBeLessThan(1.25) // 파스텔 면
      for (const token of [p.accent, p.accentText, p.deep])
        expect(hueGap(hueOf(token), hueOf(primary))).toBeLessThan(12)
    }
  )

  it('채도가 낮은 제품색(흰·회·검정)은 중립 모드 — 카테고리 앵커 색상각(결정론)', () => {
    const p = deriveDesigncutPalette('#777777', 'household')
    expect(p.mode).toBe('neutral')
    expect(hueGap(hueOf(p.accent), 200)).toBeLessThan(15)
    expect(deriveDesigncutPalette('#777777', 'household')).toEqual(p)
    expect(deriveDesigncutPalette(undefined, 'digital').mode).toBe('neutral')
  })

  it('노랑 제품색도 강조 글자를 L* 보정으로 4.5:1까지 내린다(올리브 계열, 색상각 유지)', () => {
    const p = deriveDesigncutPalette('#facc15', 'household')
    expect(p.mode).toBe('color')
    expect(onWhite(p.accentText)).toBeGreaterThanOrEqual(4.5)
    expect(hueGap(hueOf(p.accentText), hueOf('#facc15'))).toBeLessThan(15)
    expect(onWhite(p.accent)).toBeGreaterThanOrEqual(3)
  })
})

/** 원천 사진 측정값(photo-palette.ts) — R1 P02·P07 64px 실측과 같은 값 */
const photo = (patch: Partial<DesigncutPhoto>): DesigncutPhoto => ({
  version: 1,
  background: '#F7CECF',
  backgroundTransparent: false,
  product: '#E3B05C',
  productShare: 0.46,
  productLightness: 73.7,
  productChroma: 50.4,
  clusters: [],
  ...patch,
})
const chromaOf = (hex: string) => rgbToLch(parseColor(hex)!).c
const lightnessOf = (hex: string) => rgbToLch(parseColor(hex)!).l

describe('deriveDesigncutPalette — 원천 사진 측정(08 §4.1 원안, 2026-10-28 개정)', () => {
  it('P02: 강조는 제품색(금색) 색상각, 파스텔 면은 촬영 배경(분홍) 색상각 — 카피 primary(#c2410c)는 쓰지 않는다', () => {
    const p = deriveDesigncutPalette('#c2410c', 'packaging', photo({}))
    expect(p).toMatchObject({ mode: 'color', source: 'photo', highKey: true, photoBackground: '#F7CECF' })
    expect(hueGap(hueOf(p.accent), hueOf('#E3B05C'))).toBeLessThan(12)
    expect(hueGap(hueOf(p.tint), hueOf('#F7CECF'))).toBeLessThan(12)
    expect(hueGap(hueOf(p.accent), hueOf('#c2410c'))).toBeGreaterThan(25)
    expect(onWhite(p.accent)).toBeGreaterThanOrEqual(3)
    expect(onWhite(p.accentText)).toBeGreaterThanOrEqual(4.5)
    expect(onWhite(p.deep)).toBeGreaterThanOrEqual(4.5)
  })

  it('하이키(밝거나 저채도 상품): deep이 L* 40 안팎으로 밝아지고 강조 채도 하한이 25로 내려간다', () => {
    const sage = photo({ background: '#E1E6DE', product: '#74897D', productLightness: 53.5, productChroma: 10.3 })
    expect(isHighKeyPhoto(sage)).toBe(true)
    const p = deriveDesigncutPalette(undefined, 'beauty', sage)
    expect(lightnessOf(p.deep)).toBeGreaterThan(33)
    expect(onWhite(p.deep)).toBeGreaterThanOrEqual(4.5)
    expect(chromaOf(p.accent)).toBeLessThan(40)
    // 무채 배경(C* < 8)이면 파스텔 면은 제품 색상각
    expect(hueGap(hueOf(p.tint), hueOf('#74897D'))).toBeLessThan(15)
  })

  it('하이키 아님(어둡고 선명한 상품): 기존 deep L* 27·강조 채도 하한 45 그대로', () => {
    const vivid = photo({ background: '#FFFFFF', product: '#1D4ED8', productLightness: 40, productChroma: 70 })
    expect(isHighKeyPhoto(vivid)).toBe(false)
    const p = deriveDesigncutPalette(undefined, 'digital', vivid)
    expect(p.highKey).toBe(false)
    expect(lightnessOf(p.deep)).toBeLessThan(30)
  })

  it('제품색 없음(흰·회·검정 상품) → 중립 모드(카테고리 앵커), 밝은 상품만 하이키', () => {
    const grey = photo({ background: '#FFFFFF', product: null, productLightness: 45, productChroma: 0 })
    expect(isHighKeyPhoto(grey)).toBe(false)
    expect(deriveDesigncutPalette('#c2410c', 'digital', grey)).toMatchObject({ mode: 'neutral', source: 'photo' })
    expect(isHighKeyPhoto({ ...grey, productLightness: 85 })).toBe(true)
  })

  it('측정이 없으면(null) 카피 primary 파생 그대로 — 기존 기록과 같은 값', () => {
    expect(deriveDesigncutPalette('#c2410c', 'packaging', null)).toEqual(deriveDesigncutPalette('#c2410c', 'packaging'))
    expect(deriveDesigncutPalette('#c2410c', 'packaging').source).toBeUndefined()
  })
})

describe('deriveDesigncutPalette — 옅은 제품 덩어리(적용 D5 P2 ②, T1-95)', () => {
  /** R17-L P03 세이지 그린 브러시처럼 측정 제품색이 없는(채도 10 미만) 사진 — 흰 배경 */
  const pale = (clusters: DesigncutPhoto['clusters'], background = '#FFFFFF') =>
    photo({ background, product: null, productLightness: 62, productChroma: 0, clusters })
  const grey = (share: number) => ({ color: lchToHex({ l: 88, c: 1.5, h: 90 }), share })
  const sage = (share: number, c = 6, h = 163) => ({ color: lchToHex({ l: 54, c, h }), share })

  it('채도 4~10·몫 0.12 이상인 가장 넓은 덩어리의 색상각으로 색 모드 — 카테고리 앵커(beauty 코랄)가 아니다', () => {
    const p = deriveDesigncutPalette('#DE7160', 'beauty', pale([grey(0.5), sage(0.42)]))
    expect(p.mode).toBe('color')
    expect(hueGap(hueOf(p.accent), 163)).toBeLessThan(12)
    // 저채도 유채 제품이라 하이키 — 강조 채도 하한 25(진한 비취색이 아니라 세이지 계열), 계획 짙은 바탕 상한도 같은 판정
    expect(isHighKeyPhoto(pale([grey(0.5), sage(0.42)]))).toBe(true)
    expect(p.highKey).toBe(true)
    expect(chromaOf(p.accent)).toBeLessThan(32)
    expect(hueGap(hueOf(p.accent), 35)).toBeGreaterThan(60)
    expect(onWhite(p.accent)).toBeGreaterThanOrEqual(3)
    expect(onWhite(p.accentText)).toBeGreaterThanOrEqual(4.5)
    expect(onWhite(p.deep)).toBeGreaterThanOrEqual(4.5)
    // 후보가 둘이면 더 넓은 것(순서와 상관없이)
    const wider = deriveDesigncutPalette(undefined, 'beauty', pale([sage(0.15, 7, 250), sage(0.3, 7, 100)]))
    expect(hueGap(hueOf(wider.accent), 100)).toBeLessThan(12)
  })

  it('무채 상품(모든 덩어리 채도 4 미만)은 색상각이 생기지 않는다 — 덩어리 기록이 없을 때와 같은 중립 팔레트', () => {
    const none = deriveDesigncutPalette(undefined, 'household', pale([]))
    const achromatic = pale([grey(0.6), { color: lchToHex({ l: 30, c: 3.5, h: 250 }), share: 0.3 }])
    expect(deriveDesigncutPalette(undefined, 'household', achromatic)).toEqual(none)
    expect(none.mode).toBe('neutral')
    expect(isHighKeyPhoto(achromatic)).toBe(false)
  })

  it('몫 0.12 미만·채도 10 넘는 덩어리·유채색 배경 비침(색상각 25° 안)은 빼서 지금처럼 중립', () => {
    const none = deriveDesigncutPalette(undefined, 'household', pale([]))
    expect(deriveDesigncutPalette(undefined, 'household', pale([grey(0.8), sage(0.11)]))).toEqual(none)
    expect(deriveDesigncutPalette(undefined, 'household', pale([sage(0.4, 12)]))).toEqual(none)
    const pink = '#F7CECF'
    const bgHue = hueOf(pink)
    const tinted = (clusters: DesigncutPhoto['clusters']) => deriveDesigncutPalette(undefined, 'household', pale(clusters, pink))
    expect(tinted([sage(0.4, 6, bgHue + 20)])).toEqual(tinted([]))
    // 배경과 색상각이 먼 옅은 덩어리는 쓴다
    expect(hueGap(hueOf(tinted([sage(0.4, 6, bgHue + 140)]).accent), bgHue + 140)).toBeLessThan(12)
  })

  it('측정 제품색이 있으면 덩어리는 보지 않는다 — 색상각·하이키 판정 모두 지금 값 그대로', () => {
    const sageProduct = photo({ background: '#FFFFFF', product: '#829A78', productLightness: 60, productChroma: 20.9 })
    expect(deriveDesigncutPalette(undefined, 'beauty', { ...sageProduct, clusters: [sage(0.5, 6, 300)] })).toEqual(
      deriveDesigncutPalette(undefined, 'beauty', sageProduct)
    )
    // 선명한 제품(하이키 아님)에 옅은 덩어리가 섞여도 하이키가 되지 않는다
    const vivid = photo({ background: '#FFFFFF', product: '#1D4ED8', productLightness: 40, productChroma: 70, clusters: [sage(0.3, 6, 120)] })
    expect(isHighKeyPhoto(vivid)).toBe(false)
    expect(deriveDesigncutPalette(undefined, 'digital', vivid)).toEqual(deriveDesigncutPalette(undefined, 'digital', { ...vivid, clusters: [] }))
  })
})
