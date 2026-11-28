import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentOutput } from '../types'

const calls: { maxTokens: number; maxRetries: number | undefined; timeoutMs?: number }[] = []
let script: AgentOutput<string>[] = []

vi.mock('../_base', () => ({
  callAgent: async (options: { config: { maxTokens: number }; maxRetries?: number; timeoutMs?: number }) => {
    calls.push({ maxTokens: options.config.maxTokens, maxRetries: options.maxRetries, timeoutMs: options.timeoutMs })
    const next = script.shift()
    if (!next) throw new Error('스크립트 소진')
    return next
  },
}))

const { callAgentWithTokenSteps, callLlmWithTokenSteps, API_RETRIES } = await import('./token-steps')
const { RESEARCH_MAX_TOKENS_STEPS } = await import('./pdp-research-agent')
const { DESIGN_PROMPT_MAX_TOKENS_STEPS } = await import('./pdp-design-agent')

const usage = { inputTokens: 0, outputTokens: 0, cost: 0 }
const ok = (data: string): AgentOutput<string> => ({ success: true, data, usage, duration: 10 })
const fail = (stage: 'api' | 'timeout' | 'parse' | 'budget'): AgentOutput<string> => ({
  success: false,
  error: { message: stage, stage, attempts: 1 },
  usage,
  duration: 10,
})
const options = { config: { model: 'claude-sonnet-5' as const, maxTokens: 1, disableThinking: true }, system: 's', messages: [], agentName: 'test' }
const run = (steps: readonly number[], env: Record<string, string | undefined> = {}, extra: { timeoutMs?: number } = {}) =>
  callAgentWithTokenSteps({ ...options, ...extra }, (t) => t, steps, { retryDelayMs: 0, env })

beforeEach(() => {
  calls.length = 0
  script = []
})

describe('callAgentWithTokenSteps', () => {
  it('첫 상한에서 성공하면 한 번만 부른다(callAgent 자체 재시도는 끈다)', async () => {
    script = [ok('a')]
    const result = await run([100, 200])
    expect(result.success && result.data).toBe('a')
    expect(calls).toEqual([{ maxTokens: 100, maxRetries: 0, timeoutMs: undefined }])
  })

  it('파싱 실패는 같은 상한으로 되풀이하지 않고 다음 상한으로 한 번 올린다', async () => {
    script = [fail('parse'), ok('b')]
    const result = await run([100, 200])
    expect(result.success).toBe(true)
    expect(calls.map((c) => c.maxTokens)).toEqual([100, 200])
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  it('마지막 상한에서도 파싱에 실패하면 더 부르지 않고 실패를 돌려준다', async () => {
    script = [fail('parse'), fail('parse')]
    const result = await run([100, 200])
    expect(result.success).toBe(false)
    expect(!result.success && result.error.stage).toBe('parse')
    expect(calls.map((c) => c.maxTokens)).toEqual([100, 200])
  })

  it('마지막 단계가 아닐 때의 시간 초과는 승격한다(긴 응답은 잘리기 전에 시간 제한에 걸린다)', async () => {
    script = [fail('timeout'), ok('t')]
    expect((await run([100, 200])).success).toBe(true)
    expect(calls.map((c) => c.maxTokens)).toEqual([100, 200])
  })

  it('API 실패와 마지막 단계의 시간 초과는 같은 상한으로 최대 2회 다시 부른다', async () => {
    script = [fail('api'), fail('api'), ok('c')]
    expect((await run([100, 200])).success).toBe(true)
    expect(calls.map((c) => c.maxTokens)).toEqual([100, 100, 100])

    calls.length = 0
    script = [fail('timeout'), fail('timeout'), ok('c2')]
    expect((await run([100])).success).toBe(true)
    expect(calls.map((c) => c.maxTokens)).toEqual([100, 100, 100])

    calls.length = 0
    script = [fail('api'), fail('api'), fail('api')]
    const result = await run([100, 200])
    expect(result.success).toBe(false)
    expect(calls).toHaveLength(1 + API_RETRIES)
  })

  it('예산 차단은 다시 부르지 않는다', async () => {
    script = [fail('budget')]
    expect((await run([100, 200])).success).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('상한을 올리면 시간 제한도 같은 비율로 늘리고 25% 여유를 더한다', async () => {
    script = [fail('parse'), ok('d')]
    await run([12000, 16000], {}, { timeoutMs: 90_000 })
    expect(calls.map((c) => c.timeoutMs)).toEqual([90_000, 150_000])
  })

  it('Vercel에서는 승격하지 않는다(run 라우트 maxDuration 120초)', async () => {
    script = [fail('parse')]
    const result = await run([100, 200], { VERCEL: '1' })
    expect(result.success).toBe(false)
    expect(calls.map((c) => c.maxTokens)).toEqual([100])

    calls.length = 0
    script = [fail('api'), ok('e')]
    expect((await run([100, 200], { VERCEL_ENV: 'production' })).success).toBe(true)
    expect(calls.map((c) => c.maxTokens)).toEqual([100, 100])
  })

  it('상한 단계가 비면 거부한다', async () => {
    await expect(run([])).rejects.toThrow('출력 상한 단계')
  })
})

describe('callLlmWithTokenSteps — 모델 계층 라우트도 같은 승격 규칙(묶음 1)', () => {
  it('라우트 모델(Anthropic → callAgent)로 부르고, 파싱 실패 때 다음 상한·늘린 시간 제한으로 한 번 올린다', async () => {
    script = [fail('parse'), ok('b')]
    const route = { model: 'claude-sonnet-5', maxTokens: 100, disableThinking: true }
    const request = { system: 's', messages: [], agentName: 'test', timeoutMs: 1000 }
    const result = await callLlmWithTokenSteps(route, request, (t) => t, [100, 200], { retryDelayMs: 0, env: {} })
    expect(result.success && result.data).toBe('b')
    expect(calls).toEqual([
      { maxTokens: 100, maxRetries: 0, timeoutMs: 1000 },
      { maxTokens: 200, maxRetries: 0, timeoutMs: Math.round(1000 * 2 * 1.25) },
    ])
  })
})

describe('등록 에이전트 출력 상한(2026-10-27 실측 기준)', () => {
  // SDK는 스트리밍 없이 약 21,333토큰을 넘는 max_tokens 요청을 보내기 전에 거부한다(32000 실측 거부). 넘는 상한은 callAgent가
  // 스트리밍으로 부르지만(R02, _base.ts SDK_NON_STREAMING_MAX_TOKENS — base-stream.test.ts), 지금 단계는 비스트리밍 그대로(요청 불변)
  const SDK_NON_STREAMING_MAX = 21_333

  it.each([
    ['research', RESEARCH_MAX_TOKENS_STEPS, 4757],
    ['design-prompt', DESIGN_PROMPT_MAX_TOKENS_STEPS, 9192],
  ])('%s: 기본 상한이 실 응답 길이보다 넉넉하고, 단계는 오름차순이며 SDK 한도 안이다', (_name, steps, observed) => {
    expect(steps[0]).toBeGreaterThanOrEqual(Math.ceil(observed * 1.25))
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1])
    expect(steps[steps.length - 1]).toBeLessThanOrEqual(SDK_NON_STREAMING_MAX)
  })
})

describe('과금 합 — 실패·잘린 시도 값을 spent로(R12d)', () => {
  const billed = (cost: number) => ({ inputTokens: 100, outputTokens: 50, cost })
  /** callAgent(maxRetries 0)의 실패 — usage 0, 과금된 그 시도 값은 spent에만(R11b 계약) */
  const failBilled = (stage: 'api' | 'timeout' | 'parse', cost: number): AgentOutput<string> => ({
    success: false,
    error: { message: stage, stage, attempts: 1, ...(stage === 'parse' ? { stopReason: 'max_tokens' } : {}) },
    usage,
    duration: 10,
    ...(cost > 0 ? { spent: billed(cost) } : {}),
  })

  it('한 번에 성공하면 spent 칸이 없다(지금과 같은 모양)', async () => {
    script = [{ success: true, data: 'a', usage: billed(0.1), duration: 10 }]
    const result = await run([100, 200])
    expect(result).not.toHaveProperty('spent')
    expect(result.usage).toEqual(billed(0.1))
  })

  it('잘린 첫 시도 뒤 승격해 성공하면 spent = 모든 시도 합, usage는 마지막 시도 그대로', async () => {
    script = [failBilled('parse', 0.3886), { success: true, data: 'b', usage: billed(0.4), duration: 10 }]
    const result = await run([100, 200])
    expect(result.success).toBe(true)
    expect(result.usage).toEqual(billed(0.4))
    expect(result.spent).toEqual({ inputTokens: 200, outputTokens: 100, cost: expect.closeTo(0.7886, 10) })
  })

  it('끝내 실패해도 모든 시도 값을 spent로 — 승격·API 재시도 시도까지(과금 없는 API 실패는 0)', async () => {
    script = [failBilled('parse', 0.2), failBilled('api', 0), failBilled('api', 0), failBilled('timeout', 0.05)]
    const result = await run([100, 200])
    expect(result.success).toBe(false)
    expect(calls).toHaveLength(4)
    expect(result.usage).toEqual(usage)
    expect(result.spent).toEqual({ inputTokens: 200, outputTokens: 100, cost: expect.closeTo(0.25, 10) })
  })
})
