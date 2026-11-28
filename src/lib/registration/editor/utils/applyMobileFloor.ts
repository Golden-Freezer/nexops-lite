/**
 * 모바일 하한 후처리(ENRICHMENT `mobile`) — docs/plans/pdp-enrichment/00_DESIGN.md §4.8.
 * buildEditorDocument가 section_plan.enrichment에 mobile이 기록된 잡에만, 내재화 테마 적용 뒤에 건다(테마가 하한 아래로 내린 값을 되돌린다).
 * 전 섹션(T3 두 섹션 → T3m 전체). 하한·바탕 판정은 검사기(mobileReadability)와 같은 함수를 쓴다.
 * - 글자: 하한(mobileFontFloor) 미만이면 하한으로 올린다(사용자가 직접 정한 크기는 두고).
 * - 색: 글자 바로 뒤 바탕(감싼 도형 → 섹션 바탕, 반투명은 합성)과 대비가 모자라면(본문 4.5, 60px 이상 3) 색상을 유지한 채
 *   어둡게(밝은 바탕) 또는 밝게(어두운 바탕) 조금씩 섞어 기준을 넘긴다. 사진 위 글자는 빌더의 띠·스크림 소관이라 두지 않는다.
 * - 섹션 경계 여백: 경계의 연속 빈 영역(구분선 포함)이 200px(M4)을 넘지 않게 양쪽 여백을 줄인다.
 *   R4 렌더 리듬(gutterFirst) 잡은 반씩 깎지 않고 거터 → 앞 섹션 아래 여백 → 뒤 섹션 위 여백 순으로 덜어 도입 호흡(위 여백)을 남긴다.
 *   편집기 초기 리플로우는 토큰보다 작은 하단 여백을 그대로 보존한다(editorStore.reflowSection).
 */

import type { CanvasElement, CanvasSection } from '../types/canvas'
import { ProSectionType } from '../types/section'
import {
  backdropBehindText,
  checkMobileReadability,
  contrastRatio,
  isRatingSymbol,
  mobileContrastNeed,
  mobileFontFloor,
  MOBILE_LIMITS,
  parseColor,
  type MobileRuleId,
} from './mobileReadability'

type Rgb = [number, number, number]
const BLACK: Rgb = [0, 0, 0]
const WHITE: Rgb = [255, 255, 255]
const hex = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

/**
 * 대비가 모자란 글자색을 색상을 유지한 채 고친다 — 밝은 바탕이면 검정 쪽, 어두운 바탕이면 흰색 쪽으로 10%씩 섞어
 * 기준(mobileContrastNeed)을 처음 넘는 색. 브랜드 색 제목이 회색으로 바뀌지 않게 한다.
 */
export function readableColor(
  color: string,
  fontSize: number,
  background: Rgb | null,
  need: number = mobileContrastNeed(fontSize)
): string {
  const fg = parseColor(color)
  if (!fg || !background) return color
  if (contrastRatio(fg, background) >= need) return color
  const toward = contrastRatio(BLACK, background) >= contrastRatio(WHITE, background) ? BLACK : WHITE
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    // 돌려줄 값(반올림한 hex)으로 판정해야 검사기와 결과가 같다
    const mixed = hex(fg.map((c, i) => c + (toward[i] - c) * t) as Rgb)
    if (contrastRatio(parseColor(mixed)!, background) >= need) return mixed
  }
  return hex(toward)
}

/** 별점 앰버 단계(밝은 → 진한) — 노랑을 검정과 섞으면 탁한 갈색이 되므로 섞지 않고 단계에서 고른다 */
const AMBER_STEPS = ['#F59E0B', '#D97706', '#B45309', '#92400E']

/**
 * 별점 기호 색 — 바탕 대비 비텍스트 3:1(2026-10-27 통합 결정). 모자라면 앰버 단계 중 3:1을 처음 넘는 색
 * (흰 바탕 #D97706, 연회색 바탕 #B45309). 앰버 단계로 안 되는 중간 톤 바탕은 섞지 않고 검정·흰색 중 대비가 큰 쪽.
 */
export function readableStarColor(color: string, background: Rgb | null): string {
  const fg = parseColor(color)
  const need = MOBILE_LIMITS.nonTextContrast
  if (!fg || !background || contrastRatio(fg, background) >= need) return color
  return (
    AMBER_STEPS.find((c) => contrastRatio(parseColor(c)!, background) >= need) ??
    (contrastRatio(BLACK, background) >= contrastRatio(WHITE, background) ? '#000000' : '#FFFFFF')
  )
}

function floorText(el: CanvasElement, section: CanvasSection): CanvasElement {
  if (el.type !== 'text' || !el.textProps) return el
  const styled = new Set(el.textProps.userStyledKeys ?? [])
  const floor = mobileFontFloor(el)
  const fontSize = !styled.has('fontSize') && el.textProps.fontSize < floor ? floor : el.textProps.fontSize
  const backdrop = backdropBehindText(el, section)
  const background = backdrop === 'photo' ? null : backdrop
  const color = styled.has('color')
    ? el.textProps.color
    : isRatingSymbol(el)
      ? readableStarColor(el.textProps.color, background)
      : readableColor(el.textProps.color, fontSize, background)
  if (fontSize === el.textProps.fontSize && color === el.textProps.color) return el
  return { ...el, textProps: { ...el.textProps, fontSize, color } }
}

/** 섹션 하나로 잴 수 있는 규칙 — M3(첫 화면)·M7(장식 밀도)은 문서 단위라 뺀다. */
const SECTION_MOBILE_RULES: MobileRuleId[] = ['M1', 'M2', 'M4', 'M5', 'M6']

/**
 * 프리셋 적용 결과가 섹션 단위 모바일 위반을 하나라도 늘리는가 — 적용 가능 행렬의 mobileSafe 측정과
 * mobile 기록 잡의 편집기 빌드(실제 카피로 다시 확인, 늘면 빌더 레이아웃 유지)가 같은 판정을 쓴다.
 */
export function worsensSectionMobile(before: CanvasSection, after: CanvasSection): boolean {
  const a = checkMobileReadability({ sections: [before] }).counts
  const b = checkMobileReadability({ sections: [after] }).counts
  return SECTION_MOBILE_RULES.some((rule) => b[rule] > a[rule])
}

/** 섹션 전면 배경 도형 — 검사기(M4)와 같은 기준으로 내용에서 뺀다. */
const isBackdrop = (el: CanvasElement, section: CanvasSection) =>
  el.type === 'shape' &&
  el.transform.width >= section.canvas.width * 0.8 &&
  el.transform.height >= section.canvas.height * 0.8

/** 내용(배경 도형·높이 0 제외)의 위·아래 끝. 내용이 없는 섹션(구분선 등)은 null. */
function contentEdges(section: CanvasSection): { top: number; bottomPad: number } | null {
  const content = section.elements.filter(
    (el) => el.isVisible !== false && !isBackdrop(el, section) && el.transform.height > 0
  )
  if (content.length === 0) return null
  const top = Math.min(...content.map((el) => el.transform.y))
  const bottom = Math.max(...content.map((el) => el.transform.y + el.transform.height))
  return { top, bottomPad: Math.max(0, section.canvas.height - bottom) }
}

/** 위 여백을 shift만큼, 아래 여백을 trim만큼 줄인다. 요소는 함께 올리고 전면 배경 도형은 새 높이에 맞춘다. */
function cutPadding(section: CanvasSection, shift: number, trim: number): CanvasSection {
  if (shift <= 0 && trim <= 0) return section
  const height = section.canvas.height - shift - trim
  const elements = section.elements.map((el) => {
    // 내용 위의 높이 0·숨긴 요소가 음수 y로 밀리지 않게 0에서 멈춘다
    if (!isBackdrop(el, section))
      return { ...el, transform: { ...el.transform, y: Math.max(0, el.transform.y - shift) } }
    return {
      ...el,
      transform: { ...el.transform, height: Math.max(0, Math.min(el.transform.height, height - el.transform.y)) },
    }
  })
  return { ...section, canvas: { ...section.canvas, height }, elements }
}

/**
 * 섹션 경계의 연속 빈 영역(앞 섹션 아래 여백 + 사이의 빈 섹션(구분선) + 다음 섹션 위 여백)을 MOBILE_LIMITS.maxBlankRunPx 이하로 줄인다.
 * 기본은 넘친 만큼 양쪽 여백에서 반씩(한쪽이 모자라면 다른 쪽에서) 덜어낸다. gutterFirst면 사이의 거터(divider) → 앞 섹션 아래 여백
 * → 다음 섹션 위 여백 순으로 덜어낸다. 높이를 직접 정한 섹션(userAdjustedHeight)은 건드리지 않는다.
 */
function capBoundaryBlanks(sections: CanvasSection[], gutterFirst = false): CanvasSection[] {
  const limit = MOBILE_LIMITS.maxBlankRunPx
  const edges = sections.map((s) => (s.isVisible === false ? undefined : contentEdges(s)))
  const cuts = sections.map(() => ({ shift: 0, trim: 0 }))
  /** 줄일 수 있는 여백 — 높이를 직접 정한 섹션은 0 */
  const room = (i: number, side: 'top' | 'bottomPad') => (sections[i].userAdjustedHeight ? 0 : edges[i]![side])
  /** 거터를 먼저 덜어 내고 남은 초과 — 거터(divider)만, 높이를 직접 정한 것은 두고 */
  const cutGutters = (gutters: number[], excess: number) => {
    for (const j of gutters) {
      if (excess <= 0) break
      if (sections[j].sectionType !== ProSectionType.DIVIDER || sections[j].userAdjustedHeight) continue
      cuts[j].trim = Math.min(sections[j].canvas.height, excess)
      excess -= cuts[j].trim
    }
    return excess
  }
  let prev = -1
  let between = 0
  let gutters: number[] = []
  for (let i = 0; i < sections.length; i++) {
    if (edges[i] === undefined) continue // 숨긴 섹션은 화면에 없다
    if (edges[i] === null) {
      between += sections[i].canvas.height // 구분선 같은 빈 섹션은 빈 영역에 더한다
      gutters.push(i)
      continue
    }
    const prevPad = prev >= 0 ? edges[prev]!.bottomPad : 0
    let excess = prevPad + between + edges[i]!.top - limit
    if (excess > 0 && gutterFirst) {
      excess = cutGutters(gutters, excess)
      const trim = prev >= 0 ? Math.min(room(prev, 'bottomPad'), excess) : 0
      if (prev >= 0) cuts[prev].trim = trim
      cuts[i].shift = Math.min(room(i, 'top'), excess - trim)
    } else if (excess > 0) {
      const prevRoom = prev >= 0 ? room(prev, 'bottomPad') : 0
      const shift = Math.min(room(i, 'top'), excess - Math.min(prevRoom, Math.ceil(excess / 2)))
      if (prev >= 0) cuts[prev].trim = Math.min(prevRoom, excess - shift)
      cuts[i].shift = shift
    }
    prev = i
    between = 0
    gutters = []
  }
  if (prev >= 0) {
    let tail = edges[prev]!.bottomPad + between - limit
    if (tail > 0 && gutterFirst) tail = cutGutters(gutters, tail)
    if (tail > 0) cuts[prev].trim = Math.min(room(prev, 'bottomPad'), tail)
  }
  return sections.map((section, i) => cutPadding(section, cuts[i].shift, cuts[i].trim))
}

export function applyMobileFloor(
  sections: CanvasSection[],
  options: { gutterFirst?: boolean } = {}
): CanvasSection[] {
  const floored = sections.map((section) => {
    const elements = section.elements.map((el) => floorText(el, section))
    return elements.some((el, i) => el !== section.elements[i]) ? { ...section, elements } : section
  })
  return capBoundaryBlanks(floored, options.gutterFirst === true)
}
