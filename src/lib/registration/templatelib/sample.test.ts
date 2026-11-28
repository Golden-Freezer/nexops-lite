import { describe, expect, it } from 'vitest'
import { renderTemplate } from './engine'
import { ctxOf, imageSlot, templateOf, textSlot } from './engine.fixture'
import { fillerText, heightRange, sampleSlots } from './sample'
import { TAG_MAX_CHARS } from './slots'

const noSpace = (s: string) => s.replace(/\s/g, '')

const t = templateOf({
  flow: [
    { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'titleGap' },
    { kind: 'text', slot: 'sub', token: 'BODY', gapAfter: 'photoGap' },
    { kind: 'image', slot: 'photo', w: 740, gapAfter: 'blockGap' },
    { kind: 'rating', slot: 'score', gapAfter: 'rowGap' },
    { kind: 'tags', slot: 'names', gapAfter: 'rowGap' },
    {
      kind: 'repeat',
      slot: 'items',
      nodes: [
        { kind: 'mark', slot: 'ours' },
        { kind: 'text', slot: 'title', token: 'H3' },
      ],
    },
  ],
  slots: {
    headline: textSlot({ required: true, maxChars: 20 }),
    sub: textSlot({ maxChars: 30 }),
    photo: imageSlot({ required: true }),
    score: textSlot({ source: 'input', input: 'review.rating', maxChars: 3 }),
    names: { type: 'list', required: false, min: 1, max: 4, fields: {} },
    items: {
      type: 'list',
      required: true,
      min: 2,
      max: 4,
      fields: { title: textSlot({ required: true, maxChars: 12 }), ours: textSlot({ facts: 0, maxChars: 5 }) },
    },
  },
})

describe('fillerText', () => {
  it('공백을 뺀 글자 수가 정확하다', () => {
    expect(noSpace(fillerText(23))).toHaveLength(23)
    expect(noSpace(fillerText(24))).toHaveLength(24)
  })

  it('낱말처럼 띄어 쓴다 — 한 낱말이 줄 전체를 차지하지 않게', () => {
    expect(Math.max(...fillerText(40).split(' ').map((w) => w.length))).toBeLessThanOrEqual(4)
  })
})

describe('sampleSlots', () => {
  it('required는 필수 슬롯만, 목록은 min개다', () => {
    const slots = sampleSlots(t, { mode: 'required' })
    expect(Object.keys(slots).sort()).toEqual(['headline', 'items', 'photo'])
    expect(slots.items).toHaveLength(2)
    expect(Object.keys((slots.items as object[])[0])).toEqual(['title'])
  })

  it('full은 모든 슬롯, 목록은 max개다', () => {
    const slots = sampleSlots(t, { mode: 'full' })
    expect(Object.keys(slots).sort()).toEqual(['headline', 'items', 'names', 'photo', 'score', 'sub'])
    expect(slots.items).toHaveLength(4)
    expect(slots.names).toHaveLength(4)
  })

  it('글자 수 상한 × factor로 채운다', () => {
    const slots = sampleSlots(t, { mode: 'full', factor: 1.2 })
    expect(noSpace(slots.headline as string)).toHaveLength(24)
    expect(noSpace((slots.names as string[])[0])).toHaveLength(Math.round(TAG_MAX_CHARS * 1.2))
  })

  it('별점·표시 슬롯은 쓰는 노드에 맞는 값이다', () => {
    const slots = sampleSlots(t, { mode: 'full' })
    expect(slots.score).toBe('4.8')
    expect((slots.items as Array<{ ours: string }>)[0].ours).toBe('check')
  })

  it('표본으로 실제로 그려진다', () => {
    expect(renderTemplate(t, sampleSlots(t, { mode: 'full' }), ctxOf())).not.toBeNull()
    expect(renderTemplate(t, sampleSlots(t, { mode: 'required' }), ctxOf())).not.toBeNull()
  })
})

describe('heightRange', () => {
  it('필수만 짧게 < 전부 상한까지, 10 단위다', () => {
    const { min, max, typical } = heightRange(t)
    expect(min).toBeGreaterThan(0)
    expect(max).toBeGreaterThan(min)
    expect(min % 10).toBe(0)
    expect(max % 10).toBe(0)
    expect(typical).toBeGreaterThan(min)
    expect(typical).toBeLessThan(max)
  })

  it('그리지 못하는 템플릿은 0이다', () => {
    const broken = templateOf({ flow: [{ kind: 'text', slot: 'x', token: 'H1' }], slots: { y: imageSlot({ required: true }) } })
    // 필수 사진은 표본으로 채워지지만 흐름에 그릴 노드가 없다
    expect(heightRange(broken)).toEqual({ min: 0, max: 0, typical: 0 })
  })
})
