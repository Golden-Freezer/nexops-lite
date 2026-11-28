/**
 * 카피 2단·3단 콜 시간(J34, 통합 decide 18) — 에이전트는 route.callTimeoutMs가 있으면 그 값, 없으면 지금 값(2단 120초·3단 120초)을 쓴다.
 * 새 배치 원문 카피 3단(Gemini argon)만 2단·3단 150초(c21 실측 최대 2단 110.8초). 재시도 수·run 기한은 그대로이고, 남은 기한이 콜 시간보다
 * 짧으면 공급자가 시도 시간을 남은 시간으로 줄인다(attemptTimeoutWithin — providers/gemini·anthropic·openai 공통). callLlm은 모의(유료 호출 0).
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmRequest, LlmRoute } from '../llm/types'
import type { PdpJobRow } from '@/lib/registration/pdp-state'

const h = vi.hoisted(() => ({
  job: null as unknown as PdpJobRow,
  calls: [] as Array<{ route: LlmRoute; request: LlmRequest }>,
}))

vi.mock('../llm', () => ({
  callLlm: async (route: LlmRoute, request: LlmRequest, parser: (t: string) => unknown) => {
    h.calls.push({ route, request })
    const copy = h.job.copy_sections.final as unknown as Record<string, unknown>
    const text = request.agentName === 'registration/pdp-copy-retry-pointcards' ? '[]' : JSON.stringify(copy)
    return { success: true, data: parser(text), usage: { inputTokens: 100, outputTokens: 40, cost: 0.01 }, duration: 0 }
  },
}))

import { fixtureToJob, loadEnrichmentFixture } from '@/lib/registration/__golden__/golden-harness'
import { runWithPdpBatch } from '@/lib/registration/pdp-model-batch-context'
import { attemptTimeoutWithin } from '../deadline'
import { runPdpCopywriting } from './pdp-copy-agent'

beforeAll(() => {
  h.job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
})
beforeEach(() => {
  h.calls = []
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

const requestOf = (agent: string) => {
  const call = h.calls.find((c) => c.request.agentName === agent)
  expect(call, agent).toBeDefined()
  return call!
}

describe('카피 2단·3단 콜 시간 — route가 주면 그 값, 없으면 지금 값', () => {
  it('지금 배치는 2단 120초·3단 120초 그대로(route에 콜 시간이 없다)', async () => {
    await run()
    const stage2 = requestOf('registration/pdp-copy-stage2')
    const stage3 = requestOf('registration/pdp-copy-stage3')
    expect(stage2.route).not.toHaveProperty('callTimeoutMs')
    expect(stage3.route).not.toHaveProperty('callTimeoutMs')
    expect(stage2.request).toMatchObject({ timeoutMs: 120_000, maxRetries: 1 })
    expect(stage3.request.timeoutMs).toBe(120_000)
    expect(stage3.request).not.toHaveProperty('maxRetries')
  })

  it('새 배치는 Gemini argon 2단·3단 150초 — 재시도 수는 그대로, 1단은 165초', async () => {
    await runWithPdpBatch('new', () => run())
    const stage1 = requestOf('registration/pdp-copy-stage1')
    const stage2 = requestOf('registration/pdp-copy-stage2')
    const stage3 = requestOf('registration/pdp-copy-stage3')
    for (const call of [stage1, stage2, stage3]) expect(call.route.model).toBe('gemini-4-argon')
    expect(stage1.request).toMatchObject({ timeoutMs: 165_000, maxRetries: 1 })
    expect(stage2.request).toMatchObject({ timeoutMs: 150_000, maxRetries: 1 })
    expect(stage3.request.timeoutMs).toBe(150_000)
    expect(stage3.request).not.toHaveProperty('maxRetries')
  })

  it('남은 run 기한이 150초보다 짧으면 시도 시간이 남은 시간으로 줄고, 길면 150초 그대로', async () => {
    const now = 1_000_000
    const deadlineAt = now + 100_000
    await runWithPdpBatch('new', () => run(deadlineAt))
    for (const agent of ['registration/pdp-copy-stage2', 'registration/pdp-copy-stage3']) {
      const { request } = requestOf(agent)
      expect(request.deadlineAt, agent).toBe(deadlineAt)
      expect(attemptTimeoutWithin(request.deadlineAt, request.timeoutMs!, now), agent).toBe(100_000)
      expect(attemptTimeoutWithin(request.deadlineAt, request.timeoutMs!, now - 200_000), agent).toBe(150_000)
    }
  })
})
