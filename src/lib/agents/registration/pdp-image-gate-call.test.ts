/**
 * 이미지 게이트 콜 시간·호출 실패 표시 — 라이트 새 배치 게이트는 route 콜 시간 30분·재시도 1을 쓰고,
 * 3/28콜 60초 시간 초과), 지금 배치는 지금 값(60초·에이전트 기본 재시도) 그대로다. 잘림이 아닌 호출 실패에는 callFailed를 달고
 * (정책은 부르는 쪽 — pdp-image-stage), 잘림은 지금처럼 truncated만 단다. 공급자 호출은 모의(유료 0)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmRequest, LlmRoute } from '../llm/types'

const h = vi.hoisted(() => ({
  calls: [] as Array<{ route: LlmRoute; request: LlmRequest }>,
  reply: null as unknown,
}))

vi.mock('../llm', () => ({
  callLlm: vi.fn(async (route: LlmRoute, request: LlmRequest) => {
    h.calls.push({ route, request })
    return h.reply
  }),
}))

import { runWithPdpBatch } from '@/lib/registration/pdp-model-batch-context'
import { judgeImageGate } from './pdp-image-agent'

const IMAGE = { mediaType: 'image/png' as const, data: 'AA' }
const OK = {
  success: true,
  data: [{ cut: 'hero', has_artifact: false, same_product: true, consistency: 0.95, artifact_reason: '' }],
  usage: { inputTokens: 1, outputTokens: 1, cost: 0.002 },
  duration: 1,
}
const fail = (stage: string, extra: Record<string, unknown> = {}) => ({
  success: false,
  error: { message: stage === 'timeout' ? '타임아웃(90000ms)' : '실패', stage, attempts: 2, ...extra },
  usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
  duration: 1,
  spent: { inputTokens: 10, outputTokens: 10, cost: 0.004 },
})

beforeEach(() => {
  h.calls = []
  h.reply = OK
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('게이트 콜 시간 — 새 배치 route 값, 지금 배치는 지금 값', () => {
  it('새 배치: limits 없으면 30분·재시도 1, limits가 있으면 그 값(배율 없이 고정)', async () => {
    await runWithPdpBatch('new', () => judgeImageGate(IMAGE, 'hero', IMAGE))
    expect(h.calls[0].route.model).toBe('gemini-4-argon')
    expect(h.calls[0].request).toMatchObject({ timeoutMs: 25 * 60_000, maxRetries: 1 })
    expect(h.calls[0].request).not.toHaveProperty('timeoutFixed')
    await runWithPdpBatch('new', () => judgeImageGate(IMAGE, 'hero', IMAGE, undefined, { timeoutMs: 65_000, maxRetries: 0 }))
    expect(h.calls[1].request).toMatchObject({ timeoutMs: 65_000, maxRetries: 0, timeoutFixed: true })
  })

  it('지금 배치: 60초, 재시도 칸 없음(에이전트 기본) — 요청 모양 그대로', async () => {
    await judgeImageGate(IMAGE, 'hero', IMAGE)
    expect(h.calls[0].route.model).toBe('claude-sonnet-5-5')
    expect(h.calls[0].request.timeoutMs).toBe(60_000)
    expect(h.calls[0].request).not.toHaveProperty('maxRetries')
  })

  it('GIF 검사는 부르는 쪽 limits(40초·재시도 0) 그대로', async () => {
    await runWithPdpBatch('new', () => judgeImageGate(IMAGE, 'motion', IMAGE, undefined, { timeoutMs: 40_000, maxRetries: 0 }, undefined, 'images/gif-gate'))
    expect(h.calls[0].request).toMatchObject({ timeoutMs: 40_000, maxRetries: 0 })
  })
})

describe('호출 실패 표시 — callFailed(정책은 부르는 쪽), 잘림은 truncated만', () => {
  it('시간 초과·API 오류·해석 실패는 score null + callFailed, 실패한 시도 값도 비용에(R12d spent)', async () => {
    for (const stage of ['timeout', 'api', 'parse']) {
      h.reply = fail(stage)
      const out = await runWithPdpBatch('new', () => judgeImageGate(IMAGE, 'hero', IMAGE))
      expect(out, stage).toEqual({ score: null, costUsd: 0.004, callFailed: true })
    }
  })

  it('새 배치 잘림(parse + stopReason)은 truncated만 — callFailed 없음', async () => {
    h.reply = fail('parse', { stopReason: 'max_tokens' })
    const out = await runWithPdpBatch('new', () => judgeImageGate(IMAGE, 'hero', IMAGE))
    expect(out).toEqual({ score: null, costUsd: 0.004, truncated: true })
  })

  it('성공은 그대로 — 점수 행과 비용', async () => {
    const out = await runWithPdpBatch('new', () => judgeImageGate(IMAGE, 'hero', IMAGE))
    expect(out).toEqual({ score: OK.data[0], costUsd: 0.002 })
  })
})
