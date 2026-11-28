/**
 * 원천 사진 색 측정(08_DESIGN_CUTS.md §4.1 원안, 개정 2026-10-28) — 디자인 컷 팔레트가 상품마다 자기 사진에서 색을 얻게 한다.
 * 가장자리 링의 중앙값 색을 촬영 배경으로 보고(투명 배경이면 알파만) 배경과 가까운 픽셀을 뺀 뒤, 남은 픽셀을 CIELAB k-means로
 * 묶어 면적이 크고 채도가 있는 군집을 제품색으로 고른다. 순수 함수 — 디코딩·축소는 호출자(sharp) 몫이고 같은 픽셀이면 같은 결과다.
 */

import { lchToHex, rgbToLch } from './designcut-palette'
import type { DesigncutPhoto } from '../pdp-state'

interface Lab {
  l: number
  a: number
  b: number
}

/** 가장자리 링 두께(긴 변 대비) — 촬영 배경 표본 */
const RING = 0.08
/** 배경과 같은 색으로 볼 거리(ΔE76, 08 §4.1) */
const BG_DELTA_E = 10
/** 링 픽셀의 절반 이상이 이 알파 미만이면 투명 배경 */
const TRANSPARENT_ALPHA = 128
const K = 5
const ITERATIONS = 12
/** 제품 픽셀이 이보다 적으면(배경뿐인 사진) 측정 실패 */
const MIN_PRODUCT_SHARE = 0.05
/** 제품색 후보 군집 — 제품 픽셀 중 면적·채도 하한(08 §4.1은 12%·C*15). 반투명·저채도 상품(세이지 등)을 위해 채도 하한을 낮췄다 */
const MIN_CLUSTER_SHARE = 0.12
const MIN_PRODUCT_CHROMA = 10
/**
 * 배경 비침 — 유채색 배경(C* ≥ 8)과 색상각이 25° 안이고 채도가 배경 + 15 이하인 군집은 반투명 제품·그림자에 비친 배경으로 보고
 * 제품색 후보에서 뺀다(R1 P02 반투명 파우치: 분홍 배경이 비친 군집 h30이 금색 끈 h79보다 넓었다)
 */
const TINTED_BG_CHROMA = 8
const SEE_THROUGH_HUE = 25
const SEE_THROUGH_EXTRA_CHROMA = 15

const toLab = (r: number, g: number, b: number): Lab => {
  const { l, c, h } = rgbToLch([r, g, b])
  const rad = (h * Math.PI) / 180
  return { l, a: c * Math.cos(rad), b: c * Math.sin(rad) }
}
const chromaOf = (p: Lab) => Math.hypot(p.a, p.b)
const hueOf = (p: Lab) => ((Math.atan2(p.b, p.a) * 180) / Math.PI + 360) % 360
const dist2 = (p: Lab, q: Lab) => (p.l - q.l) ** 2 + (p.a - q.a) ** 2 + (p.b - q.b) ** 2
const hexOf = (p: Lab) => lchToHex({ l: p.l, c: chromaOf(p), h: hueOf(p) })
const round = (v: number, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits
const hueDistance = (x: number, y: number) => Math.min(Math.abs(x - y), 360 - Math.abs(x - y))

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** 결정론 k-means — 시작점은 최대 최소거리(가장 먼 점) 방식, 무작위 없음 */
function kmeans(points: Lab[], k: number): Array<{ center: Lab; size: number }> {
  const mean = (list: Lab[]): Lab => ({
    l: list.reduce((s, p) => s + p.l, 0) / list.length,
    a: list.reduce((s, p) => s + p.a, 0) / list.length,
    b: list.reduce((s, p) => s + p.b, 0) / list.length,
  })
  const all = mean(points)
  let centers = [points.reduce((best, p) => (dist2(p, all) < dist2(best, all) ? p : best))]
  while (centers.length < Math.min(k, points.length)) {
    const far = points.reduce(
      (best, p) => {
        const d = Math.min(...centers.map((c) => dist2(p, c)))
        return d > best.d ? { p, d } : best
      },
      { p: points[0], d: -1 }
    )
    if (far.d <= 0) break
    centers.push(far.p)
  }
  let assign: number[] = []
  for (let iter = 0; iter < ITERATIONS; iter++) {
    assign = points.map((p) => centers.reduce((best, c, i) => (dist2(p, c) < dist2(p, centers[best]) ? i : best), 0))
    const next = centers.map((c, i) => {
      const members = points.filter((_, j) => assign[j] === i)
      return members.length > 0 ? mean(members) : c
    })
    const moved = next.some((c, i) => dist2(c, centers[i]) > 0.01)
    centers = next
    if (!moved) break
  }
  return centers.map((center, i) => ({ center, size: assign.filter((a) => a === i).length }))
}

/**
 * RGBA 픽셀(행 우선, 4채널)에서 촬영 배경색·제품색을 잰다. 픽셀이 너무 적거나 제품 픽셀이 없으면 null.
 * 호출자는 긴 변 64px 안팎으로 줄여 넘긴다(군집 결과는 축소 크기에 둔감하다).
 */
export function measurePhotoColors(rgba: Uint8Array, width: number, height: number): DesigncutPhoto | null {
  if (width < 8 || height < 8 || rgba.length < width * height * 4) return null
  const ring = Math.max(1, Math.round(Math.max(width, height) * RING))
  const at = (x: number, y: number) => (y * width + x) * 4
  const ringIdx: number[] = []
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (x < ring || y < ring || x >= width - ring || y >= height - ring) ringIdx.push(at(x, y))

  const transparent = ringIdx.filter((i) => rgba[i + 3] < TRANSPARENT_ALPHA).length * 2 >= ringIdx.length
  const ringLab = ringIdx
    .filter((i) => rgba[i + 3] >= TRANSPARENT_ALPHA)
    .map((i) => toLab(rgba[i], rgba[i + 1], rgba[i + 2]))
  const bg: Lab =
    transparent || ringLab.length === 0
      ? { l: 100, a: 0, b: 0 }
      : { l: median(ringLab.map((p) => p.l)), a: median(ringLab.map((p) => p.a)), b: median(ringLab.map((p) => p.b)) }

  const opaque: Lab[] = []
  for (let i = 0; i < width * height * 4; i += 4) {
    if (rgba[i + 3] < TRANSPARENT_ALPHA) continue
    opaque.push(toLab(rgba[i], rgba[i + 1], rgba[i + 2]))
  }
  const product = opaque.filter((p) => dist2(p, bg) >= BG_DELTA_E ** 2)
  const productShare = opaque.length > 0 ? product.length / opaque.length : 0
  if (productShare < MIN_PRODUCT_SHARE) return null

  const clusters = kmeans(product, K)
    .filter((c) => c.size > 0)
    .map((c) => ({ ...c, share: c.size / product.length, chroma: chromaOf(c.center) }))
    .sort((x, y) => y.size - x.size)
  const bgChroma = chromaOf(bg)
  const seeThrough = (c: Lab) =>
    bgChroma >= TINTED_BG_CHROMA &&
    hueDistance(hueOf(c), hueOf(bg)) <= SEE_THROUGH_HUE &&
    chromaOf(c) <= bgChroma + SEE_THROUGH_EXTRA_CHROMA
  const main =
    clusters.find((c) => c.share >= MIN_CLUSTER_SHARE && c.chroma >= MIN_PRODUCT_CHROMA && !seeThrough(c.center)) ??
    null
  const productL = median(product.map((p) => p.l))

  return {
    version: 1,
    background: hexOf(bg),
    backgroundTransparent: transparent,
    product: main ? hexOf(main.center) : null,
    productShare: round(productShare, 3),
    productLightness: round(productL),
    productChroma: main ? round(main.chroma) : 0,
    clusters: clusters.map((c) => ({ color: hexOf(c.center), share: round(c.share, 3) })),
  }
}
