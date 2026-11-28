/**
 * 결정 카드 c03·c14(하네스 harness-cards J02) — K 칸 카피 화면 글 가드(고치기 → 남으면 지우기)·가드 블록 자리·CTA 안내·D 2단 지시.
 * 공급자 호출은 모의다(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ callLlm: vi.fn() }))
vi.mock('../llm', () => ({ callLlm: (...a: unknown[]) => h.callLlm(...a) }))

import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import { buildAgeComplianceCopyBlock } from '@/lib/registration/compliance-gate'
import { fillTemplateSlots } from './pdp-template-copy-agent'
import { STAGE2_STORYTELLING_PROMPT } from './prompts/pdp-copy-pro-prompts'
import { buildSlotCopyPrompt, type SlotCopySection } from './prompts/pdp-template-copy-prompts'
import { sectionGuideLine } from './prompts/pdp-template-copy-guide'

const product = { category: 'household', persona: '자취생', summary: '', keywords: [], usps: ['접이식'], pains: ['무거움'] }
const guideline = { persona: '자취생 고객', tone: '담백' }
const spec = { material: '면', minAgeYears: 14 } as unknown as PdpSpecSheet
const RUN = { userId: 'user-1', stage: 'k' }
const sections: SlotCopySection[] = [
  { index: 0, section: 'point_div', factSlots: 0, slots: [{ name: 'headline', required: true, facts: 0, maxChars: 20 }, { name: 'sub', required: false, facts: 0, maxChars: 30 }] },
]
const input = { product, guideline, facts: ['면'], spec, sections }
const GUARD = { minAge: 14, parentView: false, echo: null }
const AGE_BLOCK = buildAgeComplianceCopyBlock(spec, { slots: true })!
const answer = (slots: Record<string, unknown>) => JSON.stringify({ sections: [{ index: 0, slots }] })

function answers(...texts: string[]) {
  texts.forEach((text) => h.callLlm.mockImplementationOnce(async (_route, _req, parse: (t: string) => unknown) => ({ success: true, data: parse(text), usage: { cost: 0.1 } })))
}
const promptOf = (call: number) => (h.callLlm.mock.calls[call][1] as { messages: Array<{ content: string }> }).messages[0].content

beforeEach(() => {
  h.callLlm.mockReset()
})

describe('K 칸 카피 가드 블록(c03)', () => {
  it('guardBlock은 규칙 뒤·섹션 앞에 붙고, 없으면 프롬프트가 그대로다', () => {
    const plain = buildSlotCopyPrompt(input)
    const guarded = buildSlotCopyPrompt({ ...input, guardBlock: AGE_BLOCK })
    expect(plain).not.toContain('[연령 제한')
    expect(guarded).toBe(plain.replace('\n\n## 섹션', `\n\n${AGE_BLOCK}\n\n## 섹션`))
    expect(guarded.indexOf('## 규칙')).toBeLessThan(guarded.indexOf('[연령 제한'))
  })

  it('연령 제한 잡에서 어린이 표현을 쓴 칸은 고치기 1콜에 알리고, 고쳐지면 그 글을 쓴다', async () => {
    answers(answer({ headline: '아이도 쓰기 편한 가방', sub: '가볍게 들어요' }), answer({ headline: '혼자 들기 편한 가방', sub: '가볍게 들어요' }))
    const out = await fillTemplateSlots({ ...input, guardBlock: AGE_BLOCK, guard: GUARD }, RUN)
    expect(out.fixCalls).toBe(1)
    expect(promptOf(1)).toContain('- [0] headline: 연령 제한 상품에 어린이 표현')
    expect(promptOf(0)).toContain('[연령 제한')
    expect(out.values.get(0)).toEqual({ headline: '혼자 들기 편한 가방', sub: '가볍게 들어요' })
    expect(out.firstProblems.map((p) => p.kind)).toEqual(['age'])
    expect(out.dropped).toEqual([])
  })

  it('고친 뒤에도 남은 선택 칸의 어린이 표현은 지운다(필수 칸이 비지 않아 한 번 더 부르지 않는다)', async () => {
    const bad = answer({ headline: '혼자 들기 편한 가방', sub: '아이 생일파티에도' })
    answers(bad, bad)
    const out = await fillTemplateSlots({ ...input, guard: GUARD }, RUN)
    expect(out.fixCalls).toBe(1)
    expect(out.values.get(0)).toEqual({ headline: '혼자 들기 편한 가방' })
    expect(out.dropped).toEqual([{ index: 0, slot: 'sub', kind: 'age' }])
  })

  it('guard가 없으면 같은 글을 검사하지 않는다(가드 없는 잡은 지금과 같다)', async () => {
    answers(answer({ headline: '아이도 쓰기 편한 가방' }))
    const out = await fillTemplateSlots(input, RUN)
    expect(out.fixCalls).toBe(0)
    expect(h.callLlm).toHaveBeenCalledTimes(1)
  })
})

describe('CTA·카피 지시(c14)', () => {
  it('K cta 안내는 동사형 완성 문장·입력에 없는 약속 금지·보라고 안내하는 말 금지다', () => {
    const line = sectionGuideLine('cta')
    expect(line).toContain('동사형 완성 문장')
    expect(line).toContain('입력에 없는 배송·반품·보증·기간·혜택 약속')
    expect(line).toContain('살펴보세요')
    // 전환 칸(convert_div)은 지금 권유 그대로
    expect(sectionGuideLine('convert_div')).toContain('짧은 권유 한 문장')
  })

  it('D 2단은 키워드 반복 2회 이내이고, 상상 유도 예시에 아이가 나오지 않는다', () => {
    expect(STAGE2_STORYTELLING_PROMPT).toContain('2회 이내')
    expect(STAGE2_STORYTELLING_PROMPT).not.toContain('3~5회')
    expect(STAGE2_STORYTELLING_PROMPT).not.toContain('아이가 잠든')
    expect(STAGE2_STORYTELLING_PROMPT).toContain('옆 사람이 잠든 침실')
  })
})
