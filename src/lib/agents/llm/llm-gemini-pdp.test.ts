/**
 * PDP 경로 Gemini 허용·Gemini 잘림 감지(R02) — 오너 2026-11-07 18:53("GEMINI와 이미지 생성 등 꼭 API를 사용하는 것을 제외하고 구독")에
 * 따라 PDP 단계 라우트를 gemini-4-argon(thinkingLevel high)으로 두면 callLlm이 막지 않고 API로 부른다. failOnTruncation이면
 * finishReason MAX_TOKENS·빈 답을 파싱 실패로 세어 다시 부르고, 끄면 지금과 같다. HTTP·DB는 모의(유료 호출 0).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ usage: [] as Array<Record<string, unknown>> }))

vi.mock('../budget', () => ({
  checkMonthlyBudget: vi.fn(async () => ({ allowed: true, spentUsd: 0, budgetUsd: 50 })),
  logUsage: vi.fn(async (entry: Record<string, unknown>) => {
    h.usage.push(entry)
    return true
  }),
}))
vi.mock('@/lib/monitoring/logger', () => ({ agentLogger: { warn: vi.fn(), info: vi.fn() } }))

import type { PdpModelRoute } from '@/lib/registration/pdp-model-routes'
import { callLlm } from './index'

type Candidate = { text: string; finishReason: string }
type FetchCall = [string, { body: string }]

function geminiFetch(candidates: Candidate[]) {
  const fetchMock = vi.fn(async () => {
    const next = candidates.shift()!
    const json = {
      candidates: [{ content: { parts: next.text ? [{ text: next.text }] : [] }, finishReason: next.finishReason }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 20 },
    }
    return { ok: true, status: 200, json: async () => json } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const request = { system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }], agentName: 'registration/pdp-image-gate' }
const json = (text: string) => JSON.parse(text) as Record<string, unknown>

/** 새 배치 게이트 모양(오너 11-08 ② 게이트 Argon high · ③ 출력 상한 4,000) — 표 반영은 R03 */
const ARGON_GATE: PdpModelRoute = { model: 'gemini-4-argon', maxTokens: 4000, effort: 'high', json: true, failOnTruncation: true }

beforeEach(() => {
  h.usage = []
  vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('PDP 경로 Gemini 허용', () => {
  it('PDP 단계 라우트 gemini-4-argon effort high — 막지 않고 thinkingLevel high·상한·JSON 강제를 보낸다', async () => {
    const fetchMock = geminiFetch([{ text: '{"cut":"hero"}', finishReason: 'STOP' }])
    const out = await callLlm(ARGON_GATE, request, json)
    expect(out).toMatchObject({ success: true, data: { cut: 'hero' } })
    const [url, init] = fetchMock.mock.calls[0] as unknown as FetchCall
    expect(url).toMatch(/gemini-4-argon:generateContent$/)
    expect(JSON.parse(init.body).generationConfig).toEqual({
      maxOutputTokens: 4000,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: 'high' },
    })
  })
})

describe('Gemini 잘림 감지(failOnTruncation)', () => {
  it('MAX_TOKENS로 끊긴 답은 파서에 넘기지 않고 다시 부른다 — 두 번째가 정상이면 성공', async () => {
    // 잘린 JSON이 우연히 파싱되는 꼴('{}')이어도 실패로 센다
    const fetchMock = geminiFetch([
      { text: '{}', finishReason: 'MAX_TOKENS' },
      { text: '{"cut":"hero"}', finishReason: 'STOP' },
    ])
    const out = await callLlm(ARGON_GATE, { ...request, maxRetries: 1 }, json)
    expect(out).toMatchObject({ success: true, data: { cut: 'hero' } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(h.usage.map((u) => u.success)).toEqual([false, true])
  })

  it('끝까지 잘리면 실패 — parse 단계, stopReason max_tokens', async () => {
    geminiFetch([
      { text: '{}', finishReason: 'MAX_TOKENS' },
      { text: '{}', finishReason: 'MAX_TOKENS' },
    ])
    const out = await callLlm(ARGON_GATE, { ...request, maxRetries: 1 }, json)
    expect(out.success).toBe(false)
    if (!out.success) {
      expect(out.error).toMatchObject({ stage: 'parse', attempts: 2, stopReason: 'max_tokens' })
      expect(out.error.message).toMatch(/MAX_TOKENS/)
    }
  })

  it('빈 답(생각만 하고 답 파트 없음)도 실패로 센다', async () => {
    geminiFetch([{ text: '', finishReason: 'STOP' }])
    const out = await callLlm(
      { model: 'gemini-4-argon', maxTokens: 2000, effort: 'high', failOnTruncation: true },
      { ...request, agentName: 'registration/pdp-image-identity', maxRetries: 0 },
      (text) => text
    )
    expect(out.success).toBe(false)
    if (!out.success) expect(out.error).toMatchObject({ stage: 'parse', stopReason: 'STOP' })
  })

  it('끄면 지금과 같다 — 잘린 답도 파서가 받고, 실패 객체에 stopReason이 없다', async () => {
    geminiFetch([{ text: 'cut', finishReason: 'MAX_TOKENS' }])
    const ok = await callLlm({ model: 'gemini-4-argon', maxTokens: 400 }, { ...request, maxRetries: 0 }, (t) => t)
    expect(ok).toMatchObject({ success: true, data: 'cut' })
    geminiFetch([{ text: 'not json', finishReason: 'MAX_TOKENS' }])
    const bad = await callLlm({ model: 'gemini-4-argon', maxTokens: 400 }, { ...request, maxRetries: 0 }, json)
    expect(bad.success).toBe(false)
    if (!bad.success) expect(bad.error).not.toHaveProperty('stopReason')
  })
})
