/**
 * 카테고리 판정 기록(결정 카드 c11, 하네스 J22) — 감지 답의 확신값·근거를 버리지 않고 analysis.category_check로 남기는지, 목록 밖이어도
 * 다시 판정하지 않는지(가정 C3), 판매자 지정·감지 실패도 출처를 남기는지. LLM은 모의(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  categoryReply: '' as string,
  categoryFails: false,
  agents: [] as string[],
}))

const ZERO = { inputTokens: 0, outputTokens: 0, cost: 0 }

vi.mock('../llm', () => ({
  callLlm: vi.fn(async (_route: unknown, options: { agentName: string }, parser: (text: string) => unknown) => {
    h.agents.push(options.agentName)
    if (options.agentName === 'registration/pdp-category') {
      if (h.categoryFails) return { success: false, error: { message: '시간 초과' }, usage: ZERO, duration: 0 }
      return { success: true, data: parser(h.categoryReply), usage: ZERO, duration: 0 }
    }
    return { success: true, data: parser(JSON.stringify({ keywords: ['k'], usp_candidates: ['u'] })), usage: ZERO, duration: 0 }
  }),
}))

import { categoryCheckOf, parseCategoryResponse, runPdpAnalysis } from './pdp-analysis-agent'
import type { PdpSpecSheet } from '@/lib/registration/pdp-state'

const spec = (extra: Partial<PdpSpecSheet> = {}) => ({ productName: '강아지 밥그릇', ...extra }) as PdpSpecSheet

beforeEach(() => {
  h.categoryReply = ''
  h.categoryFails = false
  h.agents = []
})

describe('parseCategoryResponse — confidence·reasoning을 돌려준다', () => {
  it('범위 안의 값과 근거를 그대로 받는다', () => {
    expect(parseCategoryResponse('{"category":" pet ","confidence":0.92,"reasoning":" 반려동물 식기 "}')).toEqual({
      category: 'pet',
      confidence: 0.92,
      reasoning: '반려동물 식기',
    })
  })

  it('confidence가 없거나 범위 밖·글이면 null로 둔다(고쳐 넣지 않는다) — category만 있으면 콜은 성공이다', () => {
    expect(parseCategoryResponse('{"category":"pet"}')).toEqual({ category: 'pet', confidence: null, reasoning: null })
    expect(parseCategoryResponse('{"category":"pet","confidence":95}').confidence).toBeNull()
    expect(parseCategoryResponse('{"category":"pet","confidence":-0.1}').confidence).toBeNull()
    expect(parseCategoryResponse('{"category":"pet","confidence":"0.9"}').confidence).toBeNull()
    expect(parseCategoryResponse('{"category":"pet","confidence":0}').confidence).toBe(0)
    expect(parseCategoryResponse('{"category":"pet","confidence":1}').confidence).toBe(1)
    expect(parseCategoryResponse('{"category":"pet","reasoning":"   "}').reasoning).toBeNull()
    expect(parseCategoryResponse('{"category":"pet","reasoning":3}').reasoning).toBeNull()
  })

  it('근거 글은 500자에서 자른다', () => {
    const long = 'ㄱ'.repeat(800)
    expect(parseCategoryResponse(JSON.stringify({ category: 'pet', reasoning: long })).reasoning).toHaveLength(500)
  })

  it('category가 없으면 지금처럼 형식 오류로 던진다', () => {
    expect(() => parseCategoryResponse('{"confidence":0.9}')).toThrow('카테고리 감지 응답 형식')
  })
})

describe('categoryCheckOf — 목록 대조', () => {
  it('성격 표(CATEGORY_TO_ESSENCE) 키면 inList, 밖이면 false — 상속 키(toString 등)는 밖이다', () => {
    expect(categoryCheckOf('llm', 'pet').inList).toBe(true)
    expect(categoryCheckOf('llm', 'toys').inList).toBe(false)
    expect(categoryCheckOf('spec', '생활용품').inList).toBe(false)
    expect(categoryCheckOf('llm', 'toString').inList).toBe(false)
  })
})

describe('runPdpAnalysis — analysis.category_check 기록', () => {
  it('감지 콜이 준 확신값·근거를 남긴다', async () => {
    h.categoryReply = '{"category":"pet","confidence":0.88,"reasoning":"반려동물 식기"}'
    const out = await runPdpAnalysis({ specSheet: spec(), reviewsSummary: '리뷰 데이터 없음' })
    expect(out.success).toBe(true)
    if (!out.success) return
    expect(out.data.analysis.category_check).toEqual({ source: 'llm', category: 'pet', confidence: 0.88, reasoning: '반려동물 식기', inList: true })
    expect(out.data.essenceType).toBe('emotional')
  })

  it('목록 밖 카테고리는 기록만 하고 다시 판정하지 않는다 — 콜은 그대로 둘, 성격은 지금처럼 convenience', async () => {
    h.categoryReply = '{"category":"toys","confidence":0.4,"reasoning":"장난감"}'
    const out = await runPdpAnalysis({ specSheet: spec(), reviewsSummary: '리뷰 데이터 없음' })
    if (!out.success) throw new Error('분석 실패')
    expect(h.agents).toEqual(['registration/pdp-category', 'registration/pdp-analysis'])
    expect(out.data.analysis.detected_category).toBe('toys')
    expect(out.data.analysis.category_check).toMatchObject({ source: 'llm', category: 'toys', inList: false })
    expect(out.data.essenceType).toBe('convenience')
  })

  it('판매자가 정한 카테고리는 콜 없이 spec 출처로 남긴다(확신값·근거 null)', async () => {
    const out = await runPdpAnalysis({ specSheet: spec({ category: 'household' }), reviewsSummary: '리뷰 데이터 없음' })
    if (!out.success) throw new Error('분석 실패')
    expect(h.agents).toEqual(['registration/pdp-analysis'])
    expect(out.data.analysis.category_check).toEqual({ source: 'spec', category: 'household', confidence: null, reasoning: null, inList: true })
  })

  it('감지가 실패하면 household 기본값을 fallback 출처로 남긴다', async () => {
    h.categoryFails = true
    const out = await runPdpAnalysis({ specSheet: spec(), reviewsSummary: '리뷰 데이터 없음' })
    if (!out.success) throw new Error('분석 실패')
    expect(out.data.analysis.category_check).toEqual({ source: 'fallback', category: 'household', confidence: null, reasoning: null, inList: true })
    expect(out.data.warnings.some((w) => w.includes('카테고리 자동 감지 실패'))).toBe(true)
  })
})
