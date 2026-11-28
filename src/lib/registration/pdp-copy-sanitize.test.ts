import { describe, expect, it } from 'vitest'
import { PREMIUM_COPYWRITING_PROMPT } from '@/lib/agents/registration/prompts/pdp-copy-prompts'
import { STAGE3_QUALITY_GATE_PROMPT } from '@/lib/agents/registration/prompts/pdp-copy-pro-prompts'
import { ProSectionType } from './editor/types/section'
import { createSectionElements } from './editor/utils/sectionConverter/sections'
import { BUBBLE_MAX_CHARS } from './internalized/designcut-plan'
import { EMPATHY_LINE_MAX_CHARS, validateEmpathyLines } from './pdp-copy-sanitize'

// 말풍선 잘림 — 정화가 글자 수로 잘라 '…때마다 손이 많' 같은 줄이 그대로 나갔다(저장 118잡 944줄 중 확정 122줄, 원래 길이 16~20자)

const LONG_16 = '포장할 때마다 너무 번거로워요'
const LONG_22 = '문구를 뭐라고 써야 할지 매번 막막해져요'
const LONG_28 = '여러 개를 한꺼번에 쌀 때마다 시간이 오래 걸려서요'
const OVER_30 = '여러 개를 한꺼번에 쌀 때마다 시간이 정말 오래 걸려요'
const chars = (s: string) => [...s].length

const validate = (problem: Parameters<typeof validateEmpathyLines>[0]['problem'], name = '선물 포장 상자', category = '포장') =>
  validateEmpathyLines({ problem } as Parameters<typeof validateEmpathyLines>[0], name, category)

describe('validateEmpathyLines — 글자 수로 자르지 않는다', () => {
  it('시험 글의 길이가 이름대로다', () => {
    expect([LONG_16, LONG_22, LONG_28, OVER_30].map(chars)).toEqual([16, 22, 28, 30])
  })

  it('상한 안의 줄은 16자도 28자도 한 글자도 바뀌지 않는다', () => {
    const lines = [LONG_16, LONG_22, LONG_28, '테이프 자국이 지저분해요']
    expect(validate({ empathyLines: lines }).empathyLines).toEqual(lines)
  })

  it('상한을 넘는 줄은 앞부분만 남기지 않고 버린 뒤 폴백으로 채운다', () => {
    const out = validate({ empathyLines: [OVER_30, LONG_16, LONG_22, LONG_28] }).empathyLines ?? []
    expect(out.slice(0, 3)).toEqual([LONG_16, LONG_22, LONG_28])
    expect(out).toHaveLength(4)
    expect(out.some((l) => OVER_30.startsWith(l))).toBe(false)
  })

  it('앞뒤 따옴표는 글자 수에 넣지 않는다(T2가 떼고 잰다)', () => {
    const quoted = `"${LONG_28}"`
    expect(validate({ empathyLines: [quoted, LONG_16, LONG_22, '비닐은 너무 성의 없어요'] }).empathyLines?.[0]).toBe(quoted)
  })

  it('앞 15자가 같은 두 줄은 이제 다른 줄이다, 완전히 같은 줄만 합친다', () => {
    const a = '포장할 때마다 너무 번거로워서 지쳐요'
    const b = '포장할 때마다 너무 번거로워서 힘들어요'
    const out = validate({ empathyLines: [a, b, a, LONG_22] }).empathyLines ?? []
    expect(out.slice(0, 3)).toEqual([a, b, LONG_22])
  })

  it('폴백 문구도 끝까지 남는다 — 긴 상품명으로 만든 문구, 공감 문단 조각', () => {
    const out = validate({ empathyLines: [], empathy: '여러 개를 한꺼번에 쌀 때마다 시간이 오래 걸려요, 짧음' }, '여덟글자상품이름 뒤는 잘림', '일상').empathyLines ?? []
    expect(out[0]).toBe('여러 개를 한꺼번에 쌀 때마다 시간이 오래 걸려요')
    expect(out).toContain('여덟글자상품이름 고민 있으셨죠')
    expect(out.every((l) => chars(l) <= EMPATHY_LINE_MAX_CHARS)).toBe(true)
  })

  it('심화 줄도 같다 — 자르지 않고, 공감 줄과 같은 줄은 뺀다', () => {
    const out = validate({
      empathyLines: [LONG_16, LONG_22, LONG_28, '테이프 자국이 지저분해요'],
      empathyDeepLines: [LONG_16, '또 망칠까 봐 포장 앞에서 자꾸 망설여져요', OVER_30, '할 때마다 한숨이 나와요', '나만 이런 건가 자괴감 들어요'],
    })
    expect(out.empathyDeepLines?.slice(0, 3)).toEqual(['또 망칠까 봐 포장 앞에서 자꾸 망설여져요', '할 때마다 한숨이 나와요', '나만 이런 건가 자괴감 들어요'])
    expect(out.empathyDeepLines).toHaveLength(4)
  })

  it('플레이스홀더는 지금처럼 걷는다', () => {
    const out = validate({ empathyLines: ['고민 1', LONG_16, LONG_22, LONG_28] }).empathyLines ?? []
    expect(out).not.toContain('고민 1')
    expect(out.slice(0, 3)).toEqual([LONG_16, LONG_22, LONG_28])
  })
})

describe('상한이 한 값이다', () => {
  it('정화와 T2가 같은 상한을 쓴다', () => {
    expect(EMPATHY_LINE_MAX_CHARS).toBe(BUBBLE_MAX_CHARS)
  })

  it('프롬프트가 자르라고 시키지 않고 같은 상한을 말한다', () => {
    for (const prompt of [PREMIUM_COPYWRITING_PROMPT, STAGE3_QUALITY_GATE_PROMPT]) {
      expect(prompt).not.toMatch(/15자로 (잘라|절단)/)
      expect(prompt).not.toMatch(/(고객 고민|감정 심화) \d \((반드시 )?15자 이내/)
      expect(prompt).toContain(`${EMPATHY_LINE_MAX_CHARS}자`)
    }
    expect(STAGE3_QUALITY_GATE_PROMPT).not.toMatch(/empathy(Deep)?Lines\[\]: 15자 이내/)
    expect(STAGE3_QUALITY_GATE_PROMPT).toContain('글자 수로')
  })
})

describe('옛 말풍선은 긴 줄을 줄 수대로 늘려 그린다 — 15자 제한이 필요 없다', () => {
  const palette = { primary: '#2563eb', secondary: '#64748b', bgMain: '#ffffff', bgSub: '#f8fafc', textMain: '#1a1a1a' } as never
  const byName = (els: ReturnType<typeof createSectionElements>, name: string) => {
    const el = els.find((e) => e.name === name)
    if (!el) throw new Error(`요소 없음: ${name}`)
    return el
  }

  it('PROBLEM_EMPATHY — 글이 그대로 있고 바탕이 글을 품으며 말풍선끼리 겹치지 않는다', () => {
    const lines = ['테이프 자국이 지저분해요', LONG_16, LONG_22, LONG_28]
    const els = createSectionElements(ProSectionType.PROBLEM_EMPATHY, { empathyLines: lines }, null, palette)
    lines.forEach((line, i) => {
      const text = byName(els, `bubble_text_${i}`)
      const bg = byName(els, `bubble_bg_${i}`)
      expect(text.textProps?.content).toContain(line)
      expect(text.transform.y).toBeGreaterThanOrEqual(bg.transform.y)
      expect(text.transform.y + text.transform.height).toBeLessThanOrEqual(bg.transform.y + bg.transform.height)
      if (i > 0) {
        const prev = byName(els, `bubble_bg_${i - 1}`)
        expect(bg.transform.y).toBeGreaterThanOrEqual(prev.transform.y + prev.transform.height)
      }
    })
    const height = (i: number) => byName(els, `bubble_bg_${i}`).transform.height
    expect(height(3)).toBeGreaterThan(height(0))
  })

  it('PROBLEM_RAISE — 세로 스텝도 글이 그대로이고 뒤 스텝이 앞 스텝 아래에 온다', () => {
    const lines = ['테이프 자국이 지저분해요', LONG_22, LONG_28]
    const els = createSectionElements(ProSectionType.PROBLEM_RAISE, { question: '포장, 어떻게 하세요?', empathyLines: lines }, null, palette)
    lines.forEach((line, i) => {
      const text = byName(els, `step_text_${i}`)
      expect(text.textProps?.content).toBe(line)
      if (i > 0) {
        const prev = byName(els, `step_text_${i - 1}`)
        expect(text.transform.y).toBeGreaterThanOrEqual(prev.transform.y + prev.transform.height)
      }
    })
  })
})
