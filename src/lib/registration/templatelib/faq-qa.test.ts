/**
 * FAQ Q·A 표식 줄(적용 T2-64·T1-66 K, 연구 A5 6.10) — 줄로 나눈 FAQ 두 개(rule-rows·inset-rule)는 질문 앞에 채운 Q 캡슐,
 * 답 앞에 테두리 A 캡슐을 같은 줄에 둔다. 글 칸이 716→628로 좁아져 질문 19자·답 27자로 줄였다(줄 상한 2·3 그대로라 높이 불변).
 */

import { describe, expect, it } from 'vitest'
import type { CanvasElement } from '@/lib/registration/editor/types/canvas'
import { renderTemplate } from './engine'
import { TEMPLATES } from './library'
import { sampleContext, sampleSlots } from './sample'
import { copySlotsOf } from './slot-copy'
import type { FlowNode, RowNode, Template } from './template-types'

// band-head-rows(K7-c 묶음 2 T1-29)는 짙은 머리 띠 이름표 아래에 같은 Q·A 표식 줄을 둔다
const QA = ['faq.rule-rows', 'faq.inset-rule', 'faq.band-head-rows']
const byId = (id: string) => TEMPLATES.find((t) => t.id === id)!
const itemsOf = (t: Template) => (t.flow as readonly FlowNode[]).find((n) => n.kind === 'repeat' && n.slot === 'items')
const contentOf = (e: CanvasElement) => (e.textProps as { content?: string } | undefined)?.content
const top = (e: CanvasElement) => e.transform.y

describe('FAQ Q·A 표식 줄', () => {
  it.each(QA)('%s — 항목은 Q 줄(채운 캡슐·질문)과 A 줄(테두리 캡슐·답)이고 칸 폭은 88·628이다', (id) => {
    const repeat = itemsOf(byId(id))
    expect(repeat?.kind).toBe('repeat')
    if (repeat?.kind !== 'repeat') return
    expect(repeat.rule).toBe(true)
    const rows = repeat.nodes as RowNode[]
    expect(rows.map((r) => r.kind)).toEqual(['row', 'row'])
    const [q, a] = rows
    expect(q.columns.map((c) => c.w)).toEqual([88, 628])
    expect(a.columns.map((c) => c.w)).toEqual([88, 628])
    expect(q.columns[0].nodes).toEqual([{ kind: 'capsule', label: 'Q' }])
    expect(a.columns[0].nodes).toEqual([{ kind: 'capsule', label: 'A', outline: true }])
    expect(q.columns[1].nodes).toEqual([{ kind: 'text', slot: 'question', token: 'BODY_BOLD' }])
    expect(a.columns[1].nodes).toEqual([{ kind: 'text', slot: 'answer', token: 'BODY' }])
  })

  it('표식 줄은 이 세 FAQ에만 있다 — 가운데 정렬·풀폭 사진 줄 FAQ는 지금 모양을 둔다', () => {
    const withQa = TEMPLATES.filter((t) => t.section === 'faq' && itemsOf(t)?.kind === 'repeat' && (itemsOf(t) as { nodes: FlowNode[] }).nodes.some((n) => n.kind === 'row'))
    expect(withQa.map((t) => t.id).sort()).toEqual([...QA].sort())
  })

  it.each(QA)('%s — 카피 칸은 628 폭으로 질문 19자 2줄·답 27자 3줄을 받는다', (id) => {
    const items = copySlotsOf(byId(id)).find((s) => s.name === 'items')!
    const fields = Object.fromEntries(items.list!.fields.map((f) => [f.name, f]))
    expect(fields.question).toMatchObject({ maxChars: 19, maxLines: 2, lineToken: 'BODY_BOLD', lineWidth: 628 })
    expect(fields.answer).toMatchObject({ maxChars: 27, maxLines: 3, lineToken: 'BODY', lineWidth: 628 })
  })

  it.each(QA)('%s — 표본 렌더에서 항목마다 Q·A 캡슐이 글 왼쪽, 같은 줄 위에 선다', (id) => {
    const t = byId(id)
    const slots = sampleSlots(t, { mode: 'full' })
    const out = renderTemplate(t, slots, sampleContext())!
    const count = (slots.items as unknown[]).length
    const labels = out.elements.filter((e) => e.name === 'designcut-capsule-text').map(contentOf)
    expect(labels.filter((l) => l === 'Q')).toHaveLength(count)
    expect(labels.filter((l) => l === 'A')).toHaveLength(count)
    const capsules = out.elements.filter((e) => e.name === 'designcut-capsule-bg')
    const questions = out.elements.filter((e) => e.name === 'designcut-question')
    const answers = out.elements.filter((e) => e.name === 'designcut-answer')
    expect(questions).toHaveLength(count)
    expect(answers).toHaveLength(count)
    // 첫 캡슐은 섹션 머리 FAQ, 그 뒤가 Q·A 쌍이다
    const marks = capsules.slice(1)
    expect(marks).toHaveLength(count * 2)
    for (let i = 0; i < count; i++) {
      const [q, a] = [marks[i * 2], marks[i * 2 + 1]]
      expect(top(q)).toBe(top(questions[i]))
      expect(top(a)).toBe(top(answers[i]))
      expect(q.transform.x + q.transform.width).toBeLessThanOrEqual(questions[i].transform.x)
      expect(a.transform.x + a.transform.width).toBeLessThanOrEqual(answers[i].transform.x)
      // Q는 채운 캡슐, A는 테두리 캡슐
      expect(q.shapeProps?.stroke).toBeUndefined()
      expect(a.shapeProps?.stroke).toBeTruthy()
    }
  })
})
