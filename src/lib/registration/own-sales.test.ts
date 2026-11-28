/**
 * 우리 판매량 × 묶음 수량(J51) — 옵션명 수량 읽기·수동 값 우선·순합(반품 음수 포함)·칸을 쓰지 않는 경우(모름·단위 섞임·하한·판매 0)·기간 문구.
 * 옵션명 꼴은 11-11 운영 읽기 결과('20개 데이지(S)'·'50개 02. 코랄레드'·'핸드메이드-1')를 따랐다.
 */

import { describe, expect, it } from 'vitest'
import { buildNumberSources } from './copy-numbers'
import { specSheetPromptJson, type PdpSpecSheet } from './pdp-state'
import {
  OWN_SALES_MAX_PRODUCTS,
  OWN_SALES_MIN,
  bundleQtyOfName,
  computeOwnSales,
  normalizeOwnSalesBundleQty,
  normalizeOwnSalesProductIds,
  ownSalesLine,
  type OwnSalesOptionRow,
  type OwnSalesRow,
} from './own-sales'

const AT = '2026-11-11T00:00:00.000Z'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const opt = (n: number, optionName: string | null, productId = '15969912606'): OwnSalesOptionRow => ({ rowId: uuid(n), productId, optionName })
const sale = (n: number, orderDate: string, quantity: number): OwnSalesRow => ({ rowId: uuid(n), orderDate, quantity })

describe('bundleQtyOfName — 옵션명 1묶음 수량', () => {
  it.each([
    ['20개 데이지(S)', { qty: 20, unit: '개' }],
    ['50개 02. 코랄레드', { qty: 50, unit: '개' }],
    ['150개 졸업축하-02', { qty: 150, unit: '개' }],
    ['블랙 20개', { qty: 20, unit: '개' }],
    ['20매', { qty: 20, unit: '매' }],
    ['50매입', { qty: 50, unit: '매' }],
    ['30개입', { qty: 30, unit: '개' }],
    ['1,000장', { qty: 1000, unit: '장' }],
  ])('%s → %j', (name, want) => {
    expect(bundleQtyOfName(name)).toEqual(want)
  })

  it.each(['핸드메이드-1', '20매 x 3팩', '20개입 2세트', '3세트', '', null, undefined])('모름: %s', (name) => {
    expect(bundleQtyOfName(name)).toBeNull()
  })
})

describe('computeOwnSales', () => {
  it('옵션별 판매 × 묶음 합 — 반품·정정 음수 행을 뺀 순합, 기간은 판매가 있는 옵션의 첫·마지막 날', () => {
    const snap = computeOwnSales(
      ['15969912606'],
      [opt(1, '20개 데이지(S)'), opt(2, '50개 데이지(S)')],
      [sale(1, '2026-02-02', 1000), sale(1, '2026-08-10', 800), sale(1, '2026-05-01', -20), sale(2, '2026-03-01', 10)],
      {},
      AT
    )
    expect(snap).toMatchObject({ outcome: 'ok', total: 1780 * 20 + 10 * 50, unit: '개', from: '2026-02-02', to: '2026-08-10' })
    expect(snap.options.map((o) => [o.sold, o.qty, o.qtySource])).toEqual([
      [1780, 20, 'name'],
      [10, 50, 'name'],
    ])
    expect(ownSalesLine(snap)).toEqual({ total: '36,100개', basis: '2026.02~2026.08 쿠팡 누적 판매' })
  })

  it('수동 값이 옵션명보다 이기고, 수량을 모르는 옵션도 수동 값이면 센다', () => {
    const snap = computeOwnSales(['1'], [opt(1, '20개 데이지(S)'), opt(2, '핸드메이드-1')], [sale(1, '2026-03-01', 10), sale(2, '2026-03-02', 5)], { [uuid(1)]: { qty: 25, unit: '개' }, [uuid(2)]: { qty: 10, unit: '개' } }, AT)
    expect(snap).toMatchObject({ outcome: 'ok', total: 10 * 25 + 5 * 10 })
    expect(snap.options.map((o) => o.qtySource)).toEqual(['manual', 'manual'])
    expect(ownSalesLine(snap)?.basis).toBe('2026.03 쿠팡 누적 판매')
  })

  it('판매가 있는 옵션 중 하나라도 수량을 모르면 칸 없음(지어내기 0)', () => {
    const snap = computeOwnSales(['1'], [opt(1, '20개 데이지(S)'), opt(2, '핸드메이드-1')], [sale(1, '2026-03-01', 100), sale(2, '2026-03-02', 1)], {}, AT)
    expect(snap).toMatchObject({ outcome: 'unknown_qty', total: null })
    expect(ownSalesLine(snap)).toBeNull()
  })

  it('판매가 없는 옵션은 수량을 몰라도 합을 막지 않는다', () => {
    const snap = computeOwnSales(['1'], [opt(1, '20개 데이지(S)'), opt(2, '핸드메이드-1')], [sale(1, '2026-03-01', 100)], {}, AT)
    expect(snap).toMatchObject({ outcome: 'ok', total: 2000 })
  })

  it('옵션끼리 단위가 다르면 칸 없음', () => {
    const snap = computeOwnSales(['1'], [opt(1, '20개 데이지(S)'), opt(2, '50매')], [sale(1, '2026-03-01', 100), sale(2, '2026-03-02', 100)], {}, AT)
    expect(snap.outcome).toBe('mixed_unit')
  })

  it(`합이 ${OWN_SALES_MIN} 미만이면 칸 없음, 판매가 없거나 순합이 0 이하면 no_sales`, () => {
    expect(computeOwnSales(['1'], [opt(1, '20개 데이지(S)')], [sale(1, '2026-03-01', 4)], {}, AT)).toMatchObject({ outcome: 'below_min', total: 80 })
    expect(computeOwnSales(['1'], [opt(1, '20개 데이지(S)')], [sale(1, '2026-03-01', 5)], {}, AT)).toMatchObject({ outcome: 'ok', total: 100 })
    expect(computeOwnSales(['1'], [opt(1, '20개 데이지(S)')], [], {}, AT).outcome).toBe('no_sales')
    expect(computeOwnSales(['1'], [opt(1, '20개 데이지(S)')], [sale(1, '2026-03-01', 2), sale(1, '2026-03-05', -3)], {}, AT)).toMatchObject({ outcome: 'no_sales' })
    expect(computeOwnSales(['1'], [], [], {}, AT).outcome).toBe('no_sales')
  })
})

describe('입력 정리', () => {
  it('등록상품ID — 숫자 문자열만, 중복 없이 상한까지', () => {
    expect(normalizeOwnSalesProductIds(['15969912606', 16047244503, '15969912606', 'abc', '', ' 16051528015 '])).toEqual(['15969912606', '16047244503', '16051528015'])
    expect(normalizeOwnSalesProductIds(Array.from({ length: 9 }, (_, i) => String(100 + i)))).toHaveLength(OWN_SALES_MAX_PRODUCTS)
    expect(normalizeOwnSalesProductIds('15969912606')).toEqual([])
  })

  it('수동 묶음 수량 — products.id 열쇠·1 이상 정수·낱개 단위만', () => {
    expect(
      normalizeOwnSalesBundleQty({
        [uuid(1)]: { qty: 20, unit: '매' },
        [uuid(2)]: { qty: 0, unit: '개' },
        [uuid(3)]: { qty: 2.5, unit: '개' },
        [uuid(4)]: { qty: 10, unit: '세트' },
        [uuid(5)]: { qty: 2, unit: '쌍' },
        'not-a-row': { qty: 5, unit: '개' },
      })
    ).toEqual({ [uuid(1)]: { qty: 20, unit: '매' }, [uuid(5)]: { qty: 2, unit: '쌍' } })
    expect(normalizeOwnSalesBundleQty(null)).toEqual({})
    expect(normalizeOwnSalesBundleQty([1])).toEqual({})
  })
})

describe('프롬프트·카피 숫자 — 합·기간 문구만', () => {
  const snap = computeOwnSales(['15969912606'], [opt(1, '20개 데이지(S)')], [sale(1, '2026-02-02', 1780)], {}, AT)
  const spec: PdpSpecSheet = {
    productName: '구디백',
    ownSalesProductIds: ['15969912606'],
    ownSalesBundleQty: { [uuid(1)]: { qty: 20, unit: '개' } },
    ownSalesSnapshot: snap,
    ownSales: ownSalesLine(snap) ?? undefined,
  }

  it('프롬프트 스펙 JSON에는 ownSales만 들어간다', () => {
    const json = JSON.parse(specSheetPromptJson(spec)) as Record<string, unknown>
    expect(json.ownSales).toEqual({ total: '35,600개', basis: '2026.02 쿠팡 누적 판매' })
    expect(json).not.toHaveProperty('ownSalesSnapshot')
    expect(json).not.toHaveProperty('ownSalesProductIds')
    expect(json).not.toHaveProperty('ownSalesBundleQty')
  })

  it('카피 숫자 근거 — 합(35,600개)은 받치고, 옵션별 판매(1,780)·등록상품ID는 받치지 않는다', () => {
    const sources = buildNumberSources(spec)
    expect(sources.numbers.has(35600)).toBe(true)
    expect(sources.numbers.has(1780)).toBe(false)
    expect(sources.numbers.has(15969912606)).toBe(false)
  })
})
