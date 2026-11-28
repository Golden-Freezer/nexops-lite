/**
 * K7-c 묶음 1 고민·문제 칸(T2-12·T2-13·T2-14·T2-15·T2-16, 통합 11-03 20:1x 승인) — 새 칸 5개가 린트를 지나고, 줄 설명의 모양대로 그려지는지 본다.
 * 말풍선 3 → 해결 한 줄, 고민 장면 2를 잇는 화살표, 줄로 나눈 고민 3 → 전환 줄 → 풀폭 사진, 사진·글 상자 2×2 엇갈림, 흰 카드 줄 → 풀폭 사진. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import type { CanvasElement } from '@/lib/registration/editor/types/canvas'
import { renderTemplate } from './engine'
import { templateById } from './library'
import { lintTemplate } from './lint'
import { sampleContext, sampleSlots } from './sample'
import type { Template } from './template-types'

const NEW_CELLS = ['problem_raise.bubbles-answer', 'problem_raise.photo-arrow', 'problem_raise.question-turn', 'problem_empathy.checker-four', 'solution_guide.card-rows']
const cell = (id: string): Template => {
  const found = templateById(id)
  if (!found) throw new Error(`라이브러리에 없음: ${id}`)
  return found
}
const draw = (id: string) => renderTemplate(cell(id), sampleSlots(cell(id), { mode: 'full' }), sampleContext())!
const named = (els: CanvasElement[], name: string) => els.filter((e) => e.name === name)
const photos = (els: CanvasElement[]) => els.filter((e) => e.type === 'framed-image')

describe('K7-c 묶음 1 — 고민·문제 새 칸', () => {
  it.each(NEW_CELLS)('%s — 린트 위반 0', (id) => {
    expect(lintTemplate(cell(id)).map((v) => `${v.rule}:${v.detail}`)).toEqual([])
  })

  it('말풍선 3 → 해결 한 줄 → 사진: 말풍선 판 3개, 해결 줄은 말풍선 아래·사진 위', () => {
    const out = draw('problem_raise.bubbles-answer')
    const bubbles = named(out.elements, 'designcut-panel')
    expect(bubbles).toHaveLength(3)
    const [photo] = photos(out.elements)
    const lastBubble = bubbles.reduce((a, b) => (a.transform.y > b.transform.y ? a : b))
    const answer = out.elements.find((e) => e.type === 'text' && e.transform.y > lastBubble.transform.y + lastBubble.transform.height && e.transform.y < photo.transform.y)
    expect(answer, '해결 줄').toBeDefined()
  })

  it('고민 장면 2를 화살표 하나가 잇는다 — 사진 사이, 사진 항목에도 그려진다', () => {
    const out = draw('problem_raise.photo-arrow')
    const [first, second] = photos(out.elements)
    const arrows = named(out.elements, 'designcut-arrow')
    expect(arrows).toHaveLength(1)
    expect(arrows[0].transform.y).toBeGreaterThan(first.transform.y + first.transform.height)
    expect(arrows[0].transform.y).toBeLessThan(second.transform.y)
  })

  it('줄로 나눈 고민 3 → 전환 줄 → 풀폭 사진: 구분선 2개, 사진은 860 폭', () => {
    const out = draw('problem_raise.question-turn')
    expect(named(out.elements, 'designcut-rule')).toHaveLength(2)
    const [photo] = photos(out.elements)
    expect(photo.transform.width).toBe(860)
  })

  it('2×2 체크무늬: 윗줄은 사진이 왼쪽, 아랫줄은 사진이 오른쪽(엇갈림)', () => {
    const [top, bottom] = photos(draw('problem_empathy.checker-four').elements)
    expect(top.transform.y).toBeLessThan(bottom.transform.y)
    expect(top.transform.x).toBeLessThan(bottom.transform.x)
  })

  it('흰 카드 줄 → 풀폭 사진: 카드는 항목 수만큼, 사진은 카드 아래 860 폭', () => {
    const t = cell('solution_guide.card-rows')
    const slots = sampleSlots(t, { mode: 'full' })
    const out = renderTemplate(t, slots, sampleContext())!
    const cards = named(out.elements, 'designcut-panel')
    expect(cards).toHaveLength((slots.items as unknown[]).length)
    const [photo] = photos(out.elements)
    expect(photo.transform.width).toBe(860)
    expect(photo.transform.y).toBeGreaterThan(Math.max(...cards.map((c) => c.transform.y + c.transform.height)))
  })
})
