import { describe, expect, it } from 'vitest'

import { getPdpTestProduct, PDP_CATEGORY_KEYS, PDP_TEST_PRODUCT_IDS } from '../__fixtures__/pdp-products'
import { heroKindOf } from '../hero-kind'
import { FAMILY_HERO_KIND, FAMILY_NAME_RULES, judgeProductFamily, lineHeroKindOf, PRODUCT_FAMILIES } from './product-family'

/** 분석 A6 표 1의 시험 상품 제품군 */
const TABLE_1: Record<string, string> = {
  P01: 'sticker_deco',
  P02: 'gift_wrap',
  P03: 'beauty_tool',
  P04: 'beauty_tool',
  P05: 'beauty_tool',
  P06: 'pet_goods',
  P07: 'pet_goods',
  P08: 'garden_diy',
  P09: 'phone_accessory',
  P10: 'sports_support',
  P11: 'sticker_deco',
}

describe('제품군 판정', () => {
  it('시험 상품 11개가 표 1과 일치한다(픽스처에 값을 넣지 않고 판정만으로)', () => {
    const judged = Object.fromEntries(
      PDP_TEST_PRODUCT_IDS.map((id) => {
        const product = getPdpTestProduct(id)
        expect(product.specSheet.productFamily).toBeUndefined()
        return [id, judgeProductFamily(product.categoryKey, product.specSheet)]
      })
    )
    expect(judged).toEqual(TABLE_1)
  })

  it('입력값 → 세부 카테고리 → 상품명 순서다', () => {
    const spec = { productName: '주방 선반', categoryDetail: 'garden' }
    expect(judgeProductFamily('household', { ...spec, productFamily: ' home_decor ' })).toBe('home_decor')
    expect(judgeProductFamily('household', spec)).toBe('garden_diy')
    expect(judgeProductFamily('household', { productName: '주방 선반' })).toBe('kitchen_storage')
  })

  it('다른 카테고리의 값은 낼 수 없다', () => {
    expect(judgeProductFamily('pet', { productFamily: 'fresh' })).toBeUndefined()
    expect(judgeProductFamily('pet', { productFamily: 'fresh', productName: '고양이 사료' })).toBe('pet_food')
    expect(judgeProductFamily('beauty', { categoryDetail: 'garden' })).toBeUndefined()
    expect(judgeProductFamily('stationery', { productName: '강아지 밥그릇' })).toBeUndefined()
  })

  it('맞는 낱말이 없거나 카테고리·이름이 없으면 비운다', () => {
    expect(judgeProductFamily('pet', { productName: '페어넥스 신상품' })).toBeUndefined()
    expect(judgeProductFamily('pet', {})).toBeUndefined()
    expect(judgeProductFamily('', { productName: '강아지 밥그릇' })).toBeUndefined()
    expect(judgeProductFamily('없는키', { productName: '강아지 밥그릇' })).toBeUndefined()
    expect(judgeProductFamily('stationery', { productName: '노트북 받침' })).toBeUndefined()
  })

  it.each([
    ['beauty', '두피 샴푸 브러쉬', 'beauty_tool'],
    ['beauty', '수분 크림', 'cosmetic'],
    ['pet', '강아지 사료 그릇', 'pet_goods'],
    ['pet', '고양이 습식 간식', 'pet_food'],
    ['fashion', '무릎 보호대 압박 밴드', 'sports_support'],
    ['fashion', '모자 달린 후드 티셔츠', 'apparel'],
    ['fashion', '가죽 벨트', 'accessory'],
    ['digital', '이어폰 케이스', 'phone_accessory'],
    ['digital', '무선 이어폰', 'device'],
    ['household', '식물성 세제', 'daily_care'],
    ['household', '구스 이불', 'bedding_fabric'],
    ['household', '무드등', 'home_decor'],
    ['stationery', '노트북 스티커', 'sticker_deco'],
    ['stationery', '데일리 플래너', 'paper_planner'],
    ['packaging', '선물 박스', 'gift_wrap'],
    ['packaging', '택배 박스', 'shipping_bulk'],
    ['food', '명절 선물 세트', 'gift_set'],
    ['food', '유산균', 'health_food'],
    ['food', '사과 주스', 'processed'],
    ['food', '제철 사과', 'fresh'],
  ])('%s %s → %s(좁은 쪽이 먼저)', (key, productName, family) => {
    expect(judgeProductFamily(key, { productName })).toBe(family)
  })

  it('낱말 규칙은 8개 키를 덮고 모든 값이 그 키의 값이다', () => {
    expect(Object.keys(FAMILY_NAME_RULES).sort()).toEqual([...PDP_CATEGORY_KEYS].sort())
    for (const key of PDP_CATEGORY_KEYS) {
      expect(FAMILY_NAME_RULES[key].map(([family]) => family).sort()).toEqual([...PRODUCT_FAMILIES[key]].sort())
    }
  })
})

describe('K 첫 화면 유형(lineHeroKindOf, 적용 K6 T1-80 ②)', () => {
  it('제품군 줄은 화장품 → 스튜디오 하나이고, 값은 있는 제품군이다', () => {
    expect(FAMILY_HERO_KIND).toEqual({ cosmetic: 'studio' })
    expect(PRODUCT_FAMILIES.beauty).toContain('cosmetic')
  })

  it('화장품은 K에서 스튜디오다 — D 규칙(heroKindOf)은 실사용 그대로다', () => {
    const spec = { productName: '수분 크림' }
    expect(heroKindOf(spec, 'beauty', false).kind).toBe('in_use')
    expect(lineHeroKindOf(spec, 'beauty', false)).toEqual({ kind: 'studio', reason: '제품군 cosmetic' })
    // 입력 제품군 값도 같은 판정을 지난다
    expect(lineHeroKindOf({ productName: '페어넥스 신상품', productFamily: 'cosmetic' }, 'beauty', false).kind).toBe('studio')
    // 착용 낱말(마스크)이 있어도 화장품이면 스튜디오다
    expect(heroKindOf({ productName: '수분 마스크팩' }, 'beauty', false).kind).toBe('worn')
    expect(lineHeroKindOf({ productName: '수분 마스크팩' }, 'beauty', false).kind).toBe('studio')
  })

  it('입력 첫 화면 값과 인쇄물이 제품군 줄보다 먼저다', () => {
    expect(lineHeroKindOf({ productName: '수분 크림', heroImageMode: 'lifestyle' }, 'beauty', false)).toEqual({ kind: 'in_use', reason: '입력 lifestyle' })
    expect(lineHeroKindOf({ productName: '수분 크림' }, 'beauty', true)).toEqual(heroKindOf({ productName: '수분 크림' }, 'beauty', true))
    expect(lineHeroKindOf({ productName: '수분 크림' }, 'beauty', true).reason).toContain('인쇄물')
  })

  it('화장품이 아닌 제품군과 제품군 없음은 heroKindOf 그대로다 — 시험 상품 11개 전부(효과 0)', () => {
    for (const id of PDP_TEST_PRODUCT_IDS) {
      const { categoryKey, specSheet } = getPdpTestProduct(id)
      for (const textBearing of [false, true]) expect(lineHeroKindOf(specSheet, categoryKey, textBearing), id).toEqual(heroKindOf(specSheet, categoryKey, textBearing))
    }
    for (const [key, productName] of [
      ['beauty', '두피 샴푸 브러쉬'],
      ['fashion', '무릎 보호대 압박 밴드'],
      ['fashion', '모자 달린 후드 티셔츠'],
      ['household', '무드등'],
      ['food', '제철 사과'],
      ['household', '페어넥스 신상품'],
    ]) {
      expect(lineHeroKindOf({ productName }, key, false), productName).toEqual(heroKindOf({ productName }, key, false))
    }
  })
})
