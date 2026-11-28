/**
 * D 상품 정보 좌우 줄 표(적용 D6 P6 T1-64·T2-26·T2-27, 통합 11-03 22:1x) — 계획이 좌우 줄(tableShape 'rows')을 단 상품 정보 표(long:info)만
 * 이름(왼쪽 240 칸, 표 이름 TABLE_NAME_ELEMENT)과 값(오른쪽 480 칸 본문, 줄바꿈 허용)을 한 줄에 둔다. 이름은 장식 라벨 규칙(한 줄·12자 이하)을
 * 지키는 표 이름이라 값 옆이어도 본문 2열이 아니고, 값은 칸 480(≥380)·40자 이하라 M6 2열 기준 안이다. 한 표의 이름은 한 묶음이다(M7).
 * 행마다 보이지 않는 행 상자(K 표 행 designcut-row와 같은 꼴)로 이름·값을 묶어, 리플로우가 행 안에서만 밀고 아래로는 행 높이 변화만 전한다.
 * 짙은 머리 띠(tableBand — 그 표가 페이지의 두 번째 사실 표)는 섹션 맨 위 전폭 짙은 면(deep) 위에 머리를 바탕 글자색(onDeep)으로 그린다(K
 * spec_table.band-head-rows와 같은 꼴, 띠 안 위·아래 여백 K blockGap). 짙은 면 대비가 4.5 미만·짙은 면 없는 팔레트(playful noDark)·이미 짙은 바탕이면
 * 띠 없이 지금 머리다. 조건이 안 맞으면 null — 부르는 쪽이 지금 쌓기 표(buildPurchaseTable)로 그린다
 */

import type { CanvasElement } from '@/lib/registration/editor/types/canvas'
import { MOBILE_LIMITS, TABLE_NAME_ELEMENT, contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { K_SPACE } from '@/lib/registration/templatelib/engine'
import { uid } from '../helpers'
import { CutBuilder, approxTextWidth, contain } from './build'
import { head } from './templatesInfo'
import { tk, type CutContext, type CutResult } from './templatesScene'
import { CONTENT_W, MARGIN, SCENE_TYPE, TYPE, W, accentTextOn, rgba, surfaceOf } from './tokens'

/** 상품 정보 표 계획 키 — designcut-long이 긴 막에 끼우는 'long:' + 'info' */
export const INFO_TABLE_KEY = 'long:info'
/** 이름 칸·사이·값 칸 — 값 칸 480은 M6 2열 열 폭 하한(380) 이상 */
export const INFO_NAME_W = 240
export const INFO_COL_GAP = 20
export const INFO_VALUE_W = CONTENT_W - INFO_NAME_W - INFO_COL_GAP
/** 값 글자 상한 — M6 2열 열당 40자 */
export const INFO_VALUE_MAX = MOBILE_LIMITS.twoColumnMaxChars
/** 짙은 머리 띠 이름 — 측정이 띠 수를 이 이름으로 센다 */
export const INFO_BAND_NAME = 'designcut-table-band'
/** 띠 안 위·아래 여백과 띠 → 첫 행 간격(K 띠 pad·gapAfter blockGap) */
const BAND_PAD = K_SPACE.blockGap

type InfoRow = { label: string; value: string }

/** 이름 — 한 줄·12자 이하(장식 라벨 규칙 M5, 공백 포함 글자 수)이고 이름 칸 240에 LABEL 한 줄로 든다(12자만으론 32px에서 384px라 더 엄격히) */
const nameFits = (label: string) => {
  const name = label.trim()
  return name.length > 0 && !name.includes('\n') && name.length <= MOBILE_LIMITS.annotationLabelMaxChars && approxTextWidth(name, TYPE.LABEL.size) <= INFO_NAME_W
}
/**
 * 값 — 비지 않고 40자 이하(공백 포함 — M6는 공백을 빼고 세니 더 엄격하다). 칸 안 줄바꿈은 허용하되, 공백으로 나눈 낱말마다 값 칸 480에
 * 장면 본문(52) 한 줄로 든다 — 편집기 글자는 keep-all이라 공백 없는 덩어리('브러쉬·미세빗(대)·미세빗(소)')는 칸보다 넓으면 줄을 못 바꾸고 넘친다
 */
const valueFits = (value: string) => {
  const text = value.trim()
  return text.length > 0 && text.length <= INFO_VALUE_MAX && text.split(/\s+/).every((word) => approxTextWidth(word, SCENE_TYPE.BODY.size) <= INFO_VALUE_W)
}

/** 모든 행이 좌우 줄 조건(이름 한 줄·12자·240 폭, 값 40자 이하·낱말마다 480 폭)에 맞는지 — 계획 표지와 그리기가 같은 함수로 본다 */
export function fitsInfoRows(rows: ReadonlyArray<InfoRow>): boolean {
  return rows.length > 0 && rows.every((row) => nameFits(row.label) && valueFits(row.value))
}

const contrastOf = (a: string, b: string) => {
  const [x, y] = [parseColor(a), parseColor(b)]
  return x && y ? contrastRatio(x, y) : 0
}

/** 띠를 그릴 수 있는지 — 계획 표지, 머리 글이 있고, 바탕이 밝고, 짙은 면 있는 팔레트, 짙은 면 위 글자 대비 4.5 이상 */
function bandFits(ctx: CutContext): boolean {
  const { section: s, colors: c } = ctx
  return (
    s.tableBand === true &&
    Boolean(s.text.eyebrow || s.text.headline || s.text.sub) &&
    !surfaceOf(s.bg, c).dark &&
    !ctx.scene?.noDark &&
    contrastOf(c.onDeep, c.deep) >= MOBILE_LIMITS.bodyContrast
  )
}

/** 짙은 머리 띠 — 섹션 맨 위 전폭 짙은 면 + 그 위 머리(바탕 D 글자색). 머리는 띠 안 위 여백 BAND_PAD로 올린다. 반환값은 띠 아래 끝 */
function drawBandHead(b: CutBuilder, ctx: CutContext): number {
  const { colors: c } = ctx
  const band = b.shape(INFO_BAND_NAME, 'rect', 0, 0, W, 0, { fill: c.deep })
  const start = b.elements.length
  const onBand: CutContext = { ...ctx, section: { ...ctx.section, bg: 'D' } }
  let bottom = head(b, onBand, ctx.section.text.eyebrow, c.accent, c.onAccent, c.onDeep)
  const inner: CanvasElement[] = b.elements.slice(start)
  const lift = Math.min(...inner.map((e) => e.transform.y)) - BAND_PAD
  for (const el of inner) el.transform.y -= lift
  bottom -= lift
  band.transform.height = bottom + BAND_PAD
  // 편집 뒤 머리 글이 늘면 띠도 함께 늘고, 아래 행은 띠 높이 변화만큼 내려간다
  contain(band, inner)
  return band.transform.height
}

/** 상품 정보 좌우 줄 표 — 조건이 안 맞으면 null */
export function buildInfoRows(ctx: CutContext, rows: ReadonlyArray<InfoRow>): CutResult | null {
  if (!fitsInfoRows(rows)) return null
  const { colors: c } = ctx
  const surf = surfaceOf(ctx.section.bg, c)
  const t = tk(ctx)
  const b = new CutBuilder()
  let y = bandFits(ctx) ? drawBandHead(b, ctx) + BAND_PAD : head(b, ctx, ctx.section.text.eyebrow, c.accent, c.onAccent, surf.text) + 40
  const group = uid('info-names')
  const nameColor = accentTextOn(surf.dark, c)
  // 이름 한 줄을 값 첫 줄과 같은 가운데 높이에
  const nameDrop = Math.max(0, Math.round((Math.ceil(t.BODY.size * t.BODY.lineHeight) - Math.ceil(TYPE.LABEL.size * TYPE.LABEL.lineHeight)) / 2))
  rows.forEach((row, i) => {
    const box = b.shape('designcut-row', 'rect', MARGIN, y, CONTENT_W, 0, { fill: 'transparent' })
    const name = b.text(TABLE_NAME_ELEMENT, row.label.trim(), TYPE.LABEL, MARGIN, y + nameDrop, INFO_NAME_W, nameColor)
    name.el.groupId = group
    const value = b.text(`designcut-info-value-${i}`, row.value.trim(), t.BODY, MARGIN + INFO_NAME_W + INFO_COL_GAP, y, INFO_VALUE_W, surf.text)
    const bottom = Math.max(name.bottom, value.bottom)
    box.transform.height = bottom - y
    contain(box, [name.el, value.el])
    y = bottom + 32
    b.shape(`designcut-info-rule-${i}`, 'rect', MARGIN, y, CONTENT_W, 2, { fill: rgba(surf.text, 0.25) })
    y += 34
  })
  return { elements: b.elements, height: y + 36, background: surf.fill, reflow: true }
}
