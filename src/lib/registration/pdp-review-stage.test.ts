/**
 * 리뷰 입력 파이프라인 연결(pdp-review-input) — 경쟁사 리뷰가 없으면 아무것도 바꾸지 않고, 재현 가드는 자사 리뷰 표현을 뺀다.
 */

import { describe, expect, it } from 'vitest'
import type { AnalysisResult, CopywritingResult, PdpJobRow } from './pdp-state'
import { competitorEchoGuard, finishCompetitorEcho, withCompetitorPainPoints } from './pdp-review-stage'
import { hasEcho } from './reviews/competitor-echo'

const SHARED = '국물이 조금씩 새어 나와서 가방에 넣기가 불안했어요'

function job(spec: Partial<PdpJobRow['spec_sheet']>): PdpJobRow {
  return { spec_sheet: { productName: 'x', ...spec }, analysis: {} } as unknown as PdpJobRow
}

const competitorReviews = {
  version: 1 as const,
  fileName: 'c.xlsx',
  stats: { total_rows: 1, text_review_count: 1, rating_counts: {} },
  dropped: 0,
  removedNames: [],
  checkNames: [],
  items: [{ id: 1, rating: 2, helped: 0, title: '', body: `뚜껑을 세게 닫아도 ${SHARED}` }],
}

describe('competitorEchoGuard', () => {
  it('경쟁사 리뷰가 없으면 null', () => {
    expect(competitorEchoGuard(job({}))).toBeNull()
  })

  it('자사 리뷰 텍스트에도 있는 표현은 재현으로 보지 않는다', () => {
    const guard = competitorEchoGuard(job({ competitorReviews, reviewsText: `내용: ${SHARED}` }))!
    expect(hasEcho(SHARED, guard)).toBe(false)
    expect(hasEcho('뚜껑을 세게 닫아도 국물이 조금씩 새', guard)).toBe(true)
    // 자사 리뷰가 없으면 같은 표현도 재현이다
    expect(hasEcho(SHARED, competitorEchoGuard(job({ competitorReviews }))!)).toBe(true)
  })
})

describe('withCompetitorPainPoints', () => {
  it('요약이 없으면 같은 객체, 있으면 키를 더한다', () => {
    const analysis = { keywords: ['a'] } as AnalysisResult
    expect(withCompetitorPainPoints(analysis, undefined)).toBe(analysis)
    const summary = { version: 1 as const, sample_size: 1, total_rows: 1, items: [] }
    expect(withCompetitorPainPoints(analysis, summary)).toEqual({ keywords: ['a'], competitor_pain_points: summary })
  })
})

describe('finishCompetitorEcho', () => {
  it('지운 문장이 있을 때만 경고를 남긴다', () => {
    const guard = competitorEchoGuard(job({ competitorReviews }))!
    const record = { rewritten_sections: [], regenerated: false }
    const clean = finishCompetitorEcho({ summary: '새 표현' } as unknown as CopywritingResult, guard, record)
    expect(clean.warning).toBeUndefined()
    expect(clean.record).toEqual({ ...record, removed: [] })
    const dirty = finishCompetitorEcho({ summary: `${SHARED}. 좋아요.` } as unknown as CopywritingResult, guard, record)
    expect(dirty.warning).toContain('[CompetitorEcho] 경쟁 상품 리뷰와 겹친 문장 1개를 지움')
    expect((dirty.copy as unknown as { summary: string }).summary).toBe('좋아요.')
  })
})
