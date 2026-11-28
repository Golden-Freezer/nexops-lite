/**
 * 모델 계층(묶음 1) — callLlm이 레지스트리 공급자로 보내고, 공급자마다 같은 계약(월 예산 확인·시도마다 사용량 기록·재시도)을 지키는지.
 * 공급자 HTTP·SDK·DB는 모의(유료 호출 0).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  callAgent: vi.fn(),
  callOpenAiChat: vi.fn(),
  budget: { allowed: true, spentUsd: 0, budgetUsd: 50 } as Record<string, unknown>,
  usage: [] as Array<Record<string, unknown>>,
}))

vi.mock('../_base', () => ({ callAgent: (...args: unknown[]) => h.callAgent(...args) }))
vi.mock('../openai-chat', () => ({ callOpenAiChat: (...args: unknown[]) => h.callOpenAiChat(...args) }))
vi.mock('../budget', () => ({
  checkMonthlyBudget: vi.fn(async () => h.budget),
  logUsage: vi.fn(async (entry: Record<string, unknown>) => {
    h.usage.push(entry)
    return true
  }),
}))

import { callLlm, llmCostPer1k, LLM_MODELS } from './index'
import { ANTHROPIC_AGENT_MODELS, callAnthropic } from './providers/anthropic'
import { checkMonthlyBudget } from '../budget'

const OK = { success: true, data: 'ok', usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, duration: 0 }
const request = { system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }], agentName: 'registration/test' }
const parse = (text: string) => text

beforeEach(() => {
  h.callAgent.mockReset().mockResolvedValue(OK)
  h.callOpenAiChat.mockReset().mockResolvedValue(OK)
  h.budget = { allowed: true, spentUsd: 0, budgetUsd: 50 }
  h.usage = []
  vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('callLlm — 레지스트리 공급자로 보낸다(폴백 없음)', () => {
  it('등록되지 않은 모델은 어느 공급자도 부르지 않고 실패', async () => {
    const out = await callLlm({ model: 'claude-opus-unknown', maxTokens: 10 }, request, parse)
    expect(out.success).toBe(false)
    expect(h.callAgent).not.toHaveBeenCalled()
    expect(h.callOpenAiChat).not.toHaveBeenCalled()
  })

  it('Anthropic: callAgent 설정으로 옮긴다 — temperature는 허용 모델(Haiku)만, thinking 끄기·시간 제한·재시도는 그대로', async () => {
    await callLlm(
      { model: 'claude-sonnet-5', maxTokens: 800, temperature: 0, disableThinking: true },
      { ...request, timeoutMs: 1234, maxRetries: 0 },
      parse
    )
    await callLlm({ model: 'claude-haiku-4-5-20251001', maxTokens: 300, temperature: 0 }, request, parse)
    expect(h.callAgent.mock.calls[0][0]).toEqual({
      config: { model: 'claude-sonnet-5', maxTokens: 800, disableThinking: true },
      system: 'sys',
      messages: request.messages,
      agentName: 'registration/test',
      timeoutMs: 1234,
      maxRetries: 0,
    })
    expect(h.callAgent.mock.calls[1][0].config).toEqual({
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 300,
      temperature: 0,
    })
  })

  it('OpenAI: callOpenAiChat에 모델·상한을 넘기고 텍스트 블록은 잇는다. 이미지 블록이 있으면 보내지 않는다', async () => {
    const textBlocks = {
      ...request,
      messages: [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'a' },
            { type: 'text' as const, text: 'b' },
          ],
        },
      ],
    }
    await callLlm({ model: 'gpt-5.6-luna', maxTokens: 8192 }, textBlocks, parse)
    expect(h.callOpenAiChat.mock.calls[0][0]).toEqual({
      system: 'sys',
      messages: [{ role: 'user', content: 'ab' }],
      model: 'gpt-5.6-luna',
      maxTokens: 8192,
      agentName: 'registration/test',
    })
    const image = {
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: 'image/png' as const, data: 'AA' },
    }
    const out = await callLlm(
      { model: 'gpt-5.6-luna', maxTokens: 10 },
      { ...request, messages: [{ role: 'user', content: [image] }] },
      parse
    )
    expect(out.success).toBe(false)
    expect(h.callOpenAiChat).toHaveBeenCalledTimes(1)
  })

  it('미등록 모델의 단가는 표의 최고 단가(입력·출력 각각)로 계상한다', () => {
    const all = Object.values(LLM_MODELS).map((m) => m.costPer1k)
    expect(llmCostPer1k('unknown-model')).toEqual({
      input: Math.max(...all.map((c) => c.input)),
      output: Math.max(...all.map((c) => c.output)),
    })
    expect(llmCostPer1k('gemini-3.5-flash')).toEqual({ input: 0.0015, output: 0.009 })
  })

  it('레지스트리의 Anthropic 모델은 callAgent가 받는 모델(AgentConfig·_base COST_MAP)과 같다', () => {
    const registered = Object.entries(LLM_MODELS)
      .filter(([, m]) => m.provider === 'anthropic')
      .map(([id]) => id)
    expect(registered.sort()).toEqual([...ANTHROPIC_AGENT_MODELS].sort())
  })

  it('callAgent가 받지 않는 Claude 모델은 Anthropic 공급자가 부르기 전에 막는다(응답을 받은 뒤 단가를 못 찾는 유료 실패 방지)', async () => {
    const out = await callAnthropic({ model: 'claude-opus-new', maxTokens: 10 }, request, parse)
    expect(out).toMatchObject({ success: false, error: { stage: 'api', attempts: 0 } })
    expect(h.callAgent).not.toHaveBeenCalled()
  })

  it('run 기한(deadlineAt)은 있을 때만 Anthropic·OpenAI 공급자에 그대로 간다(pdp-cost-time-followup)', async () => {
    await callLlm({ model: 'claude-sonnet-5-5', maxTokens: 10 }, { ...request, deadlineAt: 123 }, parse)
    await callLlm({ model: 'gpt-6.1-sol', maxTokens: 10 }, { ...request, deadlineAt: 456 }, parse)
    await callLlm({ model: 'claude-sonnet-5-5', maxTokens: 10 }, request, parse)
    expect(h.callAgent.mock.calls[0][0]).toMatchObject({ deadlineAt: 123 })
    expect(h.callOpenAiChat.mock.calls[0][0]).toMatchObject({ deadlineAt: 456 })
    expect(h.callAgent.mock.calls[1][0]).not.toHaveProperty('deadlineAt')
  })

  it('runContext·시간 제한·재시도는 Anthropic·OpenAI 공급자에 그대로 간다(user_id 격리 — logUsage가 runContext로 채운다)', async () => {
    const runContext = { userId: 'user-1', businessId: 'biz-1', stage: 'copywriting' }
    const full = { ...request, runContext, timeoutMs: 4321, maxRetries: 0 }
    await callLlm({ model: 'claude-sonnet-5', maxTokens: 10 }, full, parse)
    await callLlm({ model: 'gpt-5.6-luna', maxTokens: 10 }, full, parse)
    for (const [options] of [h.callAgent.mock.calls[0], h.callOpenAiChat.mock.calls[0]])
      expect(options).toMatchObject({ runContext, timeoutMs: 4321, maxRetries: 0 })
  })
})

type FetchCall = [string, { headers: Record<string, string>; body: string }]
function geminiFetch(responses: Array<{ status: number; json: unknown }>) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift()!
    return { ok: next.status < 400, status: next.status, json: async () => next.json } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const geminiOk = (
  text: string,
  meta = { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 300 }
) => ({
  status: 200,
  json: { candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text }] } }], usageMetadata: meta },
})

describe('Gemini 공급자 — 같은 계약(예산·사용량 기록·재시도), JSON 강제는 공급자 기능 → 파서 순서', () => {
  it('키는 헤더로, 시스템·텍스트·이미지 파트·상한·JSON 강제를 보낸다. 생각 파트는 산출에서 뺀다', async () => {
    const fetchMock = geminiFetch([geminiOk('{"a":1}')])
    const image = {
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: 'IMG' },
    }
    const out = await callLlm(
      { model: 'gemini-3-flash-preview', maxTokens: 500, temperature: 0.2, json: true },
      { ...request, messages: [{ role: 'user', content: [image, { type: 'text', text: '판정' }] }] },
      (text) => JSON.parse(text) as { a: number }
    )
    expect(out).toMatchObject({ success: true, data: { a: 1 } })
    const [url, init] = fetchMock.mock.calls[0] as unknown as FetchCall
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent')
    expect(url).not.toContain('key=')
    expect(init.headers['x-goog-api-key']).toBe('test-gemini-key')
    expect(JSON.parse(init.body)).toEqual({
      systemInstruction: { parts: [{ text: 'sys' }] },
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'IMG' } }, { text: '판정' }] }],
      generationConfig: { maxOutputTokens: 500, temperature: 0.2, responseMimeType: 'application/json' },
    })
  })

  it('비용은 입력 × 입력 단가 + (답 + 생각) × 출력 단가 — 시도마다 사용량을 기록한다', async () => {
    geminiFetch([geminiOk('x')])
    const out = await callLlm({ model: 'gemini-3.5-flash', maxTokens: 100 }, request, parse)
    expect(out.usage).toEqual({ inputTokens: 1000, outputTokens: 500, cost: 1 * 0.0015 + 0.5 * 0.009 })
    expect(h.usage).toEqual([
      expect.objectContaining({
        agent: 'registration/test',
        model: 'gemini-3.5-flash',
        inputTokens: 1000,
        outputTokens: 500,
        success: true,
        attempts: 1,
      }),
    ])
  })

  it('파싱 실패·HTTP 실패는 다시 부르고(기본 2회), 실패 시도도 사용량 원장에 남긴다', async () => {
    geminiFetch([{ status: 503, json: { error: { message: 'busy' } } }, geminiOk('not json'), geminiOk('{"ok":true}')])
    const out = await callLlm({ model: 'gemini-3.1-flash-lite', maxTokens: 100, json: true }, request, (t) =>
      JSON.parse(t)
    )
    expect(out.success).toBe(true)
    expect(h.usage.map((u) => u.success)).toEqual([false, false, true])
    expect(h.usage.map((u) => u.attempts)).toEqual([1, 2, 3])
  })

  it('월 예산이 막히면 부르지 않는다(budget 단계), 키가 없으면 부르지 않는다', async () => {
    const fetchMock = geminiFetch([geminiOk('x')])
    h.budget = { allowed: false, spentUsd: 51, budgetUsd: 50 }
    const blocked = await callLlm({ model: 'gemini-3.5-flash', maxTokens: 100 }, request, parse)
    expect(blocked).toMatchObject({ success: false, error: { stage: 'budget' } })
    h.budget = { allowed: true, spentUsd: 0, budgetUsd: 50 }
    vi.stubEnv('GEMINI_API_KEY', '')
    const noKey = await callLlm({ model: 'gemini-3.5-flash', maxTokens: 100 }, request, parse)
    expect(noKey).toMatchObject({ success: false, error: { message: expect.stringContaining('GEMINI_API_KEY') } })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Gemini 공급자 — 비용·전달 세부(통합 조건 ②: 레지스트리 단가로 실제 계산, 0·대체 단가 금지)', () => {
  it.each(['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3-flash-preview'])(
    '%s: 기록 비용 = 레지스트리 단가 계산값(0도 미등록 최고 단가도 아니다)',
    async (model) => {
      geminiFetch([geminiOk('x', { promptTokenCount: 2000, candidatesTokenCount: 400, thoughtsTokenCount: 600 })])
      const out = await callLlm({ model, maxTokens: 100 }, request, parse)
      const unit = LLM_MODELS[model].costPer1k
      const expected = 2 * unit.input + 1 * unit.output
      const fallback = llmCostPer1k('unknown-model')
      expect(out.usage.cost).toBeCloseTo(expected, 10)
      expect(h.usage[0].costUsd).toBeCloseTo(expected, 10)
      expect(expected).toBeGreaterThan(0)
      expect(expected).not.toBeCloseTo(2 * fallback.input + 1 * fallback.output, 10)
    }
  )

  it('runContext는 성공·실패 시도의 사용량 기록에 모두 실리고, 월 예산은 에이전트·모델로 확인한다', async () => {
    geminiFetch([{ status: 500, json: { error: { message: 'x' } } }, geminiOk('ok')])
    const runContext = { userId: 'user-1', businessId: 'biz-1', stage: 'images' }
    await callLlm({ model: 'gemini-3-flash-preview', maxTokens: 50 }, { ...request, runContext, maxRetries: 1 }, parse)
    expect(h.usage.map((u) => u.runContext)).toEqual([runContext, runContext])
    // 셋째 인자는 예산 풀 — runContext.costPool이 없으면 운영(undefined)
    expect(vi.mocked(checkMonthlyBudget)).toHaveBeenCalledWith('registration/test', 'gemini-3-flash-preview', undefined)
  })

  it('maxRetries 0이면 한 번만, 시간 초과(AbortError)는 timeout 단계 — 요청마다 중단 신호를 건다', async () => {
    const fetchMock = vi.fn(async (_url: string, init: { signal?: AbortSignal }) => {
      expect(init.signal).toBeInstanceOf(AbortSignal)
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const out = await callLlm(
      { model: 'gemini-3.5-flash', maxTokens: 50 },
      { ...request, maxRetries: 0, timeoutMs: 5 },
      parse
    )
    expect(out).toMatchObject({ success: false, error: { stage: 'timeout', attempts: 1 } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('json을 켜지 않으면 JSON 강제(responseMimeType)를 보내지 않는다', async () => {
    const fetchMock = geminiFetch([geminiOk('x')])
    await callLlm({ model: 'gemini-3.5-flash', maxTokens: 50 }, request, parse)
    const [, init] = fetchMock.mock.calls[0] as unknown as FetchCall
    expect(JSON.parse(init.body).generationConfig).toEqual({ maxOutputTokens: 50 })
  })
})

describe('Gemini 4 Argon(J54d) — thinking low·사용량 기록·재시도 0·기한', () => {
  const argon = { model: 'gemini-4-argon', maxTokens: 3000, effort: 'low' as const, json: true }

  it('thinkingConfig.thinkingLevel=low를 보내고, ai_usage_log에 model·실제 토큰·$2/$10 단가 비용을 남긴다', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-08T03:00:00Z') })
    const fetchMock = geminiFetch([geminiOk('{"a":1}', { promptTokenCount: 2000, candidatesTokenCount: 300, thoughtsTokenCount: 200 })])
    const out = await callLlm(argon, { ...request, maxRetries: 0 }, parse)
    const [, init] = fetchMock.mock.calls[0] as unknown as FetchCall
    expect(JSON.parse(init.body).generationConfig).toEqual({
      maxOutputTokens: 3000,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: 'low' },
    })
    expect(out.usage).toEqual({ inputTokens: 2000, outputTokens: 500, cost: expect.closeTo(0.009) })
    expect(h.usage).toEqual([expect.objectContaining({ agent: 'registration/test', model: 'gemini-4-argon', inputTokens: 2000, outputTokens: 500, costUsd: expect.closeTo(0.009), success: true })])
  })

  it('HTTP 오류는 maxRetries 0이면 한 번만 부르고 실패 - 폴백 없음', async () => {
    const fetchMock = geminiFetch([{ status: 503, json: { error: { message: 'busy' } } }])
    const out = await callLlm(argon, { ...request, maxRetries: 0 }, parse)
    expect(out.success).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(h.callAgent).not.toHaveBeenCalled()
  })

  it('키가 없으면 호출하지 않고 실패, 기한이 15초 미만이면 부르지 않는다', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    const fetchMock = geminiFetch([])
    expect((await callLlm(argon, request, parse)).success).toBe(false)
    vi.stubEnv('GEMINI_API_KEY', 'k')
    const late = await callLlm(argon, { ...request, deadlineAt: Date.now() + 5_000 }, parse)
    expect(late).toMatchObject({ success: false, error: { stage: 'timeout' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('thinking을 받지 않는 기존 Gemini 모델에는 thinkingConfig를 보내지 않는다', async () => {
    const fetchMock = geminiFetch([geminiOk('x')])
    await callLlm({ model: 'gemini-3.5-flash', maxTokens: 10, effort: 'low' }, request, parse)
    const [, init] = fetchMock.mock.calls[0] as unknown as FetchCall
    expect(JSON.parse(init.body).generationConfig.thinkingConfig).toBeUndefined()
  })
})

describe('gemini-4-argon 날짜별 단가 - 2026-12-01 00:00 KST 경계', () => {
  const kst = (y: number, m: number, d: number, h: number, mi: number) => new Date(Date.UTC(y, m - 1, d, h - 9, mi))
  it('11-30 23:59 KST는 $2/$10, 12-01 00:00 KST부터 $4/$20', () => {
    expect(llmCostPer1k('gemini-4-argon', kst(2026, 11, 30, 23, 59))).toEqual({ input: 0.002, output: 0.01 })
    expect(llmCostPer1k('gemini-4-argon', kst(2026, 12, 1, 0, 0))).toEqual({ input: 0.004, output: 0.02 })
    expect(llmCostPer1k('gemini-4-argon', new Date(2026, 10, 8, 12))).toEqual({ input: 0.002, output: 0.01 })
    expect(llmCostPer1k('gemini-4-argon', new Date(2026, 11, 2, 12))).toEqual({ input: 0.004, output: 0.02 })
  })
  it('다른 모델은 날짜와 무관', () => {
    expect(llmCostPer1k('gemini-3.5-flash', new Date(2027, 0, 1))).toEqual({ input: 0.0015, output: 0.009 })
  })
})
