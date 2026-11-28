/**
 * 우리 판매량 읽기(J51) — user_id·business_id 격리, purpose=product·confirmed만, 1,000행씩 나눠 받기, 입력 서버 칸 버리기,
 * 사업장 없음·읽기 실패에도 잡 생성 이어 감, 고르기 목록(등록상품ID 묶기·ID 없는 행 빼기·검색).
 * DB는 이 시험의 가짜(질의 칸을 기록하고 eq·in으로 거른다) — 공용 가짜 DB를 바꾸지 않는다.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PdpSpecSheet } from './pdp-state'
import { attachOwnSales, listOwnListings, loadOwnSales } from './own-sales-load'

type Row = Record<string, unknown>
interface Query {
  table: string
  eq: Record<string, unknown>
  in: Record<string, unknown[]>
  range: [number, number] | null
}

function fakeDb(tables: Record<string, Row[]>, failTable?: string) {
  const queries: Query[] = []
  const db = {
    from(table: string) {
      const q: Query = { table, eq: {}, in: {}, range: null }
      queries.push(q)
      const builder = {
        select: () => builder,
        eq(col: string, value: unknown) {
          q.eq[col] = value
          return builder
        },
        in(col: string, values: unknown[]) {
          q.in[col] = values
          return builder
        },
        order: () => builder,
        range(from: number, to: number) {
          q.range = [from, to]
          if (table === failTable) return Promise.resolve({ data: null, error: { message: '읽기 실패' } })
          const rows = (tables[table] ?? []).filter(
            (r) => Object.entries(q.eq).every(([k, v]) => r[k] === v) && Object.entries(q.in).every(([k, vs]) => vs.includes(r[k]))
          )
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
        },
      }
      return builder
    },
  }
  return { db: db as unknown as SupabaseClient, queries }
}

const U = 'user-1'
const B = 'biz-1'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const product = (n: number, extra: Row = {}): Row => ({
  id: id(n),
  user_id: U,
  business_id: B,
  purpose: 'product',
  coupang_product_id: '15969912606',
  option_name: '20개 데이지(S)',
  product_name: '페어넥스 구디백 포장봉투',
  coupang_display_name: null,
  ...extra,
})
const tx = (n: number, qty: number, extra: Row = {}): Row => ({ product_id: id(n), user_id: U, business_id: B, status: 'confirmed', order_date: '2026-03-01', order_quantity: qty, ...extra })
const NOW = new Date('2026-11-11T00:00:00Z')

describe('loadOwnSales — 격리', () => {
  it('남의 사용자·다른 사업장·소싱 행·취소 행은 읽지 않는다', async () => {
    const { db, queries } = fakeDb({
      products: [product(1), product(2, { user_id: 'other' }), product(3, { business_id: 'biz-2' }), product(4, { purpose: 'sourcing' }), product(5, { coupang_product_id: '999' })],
      sales_transactions: [tx(1, 10), tx(1, 3, { status: 'cancelled' }), tx(1, 7, { business_id: 'biz-2' }), tx(1, 9, { user_id: 'other' }), tx(2, 50)],
    })
    const { options, sales } = await loadOwnSales(db, U, B, ['15969912606'])
    expect(options.map((o) => o.rowId)).toEqual([id(1)])
    expect(sales).toEqual([{ rowId: id(1), orderDate: '2026-03-01', quantity: 10 }])
    for (const q of queries) expect(q.eq).toMatchObject({ user_id: U, business_id: B })
    expect(queries.find((q) => q.table === 'sales_transactions')?.eq.status).toBe('confirmed')
  })

  it('판매 행이 1,000개를 넘으면 나눠 받는다', async () => {
    const { db, queries } = fakeDb({ products: [product(1)], sales_transactions: Array.from({ length: 1500 }, () => tx(1, 1)) })
    const { sales } = await loadOwnSales(db, U, B, ['15969912606'])
    expect(sales).toHaveLength(1500)
    expect(queries.filter((q) => q.table === 'sales_transactions').map((q) => q.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })
})

describe('attachOwnSales', () => {
  it('고른 것이 없으면 같은 객체(기존 잡 입력 불변)', async () => {
    const { db, queries } = fakeDb({})
    const spec: PdpSpecSheet = { productName: '구디백' }
    expect(await attachOwnSales(db, U, B, spec, NOW)).toBe(spec)
    expect(queries).toHaveLength(0)
  })

  it('합·기간 문구를 채우고, 입력에 실려 온 서버 칸(ownSales·ownSalesSnapshot)은 버린다', async () => {
    const { db } = fakeDb({ products: [product(1)], sales_transactions: [tx(1, 1780, { order_date: '2026-02-02' })] })
    const forged = { productName: '구디백', ownSalesProductIds: ['15969912606'], ownSales: { total: '9,999,999개', basis: '지어냄' } } as PdpSpecSheet
    const out = await attachOwnSales(db, U, B, forged, NOW)
    expect(out.ownSales).toEqual({ total: '35,600개', basis: '2026.02 쿠팡 누적 판매' })
    expect(out.ownSalesSnapshot).toMatchObject({ outcome: 'ok', total: 35600, at: NOW.toISOString(), productIds: ['15969912606'] })
  })

  it('판정이 ok가 아니면 ownSales 없이 기록만', async () => {
    const { db } = fakeDb({ products: [product(1, { option_name: '핸드메이드-1' })], sales_transactions: [tx(1, 500)] })
    const out = await attachOwnSales(db, U, B, { productName: 'x', ownSalesProductIds: ['15969912606'] }, NOW)
    expect(out.ownSales).toBeUndefined()
    expect(out.ownSalesSnapshot?.outcome).toBe('unknown_qty')
  })

  it('수동 묶음 수량은 정리해 남기고 계산에 쓴다', async () => {
    const { db } = fakeDb({ products: [product(1, { option_name: '핸드메이드-1' })], sales_transactions: [tx(1, 500)] })
    const out = await attachOwnSales(db, U, B, { productName: 'x', ownSalesProductIds: ['15969912606'], ownSalesBundleQty: { [id(1)]: { qty: 20, unit: '매' } } }, NOW)
    expect(out.ownSalesBundleQty).toEqual({ [id(1)]: { qty: 20, unit: '매' } })
    expect(out.ownSales?.total).toBe('10,000매')
  })

  it('사업장이 없으면 읽지 않고 no_business, 읽기 실패면 unavailable — 둘 다 잡 생성은 이어 간다', async () => {
    const empty = fakeDb({})
    const noBiz = await attachOwnSales(empty.db, U, null, { productName: 'x', ownSalesProductIds: ['1'] }, NOW)
    expect(noBiz.ownSalesSnapshot?.outcome).toBe('no_business')
    expect(empty.queries).toHaveLength(0)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = fakeDb({}, 'products')
    const failed = await attachOwnSales(broken.db, U, B, { productName: 'x', ownSalesProductIds: ['1'] }, NOW)
    expect(failed.ownSalesSnapshot?.outcome).toBe('unavailable')
    expect(failed.ownSales).toBeUndefined()
    err.mockRestore()
  })

  it('등록상품ID가 모두 버려지면 칸을 모두 지운다', async () => {
    const { db } = fakeDb({})
    const out = await attachOwnSales(db, U, B, { productName: 'x', ownSalesProductIds: ['abc'], ownSalesBundleQty: {} } as PdpSpecSheet, NOW)
    expect(out).toEqual({ productName: 'x' })
  })
})

describe('listOwnListings — 고르기 목록', () => {
  it('등록상품ID로 묶고, ID 없는 행은 빼고, 검색은 상품명·등록상품ID', async () => {
    const { db, queries } = fakeDb({
      products: [
        product(1),
        product(2, { option_name: '50개 데이지(S)' }),
        product(3, { coupang_product_id: '16012046293', product_name: '대야픽 생일 스티커', option_name: '핸드메이드-1' }),
        product(4, { coupang_product_id: null, product_name: '티커링 스티커' }),
        product(5, { business_id: 'biz-2', coupang_product_id: '777', product_name: '다른 사업장 스티커' }),
      ],
    })
    const all = await listOwnListings(db, U, B, '')
    expect(all.map((l) => [l.productId, l.options.length])).toEqual([
      ['16012046293', 1],
      ['15969912606', 2],
    ])
    expect(all[1].options[0].bundle).toEqual({ qty: 20, unit: '개' })
    expect(all[0].options[0].bundle).toBeNull()
    expect((await listOwnListings(db, U, B, '스티커')).map((l) => l.productId)).toEqual(['16012046293'])
    expect((await listOwnListings(db, U, B, '15969912606')).map((l) => l.productId)).toEqual(['15969912606'])
    for (const q of queries) expect(q.eq).toMatchObject({ user_id: U, business_id: B, purpose: 'product' })
  })
})
