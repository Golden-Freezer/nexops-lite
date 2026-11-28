/**
 * K POINT 본문·둘째 사진(K4 ①, 통합 11-05 11:39) — 본문 칸(sub)은 사실 칸을 쓰지 않아 사실 예산에 지워지지 않고, 사진이 한 장인 POINT는
 * 선택 둘째 사진(detail)을 끝에 둔다. 새 사실은 없고 쪽당 컷은 POINT 수(상한 3)만큼만 는다.
 */

import { describe, expect, it } from 'vitest'
import { buildSlotCopyPrompt } from '@/lib/agents/registration/prompts/pdp-template-copy-prompts'
import { renderTemplate } from './engine'
import { TEMPLATES, templateById } from './library'
import { sampleContext, sampleSlots } from './sample'
import { slotCopySections } from './section-values'
import { copyFactRange } from './selection-facts'
import { assignShots, imageSlots, POINT_MAX, shotCountOf, type OrderedSection } from './selection-order'
import { copySlotsOf, fitToFactSlots } from './slot-copy'
import type { ImageSlot, Template } from './template-types'
import type { TemplateMeta } from './template-meta'

const POINTS = (TEMPLATES as unknown as Template[]).filter((t) => t.section === 'point_div')
// packaging-head-pair-note의 detail은 원래 있던 필수 두 장 칸이다 — 더한 것은 선택 칸만
const WITH_DETAIL = POINTS.filter((t) => t.slots.detail?.type === 'image' && !t.slots.detail.required)
const mainOf = (t: Template) => Object.entries(t.slots).find(([name, def]) => def.type === 'image' && name !== 'detail')?.[1] as ImageSlot | undefined

describe('POINT 본문 칸', () => {
  it('POINT 29개 모두 본문 칸은 선택·카피·사실 0이다 — 고르기의 최소 사실 수는 본문 사실 수와 상관없다', () => {
    expect(POINTS).toHaveLength(29)
    for (const t of POINTS) {
      expect(t.slots.sub, t.id).toMatchObject({ type: 'text', required: false, source: 'copy', facts: 0 })
      const before = { slots: { ...t.slots, sub: { ...t.slots.sub, facts: 1 } } } as unknown as TemplateMeta
      expect(copyFactRange(t as unknown as TemplateMeta).min, t.id).toBe(copyFactRange(before).min)
      expect(copyFactRange(t as unknown as TemplateMeta).max, t.id).toBe(copyFactRange(before).max - 1)
    }
  })

  it('사실 칸이 1개인 POINT도 본문을 지우지 않는다 — 제목이 그 사실을 쓴다', () => {
    const slots = copySlotsOf(templateById('point_div.scene-band') as Template)
    expect(fitToFactSlots(slots, { headline: '제목', sub: '본문', step: '소구' }, 1)).toEqual({ headline: '제목', sub: '본문', step: '소구' })
  })

  it('본문 규칙 줄은 POINT 본문 칸이 있는 콜에만 붙는다', () => {
    const rowOf = (id: string): OrderedSection => ({ section: templateById(id)!.section, templateId: id, bg: 'W', shots: [], factSlots: 1 })
    const brief = { category: '생활', persona: null, summary: '', keywords: [], usps: [], pains: [] }
    const prompt = (ids: string[]) => buildSlotCopyPrompt({ product: brief, guideline: { persona: '', tone: '' }, facts: ['가벼워요'], sections: slotCopySections(ids.map(rowOf)) })
    const rule = '제목이 말한 사실을 고객이 겪는 장면이나 체감으로 풀어 쓰는 두 줄 본문이다. 새 사실·수치·소재·기능을 더하지 않고'
    expect(prompt(['hook_3step.center-bleed', 'point_div.scene-band'])).toContain(rule)
    expect(prompt(['point_div.scene-band'])).toContain('sub(선택, 36자, 3줄')
    expect(prompt(['hook_3step.center-bleed', 'sub_div.title-chips'])).not.toContain(rule)
  })
})

describe('POINT 둘째 사진', () => {
  it('사진이 한 장인 POINT 15개만 선택 둘째 사진을 흐름 끝에 둔다 — 두 장 이상·사진 목록·풀폭 큰 사진 POINT는 그대로다', () => {
    expect(WITH_DETAIL).toHaveLength(15)
    const bleeds = (t: Template) => t.flow.some((node) => node.kind === 'image' && node.bleed === true)
    for (const t of POINTS) {
      const photos = imageSlots(t as unknown as TemplateMeta)
      if (!WITH_DETAIL.includes(t)) {
        expect(photos.length >= 2 || bleeds(t), t.id).toBe(true)
        continue
      }
      expect(bleeds(t), t.id).toBe(false)
      expect(photos.map((p) => p.slot), t.id).toHaveLength(2)
      expect(t.slots.detail, t.id).toMatchObject({ type: 'image', required: false, aspect: ['4:3', '1:1'] })
      expect(t.flow.at(-1), t.id).toEqual({ kind: 'image', slot: 'detail' })
    }
  })

  it('둘째 사진은 큰 사진과 다른 구도다 — 큰 사진이 근접이면 쓰는 모습, 아니면 근접', () => {
    for (const t of WITH_DETAIL) {
      const main = mainOf(t)!
      const detail = t.slots.detail as ImageSlot
      expect(detail.composition.filter((c) => main.composition.includes(c)), t.id).toEqual([])
      expect(detail.composition, t.id).toHaveLength(2)
      expect(detail.composition.includes('closeup'), t.id).toBe(!main.composition.includes('closeup'))
      expect(detail.purpose, t.id).toEqual(main.composition.includes('closeup') ? ['action', 'feature_proof'] : ['texture', 'feature_proof'])
    }
  })

  it('둘째 사진이 없어도 그 POINT는 그려지고, 있으면 그만큼 길다', () => {
    for (const t of WITH_DETAIL) {
      const slots = sampleSlots(t, { mode: 'full' })
      const withDetail = renderTemplate(t, slots, sampleContext())
      const without = renderTemplate(t, slots, sampleContext({ image: (key) => (key && key !== slots.detail ? `https://sample.invalid/${key}.png` : null) }))
      expect(withDetail, t.id).not.toBeNull()
      expect(without, t.id).not.toBeNull()
      expect(withDetail!.height, t.id).toBeGreaterThan(without!.height)
    }
  })

  it('쪽당 컷은 POINT 수만큼(+3 이내) 는다 — POINT 하나에 한 장씩', () => {
    const before = (t: Template) => shotCountOf(t as unknown as TemplateMeta) - (WITH_DETAIL.includes(t) ? 1 : 0)
    for (const t of POINTS) expect(shotCountOf(t as unknown as TemplateMeta) - before(t), t.id).toBeLessThanOrEqual(1)
    expect(POINT_MAX).toBe(3)
    const shots = assignShots(WITH_DETAIL.slice(0, 3) as unknown as TemplateMeta[])
    expect(shots.map((row) => row.map((shot) => shot.slot))).toEqual([['photo', 'detail'], ['photo', 'detail'], ['photo', 'detail']])
  })
})
