/**
 * 후기 사진 카드 쌓기(T1-14, A2 4-5 '좁은 칸 24자 이하 또는 사진 위·글 아래로 쌓기') — quote가 380 폭(BODY 52, 한 줄 7자)에
 * 33자·6줄로 끼던 칸을 사진 위·글 아래로 쌓아 글을 칸 폭으로 넓혔다. 통합 승인 조건 ①~④를 고정한다.
 */

import { describe, expect, it } from 'vitest'
import { measureCutText } from '@/lib/registration/editor/utils/sectionConverter/designCut/build'
import { renderTemplate } from './engine'
import { templateById } from './library'
import { fillerText, sampleContext, sampleSlots } from './sample'
import type { FlowNode, ImageSlot, ListSlot, TextSlot } from './template-types'

/** 기준 값은 시험에 고정한다 — 코드 상수를 가져오면 변이를 못 잡는다 */
const CONTENT_W = 740
const BODY = { size: 52, lineHeight: 1.7 }
const PHOTO_W = 440
/** 칸 폭 740 ÷ 52 = 한 줄 14자 → 린트 표본 낱말 4자(lint.ts wordLenFor) */
const WORD_LEN = 4

const t = templateById('review.photo-cards')!
const items = t.slots.items as ListSlot
const photo = items.fields.photo as ImageSlot
const quote = items.fields.quote as TextSlot
const repeat = t.flow.find((node) => node.kind === 'repeat' && node.slot === 'items') as Extract<FlowNode, { kind: 'repeat' }>
const linesOf = (text: string, width: number) => Math.round((measureCutText(text, BODY.size, BODY.lineHeight, width) - 10) / (BODY.size * BODY.lineHeight))

describe('후기 사진 카드 쌓기(T1-14)', () => {
  it('항목은 사진 → 후기 글 → 이름 쌓기이고 가로 칸이 없다', () => {
    expect(repeat.nodes.map((node) => (node.kind === 'image' || node.kind === 'text' ? `${node.kind}:${node.slot}` : node.kind))).toEqual(['image:photo', 'text:quote', 'text:name'])
    expect(repeat.nodes.some((node) => node.kind === 'text' && 'w' in node)).toBe(false)
  })

  it('① 사진은 3:4 그대로 어긋난 폭 440 — 최소 높이 500이 비율을 늘리지 않고 컷 계획은 그대로다', () => {
    const image = repeat.nodes[0] as Extract<FlowNode, { kind: 'image' }>
    expect(image.w).toBe(PHOTO_W)
    expect(image.x).toBeUndefined()
    expect(photo).toMatchObject({ purpose: ['scene'], composition: ['in_use', 'in_hand'], aspect: ['3:4'], minHeight: 500 })
    expect(Math.round(PHOTO_W / (3 / 4))).toBeGreaterThanOrEqual(photo.minHeight)
  })

  it('④ quote는 칸 폭에서 잰 3줄 — 33자가 3줄을 채우고 넘지 않는다', () => {
    expect(quote.maxChars).toBe(33)
    expect(quote.maxLines).toBe(3)
    expect(linesOf(fillerText(quote.maxChars, WORD_LEN), CONTENT_W)).toBe(quote.maxLines)
    // 옛 좁은 칸(380, 한 줄 7자 → 표본 낱말 3자)에서는 같은 글이 6줄이었다
    expect(linesOf(fillerText(quote.maxChars, 3), 380)).toBe(6)
  })

  it('② 쌓으면 860 기준 섹션이 2,000을 넘어 항목 상한은 2다(필수 2 그대로)', () => {
    expect(t.estimatedHeight.min).toBeGreaterThan(2000)
    expect(items.min).toBe(2)
    expect(items.max).toBe(2)
    expect(t.needs.photos).toBe(2)
  })

  it('최대 글로 그리면 사진 440×587 아래 글이 칸 폭 3줄로 놓인다', () => {
    const out = renderTemplate(t, sampleSlots(t, { mode: 'full' }), sampleContext())!
    const shots = out.elements.filter((el) => el.name === 'designcut-scene')
    const quotes = out.elements.filter((el) => el.name === 'designcut-quote')
    expect(shots).toHaveLength(2)
    expect(quotes).toHaveLength(2)
    shots.forEach((shot, i) => {
      expect({ w: shot.transform.width, h: shot.transform.height }).toEqual({ w: PHOTO_W, h: 587 })
      const text = quotes[i]
      expect(text.transform.y).toBeGreaterThan(shot.transform.y + shot.transform.height)
      expect(text.transform.width).toBe(CONTENT_W)
      expect(Math.round((text.transform.height - 10) / (BODY.size * BODY.lineHeight))).toBe(3)
    })
  })
})
