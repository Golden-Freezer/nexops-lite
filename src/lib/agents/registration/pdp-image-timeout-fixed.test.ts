/**
 * 라이트는 원격 모델 갈래 배율을 적용하지 않는다. run 예산에서 계산한 제한과 에이전트 기본 제한을 요청 모양 그대로 넘긴다.
 * 공급자는 모의(유료 호출 0).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }))

vi.mock('../_base', () => ({
  callAgent: async (options: Record<string, unknown>, parser: (t: string) => unknown) => {
    h.calls.push(options)
    const text = String(options.agentName).includes('annotation')
      ? '[{"kind":"label","text":"라벨","x":0.5,"y":0.5}]'
      : JSON.stringify({ has_artifact: false, same_product: true, consistency: 0.95, artifact_reason: '' })
    return { success: true, data: parser(text), usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, duration: 0 }
  },
}))

import { locateAnnotations } from './pdp-annotation-agent'
import { judgeImageGate } from './pdp-image-agent'

const IMAGE = { mediaType: 'image/png' as const, data: 'AA' }
const saved = process.env.NEXOPS_PDP_MODEL_ARM

beforeEach(() => {
  h.calls = []
  process.env.NEXOPS_PDP_MODEL_ARM = 'M'
})
afterEach(() => {
  if (saved === undefined) delete process.env.NEXOPS_PDP_MODEL_ARM
  else process.env.NEXOPS_PDP_MODEL_ARM = saved
})

describe('라이트 — 원격 모델 갈래 시간 배율 없음', () => {
  it('게이트: 남은 시간에서 계산한 제한과 기본 60초를 그대로 넘긴다', async () => {
    await judgeImageGate(IMAGE, 'hero', IMAGE, undefined, { timeoutMs: 55_000, maxRetries: 0 })
    expect(h.calls[0]).toMatchObject({ timeoutMs: 55_000, maxRetries: 0 })
    await judgeImageGate(IMAGE, 'hero', IMAGE)
    expect(h.calls[1].timeoutMs).toBe(60_000)
  })

  it('장식 위치: run 예산 짝(ANNOTATION_ESTIMATE_MS)인 25초는 그대로', async () => {
    await locateAnnotations(IMAGE, ['라벨'], ['label'])
    expect(h.calls[0].timeoutMs).toBe(25_000)
  })
})
