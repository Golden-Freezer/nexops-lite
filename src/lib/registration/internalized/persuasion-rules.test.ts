import { describe, expect, it } from 'vitest'
import { checkPersuasionRules, type PersuasionRuleContext } from './persuasion-rules'

const VALID = ['hook_3step', 'main_cut', 'problem_raise', 'solution_guide', 'point_div', 'perf_reviews', 'hidden_page', 'cta']

function ctx(overrides: Partial<PersuasionRuleContext> = {}): PersuasionRuleContext {
  return {
    grammar: 'G1',
    lengthTarget: [7, 10],
    isSupported: () => true,
    objectionCoverage: [{ answeredBy: 'hidden_page' }, { answeredBy: null, note: '근거 없음' }],
    ...overrides,
  }
}

function failed(order: string[], c = ctx()) {
  return checkPersuasionRules(order, c).filter((r) => !r.pass).map((r) => r.id)
}

describe('설득 규칙 R1~R8', () => {
  it('유효한 골격은 전부 통과(R7은 배정 전 판정 보류)', () => {
    const results = checkPersuasionRules(VALID, ctx())
    expect(results.map((r) => r.id)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'])
    expect(results.every((r) => r.pass)).toBe(true)
    expect(results.find((r) => r.id === 'R7')?.detail).toContain('보류')
  })

  it('R1 — main_cut 3번째 / 첫 가치 6번째', () => {
    expect(failed(['hook_3step', 'problem_raise', 'main_cut', 'solution_guide', 'point_div', 'hidden_page', 'cta'])).toEqual(['R1', 'R8'])
    const lateValue = ['main_cut', 'problem_raise', 'problem_empathy', 'solution_guide', 'concept_desc', 'point_list_div', 'point_div', 'hidden_page', 'cta']
    expect(failed(lateValue)).toEqual(['R1'])
  })

  it('R2 — 주장 앞 증거는 실패, G2는 예외', () => {
    const order = ['main_cut', 'perf_reviews', 'point_div', 'hidden_page', 'concept_desc', 'point_list_div', 'cta']
    expect(failed(order)).toEqual(['R2'])
    expect(failed(order, ctx({ grammar: 'G2' }))).toEqual([])
  })

  it('R3 — 근거 없는 섹션', () => {
    expect(failed(VALID, ctx({ isSupported: (s) => s !== 'perf_reviews' }))).toEqual(['R3'])
  })

  it('R4 — 상위 3개 고민: 응답 섹션이 목록에 있거나, 응답 없이 사유가 있어야 한다', () => {
    expect(failed(VALID, ctx({ objectionCoverage: [{ answeredBy: null }, { answeredBy: 'hidden_page' }] }))).toEqual(['R4'])
    // 응답 섹션이 골격에서 빠졌는데 기록만 남은 경우(사유가 있어도 응답으로 치지 않는다)
    expect(failed(VALID, ctx({ objectionCoverage: [{ answeredBy: 'spec_table', note: '구성' }] }))).toEqual(['R4'])
    const ok = [{ answeredBy: 'hidden_page' }, { answeredBy: 'point_div' }, { answeredBy: null, note: '근거 없음' }, { answeredBy: null }]
    expect(failed(VALID, ctx({ objectionCoverage: ok }))).toEqual([]) // 4번째는 상위 3개 밖
  })

  it('R5 — cta 위치·개수, event_banner는 cta 바로 앞', () => {
    expect(failed(['main_cut', 'point_div', 'cta', 'hidden_page', 'perf_reviews', 'concept_desc', 'spec_table'])).toEqual(['R5'])
    expect(failed(['main_cut', 'point_div', 'cta', 'hidden_page', 'perf_reviews', 'concept_desc', 'cta'])).toEqual(['R5'])
    expect(failed(['main_cut', 'point_div', 'event_banner', 'hidden_page', 'perf_reviews', 'concept_desc', 'cta'])).toEqual(['R5'])
    expect(failed(['main_cut', 'point_div', 'hidden_page', 'perf_reviews', 'concept_desc', 'event_banner', 'cta'])).toEqual([])
  })

  it('R6 — 섹션 수 범위', () => {
    expect(failed(['main_cut', 'point_div', 'cta'], ctx({ objectionCoverage: [] }))).toEqual(['R6'])
  })

  it('R7 — 인접 레이아웃 중복(minimal은 중립)', () => {
    const layouts = { main_cut: 'bold', problem_raise: 'split', solution_guide: 'split', point_div: 'minimal', perf_reviews: 'minimal' }
    expect(failed(VALID, ctx({ layouts }))).toEqual(['R7'])
    expect(failed(VALID, ctx({ layouts: { ...layouts, solution_guide: 'card' } }))).toEqual([])
  })

  it('R8 — hook은 main_cut 앞, 공감 바로 뒤 solution_guide', () => {
    expect(failed(['main_cut', 'hook_3step', 'problem_raise', 'solution_guide', 'point_div', 'hidden_page', 'cta'])).toEqual(['R8'])
    expect(failed(['hook_3step', 'main_cut', 'problem_raise', 'point_div', 'solution_guide', 'hidden_page', 'cta'])).toEqual(['R8'])
  })
})
