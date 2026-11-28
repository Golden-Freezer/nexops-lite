/**
 * POST /api/registration/pdp — 리뷰 받을 쿠팡 상품 번호가 있으면 잡 사용자의 수집 리뷰를 읽어 competitorReviews·reviewSourceSnapshot으로
 * 저장한다(읽기만). 번호가 없으면 DB를 읽지 않는다. 잡 저장·초안 연결은 모의.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  createPdpJob: vi.fn(),
  queries: [] as Array<{ table: string; eq: Record<string, unknown> }>,
}))

vi.mock('@/lib/auth/clerk', () => ({ requireOwner: vi.fn(async () => 'user-1') }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const q = { table, eq: {} as Record<string, unknown> }
      h.queries.push(q)
      const builder = {
        select: () => builder,
        eq: (col: string, value: unknown) => {
          q.eq[col] = value
          return builder
        },
        order: () => builder,
        range: async () => ({
          data: q.eq.user_id === 'user-1' && q.eq.product_id === '777' ? [{ rating: 4, title: '좋아요', content: '두께가 적당하고 오래 걸어도 편해요', helpful_count: 2, collected_at: '2026-11-05T03:00:00Z' }] : [],
          error: null,
        }),
      }
      return builder
    },
  }),
}))
vi.mock('@/lib/registration/job-draft-link', () => ({
  resolveJobDraftLink: vi.fn(async () => ({ ok: true, draftId: null, businessId: null })),
}))
vi.mock('@/lib/registration/pdp-jobs', () => ({
  createPdpJob: (...a: unknown[]) => h.createPdpJob(...a),
  listPdpJobs: vi.fn(),
}))

import { POST } from './route'

const post = (specSheet: Record<string, unknown>) =>
  POST(
    new NextRequest('http://localhost/api/registration/pdp', {
      method: 'POST',
      body: JSON.stringify({ specSheet, sourceImages: ['https://example.com/a.jpg'], imageModel: 'gpt-image-2.5-sunburst' }),
    })
  )

const savedSpec = () => (h.createPdpJob.mock.calls[0]![2] as { specSheet: Record<string, unknown> }).specSheet

beforeEach(() => {
  h.createPdpJob.mockReset().mockResolvedValue({ id: 'job-1' })
  h.queries.length = 0
})

describe('POST /api/registration/pdp — 수집 리뷰 스냅숏', () => {
  it('번호가 있으면 잡 사용자 행만 읽어 competitorReviews와 기록을 저장한다', async () => {
    const res = await post({ productName: '무릎 보호대', reviewSourceProductIds: ['777', '888'] })
    expect(res.status).toBe(202)
    expect(h.queries.map((q) => [q.table, q.eq.user_id, q.eq.product_id])).toEqual([
      ['competitor_reviews', 'user-1', '777'],
      ['competitor_reviews', 'user-1', '888'],
    ])
    const spec = savedSpec()
    expect(spec.competitorReviews).toMatchObject({ origin: 'collected', items: [{ id: 1, rating: 4, body: '두께가 적당하고 오래 걸어도 편해요' }] })
    expect(spec.reviewSourceSnapshot).toMatchObject({
      outcome: 'collected',
      products: [
        { productId: '777', rows: 1, collectedAt: '2026-11-05T03:00:00Z' },
        { productId: '888', rows: 0, collectedAt: null },
      ],
      sampled: 1,
    })
  })

  it('번호가 없으면 DB를 읽지 않고 spec도 그대로다', async () => {
    expect((await post({ productName: '무릎 보호대' })).status).toBe(202)
    expect(h.queries).toHaveLength(0)
    expect(savedSpec()).toEqual({ productName: '무릎 보호대' })
  })
})
