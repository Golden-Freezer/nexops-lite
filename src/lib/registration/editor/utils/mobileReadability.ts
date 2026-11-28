/**
 * 모바일 판독 검사기 `checkMobileReadability` — docs/plans/pdp-enrichment/00_DESIGN.md §4.8 M1~M8. 순수 함수.
 * 입력은 buildEditorDocument 결과(캔버스 860px). 390×844 폰 기준으로 환산한다: 배율 390/860, 폰 한 화면 = 캔버스 1,860px.
 * 화면·compose는 바꾸지 않는다 — 단위 테스트·오프라인 재생(L2)·실 테스트 하네스(L4)에서 돌린다.
 *
 * 강조 장식(T4)은 요소 이름으로 구분한다: `annotation-label|leader|zoom|number`. 라벨·번호는 배지(글자 + 자기 채움색),
 * 지시선은 SVG, 장식 1개는 같은 groupId 묶음이다(M7은 묶음 수를 센다).
 * 하한·바탕 판정(mobileFontFloor·backdropBehindText·mobileContrastNeedFor)은 mobile 후처리(applyMobileFloor)와 같은 함수를 쓴다.
 */

import { MIN_FONT_SIZES } from '../constants/designTokens'
import type { CanvasElement, CanvasSection } from '../types/canvas'

export const PHONE_SCREEN_CANVAS_PX = 1860
export const ANNOTATION_NAME_PREFIX = 'annotation-'
/**
 * 표 이름(K 좌우 표의 '상품명'·'원산지' 같은 행 이름) — 장식 라벨 규칙(한 줄·32px 이상·12자 이하)을 따라 값 옆에 놓아도 본문 2열이 아니다(M6).
 * 장식과 달리 내용이라 프리셋 적용 때 걷어내지 않는다(applyLayoutPreset). 한 표의 이름은 한 묶음이다(M7).
 */
export const TABLE_NAME_ELEMENT = `${ANNOTATION_NAME_PREFIX}label-spec`
/**
 * K 구조 라벨 캡슐의 글자(POINT 같은 고정 낱말 한 줄, K 린트 '캡슐은 한 줄') — 본문이 아니라 배지라, 캡슐 줄 오른쪽 진행 표시(K1 R-W7)와 나란해도
 * 본문 2열이 아니다(M6). D 캡슐(eyebrow·chapter)은 이름이 달라 그대로 본다
 */
export const STRUCTURE_CAPSULE_TEXT = 'designcut-capsule-text'
export const MOBILE_LIMITS = {
  annotationLabelMinPx: 32,
  annotationLabelMaxChars: 12,
  zoomMinDiameterPx: 260,
  numberBadgeMinPx: 64,
  leaderMinStrokePx: 4,
  productImageMinHeightPx: 500,
  maxBlankRunPx: 200,
  /**
   * D2 장면 모드 문서에서 디자인 컷 섹션이 낀 경계의 빈 영역 — 의도한 섹션 여백(위 120 + 아래 120~140, 통합 결정 10-31). 경계로 나눈
   * 섹션 안 몫은 각각 maxBlankRunPx까지라 사진이 빠져 생긴 빈 칸 같은 섹션 안 빈 영역은 지금처럼 잡는다
   */
  maxSceneSeamBlankPx: 300,
  twoColumnMinWidthPx: 380,
  twoColumnMaxChars: 40,
  maxAnnotationsPerScreen: 3,
  bodyContrast: 4.5,
  largeTitleContrast: 3,
  largeTitleMinPx: 60,
  /** 별점 같은 그래픽 기호 — 비텍스트 대비(WCAG 1.4.11) */
  nonTextContrast: 3,
} as const

export type MobileRuleId = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'M7'
export interface MobileViolation {
  rule: MobileRuleId
  section: string
  element?: string
  detail: string
}
export interface MobileReadabilityReport {
  violations: MobileViolation[]
  counts: Record<MobileRuleId, number>
  /** M8(보고만) — 총 높이와 폰 화면 수, 대조군 대비 길이 비율 */
  pageHeightPx: number
  phoneScreens: number
  lengthRatioToBaseline?: number
  lengthWarning?: string
}

/** 상품·가치 컷을 담는 섹션 — M5 이미지 높이 하한 대상 */
const PRODUCT_IMAGE_SECTIONS = new Set(['main_cut', 'product_exposure', 'point_div', 'sub_div'])
const TEXT_SURFACE_SHAPES = new Set(['rect', 'roundedRect', 'circle', 'ellipse', 'speechBubble'])
/** M6 — 이 글자 수 이하 표식(번호·이니셜·기호)은 본문 열이 아니다. 배지 크기는 M5(장식)·M1(글자 하한)이 본다. */
const MARK_MAX_CHARS = 3

interface Placed {
  el: CanvasElement
  section: CanvasSection
  top: number
  bottom: number
  left: number
  right: number
}

/** #rgb·#rrggbb·rgb()/rgba() → [r,g,b] 0~255. 그 밖(그라데이션·투명 등)은 판정 불가로 null. */
export function parseColor(value: string | undefined | null): [number, number, number] | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  let m = /^#([0-9a-f]{3})$/.exec(v)
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number]
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v)
  if (m) {
    if (m[2] && parseInt(m[2], 16) < 200) return null // 반투명은 판정하지 않는다
    return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number]
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v)
  if (m) {
    if (m[4] !== undefined && Number(m[4]) < 0.8) return null
    return [Number(m[1]), Number(m[2]), Number(m[3])]
  }
  return null
}

/** 반투명 바탕을 아래 색 위에 합성한 색 — transparent·알파 있는 hex/rgba. 해석할 수 없으면 null. */
export function blendOver(
  fill: string | undefined | null,
  base: [number, number, number] | null
): [number, number, number] | null {
  if (!fill) return null
  const v = fill.trim().toLowerCase()
  if (v === 'transparent') return base
  let rgb: [number, number, number] | null = null
  let alpha = 1
  let m = /^#([0-9a-f]{6})([0-9a-f]{2})$/.exec(v)
  if (m) {
    rgb = [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number]
    alpha = parseInt(m[2], 16) / 255
  }
  m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(v)
  if (m) {
    rgb = [Number(m[1]), Number(m[2]), Number(m[3])]
    alpha = Number(m[4])
  }
  if (!rgb) return parseColor(fill)
  if (alpha >= 1) return rgb
  if (!base) return null
  return rgb.map((c, i) => Math.round(c * alpha + base[i] * (1 - alpha))) as [number, number, number]
}

/** 완전 투명 채움 — transparent, 알파 00 hex, 알파 0 rgba */
export function isClearFill(fill: string | undefined | null): boolean {
  const v = (fill ?? '').trim().toLowerCase()
  return v === 'transparent' || /^#[0-9a-f]{6}00$/.test(v) || /^rgba\([^)]*,\s*0(\.0*)?\s*\)$/.test(v)
}

/** WCAG 2.x 상대 휘도 대비. */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const lum = ([r, g, bl]: [number, number, number]) => {
    const ch = (c: number) => {
      const s = c / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(bl)
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function place(sections: CanvasSection[]): { placed: Placed[]; offsets: Map<string, number>; height: number } {
  const placed: Placed[] = []
  const offsets = new Map<string, number>()
  let offset = 0
  for (const section of sections) {
    offsets.set(section.id, offset)
    for (const el of section.elements) {
      if (el.isVisible === false) continue // 숨긴 요소는 그려지지 않는다
      const t = el.transform
      placed.push({ el, section, top: offset + t.y, bottom: offset + t.y + t.height, left: t.x, right: t.x + t.width })
    }
    offset += section.canvas.height
  }
  return { placed, offsets, height: offset }
}

/** 강조 장식 요소(T4) — 프리셋 유실 가드·매칭과 렌더 대상 이미지 판정에서 뺀다 */
export function isAnnotationElement(el: CanvasElement): boolean {
  return el.name?.startsWith(ANNOTATION_NAME_PREFIX) ?? false
}
const isAnnotation = isAnnotationElement
const textOf = (el: CanvasElement) => (el.textProps?.content ?? '').replace(/\s+/g, '')
/** 지시선 굵기 — 도형 선이면 strokeWidth, SVG면 가장 가는 stroke-width(밑깔이 흰 선보다 가는 본선) */
function leaderStroke(el: CanvasElement): number {
  if (el.shapeProps?.strokeWidth !== undefined) return el.shapeProps.strokeWidth
  const widths = [...(el.svgProps?.svgString ?? '').matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]))
  return widths.length > 0 ? Math.min(...widths) : 0
}
/** D2 장면 모드 문서 — 디자인 컷 장면 사진(요소 이름 designcut-scene, 장면 모드에서만 그린다)이 있는 문서 */
const isSceneDocument = (sections: CanvasSection[]) =>
  sections.some((s) => s.elements.some((e) => e.name === 'designcut-scene' && e.isVisible !== false))
const isDesignCutSection = (s: CanvasSection) => s.layoutId.startsWith('designcut_')
const isBackdrop = (p: Placed) =>
  p.el.type === 'shape' &&
  p.el.transform.width >= p.section.canvas.width * 0.8 &&
  p.el.transform.height >= p.section.canvas.height * 0.8

/** 글자 하한(M1) — 장식 라벨 32, footer·법정 표시 24, 그 밖은 위계별 MIN_FONT_SIZES. */
export function mobileFontFloor(el: CanvasElement): number {
  if (isAnnotation(el)) return MOBILE_LIMITS.annotationLabelMinPx
  if (/footer|legal|notice|disclaimer/i.test(el.name ?? '')) return MIN_FONT_SIZES.footer
  return MIN_FONT_SIZES[el.textProps?.typoLevel ?? 'caption']
}

/** 대비 기준(M2) — 60px 이상 제목 3, 그 밖 4.5. */
export function mobileContrastNeed(fontSize: number): number {
  return fontSize >= MOBILE_LIMITS.largeTitleMinPx ? MOBILE_LIMITS.largeTitleContrast : MOBILE_LIMITS.bodyContrast
}

/** 별점 기호(★☆만으로 된 글자) — 읽는 글자가 아니라 그래픽 기호다 */
export function isRatingSymbol(el: CanvasElement): boolean {
  const content = (el.textProps?.content ?? '').replace(/\s+/g, '')
  return content.length > 0 && /^[★☆]+$/.test(content)
}

/** 요소별 대비 기준 — 별점 기호는 비텍스트 3:1(2026-10-27 통합 결정), 그 밖은 글자 크기 기준 */
export function mobileContrastNeedFor(el: CanvasElement): number {
  return isRatingSymbol(el) ? MOBILE_LIMITS.nonTextContrast : mobileContrastNeed(el.textProps?.fontSize ?? 0)
}

/**
 * 글자 바로 뒤 바탕(같은 섹션, 글자보다 아래 z) — 사진이 맨 위면 'photo'(띠·스크림 필요), 글자를 감싼 도형이 있으면
 * 그 채움(반투명은 섹션 바탕에 합성, 띠 아래가 사진이면 판정 불가), 없으면 섹션 바탕. 판정할 수 없으면 null.
 */
export function backdropBehindText(
  el: CanvasElement,
  section: CanvasSection
): [number, number, number] | 'photo' | null {
  const t = el.transform
  const box = { left: t.x, right: t.x + t.width, top: t.y, bottom: t.y + t.height }
  const behind = section.elements.filter((q) => {
    if (q === el || q.isVisible === false || q.zIndex >= el.zIndex) return false
    const r = q.transform
    return r.x < box.right && box.left < r.x + r.width && r.y < box.bottom && box.top < r.y + r.height
  })
  const top = (list: CanvasElement[]) => list.sort((a, b) => b.zIndex - a.zIndex)[0]
  const photo = top(behind.filter((q) => q.type === 'image' || q.type === 'framed-image'))
  const surfaces = behind
    .filter((q) => {
      const r = q.transform
      const inside = r.x <= box.left && r.x + r.width >= box.right && r.y <= box.top && r.y + r.height >= box.bottom
      return q.type === 'shape' && TEXT_SURFACE_SHAPES.has(q.shapeProps?.shapeType ?? '') && inside
    })
    .sort((a, b) => b.zIndex - a.zIndex)
  // 완전 투명 상자(K 표 행 묶음 등)는 칠하지 않으니 그 아래 칠한 상자(띠·카드)를 본다. 투명 상자만 있으면 전과 같다(K10)
  const surface = surfaces.find((q) => !isClearFill(q.shapeProps?.fill)) ?? surfaces[0]
  if (photo && (!surface || surface.zIndex < photo.zIndex)) return 'photo'
  // 띠 아래에 사진이 있으면 반투명 띠의 합성색은 알 수 없다(불투명 띠만 판정) — 사진 위 띠·스크림은 M2의 요구를 이미 채운다
  const base = photo ? null : parseColor(section.canvas.backgroundColor)
  return surface ? blendOver(surface.shapeProps?.fill, base) : base
}

export function checkMobileReadability(
  doc: { sections: CanvasSection[] },
  options: { baselineHeightPx?: number } = {}
): MobileReadabilityReport {
  const visible = doc.sections.filter((s) => s.isVisible !== false)
  const { placed, height } = place(visible)
  const violations: MobileViolation[] = []
  const add = (rule: MobileRuleId, p: Placed | CanvasSection, detail: string) => {
    const section = 'section' in p ? p.section : p
    violations.push({
      rule,
      section: String(section.sectionType),
      ...('el' in p ? { element: p.el.name || p.el.id } : {}),
      detail,
    })
  }
  // 장식 라벨·번호 배지는 글자로 본다(하한 32, 자기 채움색 위 대비) — 다른 배지는 기존 기준선 그대로 둔다
  const texts = placed.filter(
    (p) => (p.el.type === 'text' || (p.el.type === 'badge' && isAnnotation(p.el))) && textOf(p.el)
  )

  // M1 — 글자 하한
  for (const p of texts) {
    const size = p.el.textProps!.fontSize
    const floor = mobileFontFloor(p.el)
    if (size < floor) add('M1', p, `글자 ${size}px < 하한 ${floor}px(${p.el.textProps?.typoLevel ?? 'caption'})`)
  }

  // M2 — 명도 대비(단색·반투명 바탕은 합성색 기준) / 사진 위 글자는 띠·스크림 필요
  for (const p of texts) {
    const bg = p.el.type === 'badge' ? parseColor(p.el.shapeProps?.fill) : backdropBehindText(p.el, p.section)
    if (bg === 'photo') {
      add('M2', p, '사진 위 글자 — 아래 띠·스크림 요소 없음')
      continue
    }
    const fg = parseColor(p.el.textProps!.color)
    if (!bg || !fg) continue
    const need = mobileContrastNeedFor(p.el)
    const ratio = contrastRatio(fg, bg)
    if (ratio < need) add('M2', p, `명도 대비 ${ratio.toFixed(2)} < ${need}`)
  }

  // M3 — 첫 화면(캔버스 상단 1,860px)에 상품 이미지와 가치 제목(제목급 글자). 섹션 순서 기준 첫 가치 위치는 R1이 본다 —
  // 섹션 하나가 1,000px를 넘는 캔버스에서 usp 섹션 제목이 첫 화면에 들어올 수 없어, 높이 기준은 첫 화면의 제목급 문구로 확인한다.
  const firstScreen = placed.filter((p) => p.top < PHONE_SCREEN_CANVAS_PX)
  const hasImage = firstScreen.some(
    (p) => (p.el.type === 'image' || p.el.type === 'framed-image') && p.el.transform.height >= 200
  )
  const hasTitle = firstScreen.some(
    (p) => p.el.type === 'text' && textOf(p.el) && ['display', 'h1', 'h2'].includes(p.el.textProps?.typoLevel ?? '')
  )
  const firstSection = visible[0]
  if (firstSection && !hasImage) add('M3', firstSection, '첫 화면에 상품 이미지 없음')
  if (firstSection && !hasTitle) add('M3', firstSection, '첫 화면에 제목급 가치 문구 없음')

  // M4 — 연속 빈 영역 200px 초과(섹션 경계를 넘어 이어 잰다, 섹션 전면 배경 도형은 내용으로 보지 않는다). 장면 모드 문서의 디자인 컷
  // 경계는 합 300까지, 경계로 나눈 섹션 안 몫은 각각 200까지(maxSceneSeamBlankPx)
  const starts = visible.map((_, i) => visible.slice(0, i).reduce((sum, x) => sum + x.canvas.height, 0))
  const scene = isSceneDocument(visible)
  const blankViolates = (from: number, to: number) => {
    if (to - from <= MOBILE_LIMITS.maxBlankRunPx) return false
    const seams = starts.flatMap((s, i) => (i > 0 && s > from && s < to ? [i] : []))
    const sceneSeam = scene && seams.length > 0 && seams.every((i) => isDesignCutSection(visible[i - 1]) || isDesignCutSection(visible[i]))
    if (!sceneSeam || to - from > MOBILE_LIMITS.maxSceneSeamBlankPx) return true
    const points = [from, ...seams.map((i) => starts[i]), to]
    return points.slice(1).some((p, k) => p - points[k] > MOBILE_LIMITS.maxBlankRunPx)
  }
  const intervals = placed
    .filter((p) => !isBackdrop(p) && p.el.transform.height > 0)
    .map((p) => [p.top, p.bottom] as const)
    .sort((a, b) => a[0] - b[0])
  let cursor = 0
  for (const [top, bottom] of intervals) {
    if (blankViolates(cursor, top)) {
      const at = visible.find((s, i) => top >= starts[i] && top < starts[i] + s.canvas.height)
      if (at) add('M4', at, `빈 영역 ${Math.round(top - cursor)}px(${Math.round(cursor)}~${Math.round(top)})`)
    }
    cursor = Math.max(cursor, bottom)
  }
  if (height - cursor > MOBILE_LIMITS.maxBlankRunPx && visible.length) {
    add('M4', visible[visible.length - 1], `하단 빈 영역 ${Math.round(height - cursor)}px`)
  }

  // M5 — 상품·가치 컷 높이, 장식 크기
  for (const p of placed) {
    const { el } = p
    if (
      (el.type === 'image' || el.type === 'framed-image') &&
      !isAnnotation(el) &&
      PRODUCT_IMAGE_SECTIONS.has(String(p.section.sectionType))
    ) {
      if (el.transform.height < MOBILE_LIMITS.productImageMinHeightPx && el.transform.width >= 300) {
        add('M5', p, `상품·가치 컷 높이 ${el.transform.height}px < ${MOBILE_LIMITS.productImageMinHeightPx}px`)
      }
    }
    if (!isAnnotation(el)) continue
    const kind = el.name.slice(ANNOTATION_NAME_PREFIX.length)
    const diameter = Math.min(el.transform.width, el.transform.height)
    if (kind.startsWith('zoom') && diameter < MOBILE_LIMITS.zoomMinDiameterPx)
      add('M5', p, `원형 확대 ${diameter}px < 260px`)
    if (kind.startsWith('number') && diameter < MOBILE_LIMITS.numberBadgeMinPx)
      add('M5', p, `번호 배지 ${diameter}px < 64px`)
    if (kind.startsWith('leader') && leaderStroke(el) < MOBILE_LIMITS.leaderMinStrokePx)
      add('M5', p, '지시선 굵기 < 4px')
    if (kind.startsWith('label') && (el.type === 'text' || el.type === 'badge')) {
      const content = el.textProps?.content ?? ''
      if (content.includes('\n') || content.trim().length > MOBILE_LIMITS.annotationLabelMaxChars) {
        add('M5', p, '장식 라벨은 한 줄·12자 이하')
      }
    }
  }

  // M6 — 2열 배치: 같은 높이대에 나란한 본문 글자 열은 열 폭 380px 이상·열당 40자 이하(3자 이하 표식은 열이 아니다)
  for (const p of texts) {
    if (isAnnotation(p.el) || p.el.name === STRUCTURE_CAPSULE_TEXT || ['display', 'h1'].includes(p.el.textProps?.typoLevel ?? '')) continue
    if ([...textOf(p.el)].length <= MARK_MAX_CHARS) continue
    const sideBySide = placed.some(
      (q) =>
        q !== p &&
        q.section === p.section &&
        !isBackdrop(q) &&
        q.el.type !== 'shape' &&
        q.top < p.bottom &&
        p.top < q.bottom &&
        (q.right <= p.left || q.left >= p.right)
    )
    if (!sideBySide) continue
    const len = textOf(p.el).length
    if (p.el.transform.width < MOBILE_LIMITS.twoColumnMinWidthPx || len > MOBILE_LIMITS.twoColumnMaxChars) {
      add('M6', p, `2열 본문 — 폭 ${p.el.transform.width}px·${len}자(기준 ≥ 380px·≤ 40자)`)
    }
  }

  // M7 — 폰 한 화면 안 장식 3개 이하(장식 1개 = 같은 groupId 묶음, 위치는 묶음의 맨 위)
  const groups = new Map<string, Placed>()
  for (const p of placed.filter((q) => isAnnotation(q.el))) {
    const key = p.el.groupId ?? p.el.id
    const seen = groups.get(key)
    if (!seen || p.top < seen.top) groups.set(key, p)
  }
  const annotations = [...groups.values()].sort((a, b) => a.top - b.top)
  for (let i = 0; i < annotations.length; i++) {
    const window = annotations.filter(
      (q) => q.top >= annotations[i].top && q.top < annotations[i].top + PHONE_SCREEN_CANVAS_PX
    )
    if (window.length > MOBILE_LIMITS.maxAnnotationsPerScreen) {
      add('M7', annotations[i], `한 화면 장식 ${window.length}개 > 3`)
      break
    }
  }

  const counts = { M1: 0, M2: 0, M3: 0, M4: 0, M5: 0, M6: 0, M7: 0 } as Record<MobileRuleId, number>
  for (const v of violations) counts[v.rule]++
  const ratio = options.baselineHeightPx ? height / options.baselineHeightPx : undefined
  return {
    violations,
    counts,
    pageHeightPx: height,
    phoneScreens: Math.round((height / PHONE_SCREEN_CANVAS_PX) * 10) / 10,
    ...(ratio !== undefined ? { lengthRatioToBaseline: Math.round(ratio * 100) / 100 } : {}),
    ...(ratio !== undefined && ratio > 1.2
      ? { lengthWarning: `대조군보다 ${Math.round((ratio - 1) * 100)}% 길다(M8 경고)` }
      : {}),
  }
}
