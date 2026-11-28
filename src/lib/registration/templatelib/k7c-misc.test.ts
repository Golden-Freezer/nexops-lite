/**
 * K7-c 묶음 3a 기타 칸(T2-36·T2-49·T2-47, 통합 11-03 23:5x 승인) — 새 칸 3개가 린트를 지나고, 줄 설명의 모양대로 그려지는지 본다.
 * POINT 머리 → 사진 → 구분선 → 굵은 한 줄, 실내·손 컷 → 가로·세로 숫자. LLM·DB 없음
 * 치수 칸은 끝자리 표의 상자 도식과 겹치지 않게 숫자 줄만 쓰고(판단 1 ⓑ), 가로·세로를 둘 다 읽을 때만 고른다. 2열 값 표(T2-34)는 compare_basis 입력(C5) 뒤로,
 * 큰 수치 칸(T2-23)·짧은 선 칸(T2-53)·CHECK 이름표 칸(T2-39)은 시험 상품 P09에서 정보 섹션(how_to·faq)이 빠져(수치 최대 1로 한 번 낮춰도 그대로) 이 묶음에서 뺐다(통합 끝내는 규칙).
 */

import { describe, expect, it } from 'vitest'
import type { CanvasElement } from '@/lib/registration/editor/types/canvas'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { renderTemplate } from './engine'
import { lineInputsOf, requiredInputsFit } from './input-values'
import { templateById } from './library'
import { lintTemplate } from './lint'
import { sampleContext, sampleSlots } from './sample'
import type { Template } from './template-types'

const NEW_CELLS = [
  'point_div.photo-then-desc',
  'product_exposure.room-size',
  'product_exposure.hand-size',
]
const SIZE_CELLS = ['product_exposure.room-size', 'product_exposure.hand-size']
const cell = (id: string): Template => {
  const found = templateById(id)
  if (!found) throw new Error(`라이브러리에 없음: ${id}`)
  return found
}
const drawn = (id: string) => {
  const t = cell(id)
  const slots = sampleSlots(t, { mode: 'full' })
  return { slots, out: renderTemplate(t, slots, sampleContext())! }
}
const named = (els: CanvasElement[], name: string) => els.filter((e) => e.name === name)
const photos = (els: CanvasElement[]) => els.filter((e) => e.type === 'framed-image')
const texts = (els: CanvasElement[]) => els.filter((e) => e.type === 'text')
const bottomOf = (e: CanvasElement) => e.transform.y + e.transform.height
const inputsOf = (size: string) => lineInputsOf({ spec_sheet: { size } as PdpSpecSheet, analysis: {}, copy_sections: { final: {} } } as unknown as PdpJobRow)

describe('K7-c 묶음 3a — 기타 새 칸', () => {
  it.each(NEW_CELLS)('%s — 린트 위반 0', (id) => {
    expect(lintTemplate(cell(id)).map((v) => `${v.rule}:${v.detail}`)).toEqual([])
  })

  it('POINT 머리는 기존 point-standard와 같고, 보충 설명은 사진·구분선 아래', () => {
    expect(cell('point_div.photo-then-desc').headStyle).toBe(cell('point_div.offset-rule').headStyle)
    const els = drawn('point_div.photo-then-desc').out.elements
    const [photo] = photos(els)
    const [rule] = named(els, 'designcut-rule')
    expect(rule.transform.y).toBeGreaterThanOrEqual(bottomOf(photo))
    const below = texts(els).filter((e) => e.transform.y > bottomOf(rule))
    expect(below.length).toBeGreaterThan(0)
  })

  it.each(SIZE_CELLS)('%s — 치수 상자 도식 없이 가로·세로 숫자 줄이 사진 아래', (id) => {
    const els = drawn(id).out.elements
    expect(named(els, 'annotation-leader-box')).toHaveLength(0)
    const [photo] = photos(els)
    const numbers = texts(els).filter((e) => e.transform.y > bottomOf(photo))
    expect(numbers).toHaveLength(2)
  })

  it.each(SIZE_CELLS)('%s — 가로·세로를 둘 다 읽을 때만 고른다(못 읽으면 그 상품 쪽은 그대로)', (id) => {
    const t = cell(id)
    expect(requiredInputsFit(t, inputsOf('57mm x 168mm'))).toBe(true)
    expect(requiredInputsFit(t, inputsOf('5cm 원형'))).toBe(false)
    expect(requiredInputsFit(t, inputsOf(''))).toBe(false)
  })
})
