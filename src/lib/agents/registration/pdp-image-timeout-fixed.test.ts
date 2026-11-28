/**
 * M 갈래 시간 제한 배율(pdp-llm-subscription-backend, 검수 지적 N1) — run 예산에서 계산한 시간 제한(이미지 게이트의 남은 시간
 * 제한·장식 위치 25초)에는 배율을 곱하지 않는다(곱하면 run이 잡 진행 잠금 기한을 넘는다). 고정 제한이 아닌 게이트 기본값은 곱한다.
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

import { M_ARM_TIMEOUT_SCALE } from '@/lib/registration/pdp-model-routes'
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

describe('M 갈래 — 예산 고정 시간 제한은 배율 없이', () => {
  it('게이트: 남은 시간에서 계산한 제한은 그대로, 기본 60초는 배율을 곱한다', async () => {
    await judgeImageGate(IMAGE, 'hero', IMAGE, undefined, { timeoutMs: 55_000, maxRetries: 0 })
    expect(h.calls[0]).toMatchObject({ timeoutMs: 55_000, maxRetries: 0 })
    await judgeImageGate(IMAGE, 'hero', IMAGE)
    expect(h.calls[1].timeoutMs).toBe(60_000 * M_ARM_TIMEOUT_SCALE)
  })

  it('장식 위치: run 예산 짝(ANNOTATION_ESTIMATE_MS)인 25초는 그대로', async () => {
    await locateAnnotations(IMAGE, ['라벨'], ['label'])
    expect(h.calls[0].timeoutMs).toBe(25_000)
  })
})
