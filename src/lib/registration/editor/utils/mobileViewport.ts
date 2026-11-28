/**
 * 모바일 보기 계산(묶음 5 ①) — 편집기 폰 미리보기(MobilePreview)와 폰 접속 읽기 전용 뷰어(MobileEditorViewer)가 같이 쓴다. 순수 함수.
 * 기본 폭 390은 서버 모바일 검사기(mobileReadability, 390×844 폰 = 캔버스 1,860px)와 같은 기준이다. 375는 예전 미리보기 폭이다.
 * 글자 경고 기준은 검사기 M1과 같은 mobileFontFloor다(860px 원본 기준이라 표시 폭과 무관하고, 좌표·표시 크기만 배율을 따른다).
 */

import type { CanvasSection } from '../types/canvas'
import { isAnnotationElement, mobileFontFloor, PHONE_SCREEN_CANVAS_PX } from './mobileReadability'

export const MOBILE_CANVAS_WIDTH = 860
export const MOBILE_PREVIEW_WIDTHS = [390, 375] as const
export type MobilePreviewWidth = (typeof MOBILE_PREVIEW_WIDTHS)[number]
export const DEFAULT_MOBILE_PREVIEW_WIDTH: MobilePreviewWidth = 390

/** Canvas·내보내기와 같은 기준 — divider·0높이·숨김 섹션을 빼고 순서대로 */
export function visibleSectionsInOrder(sections: readonly CanvasSection[]): CanvasSection[] {
  return [...sections]
    .sort((a, b) => a.order - b.order)
    .filter((s) => s.isVisible && s.sectionType !== 'divider' && s.canvas.height > 0)
}

export interface MobileFontWarning {
  id: string
  /** 표시 폭 기준 좌표(px) */
  x: number
  y: number
  width: number
  height: number
  sourceSize: number
  mobileSize: number
  /** 소스 px 하한(mobileFontFloor) */
  floor: number
}

export interface MobileLayout {
  scale: number
  /** 표시 폭 기준 전체 높이 */
  totalHeight: number
  /** 폰 한 화면(검사기 1,860 캔버스 px)이 끝나는 표시 y — 첫 화면 경계선 */
  firstScreenY: number
  warnings: MobileFontWarning[]
}

/** visible = visibleSectionsInOrder 결과. 섹션 y를 쌓으며 하한 미달 글자를 표시 좌표로 모은다 */
export function layoutForMobile(visible: readonly CanvasSection[], displayWidth: number): MobileLayout {
  const scale = displayWidth / MOBILE_CANVAS_WIDTH
  const warnings: MobileFontWarning[] = []
  let y = 0
  for (const section of visible) {
    for (const el of section.elements) {
      const isText = el.type === 'text' || (el.type === 'badge' && isAnnotationElement(el))
      if (!isText || !el.textProps || !el.isVisible || !el.textProps.content?.trim()) continue
      const sourceSize = el.textProps.fontSize
      const floor = mobileFontFloor(el)
      if (sourceSize >= floor) continue
      warnings.push({
        id: `${section.id}-${el.id}`,
        x: el.transform.x * scale,
        y: (y + el.transform.y) * scale,
        width: Math.max(el.transform.width * scale, 16),
        height: Math.max(el.transform.height * scale, 12),
        sourceSize,
        mobileSize: Math.round(sourceSize * scale),
        floor,
      })
    }
    y += section.canvas.height
  }
  return { scale, totalHeight: y * scale, firstScreenY: PHONE_SCREEN_CANVAS_PX * scale, warnings }
}
