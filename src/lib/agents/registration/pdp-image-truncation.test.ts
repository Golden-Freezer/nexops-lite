/**
 * 라이트 비전 응답 해석 — 원격 공급자의 finishReason 분기는 없지만, 잘리거나 형식이 깨진 Codex 답을 점수·식별 카드로
 * 받아들이지 않는다. 단계 route와 failOnTruncation 메타데이터는 callAgent 요청까지 보존한다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  texts: [] as string[],
  calls: [] as Array<Record<string, unknown>>,
  stages: [] as string[],
}))

vi.mock('@/lib/registration/pdp-model-routes', () => ({
  pdpRoute: (stage: string) => {
    h.stages.push(stage)
    return stage === 'images/gate' || stage === 'images/gif-gate'
      ? { model: 'gemini-4-argon', maxTokens: 4000, effort: 'high', json: true, failOnTruncation: true }
      : { model: 'gemini-4-argon', maxTokens: 2000, effort: 'high', failOnTruncation: true }
  },
}))
vi.mock('../_base', () => ({
  callAgent: async (options: Record<string, unknown>, parser: (text: string) => unknown) => {
    h.calls.push(options)
    const text = h.texts.shift() ?? ''
    try {
      return { success: true, data: parser(text), usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, duration: 0 }
    } catch (error) {
      return {
        success: false,
        error: { message: error instanceof Error ? error.message : String(error), stage: 'parse', attempts: 1 },
        usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
        duration: 0,
      }
    }
  },
}))

import { judgeImageGate, readIdentityCard } from './pdp-image-agent'

const IMAGE = { mediaType: 'image/png' as const, data: 'AA' }
const GATE_OK = JSON.stringify({ cut: 'hero', has_artifact: false, same_product: true, consistency: 0.95, artifact_reason: '' })

beforeEach(() => {
  h.texts = []
  h.calls = []
  h.stages = []
})

describe('게이트 Codex 답 해석', () => {
  it('정상 JSON 점수만 쓰고 route의 JSON·잘림 방지 메타데이터를 callAgent까지 보존한다', async () => {
    h.texts = [GATE_OK]
    const out = await judgeImageGate(IMAGE, 'hero', IMAGE)
    expect(out.score).toMatchObject({ cut: 'hero', same_product: true, consistency: 0.95 })
    expect(h.stages).toEqual(['images/gate'])
    expect(h.calls[0]).toMatchObject({
      config: { model: 'gemini-4-argon', maxTokens: 4000, effort: 'high' },
      failOnTruncation: true,
    })
  })

  it('잘리거나 형식이 깨진 답은 통과 점수로 쓰지 않는다', async () => {
    h.texts = ['잘린 JSON: [{"cut":"hero"']
    const out = await judgeImageGate(IMAGE, 'hero', IMAGE)
    expect(out.score).toBeNull()
    expect(out.callFailed).toBe(true)
  })

  it('GIF 검사는 별도 images/gif-gate route를 고른다', async () => {
    h.texts = [GATE_OK]
    await judgeImageGate(IMAGE, 'hero', IMAGE, undefined, { timeoutMs: 40_000, maxRetries: 0 }, undefined, 'images/gif-gate')
    expect(h.stages).toEqual(['images/gif-gate'])
    expect(h.calls[0]).toMatchObject({ timeoutMs: 40_000, maxRetries: 0 })
  })
})

describe('식별 카드 Codex 답 해석', () => {
  it('정상 글은 카드로 쓰고 빈·깨진 답은 카드 없이 진행한다', async () => {
    h.texts = ['A white ceramic mug with a gold rim.']
    expect((await readIdentityCard(IMAGE)).card).toContain('gold rim.')

    h.texts = ['']
    expect((await readIdentityCard(IMAGE)).card).toBe('')
    expect(h.calls.at(-1)).toMatchObject({ failOnTruncation: true })
  })
})
