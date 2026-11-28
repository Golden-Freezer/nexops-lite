/**
 * 띠 계획(순수 함수, 브라우저·서버 공용) — 서버 띠 자르기(reference-strips, sharp)와 화면 띠 자르기(reference-browser, canvas)가
 * 같은 규칙을 쓴다: 높이 1,400px, 80px 겹침, 16장 넘으면 처음·끝을 포함해 균등 표집. 마지막 띠는 페이지 끝에 맞춘다.
 */

import { REFERENCE_LIMITS } from './reference-types'

export interface StripPlan {
  top: number
  height: number
}

export function planStrips(
  pageHeight: number,
  opts: { stripHeight: number; overlap: number; maxStrips: number } = {
    stripHeight: REFERENCE_LIMITS.stripHeight,
    overlap: REFERENCE_LIMITS.stripOverlap,
    maxStrips: REFERENCE_LIMITS.maxStrips,
  }
): { strips: StripPlan[]; sampled: boolean } {
  const h = Math.max(1, Math.floor(pageHeight))
  if (h <= opts.stripHeight) return { strips: [{ top: 0, height: h }], sampled: false }
  const step = opts.stripHeight - opts.overlap
  const lastTop = h - opts.stripHeight
  const count = Math.ceil(lastTop / step) + 1
  const make = (top: number) => ({ top: Math.round(top), height: opts.stripHeight })
  if (count <= opts.maxStrips) {
    return { strips: Array.from({ length: count }, (_, i) => make(Math.min(i * step, lastTop))), sampled: false }
  }
  const gap = lastTop / (opts.maxStrips - 1)
  return { strips: Array.from({ length: opts.maxStrips }, (_, i) => make(i * gap)), sampled: true }
}

/** 띠 위치(%) — 소수 첫째 자리 */
export function stripPercent(top: number, height: number, pageHeight: number): { start: number; end: number } {
  const round1 = (v: number) => Math.round(v * 10) / 10
  return { start: round1((top / pageHeight) * 100), end: round1(((top + height) / pageHeight) * 100) }
}
