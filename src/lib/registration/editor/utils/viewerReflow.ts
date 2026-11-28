/**
 * 보기 전용 뷰어의 마운트 리플로우 — 편집기를 처음 열 때(CanvasElement 마운트 실측 → reflowSection)와 같은 판단을 스토어 없이 한다.
 * 대상은 신규 변환 섹션(needsInitialReflow)뿐이다. 저장본 기하는 사용자가 승인한 진실이라 건드리지 않는다.
 * 입력을 바꾸지 않는다. 바뀐 섹션만 새 객체이고, 바뀐 것이 없으면 입력 배열을 그대로 돌려준다(재측정이 다음 그리기를 부르지 않게).
 */

import type { CanvasElement, CanvasSection } from '../types/canvas'
import { reflowSectionLayout } from './reflowSectionLayout'

/** CanvasElement 마운트 실측과 같은 문턱 — 이 차이 이하는 상태에 올리지 않는다 */
const MEASURE_TOLERANCE_PX = 2
/** reflowSectionLayout이 글자 상자에 주는 최소 높이 */
const MIN_TEXT_HEIGHT = 20

/** 섹션 id·글자 요소 id의 실측 높이. 화면에 없으면 null */
export type MeasureText = (sectionId: string, elementId: string) => number | null

const isAutoHeightText = (el: CanvasElement) => el.type === 'text' && el.autoHeight !== false

/** 실측값(문턱 넘는 차이만)을 얹은 요소 목록. 달라진 것이 없으면 입력 그대로 */
function withMeasuredHeights(section: CanvasSection, measure: MeasureText): CanvasElement[] {
  let changed = false
  const elements = section.elements.map((el) => {
    if (!isAutoHeightText(el)) return el
    const height = measure(section.id, el.id)
    if (height === null || height <= 0) return el
    if (Math.abs(height - (el.measuredHeight ?? 0)) <= MEASURE_TOLERANCE_PX) return el
    changed = true
    return { ...el, measuredHeight: height }
  })
  return changed ? elements : section.elements
}

/** 글자 상자가 실측 높이와 아직 다른가 — 리플로우하면 같아지므로 다음 측정에서 멈춘다 */
const awaitsReflow = (elements: readonly CanvasElement[]) =>
  elements.some(
    (el) => isAutoHeightText(el) && Boolean(el.measuredHeight) && Math.max(el.measuredHeight!, MIN_TEXT_HEIGHT) !== el.transform.height
  )

export function reflowMeasuredSections(sections: CanvasSection[], measure: MeasureText): CanvasSection[] {
  let changed = false
  const next = sections.map((section) => {
    if (!section.needsInitialReflow) return section
    const elements = withMeasuredHeights(section, measure)
    if (!awaitsReflow(elements)) return section
    const copy = structuredClone({ ...section, elements })
    reflowSectionLayout(copy)
    changed = true
    return copy
  })
  return changed ? next : sections
}
