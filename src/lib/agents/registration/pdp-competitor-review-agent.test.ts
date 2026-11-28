/**
 * 경쟁사 리뷰 분석 콜(pdp-review-input) — 라우트·프롬프트(원문은 이 콜에만)와 산출 검사(빈도는 코드가 센다,
 * 번호 없음·원문 재현·판매자명 항목 버림)를 고정한다. LLM은 모의다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompetitorReviews } from '@/lib/registration/reviews/review-types'

const llm = vi.hoisted(() => ({
  calls: [] as Array<{ route: Record<string, unknown>; request: Record<string, unknown> }>,
  reply: '',
}))

vi.mock('../llm', () => ({
  callLlm: async (route: Record<string, unknown>, request: Record<string, unknown>, parser: (t: string) => unknown) => {
    llm.calls.push({ route, request })
    const usage = { inputTokens: 10, outputTokens: 5, cost: 0.001 }
    try {
      return { success: true, data: parser(llm.reply), usage, duration: 1 }
    } catch (e) {
      return { success: false, error: { message: String(e), stage: 'parse', attempts: 1 }, usage, duration: 1 }
    }
  },
}))

import { runCompetitorReviewAnalysis, summarizeCompetitorPainPoints } from './pdp-competitor-review-agent'
import { buildCompetitorPainBlock } from './prompts/pdp-competitor-review-prompts'
import { PDP_MODEL_ROUTES } from '@/lib/registration/pdp-model-routes'

const REVIEWS: CompetitorReviews = {
  version: 1,
  fileName: 'c.xlsx',
  stats: { total_rows: 40, text_review_count: 4, rating_counts: { '5': 30, '2': 10 } },
  dropped: 0,
  // 무선은 한글 앞머리라 지우기만 하고 산출 검사에는 쓰지 않는다
  removedNames: ['라스', '라이프팁스', '무선'],
  checkNames: ['라스', '라이프팁스'],
  items: [
    { id: 1, rating: 2, helped: 3, title: '', body: '뚜껑을 세게 닫아도 국물이 조금씩 새어 나와요.' },
    { id: 2, rating: 2, helped: 0, title: '', body: '세척할 때 고무 패킹 빼기가 너무 어려워요.' },
    { id: 3, rating: 5, helped: 1, title: '', body: '튼튼한데 뚜껑이 조금 헐거워요.' },
    { id: 4, rating: 5, helped: 0, title: '', body: '디자인 예쁘고 가벼워요.' },
  ],
}

beforeEach(() => {
  llm.calls = []
})

describe('summarizeCompetitorPainPoints', () => {
  it('있는 리뷰 번호만 세어 빈도·비율을 만들고 많은 순으로 놓는다', () => {
    const { summary, dropped } = summarizeCompetitorPainPoints(
      [
        { type: '패킹 분리 세척이 번거로움', review_ids: [2, 2, 99], benefit_direction: '분리 세척이 쉬운 구조' },
        { type: '뚜껑 밀폐가 약함', review_ids: [1, 3], benefit_direction: '새지 않는 밀폐' },
      ],
      REVIEWS
    )
    expect(dropped).toBe(0)
    expect(summary).toEqual({
      version: 1,
      sample_size: 4,
      total_rows: 40,
      items: [
        { type: '뚜껑 밀폐가 약함', count: 2, share: 0.5, benefit_direction: '새지 않는 밀폐' },
        { type: '패킹 분리 세척이 번거로움', count: 1, share: 0.25, benefit_direction: '분리 세척이 쉬운 구조' },
      ],
    })
  })

  it('번호가 없거나, 리뷰 문장을 15자 넘게 옮겼거나, 판매자명·상품명이 든 항목은 버린다', () => {
    const { summary, dropped } = summarizeCompetitorPainPoints(
      [
        { type: '무게', review_ids: [] },
        {
          type: '국물이 조금씩 새어 나와요',
          review_ids: [1],
          benefit_direction: '세게 닫아도 국물이 조금씩 새어 나와요',
        },
        { type: '라스 뚜껑 불량', review_ids: [1] },
        { type: '뚜껑 헐거움', review_ids: [3], benefit_direction: '라이프팁스보다 단단한 잠금' },
        // 두 글자 이름은 일반어 속 부분 문자열로는 걸리지 않는다
        { type: '플라스틱 냄새', review_ids: [4], benefit_direction: '냄새 없는 소재' },
        // 지우기 전용 이름(한글 앞머리)은 산출 검사에 쓰지 않는다
        { type: '무선 연결 끊김', review_ids: [2], benefit_direction: '안정적인 연결' },
        'not-an-object',
        { type: '뚜껑 밀폐가 약함', review_ids: [1], benefit_direction: '새지 않는 밀폐' },
      ],
      REVIEWS
    )
    expect(dropped).toBe(5)
    expect(summary.items.map((p) => p.type)).toEqual(['플라스틱 냄새', '무선 연결 끊김', '뚜껑 밀폐가 약함'])
  })
})

describe('runCompetitorReviewAnalysis', () => {
  it('고정 라우트로 한 콜 — 원문은 경계 안에, 옵션·판매자 없이 번호로 들어간다', async () => {
    llm.reply = JSON.stringify({
      pain_points: [{ type: '뚜껑 밀폐가 약함', review_ids: [1, 3], benefit_direction: '새지 않는 밀폐' }],
    })
    const out = await runCompetitorReviewAnalysis({ reviews: REVIEWS, runContext: { stage: 'analysis' } })
    expect(out.success).toBe(true)
    expect(llm.calls).toHaveLength(1)
    const { route, request } = llm.calls[0]
    expect(route).toBe(PDP_MODEL_ROUTES['analysis/competitor-reviews'])
    expect(request.agentName).toBe('registration/pdp-competitor-reviews')
    const user = (request.messages as Array<{ content: string }>)[0].content
    expect(user).toContain('[경쟁 상품 리뷰 데이터 시작')
    expect(user).toContain('[리뷰1] 평점 2/5 · 도움 3\n내용: 뚜껑을 세게 닫아도 국물이 조금씩 새어 나와요.')
    expect(user).toContain('상품명·브랜드명·판매자명')
  })

  it('파싱 실패는 실패로 돌려준다(파이프라인이 경고로 바꾼다)', async () => {
    llm.reply = '{"oops": 1}'
    const out = await runCompetitorReviewAnalysis({ reviews: REVIEWS })
    expect(out.success).toBe(false)
  })
})

describe('buildCompetitorPainBlock', () => {
  it('요약이 없거나 항목이 0이면 undefined, 있으면 순위·유형과 사용 범위 지시만 담는다(빈도 숫자·리뷰 원문 없음)', () => {
    expect(buildCompetitorPainBlock(undefined)).toBeUndefined()
    expect(buildCompetitorPainBlock({ version: 1, sample_size: 4, total_rows: 40, items: [] })).toBeUndefined()
    const block = buildCompetitorPainBlock({
      version: 1,
      sample_size: 4,
      total_rows: 40,
      items: [{ type: '뚜껑 밀폐가 약함', count: 2, share: 0.5, benefit_direction: '새지 않는 밀폐' }],
    })!
    expect(block).toContain('1. 뚜껑 밀폐가 약함 · 효용 방향: 새지 않는 밀폐')
    expect(block).not.toMatch(/2건|50%|표집/)
    expect(block).toContain('순서·빈도를 수치나 비율로 쓰지 마세요')
    expect(block).toContain('usp_mapping과 planning_skeleton에만')
    expect(block).toContain("'타사 대비'")
    expect(block).toContain("'기존 제품'으로만")
    expect(block).not.toContain('기존 제품과 달리')
    expect(block).not.toContain('국물이 조금씩')
  })
})
