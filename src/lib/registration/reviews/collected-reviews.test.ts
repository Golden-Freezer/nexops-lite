/**
 * 수집 리뷰 스냅숏 — user_id 격리·상품당 최신순 1,500행(1,000행씩 나눠 받음)·엑셀과 같은 표집 상한·엑셀 우선·표 없음에도 잡 생성 이어 감.
 * DB는 이 시험의 가짜(질의 칸을 기록한다) — 공용 가짜 DB를 바꾸지 않는다.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PdpSpecSheet } from '../pdp-state'
import {
  COLLECTED_REVIEWS_PER_PRODUCT,
  attachCollectedReviews,
  buildCollectedCompetitorReviews,
  loadCollectedReviewRows,
  type CollectedReviewRow,
} from './collected-reviews'
import { COMPETITOR_SAMPLE_LIMIT, COMPETITOR_TEXT_MAX_CHARS, REVIEW_BODY_MAX_CHARS, type CompetitorReviews } from './review-types'

interface Query {
  table: string
  select: string
  eq: Record<string, unknown>
  order: Array<[string, unknown]>
  range: [number, number] | null
}

/** competitor_reviews 가짜 — (user_id, product_id)별 행을 range로 잘라 준다 */
function fakeDb(byKey: Record<string, CollectedReviewRow[]>, error: { code?: string; message: string } | null = null) {
  const queries: Query[] = []
  const db = {
    from(table: string) {
      const q: Query = { table, select: '', eq: {}, order: [], range: null }
      queries.push(q)
      const builder = {
        select(cols: string) {
          q.select = cols
          return builder
        },
        eq(col: string, value: unknown) {
          q.eq[col] = value
          return builder
        },
        order(col: string, opts: unknown) {
          q.order.push([col, opts])
          return builder
        },
        range(from: number, to: number) {
          q.range = [from, to]
          const rows = byKey[`${q.eq.user_id}/${q.eq.product_id}`] ?? []
          return Promise.resolve(error ? { data: null, error } : { data: rows.slice(from, to + 1), error: null })
        },
      }
      return builder
    },
  }
  return { db: db as unknown as SupabaseClient, queries }
}

const row = (i: number, extra: Partial<CollectedReviewRow> = {}): CollectedReviewRow => ({
  rating: (i % 5) + 1,
  title: `제목 ${i}`,
  content: `리뷰 본문 ${i} — 착용감이 편하고 오래 써도 괜찮아요`,
  helpful_count: i % 3,
  collected_at: `2026-11-0${(i % 5) + 1}T00:00:00Z`,
  ...extra,
})

const base: PdpSpecSheet = { productName: '무릎 보호대' }

describe('loadCollectedReviewRows — 읽기', () => {
  it('user_id·product_id로 거르고 최신순으로, 1,000행씩 나눠 상품당 1,500행까지', async () => {
    const many = Array.from({ length: 2_000 }, (_, i) => row(i))
    const { db, queries } = fakeDb({ 'u1/100': many, 'u2/100': [row(1)], 'u1/200': [row(2)] })
    const r = await loadCollectedReviewRows(db, 'u1', ['100', '200'])
    expect(r.ok && [r.rows.get('100')!.length, r.rows.get('200')!.length]).toEqual([COLLECTED_REVIEWS_PER_PRODUCT, 1])
    expect(queries.map((q) => [q.eq.product_id, q.range])).toEqual([
      ['100', [0, 999]],
      ['100', [1000, 1499]],
      ['200', [0, 999]],
    ])
    expect(queries.every((q) => q.table === 'competitor_reviews' && q.eq.user_id === 'u1')).toBe(true)
    expect(queries[0]!.order).toEqual([
      ['reviewed_at', { ascending: false, nullsFirst: false }],
      ['id', { ascending: true }],
    ])
    expect(queries[0]!.select).not.toContain('option_name')
  })

  it('표가 없으면 TABLE_MISSING, 다른 오류는 ERROR', async () => {
    expect(await loadCollectedReviewRows(fakeDb({}, { code: '42P01', message: 'relation does not exist' }).db, 'u1', ['1'])).toMatchObject({
      ok: false,
      reason: 'TABLE_MISSING',
    })
    expect(await loadCollectedReviewRows(fakeDb({}, { message: 'timeout' }).db, 'u1', ['1'])).toMatchObject({ ok: false, reason: 'ERROR', message: 'timeout' })
  })
})

describe('buildCollectedCompetitorReviews — 엑셀 경쟁사와 같은 표집', () => {
  it('별점 분포는 전 행(본문 없는 행 포함), 항목은 60건·본문 300자·합 10,000자, 옵션 없음, 출처 collected', () => {
    const rows = new Map<string, CollectedReviewRow[]>([
      ['1', Array.from({ length: 300 }, (_, i) => row(i, { content: `${'아주 긴 후기 '.repeat(40)}${i}` }))],
      ['2', [row(1, { content: null, rating: 1 }), row(2, { content: '  ', rating: 1 })]],
    ])
    const r = buildCollectedCompetitorReviews(['1', '2'], rows)!
    expect(r.origin).toBe('collected')
    expect(r.fileName).toBe('쿠팡 수집 리뷰(상품 1·2)')
    expect(r.stats.total_rows).toBe(302)
    expect(r.stats.text_review_count).toBe(300)
    expect(r.stats.rating_counts['1']).toBe(62)
    expect(r.items.length).toBeLessThanOrEqual(COMPETITOR_SAMPLE_LIMIT)
    expect(r.items.every((it) => it.body.length <= REVIEW_BODY_MAX_CHARS && !('option' in it))).toBe(true)
    expect(r.items.reduce((a, it) => a + it.title.length + it.body.length, 0)).toBeLessThanOrEqual(COMPETITOR_TEXT_MAX_CHARS)
    expect([r.removedNames, r.checkNames]).toEqual([[], []])
  })

  it('개인정보를 지우고 겹친 본문을 버린다', () => {
    const rows = new Map([['1', [row(1, { content: '연락 주세요 010-1234-5678 품질 좋아요' }), row(2, { content: '연락 주세요 010-1234-5678 품질 좋아요' })]]])
    const r = buildCollectedCompetitorReviews(['1'], rows)!
    expect(r.items).toHaveLength(1)
    expect(r.items[0]!.body).not.toContain('010-1234-5678')
    expect(r.dropped).toBe(1)
  })

  it('쓸 본문이 없으면 null', () => {
    expect(buildCollectedCompetitorReviews(['1'], new Map([['1', [row(1, { content: null })]]]))).toBeNull()
  })
})

describe('attachCollectedReviews — 잡 생성 전 스냅숏', () => {
  const now = new Date('2026-11-05T06:00:00Z')

  it('두 칸이 없으면 같은 객체(기존 잡 입력 불변), DB를 읽지 않는다', async () => {
    const { db, queries } = fakeDb({})
    const spec = { ...base, reviewsText: 'x' }
    expect(await attachCollectedReviews(db, 'u1', spec, now)).toBe(spec)
    expect(queries).toHaveLength(0)
  })

  it('수집 리뷰로 competitorReviews를 채우고 상품 번호·행 수·collected_at을 남긴다(입력 기록은 버림)', async () => {
    const { db } = fakeDb({ 'u1/100': [row(1), row(2, { collected_at: '2026-11-05T01:00:00Z' })], 'u1/200': [] })
    const spec = {
      ...base,
      reviewSourceProductIds: ['100', '200', '100'],
      reviewSourceSnapshot: { forged: true },
    } as unknown as PdpSpecSheet
    const out = await attachCollectedReviews(db, 'u1', spec, now)
    expect(out.reviewSourceProductIds).toEqual(['100', '200'])
    expect(out.competitorReviews?.origin).toBe('collected')
    expect(out.competitorReviews?.items).toHaveLength(2)
    expect(out.reviewSourceSnapshot).toEqual({
      version: 1,
      at: now.toISOString(),
      outcome: 'collected',
      products: [
        { productId: '100', rows: 2, collectedAt: '2026-11-05T01:00:00Z' },
        { productId: '200', rows: 0, collectedAt: null },
      ],
      sampled: 2,
    })
  })

  it('엑셀 경쟁사 파일이 있으면 그것만 쓰고 수집 리뷰를 읽지 않는다', async () => {
    const { db, queries } = fakeDb({ 'u1/100': [row(1)] })
    const excel = { version: 1, fileName: 'c.xlsx', stats: { total_rows: 1, text_review_count: 1, rating_counts: {} }, dropped: 0, items: [], removedNames: [], checkNames: [] } as CompetitorReviews
    const out = await attachCollectedReviews(db, 'u1', { ...base, competitorReviews: excel, reviewSourceProductIds: ['100'] }, now)
    expect(out.competitorReviews).toBe(excel)
    expect(out.reviewSourceSnapshot).toMatchObject({ outcome: 'excel', products: [{ productId: '100', rows: null, collectedAt: null }], sampled: 0 })
    expect(queries).toHaveLength(0)
  })

  it('앞 잡에서 옮겨 온 수집 값은 지금 다시 읽어 바꾼다, 본문이 없으면 empty', async () => {
    const stale = { version: 1, fileName: 'old', stats: { total_rows: 9, text_review_count: 9, rating_counts: {} }, dropped: 0, items: [{ id: 1, rating: 5, helped: 0, title: '', body: '옛 후기 본문' }], removedNames: [], checkNames: [], origin: 'collected' } as CompetitorReviews
    const { db } = fakeDb({ 'u1/100': [row(1, { content: null })] })
    const out = await attachCollectedReviews(db, 'u1', { ...base, competitorReviews: stale, reviewSourceProductIds: ['100'] }, now)
    expect(out.competitorReviews).toBeUndefined()
    expect(out.reviewSourceSnapshot).toMatchObject({ outcome: 'empty', products: [{ productId: '100', rows: 1 }], sampled: 0 })
  })

  it('표가 없어도 잡 생성은 이어 간다(unavailable 기록)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db } = fakeDb({}, { code: 'PGRST205', message: "Could not find the table 'public.competitor_reviews'" })
    const out = await attachCollectedReviews(db, 'u1', { ...base, reviewSourceProductIds: ['100'] }, now)
    expect(out.competitorReviews).toBeUndefined()
    expect(out.reviewSourceSnapshot).toMatchObject({ outcome: 'unavailable', error: 'competitor_reviews 표 없음' })
    spy.mockRestore()
  })

  it('번호가 모두 틀리면 두 칸을 지운다', async () => {
    const { db, queries } = fakeDb({})
    const out = await attachCollectedReviews(db, 'u1', { ...base, reviewSourceProductIds: ['abc'] }, now)
    expect(out).toEqual(base)
    expect(queries).toHaveLength(0)
  })
})
