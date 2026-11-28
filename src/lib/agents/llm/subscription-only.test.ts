/**
 * 구독 전용 모드(J42 — 하네스만 켠다) — callLlm 진입에서 Claude·GPT route를 구독 CLI route로 바꾸고(조정 기록), API 공급자는 부르지 않는다.
 * 막히면(백엔드 미등록·소프트 종료) API로 잇지 않고 LlmSoftStopError. 모드가 꺼져 있으면 route·요청 그대로(운영 바이트 불변). 공급자는 모의.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  agent: vi.fn(),
  openai: vi.fn(),
  gemini: vi.fn(),
  logUsage: vi.fn(async () => true),
}))

vi.mock('../_base', () => ({ callAgent: (...a: unknown[]) => h.agent(...a) }))
vi.mock('../openai-chat', () => ({ callOpenAiChat: (...a: unknown[]) => h.openai(...a) }))
vi.mock('./providers/gemini', () => ({ callGemini: (...a: unknown[]) => h.gemini(...a) }))
vi.mock('../budget', () => ({ logUsage: h.logUsage, checkMonthlyBudget: async () => ({ allowed: true }) }))

import { callLlm } from '.'
import { clearLocalLlmBackends, registerLocalLlmBackend, type LocalLlmRequest } from './local-llm-backend'
import {
  agentConfigRoute,
  assertNoOpenAiApiInSubscriptionOnly,
  enableSubscriptionOnly,
  isSubscriptionOnly,
  SUBSCRIPTION_ONLY_MIN_TIMEOUT_MS,
  SUBSCRIPTION_ONLY_THINKING_HEADROOM_TOKENS,
  subscriptionOnlyAdjustments,
  subscriptionOnlyRoute,
} from './subscription-only'
import type { LlmRoute } from './types'
import { pdpRoute } from '@/lib/registration/pdp-model-routes'

const OK = { success: true, data: 'api', usage: { inputTokens: 1, outputTokens: 1, cost: 0.001 }, duration: 1 }
const REQ = { system: 's', messages: [{ role: 'user' as const, content: 'u' }], agentName: 'test/sub-only' }

let disable: (() => void) | null = null
const seen: Array<{ backend: string; request: LocalLlmRequest }> = []

beforeEach(() => {
  h.agent.mockReset().mockResolvedValue(OK)
  h.openai.mockReset().mockResolvedValue(OK)
  h.gemini.mockReset().mockResolvedValue(OK)
  h.logUsage.mockClear()
  seen.length = 0
  clearLocalLlmBackends()
})

afterEach(() => {
  disable?.()
  disable = null
  clearLocalLlmBackends()
})

const registerFakes = () => {
  for (const backend of ['claude-cli', 'codex-cli'] as const) {
    registerLocalLlmBackend(backend, async (request) => {
      seen.push({ backend, request })
      return { text: 'cli', usage: { inputTokens: 10, outputTokens: 5 } }
    })
  }
}

describe('subscriptionOnlyRoute — 같은 모델·상한·등급, CLI가 못 지키는 칸은 빼고 기록(순수)', () => {
  it('Claude thinking 끄기 → effort low(받는 모델), 받지 않는 모델(Haiku 4.5)은 effort 없이 — 상한에 생각 몫을 더한다(J43)', () => {
    const roomy = 900 + SUBSCRIPTION_ONLY_THINKING_HEADROOM_TOKENS
    expect(subscriptionOnlyRoute({ model: 'claude-sonnet-5-5', maxTokens: 900, disableThinking: true }, { provider: 'anthropic' })).toEqual({
      route: { model: 'claude-sonnet-5-5', maxTokens: roomy, backend: 'subscription', effort: 'low' },
      adjustments: ['thinking-off'],
    })
    expect(
      subscriptionOnlyRoute({ model: 'claude-haiku-4-5-20251001', maxTokens: 900, disableThinking: true, temperature: 0 }, { provider: 'anthropic', noEffort: true })
    ).toEqual({ route: { model: 'claude-haiku-4-5-20251001', maxTokens: roomy, backend: 'subscription' }, adjustments: ['thinking-off', 'temperature'] })
  })

  it('생각 몫은 thinking 끄기 Claude 칸만 — 생각 켠 칸·코덱스(상한을 받지 않음)는 그대로', () => {
    expect(subscriptionOnlyRoute({ model: 'claude-opus-5-5', maxTokens: 4000, effort: 'high' }, { provider: 'anthropic' }).route.maxTokens).toBe(4000)
    expect(subscriptionOnlyRoute({ model: 'gpt-6.1-sol', maxTokens: 800, disableThinking: true }, { provider: 'openai' }).route).toEqual({
      model: 'gpt-6.1-sol',
      maxTokens: 800,
      effort: 'low',
      backend: 'subscription',
    })
    // review-faq(J43): route 1,500 → 구독 전용 9,500
    const faq = pdpRoute('design/review-faq')
    expect(faq).toMatchObject({ model: 'claude-haiku-5-5', maxTokens: 1500, disableThinking: true })
    expect(subscriptionOnlyRoute(faq, { provider: 'anthropic' }).route).toMatchObject({
      maxTokens: 1500 + SUBSCRIPTION_ONLY_THINKING_HEADROOM_TOKENS,
      effort: 'low',
    })
  })

  it('지정 effort는 그대로, JSON 강제·API 잇기는 빼고, 잘림 감지는 Claude만 남긴다(GPT는 뺌)', () => {
    expect(
      subscriptionOnlyRoute(
        { model: 'claude-opus-5-5', maxTokens: 4000, effort: 'xhigh', json: true, failOnTruncation: true, backend: 'subscription', subscriptionFallback: 'api' },
        { provider: 'anthropic' }
      )
    ).toEqual({
      route: { model: 'claude-opus-5-5', maxTokens: 4000, effort: 'xhigh', backend: 'subscription', failOnTruncation: true },
      adjustments: ['json', 'api-fallback'],
    })
    expect(subscriptionOnlyRoute({ model: 'gpt-6.1-sol', maxTokens: 800, effort: 'low', failOnTruncation: true }, { provider: 'openai' })).toEqual({
      route: { model: 'gpt-6.1-sol', maxTokens: 800, effort: 'low', backend: 'subscription' },
      adjustments: ['gpt-truncation'],
    })
  })

  it('callAgent 설정 → 같은 값의 route', () => {
    expect(agentConfigRoute({ model: 'claude-sonnet-5', maxTokens: 2000, disableThinking: true })).toEqual({
      model: 'claude-sonnet-5',
      maxTokens: 2000,
      disableThinking: true,
    })
    expect(agentConfigRoute({ model: 'claude-opus-5-5', maxTokens: 10, effort: 'high', temperature: 0.2 }, true)).toEqual({
      model: 'claude-opus-5-5',
      maxTokens: 10,
      temperature: 0.2,
      effort: 'high',
      failOnTruncation: true,
    })
  })
})

describe('callLlm — 구독 전용 모드', () => {
  it('모드가 꺼져 있으면 지금 그대로 API 공급자(운영 바이트 불변)', async () => {
    registerFakes()
    expect(isSubscriptionOnly()).toBe(false)
    await callLlm({ model: 'claude-sonnet-5-5', maxTokens: 10, disableThinking: true }, REQ, (t) => t)
    await callLlm({ model: 'gpt-6.1-sol', maxTokens: 10, effort: 'low' }, REQ, (t) => t)
    expect(h.agent).toHaveBeenCalledTimes(1)
    expect(h.openai).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(0)
  })

  it('켜면 Claude·GPT는 구독 CLI(콜 시간 하한 적용·비용 0 기록), Gemini는 API — Claude·GPT API 0', async () => {
    registerFakes()
    disable = enableSubscriptionOnly()
    const claude = await callLlm({ model: 'claude-sonnet-5-5', maxTokens: 900, disableThinking: true }, { ...REQ, timeoutMs: 40_000 }, (t) => t)
    const gpt = await callLlm({ model: 'gpt-6.1-sol', maxTokens: 800, effort: 'medium' }, REQ, (t) => t)
    const gemini = await callLlm({ model: 'gemini-4-argon', maxTokens: 500, effort: 'high' }, REQ, (t) => t)
    expect([claude.success, gpt.success, gemini.success]).toEqual([true, true, true])
    expect(claude.success && claude.data).toBe('cli')
    expect(h.agent).not.toHaveBeenCalled()
    expect(h.openai).not.toHaveBeenCalled()
    expect(h.gemini).toHaveBeenCalledTimes(1)
    expect(seen.map((s) => [s.backend, s.request.model, s.request.effort ?? null])).toEqual([
      ['claude-cli', 'claude-sonnet-5-5', 'low'],
      ['codex-cli', 'gpt-6.1-sol', 'medium'],
    ])
    expect(seen[0].request.timeoutMs).toBe(SUBSCRIPTION_ONLY_MIN_TIMEOUT_MS)
    expect(seen[1].request.timeoutMs).toBeUndefined()
    // 구독 콜 기록은 비용 0, 단계 표지 #claude-cli·#codex
    const logged = h.logUsage.mock.calls.map((c) => (c as unknown as [{ costUsd: number; runContext?: { stage?: string } }])[0])
    expect(logged.map((l) => [l.costUsd, l.runContext?.stage])).toEqual([
      [0, '#claude-cli'],
      [0, '#codex'],
    ])
    expect(subscriptionOnlyAdjustments()).toEqual([{ agent: 'test/sub-only', model: 'claude-sonnet-5-5', adjustment: 'thinking-off', count: 1 }])
  })

  it('review-faq(J43): 다리에 상한 9,500을 넘기고, 답 없이 잘린 콜(빈 글·CLI 안내 글)은 파서에 넘기지 않고 잘린 답으로 센다', async () => {
    const answers = [
      { text: '', usage: { inputTokens: 19_792, outputTokens: 6_000 }, truncated: true },
      { text: "API Error: Claude's response exceeded the 1500 output token maximum.", usage: null, truncated: true },
    ]
    registerLocalLlmBackend('claude-cli', async (request) => {
      seen.push({ backend: 'claude-cli', request })
      return answers.shift() ?? { text: '{"items":[]}', usage: null }
    })
    disable = enableSubscriptionOnly()
    const parser = vi.fn((t: string) => t)
    const out = await callLlm(pdpRoute('design/review-faq'), { ...REQ, timeoutMs: 60_000 }, parser)
    expect(seen.map((s) => s.request.maxTokens)).toEqual([9_500, 9_500])
    expect(parser).not.toHaveBeenCalled()
    expect(out).toMatchObject({
      success: false,
      error: { stage: 'parse', attempts: 2, stopReason: 'max_tokens', message: expect.stringContaining('출력 상한(9500)에서 답 없이 잘림') },
    })
    // 부분 답(잘렸지만 글이 있음)은 지금처럼 파서가 받는다
    answers.push({ text: '{"items":[{"worry":"a"}', usage: null, truncated: true })
    const partial = await callLlm(pdpRoute('design/review-faq'), REQ, parser)
    expect(partial.success).toBe(true)
    expect(parser).toHaveBeenCalledWith('{"items":[{"worry":"a"}')
  })

  it('작업자 잇기 route(subscriptionFallback api)도 켠 동안은 API로 잇지 않는다 — 백엔드가 없으면 LlmSoftStopError', async () => {
    disable = enableSubscriptionOnly()
    const route: LlmRoute = { model: 'claude-opus-5-5', maxTokens: 100, effort: 'low', backend: 'subscription', subscriptionFallback: 'api' }
    await expect(callLlm(route, REQ, (t) => t)).rejects.toMatchObject({ name: 'LlmSoftStopError' })
    await expect(callLlm({ model: 'gpt-6.1-sol', maxTokens: 10 }, REQ, (t) => t)).rejects.toMatchObject({ name: 'LlmSoftStopError' })
    expect(h.agent).not.toHaveBeenCalled()
    expect(h.openai).not.toHaveBeenCalled()
  })

  it('끄면 다시 지금 그대로 — 조정 기록은 켤 때 비운다', async () => {
    registerFakes()
    disable = enableSubscriptionOnly()
    await callLlm({ model: 'claude-sonnet-5-5', maxTokens: 9, json: true }, REQ, (t) => t)
    expect(subscriptionOnlyAdjustments()).toHaveLength(1)
    disable()
    disable = null
    await callLlm({ model: 'claude-sonnet-5-5', maxTokens: 9 }, REQ, (t) => t)
    expect(h.agent).toHaveBeenCalledTimes(1)
    disable = enableSubscriptionOnly()
    expect(subscriptionOnlyAdjustments()).toEqual([])
  })
})

describe('OpenAI API 직접 호출 안전망', () => {
  it('켠 동안 OpenAI 모델은 던지고(소프트 종료), Gemini·꺼진 모드는 지나간다', () => {
    expect(() => assertNoOpenAiApiInSubscriptionOnly('gpt-6.1-sol', 'a')).not.toThrow()
    disable = enableSubscriptionOnly()
    expect(() => assertNoOpenAiApiInSubscriptionOnly('gpt-6.1-sol', 'a')).toThrow(/OpenAI API를 직접/)
    expect(() => assertNoOpenAiApiInSubscriptionOnly('gemini-4-argon', 'a')).not.toThrow()
  })
})
