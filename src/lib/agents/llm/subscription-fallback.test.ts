/**
 * 구독 → 같은 모델 API 잇기(R13, 오너 I2-3) — 소프트 종료·프로세스 실패면 같은 route를 API로 한 번(stage #sub→api, 기록 1건·청구액),
 * 파싱 실패·성공은 잇지 않는다, 남은 소프트 종료 기록이 15분 안이면 구독을 건너뛰고 지나면 지우고 다시 구독. 구독·API는 모의.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentOutput } from '../types'
import { clearLocalLlmBackends, LlmSoftStopError, noteLocalLlmSoftStop, peekLocalLlmSoftStop } from './local-llm-backend'
import {
  apiRouteOf,
  callWithSubscriptionFallback,
  collectSubscriptionFallbacks,
  SOFT_STOP_RETRY_AFTER_MS,
  SUBSCRIPTION_FALLBACK_STAGE_MARK,
  type SubscriptionFallbackRecord,
} from './subscription-fallback'
import type { LlmRequest, LlmRoute } from './types'

const ROUTE: LlmRoute = {
  model: 'claude-opus-5-5',
  maxTokens: 12000,
  effort: 'medium',
  failOnTruncation: true,
  backend: 'subscription',
  subscriptionFallback: 'api',
}
const REQ: LlmRequest = {
  system: 's',
  messages: [{ role: 'user', content: 'u' }],
  agentName: 'registration/pdp-copy',
  runContext: { userId: 'u1', stage: 'copywriting', runId: 'job-1' },
}
const NOW = Date.parse('2026-11-09T02:00:00Z')
const ok = (cost: number): AgentOutput<string> => ({ success: true, data: 'ok', usage: { inputTokens: 1, outputTokens: 1, cost }, duration: 1 })
const fail = (stage: 'api' | 'parse'): AgentOutput<string> => ({
  success: false,
  error: { message: `${stage} 실패`, stage, attempts: 1 },
  usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
  duration: 1,
})
const softStop = (reason: 'quota' | 'timeout' | 'unavailable') =>
  new LlmSoftStopError({ backend: 'claude-cli', reason, message: `${reason} 글`, at: new Date(NOW).toISOString() })

function deps(subscription: () => Promise<AgentOutput<string>>, apiCost = 0.21) {
  return {
    subscription: vi.fn(subscription),
    api: vi.fn(async () => ok(apiCost)),
    now: () => NOW,
  }
}

async function run(d: ReturnType<typeof deps>) {
  const records: SubscriptionFallbackRecord[] = []
  const out = await collectSubscriptionFallbacks(records, () => callWithSubscriptionFallback(ROUTE, REQ, 'claude-cli', d))
  return { out, records }
}

beforeEach(() => clearLocalLlmBackends())
afterEach(() => clearLocalLlmBackends())

describe('callWithSubscriptionFallback', () => {
  it('구독이 성공하면 API를 부르지 않고 기록도 없다', async () => {
    const d = deps(async () => ok(0))
    const { out, records } = await run(d)
    expect(out).toMatchObject({ success: true, usage: { cost: 0 } })
    expect(d.api).not.toHaveBeenCalled()
    expect(records).toEqual([])
  })

  it('소프트 종료(한도·시간 초과·로그인)는 같은 route를 API로 한 번 — stage 표지·청구액·사유를 남긴다', async () => {
    for (const reason of ['quota', 'timeout', 'unavailable'] as const) {
      const d = deps(async () => {
        throw softStop(reason)
      })
      const { out, records } = await run(d)
      expect(out, reason).toMatchObject({ success: true, usage: { cost: 0.21 } })
      expect(d.api).toHaveBeenCalledTimes(1)
      const [route, request] = d.api.mock.calls[0] as unknown as [LlmRoute, LlmRequest]
      expect(route).toEqual(apiRouteOf(ROUTE))
      expect(route).toEqual({ model: 'claude-opus-5-5', maxTokens: 12000, effort: 'medium', failOnTruncation: true, backend: 'api' })
      expect(request.runContext).toEqual({ ...REQ.runContext, stage: `copywriting${SUBSCRIPTION_FALLBACK_STAGE_MARK}` })
      expect(records).toEqual([
        {
          stage: 'copywriting',
          agent: 'registration/pdp-copy',
          model: 'claude-opus-5-5',
          backend: 'claude-cli',
          reason,
          detail: `${reason} 글`,
          apiSuccess: true,
          costUsd: 0.21,
          at: new Date(NOW).toISOString(),
        },
      ])
    }
  })

  it('프로세스 실패(실패 결과 stage api)는 API로 잇고, 파싱 실패는 잇지 않는다(모델이 답했다)', async () => {
    const processFail = deps(async () => fail('api'))
    const a = await run(processFail)
    expect(a.out.success).toBe(true)
    expect(a.records[0]).toMatchObject({ reason: 'process', detail: 'api 실패' })

    const parseFail = deps(async () => fail('parse'))
    const b = await run(parseFail)
    expect(b.out).toMatchObject({ success: false, error: { stage: 'parse' } })
    expect(parseFail.api).not.toHaveBeenCalled()
    expect(b.records).toEqual([])
  })

  it('API 잇기도 실패하면 그 결과를 돌려주고 기록에 apiSuccess false·청구액을 남긴다', async () => {
    const d = { ...deps(async () => fail('api')), api: vi.fn(async () => ({ ...fail('api'), usage: { inputTokens: 5, outputTokens: 0, cost: 0.02 } })) }
    const { out, records } = await run(d)
    expect(out.success).toBe(false)
    expect(records[0]).toMatchObject({ apiSuccess: false, costUsd: 0.02 })
  })

  it('그 백엔드의 소프트 종료 기록이 15분 안이면 구독을 부르지 않고 바로 API(skipped) — 지나면 지우고 다시 구독', async () => {
    noteLocalLlmSoftStop({ backend: 'claude-cli', reason: 'quota', message: '한도', at: new Date(NOW - 60_000).toISOString() })
    const fresh = deps(async () => ok(0))
    const a = await run(fresh)
    expect(fresh.subscription).not.toHaveBeenCalled()
    expect(a.records[0]).toMatchObject({ reason: 'skipped', detail: 'quota: 한도' })

    noteLocalLlmSoftStop({
      backend: 'claude-cli',
      reason: 'quota',
      message: '한도',
      at: new Date(NOW - SOFT_STOP_RETRY_AFTER_MS).toISOString(),
    })
    const old = deps(async () => ok(0))
    const b = await run(old)
    expect(old.subscription).toHaveBeenCalledTimes(1)
    expect(old.api).not.toHaveBeenCalled()
    expect(b.records).toEqual([])
    expect(peekLocalLlmSoftStop('claude-cli')).toBeNull()
  })

  it('시간 초과는 그 콜만 잇고 기록을 지운다 — 다음 콜은 다시 구독(짧은 콜 시간 한 번이 구독 전체를 멈추지 않게)', async () => {
    const timedOut = deps(async () => {
      noteLocalLlmSoftStop({ backend: 'claude-cli', reason: 'timeout', message: '40초', at: new Date(NOW).toISOString() })
      throw softStop('timeout')
    })
    const a = await run(timedOut)
    expect(a.records[0]).toMatchObject({ reason: 'timeout' })
    expect(peekLocalLlmSoftStop('claude-cli')).toBeNull()

    noteLocalLlmSoftStop({ backend: 'claude-cli', reason: 'timeout', message: '40초', at: new Date(NOW).toISOString() })
    const next = deps(async () => ok(0))
    const b = await run(next)
    expect(next.subscription).toHaveBeenCalledTimes(1)
    expect(b.records).toEqual([])
  })

  it('다른 백엔드의 기록은 보지 않는다 · 소프트 종료가 아닌 예외는 그대로 던진다 · 모으는 곳이 없어도 잇는다', async () => {
    noteLocalLlmSoftStop({ backend: 'codex-cli', reason: 'quota', message: '한도', at: new Date(NOW).toISOString() })
    const d = deps(async () => ok(0))
    await run(d)
    expect(d.subscription).toHaveBeenCalledTimes(1)

    const boom = deps(async () => {
      throw new Error('예상 밖')
    })
    await expect(run(boom)).rejects.toThrow('예상 밖')
    expect(boom.api).not.toHaveBeenCalled()

    const bare = deps(async () => {
      throw softStop('quota')
    })
    await expect(callWithSubscriptionFallback(ROUTE, REQ, 'claude-cli', bare)).resolves.toMatchObject({ success: true })
  })

  it('모은 기록은 fn이 던져도 남는다', async () => {
    const records: SubscriptionFallbackRecord[] = []
    const d = deps(async () => {
      throw softStop('quota')
    })
    await expect(
      collectSubscriptionFallbacks(records, async () => {
        await callWithSubscriptionFallback(ROUTE, REQ, 'claude-cli', d)
        throw new Error('단계 실패')
      })
    ).rejects.toThrow('단계 실패')
    expect(records).toHaveLength(1)
  })
})
