/**
 * 구독 CLI 공급자의 run 기한(R11e) — 작업자 단계 기한(deadlineAt)을 API 경로(callAgent)와 같은 규칙으로 지킨다: 시도마다 시간 제한을
 * 남은 시간 안으로, 15초 미만이면 부르지 않고 stage 'timeout'. 기한이 없으면 요청 그대로. 백엔드·사용량 기록은 모의, 시계는 가짜(Date만).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ logs: [] as Array<Record<string, unknown>> }))
vi.mock('../../budget', () => ({
  logUsage: vi.fn(async (entry: Record<string, unknown>) => {
    h.logs.push(entry)
    return true
  }),
}))

import { DEADLINE_EXHAUSTED_MESSAGE } from '../../deadline'
import {
  clearLocalLlmBackends,
  LLM_DEADLINE_EXHAUSTED_CODE,
  LOCAL_LLM_SOFT_STOP_MARKER,
  LlmSoftStopError,
  peekLocalLlmSoftStop,
  registerLocalLlmBackend,
  type LocalLlmBackend,
  type LocalLlmBackendId,
  type LocalLlmRequest,
} from '../local-llm-backend'
import { callWithSubscriptionFallback, type SubscriptionFallbackDeps } from '../subscription-fallback'
import type { LlmRequest, LlmRoute } from '../types'
import { callSubscriptionCli, SUBSCRIPTION_CLI_DEFAULT_TIMEOUT_MS } from './codex-cli'

const T0 = Date.UTC(2026, 10, 9, 5, 0, 0)
/** 작업자 카피 단계 기한(isHostedPdpEnv — 지금 + 280초)과 R11d 뒤 1단 콜 시간 */
const STAGE_DEADLINE_MS = 280_000
const COPY_CALL_MS = 165_000
/** 잡 잠금 실효(PDP_RUN_LEASE_MS 340초 − 여유 30초) */
const LEASE_EFFECTIVE_MS = 310_000

const BACKENDS: Array<{ id: LocalLlmBackendId; route: LlmRoute }> = [
  { id: 'claude-cli', route: { model: 'claude-opus-5-5', maxTokens: 12_000, effort: 'medium', backend: 'subscription' } },
  { id: 'codex-cli', route: { model: 'gpt-6.1-sol', maxTokens: 8192, effort: 'medium', backend: 'subscription' } },
]
const request = (extra: Partial<LlmRequest> = {}): LlmRequest => ({
  system: 'SYS',
  messages: [{ role: 'user', content: 'USR' }],
  agentName: 'registration/pdp-copy',
  runContext: { userId: 'user-1', stage: 'copywriting' },
  ...extra,
})
const parseJson = (text: string) => JSON.parse(text) as { ok: boolean }
const ok = { text: '{"ok":true}', usage: { inputTokens: 10, outputTokens: 5 } }
const softStopErr = (reason: 'timeout' | 'quota') =>
  Object.assign(new Error(`${LOCAL_LLM_SOFT_STOP_MARKER} ${reason}: cli`), { softStop: true, softStopReason: reason })
/** 받은 시간 제한만큼 시계를 돌리고 돌려준다 — 실제 CLI가 그 시간을 다 쓴 꼴 */
const spends = (answer: Awaited<ReturnType<LocalLlmBackend>>) =>
  vi.fn<LocalLlmBackend>(async (req) => {
    vi.setSystemTime(Date.now() + (req.timeoutMs ?? 0))
    return answer
  })

beforeEach(() => {
  h.logs = []
  clearLocalLlmBackends()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => {
  clearLocalLlmBackends()
  vi.useRealTimers()
})

describe.each(BACKENDS)('callSubscriptionCli run 기한 — $id', ({ id, route }) => {
  it('기한이 없으면 요청 그대로 — timeoutMs만(있을 때) 넘기고 deadlineAt은 보내지 않는다', async () => {
    const backend = vi.fn<LocalLlmBackend>(async () => ok)
    registerLocalLlmBackend(id, backend)
    await callSubscriptionCli(route, request({ timeoutMs: COPY_CALL_MS }), parseJson)
    await callSubscriptionCli(route, request(), parseJson)
    const [withTimeout, plain] = backend.mock.calls.map(([req]) => req)
    expect(withTimeout.timeoutMs).toBe(COPY_CALL_MS)
    expect('deadlineAt' in withTimeout).toBe(false)
    expect('timeoutMs' in plain).toBe(false)
    expect('deadlineAt' in plain).toBe(false)
  })

  it('기한이 넉넉하면 시간 제한은 지정값, 모자라면 남은 시간 — 백엔드에도 기한을 넘긴다(timeoutMs가 없으면 백엔드 기본 5분이 상한)', async () => {
    const backend = vi.fn<LocalLlmBackend>(async () => ok)
    registerLocalLlmBackend(id, backend)
    const deadlineAt = T0 + STAGE_DEADLINE_MS
    await callSubscriptionCli(route, request({ timeoutMs: COPY_CALL_MS, deadlineAt }), parseJson)
    await callSubscriptionCli(route, request({ timeoutMs: COPY_CALL_MS, deadlineAt: T0 + 100_000 }), parseJson)
    await callSubscriptionCli(route, request({ deadlineAt: T0 + 600_000 }), parseJson)
    const reqs = backend.mock.calls.map(([req]) => req as LocalLlmRequest)
    expect(reqs.map((r) => r.timeoutMs)).toStrictEqual([COPY_CALL_MS, 100_000, SUBSCRIPTION_CLI_DEFAULT_TIMEOUT_MS])
    expect(reqs.map((r) => r.deadlineAt)).toStrictEqual([deadlineAt, T0 + 100_000, T0 + 600_000])
  })

  it('남은 시간이 15초 미만이면 부르지 않고 stage timeout(사용량 기록 없음) — API 경로와 같은 실패 꼴', async () => {
    const backend = vi.fn<LocalLlmBackend>(async () => ok)
    registerLocalLlmBackend(id, backend)
    const result = await callSubscriptionCli(route, request({ timeoutMs: COPY_CALL_MS, deadlineAt: T0 + 14_999 }), parseJson)
    expect(backend).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: false, error: { stage: 'timeout', message: DEADLINE_EXHAUSTED_MESSAGE, attempts: 0 } })
    expect(h.logs).toHaveLength(0)
  })

  it('백엔드가 기한으로 부르지 않았으면(대기·두 번째 실행) 소프트 종료가 아니라 stage timeout 실패 — 기록이 남지 않는다', async () => {
    registerLocalLlmBackend(
      id,
      vi.fn<LocalLlmBackend>(async () => {
        throw Object.assign(new Error(`${id}: run 기한까지 15초가 남지 않아 부르지 않았습니다`), { code: LLM_DEADLINE_EXHAUSTED_CODE })
      })
    )
    const result = await callSubscriptionCli(route, request({ timeoutMs: COPY_CALL_MS, deadlineAt: T0 + STAGE_DEADLINE_MS }), parseJson)
    expect(result).toMatchObject({ success: false, error: { stage: 'timeout' } })
    expect(result.success ? '' : result.error.message).toContain(DEADLINE_EXHAUSTED_MESSAGE)
    expect(peekLocalLlmSoftStop(id)).toBeNull()
  })

  it('기한에 맞춘 시간 제한이 다 됐으면 stage timeout, 기한이 남은 시간 초과는 지금처럼 소프트 종료', async () => {
    registerLocalLlmBackend(
      id,
      vi.fn<LocalLlmBackend>(async (req) => {
        vi.setSystemTime(Date.now() + (req.timeoutMs ?? 0))
        throw softStopErr('timeout')
      })
    )
    const cut = await callSubscriptionCli(route, request({ timeoutMs: COPY_CALL_MS, deadlineAt: T0 + 100_000 }), parseJson)
    expect(cut).toMatchObject({ success: false, error: { stage: 'timeout' } })
    expect(peekLocalLlmSoftStop(id)).toBeNull()

    vi.setSystemTime(T0)
    const own = callSubscriptionCli(route, request({ timeoutMs: 60_000, deadlineAt: T0 + STAGE_DEADLINE_MS }), parseJson)
    await expect(own).rejects.toBeInstanceOf(LlmSoftStopError)
    expect(peekLocalLlmSoftStop(id)?.reason).toBe('timeout')
  })
})

describe('작업자 카피 단계 — 1단 콜 165초(R11d 뒤)·잘림 재시도여도 단계 기한 280초 안(잠금 실효 310초 안)', () => {
  it('claude-cli 두 번 잘림: 165초 + 115초 = 280초에서 멈추고, 세 번째는 부르지 않는다', async () => {
    const route: LlmRoute = { ...BACKENDS[0].route, failOnTruncation: true }
    const backend = spends({ text: '', usage: { inputTokens: 10, outputTokens: 12_000 }, truncated: true })
    registerLocalLlmBackend('claude-cli', backend)
    const result = await callSubscriptionCli(route, request({ timeoutMs: COPY_CALL_MS, deadlineAt: T0 + STAGE_DEADLINE_MS, maxRetries: 2 }), parseJson)
    expect(backend.mock.calls.map(([req]) => req.timeoutMs)).toStrictEqual([COPY_CALL_MS, STAGE_DEADLINE_MS - COPY_CALL_MS])
    expect(Date.now() - T0).toBe(STAGE_DEADLINE_MS)
    expect(Date.now() - T0).toBeLessThan(LEASE_EFFECTIVE_MS)
    expect(result).toMatchObject({ success: false, error: { stage: 'timeout' } })
    expect(result.success ? '' : result.error.message).toContain('잘린 답')
  })

  it('codex-cli 파싱 실패 재시도도 같다 — 165초 + 115초 안에서 끝난다', async () => {
    const backend = spends({ text: 'not json', usage: null })
    registerLocalLlmBackend('codex-cli', backend)
    await callSubscriptionCli(BACKENDS[1].route, request({ timeoutMs: COPY_CALL_MS, deadlineAt: T0 + STAGE_DEADLINE_MS, maxRetries: 2 }), parseJson)
    expect(backend.mock.calls.map(([req]) => req.timeoutMs)).toStrictEqual([COPY_CALL_MS, STAGE_DEADLINE_MS - COPY_CALL_MS])
    expect(Date.now() - T0).toBeLessThanOrEqual(STAGE_DEADLINE_MS)
  })
})

describe('구독 → API 잇기도 같은 기한(작업자 라우트 subscriptionFallback api)', () => {
  type ApiCall = SubscriptionFallbackDeps<{ ok: boolean }>['api']
  const route: LlmRoute = { ...BACKENDS[0].route, subscriptionFallback: 'api' }
  const apiOk ={ success: true as const, data: { ok: true }, usage: { inputTokens: 1, outputTokens: 1, cost: 0.01 }, duration: 0 }

  it('기한이 남은 구독 시간 초과는 같은 deadlineAt으로 API를 잇는다', async () => {
    registerLocalLlmBackend(
      'claude-cli',
      vi.fn<LocalLlmBackend>(async () => {
        vi.setSystemTime(Date.now() + 60_000)
        throw softStopErr('timeout')
      })
    )
    const api = vi.fn<ApiCall>(async () => apiOk)
    const deadlineAt = T0 + STAGE_DEADLINE_MS
    const result = await callWithSubscriptionFallback(route, request({ timeoutMs: 60_000, deadlineAt }), 'claude-cli', {
      subscription: (r, req) => callSubscriptionCli(r, req, parseJson),
      api,
    })
    expect(result.success).toBe(true)
    expect(api).toHaveBeenCalledTimes(1)
    expect(api.mock.calls[0][1]).toMatchObject({ deadlineAt, timeoutMs: 60_000 })
  })

  it('기한 소진(stage timeout)은 API로 잇지 않는다 — 같은 기한이라 API도 부를 수 없다(이중 과금 없음)', async () => {
    registerLocalLlmBackend('claude-cli', spends({ text: '', usage: null, truncated: true }))
    const api = vi.fn<ApiCall>(async () => apiOk)
    const result = await callWithSubscriptionFallback(
      { ...route, failOnTruncation: true },
      request({ timeoutMs: COPY_CALL_MS, deadlineAt: T0 + STAGE_DEADLINE_MS, maxRetries: 2 }),
      'claude-cli',
      { subscription: (r, req) => callSubscriptionCli(r, req, parseJson), api }
    )
    expect(api).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: false, error: { stage: 'timeout' } })
  })
})
