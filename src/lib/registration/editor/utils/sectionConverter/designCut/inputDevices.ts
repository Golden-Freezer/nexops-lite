/**
 * D 입력 장치(적용 D6 R-D1·T1-85·T1-83, 오너 11-03 22:47 '1, 2, 3 모두 승인'·통합 11-04 00:4x 결정) — 입력이 있을 때만 그린다. 값은 입력 그대로이고 짓지 않는다.
 * - 원형 배지(R-D1): 마무리(T8) 장면 사진 안 위 오른쪽 모서리. 값은 인증 첫 이름 → 입력 평점(리뷰 수 입력이 있을 때) 순서로 원 안에 드는 첫 값.
 *   K 원형 배지(templatelib medal badgeLayout·drawBadge, 글자 크기 engine BADGE_TYPE)를 그대로 쓴다. 구성 수량은 D에서 쓰지 않는다(이미 문서 두 곳 이상).
 *   T8 사진은 사진 주석 후처리 대상이 아니라(plain) 주석과 겹치지 않고, 사진 안에 얹으니 섹션 높이는 그대로다
 * - 층 띠(T1-85): 자세히 보기(T11) 머리 아래. K 층 띠와 같은 색(layer-band layerInks — 위 옅음 → 아래 짙음, 대비 4.5)·같은 꼴(칸 폭 띠를 맞닿게
 *   쌓고 띠마다 층 이름 굵게·설명). 이름이 한 줄에 안 들거나 설명 낱말이 칸보다 길거나 색을 못 맞추면 띠 전체를 그리지 않는다(일부만 싣지 않는다).
 *   T11 그리기 갈래(목록·지그재그·원 셋·아이콘 격자)는 그대로 두고, 머리 아래에 띠를 끼우고 그 아래 요소를 띠 높이만큼 내린다
 * - 구성품 펼침(T1-83): 사이즈 칸(T6) 캡션·수치 줄 아래 '구성품' 라벨 + 번호 원·이름 줄. 입력 부속 이름(inputSlotsOf.parts — 추가 스펙
 *   '구성품·부속' 칸만)이 2개(K PARTS_MIN) 이상 6개 이하이고 모두 한 줄에 들 때만, 순서·글 그대로(일부만 싣지 않는다 — K 칸 규칙과 같음)
 */

import type { CanvasElement } from '@/lib/registration/editor/types/canvas'
import { INPUT_SLOT_LIMITS } from '@/lib/registration/input-slots'
import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import { BADGE_TYPE, K_SPACE, LAYER_BAND_NAME } from '@/lib/registration/templatelib/engine'
import { PARTS_MIN, certificationNames } from '@/lib/registration/templatelib/input-values'
import { layerInks } from '@/lib/registration/templatelib/layer-band'
import { BADGE, BADGE_MIN_PHOTO, badgeLayout, drawBadge } from '@/lib/registration/templatelib/medal'
import { uid } from '../helpers'
import { CutBuilder, approxTextWidth, contain } from './build'
import type { CutContext, CutResult } from './templatesScene'
import { CONTENT_W, MARGIN, SCENE_TYPE, TYPE, accentTextOn, surfaceOf } from './tokens'

export type DesigncutBadge = { input: 'badge.certification' | 'badge.rating'; value: string }
export type DesigncutLayer = { name: string; note?: string }

/** 배지가 원 안에 들어가는가(K badgeLayout — 값 6자·두 줄 또는 한 줄) — 계획 표지와 그리기가 같은 함수로 본다 */
export const badgeFits = (badge: DesigncutBadge) => badgeLayout(badge.input, badge.value, BADGE_TYPE) !== null

/** 입력에서 배지 값 — 인증 첫 이름 → 입력 평점(리뷰 수 입력이 함께 있을 때, 반올림 없이 그대로) 순서로 원 안에 드는 첫 값. 없으면 null */
export function badgeOfSpec(spec: Pick<PdpSpecSheet, 'certificationInfo' | 'rating' | 'reviewCount'>): DesigncutBadge | null {
  const cert = certificationNames(spec)[0]
  const candidates: DesigncutBadge[] = [
    ...(cert ? [{ input: 'badge.certification' as const, value: cert }] : []),
    // K input-values badge.rating과 같은 근거 — 평점과 리뷰 수 입력이 둘 다 있을 때만, 수는 근거 확인으로만 쓴다
    ...(Number(spec.rating) > 0 && Number(spec.reviewCount) > 0 ? [{ input: 'badge.rating' as const, value: String(spec.rating) }] : []),
  ]
  return candidates.find(badgeFits) ?? null
}

/** 장면 사진 안 위 오른쪽 모서리 배지 — 계획 칸이 있고 원 안에 들고 사진 폭이 K 하한(480) 이상일 때만 */
export function drawSceneBadge(b: CutBuilder, ctx: CutContext, photo: { x: number; y: number; w: number }): void {
  const badge = ctx.section.badge
  const layout = badge ? badgeLayout(badge.input, badge.value, BADGE_TYPE) : null
  if (!layout || photo.w < BADGE_MIN_PHOTO) return
  drawBadge(b, { layout, corner: 'tr', photo, inset: BADGE.inset, colors: ctx.colors, group: uid('badge') })
}

/** 띠 안쪽 여백(K cardPad)·글 칸 폭, 머리 → 띠 간격 */
const LAYER_PAD = K_SPACE.cardPad
const LAYER_TEXT_W = CONTENT_W - LAYER_PAD * 2
const LAYER_GAP = 48
const HEAD = /^designcut-(eyebrow|headline|sub)/

const layerFits = (layer: DesigncutLayer) => {
  const name = layer.name.trim()
  const note = layer.note?.trim() ?? ''
  return (
    name.length > 0 &&
    !name.includes('\n') &&
    approxTextWidth(name, SCENE_TYPE.BODY_BOLD.size) <= LAYER_TEXT_W &&
    note.split(/\s+/).every((word) => approxTextWidth(word, SCENE_TYPE.BODY.size) <= LAYER_TEXT_W)
  )
}

/** 층이 2~5개이고 모두 칸에 드는지 — 계획 표지와 그리기가 같은 함수로 본다 */
export function fitsLayerRows(layers: ReadonlyArray<DesigncutLayer>): boolean {
  const { min, max } = INPUT_SLOT_LIMITS.layer
  return layers.length >= min && layers.length <= max && layers.every(layerFits)
}

/** 띠를 쌓는다 — 반환값은 띠 요소와 아래 끝. 색을 못 맞추면 null */
function drawLayerBands(ctx: CutContext, layers: ReadonlyArray<DesigncutLayer>, top: number): { elements: CanvasElement[]; bottom: number } | null {
  const surf = surfaceOf(ctx.section.bg, ctx.colors)
  const inks = layerInks(surf, ctx.colors, layers.length)
  if (!inks) return null
  const b = new CutBuilder()
  let y = top
  layers.forEach((layer, i) => {
    const ink = inks[i]
    const band = b.shape(LAYER_BAND_NAME, 'rect', MARGIN, y, CONTENT_W, 0, { fill: ink.fill })
    const name = b.text(`designcut-layer-name-${i}`, layer.name.trim(), SCENE_TYPE.BODY_BOLD, MARGIN + LAYER_PAD, y + LAYER_PAD, LAYER_TEXT_W, ink.text)
    const note = layer.note?.trim()
      ? b.text(`designcut-layer-note-${i}`, layer.note.trim(), SCENE_TYPE.BODY, MARGIN + LAYER_PAD, name.bottom + K_SPACE.tightGap, LAYER_TEXT_W, ink.text)
      : null
    band.transform.height = (note ?? name).bottom + LAYER_PAD - y
    // 글이 늘면 그 띠가 늘고 아래 띠를 민다
    contain(band, [name.el, note?.el])
    y += band.transform.height
  })
  return { elements: b.elements, bottom: y }
}

/**
 * T11 그리기에 층 띠를 더한다 — 장면 모드이고 계획 칸(layers)이 칸에 들 때만 머리 아래에 띠를 끼우고 머리 밖 요소를 띠 높이 + 간격만큼 내린다.
 * 아니면 그리기 결과 그대로(바이트 같음)
 */
export function withLayerBand(build: (ctx: CutContext) => CutResult | null): (ctx: CutContext) => CutResult | null {
  return (ctx) => {
    const base = build(ctx)
    const layers = ctx.section.layers
    if (!base || !ctx.scene || !layers || !fitsLayerRows(layers)) return base
    const head = base.elements.filter((e) => HEAD.test(e.name ?? ''))
    if (head.length === 0) return base
    const headBottom = Math.max(...head.map((e) => e.transform.y + e.transform.height))
    const bands = drawLayerBands(ctx, layers, headBottom + LAYER_GAP)
    if (!bands) return base
    const shift = bands.bottom - headBottom
    const z = Math.max(0, ...base.elements.map((e) => e.zIndex ?? 0))
    const moved = base.elements.map((e) => (head.includes(e) ? e : { ...e, transform: { ...e.transform, y: e.transform.y + shift } }))
    bands.elements.forEach((e, i) => (e.zIndex = z + i + 1))
    return { ...base, elements: [...moved, ...bands.elements], height: base.height + shift }
  }
}

/** 구성품 줄 상한(통합 11-04 00:4x — 2~6개), 번호 원(T5 단계 번호와 같은 80)·원 → 이름 사이, 줄 사이, 라벨 글 */
export const PARTS_MAX = 6
const PART_MARK = 80
const PART_GAP = 24
const PART_TEXT_W = CONTENT_W - PART_MARK - PART_GAP
export const PARTS_LABEL = '구성품'

/** 부속 이름이 2~6개이고 모두 본문 52 한 줄로 이름 칸(636)에 드는지 — 계획 표지와 그리기가 같은 함수로 본다 */
export function fitsPartRows(parts: ReadonlyArray<string>): boolean {
  return (
    parts.length >= PARTS_MIN &&
    parts.length <= PARTS_MAX &&
    parts.every((raw) => {
      const name = raw.trim()
      return name.length > 0 && !name.includes('\n') && approxTextWidth(name, SCENE_TYPE.BODY.size) <= PART_TEXT_W
    })
  )
}

/** 사이즈 칸 아래 구성품(장면 모드만 — 글은 장면 본문) — top은 위 내용 아래 끝, 반환값은 마지막 줄 아래 끝. 부르는 쪽이 fitsPartRows로 먼저 본다 */
export function drawPartRows(b: CutBuilder, ctx: CutContext, surf: ReturnType<typeof surfaceOf>, parts: ReadonlyArray<string>, top: number): number {
  const c = ctx.colors
  let y = b.text('designcut-parts-label', PARTS_LABEL, TYPE.LABEL, MARGIN, top + LAYER_GAP, CONTENT_W, accentTextOn(surf.dark, c)).bottom
  const lineH = Math.ceil(SCENE_TYPE.BODY.size * SCENE_TYPE.BODY.lineHeight)
  parts.forEach((part, i) => {
    y += PART_GAP
    const box = b.shape('designcut-row', 'rect', MARGIN, y, CONTENT_W, 0, { fill: 'transparent' })
    // 번호 원은 이름 첫 줄 가운데 높이에. 번호는 원 안 한 줄이라 장면 밖 H3(48)로 둔다(T5 단계 번호와 같은 이유)
    const markY = y + Math.max(0, Math.round((lineH - PART_MARK) / 2))
    const mark = b.shape(`designcut-part-mark-${i}`, ctx.radius.chip > 100 ? 'circle' : 'roundedRect', MARGIN, markY, PART_MARK, PART_MARK, { fill: c.accent, borderRadius: 4 })
    const no = b.text(`designcut-part-number-${i}`, String(i + 1), TYPE.H3, MARGIN, markY + 6, PART_MARK, c.onAccent, 'center')
    const name = b.text(`designcut-part-name-${i}`, part.trim(), SCENE_TYPE.BODY, MARGIN + PART_MARK + PART_GAP, y, PART_TEXT_W, surf.text)
    const bottom = Math.max(markY + PART_MARK, name.bottom)
    box.transform.height = bottom - y
    contain(box, [mark, no.el, name.el])
    y = bottom
  })
  return y
}
