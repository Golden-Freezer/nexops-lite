/**
 * 리뷰 받을 쿠팡 상품 번호 칸 — 이름·안내(엑셀 우선), 상태 한 줄, 입구 호출(503이면 수집 불가, 404 NOT_REQUESTED는 요청 없음)을 고정한다.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import type { CompetitorReviews } from '@/lib/registration/reviews/review-types'
import { PdpReviewSourceProducts, fetchReviewCollectionStatus, requestReviewCollection, reviewStateLine } from './PdpReviewSourceProducts'

// 프로젝트 Vitest 변환은 classic JSX를 쓴다(PdpReviewFiles.test.tsx와 같은 처리)
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

const render = (spec: Partial<PdpSpecSheet>) =>
  renderToStaticMarkup(createElement(PdpReviewSourceProducts, { spec: { productName: '컵', ...spec } as PdpSpecSheet, onChange: () => {} }))

const excel: CompetitorReviews = { version: 1, fileName: 'c.xlsx', stats: { total_rows: 1, text_review_count: 1, rating_counts: {} }, dropped: 0, items: [], removedNames: [], checkNames: [] }

function stubFetch(status: number, json: unknown) {
  const fetchMock = vi.fn(async () => new Response(json === null ? 'not json' : JSON.stringify(json), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('PdpReviewSourceProducts — 화면', () => {
  it('칸 이름·저장된 번호·분석 전용 안내', () => {
    const html = render({ reviewSourceProductIds: ['123', '456'] })
    expect(html).toContain('리뷰 받을 쿠팡 상품 번호 (같은·경쟁 상품 1~3개)')
    expect(html).toContain('value="123, 456"')
    expect(html).toContain('수집 요청')
    expect(html).toContain('소구점 분석에만')
  })

  it('엑셀 경쟁사 파일이 있으면 파일 우선 안내, 수집으로 채운 값이면 일반 안내', () => {
    expect(render({ competitorReviews: excel })).toContain('파일 우선')
    expect(render({ competitorReviews: { ...excel, origin: 'collected' } })).not.toContain('파일 우선')
  })
})

describe('reviewStateLine — 상태 한 줄', () => {
  it('상태·행 수·받은 시각(KST), 실패·수집 불가는 사유', () => {
    expect(reviewStateLine({ productId: '1', state: 'done', rows: 1234, collectedAt: '2026-11-05T05:20:00Z', lastError: null, fresh: true })).toMatch(
      /^끝\(최근 7일 안에 받음\) · 리뷰 1,234행 · .*14:20 받음$/
    )
    expect(reviewStateLine({ productId: '1', state: 'queued', rows: null, collectedAt: null, lastError: null })).toBe('대기')
    expect(reviewStateLine({ productId: '1', state: 'unavailable', rows: null, collectedAt: null, lastError: '표가 아직 없습니다.' })).toBe('수집 불가 · 표가 아직 없습니다.')
  })
})

describe('입구 호출', () => {
  it("수집 요청은 source 'pdp'로 보내고, 503이면 상품마다 수집 불가", async () => {
    const fetchMock = stubFetch(503, { error: '표가 아직 없습니다.', code: 'TABLE_MISSING' })
    const views = await requestReviewCollection(['1', '2'], '컵')
    expect(views.map((v) => v.state)).toEqual(['unavailable', 'unavailable'])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/competitor-reviews/requests')
    expect(JSON.parse(String(init.body))).toEqual({ product_ids: ['1', '2'], source: 'pdp', source_key: 'pdp:컵' })
  })

  it('상태 조회 404 NOT_REQUESTED는 요청 없음, 본문이 JSON이 아니어도 throw하지 않는다', async () => {
    stubFetch(404, { error: '없음', code: 'NOT_REQUESTED' })
    expect((await fetchReviewCollectionStatus('9')).state).toBe('not_requested')
    stubFetch(500, null)
    expect((await fetchReviewCollectionStatus('9')).state).toBe('unavailable')
  })
})
