import { describe, expect, it } from 'vitest'
import { buildSlotCopyPrompt, type SlotCopyInput } from '@/lib/agents/registration/prompts/pdp-template-copy-prompts'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { lineInputsOf } from './input-values'
import { buildSpecOptionCountBlock, SPEC_OPTION_MAX, specFixedLines, specOptionLabels } from './spec-fixed'

const spec = (extra: Partial<PdpSpecSheet> = {}) => ({ productName: '강아지 밥그릇', ...extra }) as PdpSpecSheet
const optionSpecOf = (labels: string[]) => ({
  source: 'manual',
  axes: [{ kind: 'color', name: '색상', values: labels }],
  variants: labels.map((label) => ({ label, values: { color: label } })),
})

describe('specOptionLabels — 판매자 입력 옵션 이름', () => {
  it('등록 옵션 구조 변형 이름을 먼저, 없으면 colorOptions', () => {
    expect(specOptionLabels(spec({ colorOptions: ['블랙', '화이트'], optionSpec: optionSpecOf(['그린 2구']) as never }))).toEqual(['그린 2구'])
    expect(specOptionLabels(spec({ colorOptions: [' 블랙 ', '화이트'] }))).toEqual(['블랙', '화이트'])
    expect(specOptionLabels(spec())).toEqual([])
  })

  it('빈 값·같은 이름은 한 번, 상한까지', () => {
    expect(specOptionLabels(spec({ colorOptions: ['블랙', '', '블랙', '  '] }))).toEqual(['블랙'])
    const many = Array.from({ length: 20 }, (_, i) => `색${i}`)
    expect(specOptionLabels(spec({ colorOptions: many }))).toHaveLength(SPEC_OPTION_MAX)
  })
})

describe('specFixedLines — 칸 카피 고정 값 줄', () => {
  it('크기·소재·옵션 수를 입력 글자 그대로(공백만 한 칸으로) 싣는다', () => {
    expect(specFixedLines(spec({ size: '가로 30cm  x 세로 20cm', material: '도자기, ABS' }), ['그린', '베이지'])).toEqual([
      '- 크기: 가로 30cm x 세로 20cm',
      '- 소재: 도자기, ABS',
      '- 옵션 2개: 그린/베이지',
    ])
  })

  it('값이 없는 것은 줄이 없고, 옵션이 많으면 개수만 적는다', () => {
    expect(specFixedLines(spec(), [])).toEqual([])
    expect(specFixedLines(spec({ material: 'PP' }), ['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toEqual(['- 소재: PP', '- 옵션 7개'])
  })

  it('규제 표현이 든 값은 넘기지 않는다', () => {
    expect(specFixedLines(spec({ material: '항균 99.9% 살균 실리콘', size: '10cm' }), [])).toEqual(['- 크기: 10cm'])
  })
})

describe('buildSpecOptionCountBlock — 메인 카피 옵션 수(등록 옵션 구조 없는 잡)', () => {
  it('옵션이 있으면 머리말·개수 줄·규칙, 없으면 빈 글', () => {
    expect(buildSpecOptionCountBlock(spec({ colorOptions: ['블랙', '화이트', '그레이'] }))).toBe(
      ['## [사실 값 — 옵션 수는 이 값만 쓴다]', '- 옵션 3개: 블랙/화이트/그레이', '- 위 개수와 다른 옵션 수를 쓰지 않는다.'].join('\n')
    )
    expect(buildSpecOptionCountBlock(spec())).toBe('')
  })
})

describe('lineInputsOf — K 옵션 칩 원천(specfixed)', () => {
  const jobOf = (features: string[], extra: Partial<PdpSpecSheet>, final: Record<string, unknown> = {}) =>
    ({ spec_sheet: spec(extra), analysis: { enrichment: { version: 1, features } }, copy_sections: { final } }) as unknown as PdpJobRow

  it('꺼진 잡은 지금 그대로 — 등록 옵션 구조가 없으면 카피 options 칸(없으면 빈 칩)', () => {
    expect(lineInputsOf(jobOf(['options', 'templatelib'], { colorOptions: ['블랙', '화이트'] })).options).toEqual([])
    expect(lineInputsOf(jobOf(['options', 'templatelib'], { colorOptions: ['블랙'] }, { options: ['카피 옵션'] })).options).toEqual([{ label: '카피 옵션', image: null }])
  })

  it('켠 잡은 판매자 입력 옵션 이름을 이름만으로 쓴다 — colorOptions 하나여도 그 이름이다', () => {
    expect(lineInputsOf(jobOf(['options', 'templatelib', 'specfixed'], { colorOptions: ['블랙', '화이트'] }, { options: ['카피 옵션'] })).options).toEqual([
      { label: '블랙', image: null },
      { label: '화이트', image: null },
    ])
    expect(lineInputsOf(jobOf(['options', 'templatelib', 'specfixed'], { colorOptions: ['실버'] })).options).toEqual([{ label: '실버', image: null }])
  })

  it('켠 잡도 입력에 옵션이 없으면 지금 길, 등록 옵션 구조(변형 2개 이상) 잡은 그 칩 그대로', () => {
    expect(lineInputsOf(jobOf(['options', 'templatelib', 'specfixed'], {}, { options: ['카피 옵션'] })).options).toEqual([{ label: '카피 옵션', image: null }])
    const structured = { colorOptions: ['x'], optionSpec: optionSpecOf(['그린', '베이지']) as never }
    expect(lineInputsOf(jobOf(['options', 'templatelib', 'specfixed'], structured)).options).toEqual(lineInputsOf(jobOf(['options', 'templatelib'], structured)).options)
    expect(lineInputsOf(jobOf(['options', 'templatelib'], structured)).options.map((o) => o.label)).toEqual(['그린', '베이지'])
  })
})

describe('buildSlotCopyPrompt — 고정 값 블록', () => {
  const base: SlotCopyInput = {
    product: { category: 'pet', persona: null, summary: '', keywords: [], usps: [], pains: [] },
    guideline: { persona: '', tone: '' },
    facts: ['도자기'],
    sections: [],
  }

  it('fixedValues가 없거나 비면 프롬프트 글자가 이 칸 전과 같다', () => {
    const before = buildSlotCopyPrompt(base)
    expect(buildSlotCopyPrompt({ ...base, fixedValues: [] })).toBe(before)
    expect(before).toContain('1. 도자기\n\n## 규칙')
  })

  it('있으면 사실 목록 뒤·규칙 앞에 고정 값 블록이 들어간다', () => {
    const out = buildSlotCopyPrompt({ ...base, fixedValues: ['- 크기: 10cm', '- 옵션 2개: 그린/베이지'] })
    expect(out).toContain('1. 도자기\n\n## 고정 값(판매자 입력 — 쓸 때는 글자·숫자·단위를 그대로 쓴다)\n- 크기: 10cm\n- 옵션 2개: 그린/베이지\n- 크기·소재·옵션 수를 반올림·환산하거나 다른 말로 바꾸지 않는다.')
    expect(out.indexOf('## 고정 값')).toBeLessThan(out.indexOf('## 규칙'))
  })
})
