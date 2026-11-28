/**
 * 모델 계층 구독 백엔드·M 갈래 배선(pdp-llm-subscription-backend) — 부르기 전에 막는 설정(400 방지),
 * Anthropic effort 전달, 구독 라우트의 구독 공급자 분기(OpenAI·Anthropic — R13), API 잇기 라우트, 레지스트리 단가 불변식(모르는 모델은
 * 0원이 아니라 오류). 공급자는 모의.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  agent: vi.fn(),
  openai: vi.fn(),
  codex: vi.fn(),
}))

vi.mock('../_base', () => ({ callAgent: (...a: unknown[]) => h.agent(...a) }))
vi.mock('../openai-chat', () => ({ callOpenAiChat: (...a: unknown[]) => h.openai(...a) }))
vi.mock('./providers/codex-cli', () => ({ callSubscriptionCli: (...a: unknown[]) => h.codex(...a) }))

import { callLlm, LLM_MODELS, lookupLlmModel } from '.'
import { ANTHROPIC_AGENT_MODELS } from './providers/anthropic'
import type { LlmRoute } from './types'

const OK = { success: true, data: 'ok', usage: { inputTokens: 1, outputTokens: 1, cost: 0.001 }, duration: 1 }
const REQ = { system: 's', messages: [{ role: 'user' as const, content: 'u' }], agentName: 'test/llm' }
const call = (route: LlmRoute) => callLlm(route, REQ, (t) => t)

beforeEach(() => {
  h.agent.mockReset().mockResolvedValue(OK)
  h.openai.mockReset().mockResolvedValue(OK)
  h.codex.mockReset().mockResolvedValue({ ...OK, usage: { inputTokens: 1, outputTokens: 1, cost: 0 } })
})

describe('callLlm — 부르기 전에 막는 설정', () => {
  const refusedWith = async (route: LlmRoute, pattern: RegExp) => {
    const result = await call(route)
    expect(result.success, JSON.stringify(route)).toBe(false)
    if (!result.success) expect(result.error.message).toMatch(pattern)
    expect(h.agent).not.toHaveBeenCalled()
    expect(h.openai).not.toHaveBeenCalled()
    expect(h.codex).not.toHaveBeenCalled()
  }

  it('thinking을 끌 수 없는 Opus 5.5에 disableThinking — 400 대신 부르지 않는다', async () => {
    await refusedWith({ model: 'claude-opus-5-5', maxTokens: 100, disableThinking: true }, /thinking을 끌 수 없습니다/)
  })

  it('thinking 끄기와 effort xhigh·max는 함께 보내지 않는다(Sonnet 5.5·Haiku 5.5는 high 이하에서만 끌 수 있다)', async () => {
    await refusedWith(
      { model: 'claude-sonnet-5-5', maxTokens: 100, disableThinking: true, effort: 'max' },
      /effort high 이하/
    )
    await refusedWith(
      { model: 'claude-haiku-5-5', maxTokens: 100, disableThinking: true, effort: 'max' },
      /effort high 이하/
    )
  })

  it('OpenAI API 경로는 확인한 모델·값만 effort를 보낸다(gpt-5.6-luna·gpt-5.4-mini는 막음, 구독 경로는 해당 없음)', async () => {
    await refusedWith({ model: 'gpt-5.6-luna', maxTokens: 100, effort: 'high' }, /확인하지 않은 effort/)
    await refusedWith({ model: 'gpt-5.4-mini', maxTokens: 100, effort: 'low' }, /확인하지 않은 effort/)
    await call({ model: 'gpt-6.1-sol', maxTokens: 100, effort: 'max' })
    await call({ model: 'gpt-5.6-luna', maxTokens: 100, effort: 'high', backend: 'subscription' })
    expect(h.openai).toHaveBeenCalledTimes(1)
    expect(h.codex).toHaveBeenCalledTimes(1)
  })

  it('Gemini 구독 백엔드는 없다 · Claude 구독은 thinking을 끌 수 없다 · Haiku 4.5는 effort를 받지 않는다', async () => {
    await refusedWith({ model: 'gemini-4-argon', maxTokens: 100, backend: 'subscription' }, /gemini 구독 백엔드는 없습니다/)
    await refusedWith(
      { model: 'claude-sonnet-5-5', maxTokens: 100, backend: 'subscription', disableThinking: true },
      /Claude 구독\(CLI\)은 thinking을 끌 수 없습니다/
    )
    await refusedWith({ model: 'claude-haiku-4-5-20251001', maxTokens: 100, effort: 'low' }, /effort를 받지 않습니다/)
  })

  it('API로 잇는 구독 라우트는 API 판이 막히는 설정이면 구독도 부르지 않는다(구독을 쓴 뒤 멈추지 않게)', async () => {
    await refusedWith(
      { model: 'gpt-5.6-luna', maxTokens: 100, effort: 'high', backend: 'subscription', subscriptionFallback: 'api' },
      /API 잇기 라우트가 막힙니다 — OpenAI API 경로에서 확인하지 않은 effort/
    )
  })

  it('Gemini thinkingLevel은 low·medium·high만 — xhigh·max는 400 대신 부르지 않는다(R02)', async () => {
    await refusedWith({ model: 'gemini-4-argon', maxTokens: 100, effort: 'xhigh' }, /low·medium·high만/)
    await refusedWith({ model: 'gemini-4-argon', maxTokens: 100, effort: 'max' }, /low·medium·high만/)
  })

  it('잘림 감지는 Anthropic·Gemini API 경로만 — OpenAI API·구독 경로에 두면 조용히 통과하지 않게 막는다(R02)', async () => {
    await refusedWith({ model: 'gpt-6.1-sol', maxTokens: 100, failOnTruncation: true }, /잘림 감지/)
    await refusedWith(
      { model: 'gpt-6.1-sol', maxTokens: 100, backend: 'subscription', failOnTruncation: true },
      /잘림 감지/
    )
  })

  it('등록되지 않은 모델은 0원으로 부르지 않고 실패(단가 없는 과금 방지)', async () => {
    await refusedWith({ model: 'claude-sonnet-6', maxTokens: 100 }, /등록되지 않은 모델/)
    await refusedWith({ model: 'gpt-6-luna', maxTokens: 100, backend: 'subscription' }, /등록되지 않은 모델/)
  })
})

describe('callLlm — 분기·전달', () => {
  it('구독 라우트의 Anthropic 모델(R13)은 구독 공급자로 간다 — 잘림 감지도 받는다(Claude CLI가 알려 준다)', async () => {
    const route: LlmRoute = { model: 'claude-opus-5-5', maxTokens: 12000, effort: 'medium', backend: 'subscription', failOnTruncation: true }
    await call(route)
    expect(h.codex).toHaveBeenCalledWith(route, REQ, expect.any(Function))
    expect(h.agent).not.toHaveBeenCalled()
  })

  it('API로 잇는 구독 라우트 — 구독이 막히면(소프트 종료) 같은 route를 API 공급자로 한 번 부른다', async () => {
    const stop = Object.assign(new Error('[local-llm:soft-stop] quota: claude-cli'), {
      name: 'LlmSoftStopError',
      stop: { backend: 'claude-cli', reason: 'quota', message: '한도', at: new Date().toISOString() },
    })
    h.codex.mockRejectedValueOnce(stop)
    const route: LlmRoute = { model: 'claude-opus-5-5', maxTokens: 8000, effort: 'low', backend: 'subscription', subscriptionFallback: 'api' }
    const out = await call(route)
    expect(out.success).toBe(true)
    expect(h.codex).toHaveBeenCalledTimes(1)
    expect(h.agent).toHaveBeenCalledTimes(1)
    expect(h.agent.mock.calls[0][0].config).toEqual({ model: 'claude-opus-5-5', maxTokens: 8000, effort: 'low' })
    expect(h.agent.mock.calls[0][0].runContext).toEqual({ stage: '#sub→api' })
  })

  it('멈춤 표지 라우트(AX-CT-29) — 구독 소프트 종료는 API로 잇지 않고 그대로 던지고, 프로세스 실패(stage api)는 reason process로 던진다', async () => {
    const stop = Object.assign(new Error('[local-llm:soft-stop] quota: claude-cli'), {
      name: 'LlmSoftStopError',
      stop: { backend: 'claude-cli', reason: 'quota', message: '한도', at: new Date().toISOString() },
    })
    h.codex.mockRejectedValueOnce(stop)
    const route: LlmRoute = { model: 'claude-opus-5-5', maxTokens: 8000, effort: 'low', backend: 'subscription', subscriptionHalt: true }
    await expect(call(route)).rejects.toBe(stop)
    // 프로세스 실패 — 백엔드가 이미 한 번 다시 시도한 뒤의 실패 결과
    h.codex.mockResolvedValueOnce({
      success: false,
      error: { message: 'claude exit 1', stage: 'api', attempts: 1 },
      usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
      duration: 1,
    })
    await expect(call(route)).rejects.toMatchObject({
      name: 'LlmSoftStopError',
      stop: { backend: 'claude-cli', reason: 'process', message: 'claude exit 1' },
    })
    // API 공급자는 한 번도 부르지 않는다
    expect(h.agent).not.toHaveBeenCalled()
    expect(h.openai).not.toHaveBeenCalled()
    expect(h.codex).toHaveBeenCalledTimes(2)
    // 파싱 실패(stage parse)·성공은 지금처럼 결과로 돌려준다
    const parseFail = { success: false, error: { message: '형식', stage: 'parse', attempts: 1 }, usage: { inputTokens: 1, outputTokens: 1, cost: 0 }, duration: 1 }
    h.codex.mockResolvedValueOnce(parseFail)
    await expect(call(route)).resolves.toBe(parseFail)
    expect((await call(route)).success).toBe(true)
  })

  it('멈춤 표지 없는 구독 라우트는 프로세스 실패도 지금처럼 결과로 돌려준다(던지지 않는다)', async () => {
    const failure = { success: false, error: { message: 'claude exit 1', stage: 'api', attempts: 1 }, usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, duration: 1 }
    h.codex.mockResolvedValueOnce(failure)
    await expect(call({ model: 'claude-opus-5-5', maxTokens: 100, backend: 'subscription' })).resolves.toBe(failure)
  })

  it('구독 라우트의 OpenAI 모델은 코덱스 공급자로만 간다(API 공급자 안 부름)', async () => {
    const route: LlmRoute = { model: 'gpt-6.1-sol', maxTokens: 8192, effort: 'high', backend: 'subscription' }
    await call(route)
    expect(h.codex).toHaveBeenCalledWith(route, REQ, expect.any(Function))
    expect(h.openai).not.toHaveBeenCalled()
    await call({ model: 'gpt-5.6-luna', maxTokens: 8192, backend: 'subscription' })
    expect(h.codex).toHaveBeenCalledTimes(2)
  })

  it('시간 제한 배율 — 요청 값(없으면 callAgent 기본 30초)에 곱해 보내고, 배율이 없으면 요청 그대로', async () => {
    await callLlm(
      { model: 'claude-opus-5-5', maxTokens: 100, timeoutScale: 3 },
      { ...REQ, timeoutMs: 90_000 },
      (t) => t
    )
    expect(h.agent.mock.calls[0][0].timeoutMs).toBe(270_000)
    await call({ model: 'claude-opus-5-5', maxTokens: 100, timeoutScale: 3 })
    expect(h.agent.mock.calls[1][0].timeoutMs).toBe(90_000)
    await callLlm({ model: 'claude-sonnet-5', maxTokens: 100 }, { ...REQ, timeoutMs: 90_000 }, (t) => t)
    expect(h.agent.mock.calls[2][0].timeoutMs).toBe(90_000)
    await call({ model: 'claude-sonnet-5', maxTokens: 100 })
    expect(h.agent.mock.calls[3][0]).not.toHaveProperty('timeoutMs')
    // run 예산에서 계산한 제한(이미지 게이트·장식)은 곱하지 않는다 — 잡 진행 잠금 기한을 넘지 않게
    await callLlm(
      { model: 'claude-opus-5-5', maxTokens: 100, timeoutScale: 3 },
      { ...REQ, timeoutMs: 55_000, timeoutFixed: true },
      (t) => t
    )
    expect(h.agent.mock.calls[4][0].timeoutMs).toBe(55_000)
  })

  it('Anthropic effort xhigh는 막지 않고 callAgent 설정에 그대로 싣는다(SDK 0.90, R02) — 잘림 감지는 켰을 때만 옵션으로 간다', async () => {
    await call({ model: 'claude-opus-5-5', maxTokens: 28000, effort: 'xhigh', failOnTruncation: true })
    expect(h.agent.mock.calls[0][0].config).toEqual({ model: 'claude-opus-5-5', maxTokens: 28000, effort: 'xhigh' })
    expect(h.agent.mock.calls[0][0].failOnTruncation).toBe(true)
    await call({ model: 'claude-sonnet-5-5', maxTokens: 100, effort: 'xhigh' })
    expect(h.agent.mock.calls[1][0].config).toEqual({ model: 'claude-sonnet-5-5', maxTokens: 100, effort: 'xhigh' })
    expect(h.agent.mock.calls[1][0]).not.toHaveProperty('failOnTruncation')
  })

  it('Anthropic effort는 설정했을 때만 callAgent 설정에 싣는다', async () => {
    await call({ model: 'claude-opus-5-5', maxTokens: 2300, effort: 'low' })
    expect(h.agent.mock.calls[0][0].config).toEqual({ model: 'claude-opus-5-5', maxTokens: 2300, effort: 'low' })
    await call({ model: 'claude-sonnet-5', maxTokens: 8000, disableThinking: true })
    expect(h.agent.mock.calls[1][0].config).toEqual({
      model: 'claude-sonnet-5',
      maxTokens: 8000,
      disableThinking: true,
    })
  })

  it('API 백엔드(기본)의 OpenAI 모델은 지금처럼 callOpenAiChat으로 간다', async () => {
    await call({ model: 'gpt-5.6-luna', maxTokens: 8192, backend: 'api' })
    expect(h.openai).toHaveBeenCalledTimes(1)
    expect(h.codex).not.toHaveBeenCalled()
  })

  it('gpt-6.1-sol은 API로도 부른다(단가 확인, pdp-model-refresh) — effort는 설정했을 때만 reasoningEffort로 간다', async () => {
    await call({ model: 'gpt-6.1-sol', maxTokens: 8192, effort: 'medium' })
    expect(h.openai.mock.calls[0][0]).toMatchObject({
      model: 'gpt-6.1-sol',
      maxTokens: 8192,
      reasoningEffort: 'medium',
    })
    await call({ model: 'gpt-5.6-luna', maxTokens: 8192 })
    expect(h.openai.mock.calls[1][0]).not.toHaveProperty('reasoningEffort')
    expect(h.codex).not.toHaveBeenCalled()
  })

  it('Sonnet 5.5·Haiku 5.5는 thinking 끄기를 callAgent 설정에 싣고 temperature는 보내지 않는다(기본값이 아니면 400)', async () => {
    await call({ model: 'claude-sonnet-5-5', maxTokens: 8000, disableThinking: true })
    await call({ model: 'claude-haiku-5-5', maxTokens: 300, temperature: 0, disableThinking: true })
    expect(h.agent.mock.calls.map((c) => c[0].config)).toEqual([
      { model: 'claude-sonnet-5-5', maxTokens: 8000, disableThinking: true },
      { model: 'claude-haiku-5-5', maxTokens: 300, disableThinking: true },
    ])
  })
})

describe('레지스트리 단가 불변식(R5 확인 요청 ②)', () => {
  it('모든 모델은 입력·출력 단가가 0보다 크다 — 0원 기록으로 월·잡 상한이 무력해지지 않게(구독 콜 0원은 codex 공급자 몫)', () => {
    for (const [model, info] of Object.entries(LLM_MODELS)) {
      expect(info.costPer1k.input, model).toBeGreaterThan(0)
      expect(info.costPer1k.output, model).toBeGreaterThan(0)
    }
  })

  it('Opus 5.5 단가는 참조 표 그대로($4/$20 per MTok), thinking 필수 — callAgent가 받는 모델이다', () => {
    expect(lookupLlmModel('claude-opus-5-5')).toMatchObject({
      provider: 'anthropic',
      costPer1k: { input: 0.004, output: 0.02 },
      thinkingRequired: true,
    })
    expect(ANTHROPIC_AGENT_MODELS).toContain('claude-opus-5-5')
  })

  it('PDP 새 모델(pdp-model-refresh)은 callAgent가 받는 Claude 모델이다', () => {
    for (const model of ['claude-sonnet-5-5', 'claude-haiku-5-5']) {
      expect(lookupLlmModel(model), model).toMatchObject({ provider: 'anthropic', temperature: false })
      expect(ANTHROPIC_AGENT_MODELS, model).toContain(model)
    }
  })
})
