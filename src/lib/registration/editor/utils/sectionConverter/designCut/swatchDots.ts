/**
 * D 옵션 칸 색 점(적용 C5 ③ T1-99 D, 통합 11-04 01:14 ①·03:23 ③) — 계획이 단 견본 짝(swatches)의 옵션 이름 앞에 입력 색 점을 그린다.
 * - 색은 입력 #RRGGBB 그대로다(pairedSwatches). 칩의 colorByName(이름에서 지은 색)·사진 색은 쓰지 않는다
 * - 이름 글은 지금 자리 그대로 두고(칸·높이 그대로), 이름 한 줄 왼쪽에 점이 들 때만 그린다
 * - **모든 옵션에 점을 그릴 수 있을 때만 그린다**(통합 05:3x 조건 ⓑ — render 표본 P01·P10에서 7옵션 중 2점은 그 둘만 고른 표시처럼 읽혀 어색했다):
 *   짝 없는 옵션·두 줄 이름·점이 칸 밖인 옵션이 하나라도 있으면 옵션 칸 전체가 점 없이 지금 그대로다. 계획에 짝이 없으면(입력 없음) 바이트가 같다
 */

import type { CanvasElement } from '@/lib/registration/editor/types/canvas'
import type { DesigncutSection } from '@/lib/registration/pdp-state'
import { CutBuilder, approxTextWidth, cutTextLines } from './build'
import { rgba, type TypeToken } from './tokens'

/** 점 지름·점과 이름 사이·칸 안쪽 여백 */
const DOT = 28
const DOT_GAP = 16
const CELL_PAD = 16

/** 옵션 이름에 짝지은 입력 색 — 이름이 정확히 같은 짝만(계획이 칩 이름 그대로 단다) */
export function swatchHexOf(swatches: DesigncutSection['swatches'], label: string): string | null {
  return swatches?.find((s) => s.option === label)?.hex ?? null
}

/** 가운데 정렬 이름(칸 x·폭 w) 왼쪽 점 x — 이름이 한 줄이고 점까지 칸 안쪽에 들 때만(아니면 null) */
function dotXOf(label: string, token: TypeToken, x: number, w: number): number | null {
  if (cutTextLines(label, token, w) > 1) return null
  const textW = Math.min(w, approxTextWidth(label, token.size))
  const dotX = Math.round(x + (w - textW) / 2) - DOT_GAP - DOT
  return dotX < x + CELL_PAD ? null : dotX
}

/** 옵션 칸 전체에 점을 그릴 수 있는지 — 옵션이 2개 이상이고 모든 이름에 짝 색이 있으며 모두 한 줄·칸 안에 점이 들 때만(일부 옵션에만 점을 두지 않는다) */
export function swatchDotsFitAll(swatches: DesigncutSection['swatches'], labels: readonly string[], token: TypeToken, w: number): boolean {
  return labels.length >= 2 && labels.every((label) => swatchHexOf(swatches, label) !== null && dotXOf(label, token, 0, w) !== null)
}

/**
 * 가운데 정렬 이름(칸 x·폭 w, 글 위 y) 왼쪽에 점 — 이름이 한 줄이고 점까지 칸 안쪽에 들 때만 그린다. 그린 점(못 그리면 null)
 */
export function drawSwatchDot(b: CutBuilder, name: string, hex: string, label: string, token: TypeToken, x: number, w: number, y: number, textColor: string): CanvasElement | null {
  const dotX = dotXOf(label, token, x, w)
  if (dotX === null) return null
  const lineH = Math.round(token.size * token.lineHeight)
  return b.shape(name, 'circle', dotX, y + Math.round((lineH - DOT) / 2), DOT, DOT, { fill: hex, stroke: rgba(textColor, 0.25), strokeWidth: 2 })
}
