/**
 * 원형 배지(적용 K1 R-D1, 장치 표 medal '근거가 있을 때만, 수치를 지어내지 않는다', 자리 certification·main_cut) — 사진 위쪽 모서리 안에
 * 원 하나를 얹는다. 값은 배지 입력(BADGE_INPUTS)에서만 오고 고쳐 쓰지 않는다(input-values).
 * 글은 이름표(판독 하한 45) + 값 두 줄이 원 안에 들어가면 두 줄, 아니면 값 한 줄(평점은 '★ ' 앞붙임)이고, 그것도 안 들어가면 그리지 않는다(사진 그대로).
 * 사진 안에 얹으므로 템플릿 높이·서명이 그대로다. 모바일 판독 규칙(M6 등)은 예외 없이 지킨다(통합 11-03). 순수.
 */

import type { CanvasElement } from '@/lib/registration/editor/types/canvas'
import { contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { approxTextWidth, type CutBuilder } from '@/lib/registration/editor/utils/sectionConverter/designCut/build'
import { WHITE, type Colors, type TypeToken } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'

/** size: 원 지름(폰 390에서 약 76px), inset: 사진 모서리 → 원, ring: 흰 테두리 링(사진과 가른다), maxChars: 값 글자 상한 */
export const BADGE = { size: 168, inset: 24, ring: 6, maxChars: 6 } as const
export const BADGE_NAME = 'designcut-badge'
/** 배지를 쓰는 섹션 — 장치 표 medal의 자리 */
export const BADGE_SECTIONS: readonly string[] = ['certification', 'main_cut']
/** 배지를 얹을 사진의 최소 폭 — 폭 336 사진(certification.side-center)에서 원이 사진 절반을 덮어 뺐다(통합 11-03) */
export const BADGE_MIN_PHOTO = 480
/** 원 위 글자 대비 하한 */
export const BADGE_TEXT_CONTRAST = 4.5
/** 글자가 들어가는 원 안 반지름 — 링 안쪽 끝 */
const R_IN = BADGE.size / 2 - BADGE.ring

/**
 * 배지 입력과 고정 이름표(통합 승인 11-03) — 값은 input-values가 입력에서 그대로 꺼낸다.
 * 평점은 입력 평점을 반올림 없이, 리뷰 수 입력이 함께 있을 때만(수는 근거 확인으로만 쓰고 그리지 않는다). 구성은 입력 구성 칸의 수량,
 * 인증은 입력 인증 이름의 첫 이름이다(인증 사칭 금지 — 입력에 없는 인증은 그리지 않는다). 후기 수는 빨리 낡아 배지에 쓰지 않는다
 */
export const BADGE_INPUTS = { 'badge.rating': '평점', 'badge.quantity': '구성', 'badge.certification': '인증' } as const
export type BadgeInput = keyof typeof BADGE_INPUTS
export const isBadgeInput = (key: string | undefined): key is BadgeInput => key !== undefined && (Object.keys(BADGE_INPUTS) as string[]).includes(key)
/** 값만 쓸 때 앞에 붙이는 기호 — 이름표 없이도 평점으로 읽힌다 */
const VALUE_MARK: Partial<Record<BadgeInput, string>> = { 'badge.rating': '★ ' }

/** 배지 원 요소 — 강조 장식(M7)이 아니다 */
export const isBadgeElement = (el: { name?: string }) => el.name?.startsWith(`${BADGE_NAME}-`) ?? false

const DISC_NAME = `${BADGE_NAME}-disc`
const within = (a: CanvasElement, b: CanvasElement) =>
  a.transform.x >= b.transform.x &&
  a.transform.y >= b.transform.y &&
  a.transform.x + a.transform.width <= b.transform.x + b.transform.width &&
  a.transform.y + a.transform.height <= b.transform.y + b.transform.height

/** 배지 원 위에 온전히 얹힌 글자 — 원이 글자의 바탕이라 사진과 겹쳐도 된다(사진 위 글의 막과 같은 예외) */
export function textsOnBadge(elements: readonly CanvasElement[]): Set<string> {
  const discs = elements.filter((el) => el.name === DISC_NAME)
  return new Set(elements.filter((el) => el.type === 'text' && discs.some((d) => d.zIndex < el.zIndex && within(el, d))).map((el) => el.id))
}

const readable = (fill: string, text: string) => {
  const f = parseColor(fill)
  const t = parseColor(text)
  return !!f && !!t && contrastRatio(t, f) >= BADGE_TEXT_CONTRAST
}

/** 원 색 — 강조색 면과 그 위 글자가 대비 4.5 이상이면 강조색, 아니면 짙은 면(deep)과 그 위 글자, 그것도 못 넘으면 검정·흰색 */
export function badgeInk(c: Pick<Colors, 'accent' | 'onAccent' | 'deep' | 'onDeep'>): { fill: string; text: string } {
  if (readable(c.accent, c.onAccent)) return { fill: c.accent, text: c.onAccent }
  if (readable(c.deep, c.onDeep)) return { fill: c.deep, text: c.onDeep }
  return { fill: '#1A1A1A', text: WHITE }
}

/** 이름표(판독 하한 45, 표 글 줄 간격 1.7)와 값(장식 라벨 글꼴) 글자 */
export interface BadgeType {
  label: TypeToken
  value: TypeToken
}
interface Line {
  text: string
  token: TypeToken
}
export interface BadgeLayout {
  lines: Line[]
}
/** 두 줄일 때 값 크기 — 이름표(45)보다 작지 않게. 값만일 때는 장식 라벨 하한(36)까지 */
const PAIR_SIZES = [56, 48]
const SINGLE_SIZES = [56, 48, 40, 36]
const boxOf = (t: TypeToken) => t.size * t.lineHeight + 10

/** 줄들을 원 가운데 세로로 놓았을 때 글자 띠마다 그 높이의 원 폭 안에 드는가 */
function fitsCircle(lines: Line[]): boolean {
  const total = lines.reduce((sum, l) => sum + boxOf(l.token), 0)
  if (total > BADGE.size) return false
  let top = -total / 2
  for (const line of lines) {
    const box = boxOf(line.token)
    const center = top + box / 2
    const far = Math.abs(center) + line.token.size / 2
    if (far >= R_IN) return false
    if (approxTextWidth(line.text, line.token.size) > 2 * Math.sqrt(R_IN ** 2 - far ** 2)) return false
    top += box
  }
  return true
}

/** 배지 글 배치 — 이름표+값 두 줄, 안 되면 값 한 줄. 값이 6자를 넘거나 한 줄로도 안 들어가면 null(그리지 않는다) */
export function badgeLayout(input: BadgeInput, value: string, type: BadgeType): BadgeLayout | null {
  if (value.replace(/\s+/g, '').length > BADGE.maxChars) return null
  const label: Line = { text: BADGE_INPUTS[input], token: type.label }
  for (const size of PAIR_SIZES) {
    const lines = [label, { text: value, token: { ...type.value, size } }]
    if (fitsCircle(lines)) return { lines }
  }
  const text = `${VALUE_MARK[input] ?? ''}${value}`
  for (const size of SINGLE_SIZES) {
    const lines = [{ text, token: { ...type.value, size } }]
    if (fitsCircle(lines)) return { lines }
  }
  return null
}

export interface BadgeDraw {
  layout: BadgeLayout
  corner: 'tl' | 'tr'
  /** 사진 자리 — 원은 이 안 위쪽 모서리에 둔다 */
  photo: { x: number; y: number; w: number }
  inset: number
  colors: Colors
  group: string
}

/** 원 + 글 줄을 그린다. 글 상자는 원의 가로 지름 폭이고 줄 묶음을 원 가운데로 내린다 */
export function drawBadge(b: CutBuilder, d: BadgeDraw): void {
  const ink = badgeInk(d.colors)
  const x = d.corner === 'tl' ? d.photo.x + d.inset : d.photo.x + d.photo.w - d.inset - BADGE.size
  const y = d.photo.y + d.inset
  b.shape(DISC_NAME, 'circle', x, y, BADGE.size, BADGE.size, { fill: ink.fill, stroke: WHITE, strokeWidth: BADGE.ring }).groupId = d.group
  const inner = 2 * R_IN
  let bottom = y
  const els = d.layout.lines.map((line, i) => {
    const name = d.layout.lines.length === 2 && i === 0 ? `${BADGE_NAME}-label` : `${BADGE_NAME}-value`
    const out = b.text(name, line.text, line.token, x + BADGE.ring, bottom, inner, ink.text, 'center')
    bottom = out.bottom
    return out.el
  })
  const shift = Math.round((BADGE.size - (bottom - y)) / 2)
  for (const el of els) {
    el.transform.y += shift
    el.groupId = d.group
  }
}
