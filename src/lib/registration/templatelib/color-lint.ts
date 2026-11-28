/**
 * K9 색 경고(상세페이지 조사 L10 적용 후보 7) — 페이지에 쓴 유채 색상 계열 수와 장식 겹침을 센다. 경고만 하고 막지 않는다(오너 화면 선택을 막지 않음).
 * 근거(L10-analysis.md 1·5절): 세련돼 보인 76편 중 55편은 유채 색이 0~1개, 촌스러워 보인 7편은 모두 2개 이상, 3개 이상 9편 중 세련은 1편이다.
 * 장식 겹침(그라데이션 글자·말풍선·월계수·자막풍 기울인 글 등) 11편 중 5편이 촌스러움이었다.
 * 검사기 연결: lint.ts lintTemplateLibrary의 colors 보고(컨셉별 색 조합 경고 벌 수, 위반 아님 — K9 PR2b-2). 순수·결정론.
 */

import { parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import type { Colors } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import { rgbToLch } from '@/lib/registration/internalized/designcut-palette'
import type { Template } from './template-types'

/** 유채로 셀 채도 — 옅은 면(T, C* 8~10)·짙은 갈색·남 글자(C* 10~12)·회색 면은 세지 않는다 */
export const CHROMATIC_MIN_CHROMA = 20
/** 이 색상각 폭 안은 한 계열이다(같은 색의 명도 단계) */
export const HUE_FAMILY_SPAN = 30
/** 페이지 유채 계열이 이 수 이상이면 경고한다 */
export const HUE_FAMILY_WARN = 3
/** 장식 종류가 이 수 이상 함께 쓰이면 경고한다 */
export const DECORATION_WARN = 2

/** 겹치면 촌스러워 보인 장식 — 그라데이션 글자·말풍선·월계수·자막풍 기울인 글 */
export const DECORATIONS = ['gradient-text', 'speech-bubble', 'laurel', 'caption-italic'] as const
export type Decoration = (typeof DECORATIONS)[number]

export interface HueFamily {
  /** 계열 첫 색상각(0~360, 소수 첫째 자리) */
  hue: number
  colors: string[]
}

export interface ColorWarning {
  rule: 'hue-families' | 'decoration-stack'
  message: string
  families?: HueFamily[]
  decorations?: Decoration[]
}

const round1 = (v: number) => Math.round(v * 10) / 10

/**
 * 유채 색상 계열 — C* 20 이상만 색상각으로 나눈다. 가장 넓게 빈 색상각 뒤에서 시작해, 계열 첫 색에서 30° 안이면 같은 계열로 묶는다(사슬로 늘어나지 않는다).
 * 같은 색은 한 번만 센다. 해석할 수 없는 값은 건너뛴다
 */
export function hueFamiliesOf(colors: readonly string[]): HueFamily[] {
  const seen = new Set<string>()
  const points: Array<{ hex: string; h: number }> = []
  for (const color of colors) {
    const rgb = parseColor(color)
    const hex = color.toUpperCase()
    if (!rgb || seen.has(hex)) continue
    seen.add(hex)
    const { c, h } = rgbToLch(rgb)
    if (c >= CHROMATIC_MIN_CHROMA) points.push({ hex, h })
  }
  if (points.length === 0) return []
  points.sort((a, b) => a.h - b.h || a.hex.localeCompare(b.hex))
  // 원을 가장 넓게 빈 곳에서 끊어 한 줄로 편다
  let start = 0
  let widest = -1
  points.forEach((point, i) => {
    const gap = i === 0 ? point.h + 360 - points[points.length - 1].h : point.h - points[i - 1].h
    if (gap > widest) {
      widest = gap
      start = i
    }
  })
  const line = [...points.slice(start), ...points.slice(0, start)]
  const families: HueFamily[] = []
  let first = line[0].h
  for (const point of line) {
    const family = families.at(-1)
    if (family && (point.h - first + 360) % 360 <= HUE_FAMILY_SPAN) family.colors.push(point.hex)
    else {
      first = point.h
      families.push({ hue: round1(point.h), colors: [point.hex] })
    }
  }
  return families
}

/**
 * 색 조합에서 페이지 디자인 요소(면·띠·강조 글자·배지·형광 띠)에 쓰이는 색 — 본문·제목 글자(ink·heading)는 잉크로 보고 뺀다(조사 규칙 '갈색 본문 글은 잉크').
 * 형광 띠 조합은 강조 글자가 잉크라 accentText를 빼고 accent(띠 색)만 둔다
 */
export function designColorsOf(colors: Colors): string[] {
  const { base, tint, neutral, photo, accent, accentText, deep, onDeep, onAccent, highlight } = colors
  return [base, tint, neutral, photo, accent, ...(highlight ? [] : [accentText]), deep, onDeep, onAccent]
}

/** K 템플릿 장식 — 지금 K 템플릿에서 찾을 수 있는 장식은 꼬리 단 말풍선뿐이다. 나머지는 입력을 넘기는 쪽(D 라인 등)이 센다 */
export function decorationsOfTemplate(template: Pick<Template, 'flow'>): Decoration[] {
  let bubble = false
  const walk = (value: unknown): void => {
    if (bubble || !value || typeof value !== 'object') return
    if (Array.isArray(value)) return value.forEach(walk)
    const node = value as Record<string, unknown>
    if (node.kind === 'panel' && node.radius === 'bubble' && typeof node.tail === 'string') {
      bubble = true
      return
    }
    Object.values(node).forEach(walk)
  }
  walk(template.flow)
  return bubble ? ['speech-bubble'] : []
}

/** 페이지 색 경고 — 유채 계열 3개 이상, 장식 2종 이상. 경고 없음이면 빈 배열이다 */
export function lintPageColors(page: { colors: readonly string[]; decorations?: readonly Decoration[] }): ColorWarning[] {
  const warnings: ColorWarning[] = []
  const families = hueFamiliesOf(page.colors)
  if (families.length >= HUE_FAMILY_WARN) {
    warnings.push({
      rule: 'hue-families',
      message: `유채 색상 계열 ${families.length}개(${families.map((f) => `${f.hue}°`).join('·')}) — ${HUE_FAMILY_WARN - 1}개 이하를 권한다`,
      families,
    })
  }
  const decorations = DECORATIONS.filter((d) => page.decorations?.includes(d))
  if (decorations.length >= DECORATION_WARN) {
    warnings.push({ rule: 'decoration-stack', message: `장식 ${decorations.length}종 겹침(${decorations.join('·')}) — 한 종만 권한다`, decorations })
  }
  return warnings
}

/** K 페이지 — 한 색 조합과 놓인 템플릿으로 경고를 낸다. 더 넣을 색(제품색 면 등)·장식은 extra로 넘긴다 */
export function lintKPageColors(
  colors: Colors,
  templates: ReadonlyArray<Pick<Template, 'flow'>>,
  extra: { colors?: readonly string[]; decorations?: readonly Decoration[] } = {},
): ColorWarning[] {
  return lintPageColors({
    colors: [...designColorsOf(colors), ...(extra.colors ?? [])],
    decorations: [...templates.flatMap(decorationsOfTemplate), ...(extra.decorations ?? [])],
  })
}
