/**
 * 카피 run 기한(pdp-cost-time-followup) — runPdpCopywriting에 deadlineAt을 주면 모든 콜(Stage 1·2·3·pointCards)에 싣고, 없으면 콜 인자에
 * 기한이 없다(지금 그대로). 공급자는 모의(유료 호출 0).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from '@/lib/registration/pdp-state'

const h = vi.hoisted(() => ({
  job: null as unknown as PdpJobRow,
  calls: [] as Array<Record<string, unknown>>,
  failStage1: false,
}))

const reply = (options: Record<string, unknown>, parser: (t: string) => unknown) => {
  h.calls.push(options)
  if (h.failStage1 && options.agentName === 'registration/pdp-copy-stage1') {
    return {
      success: false,
      error: { message: '시간 초과', stage: 'timeout', attempts: 3 },
      usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
      duration: 0,
    }
  }
  const copy = h.job.copy_sections.final as unknown as Record<string, unknown>
  // pointCards를 비워 보충 콜(retry-pointcards)까지 부르게 한다
  const text =
    options.agentName === 'registration/pdp-copy-retry-pointcards' ? '[]' : JSON.stringify({ ...copy, pointCards: [] })
  return { success: true, data: parser(text), usage: { inputTokens: 0, outputTokens: 0, cost: 0.01 }, duration: 0 }
}
vi.mock('../_base', () => ({ callAgent: async (o: Record<string, unknown>, p: (t: string) => unknown) => reply(o, p) }))
vi.mock('../openai-chat', () => ({
  callOpenAiChat: async (o: Record<string, unknown>, p: (t: string) => unknown) => reply(o, p),
}))

import { fixtureToJob, loadEnrichmentFixture } from '@/lib/registration/__golden__/golden-harness'
import { runPdpCopywriting } from './pdp-copy-agent'

const savedBackend = process.env.NEXOPS_PDP_LLM_BACKEND

beforeAll(() => {
  h.job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
})
beforeEach(() => {
  delete process.env.NEXOPS_PDP_LLM_BACKEND
  h.calls = []
  h.failStage1 = false
})
afterEach(() => {
  if (savedBackend !== undefined) process.env.NEXOPS_PDP_LLM_BACKEND = savedBackend
})

const run = (deadlineAt?: number) =>
  runPdpCopywriting({
    specSheet: h.job.spec_sheet,
    mode: 'pro',
    analysis: h.job.analysis,
    research: h.job.research_result,
    sectionPlan: h.job.section_plan,
    strategyContract: {},
    runContext: { userId: 'user-1', stage: 'copywriting' },
    ...(deadlineAt !== undefined ? { deadlineAt } : {}),
  })

describe('runPdpCopywriting — run 기한', () => {
  it('기한을 주면 Stage 1·2·3·pointCards 콜 모두에 싣는다', async () => {
    const result = await run(1_234_567)
    expect(result.success).toBe(true)
    expect(h.calls.map((c) => c.agentName)).toEqual([
      'registration/pdp-copy-stage1',
      'registration/pdp-copy-stage2',
      'registration/pdp-copy-stage3',
      'registration/pdp-copy-retry-pointcards',
    ])
    for (const c of h.calls) expect(c.deadlineAt, String(c.agentName)).toBe(1_234_567)
  })

  it('카피 생성(Stage 1)이 실패해 기본 카피로 폴백하면 결과에 stage1FellBack을 표시하고, 성공하면 표시가 없다', async () => {
    h.failStage1 = true
    const fellBack = await run()
    expect(fellBack.success && fellBack.data.stage1FellBack).toBe(true)
    h.failStage1 = false
    const ok = await run()
    expect(ok.success && ok.data).not.toHaveProperty('stage1FellBack')
  })

  it('기한이 없으면 어느 콜에도 싣지 않는다(지금 그대로)', async () => {
    await run()
    expect(h.calls).toHaveLength(4)
    for (const c of h.calls) expect(c, String(c.agentName)).not.toHaveProperty('deadlineAt')
  })
})
