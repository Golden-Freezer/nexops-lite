/**
 * 곡선 판 가장자리(적용 K1 T1-33·T2-46, 연구 A3 #14·후보12·L5) — 풀폭 띠의 한쪽 가장자리를 곡선·사선으로 보이게 하는 덮개다.
 * 띠 안쪽 여백 안에 섹션 바탕색 SVG를 얹어 띠 모서리를 깎는다. 띠 높이·서명·뼈대는 그대로다(덮개는 띠 상자 식구라 글이 늘면 함께 내려간다).
 * 덮개 색은 그 쪽에 맞닿은 바탕이어야 해서, 같은 섹션 안 간격 쪽에만 쓴다 — 섹션 끝(이웃 섹션과 맞닿음)이면 이웃 바탕을 몰라 곧은 가장자리로 둔다.
 * 순수.
 */

import type { PanelEdge } from './template-types'

/** 덮개 요소 이름 — 장식(annotation-)이 아니라 띠의 모양이라 M7 장식 수에 들지 않는다 */
export const PANEL_EDGE_NAME = 'designcut-panel-edge'
/**
 * 깎는 깊이 — 띠 안쪽 여백 120에서 글까지 56이 남는다(린트: 여백 − 깊이 ≥ minClear).
 * overhang은 덮개가 띠 밖 간격 쪽으로 내미는 폭이다 — 덮개 끝이 띠 끝과 같은 줄이면 폰 뷰어(CSS 배율)·내보내기(780)에서 두 경계가 함께 흐려져
 * 띠 색이 가는 실선으로 비친다(render-check 41459312539). 밖으로 내밀면 띠 경계 줄이 덮개 안쪽이라 꽉 덮인다. 리플로는 내민 식구를 띠 높이에서 뺀다(overhang)
 */
export const PANEL_EDGE = { depth: 64, minClear: 48, overhang: 4 } as const

/** 경로를 SVG 상자 밖까지 그리는 폭 — 상자 끝 줄의 흐림까지 덮는다(SVG는 제 상자에서 잘린다) */
const BLEED = 4

/**
 * 아래쪽 덮개 경로(띠 아래 가장자리) — 덮개는 곡선 아래를 칠한다. arc는 가운데가 아래로 부푼 띠, slant는 왼쪽이 높은 사선, wave는 한 번 오르내리는 물결.
 * 곡선은 0~d, 그 아래는 띠 밖 내민 몫(h − d)까지 칠하고 세 변(좌·우·아래)은 상자 밖 BLEED까지 그린다. 위쪽은 이 경로를 위아래로 뒤집는다
 */
function bottomPath(shape: PanelEdge['shape'], w: number, d: number, h: number): string {
  const close = `L${w + BLEED} ${shape === 'wave' ? d / 2 : shape === 'slant' ? d : 0}V${h + BLEED}H${-BLEED}V${shape === 'wave' ? d / 2 : 0}Z`
  if (shape === 'slant') return `M${-BLEED} 0L0 0L${w} ${d}${close}`
  if (shape === 'wave') {
    const h = d / 2
    return `M${-BLEED} ${h}L0 ${h}C${w / 6} 0 ${w / 3} 0 ${w / 2} ${h}S${(w * 5) / 6} ${d} ${w} ${h}${close}`
  }
  return `M${-BLEED} 0L0 0Q${w / 2} ${d * 2} ${w} 0${close}`
}

/** 덮개 요소 상자 — 띠 안쪽 깊이 + 띠 밖 내민 몫. 위쪽은 띠 위 끝보다 내민 만큼 위에서 시작한다 */
export function panelEdgeBox(side: PanelEdge['side'], band: { y: number; h: number }): { y: number; h: number } {
  const h = PANEL_EDGE.depth + PANEL_EDGE.overhang
  return { y: side === 'top' ? band.y - PANEL_EDGE.overhang : band.y + band.h - PANEL_EDGE.depth, h }
}

/** 덮개 SVG — 요소 상자(폭 w·높이 = 깊이 + 내민 몫)에 늘여 그린다. color는 맞닿은 바탕색 */
export function panelEdgeSvg(edge: PanelEdge, color: string, w: number): string {
  const d = PANEL_EDGE.depth
  const h = d + PANEL_EDGE.overhang
  const flip = edge.side === 'top' ? ` transform="translate(0 ${h}) scale(1 -1)"` : ''
  return (
    `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%" height="100%" overflow="hidden" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="${bottomPath(edge.shape, w, d, h)}" fill="${color}"${flip}/></svg>`
  )
}
