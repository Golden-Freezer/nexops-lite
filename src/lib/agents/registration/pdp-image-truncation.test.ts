/**
 * 게이트·식별 카드 잘림 감지(R02) — 두 단계는 pdpRoute 라우트를 callLlm에 그대로 넘기므로, 라우트에 failOnTruncation이 있으면
 * 잘린 답(finishReason MAX_TOKENS)·빈 답을 실패로 세어 한 번 더 부른다. 끝까지 잘리면 지금 실패 처리 그대로(게이트 통과 처리 =
 * score null, 식별 카드 = 카드 없이 진행 — 새 배치 잡의 실패 컷 처리는 R03). 새 배치 라우트 모양만 모의로 주고 표는 바꾸지 않는다.
 * HTTP·DB는 모의(유료 호출 0).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ replies: [] as Array<{ text: string; finishReason: string }>, calls: 0, stages: [] as string[] }))

vi.mock('@/lib/registration/pdp-model-routes', () => ({
  // 오너 11-08 ② 게이트·식별 카드 Argon high · ③ 상한 4,000·2,000(표 반영은 R03)
  pdpRoute: (stage: string) => (
    h.stages.push(stage),
    stage === 'images/gate' || stage === 'images/gif-gate'
      ? { model: 'gemini-4-argon', maxTokens: 4000, effort: 'high', json: true, failOnTruncation: true }
      : { model: 'gemini-4-argon', maxTokens: 2000, effort: 'high', failOnTruncation: true }
  ),
}))
vi.mock('../budget', () => ({
  checkMonthlyBudget: vi.fn(async () => ({ allowed: true, spentUsd: 0, budgetUsd: 50 })),
  logUsage: vi.fn(async () => true),
}))
vi.mock('@/lib/monitoring/logger', () => ({ agentLogger: { warn: vi.fn(), info: vi.fn() } }))

import { judgeImageGate, readIdentityCard } from './pdp-image-agent'

const IMAGE = { mediaType: 'image/png' as const, data: 'AA' }
const GATE_OK = JSON.stringify({ cut: 'hero', has_artifact: false, same_product: true, consistency: 0.95, artifact_reason: '' })
const LIMITS = { timeoutMs: 30_000, maxRetries: 1 }

beforeEach(() => {
  h.replies = []
  h.calls = 0
  h.stages = []
  vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      h.calls++
      const next = h.replies.shift()!
      const json = {
        candidates: [{ content: { parts: next.text ? [{ text: next.text }] : [] }, finishReason: next.finishReason }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      }
      return { ok: true, status: 200, json: async () => json } as unknown as Response
    })
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('게이트 잘림 감지', () => {
  it('잘린 채점 답은 한 번 더 부르고, 두 번째가 정상이면 그 점수를 쓴다', async () => {
    // 잘린 답은 관용 파서가 읽어 내더라도 점수로 쓰지 않는다
    h.replies = [
      { text: '[{"cut":"hero","has_artifact":false', finishReason: 'MAX_TOKENS' },
      { text: GATE_OK, finishReason: 'STOP' },
    ]
    const { score } = await judgeImageGate(IMAGE, 'hero', IMAGE, undefined, LIMITS)
    expect(h.calls).toBe(2)
    expect(score).toMatchObject({ cut: 'hero', same_product: true, consistency: 0.95 })
  })

  // '{}'는 감지가 없으면 1행 점수로 읽히는 꼴이다(parseGateRows 단일 객체 수용)
  it('끝까지 잘리면 지금 실패 처리 그대로(score null — 새 배치 실패 컷 처리는 R03)', async () => {
    h.replies = [
      { text: '{}', finishReason: 'MAX_TOKENS' },
      { text: '{}', finishReason: 'MAX_TOKENS' },
    ]
    const out = await judgeImageGate(IMAGE, 'hero', IMAGE, undefined, LIMITS)
    expect(h.calls).toBe(2)
    expect(out.score).toBeNull()
    // 잘림 감지 route의 끝까지 잘림은 '판정 못 함'으로 가른다(R03 — 이미지 단계가 컷 기록에 경고)
    expect(out.truncated).toBe(true)
  })

  it('GIF 검사는 따로 고른 단계(images/gif-gate) route로 부른다(R03)', async () => {
    h.replies = [{ text: GATE_OK, finishReason: 'STOP' }]
    const { score } = await judgeImageGate(IMAGE, 'hero', IMAGE, undefined, { timeoutMs: 40_000, maxRetries: 0 }, undefined, 'images/gif-gate')
    expect(h.stages).toEqual(['images/gif-gate'])
    expect(score).toMatchObject({ cut: 'hero' })
  })
})

describe('식별 카드 잘림 감지', () => {
  it('잘린 카드(파서가 글을 그대로 받는 단계)도 다시 부르고, 끝까지 잘리면 카드 없이 진행한다', async () => {
    h.replies = [
      { text: 'A white ceramic mug with a gold', finishReason: 'MAX_TOKENS' },
      { text: 'A white ceramic mug with a gold rim.', finishReason: 'STOP' },
    ]
    const first = await readIdentityCard(IMAGE)
    expect(h.calls).toBe(2)
    expect(first.card).toContain('gold rim.')

    h.calls = 0
    h.replies = [
      { text: 'A white', finishReason: 'MAX_TOKENS' },
      { text: '', finishReason: 'STOP' },
      { text: 'A white', finishReason: 'MAX_TOKENS' },
    ]
    const none = await readIdentityCard(IMAGE)
    expect(h.calls).toBe(3)
    expect(none.card).toBe('')
  })
})
