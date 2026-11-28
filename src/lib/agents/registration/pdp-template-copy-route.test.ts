/**
 * K 칸 카피 에이전트의 재현 선택(하네스 J30) — route를 주면 그 모델로 같은 프롬프트를 부르고, onCall은 콜마다 흔적(성공·토큰·비용·끝난 까닭)을 받는다.
 * 선택이 없으면 단계 표(copy/template-slots) 그대로다. 공급자 호출은 모의다(유료 호출 0)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ callLlm: vi.fn() }))
vi.mock('../llm', () => ({ callLlm: (...a: unknown[]) => h.callLlm(...a) }))

import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import { PDP_MODEL_ROUTES } from '@/lib/registration/pdp-model-routes'
import { fillTemplateSlots, type SlotCopyCallTrace } from './pdp-template-copy-agent'
import { buildSlotCopyPrompt, type SlotCopySection } from './prompts/pdp-template-copy-prompts'

const spec = { material: '면' } as unknown as PdpSpecSheet
const sections: SlotCopySection[] = [{ index: 0, section: 'hook_3step', factSlots: 0, slots: [{ name: 'headline', required: true, facts: 0, maxChars: 12 }] }]
const input = { product: { category: 'household', persona: null, summary: '', keywords: [], usps: [], pains: [] }, guideline: { persona: '', tone: '' }, facts: [], spec, sections }
const RUN = { userId: 'user-1', stage: 'images/templatelib' }
const OPUS = { model: 'claude-opus-5-5', maxTokens: 8000, effort: 'low' as const }
const ok = (text: string, outputTokens: number) =>
  h.callLlm.mockImplementationOnce(async (_route, _req, parse: (t: string) => unknown) => ({ success: true, data: parse(text), usage: { inputTokens: 900, outputTokens, cost: 0.02 } }))

beforeEach(() => {
  h.callLlm.mockReset()
})

describe('fillTemplateSlots — 재현 선택', () => {
  it('선택이 없으면 단계 표 route로 부른다(지금 그대로)', async () => {
    ok(JSON.stringify({ sections: [{ index: 0, slots: { headline: '가볍게 접는 빨래통' } }] }), 40)
    const out = await fillTemplateSlots(input, RUN)
    expect(h.callLlm.mock.calls[0][0]).toEqual(PDP_MODEL_ROUTES['copy/template-slots'])
    expect(out.values.get(0)).toEqual({ headline: '가볍게 접는 빨래통' })
  })

  it('route를 주면 같은 프롬프트를 그 모델로 부르고, onCall이 콜마다 흔적을 받는다', async () => {
    ok(JSON.stringify({ sections: [{ index: 0, slots: { headline: '가볍게 접는 빨래통' } }] }), 55)
    const traces: SlotCopyCallTrace[] = []
    const out = await fillTemplateSlots(input, RUN, { route: OPUS, onCall: (trace) => traces.push(trace) })
    const [route, req] = h.callLlm.mock.calls[0]
    expect(route).toEqual(OPUS)
    expect(req.messages[0].content).toBe(buildSlotCopyPrompt(input))
    expect(req).toMatchObject({ agentName: 'registration/pdp-template-copy', runContext: RUN })
    expect(traces).toEqual([{ success: true, inputTokens: 900, outputTokens: 55, costUsd: 0.02 }])
    expect(out.costUsd).toBe(0.02)
  })

  it('실패한 콜은 까닭과 공급자가 준 끝난 까닭을 흔적에 남긴다', async () => {
    h.callLlm.mockResolvedValueOnce({ success: false, error: { message: '파싱 실패', stage: 'parse', stopReason: 'max_tokens' }, usage: { inputTokens: 900, outputTokens: 8000, cost: 0.05 } })
    const traces: SlotCopyCallTrace[] = []
    const out = await fillTemplateSlots(input, RUN, { route: OPUS, onCall: (trace) => traces.push(trace) })
    expect(traces).toEqual([{ success: false, inputTokens: 900, outputTokens: 8000, costUsd: 0.05, stopReason: 'max_tokens', error: '파싱 실패' }])
    expect(out.error).toBe('파싱 실패')
    expect(out.values.get(0) ?? {}).toEqual({})
  })
})
