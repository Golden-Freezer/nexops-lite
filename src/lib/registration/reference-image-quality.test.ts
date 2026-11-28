import { describe, expect, it } from 'vitest'
import {
  ACHROMATIC_BRAND_COLOR_MESSAGE,
  LOW_RESOLUTION_MESSAGE,
  REFERENCE_MIN_LONG_SIDE,
  isAchromaticExtreme,
  isLowResolutionImage,
} from './reference-image-quality'

describe('isLowResolutionImage — 긴 변 500px 미만(NEXFIT REFERENCE_MIN_LONG_SIDE)', () => {
  it('긴 변이 500 미만이면 저해상도 — 가로·세로 어느 쪽이 길어도 같다', () => {
    expect(REFERENCE_MIN_LONG_SIDE).toBe(500)
    expect(isLowResolutionImage({ width: 222, height: 148 })).toBe(true)
    expect(isLowResolutionImage({ width: 499, height: 300 })).toBe(true)
    expect(isLowResolutionImage({ width: 300, height: 499 })).toBe(true)
  })

  it('긴 변이 500 이상이면 아니다(경계 500 포함)', () => {
    expect(isLowResolutionImage({ width: 500, height: 10 })).toBe(false)
    expect(isLowResolutionImage({ width: 10, height: 500 })).toBe(false)
    expect(isLowResolutionImage({ width: 1024, height: 1536 })).toBe(false)
  })

  it('크기를 모르면(로드 전·실패·0·NaN) 판정하지 않는다', () => {
    expect(isLowResolutionImage(undefined)).toBe(false)
    expect(isLowResolutionImage(null)).toBe(false)
    expect(isLowResolutionImage({ width: 0, height: 0 })).toBe(false)
    expect(isLowResolutionImage({ width: 200, height: 0 })).toBe(false)
    expect(isLowResolutionImage({ width: Number.NaN, height: 100 })).toBe(false)
  })

  it('안내 문구는 최소·권장 해상도를 알린다', () => {
    expect(LOW_RESOLUTION_MESSAGE).toContain('500px')
    expect(LOW_RESOLUTION_MESSAGE).toContain('800px')
  })
})

describe('isAchromaticExtreme — 검정·흰색 근처 무채색 브랜드 컬러(NEXFIT A-10)', () => {
  it('검정·흰색과 그 근처(채널 차 24 이하, 최댓값 48 이하 또는 최솟값 207 이상)', () => {
    expect(isAchromaticExtreme('#000000')).toBe(true)
    expect(isAchromaticExtreme('#FFFFFF')).toBe(true)
    expect(isAchromaticExtreme('#303030')).toBe(true)
    expect(isAchromaticExtreme('#cfcfcf')).toBe(true)
    expect(isAchromaticExtreme('#1a1a2e')).toBe(true)
    expect(isAchromaticExtreme('#FAFAF0')).toBe(true)
    expect(isAchromaticExtreme('  #ffffff ')).toBe(true)
  })

  it('경계 밖 회색·유채색·크림색은 아니다', () => {
    expect(isAchromaticExtreme('#313131')).toBe(false)
    expect(isAchromaticExtreme('#cecece')).toBe(false)
    expect(isAchromaticExtreme('#808080')).toBe(false)
    expect(isAchromaticExtreme('#22C55E')).toBe(false)
    expect(isAchromaticExtreme('#F0E0D0')).toBe(false)
    expect(isAchromaticExtreme('#0000FF')).toBe(false)
  })

  it('#RRGGBB가 아니면 판정하지 않는다 — 3자리·빈 값은 생성에서 브랜드 컬러로 쓰이지 않는다', () => {
    expect(isAchromaticExtreme('#000')).toBe(false)
    expect(isAchromaticExtreme('000000')).toBe(false)
    expect(isAchromaticExtreme('')).toBe(false)
    expect(isAchromaticExtreme(undefined)).toBe(false)
    expect(isAchromaticExtreme('#GGGGGG')).toBe(false)
  })

  it('안내 문구는 전폭 배경(CTA)을 말한다', () => {
    expect(ACHROMATIC_BRAND_COLOR_MESSAGE).toContain('CTA')
  })
})
