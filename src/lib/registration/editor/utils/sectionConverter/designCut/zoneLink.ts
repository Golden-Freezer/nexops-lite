/**
 * D 구역 연결 표식(적용 D6 P5 R-W9·T2-13, 통합 11-03 21:1x) — 계획이 linkBelow를 단 고민(T2) 칸 아래 여백에 세로 점선 + 원 화살표를 둔다.
 * 그리기는 K 표식(templatelib/zone-link — import만)과 같다. 조립이 아래 여백 맞춤·경계 조이기를 끝낸 뒤 붙여 원이 섹션 끝에 닿는다.
 * 섹션 높이는 바꾸지 않는다. 원이 들어갈 여백(간격 + 원 + 끝)이 없으면 그리지 않는다. 순수.
 */

import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { drawLink, linkInk } from '@/lib/registration/templatelib/zone-link'
import { CutBuilder } from './build'

/**
 * contentBottom = 섹션 내용 아래 끝(조립의 contentSpan). surf.text는 그 바탕의 글자색 — 강조색이 바탕 대비 3 미만이면 표식이 이 색이다.
 * 원 안은 섹션 바탕색으로 채운다
 */
export function withZoneLink(sec: CanvasSection, contentBottom: number, surf: { text: string }, accent: string): CanvasSection {
  const fill = sec.canvas.backgroundColor
  const b = new CutBuilder()
  drawLink(b, contentBottom, sec.canvas.height, linkInk({ fill, text: surf.text }, accent), fill, `${sec.id}-link`)
  if (b.elements.length === 0) return sec
  const z = Math.max(0, ...sec.elements.map((e) => e.zIndex))
  return { ...sec, elements: [...sec.elements, ...b.elements.map((e) => ({ ...e, zIndex: z + e.zIndex }))] }
}
