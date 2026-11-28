/**
 * 평가 캡처 높이 정합(묶음 2, port-plan §1 #17) — 편집기를 처음 열 때의 리플로우를 문서에 그대로 적용한다. R4부터 선택(capture.mjs --reflow).
 *
 * 편집기: 신규 변환 섹션(needsInitialReflow)의 autoHeight 글자 div를 마운트에서 실측(scrollHeight)해 2px 넘게 다르면 measuredHeight에 올리고
 * (CanvasElement), reflowSection이 그 높이로 글자·아래 요소·컨테이너·섹션 높이를 다시 맞춘다(editorStore).
 * 편집기는 자동 높이 글자를 height:auto로 그려 이 실측이 내용 높이다 — 캡처 페이지도 상자 높이를 풀고 잰다(capture.mjs measureTextHeights,
 * pdp-text-natural-height). 그래야 넓게 추정한 상자가 편집기처럼 줄어든다.
 * 평가 캡처는 이 단계 없이 exportRenderHtml을 찍어 왔다(render-capture.ts). 여기서는 캡처 페이지가 잰 값을 받아 같은 store 동작을 부른다 —
 * 리플로우 규칙을 다시 구현하지 않는다. 실측은 표시 붙은 HTML(exportRenderHtml markTextElements)로 브라우저가 한다(scripts/pdp-eval/capture.mjs).
 */

import { useEditorStore } from '@/lib/registration/editor/stores/editorStore'
import { exportRenderHtml } from '@/lib/registration/editor/utils/exportUtils/htmlBuilders'
import type { ProEditorDocument } from '@/lib/registration/editor/types/editor'

/** 섹션 id → 글자 요소 id → 실측 scrollHeight(px) */
export type TextMeasurements = Record<string, Record<string, number>>

/** CanvasElement 마운트 실측과 같은 문턱 — 이 차이 이하는 상태에 올리지 않는다 */
const MEASURE_TOLERANCE_PX = 2

export interface ReflowResult {
  doc: ProEditorDocument
  html: string
  /** 실측값을 받은 글자 요소 수 / 그중 measuredHeight를 바꾼 수 */
  measuredElements: number
  updatedElements: number
  /** 높이가 바뀐 섹션 id */
  changedSections: string[]
  /** 보이는 섹션 높이 합(exportRenderHtml 기준) 전후 */
  heightBefore: number
  heightAfter: number
}

const visibleHeight = (doc: ProEditorDocument) =>
  doc.sections.filter((s) => s.isVisible && s.canvas.height >= 10).reduce((sum, s) => sum + s.canvas.height, 0)

/** 실측용 HTML — 섹션(data-sec)·글자 요소(data-el)에 id 표시. 그 밖은 평가 캡처 HTML과 같다 */
export function markedRenderHtml(doc: ProEditorDocument): string {
  return exportRenderHtml(doc.sections, {}, doc.sourceData.designPalette ?? null, { markTextElements: true })
}

/**
 * 실측값으로 편집기 최초 리플로우를 적용한 문서와 HTML. 입력 문서는 바꾸지 않는다.
 * editorStore는 모듈 전역이라 한 프로세스에서 순서대로만 부른다(평가 스크립트 한정).
 */
export function applyEditorReflow(doc: ProEditorDocument, measurements: TextMeasurements): ReflowResult {
  const store = useEditorStore
  store.getState().initDocument(structuredClone(doc))
  let measuredElements = 0
  let updatedElements = 0
  const reflowTargets: string[] = []
  try {
    for (const section of store.getState().document!.sections) {
      if (!section.needsInitialReflow) continue
      const measured = measurements[section.id] ?? {}
      for (const el of section.elements) {
        if (el.type !== 'text' || el.autoHeight === false) continue
        const height = measured[el.id]
        if (!(height > 0)) continue
        measuredElements += 1
        if (Math.abs(height - (el.measuredHeight ?? 0)) > MEASURE_TOLERANCE_PX) {
          store.getState().setMeasuredHeight(section.id, el.id, height)
          updatedElements += 1
        }
      }
      reflowTargets.push(section.id)
    }
    // 편집기는 measuredHeight가 있는 autoHeight 글자마다 reflowSection을 부른다 — 같은 섹션에서 여러 번 불러도 결과가 같다(멱등)
    for (const id of reflowTargets) {
      const section = store.getState().document!.sections.find((s) => s.id === id)!
      const hasMeasured = section.elements.some((el) => el.type === 'text' && el.autoHeight !== false && el.measuredHeight)
      if (hasMeasured) store.getState().reflowSection(id)
    }
    const reflowed = structuredClone(store.getState().document!)
    const before = new Map(doc.sections.map((s) => [s.id, s.canvas.height]))
    return {
      doc: reflowed,
      html: exportRenderHtml(reflowed.sections, {}, reflowed.sourceData.designPalette ?? null),
      measuredElements,
      updatedElements,
      changedSections: reflowed.sections.filter((s) => before.get(s.id) !== s.canvas.height).map((s) => s.id),
      heightBefore: visibleHeight(doc),
      heightAfter: visibleHeight(reflowed),
    }
  } finally {
    store.getState().clearDocument()
  }
}
