/**
 * K 라인 슬롯 카피 에이전트 — 라우트, 고치기 1콜, 남은 문제의 글 지우기, 사실 반복. 공급자 호출은 모의다(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ callLlm: vi.fn() }))
vi.mock('../llm', () => ({ callLlm: (...a: unknown[]) => h.callLlm(...a) }))

import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import { PDP_MODEL_ROUTES } from '@/lib/registration/pdp-model-routes'
import { hookCopyLimits } from '@/lib/registration/templatelib/slot-copy'
import { fillTemplateSlots } from './pdp-template-copy-agent'
import { buildSlotCopyPrompt, parseSlotCopy, type SlotCopySection } from './prompts/pdp-template-copy-prompts'
import { CONCERN_PAIR_RULE, COPY_COMMON_RULES, SECTION_COPY_GUIDE, sectionGuideLine } from './prompts/pdp-template-copy-guide'
import { SECTION_PURPOSES, buildGuidelinePrompt } from './prompts/pdp-template-prompts'

const product = { category: 'household', persona: '자취생', summary: '', keywords: [], usps: ['접이식'], pains: ['무거움'] }
const guideline = { persona: '자취생 고객', tone: '담백' }
const spec = { material: '면', size: '10cm' } as unknown as PdpSpecSheet
const RUN = { userId: 'user-1', stage: 'k' }
const sections: SlotCopySection[] = [
  { index: 0, section: 'hook_3step', factSlots: 1, slots: [{ name: 'headline', required: true, facts: 1, maxChars: 10 }, { name: 'sub', required: false, facts: 1, maxChars: 20 }] },
  { index: 1, section: 'cta', factSlots: 0, slots: [{ name: 'headline', required: true, facts: 0, maxChars: 10 }] },
]
const input = { product, guideline, facts: ['면', '10cm'], spec, sections }
const answer = (rows: Array<[number, Record<string, unknown>]>) => JSON.stringify({ sections: rows.map(([index, slots]) => ({ index, slots })) })

/** 답을 차례로 돌려준다. null이면 그 콜은 실패다 */
function answers(...texts: Array<string | null>) {
  texts.forEach((text) =>
    h.callLlm.mockImplementationOnce(async (_route, _req, parse: (t: string) => unknown) =>
      text === null ? { success: false, error: { message: '실패' }, usage: { cost: 0.01 } } : { success: true, data: parse(text), usage: { cost: 0.1 } }
    )
  )
}

beforeEach(() => {
  h.callLlm.mockReset()
})

describe('줄 수·끝 줄 — 고치기와 지우기', () => {
  // H2 74 × 폭 740: 한 줄 10자
  const lined: SlotCopySection[] = [{ index: 1, section: 'point_div', factSlots: 0, slots: [{ name: 'headline', required: true, facts: 0, maxChars: 40, maxLines: 1, lineToken: 'H2', lineWidth: 740 }] }]

  it('프롬프트에 칸마다 한 줄 글자 수를 적고, 의미 단위·치수 규칙을 준다', () => {
    const prompt = buildSlotCopyPrompt({ ...input, sections: lined })
    expect(prompt).toContain('headline(필수, 40자, 1줄, 한 줄 10자, 사실 없음)')
    expect(prompt).toContain('조사나 3자 이하 낱말만 끝 줄에 남기지 않는다')
    expect(prompt).toContain('이름·값·단위를 떨어뜨리지 않는다')
    // 폭을 모르는 칸은 글자 수를 지어내지 않는다
    expect(buildSlotCopyPrompt({ ...input, sections: [{ ...lined[0], slots: [{ name: 'headline', required: true, facts: 0, maxChars: 40 }] }] })).not.toContain('한 줄 10자')
  })

  it('외톨이 줄만 있으면 고치기 콜을 부르지 않고 글을 남기며 기록한다', async () => {
    const orphaned = '가나다라마바사아자차 끝'
    answers(answer([[1, { headline: orphaned }]]))
    const out = await fillTemplateSlots({ ...input, sections: [{ ...lined[0], slots: [{ ...lined[0].slots[0], maxLines: 2 }] }] }, RUN)
    expect(out.fixCalls).toBe(0)
    expect(h.callLlm).toHaveBeenCalledTimes(1)
    expect(out.values.get(1)).toEqual({ headline: orphaned })
    expect(out.firstProblems).toMatchObject([{ index: 1, slot: 'headline', kind: 'orphan' }])
    expect(out.dropped).toEqual([])
  })

  it('줄 수 초과는 고치기 콜을 한 번 부르고, 남아도 글을 지우지 않아 섹션이 빠지지 않는다', async () => {
    const long = '가나다라마바사아 자차카타파하가나 다라마바사아자차'
    answers(answer([[1, { headline: long }]]), answer([[1, { headline: long }]]))
    const out = await fillTemplateSlots({ ...input, sections: lined }, RUN)
    expect(out.fixCalls).toBe(1)
    expect(String(h.callLlm.mock.calls[1][1].messages[0].content)).toContain('줄 수 초과')
    expect(out.values.get(1)).toEqual({ headline: long })
    expect(out.dropped).toEqual([])
    expect(out.problems.some((p) => p.kind === 'lines')).toBe(true)
  })

  it('다른 문제로 다시 쓰는 섹션에는 외톨이 줄도 함께 알린다', async () => {
    const orphanedClaim = 'KC인증완료 가나다 사아자차카타파하가나 끝'
    answers(answer([[1, { headline: orphanedClaim }]]), answer([[1, { headline: '가나다' }]]))
    await fillTemplateSlots({ ...input, sections: [{ ...lined[0], slots: [{ ...lined[0].slots[0], maxLines: 3 }] }] }, RUN)
    const fixPrompt = String(h.callLlm.mock.calls[1][1].messages[0].content)
    expect(fixPrompt).toContain('규제 표현')
    expect(fixPrompt).toContain('끝 줄에 3자 이하')
  })
})

describe('이름표 칸 — 프롬프트', () => {
  const tagged: SlotCopySection[] = [{ index: 3, section: 'petit_div', factSlots: 0, slots: [{ name: 'tags', required: false, facts: 0, maxChars: 10, tags: { min: 1, max: 6 } }] }]

  it('이름표 칸이 있는 콜에만 규칙과 답 모양을 붙인다', () => {
    const prompt = buildSlotCopyPrompt({ ...input, sections: tagged })
    expect(prompt).toContain('tags: 이름표 글 목록 1~6개(선택), 한 개 10자, 사실 없음')
    expect(prompt).toContain('이름표 칸은')
    expect(prompt).toContain('"이름표 칸 이름":["글"]')
    const plain = buildSlotCopyPrompt(input)
    expect(plain).not.toContain('이름표')
  })

  it('모델이 쓴 글이 칸에 들어오고, 규제 표현 이름표는 고치기 뒤에도 남으면 그 하나만 지운다', async () => {
    answers(answer([[3, { tags: ['자취생', 'KC인증완료'] }]]), answer([[3, { tags: ['자취생', 'KC인증완료'] }]]))
    const out = await fillTemplateSlots({ ...input, sections: tagged }, RUN)
    expect(out.fixCalls).toBe(1)
    expect(out.values.get(3)).toEqual({ tags: ['#자취생'] })
    expect(out.problems).toMatchObject([{ index: 3, slot: 'tags.1', kind: 'claim' }])
  })
})

describe('비교 칸 — 프롬프트와 고치기', () => {
  const duel: SlotCopySection[] = [
    { index: 2, section: 'compare', factSlots: 1, slots: [{ name: 'headline', required: true, facts: 1, maxChars: 18 }, { name: 'to', required: true, facts: 0, maxChars: 2 }, { name: 'from', required: true, facts: 0, maxChars: 2 }] },
  ]

  it('모든 콜에 다른 상품 금지를 넣고, 비교 칸이 있을 때만 전후 장면 규칙을 붙인다', () => {
    expect(buildSlotCopyPrompt(input)).toContain('다른 상품을 가리키거나 깎아내리지 않는다')
    expect(buildSlotCopyPrompt(input)).not.toContain('비교 칸은')
    expect(buildSlotCopyPrompt(input)).toContain("'이런 고민'이라는 말은 쓰지 않는다")
    const rows: SlotCopySection[] = [{ index: 2, section: 'compare', factSlots: 1, slots: [{ name: 'rows', required: true, facts: 1, list: { min: 2, max: 3, fields: [{ name: 'from', required: true, facts: 0 }] } }] }]
    expect(buildSlotCopyPrompt({ ...input, sections: rows })).toContain('이름표(\'우리 제품\'·\'기존 제품\')는 코드가 붙이므로 쓰지 않는다')
  })

  it("'일반'으로 시작하는 비교 글은 고칠 곳으로 돌리고 고치면 그대로 쓴다", async () => {
    answers(answer([[2, { headline: '오래 써요', to: '이후', from: '일반' }]]), answer([[2, { headline: '오래 써요', to: '이후', from: '이전' }]]))
    const out = await fillTemplateSlots({ ...input, sections: duel }, RUN)
    expect(out.fixCalls).toBe(1)
    expect(h.callLlm.mock.calls[1][1].messages[0].content).toContain('다른 상품 언급')
    expect(out.values.get(2)).toEqual({ headline: '오래 써요', to: '이후', from: '이전' })
    expect(out.problems).toEqual([])
    expect(out.firstProblems).toMatchObject([{ index: 2, slot: 'from', kind: 'compare' }])
  })

  it('고쳐도 남으면 지우고 빠진 필수 칸으로 알린다 — 엔진이 그 템플릿을 그리지 않는다', async () => {
    const same = answer([[2, { headline: '오래 써요', to: '이후', from: '일반' }]])
    answers(same, same, same)
    const out = await fillTemplateSlots({ ...input, sections: duel }, RUN)
    expect(out.fixCalls).toBe(2)
    expect(out.values.get(2)).toEqual({ headline: '오래 써요', to: '이후' })
    expect(out.problems).toMatchObject([
      { index: 2, slot: 'from', kind: 'compare' },
      { index: 2, slot: 'from', kind: 'missing' },
    ])
    expect(out.dropped).toEqual([{ index: 2, slot: 'from', kind: 'compare' }])
  })
})

describe('섹션 빠짐 막기(K14) — 넘친 필수 칸과 두 번째 고치기', () => {
  const point: SlotCopySection[] = [
    { index: 4, section: 'point_div', factSlots: 1, slots: [{ name: 'headline', required: true, facts: 1, maxChars: 12 }, { name: 'sub', required: false, facts: 0, maxChars: 20 }] },
    { index: 5, section: 'point_div', factSlots: 0, slots: [{ name: 'headline', required: true, facts: 0, maxChars: 12 }] },
  ]
  const fine = '서랍에 쏙 들어가요'

  it('상한 1.5배 안으로 넘친 필수 칸은 고치기를 청하고, 남아도 글을 지우지 않아 섹션이 남는다', async () => {
    const over = '가나다라마바사아자차카타파하'
    answers(answer([[4, { headline: over }], [5, { headline: fine }]]), answer([[4, { headline: over }]]))
    const out = await fillTemplateSlots({ ...input, sections: point }, RUN)
    expect(out.fixCalls).toBe(1)
    expect(h.callLlm).toHaveBeenCalledTimes(2)
    expect(String(h.callLlm.mock.calls[1][1].messages[0].content)).toContain('글자 수 초과')
    expect(out.values.get(4)).toEqual({ headline: over })
    expect(out.dropped).toEqual([])
    expect(out.problems).toMatchObject([{ index: 4, slot: 'headline', kind: 'over', detail: '14자(상한 12자)' }])
  })

  it('고친 뒤에도 지우면 필수 칸이 비는 섹션만 한 번 더 부르고, 그 콜에 까닭을 적으며, 고치면 섹션이 남는다', async () => {
    const number = '25cm 크기예요'
    answers(answer([[4, { headline: number }], [5, { headline: number }]]), answer([[4, { headline: number }], [5, { headline: '손이 편해요' }]]), answer([[4, { headline: fine }]]))
    const out = await fillTemplateSlots({ ...input, sections: point }, RUN)
    expect(out.fixCalls).toBe(2)
    expect(h.callLlm).toHaveBeenCalledTimes(3)
    const second = String(h.callLlm.mock.calls[2][1].messages[0].content)
    expect(second).toContain('못 고치면 이 섹션이 페이지에서 빠진다')
    expect(second).toContain('[4] point_div')
    expect(second).not.toContain('[5] point_div')
    expect(out.values.get(4)).toEqual({ headline: fine })
    expect(out.dropped).toEqual([])
    expect(out.problems).toEqual([])
    expect(out.costUsd).toBeCloseTo(0.3)
  })

  it('두 번째 고치기에도 남으면 글을 지우고 알린다 — 세 번째 콜은 없다', async () => {
    const number = '25cm 크기예요'
    const same = answer([[4, { headline: number }], [5, { headline: fine }]])
    answers(same, same, answer([[4, { headline: number }]]))
    const out = await fillTemplateSlots({ ...input, sections: point }, RUN)
    expect(h.callLlm).toHaveBeenCalledTimes(3)
    expect(out.fixCalls).toBe(2)
    expect(out.dropped).toEqual([{ index: 4, slot: 'headline', kind: 'number' }])
    expect(out.problems.map((p) => p.kind)).toEqual(['number', 'missing'])
  })

  it('선택 칸만 지워지는 섹션은 두 번째 고치기를 부르지 않는다', async () => {
    const same = answer([[4, { headline: fine, sub: 'KC 인증 완료' }], [5, { headline: fine }]])
    answers(same, same)
    const out = await fillTemplateSlots({ ...input, sections: point }, RUN)
    expect(h.callLlm).toHaveBeenCalledTimes(2)
    expect(out.fixCalls).toBe(1)
    expect(out.values.get(4)).toEqual({ headline: fine })
    expect(out.dropped).toEqual([{ index: 4, slot: 'sub', kind: 'claim' }])
  })

  it('두 번째 고치기 콜이 실패하면 글을 지우고 사유를 돌려준다', async () => {
    const number = '25cm 크기예요'
    const same = answer([[4, { headline: number }], [5, { headline: fine }]])
    answers(same, same, null)
    const out = await fillTemplateSlots({ ...input, sections: point }, RUN)
    expect(out.fixCalls).toBe(2)
    expect(out.error).toBe('실패')
    expect(out.values.get(4)).toEqual({})
    expect(out.values.get(5)).toEqual({ headline: fine })
  })
})

describe('지운 칸 기록', () => {
  const rows: SlotCopySection[] = [
    { index: 2, section: 'compare', factSlots: 2, slots: [{ name: 'rows', required: true, facts: 1, list: { min: 2, max: 3, fields: [{ name: 'from', required: true, facts: 0, maxChars: 6 }, { name: 'to', required: true, facts: 1, maxChars: 6 }] } }] },
  ]

  it('목록 항목의 필수 칸을 지워 최소 수가 깨지면 빠진 칸으로 알린다 — 엔진이 그리지 않는 섹션이다', async () => {
    const long = answer([[2, { rows: [{ from: '이전', to: '가'.repeat(10) }, { from: '이전', to: '나'.repeat(10) }] }]])
    answers(long, long, long)
    const out = await fillTemplateSlots({ ...input, sections: rows }, RUN)
    expect(out.values.get(2)).toEqual({ rows: [{ from: '이전' }, { from: '이전' }] })
    expect(out.dropped.map((d) => d.slot)).toEqual(['rows.to', 'rows.to'])
    expect(out.problems.filter((p) => p.kind === 'missing')).toEqual([{ index: 2, slot: 'rows', kind: 'missing', detail: '항목 2개 이상' }])
  })

  it('문제가 없으면 지운 칸이 없다', async () => {
    answers(answer([[2, { rows: [{ from: '이전', to: '이후' }, { from: '전', to: '후' }] }]]))
    const out = await fillTemplateSlots({ ...input, sections: rows }, RUN)
    expect(out.dropped).toEqual([])
    expect(out.problems).toEqual([])
  })
})

describe('슬롯 카피', () => {
  it('라우트·agent 이름으로 한 번 부르고, 문제가 없으면 값과 비용을 돌려준다', async () => {
    answers(answer([[0, { headline: '고민 끝' }], [1, { headline: '지금 만나요' }]]))
    const out = await fillTemplateSlots(input, RUN)
    expect(h.callLlm).toHaveBeenCalledTimes(1)
    const [route, request] = h.callLlm.mock.calls[0]
    expect(route).toMatchObject({ maxTokens: PDP_MODEL_ROUTES['copy/template-slots'].maxTokens })
    expect(request).toMatchObject({ agentName: 'registration/pdp-template-copy', runContext: RUN })
    expect(out).toMatchObject({ problems: [], fixCalls: 0, error: null, costUsd: 0.1 })
    expect(out.values.get(0)).toEqual({ headline: '고민 끝' })
    expect(out.values.get(1)).toEqual({ headline: '지금 만나요' })
  })

  it('사실 칸을 넘는 선택 칸은 고치기 없이 줄인다', async () => {
    answers(answer([[0, { headline: '고민 끝', sub: '가벼워요' }], [1, { headline: '지금' }]]))
    const out = await fillTemplateSlots(input, RUN)
    expect(out.values.get(0)).toEqual({ headline: '고민 끝' })
    expect(out.fixCalls).toBe(0)
  })

  it('문제 있는 섹션만 고칠 곳과 함께 한 번 더 부른다', async () => {
    answers(answer([[0, { headline: '가나다라마바사아자차카' }], [1, { headline: '지금' }]]), answer([[0, { headline: '고민 끝' }]]))
    const out = await fillTemplateSlots(input, RUN)
    expect(h.callLlm).toHaveBeenCalledTimes(2)
    const fix = h.callLlm.mock.calls[1][1].messages[0].content as string
    expect(fix).toContain('고칠 곳')
    expect(fix).toContain('글자 수 초과')
    expect(fix).toContain('[0] hook_3step')
    expect(fix).not.toContain('[1] cta')
    expect(out).toMatchObject({ problems: [], fixCalls: 1, costUsd: 0.2 })
    expect(out.values.get(0)).toEqual({ headline: '고민 끝' })
    expect(out.values.get(1)).toEqual({ headline: '지금' })
  })

  it('고친 뒤에도 남은 문제의 글은 지우고 알려 준다 — 빠진 필수 칸도 함께 남는다', async () => {
    answers(answer([[0, { headline: 'KC 인증 완료' }], [1, { headline: '지금' }]]), answer([[0, { headline: 'KC 인증 완료' }]]), answer([[0, { headline: 'KC 인증 완료' }]]))
    const out = await fillTemplateSlots(input, RUN)
    expect(out.problems).toEqual([{ index: 0, slot: 'headline', kind: 'claim', detail: 'KC 인증 완료' }, { index: 0, slot: 'headline', kind: 'missing', detail: '필수 칸' }])
    expect(out.values.get(0)).toEqual({})
    expect(out.values.get(1)).toEqual({ headline: '지금' })
  })

  it('고치기 콜이 실패하면 첫 글에서 문제 칸만 지우고 사유를 돌려준다', async () => {
    answers(answer([[0, { headline: '25cm 크기' }], [1, { headline: '지금' }]]), null)
    const out = await fillTemplateSlots(input, RUN)
    expect(h.callLlm).toHaveBeenCalledTimes(2)
    expect(out.fixCalls).toBe(1)
    expect(out.error).toBe('실패')
    expect(out.problems).toEqual([{ index: 0, slot: 'headline', kind: 'number', detail: '25cm' }, { index: 0, slot: 'headline', kind: 'missing', detail: '필수 칸' }])
    expect(out.values.get(0)).toEqual({})
    expect(out.costUsd).toBeCloseTo(0.11)
  })

  it('첫 콜이 실패하면 고치기를 부르지 않고 필수 칸이 빠졌다고 알려 준다', async () => {
    answers(null)
    const out = await fillTemplateSlots(input, RUN)
    expect(h.callLlm).toHaveBeenCalledTimes(1)
    expect(out.error).toBe('실패')
    expect(out.problems.map((p) => [p.index, p.kind])).toEqual([[0, 'missing'], [1, 'missing']])
    expect(out.values.get(0)).toEqual({})
  })

  it('고치기 답에 없는 섹션은 첫 글을 유지한다', async () => {
    const tooLong = '가나다라마바사아자차카타파하가나'
    answers(answer([[0, { headline: tooLong, sub: '부' }], [1, {}]]), answer([[1, { headline: '지금' }]]), answer([[0, { headline: tooLong }]]))
    const out = await fillTemplateSlots(input, RUN)
    expect(out.values.get(1)).toEqual({ headline: '지금' })
    expect(out.problems.map((p) => [p.slot, p.kind])).toEqual([['headline', 'length'], ['headline', 'missing']])
  })

  it('한 사실이 3곳이면 세 번째 섹션을 고칠 곳으로 돌리고, 그래도 남으면 글은 지우지 않고 기록만 한다', async () => {
    const three: SlotCopySection[] = [0, 1, 2].map((index) => ({ index, section: 'sub_div', factSlots: 1, slots: [{ name: 'headline', required: true, facts: 1, maxChars: 20 }] }))
    const same = answer([[0, { headline: '10cm 크기' }], [1, { headline: '크기는 10 cm' }], [2, { headline: '10cm 라서 좋아요' }]])
    answers(same, answer([[2, { headline: '10cm 라서 좋아요' }]]))
    const out = await fillTemplateSlots({ ...input, sections: three }, RUN)
    const fix = h.callLlm.mock.calls[1][1].messages[0].content as string
    expect(fix).toContain('사실 반복')
    expect(fix).toContain('[2] sub_div')
    expect(fix).not.toContain('[0] sub_div')
    expect(out.problems).toEqual([{ index: 2, slot: '섹션 전체', kind: 'repeat', detail: "'10cm'이 3곳 이상 — 이 섹션에서 뺀다" }])
    expect(out.values.get(2)).toEqual({ headline: '10cm 라서 좋아요' })
  })
})

describe('프롬프트·파서', () => {
  it('프롬프트에 사실·칸 상한·사실 칸·규칙이 든다', () => {
    const prompt = buildSlotCopyPrompt(input)
    expect(prompt).toContain('1. 면')
    expect(prompt).toContain('2. 10cm')
    expect(prompt).toContain('사실 칸 1개')
    expect(prompt).toContain('headline(필수, 10자, 사실 1)')
    expect(prompt).toContain('sub(선택, 20자, 사실 1)')
    expect(prompt).toContain('자취생 고객')
    expect(prompt).toContain('체감 효익')
    expect(prompt).not.toContain('고칠 곳')
  })

  it('첫 화면이 있는 콜에만 1~3초 규칙이 든다 — 줄 수·글자 수는 토큰에서 구한 값이고 줄바꿈은 글자로 보인다', () => {
    const { headline } = hookCopyLimits()
    const prompt = buildSlotCopyPrompt(input)
    expect(prompt).toContain('1~3초')
    expect(prompt).toContain(`headline은 2줄까지, 한 줄 ${headline.perLine}자 안팎`)
    // 보조 글자 수는 칸 상한(A의 12자)만 보여 준다 — 규칙 글의 숫자와 칸 숫자가 어긋나지 않게
    expect(prompt).toContain('sub는 1줄이고 없어도 되면 뺀다')
    expect(prompt).toContain('의미 단위에서 \\n으로 끊는다')
    expect(buildSlotCopyPrompt({ ...input, sections: sections.slice(1) })).not.toContain('1~3초')
  })

  it('사실이 없으면 장면으로 쓰라고 적고, 고객·말투가 비면 기본값을 쓴다', () => {
    const prompt = buildSlotCopyPrompt({ ...input, facts: [], guideline: { persona: '', tone: '' } })
    expect(prompt).toContain('사실을 쓰지 말고')
    expect(prompt).toContain('- 고객: 자취생')
    expect(prompt).toContain('자연스러운 존댓말')
  })

  it('목록 칸은 개수와 항목 칸을 보여 준다', () => {
    const list: SlotCopySection = {
      index: 0,
      section: 'sub_div',
      factSlots: 2,
      slots: [{ name: 'steps', required: true, facts: 1, list: { min: 2, max: 3, fields: [{ name: 'title', required: true, facts: 1, maxChars: 6, maxLines: 1 }] } }],
    }
    const prompt = buildSlotCopyPrompt({ ...input, sections: [list] })
    expect(prompt).toContain('steps: 목록 2~3개(필수), 항목마다 title(필수, 6자, 1줄, 사실 1)')
    const optional = { ...list, slots: [{ ...list.slots[0], required: false }] }
    expect(buildSlotCopyPrompt({ ...input, sections: [optional] })).toContain('(선택)')
  })

  it('파서 — 빈 답·파싱 실패·쓸 섹션 없음은 실패, 없는 섹션·slots 없는 줄·중복은 버린다', () => {
    expect(() => parseSlotCopy('', sections)).toThrow('비어 있습니다')
    expect(() => parseSlotCopy('글자만', sections)).toThrow('파싱 실패')
    expect(() => parseSlotCopy(answer([[9, { a: 1 }]]), sections)).toThrow('쓸 수 있는 섹션')
    expect(() => parseSlotCopy(JSON.stringify({ sections: 'x' }), sections)).toThrow('쓸 수 있는 섹션')
    const parsed = parseSlotCopy(JSON.stringify({ sections: [{ index: 0, slots: { a: '1' } }, { index: 0, slots: { a: '2' } }, { index: 1 }, null] }), sections)
    expect([...parsed.keys()]).toEqual([0])
    expect(parsed.get(0)).toEqual({ a: '1' })
  })
})

describe('섹션 안내표와 공통 규칙', () => {
  const at = (section: string, index = 0): SlotCopySection => ({ index, section, factSlots: 0, slots: [{ name: 'headline', required: true, facts: 0, maxChars: 20 }] })

  it('그 콜에 나온 섹션의 안내만 목적 줄 바로 뒤에 넣는다', () => {
    const prompt = buildSlotCopyPrompt({ ...input, sections: [at('point_div')] })
    expect(prompt).toContain('[0] point_div — 큰 장점 하나를 크게(최대 3번) — 사실 칸 0개\n  안내(효익): 제목은 속성 + 달라지는 장면')
    expect(prompt).not.toContain('안내(권유)')
    expect(prompt).not.toContain('안내(고민)')
    // cta는 결정 카드 c14로 완성 동사형 안내, 전환 칸(convert_div)은 지금 권유 그대로
    expect(buildSlotCopyPrompt({ ...input, sections: [at('cta')] })).toContain('안내(권유): 제목은 이 상품을 쓰면 달라지는 점으로 지금 고를 이유를 담은 동사형 완성 문장')
    expect(buildSlotCopyPrompt({ ...input, sections: [at('convert_div')] })).toContain('안내(권유): 제목은 다음 사용 장면')
  })

  it('앞으로 쓰이는 모든 섹션 목적에 안내가 있다 — 빠진 섹션이 조용히 안내 없이 가지 않는다', () => {
    for (const section of Object.keys(SECTION_PURPOSES)) expect(SECTION_COPY_GUIDE[section], section).toBeDefined()
  })

  it('표에 없는 섹션은 안내 줄 없이 목적만 준다', () => {
    expect(sectionGuideLine('없는_섹션')).toBe('')
    expect(buildSlotCopyPrompt({ ...input, sections: [at('없는_섹션')] })).not.toContain('안내(')
  })

  it('공통 규칙 다섯 줄이 모든 콜에 들고, 규제·이런 고민·다른 상품 규칙은 그대로다', () => {
    const prompt = buildSlotCopyPrompt({ ...input, sections: [at('cta')] })
    for (const rule of COPY_COMMON_RULES) expect(prompt).toContain(`- ${rule}`)
    expect(prompt).toContain('쓰면 안 되는 것은 인증·시험 사칭, 질병·의학 효능, 기능성 화장품 효능, 살균·무독성 같은 절대 안전 표시다.')
    expect(prompt).toContain('고객이 실제로 쓰는 장면과 체감 효익을 살린다')
    expect(prompt).toContain("'이런 고민'이라는 말은 쓰지 않는다.")
  })

  it('안내표가 체감 효익을 막는 낱말을 넣지 않고, 후킹 줄은 고민 시작을 허용한다', () => {
    const lines = Object.values(SECTION_COPY_GUIDE).map((row) => row.avoid).join(' ')
    expect(lines).not.toMatch(/체감|효익|효과/)
    expect(SECTION_COPY_GUIDE.hook_3step.title).toContain('고민 질문은 고민이 곧 구매 이유일 때만')
  })

  it('고민 칸이 있는 콜에만 고민-POINT 짝 규칙이 든다', () => {
    expect(buildSlotCopyPrompt({ ...input, sections: [at('problem_raise'), at('point_div', 1)] })).toContain(CONCERN_PAIR_RULE)
    expect(buildSlotCopyPrompt({ ...input, sections: [at('problem_empathy')] })).toContain(CONCERN_PAIR_RULE)
    expect(buildSlotCopyPrompt({ ...input, sections: [at('point_div')] })).not.toContain(CONCERN_PAIR_RULE)
  })

  it('컨셉 프롬프트가 제목·본문 말투를 나눠 받되 답 모양은 그대로다', () => {
    const prompt = buildGuidelinePrompt(product as never, [])
    expect(prompt).toContain('tone은 제목 말투와 본문 말투를 나눠 적는다')
    expect(prompt).toContain('{"persona":"…","tone":"…","concept"')
  })
})

describe('같은 말 반복 — 같은 첫머리 제목·POINT 제목끼리 같은 말(K3)', () => {
  const head = (index: number, section = 'sub_div'): SlotCopySection => ({ index, section, factSlots: 0, slots: [{ name: 'headline', required: true, facts: 0, maxChars: 20 }] })

  it('세 번째 같은 첫머리 제목을 고칠 곳으로 돌리고, 고친 글을 쓴다', async () => {
    answers(answer([[0, { headline: '매일 쓰는 컵' }], [1, { headline: '매일 쓰는 접시' }], [2, { headline: '매일 쓰는 그릇' }]]), answer([[2, { headline: '오래 두는 그릇' }]]))
    const out = await fillTemplateSlots({ ...input, sections: [head(0), head(1), head(2)] }, RUN)
    expect(out.fixCalls).toBe(1)
    const fix = h.callLlm.mock.calls[1][1].messages[0].content as string
    expect(fix).toContain('같은 말 반복')
    expect(fix).toContain('[2] sub_div')
    expect(fix).not.toContain('[0] sub_div')
    expect(out.firstProblems).toMatchObject([{ index: 2, slot: 'headline', kind: 'echo' }])
    expect(out.problems).toEqual([])
    expect(out.values.get(2)).toEqual({ headline: '오래 두는 그릇' })
  })

  it('고친 뒤에도 남으면 글은 지우지 않고 남은 문제로 알린다', async () => {
    const same = answer([[0, { headline: '수채화 카네이션 그대로' }], [1, { headline: '수채화 카네이션 답례' }]])
    answers(same, answer([[1, { headline: '수채화 카네이션 답례' }]]))
    const out = await fillTemplateSlots({ ...input, sections: [head(0, 'point_div'), head(1, 'point_div')] }, RUN)
    expect(out.problems).toMatchObject([{ index: 1, slot: 'headline', kind: 'echo' }])
    expect(out.dropped).toEqual([])
    expect(out.values.get(1)).toEqual({ headline: '수채화 카네이션 답례' })
  })
})

describe('페이지 기록 — 같은 끝말·느낌표·짝 없는 고민', () => {
  const head = (index: number, section = 'sub_div'): SlotCopySection => ({ index, section, factSlots: 0, slots: [{ name: 'headline', required: true, facts: 0, maxChars: 20 }] })

  it('고치기 콜을 부르지 않고 글을 남기며 첫 답 기록과 남은 기록에 남긴다', async () => {
    answers(answer([[0, { headline: '손이 편해요' }], [1, { headline: '잘 닦여요' }], [2, { headline: '오래 써요!' }]]))
    const out = await fillTemplateSlots({ ...input, sections: [head(0), head(1), head(2)] }, RUN)
    expect(out.fixCalls).toBe(0)
    expect(h.callLlm).toHaveBeenCalledTimes(1)
    expect(out.firstProblems).toMatchObject([{ index: 2, slot: 'headline', kind: 'ending' }])
    expect(out.problems).toMatchObject([{ index: 2, slot: 'headline', kind: 'ending' }])
    expect(out.dropped).toEqual([])
    expect(out.values.get(2)).toEqual({ headline: '오래 써요!' })
  })

  it('다른 문제로 다시 쓰는 섹션에는 기록도 라벨과 함께 알린다', async () => {
    answers(
      answer([[0, { headline: '손이 편해요' }], [1, { headline: '잘 닦여요' }], [2, { headline: '가나다라마바사아자차카타파하가나다라마바사아' }]]),
      answer([[2, { headline: '오래 써요' }]])
    )
    const out = await fillTemplateSlots({ ...input, sections: [head(0), head(1), head(2)] }, RUN)
    expect(out.fixCalls).toBe(1)
    const fixPrompt = h.callLlm.mock.calls[1][1].messages[0].content as string
    expect(fixPrompt).toContain('## 고칠 곳')
    expect(out.problems).toMatchObject([{ index: 2, slot: 'headline', kind: 'ending' }])
    expect(out.values.get(2)).toEqual({ headline: '오래 써요' })
  })

  it('짝 없는 고민도 기록만 한다 — 고민 글을 지우지 않아 섹션이 빠지지 않는다', async () => {
    answers(answer([[0, { headline: '손목 시큰한 설거지' }], [1, { headline: '얼룩 없는 바닥' }]]))
    const out = await fillTemplateSlots({ ...input, sections: [head(0, 'problem_raise'), head(1, 'point_div')] }, RUN)
    expect(out.fixCalls).toBe(0)
    expect(out.firstProblems).toMatchObject([{ index: 0, slot: 'headline', kind: 'pair' }])
    expect(out.values.get(0)).toEqual({ headline: '손목 시큰한 설거지' })
    expect(out.pointTitle).toEqual({ count: 1, medianChars: 6 })
  })
})
