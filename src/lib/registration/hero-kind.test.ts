import { describe, expect, it } from 'vitest'
import { isTextBearingProduct } from '@/lib/agents/registration/prompts/pdp-image-prompts'
import { getPdpTestProduct, PDP_TEST_PRODUCT_IDS } from './__fixtures__/pdp-products'
import { HERO_STUDIO_LEVEL, heroKindAt, heroKindBlock, heroKindOf } from './hero-kind'

const spec = (productName: string, heroImageMode?: 'studio' | 'lifestyle' | 'premium' | 'original') => ({ productName, heroImageMode })

describe('heroKindOf — 11상품', () => {
  it.each([
    ['P01 스티커', '이름 스티커', 'stationery', true, 'studio'],
    ['P02 구디백', '답례 파우치', 'packaging', false, 'studio'],
    ['P03 샴푸 브러시', '실리콘 샴푸 브러시', 'beauty', false, 'in_use'],
    ['P06 반려 브러시', '반려동물 브러시', 'pet', false, 'in_use'],
    ['P08 식물 클립', '식물 지지 클립', 'household', false, 'in_use'],
    ['P09 폰 스트랩', '스마트폰 스트랩', 'digital', false, 'worn'],
    ['P10 무릎 보호대', '무릎 보호대', 'fashion', false, 'worn'],
  ])('%s', (_, name, category, textBearing, kind) => {
    expect(heroKindOf(spec(name), category, textBearing).kind).toBe(kind)
  })

  it('낱말이 없어도 패션은 착용이다', () => {
    expect(heroKindOf(spec('데일리 원피스'), 'fashion', false).kind).toBe('worn')
  })

  it('식품은 스튜디오다', () => {
    expect(heroKindOf(spec('수제 쿠키'), 'food', false).kind).toBe('studio')
  })

  it('인쇄물 판정이 착용 낱말보다 먼저다 — 글자가 보여야 한다', () => {
    expect(heroKindOf(spec('이름 새긴 모자 스티커'), 'stationery', true).kind).toBe('studio')
  })

  it('입력이 있으면 규칙보다 먼저다', () => {
    expect(heroKindOf(spec('무릎 보호대', 'studio'), 'fashion', false)).toMatchObject({ kind: 'studio', reason: '입력 studio' })
    expect(heroKindOf(spec('이름 스티커', 'lifestyle'), 'stationery', true).kind).toBe('in_use')
    expect(heroKindOf(spec('무릎 보호대', 'premium'), 'fashion', false).kind).toBe('studio')
    expect(heroKindOf(spec('무릎 보호대', 'original'), 'fashion', false).kind).toBe('studio')
  })

  it('이유를 남긴다', () => {
    expect(heroKindOf(spec('스마트폰 스트랩'), 'digital', false).reason).toContain('스트랩')
  })
})

describe('heroKindOf — 시험 상품 11개 실제 값', () => {
  it('상품명·카테고리로 고른 유형', () => {
    const kinds = Object.fromEntries(
      PDP_TEST_PRODUCT_IDS.map((id) => {
        const { specSheet, categoryKey } = getPdpTestProduct(id)
        return [id, heroKindOf(specSheet, categoryKey, isTextBearingProduct(categoryKey, specSheet.productName ?? '')).kind]
      })
    )
    expect(kinds).toEqual({
      P01: 'studio',
      P02: 'studio',
      P03: 'in_use',
      P04: 'in_use',
      P05: 'in_use',
      P06: 'in_use',
      P07: 'in_use',
      P08: 'in_use',
      P09: 'worn',
      P10: 'worn',
      P11: 'studio',
    })
  })
})

describe('heroKindBlock — 내려가는 단계', () => {
  it('실사용·착용 블록이 앞 지시를 이기고, 얼굴을 요구하지 않는다', () => {
    for (const kind of ['in_use', 'worn'] as const) {
      const block = heroKindBlock(kind, 0)
      expect(block).toContain('wins over any studio')
      expect(block).toContain('face is not needed')
    }
    expect(heroKindBlock('worn', 0)).toContain('worn or attached')
  })

  it('1단계는 손·손목만이다', () => {
    const block = heroKindBlock('worn', 1)
    expect(block).toContain('one adult hand only')
    expect(block).toContain('no face, no torso')
    expect(block).not.toContain('worn or attached')
  })

  it('스튜디오 단계·스튜디오 유형은 블록이 없다', () => {
    expect(heroKindBlock('worn', HERO_STUDIO_LEVEL)).toBe('')
    expect(heroKindBlock('studio', 0)).toBe('')
  })

  it('끝까지 내려가면 실제 유형은 스튜디오다', () => {
    expect(heroKindAt('worn', 0)).toBe('worn')
    expect(heroKindAt('worn', 1)).toBe('worn')
    expect(heroKindAt('in_use', HERO_STUDIO_LEVEL)).toBe('studio')
  })
})
