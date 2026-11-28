import { afterEach, describe, expect, it } from 'vitest'
import { useEditorStore } from '../stores/editorStore'
import type { CanvasElement, CanvasSection } from '../types/canvas'
import type { ProEditorDocument } from '../types/editor'
import { reflowMeasuredSections, type MeasureText } from './viewerReflow'

const box = (id: string, y: number, height: number, extra: Partial<CanvasElement> = {}) =>
  ({
    id,
    type: 'shape',
    name: id,
    transform: { x: 0, y, width: 400, height, rotation: 0 },
    isVisible: true,
    ...extra,
  }) as CanvasElement

const text = (id: string, y: number, height: number, extra: Partial<CanvasElement> = {}) =>
  box(id, y, height, { type: 'text', textProps: { content: id, fontSize: 30 } as CanvasElement['textProps'], ...extra })

/** 글자(추정 높이 300) + 그 아래 상자, 아래 여백 40 */
const section = (id: string, flagged: boolean, title: Partial<CanvasElement> = {}): CanvasSection =>
  ({
    id,
    needsInitialReflow: flagged,
    canvas: { height: 540 },
    elements: [text('title', 0, 300, title), box('below', 300, 200)],
  }) as unknown as CanvasSection

const measureAll =
  (height: number): MeasureText =>
  () =>
    height
const el = (s: CanvasSection, id: string) => s.elements.find((e) => e.id === id)!

afterEach(() => useEditorStore.getState().clearDocument())

describe('reflowMeasuredSections', () => {
  it('신규 변환 섹션 — 글자 상자를 실측으로 줄이고 아래 요소·섹션 높이를 따라 줄인다', () => {
    const input = [section('a', true)]
    const [after] = reflowMeasuredSections(input, measureAll(120))
    expect(el(after, 'title').transform.height).toBe(120)
    expect(el(after, 'below').transform.y).toBe(120)
    expect(after.canvas.height).toBe(360)
  })

  it('편집기 스토어 reflowSection과 같은 결과를 낸다', () => {
    const [after] = reflowMeasuredSections([section('a', true)], measureAll(120))
    const store = useEditorStore.getState()
    store.initDocument({ sections: [section('a', true)] } as unknown as ProEditorDocument)
    store.setMeasuredHeight('a', 'title', 120)
    useEditorStore.getState().reflowSection('a')
    expect(useEditorStore.getState().document!.sections[0]).toEqual(after)
  })

  it('입력을 바꾸지 않는다 — 다른 화면이 같은 문서를 들고 있어도 안전하다', () => {
    const input = [section('a', true)]
    const snapshot = structuredClone(input)
    reflowMeasuredSections(input, measureAll(120))
    expect(input).toEqual(snapshot)
  })

  it('저장본(플래그 없음)은 실측이 달라도 기하를 건드리지 않는다', () => {
    const input = [section('a', false)]
    let asked = 0
    const out = reflowMeasuredSections(input, () => {
      asked += 1
      return 120
    })
    expect(out).toBe(input)
    expect(asked).toBe(0)
  })

  it('두 번째 측정은 멈춘다 — 같은 실측이면 입력 배열을 그대로 돌려줘 그리기 반복이 없다', () => {
    const once = reflowMeasuredSections([section('a', true)], measureAll(120))
    expect(reflowMeasuredSections(once, measureAll(120))).toBe(once)
    expect(reflowMeasuredSections(once, measureAll(122))).toBe(once) // 문턱 2 이내
  })

  it('최소 높이 20 아래 실측도 다음 측정에서 멈춘다', () => {
    const once = reflowMeasuredSections([section('a', true)], measureAll(12))
    expect(el(once[0], 'title').transform.height).toBe(20)
    expect(reflowMeasuredSections(once, measureAll(12))).toBe(once)
  })

  it('화면에 없거나 0인 실측은 건너뛴다', () => {
    const input = [section('a', true)]
    expect(reflowMeasuredSections(input, () => null)).toBe(input)
    expect(reflowMeasuredSections(input, () => 0)).toBe(input)
  })

  it('자동 높이가 아닌 글자는 재지 않는다', () => {
    const input = [section('a', true, { autoHeight: false })]
    expect(reflowMeasuredSections(input, measureAll(120))).toBe(input)
  })

  it('이미 있는 실측이 문턱 안이어도 상자가 다르면 리플로우한다 — 편집기는 measuredHeight가 있으면 reflowSection을 부른다', () => {
    const input = [section('a', true, { measuredHeight: 120 })]
    const [after] = reflowMeasuredSections(input, measureAll(121))
    expect(el(after, 'title').transform.height).toBe(120)
    expect(after.canvas.height).toBe(360)
  })

  it('다음 측정에서 폰트 스왑으로 높이가 달라지면 그만큼 다시 맞춘다', () => {
    const once = reflowMeasuredSections([section('a', true)], measureAll(120))
    const [again] = reflowMeasuredSections(once, measureAll(180))
    expect(el(again, 'title').transform.height).toBe(180)
    expect(el(again, 'below').transform.y).toBe(180)
    expect(again.canvas.height).toBe(420)
  })

  it('바뀐 섹션만 새 객체다', () => {
    const saved = section('saved', false)
    const fresh = section('fresh', true)
    const out = reflowMeasuredSections([saved, fresh], measureAll(120))
    expect(out[0]).toBe(saved)
    expect(out[1]).not.toBe(fresh)
  })
})
