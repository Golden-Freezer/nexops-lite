/**
 * 흰 배경 키잉(누끼 보조, 묶음 4) — B 실험 `scripts/registration/experiments/cutout-trial/key-white.ts`를 제품 모듈로 옮겼다.
 * 아이콘 키잉(usp-icon-alpha)과 달리 상품 안쪽 흰 면을 지키고 가장자리를 부드럽게 한다.
 * - 바탕색 = 테두리 픽셀 채널별 중앙값, 바탕 거리 = 채널 차 최댓값(Chebyshev)
 * - 테두리에서 '분명한 상품이 아닌' 픽셀(거리 < hi)로 이어진 영역만 바탕 후보다(안쪽 흰 면은 이어지지 않아 남는다)
 * - 바탕 후보의 알파 = (거리 − lo) / (hi − lo) 선형, 나머지는 불투명. 반투명 픽셀은 바탕색을 빼서 색을 되돌린다
 * - 테두리가 고르지 않거나 바탕이 밝지 않으면 전제(흰 단색 바탕)가 깨진 것으로 표시한다(applicable — 색조는 보지 않는다)
 * 순수 계산이다(파일·sharp 없음). 웹에서도 돌 수 있지만 고르기 규칙이 isnet을 먼저 보므로 혼자 쓰지 않는다.
 */

export type Rgb = [number, number, number]

export interface KeyResult {
  alpha: Uint8Array
  /** 바탕색 되돌림을 마친 RGB(입력과 같은 길이) */
  rgb: Uint8Array
  background: Rgb
  /** 테두리 픽셀의 바탕 거리 중앙값 — 클수록 바탕이 고르지 않다 */
  borderSpread: number
  /** 흰 단색 바탕 전제가 맞는가(밝기 ≥ 200, 퍼짐 ≤ 18) */
  applicable: boolean
}

const distance = (data: Uint8Array, i: number, bg: Rgb) =>
  Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2]))

function borderPixels(w: number, h: number): number[] {
  const out: number[] = []
  for (let x = 0; x < w; x++) out.push(x, (h - 1) * w + x)
  for (let y = 1; y < h - 1; y++) out.push(y * w, y * w + w - 1)
  return out
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]
}

export function keyWhiteBackground(data: Uint8Array, w: number, h: number): KeyResult {
  const border = borderPixels(w, h)
  const background = [0, 1, 2].map((c) => median(border.map((p) => data[p * 3 + c]))) as Rgb
  const borderSpread = median(border.map((p) => distance(data, p * 3, background)))
  const lo = 10 + borderSpread * 2
  const hi = lo + 30
  const luma = background[0] * 0.299 + background[1] * 0.587 + background[2] * 0.114
  const applicable = luma >= 200 && borderSpread <= 18

  // 테두리에서 거리 < hi 픽셀로 이어진 영역(4-이웃 너비 우선)
  const n = w * h
  const reach = new Uint8Array(n)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0
  for (const p of border) {
    if (!reach[p] && distance(data, p * 3, background) < hi) {
      reach[p] = 1
      queue[tail++] = p
    }
  }
  while (head < tail) {
    const p = queue[head++]
    const x = p % w
    const neighbours = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]
    for (const q of neighbours) {
      if (q < 0 || q >= n || reach[q] || distance(data, q * 3, background) >= hi) continue
      reach[q] = 1
      queue[tail++] = q
    }
  }

  const alpha = new Uint8Array(n)
  const rgb = Uint8Array.from(data)
  for (let p = 0; p < n; p++) {
    if (!reach[p]) {
      alpha[p] = 255
      continue
    }
    const d = distance(data, p * 3, background)
    const a = Math.min(1, Math.max(0, (d - lo) / (hi - lo)))
    alpha[p] = Math.round(a * 255)
    if (a > 0 && a < 1) {
      for (let c = 0; c < 3; c++) {
        const v = background[c] + (data[p * 3 + c] - background[c]) / a
        rgb[p * 3 + c] = Math.min(255, Math.max(0, Math.round(v)))
      }
    }
  }
  return { alpha, rgb, background, borderSpread, applicable }
}
