/**
 * K 슬롯 카피 강조 구절(적용 T1-17 K) — 강조 칸이 있는 콜에만 규칙·답 예시가 붙고, 에이전트는 마지막 답의 _accent를 최종 글로 검사한다.
 * 공급자 호출은 모의다(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ callLlm: vi.fn() }))
vi.mock('../llm', () => ({ callLlm: (...a: unknown[]) => h.callLlm(...a) }))

import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import { readCopyValues } from '@/lib/registration/templatelib/slot-copy'
import { fillTemplateSlots } from './pdp-template-copy-agent'
import { buildSlotCopyPrompt, type SlotCopySection } from './prompts/pdp-template-copy-prompts'

const product = { category: 'household', persona: '자취생', summary: '', keywords: [], usps: ['접이식'], pains: ['무거움'] }
const guideline = { persona: '자취생 고객', tone: '담백' }
const spec = { material: '면', size: '10cm' } as unknown as PdpSpecSheet
const RUN = { userId: 'user-1', stage: 'k' }
const RULE = "'강조'가 붙은 칸이 있는 섹션은 slots에 \"_accent\"를 더해"
const sections: SlotCopySection[] = [
  { index: 0, section: 'point_div', factSlots: 0, slots: [{ name: 'headline', required: true, facts: 0, maxChars: 30, accent: true }, { name: 'sub', required: false, facts: 0, maxChars: 30 }] },
  { index: 1, section: 'cta', factSlots: 0, slots: [{ name: 'headline', required: true, facts: 0, maxChars: 30 }] },
]
const plain: SlotCopySection[] = sections.map((s) => ({ ...s, slots: s.slots.map((slot) => ({ ...slot, accent: undefined })) }))
const input = { product, guideline, facts: ['면', '10cm'], spec, sections }
const answer = (rows: Array<[number, Record<string, unknown>]>) => JSON.stringify({ sections: rows.map(([index, slots]) => ({ index, slots })) })

function answers(...texts: string[]) {
  texts.forEach((text) => h.callLlm.mockImplementationOnce(async (_route, _req, parse: (t: string) => unknown) => ({ success: true, data: parse(text), usage: { cost: 0.1 } })))
}

beforeEach(() => {
  h.callLlm.mockReset()
})

describe('프롬프트 — 강조 칸이 있는 콜에만', () => {
  it('칸 설명에 강조를 적고 규칙 한 줄과 답 예시의 _accent를 붙인다', () => {
    const prompt = buildSlotCopyPrompt(input)
    expect(prompt).toContain('headline(필수, 강조, 30자, 사실 없음)')
    expect(prompt).toContain(RULE)
    expect(prompt).toContain('공백을 빼고 8자 이하이고 칸 글 전체는 안 된다')
    expect(prompt).toContain('"_accent":"강조 구절"')
    // 강조 칸이 아닌 섹션 설명은 그대로다
    expect(prompt).toContain('[1] cta')
    expect(prompt).not.toContain('headline(필수, 강조, 30자, 사실 없음)\n  - sub(선택, 강조')
  })

  it('강조 칸이 없으면 프롬프트가 지금 그대로다(규칙·예시 없음)', () => {
    const prompt = buildSlotCopyPrompt({ ...input, sections: plain })
    expect(prompt).not.toContain('_accent')
    expect(prompt).not.toContain('강조')
  })

  it('규칙이 규제 표현 밖의 체감 효익을 막지 않는다', () => {
    expect(buildSlotCopyPrompt(input)).toContain('고객이 얻는 효익이나 위 사실에 있는 수치가 담긴 말을 고른다')
  })
})

describe('에이전트 — _accent를 최종 글로 검사', () => {
  it('제목 안 구절이면 받고, _accent는 칸 값에 들지 않는다', async () => {
    answers(answer([[0, { headline: '접어서 서랍에 쏙 들어가요', sub: '보조 글', _accent: '서랍에 쏙' }], [1, { headline: '지금 골라 보세요' }]]))
    const out = await fillTemplateSlots(input, RUN)
    expect(out.accents).toEqual(new Map([[0, '서랍에 쏙']]))
    expect(out.accentMisses).toBe(0)
    expect(out.values.get(0)).toEqual({ headline: '접어서 서랍에 쏙 들어가요', sub: '보조 글' })
    expect(readCopyValues(sections[0].slots, { _accent: 'x' })).toEqual({})
  })

  it('검사를 못 넘은 구절은 버리고 수를 센다(지금 규칙으로 돌아간다)', async () => {
    answers(
      answer([
        [0, { headline: '접어서 서랍에 쏙 들어가요', _accent: '책상 위' }],
        [1, { headline: '지금 골라 보세요', _accent: '지금' }],
      ])
    )
    const out = await fillTemplateSlots(input, RUN)
    expect(out.accents.size).toBe(0)
    // 강조 칸이 없는 섹션의 _accent도 쓰지 않는다
    expect(out.accentMisses).toBe(2)
  })

  it('고치기 콜이 다시 쓴 섹션은 그 답의 구절로 검사한다', async () => {
    const tooLong = '가'.repeat(31)
    answers(answer([[0, { headline: tooLong, _accent: '가가' }], [1, { headline: '지금 골라 보세요' }]]), answer([[0, { headline: '접어서 서랍에 쏙 들어가요', _accent: '쏙 들어가요' }]]))
    const out = await fillTemplateSlots(input, RUN)
    expect(out.fixCalls).toBe(1)
    expect(out.accents.get(0)).toBe('쏙 들어가요')
  })

  it('글이 지워지면 구절도 없다', async () => {
    const tooLong = '가'.repeat(60)
    answers(answer([[0, { headline: tooLong, _accent: '가가' }], [1, { headline: '지금 골라 보세요' }]]), answer([[0, { headline: tooLong, _accent: '가가' }]]), answer([[0, { headline: tooLong, _accent: '가가' }]]))
    const out = await fillTemplateSlots(input, RUN)
    expect(out.values.get(0)?.headline).toBeUndefined()
    expect(out.accents.size).toBe(0)
    expect(out.accentMisses).toBe(1)
  })
})
