/**
 * 칸 카피 띄어쓰기 가드(J64) — 공백을 지워 붙인 페이지는 고치기 1콜로 돌리고, 고쳐도 남으면 글을 지우지 않고 경고만 남긴다. 공급자 호출은 모의다(유료 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ callLlm: vi.fn() }))
vi.mock('../llm', () => ({ callLlm: (...a: unknown[]) => h.callLlm(...a) }))

import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import { fillTemplateSlots } from './pdp-template-copy-agent'
import { buildSlotCopyPrompt, type SlotCopySection } from './prompts/pdp-template-copy-prompts'

const product = { category: 'beauty', persona: '두피 고객', summary: '', keywords: [], usps: ['탄성모'], pains: ['손톱 자극'] }
const guideline = { persona: '두피 고객', tone: '담백' }
const spec = { material: '탄성모' } as unknown as PdpSpecSheet
const RUN = { userId: 'user-1', stage: 'k' }
const sections: SlotCopySection[] = Array.from({ length: 4 }, (_, index) => ({
  index,
  section: 'point_div',
  factSlots: 0,
  slots: [{ name: 'headline', required: true, facts: 0, maxChars: 20 }],
}))
const input = { product, guideline, facts: [], spec, sections }
const SQUASHED = ['두피구석까지\n실리콘미세모', '직접써본분들의\n생생한사용후기', '한눈에살펴보는\n상품기본정보', '매일감는두피를\n산뜻하게바꿔보세요']
const SPACED = ['두피 구석까지\n부드러운 탄성모', '직접 써 본 분들의\n생생한 후기', '한눈에 살펴보는\n상품 기본 정보', '매일 감는 머리를\n산뜻하게 바꿔 보세요']
const answer = (texts: string[]) => JSON.stringify({ sections: texts.map((headline, index) => ({ index, slots: { headline } })) })

function answers(...texts: string[]) {
  texts.forEach((text) => h.callLlm.mockImplementationOnce(async (_route, _req, parse: (t: string) => unknown) => ({ success: true, data: parse(text), usage: { cost: 0.01 } })))
}
const promptOf = (call: number) => (h.callLlm.mock.calls[call][1] as { messages: Array<{ content: string }> }).messages[0].content

beforeEach(() => {
  h.callLlm.mockReset()
})

describe('칸 카피 띄어쓰기 가드', () => {
  it('프롬프트가 공백을 지워 줄 수를 맞추지 말라고 한다', () => {
    expect(buildSlotCopyPrompt(input)).toContain("'한 줄 N자'는 띄어쓰기를 포함한 어림이라, 넘치면 낱말을 줄이거나 바꾸고 공백을 지워 맞추지 않는다.")
  })

  it('붙여 쓴 페이지는 고치기 1콜을 부르고, 고친 글로 바꾼다', async () => {
    answers(answer(SQUASHED), answer(SPACED))
    const out = await fillTemplateSlots(input, RUN)
    expect(out.fixCalls).toBe(1)
    expect(out.firstProblems.filter((p) => p.kind === 'spacing')).toHaveLength(8)
    expect(promptOf(1)).toContain("- [0] headline: 띄어쓰기 빠짐 — 맞춤법대로 띄어 쓰고, 길면 공백을 지우지 말고 낱말을 줄인다 ('두피구석까지' — 페이지에 띄어쓰기 없는 줄 8개)")
    expect([...out.values.values()].map((v) => v.headline)).toEqual(SPACED)
    expect(out.problems.filter((p) => p.kind === 'spacing')).toEqual([])
  })

  it('고쳐도 붙어 있으면 글을 지우지 않고 경고(problems)만 남긴다 — 섹션이 빠지지 않는다', async () => {
    answers(answer(SQUASHED), answer(SQUASHED))
    const out = await fillTemplateSlots(input, RUN)
    expect(out.fixCalls).toBe(1)
    expect(h.callLlm).toHaveBeenCalledTimes(2)
    expect(out.dropped).toEqual([])
    expect([...out.values.values()].map((v) => v.headline)).toEqual(SQUASHED)
    expect(out.problems.filter((p) => p.kind === 'spacing')).toHaveLength(8)
  })

  it('띄어 쓴 페이지는 고치기 콜이 없다', async () => {
    answers(answer(SPACED))
    const out = await fillTemplateSlots(input, RUN)
    expect(out.fixCalls).toBe(0)
    expect(out.firstProblems).toEqual([])
  })
})
