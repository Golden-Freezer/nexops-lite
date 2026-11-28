/**
 * 바탕 리듬 짙은 바탕 높이 상한(08 §4.3 개정 2026-10-28) — 선택 인자. 없으면 기존 동작 그대로(편집기 톤 리듬 R3 공용).
 */

import { describe, expect, it } from 'vitest'
import { rhythmViolations, solveRhythm, type RhythmCandidate } from './bg-rhythm'
import { designcutDRange } from './designcut-plan'
import type { DesigncutBg } from '../pdp-state'

const fixed = (bg: DesigncutBg): RhythmCandidate[] => [{ bg, cost: 0 }]
const pick = (...bgs: DesigncutBg[]): RhythmCandidate[] => bgs.map((bg, rank) => ({ bg, cost: rank }))
const share = (bgs: DesigncutBg[], heights: number[]) =>
  bgs.reduce((s, bg, i) => s + (bg === 'D' ? heights[i] : 0), 0) / heights.reduce((a, b) => a + b, 0)

// R1 P03 디자인 컷 순서: T1(P) T2 T4 T3a T3b(P) T3a T3b(P) T8(D) — 명목 높이
const P03 = [
  fixed('P'),
  pick('T'),
  pick('W', 'T', 'N', 'D'),
  pick('W', 'D', 'T', 'N'),
  fixed('P'),
  pick('T', 'W', 'D', 'N'),
  fixed('P'),
  fixed('D'),
]
const P03_HEIGHTS = [1300, 1270, 1100, 1450, 1200, 1450, 1200, 1290]

describe('solveRhythm — 짙은 바탕 높이 상한', () => {
  it('상한이 없으면 기존 해 — 밝음 3연속을 D로 끊는다(R1 P03 순서의 기존 배정)', () => {
    const before = solveRhythm(P03, null)
    expect(before).toEqual(['P', 'T', 'W', 'D', 'P', 'T', 'P', 'D'])
    expect(rhythmViolations(before)).toBe(0)
  })

  it('하이키 20%: D를 하나만(마무리) 두고, 밝음 3연속(유형 교차는 지킴)을 받아들인다', () => {
    const capped = solveRhythm(P03, null, 0, { heights: P03_HEIGHTS, total: 10260, maxShare: 0.2 })
    expect(share(capped, P03_HEIGHTS)).toBeLessThanOrEqual(0.2)
    expect(capped.filter((bg) => bg === 'D')).toEqual(['D'])
    // 같은 유형 이웃은 여전히 없다
    expect(capped.every((bg, i) => i === 0 || bg !== capped[i - 1])).toBe(true)
  })

  it('30%: 상한 안에서는 D 개수 범위(2~3)를 지킨다', () => {
    const rows = [...P03, pick('W', 'T')]
    const heights = [...P03_HEIGHTS, 1100]
    const capped = solveRhythm(rows, [2, 3], 0, { heights, total: 11360, maxShare: 0.3 })
    expect(capped.filter((bg) => bg === 'D').length).toBe(2)
    expect(share(capped, heights)).toBeLessThanOrEqual(0.3)
  })

  it('상한은 같은 유형 이웃보다 무겁다 — 밝은 상품은 짙은 면을 더 넣기보다 W→W를 받아들인다', () => {
    const rows = [pick('W'), pick('W', 'D'), pick('W')]
    const capped = solveRhythm(rows, null, 0, { heights: [1000, 1000, 1000], total: 3000, maxShare: 0.1 })
    expect(capped).toEqual(['W', 'W', 'W'])
    // 상한이 없으면 기존처럼 D로 끊는다
    expect(solveRhythm(rows, null)).toEqual(['W', 'D', 'W'])
  })

  // 피처 컷 없는 하이키 페이지 T1·T2·T4·T5·T8 — 계획은 하이키 상한 20% × 여유 0.9 = 0.18로 푼다(verifier B1)
  const SHORT = [fixed('P'), pick('T'), pick('W', 'T', 'N', 'D'), pick('W', 'T', 'N', 'D'), fixed('D')]
  const SHORT_HEIGHTS = [1300, 1270, 1100, 1900, 1290]

  it('밝음 연속이 여러 번 쌓여도 상한을 넘기지 않는다(상한 0.2 — 마무리 D 하나로 지킬 수 있는 경우)', () => {
    const capped = solveRhythm(SHORT, null, 0, { heights: SHORT_HEIGHTS, total: 6860, maxShare: 0.2 })
    expect(capped.filter((bg) => bg === 'D')).toEqual(['D'])
    expect(share(capped, SHORT_HEIGHTS)).toBeLessThanOrEqual(0.2)
  })

  it('마무리 D 하나만으로 이미 넘치면(실제 계획 값 0.18) 짙은 면을 더 넣지 않는다 — 넘친 뒤 비례항이 밝음 연속보다 무겁다(verifier 2차)', () => {
    const capped = solveRhythm(SHORT, null, 0, { heights: SHORT_HEIGHTS, total: 6860, maxShare: 0.18 })
    expect(capped).toEqual(['P', 'T', 'W', 'T', 'D'])
  })

  it('하이키 긴 페이지(T1·T3a×6·T6·T4·T8): D 개수 하한이 1이라 마무리 앞을 짙게 칠하지 않는다 — D→D 이웃 없음(verifier 3차)', () => {
    const point = (n: number) => {
      const options: DesigncutBg[] = ['W', 'D', 'T']
      const rotated = [...options.slice(n % 3), ...options.slice(0, n % 3)]
      return [...rotated.map((bg, rank) => ({ bg, cost: rank })), { bg: 'N' as const, cost: 10 }]
    }
    const rows = [
      fixed('P'),
      ...[0, 1, 2, 3, 4, 5].map(point),
      pick('N', 'W', 'T', 'D'),
      pick('W', 'T', 'N', 'D'),
      fixed('D'),
    ]
    const heights = [1300, 1450, 1450, 1450, 1450, 1450, 1450, 1320, 1100, 1290]
    const total = heights.reduce((a, b) => a + b, 0)
    const solve = (highKey: boolean) =>
      solveRhythm(rows, designcutDRange(rows.length, highKey), 0, { heights, total, maxShare: 0.18 })
    const bgs = solve(true)
    expect(bgs.every((bg, i) => i === 0 || bg !== bgs[i - 1])).toBe(true)
    expect(bgs.filter((bg) => bg === 'D')).toEqual(['D'])
    expect(designcutDRange(rows.length, false)).toEqual([2, 3])
    expect(designcutDRange(8, true)).toBeNull()
  })

  it('지킬 수 없으면(고정 D만으로 넘침) 덜 넘는 배정 — 짙은 면을 더 넣지 않는다', () => {
    const rows = [pick('W', 'D'), fixed('D')]
    const capped = solveRhythm(rows, null, 0, { heights: [1000, 1290], total: 2290, maxShare: 0.2 })
    expect(capped).toEqual(['W', 'D'])
  })
})
