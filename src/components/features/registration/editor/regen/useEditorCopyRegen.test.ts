import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '@/lib/registration/editor/stores/editorStore'
import { useCanvasStore } from '@/lib/registration/editor/stores/canvasStore'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { copyRegenTargetOf } from '@/lib/registration/editor/utils/copyRegenTarget'
import { applyCopyCandidate } from './useEditorCopyRegen'

const element = (id: string, content: string, extra: Partial<CanvasElement> = {}): CanvasElement =>
  ({
    id,
    type: 'text',
    name: '헤드라인',
    transform: { x: 0, y: 0, width: 700, height: 60, rotation: 0 },
    zIndex: 1,
    isLocked: false,
    isVisible: true,
    opacity: 1,
    textProps: {
      content,
      richContent: `<span style="color:#e00">${content}</span>`,
      fontFamily: 'Pretendard',
      fontSize: 40,
      fontWeight: 700,
      fontStyle: 'normal',
      textDecoration: 'none',
      color: '#111',
      textAlign: 'center',
      lineHeight: 1.3,
      letterSpacing: 0,
    },
    ...extra,
  }) as CanvasElement

function load(elements: CanvasElement[]) {
  const sections = [{ id: 's1', sectionType: 'hook_3step', groupType: 'hook', order: 0, isVisible: true, layoutId: 'l', elements, canvas: { width: 860, height: 600, backgroundColor: '#fff' } }] as unknown as CanvasSection[]
  useEditorStore.getState().initDocument({ id: 'd1', pdpId: 'job-1', sections } as never)
}

const textOf = (id: string) => useEditorStore.getState().document?.sections[0].elements.find((e) => e.id === id)?.textProps
const lastHistory = () => {
  const { history, historyIndex } = useCanvasStore.getState()
  return history[historyIndex]
}

describe('applyCopyCandidate — 후보 반영·기록·되돌리기', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useEditorStore.getState().clearStyleRemeasure()
    load([element('e1', '이전 카피'), element('lock', '잠김', { isLocked: true })])
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('content만 바꾸고 재측정을 요청한 뒤, 재측정이 끝나면 기록을 한 번 남겨 Ctrl+Z로 이전 카피·강조가 돌아온다', () => {
    const before = useCanvasStore.getState().historyIndex
    const target = copyRegenTargetOf(useEditorStore.getState().document!.sections, 's1', 'e1')!
    expect(applyCopyCandidate(target, '새 카피\n둘째 줄')).toBe(true)
    expect(textOf('e1')).toMatchObject({ content: '새 카피\n둘째 줄', richContent: undefined, fontSize: 40, color: '#111' })
    expect(useEditorStore.getState().styleRemeasure).toMatchObject({ sectionId: 's1', elementId: 'e1' })
    // 재측정 전에는 아직 기록하지 않는다(높이까지 한 스냅샷에 담는다)
    expect(useCanvasStore.getState().historyIndex).toBe(before)

    useEditorStore.getState().clearStyleRemeasure()
    expect(useCanvasStore.getState().historyIndex).toBe(before + 1)
    expect(lastHistory().description).toBe('AI 카피 다시 쓰기')
    expect(useEditorStore.getState().isDirty).toBe(true) // 자동 저장(PUT editor) 대상

    const undone = useCanvasStore.getState().undo()
    const restored = undone?.[0].elements.find((e) => e.id === 'e1')?.textProps
    expect(restored).toMatchObject({ content: '이전 카피', richContent: '<span style="color:#e00">이전 카피</span>' })

    // 기록은 한 번뿐 — 시간이 지나도 더 쌓이지 않는다
    vi.advanceTimersByTime(5000)
    expect(useCanvasStore.getState().history).toHaveLength(before + 2)
  })

  it('재측정이 끝나지 않아도(요소가 안 그려진 보기) 3초 뒤 기록을 남긴다', () => {
    const before = useCanvasStore.getState().historyIndex
    const target = copyRegenTargetOf(useEditorStore.getState().document!.sections, 's1', 'e1')!
    applyCopyCandidate(target, '새 카피')
    vi.advanceTimersByTime(2999)
    expect(useCanvasStore.getState().historyIndex).toBe(before)
    vi.advanceTimersByTime(1)
    expect(useCanvasStore.getState().historyIndex).toBe(before + 1)
  })

  it('요소가 지워졌거나 그사이 잠겼으면 false이고 아무것도 바꾸지 않는다', () => {
    const target = copyRegenTargetOf(useEditorStore.getState().document!.sections, 's1', 'e1')!
    const before = useCanvasStore.getState().historyIndex
    expect(applyCopyCandidate({ ...target, elementId: 'gone' }, '새')).toBe(false)
    expect(applyCopyCandidate({ ...target, elementId: 'lock' }, '새')).toBe(false)
    expect(textOf('lock')?.content).toBe('잠김')
    expect(useEditorStore.getState().styleRemeasure).toBeNull()
    vi.advanceTimersByTime(5000)
    expect(useCanvasStore.getState().historyIndex).toBe(before)
  })
})
