/**
 * 바탕 리듬(08_DESIGN_CUTS.md §4.3) — 바탕 유형 W·T·N(밝음)·D(짙음)·P(사진)의 교차 규칙과 페이지 전체 배정(동적 계획).
 * 디자인 컷 바탕 배정(D1, designcut-plan.ts)과 편집기 톤 리듬(R3, editor/utils/applyToneRhythm.ts)이 같이 쓴다. 순수 함수.
 */

import type { DesigncutBg } from '../pdp-state'

const LIGHT = new Set<DesigncutBg>(['W', 'T', 'N'])

/** 바탕 교차 규칙(08 §4.3) — 같은 유형 연속 금지, 밝음 연속 ≤2, 강함 연속 ≤2 */
export function fitsRhythm(prev: DesigncutBg[], bg: DesigncutBg): boolean {
  if (prev.at(-1) === bg) return false
  let run = 0
  for (let i = prev.length - 1; i >= 0 && LIGHT.has(prev[i]) === LIGHT.has(bg); i--) run++
  return run < 2
}

export function rhythmViolations(bgs: DesigncutBg[]): number {
  return bgs.filter((bg, i) => !fitsRhythm(bgs.slice(0, i), bg)).length
}

const VIOLATION_COST = 1000
const D_COUNT_COST = 500
/**
 * 짙은 바탕 높이 상한 초과(08 §4.3 개정 2026-10-28) — 강한 제약. 같은 밝기 3연속(600)은 행마다 붙어 쌓이므로 상한 비용이 그 합보다
 * 커야 상한이 지켜진다(verifier: 상한 비용 800이면 피처 컷이 적은 하이키 페이지가 조립 뒤 27~37%). 같은 유형 이웃(1000)보다도 앞선다 —
 * 밝은 상품은 짙은 면을 더 넣기보다 밝은 면이 이어지게 둔다. 지킬 수 없으면(고정 D만으로 넘침) 초과 1px당 1을 더해, 이미 넘친 뒤에도
 * 짙은 면 하나(1,100px 이상)를 더 넣는 비용이 밝음 연속·같은 유형 이웃보다 크게 한다(10px당 1이면 마무리 T8 하나로 넘친 짧은 페이지에
 * D가 더 들어갔다 — verifier 2차, 31~40%)
 */
const DARK_SHARE_COST = 5000
/**
 * 상한을 쓰는 계획에서 같은 밝기 3연속(유형 교차는 지킨 채 길어짐, 주로 밝음)의 비용 — 상한 초과보다 가볍다. 밝은 상품(하이키 20%)은 짙은 면을
 * 하나 더 넣어 연속을 끊기보다 밝은 면이 이어지는 편이 낫다(오너 지적: 짙은 갈색 면). 같은 유형 이웃은 그대로 1000
 */
const CAPPED_LIGHT_RUN_COST = 600

/** 짙은 바탕(D) 높이 상한 — heights는 후보 행과 같은 순서의 섹션 높이(명목), total은 페이지 전체 높이(템플릿 밖 섹션 포함) */
export interface DarkShareCap {
  heights: number[]
  total: number
  maxShare: number
}

/** 바탕 후보 1개 — 비용이 낮을수록 선호 */
export interface RhythmCandidate {
  bg: DesigncutBg
  cost: number
}

/**
 * 바탕 리듬 동적 계획(08 §4.3) — 후보 비용 합 + 교차 규칙 위반 × 1000 + D 개수가 dRange 밖이면 500을 최소화한다.
 * 상태 = (마지막 바탕, 같은 밝기 연속 수, D 개수 상한 4). 디자인 컷 바탕 배정(D1)과 편집기 톤 리듬(R3)이 같이 쓴다.
 * sameTypeCost: 같은 유형 연속에만 더하는 비용 — 두 규칙을 다 지킬 수 없을 때 같은 색 이웃(더 눈에 띄는 실패)을 먼저 피한다
 * (편집기 톤 리듬). D1은 0(기존 동작).
 * darkCap: D 높이 합이 total × maxShare를 넘으면 5000 + 초과 1px당 1을 더하고(상태에 D 높이 합을 넣는다), 같은 밝기 3연속은
 * 600으로 낮춘다.
 * 없으면 기존 동작 그대로.
 */
export function solveRhythm(
  candidates: RhythmCandidate[][],
  dRange: [number, number] | null,
  sameTypeCost = 0,
  darkCap: DarkShareCap | null = null
): DesigncutBg[] {
  interface Cell {
    cost: number
    bg: DesigncutBg
    from: string | null
  }
  const layers: Array<Map<string, Cell>> = []
  candidates.forEach((cands, i) => {
    const prevLayer: Array<[string | null, Cell | null]> = i === 0 ? [[null, null]] : [...layers[i - 1]]
    const layer = new Map<string, Cell>()
    for (const [prevKey, prev] of prevLayer) {
      const [lastBg, runStr, dStr, dhStr] = prevKey ? prevKey.split('|') : [null, '0', '0', '0']
      for (const cand of cands) {
        const sameClass = lastBg !== null && LIGHT.has(lastBg as DesigncutBg) === LIGHT.has(cand.bg)
        const run = sameClass ? Number(runStr) + 1 : 1
        const sameType = cand.bg === lastBg
        const longRun = !sameType && run > 2
        const violationCost = sameType || (longRun && !darkCap) ? VIOLATION_COST : longRun ? CAPPED_LIGHT_RUN_COST : 0
        const d = Math.min(4, Number(dStr) + (cand.bg === 'D' ? 1 : 0))
        const dh = Number(dhStr) + (darkCap && cand.bg === 'D' ? (darkCap.heights[i] ?? 0) : 0)
        const key = `${cand.bg}|${Math.min(run, 3)}|${d}|${dh}`
        const cost = (prev?.cost ?? 0) + violationCost + (cand.bg === lastBg ? sameTypeCost : 0) + cand.cost
        const seen = layer.get(key)
        if (!seen || cost < seen.cost) layer.set(key, { cost, bg: cand.bg, from: prevKey })
      }
    }
    layers.push(layer)
  })
  if (layers.length === 0) return []

  let bestKey: string | null = null
  let best = Infinity
  for (const [key, cell] of layers[layers.length - 1]) {
    const [, , dStr, dhStr] = key.split('|')
    const d = Number(dStr)
    // 넘으면 5000 + 초과 높이 1px당 1 — 상한을 지킬 수 없을 때도 덜 넘는 배정(낮은 섹션을 짙게)을 고른다
    const excess = darkCap ? Number(dhStr) - darkCap.total * darkCap.maxShare : 0
    const total =
      cell.cost +
      (dRange && (d < dRange[0] || d > dRange[1]) ? D_COUNT_COST : 0) +
      (excess > 0 ? DARK_SHARE_COST + Math.ceil(excess) : 0)
    if (total < best) {
      best = total
      bestKey = key
    }
  }
  const bgs: DesigncutBg[] = []
  for (let i = layers.length - 1, key = bestKey; i >= 0 && key; i--) {
    const cell = layers[i].get(key)!
    bgs.unshift(cell.bg)
    key = cell.from
  }
  return bgs
}
