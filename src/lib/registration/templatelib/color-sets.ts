/**
 * K 라인 색 조합 생성기 — 컨셉마다 바탕 4 × 강조 3 × 대비 2 = 24개 후보를 만들고 자동 검사에서 떨어진 것은 뺀다(PDP-KLINE-PLAN §4).
 * 토큰은 D 라인 Colors와 같은 칸이라 템플릿 엔진이 그대로 쓴다. 모두 밝은 바탕이고 짙은 면은 deep·onDeep이다. 순수·결정론.
 *
 * 자동 검사(WCAG 상대 휘도, 검사기와 같은 contrastRatio)
 * - 본문·제목·강조 글자 4.5:1 이상 — 바탕·띠·스튜디오 면·흰색 모두에서
 * - 강조 면 위 글자, 짙은 면 위 글자 4.5:1 이상(중간 밝기 강조 면은 색상각을 두고 명도를 옮겨 맞춘다)
 * - 강조 면이 바탕·연한 면(T)과 구분된다(1.3:1 이상, 또는 색차 30 이상)
 * - 어두운 노랑 금지(색상각 70~110·C* 15 이상·L* 70 미만) — 글자는 잉크 + 형광 띠(highlight)로 바꾸고, 그런 면은 탈락시킨다
 */

import { contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import type { Colors } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import { lchToHex, rgbToLch } from '@/lib/registration/internalized/designcut-palette'
import type { Concept, ConceptAccent, LchValue } from './concepts'

export const BASE_IDS = ['white', 'tint', 'soft', 'stone'] as const
export type BaseId = (typeof BASE_IDS)[number]
export const STRENGTHS = ['soft', 'strong'] as const
export type Strength = (typeof STRENGTHS)[number]

export const TEXT_MIN_CONTRAST = 4.5
const FILL_MIN_CONTRAST = 1.3
const FILL_MIN_DELTA_E = 30
const FILL_SHIFT_MAX = 12
const WHITE = '#FFFFFF'
const TEXT_MIN_L = 15
/** 어두운 노랑: 색상각·채도는 tokens.ts isYellowHue와 같은 경계 */
const YELLOW_HUE = [70, 110] as const
const YELLOW_MIN_CHROMA = 15
const YELLOW_MIN_LIGHTNESS = 70

export interface ColorSet {
  id: string
  conceptId: string
  base: BaseId
  accent: string
  strength: Strength
  colors: Colors
  /** 검사 값(소수 둘째 자리) — 판독·회귀 확인용 */
  checks: { ink: number; heading: number; accentText: number; onAccent: number; onDeep: number; fill: number }
}

export interface RejectedColorSet {
  id: string
  reason: string
}

const contrast = (a: string, b: string) => contrastRatio(parseColor(a)!, parseColor(b)!)
const round2 = (v: number) => Math.round(v * 100) / 100

export function isDarkYellow({ l, c, h }: LchValue): boolean {
  return c >= YELLOW_MIN_CHROMA && h >= YELLOW_HUE[0] && h <= YELLOW_HUE[1] && l < YELLOW_MIN_LIGHTNESS
}

const lchOf = (hex: string): LchValue => rgbToLch(parseColor(hex)!)

/** 연한 면(T) 명도 — L* 94면 붉은 색상각이 sRGB에서 깎여 N과 색차 6이 안 나온다 */
const TINT_L = 93
/** 연한 면(T) 채도 — 바탕 면 상한을 넘는 유일한 면. 컨셉이 색 있을수록 조금 더 진하게(시작값, 분석 2차·K0 뒤 다시 본다) */
const tintChroma = (baseChroma: number) => Math.min(10, Math.max(8, baseChroma + 6))
/** 회백 T — 색으로 못 가르니 명도로만 가른다. 흰 조합의 회색 면 N(95.5)과 색차 6 이상 */
const TINT_GRAY_L = 89
/** 바탕 채도 상한이 이 값 이하면(무채에 가까운 컨셉) T도 회백이다 — 상세페이지 조사(K9 L10) 무채형 25편의 밝은 면은 C 0~6이다 */
const GRAY_TINT_MAX_BASE_CHROMA = 2
/** 강조와 T의 색상각이 이만큼 넘게 벌어지면 T를 회백으로 둔다 — 조사 34편의 옅은 면·강조 차이 중앙 27°, 60° 넘음은 6편뿐이다(한 페이지 2색) */
const TINT_ACCENT_MAX_HUE_GAP = 60
/** 이 채도 아래 강조는 색상각을 따지지 않는다(회·검정 강조) */
const TINT_ACCENT_MIN_CHROMA = 20
/**
 * 강조가 바탕과 이 색상각 안(같은 계열)이면 바탕 채도 상한 2 이하 컨셉도 T를 컨셉 색으로 둔다 — 한 계열이라 '2색 페이지'가 되지 않는다.
 * candy-pop 분홍 띠가 회백이 되어 컨셉 성격이 빠진 것을 되돌린다(통합 결정 11-02 20:5x). 무채 컨셉(바탕 채도 0)은 그대로 회백이다
 */
const TINT_ACCENT_SAME_HUE = 30

/** 두 색상각 사이 각도(0~180) */
const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

/**
 * 회백 T인가 — 무채 컨셉, 강조와 60° 넘게 벌어진 조합, 바탕 채도 상한 2 이하 컨셉(강조가 같은 계열이면 뺀다)
 */
function grayTintOf(concept: Concept, accent: ConceptAccent): boolean {
  const colored = accent.c >= TINT_ACCENT_MIN_CHROMA
  const gap = hueDistance(accent.h, concept.baseHue)
  if (concept.baseChroma === 0 || (colored && gap > TINT_ACCENT_MAX_HUE_GAP)) return true
  return concept.baseChroma <= GRAY_TINT_MAX_BASE_CHROMA && !(colored && gap <= TINT_ACCENT_SAME_HUE)
}

/**
 * 바탕 4종 — 흰 바탕, 옅은 틴트, 조금 더 짙은 면, 무채에 가까운 돌색. 넓은 면(base·neutral)의 채도는 컨셉 상한 안에서만.
 * T는 예외다: 상한 안에 두면 흰색과 색차 약 4로 섹션 바탕이 바뀐 것이 보이지 않는다. 실제 판매 페이지 T(L* 90~96·C* 6~15)에 맞춰 흰색과 색차 8 이상,
 * N과 색차 6 이상을 둔다. soft는 바탕이 색 면이라 T가 흰색이다. gray면 T를 회백(L* 89)으로 둔다.
 */
function surfacesOf(concept: Concept, base: BaseId, gray: boolean): Pick<Colors, 'base' | 'tint' | 'neutral'> {
  const h = concept.baseHue
  const bc = concept.baseChroma
  const at = (l: number, c: number) => lchToHex({ l, c: Math.min(c, bc), h })
  const tint = lchToHex(gray ? { l: TINT_GRAY_L, c: Math.min(bc, GRAY_TINT_MAX_BASE_CHROMA), h } : { l: TINT_L, c: tintChroma(bc), h })
  if (base === 'white') return { base: WHITE, tint, neutral: at(95.5, 3) }
  // N은 바탕과 색차 4 이상이어야 이웃 섹션이 갈린다(판매 페이지 N↔흰 약 4.2). 회백 T의 돌색은 T(89)와도 갈리게 조금 밝게 둔다
  if (base === 'tint') return { base: at(98.5, 3), tint, neutral: at(94.5, 1) }
  if (base === 'soft') return { base: at(96, 7), tint: WHITE, neutral: at(91.5, 6) }
  return { base: at(97.5, 1), tint, neutral: at(gray ? 93.5 : 92, 2) }
}

/** 강조 면 — 강한 쪽은 어둡고 진하게. 노란 색상각은 어두워지면 탁해지므로 명도를 지키고 채도만 올린다 */
function fillOf(accent: ConceptAccent, strength: Strength): LchValue {
  const { l, c, h } = accent
  if (strength === 'soft') return { l, c, h }
  const yellow = h >= YELLOW_HUE[0] && h <= YELLOW_HUE[1] && c >= YELLOW_MIN_CHROMA
  if (yellow) return { l, c: c + 10, h }
  return { l: Math.max(l - 12, TEXT_MIN_L), c: c === 0 ? 0 : c + 8, h }
}

/**
 * 위에 글자를 올릴 수 있는 면으로 옮긴다 — 중간 밝기는 흰 글자도 잉크도 4.5:1이 안 된다. 색상각·채도는 두고 명도만 2씩, 가까운 쪽으로
 * 옮긴다(FILL_SHIFT_MAX까지). 못 맞추면 null
 */
function readableFill(start: LchValue, ink: string): LchValue | null {
  const readable = (lch: LchValue) => {
    const hex = lchToHex(lch)
    return contrast(WHITE, hex) >= TEXT_MIN_CONTRAST || contrast(ink, hex) >= TEXT_MIN_CONTRAST
  }
  for (let shift = 0; shift <= FILL_SHIFT_MAX; shift += 2) {
    for (const direction of [1, -1]) {
      const l = start.l + direction * shift
      if (l < TEXT_MIN_L || l > 96) continue
      if (readable({ ...start, l })) return { ...start, l }
    }
  }
  return null
}

const toLab = ({ l, c, h }: LchValue) => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)]

/** 강조 면이 바탕과 구분되는가 — 밝고 진한 색(레몬)은 휘도 대비가 낮아도 색이 달라 잘 보이므로 색차도 함께 본다 */
function fillVisible(fill: string, base: string): boolean {
  if (contrast(fill, base) >= FILL_MIN_CONTRAST) return true
  const [a, b] = [lchOf(fill), lchOf(base)].map(toLab)
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) >= FILL_MIN_DELTA_E
}

/** 강조 글자 — 모든 밝은 면에서 4.5:1이 될 때까지 L*를 2씩 내린다. 어두운 노랑이 되거나 못 맞추면 null(잉크 + 형광 띠) */
function accentTextOf(fill: LchValue, surfaces: readonly string[]): string | null {
  for (let l = fill.l; l >= TEXT_MIN_L; l -= 2) {
    const hex = lchToHex({ ...fill, l })
    if (isDarkYellow(lchOf(hex))) return null
    if (surfaces.every((s) => contrast(hex, s) >= TEXT_MIN_CONTRAST)) return hex
  }
  return null
}

/**
 * 글자색 — 따뜻한 컨셉은 짙은 갈색, 차가운 컨셉은 짙은 남이다. 상세페이지 조사(K9 L10)에서 글자색을 적은 44편 중 짙은 갈색 8편(7편 세련)·짙은 남 5편이었다.
 * 명도는 지금 잉크와 같은 L* 20(제목 16)이라 대비·강조 면 판정은 그대로다. 무채·분홍·초록 컨셉은 지금처럼 바탕 색상각의 거의 검정이다.
 */
const WARM_TEXT_HUE = [30, 110] as const
const COOL_TEXT_HUE = [200, 300] as const
const TEXT_WARM = { ink: { l: 20, c: 12, h: 60 }, heading: { l: 16, c: 12, h: 58 } }
const TEXT_COOL = { ink: { l: 20, c: 10, h: 258 }, heading: { l: 16, c: 12, h: 258 } }

export function textColorsOf(concept: Pick<Concept, 'baseHue' | 'baseChroma'>): { ink: string; heading: string } {
  const { baseHue: h, baseChroma: bc } = concept
  const within = ([lo, hi]: readonly [number, number]) => bc > 0 && h >= lo && h <= hi
  const tone = within(WARM_TEXT_HUE) ? TEXT_WARM : within(COOL_TEXT_HUE) ? TEXT_COOL : null
  if (tone) return { ink: lchToHex(tone.ink), heading: lchToHex(tone.heading) }
  return { ink: lchToHex({ l: 20, c: Math.min(6, bc + 2), h }), heading: lchToHex({ l: 16, c: Math.min(10, bc + 4), h }) }
}

function buildSet(concept: Concept, base: BaseId, accent: ConceptAccent, strength: Strength): ColorSet | RejectedColorSet {
  const id = `${concept.id}.${base}.${accent.id}.${strength}`
  const reject = (reason: string): RejectedColorSet => ({ id, reason })

  const surface = surfacesOf(concept, base, grayTintOf(concept, accent))
  const lightSurfaces = [surface.base, surface.tint, surface.neutral, WHITE]
  const { ink, heading } = textColorsOf(concept)
  const minOn = (color: string) => Math.min(...lightSurfaces.map((s) => contrast(color, s)))
  if (minOn(ink) < TEXT_MIN_CONTRAST) return reject('본문 대비 부족')
  if (minOn(heading) < TEXT_MIN_CONTRAST) return reject('제목 대비 부족')

  const fillLch = readableFill(fillOf(accent, strength), ink)
  if (!fillLch) return reject('강조 면 위 글자 대비 부족')
  const fill = lchToHex(fillLch)
  // sRGB 안으로 깎이며 색이 바뀔 수 있어 실제 색으로 본다
  if (isDarkYellow(lchOf(fill))) return reject('탁한 노랑 면')
  if (!fillVisible(fill, surface.base)) return reject('강조 면이 바탕과 구분되지 않음')
  if (!fillVisible(fill, surface.tint)) return reject('강조 면이 연한 면과 구분되지 않음')
  const fillContrast = contrast(fill, surface.base)

  const onAccent = contrast(WHITE, fill) >= TEXT_MIN_CONTRAST ? WHITE : ink

  const textColor = accentTextOf(fillLch, lightSurfaces)
  const accentText = textColor ?? ink

  const deep = concept.deep ? lchToHex(concept.deep) : surface.tint
  const onDeep = concept.deep ? WHITE : ink
  if (contrast(onDeep, deep) < TEXT_MIN_CONTRAST) return reject('짙은 면 위 글자 대비 부족')

  return {
    id,
    conceptId: concept.id,
    base,
    accent: accent.id,
    strength,
    colors: {
      base: surface.base,
      accent: fill,
      accentText,
      deep,
      tint: surface.tint,
      ink,
      photo: surface.neutral,
      onDeep,
      onAccent,
      neutral: surface.neutral,
      heading,
      highlight: textColor === null,
      // 컨셉 강조 방식(T1-18) — 계획 templateColors로 기록돼 K 엔진만 읽는다
      emphasisStyle: concept.emphasisStyle,
    },
    checks: {
      ink: round2(minOn(ink)),
      heading: round2(minOn(heading)),
      accentText: round2(minOn(accentText)),
      onAccent: round2(contrast(onAccent, fill)),
      onDeep: round2(contrast(onDeep, deep)),
      fill: round2(fillContrast),
    },
  }
}

/** 컨셉의 후보 24개 → 통과한 조합과 탈락 사유 */
export function colorSetsOf(concept: Concept): { sets: ColorSet[]; rejected: RejectedColorSet[] } {
  const sets: ColorSet[] = []
  const rejected: RejectedColorSet[] = []
  for (const base of BASE_IDS) {
    for (const accent of concept.accents) {
      for (const strength of STRENGTHS) {
        const built = buildSet(concept, base, accent, strength)
        if ('colors' in built) sets.push(built)
        else rejected.push(built)
      }
    }
  }
  return { sets, rejected }
}

/** 사진 색으로 볼 최소 채도 — 못 미치면(흰·회 상품) 충돌을 보지 않는다 */
const PHOTO_MIN_CHROMA = 15
/** 강조 색으로 볼 최소 채도 — 무채에 가까운 강조는 어떤 사진과도 부딪히지 않는다 */
const CLASH_MIN_ACCENT_CHROMA = 30
/** 진한 상품색과 진한 강조색의 색상각이 이만큼 벌어지면 튀는 색 면으로 본다(제안 값 — K0에서 r9로 확인한다) */
const CLASH_HUE_DISTANCE = 120

/**
 * 상품 사진 색과 어울리는 순서 — 충돌하는 조합을 빼고 색상각이 가까운 순으로 둔다(같으면 입력 순서). 상품색이 무채이거나 없으면 그대로,
 * 모두 충돌하면 후보가 비지 않게 전부 돌려준다(clashAll로 표시)
 */
export function rankForPhoto(sets: readonly ColorSet[], productHex: string | null | undefined): { sets: ColorSet[]; clashAll: boolean } {
  const product = productHex && parseColor(productHex) ? lchOf(productHex) : null
  if (!product || product.c < PHOTO_MIN_CHROMA) return { sets: [...sets], clashAll: false }
  const scored = sets.map((set) => {
    const accent = lchOf(set.colors.accent)
    const distance = accent.c < CLASH_MIN_ACCENT_CHROMA ? 0 : hueDistance(accent.h, product.h)
    return { set, distance, clash: accent.c >= CLASH_MIN_ACCENT_CHROMA && distance > CLASH_HUE_DISTANCE }
  })
  const fine = scored.filter((s) => !s.clash)
  const pool = fine.length > 0 ? fine : scored
  return {
    sets: pool
      .map((s, i) => ({ ...s, i }))
      .sort((a, b) => a.distance - b.distance || a.i - b.i)
      .map((s) => s.set),
    clashAll: fine.length === 0 && scored.length > 0,
  }
}

const tokenOf = (hex: string) => {
  const rgb = parseColor(hex)!
  return { $type: 'color', $value: { colorSpace: 'srgb', components: rgb.map((v) => Math.round((v / 255) * 10000) / 10000), hex } }
}

/** W3C Design Tokens 2025.10 형식 — 사람이 보거나 외부 도구로 넘길 때 쓴다 */
export function toDesignTokens(set: ColorSet): Record<string, unknown> {
  const { highlight, emphasisStyle, ...colors } = set.colors
  return {
    $description: set.id,
    color: Object.fromEntries(Object.entries(colors).map(([key, hex]) => [key, tokenOf(hex)])),
    $extensions: { 'nexops.templatelib': { conceptId: set.conceptId, base: set.base, accent: set.accent, strength: set.strength, highlight, emphasisStyle } },
  }
}
