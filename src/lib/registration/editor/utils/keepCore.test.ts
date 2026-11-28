import { describe, expect, it } from 'vitest'
import { useCanvasStore } from '@/lib/registration/editor/stores/canvasStore'
import { useEditorStore } from '@/lib/registration/editor/stores/editorStore'
import type { CanvasSection, ExpansionKind } from '@/lib/registration/editor/types/canvas'
import { ProSectionType as S } from '@/lib/registration/editor/types/section'
import { expansionState, withExpansionsVisible, withoutExpansions } from './keepCore'

// 긴 상세페이지 '핵심만 남기기'(L-3) — 확장 섹션을 한꺼번에 숨기기·다시 보이기·지우기, 겹치는 거터는 함께

const sec = (id: string, sectionType: S, expansion?: ExpansionKind): CanvasSection =>
  ({
    id,
    sectionType,
    groupType: 'usp',
    order: 0,
    isVisible: true,
    layoutId: 'l',
    elements: [],
    canvas: { width: 860, height: 400, backgroundColor: '#fff' },
    ...(expansion ? { expansion } : {}),
  }) as CanvasSection

/** 섹션마다 뒤에 거터(divider) — insertWhiteDividers와 같은 모양(마지막 섹션 뒤는 없음), order는 배열 순서 */
function withGutters(body: CanvasSection[]): CanvasSection[] {
  return body
    .flatMap((s, i) => (i === body.length - 1 ? [s] : [s, sec(`d-${s.id}`, S.DIVIDER)]))
    .map((s, i) => ({ ...s, order: i }))
}
const page = () =>
  withGutters([
    sec('hook', S.HOOK_3STEP),
    sec('point', S.POINT_DIV),
    sec('care', S.SPEC_TABLE, 'care'),
    sec('size', S.SPEC_TABLE, 'size'),
    sec('faq', S.SPEC_TABLE, 'faq'),
    sec('cta', S.CTA),
  ])
const ids = (sections: CanvasSection[]) => sections.map((s) => s.id)
const visibleIds = (sections: CanvasSection[]) => ids(sections.filter((s) => s.isVisible))

describe('keepCore — 확장 섹션 일괄 처리', () => {
  it('상태 — 확장 섹션 수와 보이는 수, 없으면 0', () => {
    expect(expansionState(page())).toEqual({ count: 3, visible: 3 })
    expect(expansionState(withExpansionsVisible(page(), false))).toEqual({ count: 3, visible: 0 })
    expect(expansionState([sec('hook', S.HOOK_3STEP)])).toEqual({ count: 0, visible: 0 })
  })

  it('숨기기 — 확장 섹션과 겹치게 되는 그 거터만 숨긴다(남는 거터는 앞 섹션 것), 다시 보이기는 원래대로', () => {
    const hidden = withExpansionsVisible(page(), false)
    expect(visibleIds(hidden)).toEqual(['hook', 'd-hook', 'point', 'd-point', 'cta'])
    expect(withExpansionsVisible(hidden, true)).toEqual(page())
    // 바뀔 것이 없으면 같은 배열(기록을 남기지 않는다), 바뀌지 않은 섹션은 같은 객체
    const same = page()
    expect(withExpansionsVisible(same, true)).toBe(same)
    const base = page()
    expect(withExpansionsVisible(base, false)[0]).toBe(base[0])
  })

  it('지우기 — 확장 섹션과 겹치게 되는 이웃 거터를 빼고 order를 다시 매긴다(숨긴 뒤 지워도 같다)', () => {
    const removed = withoutExpansions(page())
    expect(ids(removed)).toEqual(['hook', 'd-hook', 'point', 'd-point', 'cta'])
    expect(removed.map((s) => s.order)).toEqual([0, 1, 2, 3, 4])
    expect(ids(withoutExpansions(withExpansionsVisible(page(), false)))).toEqual(ids(removed))
    const none = [sec('hook', S.HOOK_3STEP)]
    expect(withoutExpansions(none)).toBe(none)
  })

  it('사용자가 확장 섹션을 옮긴 뒤에도 섹션 사이 거터는 하나씩 남는다', () => {
    // 관리·보관을 point 바로 위로 끌어올린 모양 — 거터는 제자리에 남는다(LeftPanel 드래그)
    const moved = [
      sec('hook', S.HOOK_3STEP),
      sec('d-hook', S.DIVIDER),
      sec('care', S.SPEC_TABLE, 'care'),
      sec('point', S.POINT_DIV),
      sec('d-point', S.DIVIDER),
      sec('d-care', S.DIVIDER),
      sec('cta', S.CTA),
    ].map((s, i) => ({ ...s, order: i }))
    const hidden = withExpansionsVisible(moved, false)
    expect(visibleIds(hidden)).toEqual(['hook', 'd-hook', 'point', 'd-point', 'd-care', 'cta'])
    expect(ids(withoutExpansions(moved))).toEqual(['hook', 'd-hook', 'point', 'd-point', 'd-care', 'cta'])
  })
})

describe('편집기 스토어 — 되돌리기 한 번', () => {
  const load = () => useEditorStore.getState().initDocument({ id: 'd1', pdpId: 'job-1', sections: page() } as never)
  const sections = () => useEditorStore.getState().document!.sections
  const historyIndex = () => useCanvasStore.getState().historyIndex

  it('핵심만 남기기는 기록 하나 → 되돌리기 한 번에 원래대로, 바뀔 것이 없으면 기록을 남기지 않는다', () => {
    load()
    const start = historyIndex()
    useEditorStore.getState().setExpansionsVisible(true)
    expect(historyIndex()).toBe(start)
    useEditorStore.getState().setExpansionsVisible(false)
    expect(historyIndex()).toBe(start + 1)
    expect(expansionState(sections())).toEqual({ count: 3, visible: 0 })
    expect(useEditorStore.getState().isDirty).toBe(true)
    useEditorStore.getState().undoDocument()
    expect(sections()).toEqual(page())
  })

  it('숨긴 확장 섹션을 고르고 있었으면 선택 해제, 지우기도 기록 하나 → 되돌리기 한 번에 원래대로', () => {
    load()
    useEditorStore.getState().selectSection('faq')
    useEditorStore.getState().setExpansionsVisible(false)
    expect(useEditorStore.getState().selectedSectionId).toBeNull()
    useEditorStore.getState().undoDocument()
    useEditorStore.getState().selectSection('size')
    useEditorStore.getState().removeExpansions()
    expect(ids(sections())).toEqual(['hook', 'd-hook', 'point', 'd-point', 'cta'])
    expect(useEditorStore.getState().selectedSectionId).toBeNull()
    useEditorStore.getState().undoDocument()
    expect(ids(sections())).toEqual(ids(page()))
  })

  it('섹션별 눈 토글도 기록을 남긴다 — 일괄 숨김 뒤 한 섹션을 다시 보이고 되돌리면 그 섹션만 다시 숨는다', () => {
    load()
    useEditorStore.getState().setExpansionsVisible(false)
    useEditorStore.getState().toggleSectionVisibility('care')
    expect(expansionState(sections())).toEqual({ count: 3, visible: 1 })
    useEditorStore.getState().undoDocument()
    expect(expansionState(sections())).toEqual({ count: 3, visible: 0 })
  })
})
