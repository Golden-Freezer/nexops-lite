/**
 * 구역 연결 표식(적용 R-W9, 연구 L9 표 3 N4 '경계에 걸친 원 화살표, 세로 점선' — 전환 구간) — 섹션 아래 여백 안 가운데에 세로 점선을 긋고
 * 맨 아래(섹션 끝 LINK.inset 안)에 원 화살표를 둔다. 섹션 경계는 조립 단계라 템플릿은 섹션 밖에 못 그리므로 화살표는 경계에 닿게만 둔다.
 * 값 없는 장식이라 템플릿 높이·간격을 바꾸지 않는다. 여백 호흡(k-breath)이 아래 여백을 88·120·150으로 바꾸면 relayoutLink가 다시 붙인다.
 * 색은 강조색이 바탕 위 비텍스트 대비 3 이상이면 강조색, 아니면 바탕 글자색이다(숨기지 않는다). 순수.
 */

import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import type { CutBuilder } from '@/lib/registration/editor/utils/sectionConverter/designCut/build'
import { W } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'

/**
 * gap: 내용 끝 → 점선, arrow: 원 지름, inset: 원 → 섹션 끝, stroke: 원 테두리·꺾쇠 선 굵기, line: 점선 굵기(점 지름), dot: 점 사이(중심 간격),
 * lineGap: 점선 → 원, minLine: 이보다 짧으면 점선을 숨긴다. 폰 390(860의 0.45배)에서 원 약 25px·선 약 1.5px·점 약 2.7px(통합 11-03).
 * gap + arrow + inset(80)은 가장 좁은 여백(K_BREATH.narrow 88) 안이다 — 좁은 여백에서는 점선이 8 미만이라 원만 남는다
 */
export const LINK = { gap: 20, arrow: 56, inset: 4, stroke: 3.3, line: 6, dot: 16, lineGap: 8, minLine: 8 } as const
export const LINK_NAME = 'designcut-link'
const LINE_NAME = `${LINK_NAME}-line`
const ARROW_NAME = `${LINK_NAME}-arrow`
/** 비텍스트(선·도형) 대비 하한 — WCAG 1.4.11 */
export const LINK_CONTRAST = 3

/** 구역 연결 표식 요소 — 여백 판정(k-breath)에서 내용으로 세지 않는다 */
export const isLinkElement = (el: Pick<CanvasElement, 'name'>) => el.name?.startsWith(`${LINK_NAME}-`) ?? false

/** 표식 색 — 강조색이 바탕 대비 3 이상이면 강조색, 아니면 바탕 글자색 */
export function linkInk(surf: { fill: string; text: string }, accent: string): string {
  const a = parseColor(accent)
  const f = parseColor(surf.fill)
  return a && f && contrastRatio(a, f) >= LINK_CONTRAST ? accent : surf.text
}

const lineSvg = (h: number, ink: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${LINK.line}" height="${h}" viewBox="0 0 ${LINK.line} ${h}">` +
  `<line x1="${LINK.line / 2}" y1="${LINK.line / 2}" x2="${LINK.line / 2}" y2="${h - LINK.line / 2}" stroke="${ink}" stroke-width="${LINK.line}" stroke-linecap="round" stroke-dasharray="0.1 ${LINK.dot}"/></svg>`

/** 원 화살표 — 테두리 원 + 아래 꺾쇠(원 지름에 비례). 안은 바탕색으로 채워 점선이 비치지 않는다 */
const arrowSvg = (ink: string, fill: string) => {
  const r = LINK.arrow / 2
  const [half, up, down] = [Math.round(r * 0.36), Math.round(r * 0.14), Math.round(r * 0.22)]
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${LINK.arrow}" height="${LINK.arrow}" viewBox="0 0 ${LINK.arrow} ${LINK.arrow}">` +
    `<circle cx="${r}" cy="${r}" r="${r - 2}" fill="${fill}" stroke="${ink}" stroke-width="${LINK.stroke}"/>` +
    `<path d="M${r - half} ${r - up} L${r} ${r + down} L${r + half} ${r - up}" fill="none" stroke="${ink}" stroke-width="${LINK.stroke}" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  )
}

const lineX = W / 2 - LINK.line / 2
const arrowTop = (height: number) => height - LINK.inset - LINK.arrow

/**
 * 내용 끝(contentEnd)과 섹션 끝(height) 사이에 그린다. 원이 들어갈 자리가 없으면 그리지 않는다.
 * 점선은 원 위 lineGap까지, 짧으면 원만 둔다
 */
export function drawLink(b: CutBuilder, contentEnd: number, height: number, ink: string, fill: string, group: string): void {
  const top = arrowTop(height)
  if (top < contentEnd + LINK.gap) return
  const lineTop = contentEnd + LINK.gap
  const lineH = top - LINK.lineGap - lineTop
  if (lineH >= LINK.minLine) b.svg(LINE_NAME, lineSvg(lineH, ink), lineX, lineTop, LINK.line, lineH).groupId = group
  b.svg(ARROW_NAME, arrowSvg(ink, fill), W / 2 - LINK.arrow / 2, top, LINK.arrow, LINK.arrow).groupId = group
}

const inkOf = (el: CanvasElement) => /stroke="(#[0-9A-Fa-f]{3,8})"/.exec(el.svgProps?.svgString ?? '')?.[1] ?? null

/**
 * 섹션 높이가 바뀐 뒤 표식을 아래 끝에 다시 붙인다 — 원은 새 끝 LINK.inset 안, 점선은 원 위까지 늘리거나 줄이고 짧으면 숨긴다.
 * 표식이 없는 섹션은 그대로 돌려준다
 */
export function relayoutLink(sec: CanvasSection): CanvasSection {
  const arrow = sec.elements.find((e) => e.name === ARROW_NAME)
  if (!arrow) return sec
  const top = arrowTop(sec.canvas.height)
  const elements = sec.elements.map((e): CanvasElement => {
    if (e === arrow) return { ...e, transform: { ...e.transform, y: top } }
    if (e.name !== LINE_NAME) return e
    const lineH = top - LINK.lineGap - e.transform.y
    const ink = inkOf(e)
    if (lineH < LINK.minLine || !ink) return { ...e, isVisible: false }
    return { ...e, isVisible: true, transform: { ...e.transform, height: lineH }, svgProps: { ...e.svgProps, svgString: lineSvg(lineH, ink) } }
  })
  return { ...sec, elements }
}
