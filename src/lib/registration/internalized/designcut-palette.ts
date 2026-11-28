/**
 * 디자인 컷 색면 토큰(D1) — docs/plans/pdp-enrichment/08_DESIGN_CUTS.md §4.1·§4.2, 통합 확정 사항 2(2026-10-28 개정).
 * 원천 사진 측정(photo-palette.ts)이 있으면 제품색·촬영 배경에서, 없으면 카피 단계 확정 팔레트의 primary에서 CIELAB/LCh 색 계산으로
 * 파생한다(결정론).
 * 대비는 WCAG 상대 휘도(검사기와 같은 contrastRatio)로 검증하고 L*를 2씩 조정(최대 8회), 실패하면 기본값으로 폴백한다.
 */

import { contrastRatio, parseColor } from '../editor/utils/mobileReadability'
import type { DesigncutPhoto, DesigncutPlan } from '../pdp-state'

type Rgb = [number, number, number]
interface Lch {
  l: number
  c: number
  h: number
}

const WHITE: Rgb = [255, 255, 255]
const INK_DEFAULT = '#1A1A1A'
/** 제품색으로 볼 최소 채도(08 §4.1-2: C* ≥ 15) — 못 미치면 중립 모드 */
const MIN_PRODUCT_CHROMA = 15
const MAX_ADJUST_STEPS = 8

/**
 * 중립 모드 색상각(08 §4.2) — 카테고리 무드 앵커: 주방·욕실 청록 200, 수납·문구 테라코타 35, 아기·가족·반려 살구 60,
 * 공구·기술 네이비 250. [의견] 표라 시험에서 확정한다. 같은 상품은 항상 같은 색(결정론).
 */
const NEUTRAL_HUE: Record<string, number> = {
  household: 200,
  food: 200,
  stationery: 35,
  packaging: 35,
  fashion: 35,
  beauty: 35,
  pet: 60,
  digital: 250,
}
const NEUTRAL_DEFAULT_HUE = 35

const srgbToLinear = (v: number) => {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const linearToSrgb = (v: number) => {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
  return s * 255
}
// D65 기준 백색
const WX = 0.95047
const WZ = 1.08883
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29)
const finv = (t: number) => (t > 6 / 29 ? t ** 3 : (108 / 841) * (t - 4 / 29))

export function rgbToLch([r, g, b]: Rgb): Lch {
  const [lr, lg, lb] = [r, g, b].map(srgbToLinear)
  const x = (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / WX
  const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
  const z = (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / WZ
  const l = 116 * f(y) - 16
  const a = 500 * (f(x) - f(y))
  const bb = 200 * (f(y) - f(z))
  const h = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360
  return { l, c: Math.hypot(a, bb), h }
}

function lchToRgbRaw({ l, c, h }: Lch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const fy = (l + 16) / 116
  const x = WX * finv(fy + a / 500)
  const y = finv(fy)
  const z = WZ * finv(fy - b / 200)
  const lr = 3.2406 * x - 1.5372 * y - 0.4986 * z
  const lg = -0.9689 * x + 1.8758 * y + 0.0415 * z
  const lb = 0.0557 * x - 0.204 * y + 1.057 * z
  return [lr, lg, lb].map(linearToSrgb) as Rgb
}

/** LCh → hex. sRGB 밖이면 색상각·명도를 지키고 채도만 줄인다 */
export function lchToHex(lch: Lch): string {
  let c = lch.c
  let rgb = lchToRgbRaw({ ...lch, c })
  while (rgb.some((v) => v < -0.5 || v > 255.5) && c > 0) {
    c = Math.max(0, c - 1)
    rgb = lchToRgbRaw({ ...lch, c })
  }
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)))
  return `#${rgb.map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

const contrastWithWhite = (hex: string) => contrastRatio(parseColor(hex)!, WHITE)
const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 흰 바탕(또는 흰 글자)과의 대비가 need 이상이 될 때까지 L*를 2씩 내린다(최대 8회). 실패하면 null */
function darkenUntil(lch: Lch, need: number): string | null {
  for (let i = 0; i <= MAX_ADJUST_STEPS; i++) {
    const hex = lchToHex({ ...lch, l: lch.l - i * 2 })
    if (contrastWithWhite(hex) >= need) return hex
  }
  return null
}

/**
 * 하이키 상품(밝거나 저채도 — 제품 L* 중앙값 ≥ 70, 또는 유채 제품의 C* < 30): 짙은 바탕 상한 20%(08 §4.3 개정),
 * accent 채도 하한 25, deep L* 40 — 밝은 상품 위에 짙은 갈색 면이 깔리지 않게 한다(R1·D P02 오너 지적).
 * 옅은 제품 덩어리(paleProductOf, C* 10 이하)를 제품색으로 쓰는 사진도 저채도 유채 제품이라 하이키다(적용 D5 P2 ②)
 */
export function isHighKeyPhoto(photo: DesigncutPhoto): boolean {
  return photo.productLightness >= 70 || (photo.product !== null && photo.productChroma < 30) || paleProductOf(photo) !== null
}

/**
 * 디자인 컷 제품 컷 바탕 — 사진 촬영 배경, 없으면(카피 팔레트 기록) tint. 제품 컷 생성 배경(pdp-image-tasks)과 편집기 상품 섹션 바탕
 * (세션 B 렌더러)이 같은 값을 써서 컷이 다른 색 사각형(액자)으로 뜨지 않게 한다(2026-10-28)
 */
export function cutBackgroundOf(palette: DesigncutPlan['palette']): string {
  return palette.photoBackground ?? palette.tint
}

/** 촬영 배경을 파스텔 면의 색상각으로 쓸 최소 채도 — 이보다 무채(흰·회 배경)면 제품 색상각 */
const TINTED_BACKGROUND = 8

/** 옅은 제품 덩어리(적용 D5 P2 ②, T1-95) — 면적은 측정 제품색 후보와 같은 하한, 채도는 측정 하한(photo-palette C* 10) 아래 4~10 */
const PALE_MIN_SHARE = 0.12
const PALE_MIN_CHROMA = 4
const PALE_MAX_CHROMA = 10
/** 유채색 배경과 색상각이 이 안이면 배경 비침(photo-palette SEE_THROUGH_HUE와 같다) */
const SEE_THROUGH_HUE = 25

const hueDistance = (x: number, y: number) => Math.min(Math.abs(x - y), 360 - Math.abs(x - y))

/**
 * 측정 제품색이 없을 때(photo.product null) 기록 덩어리(photo.clusters) 가운데 몫 0.12 이상·채도 4~10인 가장 넓은 덩어리의 색.
 * R17-L P03 세이지 그린 브러시(덩어리 #7A8680 몫 0.42·C*6)가 채도 10 아래라 제품색 없음 → 카테고리 앵커 코랄 강조가 됐다.
 * 유채색 배경(C* ≥ 8)과 색상각 25° 안인 덩어리는 배경 비침이라 뺀다. 모든 덩어리가 채도 4 미만(흰·회·검정 상품)이면 null — 지금처럼 중립 모드.
 * 덩어리는 측정이 제품색 후보를 고른 영역(배경 밖 픽셀)의 것이다(photo-palette)
 */
function paleProductOf(photo: DesigncutPhoto): Lch | null {
  if (photo.product !== null) return null
  const background = rgbToLch(parseColor(photo.background) ?? WHITE)
  const tinted = background.c >= TINTED_BACKGROUND
  const candidates = (photo.clusters ?? []).flatMap((cluster) => {
    const rgb = parseColor(cluster.color)
    if (!rgb || cluster.share < PALE_MIN_SHARE) return []
    const lch = rgbToLch(rgb)
    if (lch.c < PALE_MIN_CHROMA || lch.c > PALE_MAX_CHROMA) return []
    if (tinted && hueDistance(lch.h, background.h) <= SEE_THROUGH_HUE) return []
    return [{ lch, share: cluster.share }]
  })
  return candidates.length > 0 ? candidates.reduce((a, b) => (b.share > a.share ? b : a)).lch : null
}

/**
 * 페이지 1세트 팔레트(08 §4.1 표) — accent(그래픽 3:1)·accentText(흰 바탕 글자 4.5:1)·deep(흰 글자 4.5:1)·tint·ink.
 * 강조 글자는 L* 보정으로 4.5:1을 맞춘다(노랑·연두는 올리브 계열이 된다). 보정이 실패하면 ink(08 §4.1-5 — 편집기가 하이라이트 띠).
 * 원천 사진 측정(photo)이 있으면 제품색·촬영 배경에서 파생하고(08 §4.1 원안, 2026-10-28 개정), 없으면 카피 primary에서 파생한다.
 */
export function deriveDesigncutPalette(
  primaryHex: string | undefined,
  category: string | null | undefined,
  photo?: DesigncutPhoto | null
): DesigncutPlan['palette'] {
  if (photo) return derivePhotoPalette(photo, category)
  const primary = parseColor(primaryHex)
  const cp = primary ? rgbToLch(primary) : null
  const mode = cp && cp.c >= MIN_PRODUCT_CHROMA ? 'color' : 'neutral'
  const h = mode === 'color' ? cp!.h : neutralHue(category)
  const chroma = mode === 'color' ? clampNum(cp!.c, 45, 75) : 50
  return { ...tokens(h, chroma, false), tint: lchToHex({ l: 95, c: 11, h }), mode }
}

/**
 * 사진 팔레트 — 색상각은 제품색(없으면 카테고리 앵커, 중립 모드), 파스텔 면은 촬영 배경 계열(반투명 상품에 비치는 배경과 페이지
 * 바탕이 이어진다 — Opus 검토 안). 무채 배경(흰·회)이면 파스텔 면도 제품 색상각. 측정 제품색이 없으면 옅은 제품 덩어리(paleProductOf)를 쓴다.
 */
function derivePhotoPalette(photo: DesigncutPhoto, category: string | null | undefined): DesigncutPlan['palette'] {
  const product = parseColor(photo.product)
  const background = rgbToLch(parseColor(photo.background) ?? WHITE)
  const cp = product ? rgbToLch(product) : paleProductOf(photo)
  const highKey = isHighKeyPhoto(photo)
  const h = cp ? cp.h : neutralHue(category)
  const chroma = cp ? clampNum(cp.c, highKey ? 25 : 45, highKey ? 70 : 75) : 50
  const tint =
    background.c >= TINTED_BACKGROUND
      ? lchToHex({ l: 95, c: clampNum(background.c * 0.6, 6, 14), h: background.h })
      : lchToHex({ l: 95, c: 11, h })
  return {
    ...tokens(h, chroma, highKey),
    tint,
    mode: cp ? 'color' : 'neutral',
    source: 'photo',
    highKey,
    photoBackground: photo.background,
  }
}

const neutralHue = (category: string | null | undefined) => NEUTRAL_HUE[category ?? ''] ?? NEUTRAL_DEFAULT_HUE

function tokens(h: number, chroma: number, highKey: boolean) {
  const accent = darkenUntil({ l: 60, c: chroma, h }, 3) ?? INK_DEFAULT
  const accentText = darkenUntil({ l: 45, c: Math.min(chroma, 60), h }, 4.5)
  const deepChroma = highKey ? clampNum(chroma * 0.55, 15, 30) : clampNum(chroma * 0.55, 25, 40)
  const deep = darkenUntil({ l: highKey ? 40 : 27, c: deepChroma, h }, 4.5) ?? INK_DEFAULT
  const ink = lchToHex({ l: 15, c: 4, h })
  return {
    accent,
    accentText: accentText ?? ink,
    deep,
    ink: contrastWithWhite(ink) >= 4.5 ? ink : INK_DEFAULT,
  }
}
