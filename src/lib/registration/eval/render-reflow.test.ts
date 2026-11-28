import { beforeAll, describe, expect, it } from 'vitest'
import { fixtureToJob, loadEnrichmentFixture } from '@/lib/registration/__golden__/golden-harness'
import { useEditorStore } from '@/lib/registration/editor/stores/editorStore'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import type { ProEditorDocument } from '@/lib/registration/editor/types/editor'
import { renderJobHtml } from './render-capture'
import { applyEditorReflow, markedRenderHtml } from './render-reflow'

const isAutoText = (el: CanvasElement) => el.type === 'text' && el.autoHeight !== false && el.isVisible
const visibleSections = (doc: ProEditorDocument) => doc.sections.filter((s) => s.isVisible && s.canvas.height >= 10)

/** 컨테이너 밖 autoHeight 글자가 있는 첫 신규 변환 섹션 — 키우면 아래 요소가 통째로 밀린다 */
function pickTarget(doc: ProEditorDocument): { section: CanvasSection; el: CanvasElement } {
  for (const section of visibleSections(doc)) {
    if (!section.needsInitialReflow) continue
    const contained = new Set(section.elements.flatMap((e) => e.containerOf ?? []))
    const el = section.elements.find((e) => isAutoText(e) && !contained.has(e.id))
    if (el) return { section, el }
  }
  throw new Error('대상 글자 요소가 없습니다')
}

const findEl = (doc: ProEditorDocument, sectionId: string, elId: string) =>
  doc.sections.find((s) => s.id === sectionId)!.elements.find((e) => e.id === elId)!

let doc: ProEditorDocument
let html: string

beforeAll(async () => {
  ;({ doc, html } = await renderJobHtml(fixtureToJob(loadEnrichmentFixture('A-track-i'))))
})

describe('markedRenderHtml', () => {
  it('보이는 섹션·글자 요소에만 id 표시를 붙이고, 표시를 지우면 평가 캡처 HTML과 같다', () => {
    const marked = markedRenderHtml(doc)
    const sections = visibleSections(doc)
    const texts = sections.flatMap((s) => s.elements.filter((e) => e.type === 'text' && e.textProps && e.isVisible))
    expect(marked.match(/ data-sec="/g)).toHaveLength(sections.length)
    expect(marked.match(/ data-el="/g)).toHaveLength(texts.length)
    expect(html).not.toMatch(/data-(sec|el)=/)
    expect(marked.replace(/ data-(sec|el)="[^"]*"/g, '')).toBe(html)
  })
})

describe('applyEditorReflow', () => {
  it('실측이 상자보다 크면 그 글자를 키우고 섹션 높이를 늘린다 — 입력 문서와 전역 store는 그대로', () => {
    const { section, el } = pickTarget(doc)
    const baseline = applyEditorReflow(doc, {})
    const baseEl = findEl(baseline.doc, section.id, el.id)
    const baseHeight = baseline.doc.sections.find((s) => s.id === section.id)!.canvas.height

    const grown = applyEditorReflow(doc, { [section.id]: { [el.id]: baseEl.transform.height + 100 } })
    const grownSection = grown.doc.sections.find((s) => s.id === section.id)!
    expect(findEl(grown.doc, section.id, el.id).transform.height).toBe(baseEl.transform.height + 100)
    expect(grownSection.canvas.height).toBeGreaterThan(baseHeight)
    expect(grown.changedSections).toContain(section.id)
    expect(grown.updatedElements).toBe(1)
    expect(grown.heightAfter).toBeGreaterThan(baseline.heightAfter)
    expect(grown.html).toContain(`height:${grownSection.canvas.height}px`)

    expect(findEl(doc, section.id, el.id).transform.height).toBe(el.transform.height)
    expect(useEditorStore.getState().document).toBeNull()
  })

  it('2px 이하 차이는 상태에 올리지 않는다(편집기 마운트 실측과 같은 문턱)', () => {
    const { section, el } = pickTarget(doc)
    const measured = structuredClone(doc)
    const target = findEl(measured, section.id, el.id)
    target.measuredHeight = target.transform.height

    const near = applyEditorReflow(measured, { [section.id]: { [el.id]: target.transform.height + 2 } })
    expect(near.measuredElements).toBe(1)
    expect(near.updatedElements).toBe(0)
    const far = applyEditorReflow(measured, { [section.id]: { [el.id]: target.transform.height + 3 } })
    expect(far.updatedElements).toBe(1)
  })

  it('needsInitialReflow가 없는 섹션(저장본·프리셋 기하)은 실측을 받지 않는다', () => {
    const { section, el } = pickTarget(doc)
    const saved = structuredClone(doc)
    for (const s of saved.sections) s.needsInitialReflow = false
    const out = applyEditorReflow(saved, { [section.id]: { [el.id]: el.transform.height + 100 } })
    expect(out.measuredElements).toBe(0)
    expect(out.changedSections).toEqual([])
    expect(out.heightAfter).toBe(out.heightBefore)
  })
})

describe('자연 높이 실측(pdp-text-natural-height) — 편집기처럼 줄어드는 경우', () => {
  it('실측이 상자보다 작으면 글자를 줄이고 아래 요소·섹션 높이를 같이 올린다(캡처가 편집기와 같은 자연 높이를 넘긴다)', () => {
    const { section, el } = pickTarget(doc)
    const baseline = applyEditorReflow(doc, {})
    const baseEl = findEl(baseline.doc, section.id, el.id)
    const baseSection = baseline.doc.sections.find((s) => s.id === section.id)!
    const below = baseSection.elements.filter((e) => e.id !== el.id && e.transform.y >= baseEl.transform.y + baseEl.transform.height)
    // 글자 최소 높이(20) 위에서 줄인다
    const cut = Math.min(60, baseEl.transform.height - 30)
    expect(cut).toBeGreaterThan(2)

    const shrunk = applyEditorReflow(doc, { [section.id]: { [el.id]: baseEl.transform.height - cut } })
    const shrunkSection = shrunk.doc.sections.find((s) => s.id === section.id)!
    expect(findEl(shrunk.doc, section.id, el.id).transform.height).toBe(baseEl.transform.height - cut)
    expect(shrunkSection.canvas.height).toBe(baseSection.canvas.height - cut)
    for (const b of below) expect(findEl(shrunk.doc, section.id, b.id).transform.y, b.name).toBe(b.transform.y - cut)
    expect(shrunk.heightAfter).toBe(baseline.heightAfter - cut)
  })
})
