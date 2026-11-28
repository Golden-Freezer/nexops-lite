/**
 * 카피 Stage 2 구독 백엔드(pdp-llm-subscription-backend) — NEXOPS_PDP_LLM_BACKEND=subscription이면 Stage 2(GPT)는 코덱스 구독
 * 백엔드로만 간다(OpenAI API 안 부름). 백엔드 미등록·한도 소진은 Stage 1 결과로 넘어가지 않고 LlmSoftStopError로 단계를 멈춘다
 * (API 실패는 지금처럼 Stage 1 유지). Claude 단계는 API 그대로. 공급자·백엔드는 모의(유료 호출·구독 사용 0).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from '@/lib/registration/pdp-state'

const h = vi.hoisted(() => ({ job: null as unknown as PdpJobRow, claudeAgents: [] as string[] }))

vi.mock('../_base', () => ({
  callAgent: async (options: Record<string, unknown>, parser: (t: string) => unknown) => {
    h.claudeAgents.push(String(options.agentName))
    const copy = h.job.copy_sections.final as unknown as Record<string, unknown>
    const text = options.agentName === 'registration/pdp-copy-retry-pointcards' ? '[]' : JSON.stringify(copy)
    return { success: true, data: parser(text), usage: { inputTokens: 0, outputTokens: 0, cost: 0.01 }, duration: 0 }
  },
}))
vi.mock('../openai-chat', () => ({ callOpenAiChat: vi.fn() }))
vi.mock('../budget', async (orig) => ({
  ...(await orig<typeof import('../budget')>()),
  logUsage: vi.fn(async () => true),
}))

import { callOpenAiChat } from '../openai-chat'
import {
  clearLocalLlmBackends,
  LlmSoftStopError,
  noteLocalLlmSoftStop,
  peekLocalLlmSoftStop,
  registerLocalLlmBackend,
  type LocalLlmBackend,
} from '../llm/local-llm-backend'
import { fixtureToJob, loadEnrichmentFixture } from '@/lib/registration/__golden__/golden-harness'
import { runPdpCopywriting } from './pdp-copy-agent'

const savedEnv = { backend: process.env.NEXOPS_PDP_LLM_BACKEND, vercel: process.env.VERCEL }

beforeAll(() => {
  h.job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
})
beforeEach(() => {
  process.env.NEXOPS_PDP_LLM_BACKEND = 'subscription'
  delete process.env.VERCEL
  h.claudeAgents = []
  clearLocalLlmBackends()
  vi.mocked(callOpenAiChat).mockReset()
})
afterEach(() => {
  clearLocalLlmBackends()
  if (savedEnv.backend === undefined) delete process.env.NEXOPS_PDP_LLM_BACKEND
  else process.env.NEXOPS_PDP_LLM_BACKEND = savedEnv.backend
  if (savedEnv.vercel !== undefined) process.env.VERCEL = savedEnv.vercel
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

describe('카피 Stage 2 — 코덱스 구독 백엔드', () => {
  it('등록 백엔드로 Stage 2를 부르고(gpt-6.1-sol, effort medium) OpenAI API는 부르지 않는다 — Claude 단계는 그대로', async () => {
    const stage2 = JSON.stringify(h.job.copy_sections.final)
    const backend = vi.fn<LocalLlmBackend>(async () => ({
      text: stage2,
      usage: { inputTokens: 900, outputTokens: 400 },
    }))
    registerLocalLlmBackend('codex-cli', backend)
    const result = await run()
    expect(result.success).toBe(true)
    expect(backend).toHaveBeenCalledTimes(1)
    expect(backend.mock.calls[0][0]).toMatchObject({
      model: 'gpt-6.1-sol',
      effort: 'medium',
      agentName: 'registration/pdp-copy-stage2',
    })
    // 구독 경로는 API 시간 제한·재시도를 싣지 않는다(코덱스 백엔드 기본값)
    expect(backend.mock.calls[0][0]).not.toHaveProperty('timeoutMs')
    expect(callOpenAiChat).not.toHaveBeenCalled()
    expect(h.claudeAgents).toEqual(
      expect.arrayContaining(['registration/pdp-copy-stage1', 'registration/pdp-copy-stage3'])
    )
  })

  it('백엔드 미등록이면 유료 Stage 1도 부르기 전에 LlmSoftStopError로 멈춘다(API로 넘어가지 않는다 — 재개 때 Stage 1 이중 과금 방지)', async () => {
    const error = await run().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmSoftStopError)
    expect(peekLocalLlmSoftStop()?.reason).toBe('unavailable')
    expect(callOpenAiChat).not.toHaveBeenCalled()
    expect(h.claudeAgents).toEqual([])
  })

  it('소프트 종료 기록이 남아 있으면 등록돼 있어도 Stage 1 전에 멈춘다', async () => {
    const backend = vi.fn<LocalLlmBackend>()
    registerLocalLlmBackend('codex-cli', backend)
    noteLocalLlmSoftStop({ backend: 'codex-cli', reason: 'quota', message: '한도', at: 'x' })
    await expect(run()).rejects.toBeInstanceOf(LlmSoftStopError)
    expect(h.claudeAgents).toEqual([])
    expect(backend).not.toHaveBeenCalled()
  })

  it('premium 모드는 Stage 2가 없어 구독 사전 점검을 하지 않는다(백엔드 미등록이어도 그대로 돈다)', async () => {
    const result = await runPdpCopywriting({
      specSheet: h.job.spec_sheet,
      mode: 'premium',
      analysis: h.job.analysis,
      research: h.job.research_result,
      sectionPlan: h.job.section_plan,
      strategyContract: {},
      runContext: { userId: 'user-1', stage: 'copywriting' },
    })
    expect(result.success).toBe(true)
    expect(peekLocalLlmSoftStop()).toBeNull()
    expect(h.claudeAgents).toContain('registration/pdp-copy-premium')
  })

  it('API 백엔드(env 없음)면 사전 점검 없이 지금처럼 Stage 1부터 돈다', async () => {
    delete process.env.NEXOPS_PDP_LLM_BACKEND
    vi.mocked(callOpenAiChat).mockResolvedValue({
      success: true,
      data: h.job.copy_sections.final,
      usage: { inputTokens: 0, outputTokens: 0, cost: 0.01 },
      duration: 0,
    } as never)
    const result = await run()
    expect(result.success).toBe(true)
    expect(callOpenAiChat).toHaveBeenCalledTimes(1)
    expect(h.claudeAgents).toContain('registration/pdp-copy-stage1')
    // 기본 표(pdp-model-refresh) — gpt-6.1-sol API, effort medium, 상한 16000, 시간 제한 120초·재시도 1회
    expect(vi.mocked(callOpenAiChat).mock.calls[0][0]).toMatchObject({
      model: 'gpt-6.1-sol',
      maxTokens: 16000,
      reasoningEffort: 'medium',
      timeoutMs: 120_000,
      maxRetries: 1,
      agentName: 'registration/pdp-copy-stage2',
    })
  })

  it('구독 한도 소진도 Stage 1 결과로 넘어가지 않고 멈춘다', async () => {
    registerLocalLlmBackend('codex-cli', async () => {
      throw Object.assign(new Error('usage limit'), { softStop: true, softStopReason: 'quota' })
    })
    await expect(run()).rejects.toBeInstanceOf(LlmSoftStopError)
    expect(peekLocalLlmSoftStop()?.reason).toBe('quota')
  })
})
