/**
 * 누끼 고르기·알파 게이트(묶음 4) — isnet 마스크와 흰 배경 키잉 결과에서 하나를 고른다. 순수 계산이다.
 * 규칙은 B 보고서 §4-4 가설 그대로다(CUTOUT_SELECT_RULE): isnet 반투명 비율 ≤ 0.15면 isnet, 아니면 키잉이 전제에 맞고 불투명
 * 비율이 isnet의 2배 이상일 때 키잉, 둘 다 아니면 생성 경로. 고른 결과는 NEXFIT 알파 커버리지(불투명 5~90%)도 통과해야 한다.
 */

import { ALPHA_COVERAGE_MAX, ALPHA_COVERAGE_MIN, ALPHA_OPAQUE_CUTOFF, CUTOUT_SELECT_RULE } from './composite-types'
import type { KeyResult } from './key-white'

/** B 실험 alphaStats와 같은 정의 — 불투명(≥250)·투명(≤5)·반투명(그 사이) 비율 */
export function alphaStats(alpha: Uint8Array): { opaque: number; clear: number; soft: number } {
  let opaque = 0
  let clear = 0
  for (const a of alpha) {
    if (a >= 250) opaque++
    else if (a <= 5) clear++
  }
  const n = alpha.length || 1
  return { opaque: opaque / n, clear: clear / n, soft: (alpha.length - opaque - clear) / n }
}

/** 불투명 비율 — NEXFIT alpha_coverage(알파 128 이상) */
export function alphaCoverage(alpha: Uint8Array): number {
  if (alpha.length === 0) return 0
  let count = 0
  for (const a of alpha) if (a >= ALPHA_OPAQUE_CUTOFF) count++
  return count / alpha.length
}

/** 불투명(알파 128 이상) 영역의 경계 상자 — 0~1 비율. 없으면 null */
export function alphaBBox(
  alpha: Uint8Array,
  w: number,
  h: number
): { x: number; y: number; w: number; h: number } | null {
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] < ALPHA_OPAQUE_CUTOFF) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  return { x: minX / w, y: minY / h, w: (maxX - minX + 1) / w, h: (maxY - minY + 1) / h }
}

export type CutoutChoice =
  | {
      ok: true
      method: 'isnet' | 'key'
      alpha: Uint8Array
      /** 키잉은 바탕색을 되돌린 RGB, isnet은 원본 RGB */
      rgb: Uint8Array
      metrics: { coverage: number; isnetSoft: number; isnetOpaque: number; keyOpaque: number; keyApplicable: boolean }
    }
  | {
      ok: false
      metrics: { coverage?: number; isnetSoft: number; isnetOpaque: number; keyOpaque: number; keyApplicable: boolean }
    }

export function selectCutout(input: { rgb: Uint8Array; isnetAlpha: Uint8Array; key: KeyResult }): CutoutChoice {
  const isnet = alphaStats(input.isnetAlpha)
  const key = alphaStats(input.key.alpha)
  const base = {
    isnetSoft: isnet.soft,
    isnetOpaque: isnet.opaque,
    keyOpaque: key.opaque,
    keyApplicable: input.key.applicable,
  }
  let chosen: { method: 'isnet' | 'key'; alpha: Uint8Array; rgb: Uint8Array } | null = null
  if (isnet.soft <= CUTOUT_SELECT_RULE.isnetSoftMax) {
    chosen = { method: 'isnet', alpha: input.isnetAlpha, rgb: input.rgb }
  } else if (input.key.applicable && key.opaque >= isnet.opaque * CUTOUT_SELECT_RULE.keyOpaqueRatioMin) {
    chosen = { method: 'key', alpha: input.key.alpha, rgb: input.key.rgb }
  }
  if (!chosen) return { ok: false, metrics: base }
  const coverage = alphaCoverage(chosen.alpha)
  if (coverage < ALPHA_COVERAGE_MIN || coverage > ALPHA_COVERAGE_MAX)
    return { ok: false, metrics: { ...base, coverage } }
  return { ok: true, ...chosen, metrics: { ...base, coverage } }
}
