/**
 * 제목 아래 낱말 칩 줄(적용 K1 R-W10) — 알약 모양, 모델 글 이름표 목록, 값이 있을 때만 그린다. 오너 11-02 '넣는다'. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { renderTemplate } from './engine'
import { ctxOf, templateOf } from './engine.fixture'
import { TEMPLATES, templateById } from './library'
import { sampleContext, sampleSlots } from './sample'
import { copySlotsOf } from './slot-copy'
import { TAG_MAX_CHARS } from './slots'
import type { Template } from './template-types'

const CHIP_TEMPLATES = ['sub_div.title-chips', 'concept_desc.title-chips']
const chipsOf = <T extends { name: string }>(out: { elements: T[] }) => out.elements.filter((e) => e.name.startsWith('annotation-chip-'))
const radiusOf = (out: { elements: Array<{ name: string; shapeProps?: { borderRadius?: number } }> }) => chipsOf(out).map((e) => e.shapeProps?.borderRadius)

describe('낱말 칩 줄(R-W10)', () => {
  const square = { radius: { capsule: 4, card: 4, bubble: 4, chip: 4 } }
  const tagsTemplate = (pill: boolean) =>
    templateOf({
      flow: [{ kind: 'tags', slot: 'chips', ...(pill ? { pill: true } : {}) }],
      slots: { chips: { type: 'list', required: false, min: 2, max: 3, fields: {} } },
    })

  it('pill이면 컨셉 모서리가 각져도 알약이다 — 없으면 컨셉 모서리를 따른다', () => {
    const pill = renderTemplate(tagsTemplate(true), { chips: ['가벼움', '접이식'] }, ctxOf(square))!
    const plain = renderTemplate(tagsTemplate(false), { chips: ['가벼움', '접이식'] }, ctxOf(square))!
    const height = chipsOf(pill)[0] as unknown as { transform: { height: number } }
    expect(radiusOf(pill)).toEqual([height.transform.height / 2, height.transform.height / 2])
    expect(radiusOf(plain)).toEqual([4, 4])
  })

  it('공용 템플릿 두 개가 제목 바로 아래에 알약 칩 줄을 둔다 — 모델 글 이름표 2~3개, 필수가 아니다', () => {
    for (const id of CHIP_TEMPLATES) {
      const t = templateById(id) as Template
      expect(t, id).toBeTruthy()
      expect(t.fit.categories, id).toBeUndefined()
      expect(t.flow[0], id).toMatchObject({ kind: 'text', emphasis: true })
      expect(t.flow[1], id).toEqual(expect.objectContaining({ kind: 'tags', slot: 'tags', pill: true }))
      expect(t.slots.tags, id).toEqual({ type: 'list', required: false, min: 2, max: 3, fields: {} })
      const copy = copySlotsOf(t as never).find((slot) => slot.name === 'tags')
      expect(copy, id).toEqual({ name: 'tags', required: false, facts: 0, maxChars: TAG_MAX_CHARS, tags: { min: 2, max: 3 } })
    }
  })

  it('칩 값이 있을 때만 칩 줄을 그리고, 없어도 템플릿은 그려진다', () => {
    for (const id of CHIP_TEMPLATES) {
      const t = templateById(id) as Template
      const values = sampleSlots(t, { mode: 'required' })
      const without = renderTemplate(t, { ...values, tags: [] }, sampleContext())
      const withChips = renderTemplate(t, { ...values, tags: ['가벼움', '접이식', '세척 쉬움'] }, sampleContext())
      expect(without, id).not.toBeNull()
      expect(chipsOf(without!), id).toHaveLength(0)
      expect(chipsOf(withChips!), id).toHaveLength(3)
      // 칩 줄이 들어가면 그만큼 아래로 밀린다
      const bottom = (out: { elements: Array<{ transform: { y: number; height: number } }> }) => Math.max(...out.elements.map((e) => e.transform.y + e.transform.height))
      expect(bottom(withChips!), id).toBeGreaterThan(bottom(without!))
    }
  })

  it('첫 화면(hook_3step)에는 칩 줄을 두지 않는다 — 첫 화면은 1~3초에 읽히는 글만이다', () => {
    const hooks = (TEMPLATES as unknown as Template[]).filter((t) => t.section === 'hook_3step')
    expect(hooks.length).toBeGreaterThan(0)
    for (const t of hooks) expect(JSON.stringify(t.flow), t.id).not.toContain('"kind":"tags"')
  })
})
