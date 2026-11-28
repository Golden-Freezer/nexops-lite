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

describe('callLlm — 라이트의 단일 Codex 경로', () => {
  it('모드가 꺼져 있어도 공급자별 래퍼 없이 공통 callAgent를 쓴다', async () => {
    registerFakes()
    expect(isSubscriptionOnly()).toBe(false)
    await callLlm({ model: 'claude-sonnet-5-5', maxTokens: 10, disableThinking: true }, REQ, (t) => t)
    await callLlm({ model: 'gpt-6.1-sol', maxTokens: 10, effort: 'low' }, REQ, (t) => t)
    expect(h.agent).toHaveBeenCalledTimes(2)
    expect(h.openai).not.toHaveBeenCalled()
    expect(seen).toHaveLength(0)
  })

  it('구독 전용 플래그·공급자와 무관하게 공통 callAgent만 쓴다', async () => {
    registerFakes()
    disable = enableSubscriptionOnly()
    const claude = await callLlm({ model: 'claude-sonnet-5-5', maxTokens: 900, disableThinking: true }, { ...REQ, timeoutMs: 40_000 }, (t) => t)
    const gpt = await callLlm({ model: 'gpt-6.1-sol', maxTokens: 800, effort: 'medium' }, REQ, (t) => t)
    const gemini = await callLlm({ model: 'gemini-4-argon', maxTokens: 500, effort: 'high' }, REQ, (t) => t)
    expect([claude.success, gpt.success, gemini.success]).toEqual([true, true, true])
    expect(claude.success && claude.data).toBe('api')
    expect(h.agent).toHaveBeenCalledTimes(3)
    expect(h.openai).not.toHaveBeenCalled()
    expect(h.gemini).not.toHaveBeenCalled()
    expect(seen).toHaveLength(0)
    expect(h.logUsage).not.toHaveBeenCalled()
    expect(subscriptionOnlyAdjustments()).toEqual([])
  })

  it('레거시 CLI 백엔드가 등록돼도 callLlm은 그 백엔드를 우회한다', async () => {
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
    expect(seen).toHaveLength(0)
    expect(h.agent).toHaveBeenCalledTimes(1)
    expect(parser).not.toHaveBeenCalled()
    expect(out).toMatchObject({ success: true, data: 'api' })
    // 부분 답(잘렸지만 글이 있음)은 지금처럼 파서가 받는다
    answers.push({ text: '{"items":[{"worry":"a"}', usage: null, truncated: true })
    const partial = await callLlm(pdpRoute('design/review-faq'), REQ, parser)
    expect(partial.success).toBe(true)
    expect(h.agent).toHaveBeenCalledTimes(2)
  })

  it('subscriptionFallback 메타데이터도 사전 거부 없이 공통 경로로 보낸다', async () => {
    disable = enableSubscriptionOnly()
    const route: LlmRoute = { model: 'claude-opus-5-5', maxTokens: 100, effort: 'low', backend: 'subscription', subscriptionFallback: 'api' }
    expect((await callLlm(route, REQ, (t) => t)).success).toBe(true)
    expect((await callLlm({ model: 'gpt-6.1-sol', maxTokens: 10 }, REQ, (t) => t)).success).toBe(true)
    expect(h.agent).toHaveBeenCalledTimes(2)
    expect(h.openai).not.toHaveBeenCalled()
  })

  it('구독 전용 플래그를 켜고 꺼도 callLlm 경로와 조정 기록은 바뀌지 않는다', async () => {
    registerFakes()
    disable = enableSubscriptionOnly()
    await callLlm({ model: 'claude-sonnet-5-5', maxTokens: 9, json: true }, REQ, (t) => t)
    expect(subscriptionOnlyAdjustments()).toEqual([])
    disable()
    disable = null
    await callLlm({ model: 'claude-sonnet-5-5', maxTokens: 9 }, REQ, (t) => t)
    expect(h.agent).toHaveBeenCalledTimes(2)
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
