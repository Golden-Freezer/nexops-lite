/**
 * C5 ② K 비교 근거 칸(R-D2 K, 통합 11-04 03:3x ②·04:5x ①~⑤) — 비교 입력이 있을 때만 근거(compare_basis)가 서고, 잠긴 비교 칸은 입력 꼴이 맞을 때만 고른다.
 * ① ✓ 우리·줄표 기존 표(marks-table·compare-marks): 항목만, 모든 행의 기존이 빌 때 3~5행 ③ vs-cards: 행 정확히 1개·기존 있음
 * ② side-rows ④ cross-check-lists ⑤ tile-duel: 닫음 — 기존·우리를 글(고정 이름표나 열 머리)로 가르는 칸만 연다(통합 11-04 05:15).
 * 넘치거나 하나라도 길면 목록 전체를 비운다. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import type { CompareBasisRow } from '../input-slots'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { renderTemplate } from './engine'
import { fillInputSlots, lineInputsOf, requiredInputsFit } from './input-values'
import { TEMPLATES, templateById } from './library'
import { lintTemplate } from './lint'
import { sampleContext, sampleSlots } from './sample'
import { evidenceOf } from './selection-facts'
import { COMPARE_BASIS, COMPARE_INPUT_PREFIX, COMPARE_LABELS, type ListSlot, type SlotValues, type Template, type TextSlot } from './template-types'

const MARKS = ['compare.marks-table', 'point_div.compare-marks']
const CLOSED = ['compare.cross-check-lists', 'compare.side-rows', 'compare.tile-duel']
const ALL = [...MARKS, 'compare.vs-cards', ...CLOSED]
const cell = (id: string): Template => {
  const found = templateById(id)
  if (!found) throw new Error(`라이브러리에 없음: ${id}`)
  return found
}
const BASE = { productName: '표본 상품' } as unknown as PdpSpecSheet
const withRows = (rows: CompareBasisRow[], extra: Partial<PdpSpecSheet> = {}) => ({ ...BASE, compareBasis: rows, ...extra }) as unknown as PdpSpecSheet
const inputsOf = (spec: PdpSpecSheet) => lineInputsOf({ spec_sheet: spec, analysis: {}, copy_sections: { final: {} } } as unknown as PdpJobRow)
const fitting = (spec: PdpSpecSheet) => ALL.filter((id) => requiredInputsFit(cell(id), inputsOf(spec)))
const values = (id: string, spec: PdpSpecSheet) => fillInputSlots(cell(id), inputsOf(spec))

const NO_BASE = [
  { label: '표본 손잡이', ours: '접이식' },
  { label: '표본 세척', ours: '분리 세척' },
  { label: '표본 보관', ours: '세워 보관' },
]
const WITH_BASE = [
  { label: '표본 용량', ours: '500ml', other: '350ml' },
  { label: '표본 무게', ours: '210g', other: '320g' },
]

describe('C5 ② — K 비교 근거 칸', () => {
  it.each(ALL)('%s — 린트 위반 0', (id) => {
    expect(lintTemplate(cell(id)).map((v) => `${v.rule}:${v.detail}`)).toEqual([])
  })

  it('비교 입력이 없으면 근거가 서지 않고, 잠긴 칸 6개 모두 고르지 않는다(지금과 같음)', () => {
    expect(evidenceOf(BASE).has(COMPARE_BASIS)).toBe(false)
    expect(fitting(BASE)).toEqual([])
  })

  it('거르고 남는 행이 있을 때만 근거가 선다 — 깎아내리는 행·타사 표식 행·규제 표현 행만 있으면 서지 않는다', () => {
    expect(evidenceOf(withRows(NO_BASE)).has(COMPARE_BASIS)).toBe(true)
    const unfair = withRows([
      { label: '표본 내구', ours: '튼튼함', other: '쉽게 망가짐' },
      { label: '표본 비교', ours: '가벼움', other: '타사 제품' },
      { label: '표본 효능', ours: '질병 치료', other: '없음' },
    ])
    expect(evidenceOf(unfair).has(COMPARE_BASIS)).toBe(false)
    expect(fitting(unfair)).toEqual([])
  })

  it('① 기존이 모두 빈 3~5행이면 ✓·줄표 표 두 칸만 — 항목 글 그대로, 기존 값을 줄표로 가리지 않는다', () => {
    expect(fitting(withRows(NO_BASE))).toEqual(MARKS)
    for (const id of MARKS) expect(values(id, withRows(NO_BASE)).rows).toEqual(NO_BASE.map((row) => ({ item: row.label })))
    // 2행은 표 하한(3) 미만, 기존이 하나라도 있으면 줄표 표를 쓰지 않는다
    expect(fitting(withRows(NO_BASE.slice(0, 2)))).toEqual([])
    expect(fitting(withRows([...NO_BASE, { label: '표본 크기', ours: '20cm', other: '30cm' }]))).toEqual([])
  })

  it('칸보다 긴 항목이 하나라도 있으면 목록 전체를 비운다(잘라 싣지 않는다) — 입력 항목 상한(12자)이 지금 칸(24자)보다 작아 칸을 좁힌 사본으로 본다', () => {
    const t = cell('compare.marks-table')
    const rows = t.slots.rows as ListSlot
    const narrow = { ...t, slots: { ...t.slots, rows: { ...rows, fields: { ...rows.fields, item: { ...(rows.fields.item as TextSlot), maxChars: 4 } } } } } as Template
    // 글자 수는 공백을 빼고 센다 — '표본 손잡이' 5자
    const long = withRows([{ label: '표본 손잡이', ours: '접이식' }, { label: '세척', ours: '분리 세척' }, { label: '보관', ours: '세워 보관' }])
    expect(requiredInputsFit(narrow, inputsOf(long))).toBe(false)
    expect(fillInputSlots(narrow, inputsOf(long)).rows).toBeUndefined()
    const short = withRows([{ label: '손잡이', ours: '접이식' }, { label: '세척', ours: '분리 세척' }, { label: '보관', ours: '세워 보관' }])
    expect(fillInputSlots(narrow, inputsOf(short)).rows).toEqual([{ item: '손잡이' }, { item: '세척' }, { item: '보관' }])
  })

  it('② 모든 행에 기존이 있는 2~3행이어도 K 비교 칸 0 — 기존 → 우리 줄(side-rows)은 줄마다 기존·우리를 가르는 글이 없어 닫았다(D T9 줄만 그린다)', () => {
    expect(fitting(withRows(WITH_BASE))).toEqual([])
    expect(fitting(withRows([...WITH_BASE, { label: '표본 높이', ours: '18cm', other: '22cm' }]))).toEqual([])
    // 입력 칸이 없어 입력 값이 실리지 않는다 — 다시 열 때는 고정 이름표 '기존 제품'·'우리 제품' 설계와 함께 칸을 더한다
    expect(values('compare.side-rows', withRows(WITH_BASE))).toEqual({})
  })

  it('열 수 있는 비교 칸(비교 입력 칸이 있는 근거 잠금 칸)은 흐름에 이름표나 열 머리 \'우리 제품\'·\'기존 제품\'이 둘 다 있다(통합 11-04 05:15 원칙)', () => {
    const isCompareInput = (input: unknown) => typeof input === 'string' && input.startsWith(COMPARE_INPUT_PREFIX)
    const openable = TEMPLATES.filter(
      (t) => t.needs.evidence.includes(COMPARE_BASIS) && Object.values(t.slots).some((def) => def.type !== 'image' && def.source === 'input' && isCompareInput(def.input))
    )
    expect(openable.map((t) => t.id).sort()).toEqual([...MARKS, 'compare.vs-cards'].sort())
    for (const t of openable) {
      const flow = JSON.stringify(t.flow)
      for (const label of COMPARE_LABELS) expect(flow, `${t.id} ${label}`).toContain(`"label":"${label}"`)
    }
  })

  it('③ 기존이 있는 행이 정확히 1개면 카드 한 쌍(vs-cards)만 — 기존이 없거나 행이 둘이면 고르지 않는다', () => {
    expect(fitting(withRows([WITH_BASE[0]]))).toEqual(['compare.vs-cards'])
    expect(values('compare.vs-cards', withRows([WITH_BASE[0]]))).toMatchObject({ from: '350ml', to: '500ml' })
    expect(fitting(withRows([NO_BASE[0]]))).toEqual([])
  })

  it('섞인 입력(일부 행만 기존)은 K 비교 칸 0 — D T9 줄만 그린다(통합 04:5x)', () => {
    expect(fitting(withRows([...WITH_BASE, NO_BASE[0]]))).toEqual([])
  })

  it('②④⑤ 이름표 없는 기존 → 우리 줄·기존 목록 줄표 표식 칸·사진 두 장 칸은 근거가 서도 고르지 않는다(기존·우리가 글로 안 갈리거나, 입력 사실이 안 나오거나, 기존 값 옆 줄표가 깎는 것처럼 읽힘)', () => {
    for (const spec of [withRows(NO_BASE), withRows(WITH_BASE), withRows([WITH_BASE[0]])]) {
      for (const id of CLOSED) expect(requiredInputsFit(cell(id), inputsOf(spec)), id).toBe(false)
    }
  })

  it('입력으로 채운 칸은 엔진이 그대로 그린다(카피 칸은 표본 글) — 항목·값 글이 그대로 나온다', () => {
    const cases: Array<[string, PdpSpecSheet, string[]]> = [
      ['compare.marks-table', withRows(NO_BASE), NO_BASE.map((row) => row.label)],
      ['point_div.compare-marks', withRows(NO_BASE), NO_BASE.map((row) => row.label)],
      ['compare.vs-cards', withRows([WITH_BASE[0]]), ['350ml', '500ml']],
    ]
    for (const [id, spec, texts] of cases) {
      // 카피·사진 칸은 표본 값, 입력 칸만 이 상품 입력으로 덮는다
      const slots: SlotValues = { ...sampleSlots(cell(id), { mode: 'full' }), ...values(id, spec) }
      const out = renderTemplate(cell(id), slots, sampleContext())
      expect(out, id).not.toBeNull()
      const shown = out!.elements.map((e) => e.textProps?.content ?? '').join('\n')
      for (const text of texts) expect(shown, `${id} ${text}`).toContain(text)
    }
  })
})
