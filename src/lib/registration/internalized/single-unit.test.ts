/**
 * D 추가 컷 '한 개만'(적용 D5 P2 ①) — 단품 판정과 문장. 구성 칸이 이기고, 구성이 2 이상이면 옵션을 보지 않으며, 구성 칸이 없으면 옵션 수량의
 * 가장 작은 값이 낱개 하나일 때만 단품이다.
 */

import { describe, expect, it } from 'vitest'
import type { PdpSpecSheet } from '../pdp-state'
import { singleUnitSentence } from './single-unit'

const spec = (over: Partial<PdpSpecSheet>): PdpSpecSheet => ({ productName: '무릎 보호대', ...over }) as PdpSpecSheet
const set = (value: string) => [{ key: '구성', value }]
const quantitySpec = (values: string[]) => ({
  source: 'manual' as const,
  axes: [{ kind: 'quantity' as const, name: '수량', values }],
  variants: values.map((v) => ({ label: v, values: { quantity: v } })),
})

describe('singleUnitSentence — 단품 판정', () => {
  it('구성 칸이 1개·1매·1장·1입이면 piece, 1세트면 set', () => {
    for (const value of ['1개', '1매', '1장', '1입', '1 개', '1개 (본품)']) {
      expect(singleUnitSentence(spec({ extraSpecs: set(value) }))).toBe('Show exactly 1 piece — no more, no fewer.')
    }
    expect(singleUnitSentence(spec({ extraSpecs: set('1세트') }))).toBe('Show exactly 1 set — no more, no fewer.')
  })

  it('구성이 2 이상이면 단품이 아니다 — 옵션 첫 값이 1이어도, 구성이 7 이상이어도', () => {
    expect(singleUnitSentence(spec({ extraSpecs: set('2개') }))).toBeNull()
    expect(singleUnitSentence(spec({ extraSpecs: set('20개'), colorOptions: ['1개', '2개'] }))).toBeNull()
    expect(singleUnitSentence(spec({ extraSpecs: set('10개입'), optionSpec: quantitySpec(['1개']) }))).toBeNull()
  })

  it('구성 칸이 없으면 옵션 수량의 가장 작은 값이 1일 때 — 구조화 옵션·옵션 이름 둘 다(R17-L P10 옵션 1~6개)', () => {
    expect(singleUnitSentence(spec({ optionSpec: quantitySpec(['1개', '2개', '6개']) }))).toBe('Show exactly 1 piece — no more, no fewer.')
    expect(singleUnitSentence(spec({ colorOptions: ['보호대 2개', '보호대 1개'] }))).toBe('Show exactly 1 piece — no more, no fewer.')
    expect(singleUnitSentence(spec({ colorOptions: ['블랙 1세트', '블랙 2세트'] }))).toBe('Show exactly 1 set — no more, no fewer.')
    expect(singleUnitSentence(spec({ colorOptions: ['1쌍', '2쌍'] }))).toBe('Show exactly 1 pair — no more, no fewer.')
    expect(singleUnitSentence(spec({ optionSpec: quantitySpec(['2개', '4개']) }))).toBeNull()
  })

  it('숫자로 시작하지 않는 구성(부품 이름 나열)은 옵션이 1개여도 단품이 아니다 — R17-L P06 브러시 3종, 빈 구성 칸은 없는 것과 같다', () => {
    expect(singleUnitSentence(spec({ extraSpecs: set('슬리커 브러쉬·미세빗(대)·미세빗(소)'), colorOptions: ['1개 모던 그레이'] }))).toBeNull()
    expect(singleUnitSentence(spec({ extraSpecs: set('본체·케이스') }))).toBeNull()
    expect(singleUnitSentence(spec({ extraSpecs: set(' '), colorOptions: ['1개 세이지 그린'] }))).toBe('Show exactly 1 piece — no more, no fewer.')
    // R17-L P07 '1개(그릇 2구)'는 한 개다
    expect(singleUnitSentence(spec({ extraSpecs: set('1개(그릇 2구)') }))).toBe('Show exactly 1 piece — no more, no fewer.')
  })

  it('한 단위에 여럿이 들 수 있는 단위(팩·박스·롤)와 1+1, 수량 옵션이 없는 상품은 단품으로 보지 않는다', () => {
    expect(singleUnitSentence(spec({ colorOptions: ['1팩', '2팩'] }))).toBeNull()
    expect(singleUnitSentence(spec({ colorOptions: ['1박스'] }))).toBeNull()
    expect(singleUnitSentence(spec({ colorOptions: ['1+1', '2+2'] }))).toBeNull()
    expect(singleUnitSentence(spec({ colorOptions: ['레드', '블루'] }))).toBeNull()
    expect(singleUnitSentence(spec({}))).toBeNull()
  })
})
