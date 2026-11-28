/**
 * 상자 안 상자 리플로(K8 N-K2) — 글 밀기는 가장 안쪽 상자 안에서만, 맞춤은 안쪽 상자부터 하고 그 이동은 부모 식구 안에서만 한다.
 * 전에는 안쪽 글이 바깥 상자 식구 전체를 밀고, 안쪽 상자 맞춤이 바깥까지 한 번 더 옮겼다(캡슐 바탕·이름표·띠 안 표 행).
 */
import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { reflowSectionLayout } from './reflowSectionLayout'

const box = (id: string, y: number, height: number, containerOf: string[]): CanvasElement =>
  ({ id, type: 'shape', name: id, transform: { x: 0, y, width: 860, height, rotation: 0 }, containerOf }) as unknown as CanvasElement
const text = (id: string, x: number, y: number, height: number, measured: number): CanvasElement =>
  ({ id, type: 'text', name: id, transform: { x, y, width: 300, height, rotation: 0 }, measuredHeight: measured }) as unknown as CanvasElement
const section = (elements: CanvasElement[]): CanvasSection =>
  ({ id: 's', canvas: { width: 860, height: 1000 }, elements, preserveBottomPad: true }) as unknown as CanvasSection
const at = (s: CanvasSection, id: string) => s.elements.find((e) => e.id === id)!.transform

describe('상자 안 상자 리플로', () => {
  it('띠 안 좌우 표 행: 이름이 줄어도 다음 행을 끌어올리지 않고, 값이 늘면 다음 행·띠·띠 아래를 한 번씩 옮긴다', () => {
    // 띠(0~400) 안 행1(이름 100 → 실측 50, 값 100 → 실측 140) · 선 · 행2, 띠 아래 꼬리
    const s = section([
      box('panel', 0, 400, ['row1', 'name1', 'value1', 'rule', 'row2', 'name2', 'value2']),
      box('row1', 100, 100, ['name1', 'value1']),
      text('name1', 0, 100, 100, 50),
      text('value1', 400, 100, 100, 140),
      box('rule', 220, 2, []),
      box('row2', 240, 100, ['name2', 'value2']),
      text('name2', 0, 240, 100, 100),
      text('value2', 400, 240, 100, 100),
      box('tail', 440, 10, []),
    ])
    reflowSectionLayout(s)
    expect(at(s, 'row1').height).toBe(140)
    expect(at(s, 'rule').y).toBe(260)
    expect(at(s, 'row2').y).toBe(280)
    expect(at(s, 'name2').y).toBe(280)
    expect(at(s, 'value2').y).toBe(280)
    expect(at(s, 'panel').height).toBe(440)
    expect(at(s, 'tail').y).toBe(480)
  })

  it('캡슐 바탕 안 글이 늘면 띠 식구·띠 아래를 한 번만 옮긴다(전에는 두 번)', () => {
    const s = section([
      box('panel', 0, 300, ['capBg', 'cap', 'body']),
      box('capBg', 40, 60, ['cap']),
      text('cap', 60, 50, 40, 50),
      text('body', 0, 140, 100, 100),
      box('tail', 340, 10, []),
    ])
    reflowSectionLayout(s)
    expect(at(s, 'capBg').height).toBe(70)
    expect(at(s, 'body').y).toBe(150)
    expect(at(s, 'panel').height).toBe(310)
    expect(at(s, 'tail').y).toBe(350)
  })

  it('상자 안 상자가 없으면 전과 같다 — 상자 안 글은 형제를, 상자 바닥 변화는 아래를 한 번 옮긴다', () => {
    const s = section([
      box('card', 0, 300, ['title', 'body']),
      text('title', 0, 40, 60, 90),
      text('body', 0, 120, 100, 100),
      box('tail', 340, 10, []),
    ])
    reflowSectionLayout(s)
    expect(at(s, 'body').y).toBe(150)
    expect(at(s, 'card').height).toBe(330)
    expect(at(s, 'tail').y).toBe(370)
  })
})

describe('표 행 묶음(K10 rowGroup) — 실측으로 행 높이·가운데를 다시 맞춘다', () => {
  // 좌우 표 두 행(줄 높이 80): 행1 값은 2줄로 추정(160), 행2 값은 1줄(80). 엔진이 둘 다 160 높이로 세우고 칸마다 가운데에 두었다
  const line = { fontSize: 40, lineHeight: 2 }
  const cellText = (id: string, x: number, y: number, height: number, measured: number) =>
    ({ ...text(id, x, y, height, measured), textProps: { content: id, ...line } }) as unknown as CanvasElement
  const table = (value1: number, grouped = true) =>
    section([
      { ...box('row1', 0, 160, ['name1', 'value1']), ...(grouped ? { rowGroup: 'g' } : {}) } as CanvasElement,
      cellText('name1', 0, 60, 40, 40),
      cellText('value1', 300, 0, 160, value1),
      box('rule', 180, 2, []),
      { ...box('row2', 202, 160, ['name2', 'value2']), ...(grouped ? { rowGroup: 'g' } : {}) } as CanvasElement,
      cellText('name2', 0, 262, 40, 40),
      cellText('value2', 300, 242, 80, 80),
      box('tail', 400, 10, []),
    ])

  it('추정 2줄 값이 실측 1줄이면 묶음 행이 모두 1줄 높이로 줄고, 이름·값이 행 가운데에 다시 선다', () => {
    const s = table(80)
    reflowSectionLayout(s)
    expect([at(s, 'row1').height, at(s, 'row2').height]).toEqual([80, 80])
    expect([at(s, 'name1').y, at(s, 'value1').y]).toEqual([20, 0])
    expect(at(s, 'rule').y).toBe(100)
    expect([at(s, 'row2').y, at(s, 'name2').y, at(s, 'value2').y]).toEqual([122, 142, 122])
    expect(at(s, 'tail').y).toBe(240)
  })

  it('가장 낮은 행보다 한 줄 넘게 긴 행(3줄)은 제 높이이고 나머지는 묶음 높이다 — 이름은 긴 행 가운데', () => {
    const s = table(240)
    reflowSectionLayout(s)
    expect([at(s, 'row1').height, at(s, 'row2').height]).toEqual([240, 80])
    expect(at(s, 'name1').y).toBe(100)
    expect(at(s, 'rule').y).toBe(260)
  })

  it('여러 번 돌려도 같다(멱등)', () => {
    const s = table(80)
    reflowSectionLayout(s)
    const once = s.elements.map((e) => ({ ...e.transform }))
    reflowSectionLayout(s)
    expect(s.elements.map((e) => ({ ...e.transform }))).toEqual(once)
  })

  it('묶음이 없으면 전과 같다 — 칸을 다시 가운데에 두지 않아 이름(60~100)이 행 높이를 잡는다', () => {
    const s = table(80, false)
    reflowSectionLayout(s)
    expect(at(s, 'row1').height).toBe(100)
    expect([at(s, 'name1').y, at(s, 'value1').y]).toEqual([60, 0])
  })
})

describe('상자 밖으로 내민 장식(overhang, K1 T1-33 띠 곡선 덮개)', () => {
  // 띠(0~400) 안 글(120~220 → 실측 160) · 띠 아래쪽 덮개(336~404, 띠 밖 4 내밂) · 띠 아래 사진(464~)
  const build = (overhang: boolean) => {
    const cover = { ...box('cover', 336, 68, []), overhang } as CanvasElement
    return section([box('panel', 0, 400, ['body', 'cover']), text('body', 60, 120, 100, 160), cover, box('photo', 464, 300, [])])
  }

  it('띠 높이 맞춤에서 빼 내민 만큼 띠가 커지지 않고, 글이 늘면 다른 식구처럼 함께 민다', () => {
    const s = build(true)
    reflowSectionLayout(s)
    expect(at(s, 'panel').height).toBe(460)
    expect(at(s, 'cover').y).toBe(396)
    expect(at(s, 'cover').y + at(s, 'cover').height).toBe(at(s, 'panel').height + 4)
    expect(at(s, 'photo').y).toBe(524)
    reflowSectionLayout(s)
    expect(at(s, 'panel').height).toBe(460)
  })

  it('표시가 없으면 전과 같다 — 밖으로 나온 식구까지 띠가 늘어난다', () => {
    const s = build(false)
    reflowSectionLayout(s)
    expect(at(s, 'panel').height).toBe(464)
  })
})
