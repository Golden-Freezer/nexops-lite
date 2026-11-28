/**
 * 층 띠 색(적용 K1 T1-85·T2-59) — 섹션 바탕에 같은 강조색 계열을 위에서 아래로 옅음 → 짙음으로 섞는다. 한 계열이라 페이지 유채 수(color-lint)를 늘리지 않는다.
 * 띠마다 글자색은 대비 4.5를 넘는 첫 후보(바탕 글자색 → 잉크 → 짙은 면 글자색)다. 어느 띠라도 후보가 없으면 맨 아래 섞음을 낮춰 다시 맞춘다.
 * 섞는 색은 강조색이 먼저고, 옅은 강조색(ice·blossom·sand 등)이라 첫 띠·이웃 띠 색차가 LAYER_MIN_DELTA_E에 못 미치면 같은 색상의 짙은 강조 글자색(accentText)이다.
 * 둘 다 안 되면 null — 엔진이 그 목록을 그리지 않는다(44컨셉 전수 시험이 W·N·T 바탕·2~5층에서 null이 없음을 지킨다). 순수.
 */

import { contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { mix, type Colors } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import { rgbToLch } from '../internalized/designcut-palette'
import { isDarkYellow } from './color-sets'

/** 맨 위 띠 섞음과 맨 아래 띠 섞음의 후보(앞이 먼저) — 0.46에서 대비가 안 되면 단계 폭을 줄인다 */
export const LAYER_MIX = { top: 0.1, bottoms: [0.46, 0.4, 0.34, 0.28, 0.22] } as const
export const LAYER_MIN_CONTRAST = 4.5
/** 띠가 바탕·이웃 띠와 눈으로 갈리는 색차(CIE76) — 알아챌 수 있는 차이 약 2.3보다 조금 크게 */
export const LAYER_MIN_DELTA_E = 3

export interface LayerInk {
  fill: string
  text: string
  dark: boolean
}

const BLACK: [number, number, number] = [0, 0, 0]
/** 밝기 순서 — 검정과의 대비는 밝을수록 크다 */
const lighter = (a: string, b: string) => contrastRatio(parseColor(a)!, BLACK) > contrastRatio(parseColor(b)!, BLACK)

const labOf = (hex: string) => {
  const { l, c, h } = rgbToLch(parseColor(hex)!)
  const r = (h * Math.PI) / 180
  return [l, c * Math.cos(r), c * Math.sin(r)]
}
export const deltaE = (a: string, b: string) => {
  const [x, y] = [labOf(a), labOf(b)]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

/** 띠 하나 — 바탕 글자색을 먼저 고르고, 안 되면 잉크·짙은 면 글자색. 탁한 노랑 면은 만들지 않는다. dark는 글자가 띠보다 밝다는 뜻 */
function inkAt(surf: { fill: string; text: string }, c: Colors, target: string, t: number): LayerInk | null {
  const fill = mix(surf.fill, target, t)
  if (isDarkYellow(rgbToLch(parseColor(fill)!))) return null
  const text = [surf.text, c.ink, c.onDeep].find((color) => contrastRatio(parseColor(color)!, parseColor(fill)!) >= LAYER_MIN_CONTRAST)
  return text ? { fill, text, dark: lighter(text, fill) } : null
}

/** 섞음 단계 — 한 층이면 가운데 값 하나, 여러 층이면 위 → 아래 같은 간격 */
export const layerSteps = (count: number, bottom: number): number[] =>
  count <= 1 ? [(LAYER_MIX.top + bottom) / 2] : Array.from({ length: count }, (_, i) => LAYER_MIX.top + ((bottom - LAYER_MIX.top) * i) / (count - 1))

/** 한 섞는 색으로 모든 띠가 대비를 넘는 가장 넓은 단계 */
function widest(surf: { fill: string; text: string }, c: Colors, target: string, count: number): LayerInk[] | null {
  for (const bottom of LAYER_MIX.bottoms) {
    const inks = layerSteps(count, bottom).map((t) => inkAt(surf, c, target, t))
    if (inks.every((ink): ink is LayerInk => ink !== null)) return inks
  }
  return null
}

/** 첫 띠가 바탕과, 띠끼리 서로 눈으로 갈리는가 */
const visible = (page: string, inks: readonly LayerInk[]) =>
  deltaE(inks[0].fill, page) >= LAYER_MIN_DELTA_E && inks.slice(1).every((ink, i) => deltaE(ink.fill, inks[i].fill) >= LAYER_MIN_DELTA_E)

/** 층 수만큼 띠 색 — 위가 옅고 아래가 짙다 */
export function layerInks(surf: { fill: string; text: string }, c: Colors, count: number): LayerInk[] | null {
  for (const target of [c.accent, c.accentText]) {
    const inks = widest(surf, c, target, count)
    if (inks && visible(surf.fill, inks)) return inks
  }
  return null
}
