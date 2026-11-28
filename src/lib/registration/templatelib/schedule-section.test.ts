/**
 * C5 ④ 사용·교체·배송 주기(R-D3 K) — how_to.schedule-rows는 입력 schedule이 2줄 이상 남을 때만 채워지고 고를 수 있다.
 * 효과 시간표(기간 → 몸·피부 변화) 줄과 규제 표현 줄은 scheduleOf가 빼고(inputSlotsOf와 같은 함수), 넘치거나 길면 칸을 비워 후보에서 빠진다. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import { getPdpTestProduct, PDP_TEST_PRODUCT_IDS } from '../__fixtures__/pdp-products'
import { inputSlotsOf } from '../input-slots-read'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { fillInputSlots, lineInputsOf, requiredInputsFit, scheduleOf } from './input-values'
import { templateById, templatesOf } from './library'
import { lintTemplate } from './lint'
import { evidenceOf } from './selection-facts'
import type { Template } from './template-types'

const ID = 'how_to.schedule-rows'
const cell = (): Template => {
  const found = templateById(ID)
  if (!found) throw new Error(`라이브러리에 없음: ${ID}`)
  return found
}
const BASE = { productName: '표본 상품' } as unknown as PdpSpecSheet
const withSchedule = (schedule: Array<{ label: string; period: string }>) => ({ ...BASE, schedule }) as unknown as PdpSpecSheet
const inputsOf = (spec: PdpSpecSheet) => lineInputsOf({ spec_sheet: spec, analysis: {}, copy_sections: { final: {} } } as unknown as PdpJobRow)
const rowsOf = (spec: PdpSpecSheet) => fillInputSlots(cell(), inputsOf(spec)).rows as Array<Record<string, string>> | undefined
const TWO = [{ label: '교체', period: '3개월마다' }, { label: '사용', period: '1일 1회' }]

describe('C5 ④ — 사용 주기 칸', () => {
  it('how_to에 주기 칸이 하나 있고 근거 usage로 잠겨 있다, 린트 위반 0', () => {
    expect(templatesOf('how_to').filter((t) => t.id === ID)).toHaveLength(1)
    expect(cell().needs.evidence).toEqual(['usage'])
    expect(lintTemplate(cell()).map((v) => `${v.rule}:${v.detail}`)).toEqual([])
  })

  it('입력이 없으면 줄이 비고 칸을 고를 수 없다', () => {
    expect(rowsOf(BASE)).toBeUndefined()
    expect(requiredInputsFit(cell(), inputsOf(BASE))).toBe(false)
  })

  it('2줄이면 이름·기간을 입력 그대로 채운다', () => {
    expect(rowsOf(withSchedule(TWO))).toEqual([{ label: '교체', period: '3개월마다' }, { label: '사용', period: '1일 1회' }])
    expect(requiredInputsFit(cell(), inputsOf(withSchedule(TWO)))).toBe(true)
  })

  it('효과 시간표 줄을 빼고, 남은 게 2줄 미만이면 칸을 고르지 않는다', () => {
    const effect = { label: '2주 사용', period: '피부 개선' }
    expect(rowsOf(withSchedule([effect, ...TWO]))).toHaveLength(2)
    expect(rowsOf(withSchedule([effect, TWO[0]]))).toBeUndefined()
    expect(requiredInputsFit(cell(), inputsOf(withSchedule([effect, TWO[0]])))).toBe(false)
  })

  it('K 칸과 D 읽기(inputSlotsOf)가 같은 줄을 쓴다', () => {
    const spec = withSchedule([{ label: '4주 뒤', period: '탈모 감소' }, ...TWO, { label: '배송', period: '주문 후 2일' }])
    expect(inputSlotsOf(spec).schedule).toEqual(scheduleOf(spec))
    expect(scheduleOf(spec)).toHaveLength(3)
  })

  it('scheduleOf — 효과 시간표 줄·규제 표현 줄(살균·인증 사칭)을 빼고, 입력 인증에 있는 인증 표현만 남긴다', () => {
    const kc = { label: 'KC 인증 필터', period: '6개월마다' }
    const sterilize = { label: '살균 세척', period: '주 1회' }
    const effect = { label: '주름 개선', period: '4주 사용 뒤' }
    const spec = withSchedule([kc, sterilize, effect, ...TWO])
    expect(scheduleOf(spec)).toEqual(TWO)
    expect(scheduleOf({ ...spec, certificationInfo: 'KC 안전확인' })).toEqual([kc, ...TWO])
  })

  it('주기 입력만 있어도 쓰는 법 근거가 선다 — 입력 없으면 그대로', () => {
    expect(evidenceOf(BASE).has('usage')).toBe(false)
    expect(evidenceOf(withSchedule(TWO)).has('usage')).toBe(true)
    expect(evidenceOf(withSchedule([TWO[0]])).has('usage')).toBe(false)
  })

  it('시험 상품 11개에는 주기 입력이 없어 칸이 채워지지 않는다(기본 입력 페이지 그대로)', () => {
    for (const id of PDP_TEST_PRODUCT_IDS) expect(rowsOf(getPdpTestProduct(id).specSheet), id).toBeUndefined()
  })
})
