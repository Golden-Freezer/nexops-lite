/**
 * 디자인 컷 토큰 — 08_DESIGN_CUTS.md §0.2 타이포·§4 색면·§5.2 모서리 문법.
 * 통합 확정 1: 본문은 압축 모듈까지 45(MIN_FONT_SIZES.body) 미만으로 내리지 않는다. 보조 설명 caption ≥28, 장식 라벨 ≥32.
 * 모바일 검사기(M1)가 typoLevel로 하한을 보므로 토큰마다 typoLevel을 함께 둔다.
 */

import { contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { cutBackgroundOf, lchToHex, rgbToLch } from '@/lib/registration/internalized/designcut-palette'
import type { TypoLevel } from '../helpers'
import type { CutPlan, DesigncutBg, DesigncutPlan } from './contract'

export const W = 860
export const MARGIN = 60
export const CONTENT_W = 740

export interface TypeToken {
  size: number
  weight: number
  lineHeight: number
  level: TypoLevel
  /** 없으면 수준(level)의 기본 글꼴 */
  fontFamily?: string
}

export const TYPE = {
  DISPLAY: { size: 96, weight: 800, lineHeight: 1.15, level: 'display' },
  H1: { size: 72, weight: 800, lineHeight: 1.25, level: 'h1' },
  H2: { size: 60, weight: 800, lineHeight: 1.25, level: 'h2' },
  H3: { size: 48, weight: 700, lineHeight: 1.3, level: 'body' },
  BODY: { size: 45, weight: 500, lineHeight: 1.45, level: 'body' },
  BODY_BOLD: { size: 45, weight: 700, lineHeight: 1.45, level: 'body' },
  LABEL: { size: 32, weight: 700, lineHeight: 1.2, level: 'caption' },
} as const satisfies Record<string, TypeToken>

export type TypeSet = { readonly [K in keyof typeof TYPE]: TypeToken }

/**
 * D2 장면 모드 글자 — 줄 간격을 NEXFIT 수준으로 넓히고(오너 지적 10-31 '다닥다닥', SPACING-LAYOUT.md ①) 크기는 K와 같다.
 * 제목 1.45(장 번호 1.2), 본문 1.7. 라벨은 높이 64 고정 캡슐 안 한 줄이라 그대로 둔다.
 * 자간은 수준별 기본값(display·h1 -1, h2 -0.5)이 이미 NEXFIT과 같다
 */
export const SCENE_TYPE: TypeSet = {
  DISPLAY: { ...TYPE.DISPLAY, lineHeight: 1.2 },
  // 크기·본문 굵기는 K 글자(templatelib K_TYPE, #498)와 같다 — 보고서 적용 D1(오너 11-02 'D는 D대로 모두 적용', 11-01 '글씨를 더 키운다')
  H1: { ...TYPE.H1, size: 92, lineHeight: 1.45 },
  H2: { ...TYPE.H2, size: 74, lineHeight: 1.45 },
  H3: { ...TYPE.H3, size: 62, lineHeight: 1.5 },
  BODY: { ...TYPE.BODY, size: 52, weight: 400, lineHeight: 1.7 },
  BODY_BOLD: { ...TYPE.BODY_BOLD, size: 52, lineHeight: 1.7 },
  LABEL: TYPE.LABEL,
}

/** D2 장면 모드 여백 — 섹션 위·아래 120, 제목→본문 48, 글→사진 88(NEXFIT 140·90·110 쪽으로, SPACING-LAYOUT.md ①) */
export const SCENE_SPACE = { top: 120, titleGap: 48, photoGap: 88, bottom: 120 }

/** 첫 화면 후킹 문장(계획 T1 text.hook = mainIntro.hook) — 제목 위 한 줄, 굵은 본문 크기 */
export const HOOK_LINE: TypeToken = { size: 45, weight: 700, lineHeight: 1.5, level: 'body' }

/**
 * 첫 화면 큰 제목(오너 지시 10-31·11-01 '후킹 제목을 더 크게') — 줄 간격 1.4, 크기는 K HOOK과 같은 112(모바일 390에서 약 51px).
 * 860 폭에서 한 줄 약 7자다(11상품 실제 제목으로 잼: 100·104는 줄 수가 같고, 108부터 줄어드는 상품이 생긴다).
 * 제목이 길면 fitHookToken이 2줄에 들어갈 때까지 줄인다. playful은 둥근 디스플레이 주아(굵기 하나라 400 — 합성 볼드 없음)
 */
export const HOOK_TYPE = {
  calm: { size: 112, weight: 800, lineHeight: 1.4, level: 'h1' },
  playful: { size: 112, weight: 400, lineHeight: 1.4, level: 'h1', fontFamily: 'Jua' },
} as const satisfies Record<'calm' | 'playful', TypeToken>

export const WHITE = '#FFFFFF'
export const NEUTRAL_BG = '#F4F4F4'

const hex = (c: [number, number, number]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
const rgbOf = (color: string): [number, number, number] => parseColor(color) ?? [0, 0, 0]

/** a를 b 쪽으로 t만큼 섞은 색 */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgbOf(a), rgbOf(b)]
  return hex(x.map((v, i) => v + (y[i] - v) * t) as [number, number, number])
}

export const rgba = (color: string, alpha: number) => `rgba(${rgbOf(color).join(', ')}, ${alpha})`

/** 대비 4.5:1을 넘는 쪽(흰색 우선) — ON_ACCENT 규칙(§4.1) */
export function onColor(bg: string, ink: string): string {
  return contrastRatio(rgbOf(WHITE), rgbOf(bg)) >= 4.5 ? WHITE : ink
}

export interface Colors {
  base: string
  accent: string
  accentText: string
  deep: string
  tint: string
  ink: string
  /** 상품 사진 배경색(사진 측정값, 없으면 tint) — 상품 사진 섹션 바탕 */
  photo: string
  onDeep: string
  onAccent: string
  /** N 바탕 — v1 #F4F4F4, v2는 촬영 배경 색상각의 밝은 뉴트럴 스튜디오(L* 95.5·C* ≤4, 무채 배경이면 #F4F4F4) */
  neutral: string
  /** 밝은 바탕 제목 본색 — v1 ink, v2는 제품 색상각의 아주 짙은 값(L* 22·C* 12, 중립 모드는 ink) */
  heading: string
  /** 강조 글자색을 만들 수 없는 밝은 색상각(노랑·연두 — accentText가 ink로 떨어짐) — v2 강조 구절은 형광 띠(08 §4.1-5) */
  highlight: boolean
  /**
   * 제목 강조 방식(K 컨셉, 적용 K4 T1-18) — band면 밝은 면 강조 구절이 형광 띠다. K 템플릿 엔진(templatelib accentOf)만 읽고,
   * D 라인·옛 계획은 칸이 없어 지금 규칙(색 글자, highlight면 띠) 그대로다
   */
  emphasisStyle?: EmphasisStyle
}

/** 제목 강조 방식 — color: 색 글자, band: 형광 띠(밝은 면). 짙은 면은 둘 다 색 글자 */
export type EmphasisStyle = 'color' | 'band'
export const EMPHASIS_STYLES: readonly EmphasisStyle[] = ['color', 'band']

/** 촬영 배경 채도가 이 값 미만이면 무채 스튜디오(#F4F4F4) */
const STUDIO_MIN_CHROMA = 3

function studioOf(p: CutPlan['palette']): string {
  const bg = parseColor(p.photoBackground)
  const lch = bg ? rgbToLch(bg) : null
  return lch && lch.c >= STUDIO_MIN_CHROMA ? lchToHex({ l: 95.5, c: Math.min(4, lch.c), h: lch.h }) : NEUTRAL_BG
}

function headingOf(p: CutPlan['palette']): string {
  const accent = parseColor(p.accent)
  return p.mode === 'color' && accent ? lchToHex({ l: 22, c: 12, h: rgbToLch(accent).h }) : p.ink
}

/**
 * 노란 색상각(LCh h 70~110, C* 15 이상 — 황토·앰버·겨자·금색·노랑) — 같은 색상각으로 어둡게 내리면 갈색·겨자·올리브로 탁해지는 색.
 * 실측: render-check 잡(R5-D P02 구디백) 계획 강조색 #B78936은 h 79.5, 그 강조 글자 #8C630C가 오너가 지적한 탁한 색이다. 주황(예 #D9622B
 * h 50)과 연두(h 110 넘음)는 넣지 않는다(SPACING-LAYOUT.md ④)
 */
export function isYellowHue(color: string): boolean {
  const rgb = parseColor(color)
  if (!rgb) return false
  const { h, c } = rgbToLch(rgb)
  return c >= 15 && h >= 70 && h <= 110
}

export function colorsOf(plan: CutPlan): Colors {
  const p = plan.palette
  const v2 = plan.layout === 2
  return {
    base: WHITE,
    accent: p.accent,
    accentText: p.accentText,
    deep: p.deep,
    tint: p.tint,
    ink: p.ink,
    // 계획이 제품 컷을 생성한 배경과 같은 값(photoBackground ?? tint) — 컷과 섹션 바탕이 이어진다
    photo: cutBackgroundOf(p),
    onDeep: WHITE,
    onAccent: onColor(p.accent, p.ink),
    neutral: v2 ? studioOf(p) : NEUTRAL_BG,
    heading: v2 ? headingOf(p) : p.ink,
    highlight: p.accentText.toLowerCase() === p.ink.toLowerCase(),
  }
}

/**
 * 바탕 유형 → 섹션 바탕색과 그 위 글자색(§4.3).
 * P(상품 사진 섹션)는 사진 배경색으로 이어 칠한다 — 짙은 면을 깔면 사진이 액자처럼 떠 보이고 짙은 바탕 비중이 계획 상한을 넘는다.
 * 그 위 글자는 흰 글자 대비가 4.5 이상일 때만 흰색이다.
 */
export function surfaceOf(bg: DesigncutBg, c: Colors): { fill: string; text: string; dark: boolean } {
  if (bg === 'P') {
    const text = onColor(c.photo, c.ink)
    return { fill: c.photo, text, dark: text === WHITE }
  }
  if (bg === 'D') return { fill: c.deep, text: c.onDeep, dark: true }
  if (bg === 'T') return { fill: c.tint, text: c.ink, dark: false }
  if (bg === 'N') return { fill: c.neutral, text: c.ink, dark: false }
  return { fill: c.base, text: c.ink, dark: false }
}

type Surface = ReturnType<typeof surfaceOf>

/** 강조 글자색 — 밝은 바탕은 accentText, 짙은 바탕은 흰색(대비 우선) */
export const accentTextOn = (dark: boolean, c: Colors) => (dark ? c.onDeep : c.accentText)

/** 제목 색 — 밝은 바탕은 제목 본색(그 바탕 대비 4.5 이상일 때), 아니면 바탕 글자색. v1은 heading이 ink라 바탕 글자색과 같다 */
export function headingOn(surf: Surface, c: Colors): string {
  if (surf.dark) return surf.text
  return contrastRatio(rgbOf(c.heading), rgbOf(surf.fill)) >= 4.5 ? c.heading : surf.text
}

/**
 * v2 강조색(장 번호·라벨·제목 강조 구절) — 밝은 바탕은 accentText(그 바탕 대비 4.5 미만이면 ink 쪽으로 어둡힌 값 — 사진 배경색·스튜디오
 * 위), 짙은 바탕은 그 바탕 대비 darkMin 이상(큰 글자 3, 라벨 4.5)인 밝힌 accent. 못 만들면 null(강조 없이 바탕 글자색)
 */
export function emphasisOn(surf: Surface, c: Colors, darkMin = 3): string | null {
  const fill = rgbOf(surf.fill)
  if (!surf.dark) {
    if (c.highlight) return null
    for (const t of [0, 0.2, 0.4]) {
      const color = mix(c.accentText, c.ink, t)
      if (contrastRatio(rgbOf(color), fill) >= 4.5) return color
    }
    return null
  }
  for (const t of [0.15, 0.35, 0.55, 0.75]) {
    const color = mix(c.accent, WHITE, t)
    if (contrastRatio(rgbOf(color), fill) >= darkMin) return color
  }
  return null
}

/** v2 상자 채움(C6 한 문법) — 흰 바탕엔 스튜디오, 그 밖 밝은 바탕엔 흰색, 짙은 바탕엔 흰색 12% */
export function panelOn(surf: Surface, c: Colors): string {
  if (surf.dark) return rgba(WHITE, 0.12)
  return surf.fill.toLowerCase() === WHITE.toLowerCase() ? c.neutral : WHITE
}

/** palette2 playful(PALETTE2.md ③) — 알약 캡슐·스티커 배지, 크게 둥근 카드·말풍선 */
export const PLAYFUL_RADIUS = { capsule: 999, card: 40, bubble: 44, chip: 999 }

/** 모서리 문법(§5.2) */
export function radiusOf(motif: DesigncutPlan['motif']) {
  const soft = motif.badge === 'SOFT'
  return { capsule: soft ? 32 : 4, card: soft ? 28 : 4, bubble: soft ? 36 : 8, chip: soft ? 999 : 8 }
}

/** 플레이트 대체 그라데이션(§2.5) — 밝은 섹션은 tint 계열, 짙은 섹션은 deep 계열 */
export function fallbackGradient(dark: boolean, c: Colors): string {
  return dark
    ? `linear-gradient(180deg, ${c.deep} 0%, ${mix(c.deep, c.accent, 0.22)} 100%)`
    : `linear-gradient(180deg, ${c.tint} 0%, ${mix(c.tint, c.accent, 0.18)} 100%)`
}
