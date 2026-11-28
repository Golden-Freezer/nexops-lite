// ─── 편집기 판독성(pdp-enrichment R3 r7) ─────────────────────────────────────────
// R1 심사 r7 — P02 Claude "화면 1·2의 작은 주황 서브카피는 겨우 읽히고, 인물 사진은 여러 화면을 차지한다", 코덱스 "2번 화면의 카드
// 설명은 작다", P03·P07 "2열 카드 설명과 상단 보조 문구는 작고 옅다". 검사기(M1 caption 28·M2 4.5)는 통과했지만 보조 문구가
// caption 28~36px(폰 12~16px)이고, hook 그라디언트 바탕 위 글자는 대비를 재지 않는다(검사기가 단색만 판정).
// persuasion 기록 잡의 최초 빌드에만 건다 — Track S·대조군·디자인 컷 잡은 그대로.
// ① capScenePhotos: 인물·연출 컷(문제·해결·사용 장면 등) 전폭 사진 높이를 1:1(860)로 — 톤 리듬 전에(사진 주도 판정이 최종 높이를 보게)
// ② applyLegibleText: hook·main_cut·problem 섹션의 보조 문구와 카드 설명을 본문 하한(MIN_FONT_SIZES.body)으로 올리고 아래를 다시
//    늘어놓는다. 글자색은 바로 뒤 바탕(그라디언트면 모든 색 끝) 대비 4.5 이상 — 모자라면 같은 색상을 진하게. 강조색으로 칠한 작은
//    글자는 7 이상(P02 hook 주황 문구 45px·4.74를 심사가 "겨우 읽힌다"고 함 — 통합 결정). 톤 리듬 뒤에 건다.

import type { CanvasElement, CanvasSection } from '../types/canvas'
import { MIN_FONT_SIZES } from '../constants/designTokens'
import { ProSectionType } from '../types/section'
import { backdropBehindText, contrastRatio, isAnnotationElement, MOBILE_LIMITS, parseColor } from './mobileReadability'
import { estimateWrappedLines } from './sectionConverter/helpers'

/**
 * 인물·연출 컷 높이 상한 — 1:1. 폰 한 화면(캔버스 1,860)에 섹션 제목·사진·문구가 함께 들어오는 높이다(3:4 1,147은 화면의 62%라
 * 제목과 합치면 화면 경계를 넘는다). 생성 컷(2:3)을 덮어 자르면 세로 2/3가 보이고, 연출 지시가 핵심을 두게 한 30~70% 띠
 * (shot-direction MOBILE_FRAMING_PHRASE)는 남는다.
 */
export const SCENE_PHOTO_MAX_PX = 860
/**
 * 인물·연출 컷(imageType = 생성 태스크) — 제품이 없거나 사람이 주인공인 장면. 상품 사진(hero·premium_hero·product_exposure·
 * direction_hint·features·옵션 실물 등)은 크기가 곧 상품 정보라 상한을 두지 않는다(M5 상품 컷 하한과 같은 쪽).
 */
export const SCENE_IMAGE_TYPES = new Set(['problem', 'empathy_scene', 'solution', 'usage', 'comparison_scene'])
/**
 * 사람만 나오는 장면(제품 없음 — shot-direction 'Scene only') — 가운데로 자르면 얼굴이 눈높이에서 잘린다(R1 P02 problem 실측).
 * 위쪽 정렬(verticalAlign top — 편집기·내보내기·장식 투영이 같은 object-position)로 머리를 남긴다. 자르기 창(cropRect)은 원본 비율을
 * 가정해야 해서(Gemini·사진 교체는 2:3이 아닐 수 있다) 쓰지 않는다. 제품이 나오는 장면(solution·usage)은 제품이 가운데라 가운데 그대로.
 */
const PERSON_SCENE_TYPES = new Set(['problem', 'empathy_scene'])
/** 보조 문구 판독 대상 — 첫 화면(hook)·둘째 화면(main_cut 요약 카드)·고민(problem) */
export const LEGIBLE_SECTIONS = new Set<string>([
  ProSectionType.HOOK_3STEP,
  ProSectionType.MAIN_CUT,
  ProSectionType.PROBLEM_RAISE,
  ProSectionType.PROBLEM_EMPATHY,
])
/**
 * 강조색 작은 글자(본문 하한의 1.25배 이하)의 대비 목표 — 4.5를 넘는 주황(4.74)도 폰에서 "겨우 읽힌다"(R1 P02 hook). 큰 제목은 대상이
 * 아니다(제목급은 이 처리에서 빠진다). 같은 색상 계열로 ACCENT_MAX_MIX까지만 진하게 하고, 그래도 안 되면 4.5 색에 굵기를 한 단계 올린다.
 */
export const ACCENT_SMALL_CONTRAST = 7
const ACCENT_SMALL_MAX_PX = MIN_FONT_SIZES.body * 1.25
/** 강조색 판정 — RGB 채널 최대−최소. 본문 먹색(#262626·#232823·#1a1611)은 0~9, 세이지 primary(#4a624a)도 24 */
const ACCENT_MIN_CHROMA = 20
/** 같은 색상 계열로 보는 섞기 상한(검정·흰색 쪽 50%) — 더 섞으면 먹색·흰색이 된다 */
const ACCENT_MAX_MIX = 0.5
/** 굵기 한 단계 */
const WEIGHT_STEP = 100
/** 3자 이하 숫자·기호(01·✓·※) 또는 라틴 한 글자(A)는 문구가 아니라 표식이다 — 한글·라틴 3자 라벨(초경량·LED·S/L)은 문구다 */
const MARK_MAX_CHARS = 3
const MARK_PATTERN = /^(?:[0-9\p{P}\p{S}]+|[A-Za-z])$/u
const HEADING_LEVELS = new Set(['display', 'h1', 'h2'])

type Rgb = [number, number, number]
const BLACK: Rgb = [0, 0, 0]
const WHITE: Rgb = [255, 255, 255]
const hex = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
const isImage = (el: CanvasElement) => el.type === 'image' || el.type === 'framed-image'
const bottomOf = (el: CanvasElement) => el.transform.y + el.transform.height
const overlapsY = (a: CanvasElement, b: CanvasElement) => a.transform.y < bottomOf(b) && b.transform.y < bottomOf(a)
const overlapsX = (a: CanvasElement, b: CanvasElement) =>
  a.transform.x < b.transform.x + b.transform.width && b.transform.x < a.transform.x + a.transform.width

/** 이 요소 위(z가 더 큰)에 겹친 글자가 있는가 — 사진 위 글자 배치(오버레이)는 사진 높이를 바꾸지 않는다 */
function hasTextOver(section: CanvasSection, image: CanvasElement): boolean {
  return section.elements.some(
    (el) =>
      el !== image &&
      el.isVisible !== false &&
      (el.type === 'text' || el.type === 'badge') &&
      el.zIndex > image.zIndex &&
      overlapsY(el, image) &&
      overlapsX(el, image)
  )
}

/** 글자가 사진 위에 놓였는가(사진이 글자보다 아래 z) — 크기·색은 띠·스크림을 둔 배치 소관이라 두지 않는다 */
function isOverPhoto(section: CanvasSection, text: CanvasElement): boolean {
  return section.elements.some(
    (el) =>
      isImage(el) && el.isVisible !== false && el.zIndex < text.zIndex && overlapsY(el, text) && overlapsX(el, text)
  )
}

/**
 * 요소 높이 변화(id → 증감, 한 번에 같은 부호)를 섹션에 반영한다. 요소의 이동량은 그 위(아래끝 ≤ 요소 위끝)에 있는 변화 요소의
 * '이동 + 변화' 중 가장 큰 값(줄면 가장 작은 값)이다 — 2열 카드 한 행처럼 나란한 변화는 더하지 않고, 같은 열로 쌓인 변화(상품명 →
 * 옵션 줄)는 더해진다. 변화 요소를 세로로 감싸는 도형(카드 바탕·왼쪽 띠·섹션 배경)은 감싼 변화의 끝까지 늘린다. 섹션 높이도 같이.
 */
function reflowSection(section: CanvasSection, deltas: Map<string, number>): CanvasSection {
  const changed = section.elements.filter((el) => deltas.get(el.id)).sort((a, b) => a.transform.y - b.transform.y)
  if (changed.length === 0) return section
  const grows = deltas.get(changed[0].id)! > 0
  const pick = (a: number, b: number) => (grows ? Math.max(a, b) : Math.min(a, b))
  const shiftOf = new Map<string, number>()
  const reach = (c: CanvasElement) => shiftOf.get(c.id)! + deltas.get(c.id)!
  const pushedBy = (top: number) =>
    changed.filter((c) => shiftOf.has(c.id) && bottomOf(c) <= top + 0.5).reduce((s, c) => pick(s, reach(c)), 0)
  // 위끝 순서로 — 어떤 변화 요소 위에 있는 변화 요소는 위끝이 더 작아 먼저 정해진다
  for (const c of changed) shiftOf.set(c.id, pushedBy(c.transform.y))
  const elements = section.elements.map((el) => {
    const shift = shiftOf.get(el.id) ?? pushedBy(el.transform.y)
    let grow = deltas.get(el.id) ?? 0
    if (el.type === 'shape' && !deltas.has(el.id)) {
      const inside = changed.filter((c) => el.transform.y <= c.transform.y + 0.5 && bottomOf(el) >= bottomOf(c) - 0.5)
      if (inside.length > 0) grow = inside.reduce((s, c) => pick(s, reach(c)), shift) - shift
    }
    if (shift === 0 && grow === 0) return el
    return {
      ...el,
      transform: { ...el.transform, y: el.transform.y + shift, height: Math.max(0, el.transform.height + grow) },
    }
  })
  const total = changed.reduce((s, c) => pick(s, reach(c)), 0)
  return { ...section, elements, canvas: { ...section.canvas, height: section.canvas.height + total } }
}

/** 인물·연출 컷 전폭 사진 높이를 SCENE_PHOTO_MAX_PX로 줄이고 아래 요소를 올린다(글자를 얹은 사진·직접 자른 사진은 그대로). */
export function capScenePhotos(sections: CanvasSection[]): CanvasSection[] {
  return sections.map((section) => {
    const width = section.canvas.width || 860
    const deltas = new Map<string, number>()
    const topAligned = new Set<string>()
    for (const el of section.elements) {
      const type = el.imageProps?.imageType ?? el.framedImageProps?.imageType ?? ''
      if (!isImage(el) || el.isVisible === false || !SCENE_IMAGE_TYPES.has(type)) continue
      if (el.transform.height <= SCENE_PHOTO_MAX_PX || el.transform.width < width * 0.9) continue
      if (el.imageProps?.cropRect || el.framedImageProps?.cropRect || hasTextOver(section, el)) continue
      deltas.set(el.id, SCENE_PHOTO_MAX_PX - el.transform.height)
      if (PERSON_SCENE_TYPES.has(type)) topAligned.add(el.id)
    }
    const capped = reflowSection(section, deltas)
    if (topAligned.size === 0) return capped
    const elements = capped.elements.map((el) =>
      topAligned.has(el.id) ? { ...el, verticalAlign: 'top' as const } : el
    )
    return { ...capped, elements }
  })
}

/** 섹션 전면 배경 도형 — 검사기(M4)·applyMobileFloor와 같은 기준으로 내용에서 뺀다 */
const isBackdrop = (el: CanvasElement, section: CanvasSection) =>
  el.type === 'shape' && el.transform.width >= section.canvas.width * 0.8 && el.transform.height >= section.canvas.height * 0.8

/**
 * 사진 마감(R4 심사 — 전폭 사진 아래 빈 띠): 맨 아래 내용이 전폭 사진이면 섹션 하단 여백을 없앤다. 사진 가장자리가 곧 섹션 끝이다.
 * 변환의 isFullBleedClosure는 y≤0 배너만 보므로 고민 목록 아래 인물 컷처럼 섹션 중간에서 시작하는 전폭 사진 밑에 하단 여백(140)이
 * 남아 거터와 함께 빈 띠가 됐다(P02 화면 4·9, P07 화면 4). 사용자가 높이를 고친 섹션·전면 배경 도형은 건드리지 않는다.
 */
export function closePhotoBottoms(sections: CanvasSection[]): CanvasSection[] {
  return sections.map((section) => {
    const width = section.canvas.width || 860
    const content = section.elements.filter((el) => el.isVisible !== false && el.transform.height > 0 && !isBackdrop(el, section))
    if (content.length === 0 || section.userAdjustedHeight) return section
    const bottom = Math.max(...content.map(bottomOf))
    const closing = content.some((el) => isImage(el) && el.transform.x <= 0 && el.transform.width >= width && bottomOf(el) >= bottom - 1)
    const height = Math.ceil(bottom)
    if (!closing || height >= section.canvas.height) return section
    const elements = section.elements.map((el) =>
      isBackdrop(el, section) ? { ...el, transform: { ...el.transform, height: Math.min(el.transform.height, height - el.transform.y) } } : el
    )
    return { ...section, canvas: { ...section.canvas, height }, elements }
  })
}

/** 그라디언트 바탕의 색 끝들 — 단색이면 [그 색], 해석할 수 없으면 [] */
export function backgroundStops(background: string | undefined): string[] {
  if (!background) return []
  if (!background.includes('gradient')) return parseColor(background) ? [background] : []
  // 색 끝을 하나라도 못 읽으면(색 이름·hsl·반투명) 판정하지 않는다 — 일부 끝만 재면 대비를 잘못 보장한다
  const tokens = background.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b[a-z]+(?=\s+-?\d|\s*[,)])/gi) ?? []
  const colors = tokens.filter(
    (t) => !/^(linear|radial|conic|repeating|to|deg|top|bottom|left|right|at|circle|ellipse)$/i.test(t)
  )
  return colors.length >= 2 && colors.every((c) => parseColor(c) !== null) ? colors : []
}

/**
 * 글자 바로 뒤 바탕 후보 — 검사기와 같은 판정(backdropBehindText)을 섹션 바탕의 색 끝마다 한 번씩. 사진 위면 'photo',
 * 판정할 수 없으면 빈 목록.
 */
export function textBackdrops(el: CanvasElement, section: CanvasSection): Rgb[] | 'photo' {
  const stops = backgroundStops(section.canvas.backgroundColor)
  const probes = stops.length > 0 ? stops : [section.canvas.backgroundColor]
  const out: Rgb[] = []
  for (const stop of probes) {
    const backdrop = backdropBehindText(el, { ...section, canvas: { ...section.canvas, backgroundColor: stop } })
    if (backdrop === 'photo') return 'photo'
    if (backdrop) out.push(backdrop)
  }
  return out
}

/**
 * 모든 바탕 후보에서 need 이상이 되는 색 — 가장 불리한 후보가 밝으면 검정 쪽, 어두우면 흰색 쪽으로 10%씩 maxMix까지 섞어
 * 처음 넘는 색(색상 유지, 반올림한 hex로 판정 — 검사기와 같은 값). 이미 넘으면 그대로, 끝내 못 넘으면 null.
 */
export function shadeToContrast(color: string, backdrops: Rgb[], need: number, maxMix = 1): string | null {
  const fg = parseColor(color)
  if (!fg || backdrops.length === 0) return null
  const passes = (c: Rgb) => backdrops.every((b) => contrastRatio(c, b) >= need)
  if (passes(fg)) return color
  const worst = [...backdrops].sort((a, b) => contrastRatio(fg, a) - contrastRatio(fg, b))[0]
  const toward = contrastRatio(BLACK, worst) >= contrastRatio(WHITE, worst) ? BLACK : WHITE
  for (let step = 1; step <= Math.round(maxMix * 10); step++) {
    const mixed = hex(fg.map((c, i) => c + ((toward[i] - c) * step) / 10) as Rgb)
    if (passes(parseColor(mixed)!)) return mixed
  }
  return null
}

/** 모든 바탕 후보에서 4.5 이상(MOBILE_LIMITS.bodyContrast)이 되게 같은 색상을 진하게(또는 밝게) — 안 되면 원래 색 */
export function legibleColor(color: string, backdrops: Rgb[]): string {
  return shadeToContrast(color, backdrops, MOBILE_LIMITS.bodyContrast) ?? color
}

/** 강조색(채도 있는 색)인가 — 먹색·회색 본문은 아니다 */
export function isAccentColor(color: string): boolean {
  const rgb = parseColor(color)
  return rgb !== null && Math.max(...rgb) - Math.min(...rgb) >= ACCENT_MIN_CHROMA
}

/**
 * 보조 문구 색·굵기 — 강조색 작은 글자는 대비 7(같은 색상 계열로 ACCENT_MAX_MIX까지), 안 되면 4.5 색 + 굵기 한 단계.
 * 그 밖은 4.5. 바탕을 모르면(빈 후보) 그대로.
 */
function legibleStyle(p: NonNullable<CanvasElement['textProps']>, fontSize: number, backdrops: Rgb[]) {
  if (!isAccentColor(p.color) || fontSize > ACCENT_SMALL_MAX_PX || backdrops.length === 0) {
    return { color: legibleColor(p.color, backdrops), fontWeight: p.fontWeight }
  }
  const strong = shadeToContrast(p.color, backdrops, ACCENT_SMALL_CONTRAST, ACCENT_MAX_MIX)
  if (strong) return { color: strong, fontWeight: p.fontWeight }
  // 4.5도 못 맞추는 바탕(밝음·어둠이 섞인 그라디언트 등)은 색·굵기를 그대로 둔다 — 굵기만 올려 대비 문제를 가리지 않는다
  const base = shadeToContrast(p.color, backdrops, MOBILE_LIMITS.bodyContrast)
  if (!base) return { color: p.color, fontWeight: p.fontWeight }
  const styled = new Set(p.userStyledKeys ?? [])
  const fontWeight = styled.has('fontWeight') ? p.fontWeight : Math.min(900, (p.fontWeight || 400) + WEIGHT_STEP)
  return { color: base, fontWeight }
}

/** 보조 문구·카드 설명인가 — 제목급·표식·장식·법정 표시·사진 위 글자는 뺀다 */
function isSupportingText(el: CanvasElement, section: CanvasSection): boolean {
  if (el.type !== 'text' || !el.textProps || el.isVisible === false || isAnnotationElement(el)) return false
  const content = el.textProps.content.replace(/\s+/g, '')
  if ([...content].length <= MARK_MAX_CHARS && MARK_PATTERN.test(content)) return false
  if (HEADING_LEVELS.has(el.textProps.typoLevel ?? '')) return false
  if (/footer|legal|notice|disclaimer/i.test(el.name ?? '')) return false
  return !isOverPhoto(section, el)
}

/** 글자 크기를 올렸을 때 늘어나는 높이 — 같은 행간·폭으로 줄 수를 다시 센다 */
function grownHeight(el: CanvasElement, fontSize: number): number {
  const p = el.textProps!
  const width = el.transform.width
  const lineHeight = p.lineHeight || 1.5
  const before = estimateWrappedLines(p.content, p.fontSize, width, p.letterSpacing ?? 0) * p.fontSize * lineHeight
  const after = estimateWrappedLines(p.content, fontSize, width, p.letterSpacing ?? 0) * fontSize * lineHeight
  return Math.max(0, Math.ceil(after - before))
}

export function applyLegibleText(sections: CanvasSection[]): CanvasSection[] {
  const floor = MIN_FONT_SIZES.body
  return sections.map((section) => {
    if (!LEGIBLE_SECTIONS.has(String(section.sectionType))) return section
    const deltas = new Map<string, number>()
    let touched = false
    const restyled = section.elements.map((el) => {
      if (!isSupportingText(el, section)) return el
      const p = el.textProps!
      const styled = new Set(p.userStyledKeys ?? [])
      const fontSize = !styled.has('fontSize') && p.fontSize < floor ? floor : p.fontSize
      const backdrops = textBackdrops(el, section)
      const { color, fontWeight } =
        styled.has('color') || backdrops === 'photo'
          ? { color: p.color, fontWeight: p.fontWeight }
          : legibleStyle(p, fontSize, backdrops)
      if (fontSize === p.fontSize && color === p.color && fontWeight === p.fontWeight) return el
      touched = true
      if (fontSize !== p.fontSize) deltas.set(el.id, grownHeight(el, fontSize))
      const typoLevel = fontSize !== p.fontSize ? ('body' as const) : p.typoLevel
      return { ...el, textProps: { ...p, fontSize, color, fontWeight, typoLevel } }
    })
    return touched ? reflowSection({ ...section, elements: restyled }, deltas) : section
  })
}
