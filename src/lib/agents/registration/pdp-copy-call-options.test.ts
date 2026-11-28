/**
 * 카피 에이전트 단계 재현 선택 call{routes·onCall}(하네스 J37 — 원문 카피 3사 후보) — 없으면 단계 표(pdpRoute) 그대로, routes가 있으면 그 단계만
 * 바꾸고, onCall은 콜마다 단계 이름과 흔적을 받는다. callLlm은 모의(유료 호출 0).
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmRoute } from '../llm/types'
import type { PdpJobRow } from '@/lib/registration/pdp-state'

const h = vi.hoisted(() => ({
  job: null as unknown as PdpJobRow,
  calls: [] as Array<{ route: LlmRoute; agentName: unknown }>,
  failStage: '' as string,
}))

vi.mock('../llm', () => ({
  callLlm: async (route: LlmRoute, request: { agentName?: string }, parser: (t: string) => unknown) => {
    h.calls.push({ route, agentName: request.agentName })
    if (request.agentName === h.failStage) {
      return {
        success: false,
        error: { message: '잘림', stage: 'parse', attempts: 1, stopReason: 'max_tokens' },
        usage: { inputTokens: 10, outputTokens: 99, cost: 0.02 },
        duration: 0,
      }
    }
    const copy = h.job.copy_sections.final as unknown as Record<string, unknown>
    // pointCards를 비워 보충 콜(retry-pointcards)까지 부르게 한다
    const text = request.agentName === 'registration/pdp-copy-retry-pointcards' ? '[]' : JSON.stringify({ ...copy, pointCards: [] })
    return { success: true, data: parser(text), usage: { inputTokens: 100, outputTokens: 40, cost: 0.01 }, duration: 0 }
  },
}))

import { fixtureToJob, loadEnrichmentFixture } from '@/lib/registration/__golden__/golden-harness'
import { pdpRoute } from '@/lib/registration/pdp-model-routes'
import { runPdpCopywriting, type CopyCallOptions, type CopyCallStage } from './pdp-copy-agent'

beforeAll(() => {
  h.job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
})
beforeEach(() => {
  delete process.env.NEXOPS_PDP_LLM_BACKEND
  delete process.env.NEXOPS_PDP_MODEL_ARM
  h.calls = []
  h.failStage = ''
})

const run = (call?: CopyCallOptions) =>
  runPdpCopywriting({
    specSheet: h.job.spec_sheet,
    mode: 'pro',
    analysis: h.job.analysis,
    research: h.job.research_result,
    sectionPlan: h.job.section_plan,
    strategyContract: {},
    runContext: { userId: 'user-1', stage: 'copywriting' },
    ...(call ? { call } : {}),
  })

const STAGES: CopyCallStage[] = ['copy/structural', 'copy/stage2', 'copy/stage3', 'copy/retry-pointcards']
const ARGON = (maxTokens: number): LlmRoute => ({ model: 'gemini-4-argon', maxTokens, effort: 'low' })

describe('runPdpCopywriting — 단계 재현 선택 call', () => {
  it('선택이 없으면 네 콜 모두 단계 표(pdpRoute) 그대로다', async () => {
    const result = await run()
    expect(result.success).toBe(true)
    expect(h.calls.map((c) => c.route)).toEqual(STAGES.map((stage) => pdpRoute(stage)))
  })

  it('routes가 있는 단계만 바꾸고(점 카드 다시 받기는 단계 표 그대로), onCall은 콜마다 단계 이름과 흔적을 받는다', async () => {
    const traces: Array<{ stage: CopyCallStage; outputTokens: number; costUsd: number; success: boolean }> = []
    const routes = { 'copy/structural': ARGON(16_000), 'copy/stage2': ARGON(16_001), 'copy/stage3': ARGON(8_000) }
    await run({ routes, onCall: (stage, trace) => traces.push({ stage, ...trace }) })
    expect(h.calls.map((c) => c.route)).toEqual([routes['copy/structural'], routes['copy/stage2'], routes['copy/stage3'], pdpRoute('copy/retry-pointcards')])
    expect(traces.map((t) => t.stage)).toEqual(STAGES)
    expect(traces.every((t) => t.success && t.outputTokens === 40 && t.costUsd === 0.01)).toBe(true)
  })

  it('실패한 콜의 흔적에는 끝난 까닭·오류가 실린다(성공한 콜에는 없다)', async () => {
    h.failStage = 'registration/pdp-copy-stage2'
    const traces: Array<Record<string, unknown>> = []
    await run({ onCall: (stage, trace) => traces.push({ stage, ...trace }) })
    const failed = traces.find((t) => t.stage === 'copy/stage2')
    expect(failed).toMatchObject({ success: false, stopReason: 'max_tokens', error: '잘림', outputTokens: 99 })
    expect(traces.find((t) => t.stage === 'copy/structural')).not.toHaveProperty('stopReason')
  })
})
