/**
 * 코덱스 구독 공급자(pdp-llm-subscription-backend) — 등록 백엔드 호출, 사용량 기록(0원·토큰·stage #codex), 재시도,
 * 소프트 종료(미등록·한도·시간 초과·이미 남은 기록)는 실패 결과가 아니라 LlmSoftStopError로 던지고 레지스트리에 남긴다(API로
 * 넘어가지 않는다). 백엔드·사용량 기록은 모의.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ logs: [] as Array<Record<string, unknown>> }))
vi.mock('../../budget', () => ({
  logUsage: vi.fn(async (entry: Record<string, unknown>) => {
    h.logs.push(entry)
    return true
  }),
}))

import {
  clearLocalLlmBackends,
  LOCAL_LLM_SOFT_STOP_MARKER,
  LlmSoftStopError,
  noteLocalLlmSoftStop,
  peekLocalLlmSoftStop,
  registerLocalLlmBackend,
  type LocalLlmBackend,
  type LocalLlmBackendId,
} from '../local-llm-backend'
import { assertSubscriptionReady, callCodexCli, callSubscriptionCli, CLAUDE_CLI_STAGE_MARK, CODEX_STAGE_MARK } from './codex-cli'
import type { LlmRoute } from '../types'

const ROUTE: LlmRoute = { model: 'gpt-6.1-sol', maxTokens: 8192, effort: 'high', backend: 'subscription' }
const RUN = { userId: 'user-1', businessId: 'biz-1', stage: 'copywriting' }
const REQ = {
  system: 'SYS',
  messages: [{ role: 'user' as const, content: 'USR' }],
  agentName: 'registration/pdp-copy-stage2',
  runContext: RUN,
}
const parseJson = (text: string) => JSON.parse(text) as { ok: boolean }

beforeEach(() => {
  h.logs = []
  clearLocalLlmBackends()
})
afterEach(() => clearLocalLlmBackends())

function softStopErr(reason: 'quota' | 'timeout' | 'unavailable') {
  return Object.assign(new Error(`${LOCAL_LLM_SOFT_STOP_MARKER} ${reason}: codex-cli`), {
    softStop: true,
    softStopReason: reason,
  })
}

describe('callCodexCli', () => {
  it('등록 백엔드에 모델·effort·메시지·runContext를 넘기고, 0원·토큰·stage #codex로 기록한다', async () => {
    const backend = vi.fn<LocalLlmBackend>(async () => ({
      text: '{"ok":true}',
      usage: { inputTokens: 1200, outputTokens: 300 },
    }))
    registerLocalLlmBackend('codex-cli', backend)
    const result = await callCodexCli(ROUTE, REQ, parseJson)
    expect(result).toMatchObject({
      success: true,
      data: { ok: true },
      usage: { inputTokens: 1200, outputTokens: 300, cost: 0 },
    })
    expect(backend).toHaveBeenCalledWith({
      model: 'gpt-6.1-sol',
      effort: 'high',
      system: 'SYS',
      messages: REQ.messages,
      agentName: REQ.agentName,
      runContext: RUN,
    })
    expect(h.logs).toEqual([
      expect.objectContaining({
        agent: 'registration/pdp-copy-stage2',
        model: 'gpt-6.1-sol',
        inputTokens: 1200,
        outputTokens: 300,
        costUsd: 0,
        success: true,
        attempts: 1,
        runContext: { ...RUN, stage: `copywriting${CODEX_STAGE_MARK}` },
      }),
    ])
  })

  it('effort가 없으면 넘기지 않고, 토큰을 모르면 0으로 기록한다 · 단계가 없으면 표지만', async () => {
    const backend = vi.fn<LocalLlmBackend>(async () => ({ text: '{"ok":true}', usage: null }))
    registerLocalLlmBackend('codex-cli', backend)
    await callCodexCli(
      { model: 'gpt-5.6-luna', maxTokens: 8192, backend: 'subscription' },
      { ...REQ, runContext: undefined },
      parseJson
    )
    expect(backend.mock.calls[0][0]).not.toHaveProperty('effort')
    expect(h.logs[0]).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      runContext: { stage: CODEX_STAGE_MARK },
    })
  })

  it('파싱 실패는 다시 부르고 시도마다 기록한다(토큰 합산) — 그래도 실패면 parse 단계 실패', async () => {
    const backend = vi
      .fn<LocalLlmBackend>()
      .mockResolvedValueOnce({ text: '설명만', usage: { inputTokens: 100, outputTokens: 10 } })
      .mockResolvedValueOnce({ text: '{"ok":true}', usage: { inputTokens: 100, outputTokens: 20 } })
    registerLocalLlmBackend('codex-cli', backend)
    const ok = await callCodexCli(ROUTE, REQ, parseJson)
    expect(ok).toMatchObject({ success: true, usage: { inputTokens: 200, outputTokens: 30, cost: 0 } })
    expect(h.logs.map((l) => [l.success, l.attempts])).toEqual([
      [false, 1],
      [true, 2],
    ])

    backend.mockReset().mockResolvedValue({ text: '설명만', usage: null })
    const bad = await callCodexCli(ROUTE, { ...REQ, maxRetries: 0 }, parseJson)
    expect(bad).toMatchObject({ success: false, error: { stage: 'parse', attempts: 1 } })
    expect(backend).toHaveBeenCalledTimes(1)
  })

  it('소프트 종료가 아닌 백엔드 오류는 다시 부르지 않고(백엔드가 이미 다시 시도) api 단계 실패로 돌려준다(던지지 않는다)', async () => {
    const backend = vi.fn<LocalLlmBackend>(async () => {
      throw new Error('codex-cli 호출 실패(2회 시도): 종료코드 1')
    })
    registerLocalLlmBackend('codex-cli', backend)
    const result = await callCodexCli(ROUTE, REQ, parseJson)
    expect(result).toMatchObject({ success: false, error: { stage: 'api', attempts: 1 }, usage: { cost: 0 } })
    expect(backend).toHaveBeenCalledTimes(1)
    expect(h.logs).toEqual([expect.objectContaining({ success: false })])
    expect(peekLocalLlmSoftStop()).toBeNull()
  })

  it('한도 소진·시간 초과·로그인 만료(모델 미지원)는 기록을 남기고 LlmSoftStopError로 던진다 — 다시 부르지 않는다', async () => {
    for (const reason of ['quota', 'timeout', 'unavailable'] as const) {
      clearLocalLlmBackends()
      h.logs = []
      const backend = vi.fn<LocalLlmBackend>(async () => {
        throw softStopErr(reason)
      })
      registerLocalLlmBackend('codex-cli', backend)
      const error = await callCodexCli(ROUTE, REQ, parseJson).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(LlmSoftStopError)
      expect((error as Error).name).toBe('LlmSoftStopError')
      expect(peekLocalLlmSoftStop()).toMatchObject({ backend: 'codex-cli', reason })
      expect(backend).toHaveBeenCalledTimes(1)
      expect(h.logs).toEqual([expect.objectContaining({ success: false, costUsd: 0 })])
    }
  })

  it('백엔드 미등록은 소프트 종료(unavailable) — API로 넘어가지 않는다', async () => {
    const error = await callCodexCli(ROUTE, REQ, parseJson).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmSoftStopError)
    expect((error as LlmSoftStopError).stop).toMatchObject({ reason: 'unavailable' })
    expect((error as Error).message).toContain(LOCAL_LLM_SOFT_STOP_MARKER)
    expect(peekLocalLlmSoftStop()?.reason).toBe('unavailable')
  })

  it('소프트 종료 기록이 남아 있으면 백엔드를 부르지 않고 바로 던진다(한도·시간 낭비 차단)', async () => {
    const backend = vi.fn<LocalLlmBackend>()
    registerLocalLlmBackend('codex-cli', backend)
    noteLocalLlmSoftStop({ backend: 'codex-cli', reason: 'quota', message: '한도', at: 'x' })
    await expect(callCodexCli(ROUTE, REQ, parseJson)).rejects.toBeInstanceOf(LlmSoftStopError)
    expect(backend).not.toHaveBeenCalled()
    expect(h.logs).toEqual([])
  })

  it('effort max는 코덱스에 없다 — 부르지 않고 실패', async () => {
    const backend = vi.fn<LocalLlmBackend>()
    registerLocalLlmBackend('codex-cli', backend)
    const result = await callCodexCli({ ...ROUTE, effort: 'max' }, REQ, parseJson)
    expect(result).toMatchObject({ success: false, error: { message: expect.stringContaining('max') } })
    expect(backend).not.toHaveBeenCalled()
  })
})

describe('assertSubscriptionReady — 유료 단계 앞 사전 점검', () => {
  it('API 라우트는 아무것도 하지 않는다', () => {
    expect(() => assertSubscriptionReady({ model: 'gpt-5.6-luna', maxTokens: 1 })).not.toThrow()
    expect(peekLocalLlmSoftStop()).toBeNull()
  })

  it('구독 라우트 — 백엔드 미등록이면 unavailable로 기록하고 던진다, 등록돼 있으면 통과', () => {
    expect(() => assertSubscriptionReady(ROUTE)).toThrow(LlmSoftStopError)
    expect(peekLocalLlmSoftStop()?.reason).toBe('unavailable')
    clearLocalLlmBackends()
    registerLocalLlmBackend('codex-cli', vi.fn<LocalLlmBackend>())
    expect(() => assertSubscriptionReady(ROUTE)).not.toThrow()
  })

  it('구독 라우트 — 소프트 종료 기록이 남아 있으면 등록돼 있어도 던진다', () => {
    registerLocalLlmBackend('codex-cli', vi.fn<LocalLlmBackend>())
    noteLocalLlmSoftStop({ backend: 'codex-cli', reason: 'quota', message: '한도', at: 'x' })
    expect(() => assertSubscriptionReady(ROUTE)).toThrow(LlmSoftStopError)
  })
})

describe('표지', () => {
  it('구독 콜 stage 표지는 model-trace(점수 JSON)와 같은 값이다', async () => {
    const trace = await import('../../../../../scripts/pdp-eval/model-trace.mjs')
    expect(trace.CODEX_STAGE_MARK).toBe(CODEX_STAGE_MARK)
  })
})

describe('local-llm-backend 레지스트리', () => {
  it('다른 백엔드가 있으면 덮어쓰지 않고, 해제 함수는 자기 것만 지운다', () => {
    const a = vi.fn<LocalLlmBackend>()
    const b = vi.fn<LocalLlmBackend>()
    const unregister = registerLocalLlmBackend('codex-cli', a)
    expect(() => registerLocalLlmBackend('codex-cli', b)).toThrow(/이미 등록/)
    expect(registerLocalLlmBackend('codex-cli', a)).toBeTypeOf('function')
    unregister()
    expect(() => registerLocalLlmBackend('codex-cli', b)).not.toThrow()
  })
})

describe('Claude 구독(R13) — 같은 공급자 계약, 백엔드 claude-cli', () => {
  const CLAUDE: LlmRoute = { model: 'claude-opus-5-5', maxTokens: 12000, effort: 'medium', backend: 'subscription' }

  it('공급자로 claude-cli를 고르고 상한을 넘기며, 0원·stage #claude-cli로 기록한다(코덱스 백엔드는 부르지 않는다)', async () => {
    const codex = vi.fn<LocalLlmBackend>()
    const claude = vi.fn<LocalLlmBackend>(async () => ({ text: '{"ok":true}', usage: { inputTokens: 900, outputTokens: 120 } }))
    registerLocalLlmBackend('codex-cli', codex)
    registerLocalLlmBackend('claude-cli', claude)
    const result = await callSubscriptionCli(CLAUDE, REQ, parseJson)
    expect(result).toMatchObject({ success: true, usage: { inputTokens: 900, outputTokens: 120, cost: 0 } })
    expect(codex).not.toHaveBeenCalled()
    expect(claude.mock.calls[0][0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium', maxTokens: 12000 })
    expect(h.logs[0]).toMatchObject({ costUsd: 0, runContext: { ...RUN, stage: `copywriting${CLAUDE_CLI_STAGE_MARK}` } })
  })

  it('잘림 감지 route면 잘린 답을 파서에 넘기지 않고 파싱 실패로 세어 다시 부른다 — 감지가 없으면 그대로 넘긴다', async () => {
    const claude = vi
      .fn<LocalLlmBackend>()
      .mockResolvedValueOnce({ text: '{"ok":tr', usage: null, truncated: true })
      .mockResolvedValueOnce({ text: '{"ok":true}', usage: null })
    registerLocalLlmBackend('claude-cli', claude)
    const ok = await callSubscriptionCli({ ...CLAUDE, failOnTruncation: true }, REQ, parseJson)
    expect(ok).toMatchObject({ success: true, data: { ok: true } })
    expect(h.logs.map((l) => l.success)).toEqual([false, true])

    claude.mockReset().mockResolvedValue({ text: '{"ok":true}', usage: null, truncated: true })
    await expect(callSubscriptionCli(CLAUDE, REQ, parseJson)).resolves.toMatchObject({ success: true })
    const bad = await callSubscriptionCli({ ...CLAUDE, failOnTruncation: true }, { ...REQ, maxRetries: 0 }, parseJson)
    expect(bad).toMatchObject({ success: false, error: { stage: 'parse', message: expect.stringContaining('잘린 답'), stopReason: 'max_tokens' } })
  })

  it('구독 전용 모드가 꺼져 있으면(작업자·운영) 답 없이 잘린 빈 글도 지금처럼 파서가 받는다(J43 분기는 하네스만)', async () => {
    const claude = vi.fn<LocalLlmBackend>().mockResolvedValue({ text: '', usage: null, truncated: true })
    registerLocalLlmBackend('claude-cli', claude)
    const parser = vi.fn((text: string) => {
      if (!text) throw new Error('items 배열이 없습니다')
      return text
    })
    const out = await callSubscriptionCli(CLAUDE, { ...REQ, maxRetries: 0 }, parser)
    expect(parser).toHaveBeenCalledWith('')
    expect(out).toMatchObject({ success: false, error: { stage: 'parse', message: 'items 배열이 없습니다' } })
    expect(out.success === false && out.error.stopReason).toBeFalsy()
  })

  it('retryTruncated false(새 단계, R11b)면 잘린 답을 같은 상한·입력으로 다시 부르지 않는다 — 재시도가 남아도 1번', async () => {
    const claude = vi.fn<LocalLlmBackend>().mockResolvedValue({ text: '{"ok":tr', usage: { inputTokens: 900, outputTokens: 12000 }, truncated: true })
    registerLocalLlmBackend('claude-cli', claude)
    const out = await callSubscriptionCli({ ...CLAUDE, failOnTruncation: true }, { ...REQ, maxRetries: 2, retryTruncated: false }, parseJson)
    expect(claude).toHaveBeenCalledTimes(1)
    expect(out).toMatchObject({ success: false, error: { stage: 'parse', attempts: 1, stopReason: 'max_tokens' } })
  })

  it('소프트 종료 기록은 백엔드별이다 — 코덱스 한도가 Claude 구독을 멈추지 않는다', async () => {
    const claude = vi.fn<LocalLlmBackend>(async () => ({ text: '{"ok":true}', usage: null }))
    registerLocalLlmBackend('claude-cli', claude)
    noteLocalLlmSoftStop({ backend: 'codex-cli', reason: 'quota', message: '한도', at: 'x' })
    await expect(callSubscriptionCli(CLAUDE, REQ, parseJson)).resolves.toMatchObject({ success: true })
    await expect(callSubscriptionCli(ROUTE, REQ, parseJson)).rejects.toBeInstanceOf(LlmSoftStopError)
    expect(peekLocalLlmSoftStop('claude-cli')).toBeNull()
    expect(peekLocalLlmSoftStop('codex-cli')?.reason).toBe('quota')
    expect(peekLocalLlmSoftStop()?.backend).toBe('codex-cli')
  })

  it('Claude 구독은 effort max를 받는다(codex만 없다)', async () => {
    const claude = vi.fn<LocalLlmBackend>(async () => ({ text: '{"ok":true}', usage: null }))
    registerLocalLlmBackend('claude-cli', claude)
    await expect(callSubscriptionCli({ ...CLAUDE, effort: 'max' }, REQ, parseJson)).resolves.toMatchObject({ success: true })
    expect(claude.mock.calls[0][0].effort).toBe('max')
  })

  it('API로 잇는 작업자 라우트는 사전 점검에서 멈추지 않는다(미등록·남은 기록이어도) — 잇기는 subscription-fallback이 맡는다', () => {
    noteLocalLlmSoftStop({ backend: 'claude-cli', reason: 'quota', message: '한도', at: 'x' })
    expect(() => assertSubscriptionReady({ ...CLAUDE, subscriptionFallback: 'api' })).not.toThrow()
    expect(() => assertSubscriptionReady(CLAUDE)).toThrow(LlmSoftStopError)
    clearLocalLlmBackends()
    expect(() => assertSubscriptionReady({ ...ROUTE, subscriptionFallback: 'api' })).not.toThrow()
    expect(peekLocalLlmSoftStop()).toBeNull()
  })
})

describe('구독 행 cost 0 고정(AX-PL-17 ④b — 구독 업무는 월 300달러 상한 합계에서 뺀다)', () => {
  const ROUTES: Array<[LocalLlmBackendId, LlmRoute, string]> = [
    ['codex-cli', ROUTE, CODEX_STAGE_MARK],
    ['claude-cli', { model: 'claude-opus-5-5', maxTokens: 12000, effort: 'medium', backend: 'subscription' }, CLAUDE_CLI_STAGE_MARK],
  ]

  it.each(ROUTES)('%s — 성공·파싱 실패·백엔드 오류·토큰 모름 어느 시도도 costUsd 0, 표지는 그 백엔드 것', async (backendId, route, mark) => {
    const backend = vi
      .fn<LocalLlmBackend>()
      .mockResolvedValueOnce({ text: '설명만', usage: { inputTokens: 5_000_000, outputTokens: 2_000_000 } })
      .mockResolvedValueOnce({ text: '{"ok":true}', usage: { inputTokens: 5_000_000, outputTokens: 2_000_000 } })
      .mockResolvedValueOnce({ text: '설명만', usage: null })
      .mockRejectedValueOnce(new Error('호출 실패(2회 시도): 종료코드 1'))
    registerLocalLlmBackend(backendId, backend)
    await callSubscriptionCli(route, REQ, parseJson) // 파싱 실패 → 성공(큰 토큰이어도 0원)
    await callSubscriptionCli(route, { ...REQ, maxRetries: 0 }, parseJson) // 파싱 실패
    await callSubscriptionCli(route, REQ, parseJson) // 백엔드 오류
    expect(h.logs).toHaveLength(4)
    expect(h.logs.map((l) => l.costUsd)).toEqual([0, 0, 0, 0])
    expect(h.logs.every((l) => String((l.runContext as { stage?: string }).stage).endsWith(mark))).toBe(true)
  })
})
