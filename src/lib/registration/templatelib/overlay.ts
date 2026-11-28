/**
 * 사진 위 글(image.overlay)의 막과 판정 — 사진 색을 재는 글자 자리 측정은 K1 전에 못 쓰므로, 사진이 어떤 색이어도 대비가 나오는 가장 옅은 막을 색 조합에서 계산한다.
 * 짙은 면이 없는 컨셉은 deep이 옅고 onDeep이 어두운 글자다(color-sets). 그래서 '막은 짙다'고 가정하지 않고 흰 사진·검은 사진 양쪽으로 잰다. 순수·결정론.
 * 렌더한 결과는 render-check editor:kline-seeds가 글자를 감춘 390 캡처로 바탕 화소를 재서 같은 4.5로 본다(measureBackdrop, T1-30).
 */

import type { CanvasElement } from '@/lib/registration/editor/types/canvas'
import { contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { W, WHITE, mix, rgba, type Colors } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import { luminanceContrast, rgbLuminance } from '@/lib/registration/internalized/hero-copy-zone'
import type { ImageOverlay, TemplateSectionId } from './template-types'

/** 큰 제목도 4.5로 잰다(M2의 큰 글자 3보다 높다) — 사진 위는 글자 뒤 색이 한 가지가 아니다 */
export const OVERLAY_MIN_CONTRAST = 4.5
/** 사진을 가리는 막의 상한 — 최악 사진 높이 대비 */
export const OVERLAY_SCRIM_MAX = 0.6
/** 쓸 자리(A4 7절). POINT 머리·표·후기에는 쓰지 않는다 */
export const OVERLAY_SECTIONS: readonly TemplateSectionId[] = ['hook_3step', 'key_message', 'concept_desc', 'main_cut', 'cta', 'event_offer']
export const SCRIM_NAME = 'designcut-scrim'
export const SCRIM_FILM_NAME = 'designcut-scrim-film'
/** 막 경계의 흐림 띠 높이 — 막 농도가 0.6~0.75라 곧은 경계는 제품·얼굴을 칼로 자른 듯 보인다(render-check 41332735083) */
export const SCRIM_FADE_H = 200
const BLACK = '#000000'
/** 합성색의 밝기는 사진 밝기에 비례해 움직이므로 양 끝이 최악이다(글자가 막보다 확실히 밝거나 어두울 때). 시험이 중간 색까지 잰다 */
const PHOTO_EXTREMES = [WHITE, BLACK]
const ALPHA_STEPS = [45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100].map((p) => p / 100)

export interface OverlayFilm {
  /** 막을 한 겹 색 값으로 쓴 것 — 합성 대비 계산용 */
  fill: string
  /** 막의 불투명 색 */
  color: string
  alpha: number
  text: string
  /** 대비가 가장 낮은 사진 위 합성색 — 엔진의 글자색 계산이 바탕으로 쓴다 */
  worst: string
  /** 글자가 막보다 밝다 */
  dark: boolean
  contrast: number
}

const rgb = (color: string): [number, number, number] => parseColor(color) ?? [0, 0, 0]
const contrastOf = (a: string, b: string) => contrastRatio(rgb(a), rgb(b))

/** 흰·검은 사진 양쪽에서 대비 4.5가 나오는 가장 옅은 막. 색 조합이 글자·막 대비를 보장하므로(color-sets) 불투명에서는 반드시 넘는다 */
export function overlayFilm(ink: ImageOverlay['ink'], c: Colors): OverlayFilm {
  const film = ink === 'light' ? c.deep : c.base
  const text = ink === 'light' ? c.onDeep : c.heading
  const worstAt = (alpha: number) =>
    PHOTO_EXTREMES.map((photo) => mix(photo, film, alpha))
      .map((color) => ({ color, contrast: contrastOf(text, color) }))
      .sort((x, y) => x.contrast - y.contrast)[0]
  const alpha = ALPHA_STEPS.find((a) => worstAt(a).contrast >= OVERLAY_MIN_CONTRAST) ?? 1
  const worst = worstAt(alpha)
  return { fill: rgba(film, alpha), color: film, alpha, text, worst: worst.color, dark: contrastOf(text, BLACK) > contrastOf(worst.color, BLACK), contrast: worst.contrast }
}

/**
 * 막 + 흐림 띠를 한 요소로 — 글자 뒤(solid)는 같은 농도, 그 밖(fade)은 사진으로 녹는다. 도형과 띠를 따로 그리면 폰 축척에서 둘이 따로 픽셀에 맞춰져
 * 한 줄 틈이 생긴다(render-check 41333705345, 행 평균 208 → 180 → 205). 겹쳐 놓으면 내보내기(2배)에서 두 겹 줄이 된다
 */
export function scrimFilmSvg(film: Pick<OverlayFilm, 'color' | 'alpha'>, id: string, solid: number, fade: number, direction: 'down' | 'up'): string {
  const height = solid + fade
  const share = Math.round((solid / height) * 10000) / 10000
  const stop = (offset: number, opacity: number) => `<stop offset="${offset}" stop-color="${film.color}" stop-opacity="${opacity}"/>`
  const stops = direction === 'down' ? [stop(0, film.alpha), stop(share, film.alpha), stop(1, 0)] : [stop(0, 0), stop(1 - share, film.alpha), stop(1, film.alpha)]
  return (
    `<svg viewBox="0 0 ${W} ${height}" preserveAspectRatio="none" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.join('')}</linearGradient></defs>` +
    `<rect width="${W}" height="${height}" fill="url(#${id})"/></svg>`
  )
}

export interface BackdropMeasure {
  /** 잰 화소 수 */
  pixels: number
  /** 글자색과 바탕 화소 사이 가장 낮은 대비(WCAG 비, 소수 둘째 자리) — 글자색이 여럿이면 그중 가장 낮은 것 */
  min: number
  pass: boolean
}

/**
 * 렌더한 사진 위 글의 바탕 대비(T1-30) — 글자를 감춘 캡처의 글 상자 화소(raw, channels 3·4)와 글자색으로 잰다. 막은 최악 사진(흰·검정) 계산이라
 * 실제 사진·축척·압축에서도 그 값이 나오는지 여기서 본다. 가장 낮은 화소 대비가 4.5 미만이면 실패다. 화소가 없거나 글자색을 못 읽으면 null.
 */
export function measureBackdrop(raw: Uint8Array, channels: number, inks: readonly string[]): BackdropMeasure | null {
  const inkLuminances = inks.map(parseColor).flatMap((rgb) => (rgb ? [rgbLuminance(...rgb)] : []))
  const pixels = channels >= 3 ? Math.floor(raw.length / channels) : 0
  if (pixels === 0 || inkLuminances.length === 0 || inkLuminances.length !== inks.length) return null
  let min = Infinity
  for (let i = 0; i < pixels; i++) {
    const at = i * channels
    const backdrop = rgbLuminance(raw[at], raw[at + 1], raw[at + 2])
    for (const ink of inkLuminances) min = Math.min(min, luminanceContrast(ink, backdrop))
  }
  return { pixels, min: Math.floor(min * 100) / 100, pass: min >= OVERLAY_MIN_CONTRAST }
}

const inside = (a: CanvasElement, b: CanvasElement) =>
  a.transform.x >= b.transform.x &&
  a.transform.x + a.transform.width <= b.transform.x + b.transform.width &&
  a.transform.y >= b.transform.y &&
  a.transform.y + a.transform.height <= b.transform.y + b.transform.height

/** 스크림 위에 온전히 얹힌 글자 — 사진과 겹쳐도 결함이 아닌 글은 이것뿐이다. 스크림에 걸치거나 스크림보다 아래 z면 들지 않는다 */
export function textsOnScrim(elements: readonly CanvasElement[]): Set<string> {
  const scrims = elements.filter((el) => el.name === SCRIM_NAME)
  return new Set(elements.filter((el) => el.type === 'text' && scrims.some((s) => s.zIndex < el.zIndex && inside(el, s))).map((el) => el.id))
}

/**
 * 그린 결과 판정 — 스크림은 자기 사진 안에(글자 × 1.2까지), 최악 사진 높이의 상한 이하로(실제 최대 글자), 바로 아래에 그 자리를 덮는 막이 있게.
 * aspectOf를 가장 납작하게 준 결과로 부른다. maxShare를 빼면 상한은 보지 않는다.
 * 스크림 도형은 투명한 글자 자리 표시다(M2가 사진 위 글자의 바탕으로 읽는 요소). 실제 막은 아래 SVG라 도형만 남으면 안 읽히는 글이 통과하므로 여기서 잡는다.
 */
export function scrimIssues(elements: readonly CanvasElement[], maxShare?: number): string[] {
  const issues: string[] = []
  elements.forEach((scrim, index) => {
    if (scrim.name !== SCRIM_NAME) return
    const photo = elements.slice(0, index).reverse().find((el) => el.type === 'framed-image')
    if (!photo) {
      issues.push('스크림 아래 사진 없음')
      return
    }
    if (!inside(scrim, photo)) issues.push('스크림이 사진 밖으로 나감')
    const film = elements[index - 1]
    if (film?.name !== SCRIM_FILM_NAME || !inside(scrim, film) || !film.svgProps?.svgString.includes(`stop-opacity="`)) issues.push('스크림 아래 막 없음')
    const share = scrim.transform.height / photo.transform.height
    if (maxShare !== undefined && share > maxShare) issues.push(`스크림 ${scrim.transform.height}px가 사진 ${photo.transform.height}px의 ${Math.round(share * 100)}% > ${Math.round(maxShare * 100)}%`)
  })
  return issues
}
