/**
 * MTD 페이싱 유틸 (Phase 7) — 순수 함수
 */

/** 일별 값 배열 → 누적 배열 ([10, 20, 5] → [10, 30, 35]) */
export function toCumulative(values: number[]): number[] {
  let sum = 0
  return values.map((v) => {
    sum += v
    return sum
  })
}
