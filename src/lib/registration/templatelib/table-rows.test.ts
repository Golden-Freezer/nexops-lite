/**
 * K 표 글자 크기·행 높이 맞춤(K10) — 오너 11-02 17:39 '스펙 표는 폰트 사이즈를 줄여서 가능하면 1줄로 만들 필요가 있고 2줄이 되더라도 칸 높이는
 * 가능한 동일하게 보이는게 좋다'. 값은 TABLE 45(줄 간격 1.7, 폰 판독 하한 M1 본문 45), 같은 표의 행은 가장 낮은 행보다 한 줄 높은 행까지
 * 같은 높이로 세우고 글을 행 가운데에 둔다. 행 상자의 최소 높이라 글이 실측으로 줄어도 행 높이가 그대로이고, 편집으로 늘면 함께 늘어난다.
 */
import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { checkMobileReadability, TABLE_NAME_ELEMENT } from '@/lib/registration/editor/utils/mobileReadability'
import { reflowSectionLayout } from '@/lib/registration/editor/utils/reflowSectionLayout'
import { K_TYPE, renderTemplate } from './engine'
import { ctxOf } from './engine.fixture'
import { templateById, templatesOf } from './library'
import { lintTemplate } from './lint'
import { sampleSlots } from './sample'
import type { FlowNode, SlotValues, Template } from './template-types'

const ROWS = [
  { label: '상품명', value: '페어넥스 강아지 밥그릇 고양이 식기 2구' },
  { label: '브랜드', value: '페어넥스' },
  { label: '색상/수량', value: '1개 세이지 그린' },
  { label: '사이즈', value: '34cm x 19.5cm x 12.5cm' },
  { label: '소재', value: '도자기(그릇)' },
  { label: '원산지', value: '중국' },
  { label: '사용연령', value: '만 14세 이상' },
]
const SPECIAL = [
  { label: '입구', value: '조임끈' },
  { label: '투명도', value: '반투명' },
]
/** 값 30자(상한) — 폭 500에서 3줄 */
const LONG = '가나다라마바사아자차카타파하가나다라마바사아자차카타파하가나'
const LINE = K_TYPE.TABLE.size * K_TYPE.TABLE.lineHeight

const cell = (id: string) => templateById(id) as Template
const slotsOf = (t: Template, rows = ROWS, special = SPECIAL) => ({ ...sampleSlots(t, { mode: 'full', factor: 1 }), rows, special }) as unknown as SlotValues
const render = (t: Template, slots: SlotValues) => renderTemplate(t, slots, ctxOf())!
const asSection = (out: ReturnType<typeof render>): CanvasSection =>
  ({
    id: 's',
    sectionType: 'spec_table',
    groupType: 'modules',
    order: 0,
    isVisible: true,
    layoutId: 'designcut_k_spec',
    canvas: { width: 860, height: out.height, backgroundColor: out.background },
    elements: out.elements,
    preserveBottomPad: true,
  }) as unknown as CanvasSection
const bottom = (e: CanvasElement) => e.transform.y + e.transform.height
const byY = (els: CanvasElement[]) => [...els].sort((a, b) => a.transform.y - b.transform.y)
/** 값 글을 감싼 행 상자 — 감싼 값 글 내용과 함께 */
const rowBoxes = (els: CanvasElement[]) => {
  const values = new Map(els.filter((e) => e.name === 'designcut-value').map((e) => [e.id, e.textProps?.content ?? '']))
  return byY(els.filter((e) => e.name === 'designcut-row'))
    .map((box) => ({ box, value: (box.containerOf ?? []).map((id) => values.get(id)).find((v) => v !== undefined) }))
    .filter((r): r is { box: CanvasElement; value: string } => r.value !== undefined)
}
const ruleYs = (els: CanvasElement[]) => byY(els.filter((e) => e.name === 'designcut-rule')).map((r) => r.transform.y)
const pitches = (ys: number[]) => ys.slice(1).map((y, i) => y - ys[i])
const joined = (t: Template) => JSON.stringify(t.flow).includes('"joinRule":true')
const withoutEven = (t: Template): Template => {
  const strip = (nodes: FlowNode[]): FlowNode[] =>
    nodes.map((n) => {
      if (n.kind === 'repeat') return { ...n, even: undefined, nodes: strip(n.nodes) }
      if (n.kind === 'panel') return { ...n, nodes: strip(n.nodes) }
      return n
    })
  return { ...t, flow: strip(t.flow) }
}
function assertNoCross(els: CanvasElement[]) {
  const texts = els.filter((e) => e.type === 'text')
  for (const y of ruleYs(els)) for (const t of texts) expect(t.transform.y < y && bottom(t) > y, `${t.textProps?.content} · 선 ${y}`).toBe(false)
  texts.forEach((a, i) =>
    texts.slice(i + 1).forEach((b) => {
      const x = Math.min(a.transform.x + a.transform.width, b.transform.x + b.transform.width) - Math.max(a.transform.x, b.transform.x)
      const y = Math.min(bottom(a), bottom(b)) - Math.max(a.transform.y, b.transform.y)
      expect(x > 0 && y > 0, `${a.textProps?.content} · ${b.textProps?.content}`).toBe(false)
    })
  )
}

describe('표 값 글자 크기(TABLE)', () => {
  it('표 칸 전부: 값은 45·줄 간격 1.7·본문 단계이고 폰 판독 하한(M1) 위반이 없다', () => {
    expect([K_TYPE.TABLE.size, K_TYPE.TABLE.lineHeight, K_TYPE.TABLE.level, K_TYPE.TABLE.weight]).toEqual([45, 1.7, 'body', 400])
    const cells = templatesOf('spec_table')
    expect(cells.length).toBeGreaterThanOrEqual(23)
    for (const t of cells) {
      const out = render(t, slotsOf(t))
      const values = out.elements.filter((e) => e.name === 'designcut-value')
      expect(values.length, t.id).toBe(ROWS.length + SPECIAL.length)
      expect(values.every((v) => v.textProps?.fontSize === 45 && v.textProps?.lineHeight === 1.7), t.id).toBe(true)
      const m1 = checkMobileReadability({ sections: [asSection(out)] }).violations.filter((v) => v.rule === 'M1')
      expect(m1, t.id).toEqual([])
    }
  })
})

describe('표 행 높이 맞춤(even)', () => {
  it('표 칸 전부: 2줄 행이 섞여도 같은 표의 행 상자 높이가 같다 — rows·special을 잇는 칸은 둘이 함께', () => {
    for (const t of templatesOf('spec_table')) {
      const rows = rowBoxes(render(t, slotsOf(t)).elements)
      expect(rows, t.id).toHaveLength(ROWS.length + SPECIAL.length)
      const special = new Set(SPECIAL.map((s) => s.value))
      const groups = joined(t) ? [rows] : [rows.filter((r) => !special.has(r.value)), rows.filter((r) => special.has(r.value))]
      for (const group of groups) expect(new Set(group.map((r) => r.box.transform.height)).size, t.id).toBe(1)
      // 2줄 값(상품명)이 있는 표라 행 높이는 2줄 값 행 높이다 — 1줄 행이 늘어 같아졌다
      expect(rows[0].box.transform.height, t.id).toBeGreaterThanOrEqual(Math.round(LINE * 2))
    }
  })

  it('가장 낮은 행보다 두 줄 넘게 높은 값 행(3줄)은 제 높이이고, 나머지는 같은 높이다', () => {
    const t = cell('spec_table.line-rows')
    const rows = ROWS.map((row, i) => (i === 2 ? { ...row, value: LONG } : row))
    const boxes = rowBoxes(render(t, slotsOf(t, rows)).elements)
    const long = boxes.find((r) => r.value === LONG)!
    const rest = boxes.filter((r) => r !== long)
    expect(new Set(rest.map((r) => r.box.transform.height)).size).toBe(1)
    expect(long.box.transform.height).toBeGreaterThan(rest[0].box.transform.height + LINE / 2)
  })

  it('한 줄 값만 있는 표는 한 줄 행 높이 그대로다 — 늘리지 않는다', () => {
    const t = cell('spec_table.line-rows')
    const rows = ROWS.map((row) => ({ ...row, value: '중국' }))
    const plain = rowBoxes(render(withoutEven(t), slotsOf(t, rows)).elements).map((r) => r.box.transform.height)
    const even = rowBoxes(render(t, slotsOf(t, rows)).elements).map((r) => r.box.transform.height)
    expect(even).toEqual(plain)
  })

  it('좌우 표 칸: 이름·값이 행 가운데에 있다(1줄·2줄 행 모두)', () => {
    for (const t of templatesOf('spec_table').filter((x) => JSON.stringify(x.flow).includes('"nameTag":true'))) {
      const out = render(t, slotsOf(t))
      const mid = (e: CanvasElement) => e.transform.y + e.transform.height / 2
      for (const { box } of rowBoxes(out.elements)) {
        const kids = out.elements.filter((e) => box.containerOf?.includes(e.id) && e.type === 'text')
        expect(kids.some((k) => k.name === TABLE_NAME_ELEMENT), t.id).toBe(true)
        for (const k of kids) expect(Math.abs(mid(k) - mid(box)), `${t.id} ${k.textProps?.content}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('쌓기 칸: 이름 아래 8에 값을 두고, 이름·값 덩어리를 행 가운데에 둔다', () => {
    for (const id of ['spec_table.center-lines', 'spec_table.card-panel', 'spec_table.dark-band', 'spec_table.tint-band-photo']) {
      const t = cell(id)
      const out = render(t, slotsOf(t))
      for (const { box } of rowBoxes(out.elements)) {
        const [label, value] = byY(out.elements.filter((e) => box.containerOf?.includes(e.id)))
        expect(value.transform.y - bottom(label), id).toBe(8)
        expect(Math.abs(label.transform.y - box.transform.y - (bottom(box) - bottom(value))), id).toBeLessThanOrEqual(1)
      }
    }
  })

  const mid = (e: CanvasElement) => e.transform.y + e.transform.height / 2
  /** 행 상자마다 칸(이름·값 또는 이름+값 덩어리)이 행 가운데에 있다 */
  const assertCentered = (els: CanvasElement[], id: string) => {
    for (const { box } of rowBoxes(els)) {
      const kids = els.filter((e) => box.containerOf?.includes(e.id))
      const side = kids.some((k) => k.name === TABLE_NAME_ELEMENT)
      const blocks = side ? kids.map((k) => [k]) : [kids]
      for (const block of blocks) {
        const top = Math.min(...block.map((k) => k.transform.y))
        const end = Math.max(...block.map(bottom))
        expect(Math.abs((top + end) / 2 - mid(box)), `${id} ${block[0].textProps?.content}`).toBeLessThanOrEqual(1)
      }
    }
  }
  const groupsOf = (t: Template, els: CanvasElement[]) => {
    const rows = rowBoxes(els)
    const special = new Set(SPECIAL.map((s) => s.value))
    return joined(t) ? [rows] : [rows.filter((r) => !special.has(r.value)), rows.filter((r) => special.has(r.value))]
  }

  it('표 칸 전부: 글이 실측으로 줄어도(리플로) 같은 표의 행 높이가 같고, 선 간격이 같고, 칸이 행 가운데이며 겹치지 않는다', () => {
    for (const t of templatesOf('spec_table')) {
      const section = asSection(render(t, slotsOf(t)))
      // 편집기 첫 실측 — 추정보다 10px씩 작게 재진다(K1 리플로 평균과 같은 방향)
      for (const el of section.elements) if (el.type === 'text') el.measuredHeight = el.transform.height - 10
      reflowSectionLayout(section)
      for (const group of groupsOf(t, section.elements)) expect(new Set(group.map((r) => r.box.transform.height)).size, t.id).toBe(1)
      if (joined(t)) expect(new Set(pitches(ruleYs(section.elements))).size, t.id).toBe(1)
      assertCentered(section.elements, t.id)
      assertNoCross(section.elements)
    }
  })

  it('추정 2줄 값이 실측 1줄이면(엔진 추정 차) 리플로 뒤 행이 1줄 높이로 줄고 이름·값이 행 가운데다', () => {
    for (const id of ['spec_table.line-rows', 'spec_table.dark-band']) {
      const t = cell(id)
      const section = asSection(render(t, slotsOf(t)))
      for (const el of section.elements) {
        if (el.type !== 'text') continue
        const one = Math.ceil(el.textProps!.fontSize! * el.textProps!.lineHeight!)
        el.measuredHeight = el.name === 'designcut-value' ? one : el.transform.height
      }
      reflowSectionLayout(section)
      const heights = rowBoxes(section.elements).map((r) => r.box.transform.height)
      expect(new Set(heights).size, id).toBe(1)
      expect(heights[0], id).toBeLessThan(Math.round(LINE * 2))
      assertCentered(section.elements, id)
      assertNoCross(section.elements)
    }
  })

  it('편집으로 1줄 값이 2줄이 되면 행 높이 그대로(이미 2줄 행 높이), 3줄이 되면 그 행만 늘고 아래를 덮지 않는다', () => {
    for (const id of ['spec_table.line-rows', 'spec_table.center-lines', 'spec_table.dark-band']) {
      for (const [more, grows] of [
        [1, false],
        [2, true],
      ] as const) {
        const section = asSection(render(cell(id), slotsOf(cell(id))))
        const rows = rowBoxes(section.elements)
        const value = section.elements.find((e) => rows[1].box.containerOf?.includes(e.id) && e.name === 'designcut-value')!
        const heights = rows.map((r) => r.box.transform.height)
        value.measuredHeight = value.transform.height + Math.floor(LINE) * more
        reflowSectionLayout(section)
        const after = rowBoxes(section.elements).map((r) => r.box.transform.height)
        expect(after[1] > heights[1], `${id} +${more}`).toBe(grows)
        expect(after.filter((_, i) => i !== 1), `${id} +${more}`).toEqual(heights.filter((_, i) => i !== 1))
        assertCentered(section.elements, id)
        assertNoCross(section.elements)
      }
    }
  })

  it('미리 재기는 요소를 남기지 않는다 — 좌우 표는 요소 수가 같고, 쌓기 표는 항목마다 행 상자 하나만 는다', () => {
    const side = cell('spec_table.line-rows')
    expect(render(side, slotsOf(side)).elements).toHaveLength(render(withoutEven(side), slotsOf(side)).elements.length)
    const stack = cell('spec_table.center-lines')
    expect(render(stack, slotsOf(stack)).elements).toHaveLength(render(withoutEven(stack), slotsOf(stack)).elements.length + ROWS.length + SPECIAL.length)
  })

  it('린트: 사진·상자가 낀 항목이나 여러 칸 반복의 even은 위반이다', () => {
    const t = cell('spec_table.line-rows')
    const hits = (x: Template) => lintTemplate(x).filter((v) => v.rule === 'space' && v.detail.includes('even'))
    expect(hits(t)).toHaveLength(0)
    const boxed = t.flow.map((n) => (n.kind === 'repeat' && n.slot === 'rows' ? { ...n, nodes: [{ kind: 'panel', fill: 'N', nodes: n.nodes }] } : n))
    expect(hits({ ...t, flow: boxed } as Template)).toHaveLength(1)
    const twoColumns = t.flow.map((n) => (n.kind === 'repeat' && n.slot === 'rows' ? { ...n, columns: 2 } : n))
    expect(hits({ ...t, flow: twoColumns } as Template)).toHaveLength(1)
  })
})
