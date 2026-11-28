/**
 * K7-c 묶음 2 배치 칸(T2-38·T2-41·T2-20·T1-29 후보 3, 통합 11-03 20:1x 승인) — 새 칸 7개가 린트를 지나고, 줄 설명의 모양대로 그려지는지 본다.
 * 윤곽선 상자 2개, 가운데 제목 → 줄 목록 → 사진, 짙은 띠 위 흰 카드 줄 → 풀폭 사진, 짙은 머리 띠 이름표 → 줄 글. LLM·DB 없음
 * 좌우 번갈아 칸(sub_div·point_list_div)·hidden_page 윤곽선 칸·소재 사진 2×2 칸은 시험 상품 페이지에서 정보 섹션(how_to·faq)이 빠져 이 묶음에서 뺐다(통합 11-03 22:5x).
 */

import { describe, expect, it } from 'vitest'
import type { CanvasElement } from '@/lib/registration/editor/types/canvas'
import { renderTemplate } from './engine'
import { templateById } from './library'
import { lintTemplate } from './lint'
import { sampleContext, sampleSlots } from './sample'
import type { Template } from './template-types'

const NEW_CELLS = [
  'sub_div.outline-pair',
  'sub_div.center-list',
  'direction_suggest.center-list',
  'review.dark-cards',
  'direction_suggest.dark-cards',
  'faq.band-head-rows',
  'certification.band-head-rows',
]
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
const bottomOf = (e: CanvasElement) => e.transform.y + e.transform.height
const inside = (inner: CanvasElement, outer: CanvasElement) =>
  inner.transform.x >= outer.transform.x &&
  inner.transform.y >= outer.transform.y &&
  inner.transform.x + inner.transform.width <= outer.transform.x + outer.transform.width &&
  bottomOf(inner) <= bottomOf(outer)
const countOf = (slots: Record<string, unknown>, name: string) => (slots[name] as unknown[]).length

describe('K7-c 묶음 2 — 배치 새 칸', () => {
  it.each(NEW_CELLS)('%s — 린트 위반 0', (id) => {
    expect(lintTemplate(cell(id)).map((v) => `${v.rule}:${v.detail}`)).toEqual([])
  })

  it('윤곽선 상자 2개(채움 없음·선 있음), 상자마다 사진 하나', () => {
    const els = drawn('sub_div.outline-pair').out.elements
    const boxes = named(els, 'designcut-panel')
    expect(boxes).toHaveLength(2)
    for (const box of boxes) {
      expect(box.shapeProps?.stroke).toBeTruthy()
      expect(box.shapeProps?.fill).toBe('transparent')
      expect(photos(els).filter((p) => inside(p, box))).toHaveLength(1)
    }
  })

  it.each(['sub_div.center-list', 'direction_suggest.center-list'])('%s — 줄 목록 사이 구분선, 사진은 목록 아래', (id) => {
    const { slots, out } = drawn(id)
    const rules = named(out.elements, 'designcut-rule')
    expect(rules).toHaveLength(countOf(slots, 'items') - 1)
    const [photo] = photos(out.elements)
    expect(photo.transform.y).toBeGreaterThan(Math.max(...rules.map(bottomOf)))
  })

  it.each([
    ['review.dark-cards', 'items'],
    ['direction_suggest.dark-cards', 'tips'],
  ])('%s — 풀폭 짙은 띠 안에 흰 카드가 항목 수만큼, 풀폭 사진은 띠 아래', (id, list) => {
    const { slots, out } = drawn(id)
    const [band, ...cards] = named(out.elements, 'designcut-panel')
    expect(band.transform.width).toBe(860)
    expect(cards).toHaveLength(countOf(slots, list))
    for (const card of cards) {
      expect(inside(card, band), id).toBe(true)
      expect(card.shapeProps?.fill).not.toBe(band.shapeProps?.fill)
    }
    const [photo] = photos(out.elements)
    expect(photo.transform.width).toBe(860)
    expect(photo.transform.y).toBeGreaterThanOrEqual(bottomOf(band))
  })

  it.each([
    ['faq.band-head-rows', 'items'],
    ['certification.band-head-rows', 'items'],
  ])('%s — 맨 위 풀폭 짙은 머리 띠(이름표·제목), 줄 글은 띠 밖 아래에 구분선으로', (id, list) => {
    const { slots, out } = drawn(id)
    const [band] = named(out.elements, 'designcut-panel')
    expect(band.transform.width).toBe(860)
    expect(band.transform.y).toBeLessThanOrEqual(Math.min(...out.elements.filter((e) => e !== band).map((e) => e.transform.y)))
    const rules = named(out.elements, 'designcut-rule')
    expect(rules).toHaveLength(countOf(slots, list) - 1)
    for (const rule of rules) expect(rule.transform.y).toBeGreaterThan(bottomOf(band))
  })
})
