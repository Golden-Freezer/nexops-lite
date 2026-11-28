/**
 * 라이트 카피 경로 — 구독/API backend 표지는 호환 메타데이터일 뿐 실행을 나누지 않는다.
 * 모든 단계가 callAgent(로컬 Codex) 한 경로로 가며 원격 API나 로컬 백엔드 등록을 요구하지 않는다.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from '@/lib/registration/pdp-state'

const h = vi.hoisted(() => ({
  job: null as unknown as PdpJobRow,
  calls: [] as Array<Record<string, unknown>>,
}))

vi.mock('../_base', () => ({
  callAgent: async (options: Record<string, unknown>, parser: (text: string) => unknown) => {
    h.calls.push(options)
    const copy = h.job.copy_sections.final as unknown as Record<string, unknown>
    const text = options.agentName === 'registration/pdp-copy-retry-pointcards' ? '[]' : JSON.stringify(copy)
    return { success: true, data: parser(text), usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, duration: 0 }
  },
}))
vi.mock('../openai-chat', () => ({ callOpenAiChat: vi.fn(() => { throw new Error('원격 OpenAI 경로를 부르면 안 됩니다.') }) }))

import { fixtureToJob, loadEnrichmentFixture } from '@/lib/registration/__golden__/golden-harness'
import { runPdpCopywriting } from './pdp-copy-agent'

beforeAll(() => {
  h.job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
})
beforeEach(() => {
  h.calls = []
})
afterEach(() => {
  vi.unstubAllEnvs()
})

const run = () =>
  runPdpCopywriting({
    specSheet: h.job.spec_sheet,
    mode: 'pro',
    analysis: h.job.analysis,
    research: h.job.research_result,
    sectionPlan: h.job.section_plan,
    strategyContract: {},
    runContext: { userId: 'user-1', stage: 'copywriting' },
  })

describe('카피 Stage 2 — 라이트 Codex 단일 경로', () => {
  it.each([undefined, 'api', 'subscription'])('backend env %s와 무관하게 Stage 1·2·3을 callAgent로 부른다', async (backend) => {
    vi.stubEnv('NEXOPS_PDP_LLM_BACKEND', backend ?? '')
    const result = await run()
    expect(result.success).toBe(true)
    const agents = h.calls.map((call) => call.agentName)
    expect(agents).toEqual(expect.arrayContaining([
      'registration/pdp-copy-stage1',
      'registration/pdp-copy-stage2',
      'registration/pdp-copy-stage3',
    ]))
    const stage2 = h.calls.find((call) => call.agentName === 'registration/pdp-copy-stage2')!
    expect(stage2).toMatchObject({
      config: { model: 'gpt-6.1-sol', maxTokens: 16000, effort: 'medium' },
    })
  })

  it('호출 기록은 0토큰·0원이고 구독 백엔드 등록·소프트 종료 분기를 요구하지 않는다', async () => {
    vi.stubEnv('NEXOPS_PDP_LLM_BACKEND', 'subscription')
    const result = await run()
    expect(result.success).toBe(true)
    expect(result.usage).toMatchObject({ inputTokens: 0, outputTokens: 0, cost: 0 })
    expect(h.calls.every((call) => !('backend' in call) && !('subscriptionFallback' in call))).toBe(true)
  })
})
