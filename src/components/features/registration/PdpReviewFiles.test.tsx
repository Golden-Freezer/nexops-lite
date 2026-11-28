/**
 * 리뷰 파일 입력(pdp-review-input) — 두 입력의 이름·안내와, 올린 파일이 있으면 파일명·통계를 보여 주는지 고정한다.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import { PdpReviewFiles, fetchReviewIntake, quoteCards, removeReviewFilePatch, reviewIntakePatch } from './PdpReviewFiles'
import type { CompetitorReviews } from '@/lib/registration/reviews/review-types'

// 프로젝트 Vitest 변환은 classic JSX를 쓴다(PdpPreview.test.tsx와 같은 처리)
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

const stats = { total_rows: 432, text_review_count: 310, rating_counts: { '5': 300 } }

function render(spec: Partial<PdpSpecSheet>): string {
  return renderToStaticMarkup(
    createElement(PdpReviewFiles, { spec: { productName: 'x', ...spec } as PdpSpecSheet, onChange: () => {} })
  )
}

describe('PdpReviewFiles', () => {
  it('파일이 없으면 두 입력과 용도 안내만', () => {
    const html = render({})
    expect(html).toContain('자사 리뷰 파일 (WING 리뷰 다운로드)')
    expect(html).toContain('경쟁사 리뷰 파일 (분석용)')
    expect(html).toContain('리뷰 문장·타사명은 카피에 쓰지 않습니다')
    expect(html.match(/파일 선택/g)).toHaveLength(2)
  })

  it('파싱 결과를 spec 패치로 바꾼다 — 자사는 리뷰 원문 칸·메타, 경쟁사는 competitorReviews', () => {
    const meta = { fileName: '우리.xlsx', stats, sampled: 3, dropped: 0 }
    // 인용 후보(W2a)는 화면이 따로 고르는 목록이라 spec 패치에 들어가지 않는다
    const candidates = [{ id: 'abc', text: '좋아요', rating: 5 }]
    expect(reviewIntakePatch({ kind: 'own', reviewsText: 'T', meta, reviewCandidates: candidates })).toEqual({
      reviewsText: 'T',
      reviewFiles: { own: meta },
    })
    const competitorReviews = {
      version: 1,
      fileName: 'c',
      stats,
      dropped: 0,
      items: [],
      removedNames: [],
      checkNames: [],
    } as CompetitorReviews
    expect(reviewIntakePatch({ kind: 'competitor', competitorReviews })).toEqual({ competitorReviews })
  })

  it('파일 빼기 — 자사는 고른 인용 카드를 비우고, 채운 원문은 고치지 않았을 때만 함께 비운다, 경쟁사는 competitorReviews만', () => {
    const spec = { productName: 'x', reviewsText: 'T' } as PdpSpecSheet
    expect(removeReviewFilePatch('own', spec, 'T')).toStrictEqual({ reviewFiles: undefined, reviewQuotes: undefined, reviewsText: undefined })
    expect(removeReviewFilePatch('own', { ...spec, reviewsText: 'T 고침' }, 'T')).toStrictEqual({
      reviewFiles: undefined,
      reviewQuotes: undefined,
    })
    expect(removeReviewFilePatch('own', spec, null)).toStrictEqual({ reviewFiles: undefined, reviewQuotes: undefined })
    expect(removeReviewFilePatch('competitor', spec, 'T')).toStrictEqual({ competitorReviews: undefined })
  })

  it('라우트 호출 — kind와 파일을 보내고, 실패면 서버 문구로 던진다', async () => {
    const calls: Array<{ url: string; body: FormData }> = []
    vi.stubGlobal('fetch', async (url: string, init: { body: FormData }) => {
      calls.push({ url, body: init.body })
      const ok = init.body.get('kind') === 'own'
      return {
        ok,
        json: async () => (ok ? { data: { kind: 'own', reviewsText: 'T', meta: {} } } : { error: '형식 오류' }),
      }
    })
    const file = new File(['x'], 'a.xlsx')
    await expect(fetchReviewIntake('own', file)).resolves.toMatchObject({ kind: 'own', reviewsText: 'T' })
    await expect(fetchReviewIntake('competitor', file)).rejects.toThrow('형식 오류')
    expect(calls[0].url).toBe('/api/registration/reviews')
    expect(calls[0].body.get('file')).toBeInstanceOf(File)
  })

  it('올린 파일은 파일명·건수를 보여 주고 빼기 버튼을 둔다', () => {
    const html = render({
      reviewFiles: { own: { fileName: '우리.xlsx', stats, sampled: 100, dropped: 2 } },
      competitorReviews: {
        version: 1,
        fileName: '경쟁.xlsx',
        stats,
        dropped: 0,
        items: [],
        removedNames: [],
        checkNames: [],
      },
    })
    expect(html).toContain('우리.xlsx')
    expect(html).toContain('리뷰 432건 · 글 리뷰 310건 · 표집 100건')
    expect(html).toContain('경쟁.xlsx')
    expect(html).toContain('표집 0건')
    expect(html).toContain('aria-label="경쟁사 리뷰 파일 (분석용) 빼기"')
  })
})

describe('인용 카드 목록(W3)', () => {
  it('이번 후보 뒤에, 후보에 없는 이미 고른 카드를 붙여 뺄 수 있게 한다(같은 id는 한 번)', () => {
    const candidates = [{ id: 'a', text: '좋아요', rating: 5 }]
    const selected = [
      { id: 'a', text: '좋아요', rating: 5 },
      { id: 'old', text: '예전 파일 후기', rating: 4, highlights: ['예전'] },
    ]
    expect(quoteCards(candidates, selected).map((c) => c.id)).toEqual(['a', 'old'])
    expect(quoteCards([], undefined)).toEqual([])
  })

  it('파일이 없어도 인용 카드 자리에 안내가 나오고, 고른 카드가 있으면 그 카드가 보인다', () => {
    expect(render({})).toContain('자사 리뷰 파일을 올리면 인용할 후기 후보가 여기 나옵니다.')
    const html = render({ reviewQuotes: [{ id: 'q1', text: '물도 사료도 한 번에', rating: 5 }] })
    expect(html).toContain('aria-label="후기 인용 후보"')
    expect(html).toContain('1/6장 선택')
  })

  it('본문에서 고른 카드 문장이 글과 다르면 페이지에 실릴 글을 보여 주고, 강조 조각도 그 글에서 낸다', () => {
    const html = render({
      reviewQuotes: [
        { id: 'q1', text: '가방이 자주 무거웠어요', rating: 5, cardSummary: '부드럽게 열려요.' },
        { id: 'q2', text: '색이 예뻐요', rating: 5, cardSummary: '색이 예뻐요' },
        { id: 'q3', text: '받침이 잘 맞아요', rating: 5 },
      ],
    })
    expect(html).toContain('페이지 카드 글: 부드럽게 열려요.')
    expect(html.match(/페이지 카드 글:/g)).toHaveLength(1)
    expect(html).toContain('>부드럽게</button>')
    expect(html).not.toContain('>무거웠어요</button>')
  })
})
