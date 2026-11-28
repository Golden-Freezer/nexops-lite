/**
 * 사이즈 단독 컷의 치수선 자리 — 사진 안 제품 경계(ProductBox)를 페이지 좌표로 옮긴다. 사진은 자르지 않고 틀 안에 contain으로 놓는다.
 * 자르면 경계를 못 잡은 제품이 함께 잘리고(R15 P11) 잘린 네모가 무대 위에 드러난다(R15 P07·P09·P02).
 * 경계를 못 쟀거나 믿기 어렵거나 비율이 입력과 다르면 null(선 없이 글자만 — 틀린 선보다 낫다). 순수.
 */

import type { ProductBox } from '@/lib/registration/pdp-state'

/** 사이즈 단독 컷의 이미지 키 */
export const SIZE_SINGLE_SECTION = 'size_single'

export interface LineFrame {
  x: number
  y: number
  w: number
  h: number
}

/** 입력 비율과 사진 제품 비율의 허용 차이 — 생성 컷의 그림자·기울기를 감안한 값 */
const RATIO_TOLERANCE = 0.2
const TO_MM: Readonly<Record<string, number>> = { mm: 1, cm: 10, m: 1000, inch: 25.4, '인치': 25.4 }

type Dim = { axis: string; value: number; unit: string }

const inMm = (dim: Dim) => (TO_MM[dim.unit.toLowerCase()] ? dim.value * TO_MM[dim.unit.toLowerCase()] : null)

/** frame = 사진을 contain으로 넣는 틀. 돌려주는 값 = 제품 경계의 페이지 좌표. 선을 그으면 안 되면 null */
export function sizeLine(frame: LineFrame, box: ProductBox | null | undefined, dims: readonly Dim[]): LineFrame | null {
  if (!box || box.uncertain || dims.length === 0) return null
  const width = dims.find((d) => d.axis === 'w')
  const height = dims.find((d) => d.axis === 'h')
  if (width && height) {
    const [w, h] = [inMm(width), inMm(height)]
    if (!w || !h) return null
    const measured = (box.width * box.aspect) / box.height
    if (Math.abs(measured - w / h) / (w / h) > RATIO_TOLERANCE) return null
  }
  const fullH = Math.min(frame.h, frame.w / box.aspect)
  const fullW = fullH * box.aspect
  const photoX = frame.x + (frame.w - fullW) / 2
  const photoY = frame.y + (frame.h - fullH) / 2
  return {
    x: Math.round(photoX + box.left * fullW),
    y: Math.round(photoY + box.top * fullH),
    w: Math.round(box.width * fullW),
    h: Math.round(box.height * fullH),
  }
}
