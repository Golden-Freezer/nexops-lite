/**
 * 이미지 바꾸기(묶음 5 ②·③) — 보관함 이미지로 교체, AI 재생성 결과 반영이 같이 쓴다. 순수 함수.
 * src만 바꾼다: 위치·크기·잘라내기·모서리·글자는 그대로라 섹션 배치(프리셋 슬롯)가 흔들리지 않는다.
 */

import type { CanvasElement, CanvasSection } from '../types/canvas'
import { IMAGE_SPECS, SPACING } from '../constants/designTokens'

export function imageSrcOf(el: CanvasElement): string | null {
  if (el.type === 'image') return el.imageProps?.src || null
  if (el.type === 'framed-image') return el.framedImageProps?.src || null
  return null
}

/** image·framed-image 요소의 src를 바꾸는 부분 갱신(updateElement 인자). 이미지 계열이 아니면 null */
export function imageSrcPatch(el: CanvasElement, url: string, isUserUploaded: boolean): Partial<CanvasElement> | null {
  if (el.type === 'image' && el.imageProps) return { imageProps: { ...el.imageProps, src: url, isUserUploaded } }
  if (el.type === 'framed-image' && el.framedImageProps) {
    return { framedImageProps: { ...el.framedImageProps, src: url, isUserUploaded } }
  }
  return null
}

/** src가 url인 이미지 계열 요소 전부 — 같은 컷이 여러 자리에 들어갈 수 있다 */
export function elementsWithSrc(sections: readonly CanvasSection[], url: string): Array<{ sectionId: string; elementId: string }> {
  const found: Array<{ sectionId: string; elementId: string }> = []
  if (!url) return found
  for (const section of sections) {
    for (const el of section.elements) if (imageSrcOf(el) === url) found.push({ sectionId: section.id, elementId: el.id })
  }
  return found
}

/**
 * 사진 없는 섹션 끝에 새 컷을 놓는다(편집기 사후 재생성 W5b) — 가장 아래 요소 밑에 내용 폭(좌우 여백 뺀 폭)으로, 비율은 사진 그대로.
 * 섹션 높이는 사진과 하단 여백이 들어가게 늘린다(줄이지는 않는다). 생성 컷이라 사용자 업로드가 아니다
 */
export function appendedImage(
  section: CanvasSection,
  src: string,
  size: { width: number; height: number },
  id: string,
  imageType: string
): { element: CanvasElement; height: number } {
  const width = IMAGE_SPECS.canvasWidth - SPACING.sectionSidePadding * 2
  const height = Math.round(width * (size.height > 0 && size.width > 0 ? size.height / size.width : 1))
  const bottom = Math.max(0, ...section.elements.map((el) => el.transform.y + el.transform.height))
  const y = bottom + SPACING.imageToImage
  const zIndex = Math.max(0, ...section.elements.map((el) => el.zIndex)) + 1
  const element: CanvasElement = {
    id,
    type: 'image',
    name: 'AI 새 컷',
    transform: { x: SPACING.sectionSidePadding, y, width, height, rotation: 0 },
    zIndex,
    isLocked: false,
    isVisible: true,
    opacity: 1,
    imageProps: { src, alt: '', objectFit: 'cover', imageType, isUserUploaded: false },
  }
  return { element, height: Math.max(section.canvas.height, y + height + SPACING.sectionBottomPadding) }
}
