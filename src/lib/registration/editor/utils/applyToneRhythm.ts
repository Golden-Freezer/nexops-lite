// ─── 편집기 톤 리듬(pdp-enrichment R3) ─────────────────────────────────────────
// R1 P02 심사 r5 "분홍과 크림 배경이 번갈아 나오지만 단조롭다" — 섹션 바탕이 bgMain·bgSub 두 파스텔(또는 테마의 비슷한 밝은 색)만
// 오가서 구획이 흐리다. persuasion 기록 잡의 최초 빌드에만 섹션 바탕을 다시 배정한다(테마 다음 — 바탕의 최종 결정자).
// 규칙은 디자인 컷(D1)의 바탕 교차 규칙(08_DESIGN_CUTS.md §4.3: 같은 유형 연속 금지·밝음 연속 ≤2)과 동적 계획
// (internalized/bg-rhythm.ts solveRhythm)을 그대로 쓴다.
// - 유형: T = bgMain, N = bgSub, W = 흰색(밝음 — 서로 거의 같은 색이면 하나로 합친다) · D = 짙은 띠(primary를 흰 글자 7:1까지
//   어둡게) · P = 사진이 섹션의 85% 이상을 덮음(바탕이 거의 안 보인다)
// - 고정(바탕 그대로, 유형은 실제 색에 가장 가까운 것으로 센다): hook_3step · cta·perf_sales · 사진 주도 섹션
// - D 후보: 글자가 바탕 위에만 있는 단순 섹션(solution_guide, 체크 원 없는 한 열 point_list_div) 중 한 곳 — solution_guide가 있으면
//   그것(문제 → 해결 전환점), 없으면 첫 point_list_div. 글자는 흰색, 머리 막대는 밝은 톤
// - 섹션 사이 거터(divider)는 앞 섹션 바탕을 이어 받아 띠가 생기지 않게 한다
// R4 렌더 리듬(NEXFIT 대비 비교) — 짙은 띠는 한 페이지에 하나(서사 전환점)만 더한다(R3 P01은 와인색 띠 2개가 밝은 면을 끊었다).
// solveRhythm의 D 개수 범위는 약한 비용(500)이라 밝음 연속(1000)에 밀리므로, 후보를 한 섹션에만 줘서 상한을 지킨다.
// 바탕 톤이 거의 같은 이웃(톤 거리 < MIN_TONE_DISTANCE)은 경계가 지워지므로 표시한다 — 남은 거터는 기본 바탕(bgMain)으로 칠하고
// (NEXFIT의 바탕색 거터), 거터가 없거나 기본 바탕도 같은 톤이면 뒤 섹션 맨 위에 폰 1px(캔버스 2px) 선을 긋는다.

import { solveRhythm, type RhythmCandidate } from '@/lib/registration/internalized/bg-rhythm'
import type { DesigncutBg } from '@/lib/registration/pdp-state'
import type { CanvasElement, CanvasSection } from '../types/canvas'
import type { DesignPalette } from '../types/editor'
import { ProSectionType } from '../types/section'
import { checkMobileReadability, contrastRatio, parseColor } from './mobileReadability'

const WHITE = '#FFFFFF'
/** 짙은 띠 위 흰 글자 대비 — 본문 하한 4.5보다 여유 있게 */
const DEEP_CONTRAST = 7
/** 두 밝은 톤을 다른 색으로 보는 최소 차(RGB 채널 차 합) — 이보다 가까우면 같은 톤으로 합친다 */
export const MIN_TONE_DISTANCE = 16
/** 같은 유형(같은 색) 이웃 추가 비용 — 밝음 연속 위반(1000)보다 크게 */
const SAME_TYPE_COST = 1500
/** 사진 주도(P) — 전폭 사진이 섹션 높이의 이 비율 이상을 덮을 때만(바탕이 15% 미만 보인다) */
const PHOTO_LED_RATIO = 0.85
const FIXED_KEEP = new Set<string>([ProSectionType.HOOK_3STEP, ProSectionType.CTA, ProSectionType.PERFORMANCE_SALES])
const DEEP_CAPABLE = new Set<string>([ProSectionType.SOLUTION_GUIDE, ProSectionType.POINT_LIST_DIV])

type LightTone = 'T' | 'N' | 'W'

function isLight(rgb: [number, number, number] | null): boolean {
  return rgb !== null && rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 >= 160
}

/** RGB 채널 차 합 */
export function toneDistance(a: string, b: string): number {
  const x = parseColor(a)
  const y = parseColor(b)
  return x && y ? Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) : Infinity
}

/** primary를 흰 글자 대비 7:1이 될 때까지 어둡게 — 끝내 못 미치면 먹색 */
export function deepTone(primary: string | undefined): string {
  const rgb = parseColor(primary)
  if (rgb) {
    for (const f of [0.6, 0.5, 0.4, 0.3, 0.2]) {
      const c = rgb.map((v) => Math.round(v * f)) as [number, number, number]
      if (contrastRatio(c, [255, 255, 255]) >= DEEP_CONTRAST) {
        return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
      }
    }
  }
  return '#1F2937'
}

/** 사진이 섹션 대부분을 덮는가 — 전폭(≥ 90%) 사진이 섹션 높이의 85% 이상 */
function isPhotoLed(section: CanvasSection): boolean {
  const width = section.canvas.width || 860
  return section.elements.some(
    (el) =>
      (el.type === 'image' || el.type === 'framed-image') &&
      el.transform.width >= width * 0.9 &&
      el.transform.height >= section.canvas.height * PHOTO_LED_RATIO
  )
}

/** 글자가 바탕 위에만 있는가 — 도형은 섹션 머리 강조 막대(_accent)뿐 */
function textOnlyOnBackground(section: CanvasSection): boolean {
  return section.elements.every((el) => el.type === 'text' || el.type === 'image' || el.name.endsWith('_accent'))
}

/** 짙은 띠 후보 한 곳 — solution_guide가 있으면 그것, 없으면 첫 point_list_div(글자만, 고정·사진 주도 아님). 없으면 -1 */
function deepTurnIndex(body: CanvasSection[]): number {
  const eligible = (s: CanvasSection) =>
    DEEP_CAPABLE.has(String(s.sectionType)) && textOnlyOnBackground(s) && !isPhotoLed(s)
  const solution = body.findIndex((s) => s.sectionType === ProSectionType.SOLUTION_GUIDE && eligible(s))
  return solution >= 0 ? solution : body.findIndex(eligible)
}

/** 이 바탕에서 글자 대비(M2) 위반 수 — 모바일 판독 검사기의 M2만 센다 */
function contrastIssues(section: CanvasSection, background: string): number {
  const probe = { ...section, canvas: { ...section.canvas, backgroundColor: background } }
  return checkMobileReadability({ sections: [probe] }).violations.filter((v) => v.rule === 'M2').length
}

/** 페이지 밝은 톤 — bgMain·bgSub·흰색 중 서로 거의 같은 색은 앞의 것만 남긴다 */
export function lightTones(palette: DesignPalette): Partial<Record<LightTone, string>> {
  const raw: Array<[LightTone, string | undefined]> = [
    ['T', palette.bgMain],
    ['N', palette.bgSub],
    ['W', WHITE],
  ]
  const out: Partial<Record<LightTone, string>> = {}
  for (const [tone, hex] of raw) {
    if (!hex || !isLight(parseColor(hex))) continue
    if (Object.values(out).some((kept) => toneDistance(kept!, hex) < MIN_TONE_DISTANCE)) continue
    out[tone] = hex
  }
  return out
}

/** 지금 바탕을 유형으로 — 그라디언트(hook)는 끝 색 bgMain, 밝으면 가장 가까운 밝은 톤, 어두우면 D */
function toneOf(background: string, tones: Partial<Record<LightTone, string>>, palette: DesignPalette): DesigncutBg {
  const color = background.startsWith('linear-gradient') ? palette.bgMain : background
  if (!isLight(parseColor(color))) return 'D'
  const entries = Object.entries(tones) as Array<[LightTone, string]>
  return entries.reduce(
    (best, [tone, hex]) => (toneDistance(hex, color) < toneDistance(tones[best]!, color) ? tone : best),
    entries[0][0]
  )
}

export function applyToneRhythm(sections: CanvasSection[], palette: DesignPalette): CanvasSection[] {
  const tones = lightTones(palette)
  if (Object.keys(tones).length === 0) return sections
  const deep = deepTone(palette.primary)
  const lights = Object.keys(tones) as LightTone[]
  const body = sections.filter((s) => s.sectionType !== ProSectionType.DIVIDER)
  let fixedDeep = 0
  let deepCapable = 0
  const turn = deepTurnIndex(body)
  const candidates: RhythmCandidate[][] = body.map((s, i) => {
    const type = String(s.sectionType)
    const current = toneOf(s.canvas.backgroundColor, tones, palette)
    if (FIXED_KEEP.has(type) || isPhotoLed(s)) {
      const bg: DesigncutBg = isPhotoLed(s) && !FIXED_KEEP.has(type) ? 'P' : current
      if (bg === 'D') fixedDeep++
      return [{ bg, cost: 0 }]
    }
    // 바탕을 바꿔도 글자 대비(M2) 위반이 늘지 않는 톤만 — 예: 세이지 primary 라벨이 짙은 밝은 톤에서 4.5 아래로
    const base = contrastIssues(s, s.canvas.backgroundColor)
    // 현재 톤도 검사한다 — 테마 색은 가장 가까운 팔레트 톤으로 바뀌므로 그 색에서 대비가 떨어질 수 있다. 안전한 톤이 없으면 지금 색 그대로
    const safe = lights.filter((bg) => contrastIssues(s, tones[bg]!) <= base)
    const light = safe.map((bg) => ({ bg, cost: bg === current ? 0 : 1 }))
    if (light.length === 0) return [{ bg: current, cost: 0 }]
    if (i === turn) {
      deepCapable++
      return [...light, { bg: 'D' as const, cost: 2 }]
    }
    return light
  })
  // 짙은 띠는 고를 수 있는 섹션이 있을 때만 하나 더 — 없으면 밝은 톤끼리 같은 유형 연속만 피한다
  // 밝음 연속 ≤2와 같은 유형 연속 금지를 다 지킬 수 없으면 같은 색 이웃을 먼저 피한다(sameTypeCost)
  const bgs = solveRhythm(candidates, deepCapable > 0 ? [fixedDeep + 1, fixedDeep + 1] : null, SAME_TYPE_COST)

  // 섹션별 최종 바탕 — 고정은 지금 색, 나머지는 배정 톤. 그라디언트(hook)는 이웃 비교에 끝 색 bgMain을 쓴다
  const finals = body.map((s, i) => {
    const current = s.canvas.backgroundColor
    if (candidates[i].length > 1) return bgs[i] === 'D' ? deep : tones[bgs[i] as LightTone]!
    return current.startsWith('linear-gradient') ? palette.bgMain : current
  })
  // 사진 주도(P)는 유형으로는 '강함'이지만 바탕이 조금 보인다 — 실제 색이 이웃과 겹치면 겹치지 않는 밝은 톤으로 바꾼다
  body.forEach((s, i) => {
    if (bgs[i] !== 'P' || FIXED_KEEP.has(String(s.sectionType))) return
    const near = [finals[i - 1], finals[i + 1]].filter((c): c is string => Boolean(c))
    if (near.every((c) => toneDistance(c, finals[i]) >= MIN_TONE_DISTANCE)) return
    const pick = lights.map((t) => tones[t]!).find((c) => near.every((n) => toneDistance(c, n) >= MIN_TONE_DISTANCE))
    if (pick) finals[i] = pick
  })

  let k = 0
  let previousBg: string | null = null
  const toned = sections.map((section) => {
    if (section.sectionType === ProSectionType.DIVIDER) {
      return previousBg ? { ...section, canvas: { ...section.canvas, backgroundColor: previousBg } } : section
    }
    const bg = bgs[k]
    const color = finals[k++]
    previousBg = color
    if (color === section.canvas.backgroundColor || section.canvas.backgroundColor.startsWith('linear-gradient')) {
      return section
    }
    if (bg !== 'D') return { ...section, canvas: { ...section.canvas, backgroundColor: color } }
    // 짙은 띠 — 바탕 위 글자는 흰색, 머리 강조 막대는 밝은 톤
    const elements = section.elements.map((el) => {
      if (el.type === 'text' && el.textProps) return { ...el, textProps: { ...el.textProps, color: WHITE } }
      if (el.name.endsWith('_accent') && el.shapeProps)
        return { ...el, shapeProps: { ...el.shapeProps, fill: tones[lights[0]]! } }
      return el
    })
    return { ...section, canvas: { ...section.canvas, backgroundColor: color }, elements }
  })
  return markSameToneSeams(toned, palette)
}

/** 같은 톤 경계 선 — 폰 1px(캔버스 2px), 본문 폭 */
const SEAM_LINE_H = 2
const SIDE_MARGIN = 60

/** 이웃 비교용 단색 — 그라디언트(hook)는 끝 색 bgMain */
const flatBg = (s: CanvasSection, palette: DesignPalette) =>
  s.canvas.backgroundColor.startsWith('linear-gradient') ? palette.bgMain : s.canvas.backgroundColor

/** 전폭 사진이 경계에 붙어 있는가 — 사진 가장자리가 이미 경계를 보여 준다 */
function flushPhoto(s: CanvasSection, side: 'top' | 'bottom'): boolean {
  const width = s.canvas.width || 860
  return s.elements.some(
    (el) =>
      el.isVisible !== false &&
      (el.type === 'image' || el.type === 'framed-image') &&
      el.transform.width >= width * 0.9 &&
      (side === 'top' ? el.transform.y <= SEAM_LINE_H : el.transform.y + el.transform.height >= s.canvas.height - SEAM_LINE_H)
  )
}

function withSeamLine(s: CanvasSection, palette: DesignPalette): CanvasSection {
  const dark = !isLight(parseColor(flatBg(s, palette)))
  const [r, g, b] = dark ? [255, 255, 255] : (parseColor(palette.textMain) ?? [51, 51, 51])
  const width = s.canvas.width || 860
  const line: CanvasElement = {
    id: `${s.id}_seam`,
    type: 'shape',
    name: 'rhythm_seam',
    transform: { x: SIDE_MARGIN, y: 0, width: width - SIDE_MARGIN * 2, height: SEAM_LINE_H, rotation: 0 },
    zIndex: 2,
    isLocked: false,
    isVisible: true,
    opacity: 1,
    shapeProps: { shapeType: 'rect', fill: `rgba(${r},${g},${b},${dark ? 0.24 : 0.14})` },
  }
  return { ...s, elements: [...s.elements, line] }
}

/**
 * 바탕 톤이 거의 같은 이웃 경계 표시(R4) — 남은 거터(높이 > 0)는 기본 바탕이 앞 섹션과 다를 때 그 색으로 칠하고,
 * 아니면 뒤 섹션 맨 위에 선을 긋는다. 전폭 사진이 경계에 붙은 쪽이 있으면 두지 않는다. 숨긴 섹션은 화면에 없다.
 */
function markSameToneSeams(sections: CanvasSection[], palette: DesignPalette): CanvasSection[] {
  const base = isLight(parseColor(palette.bgMain)) ? palette.bgMain : WHITE
  const out = [...sections]
  let prev = -1
  let gutters: number[] = []
  out.forEach((s, i) => {
    if (s.isVisible === false) return
    if (s.sectionType === ProSectionType.DIVIDER) {
      gutters.push(i)
      return
    }
    const before = prev >= 0 ? out[prev] : null
    if (
      before &&
      toneDistance(flatBg(before, palette), flatBg(s, palette)) < MIN_TONE_DISTANCE &&
      !flushPhoto(before, 'bottom') &&
      !flushPhoto(s, 'top')
    ) {
      const open = gutters.filter((j) => out[j].canvas.height > 0)
      if (open.length > 0 && toneDistance(base, flatBg(before, palette)) >= MIN_TONE_DISTANCE) {
        for (const j of open) out[j] = { ...out[j], canvas: { ...out[j].canvas, backgroundColor: base } }
      } else {
        out[i] = withSeamLine(s, palette)
      }
    }
    prev = i
    gutters = []
  })
  return out
}
