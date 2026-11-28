/**
 * D 기존 제품과 비교 줄(적용 C5 ② R-D2 D, 오너 11-03 22:47 '1, 2, 3 모두 승인' ②·통합 11-04 03:3x ①·04:5x) — 입력 비교 근거가 있을 때만 상품 정보 표(T9
 * long:info) 아래에 그린다. 값은 입력 그대로(compare-basis-read — 깎아내리기·타사 표식·규제 표현을 거른 행)이고 짓지 않는다. 모델 비교 글(카피 compareItems)은 쓰지 않는다.
 * 꼴: 작은 머리 '기존 제품과 비교' + 줄마다 이름(항목, 좌우 줄 표와 같은 240 칸 표 이름) · 값 칸에 '우리 …'·'기존 …' 두 줄(기존이 비면 중립 줄표 '—').
 * 좁은 3열 대신 값 칸 480에 두 줄을 쌓아 M6 2열 기준(열 380 이상·40자 이하) 안에 둔다. 출처 입력이 있으면 맨 아래 '출처: …' 한 줄.
 * 장면 모드만(구성품 펼침과 같음). 한 줄이라도 칸에 안 들면 블록 전체를 그리지 않는다(일부만 실으면 그게 비교 전부인 것처럼 읽힌다)
 */

import type { CanvasElement } from '@/lib/registration/editor/types/canvas'
import { TABLE_NAME_ELEMENT } from '@/lib/registration/editor/utils/mobileReadability'
import type { DesigncutSection } from '@/lib/registration/pdp-state'
import { uid } from '../helpers'
import { CutBuilder, approxTextWidth, contain } from './build'
import { INFO_COL_GAP, INFO_NAME_W, INFO_TABLE_KEY, INFO_VALUE_W, fitsInfoRows } from './infoRows'
import { tk, type CutContext, type CutResult } from './templatesScene'
import { CONTENT_W, MARGIN, SCENE_TYPE, TYPE, accentTextOn, rgba, surfaceOf } from './tokens'

export type DesigncutCompare = NonNullable<DesigncutSection['compare']>

export const COMPARE_LABEL = '기존 제품과 비교'
export const COMPARE_NEUTRAL = '—'
const OURS = '우리'
const OTHER = '기존'
/** 표 아래 → 머리, 머리 → 첫 줄, 줄 사이(좌우 줄 표 32·34와 같음), 출처 위 간격 */
const BLOCK_GAP = 72
const LABEL_GAP = 32
const SOURCE_GAP = 28

const lineOf = (side: string, value: string) => `${side} ${value}`
const linesOf = (row: DesigncutCompare['rows'][number]) => [lineOf(OURS, row.ours.trim()), lineOf(OTHER, row.other?.trim() || COMPARE_NEUTRAL)]

/** 출처 줄 — 전폭 한 줄 글이라 2열 규칙 밖이다. 낱말마다 본문 폭 안(줄바꿈은 허용) */
const sourceFits = (source: string) => source.trim().split(/\s+/).every((word) => approxTextWidth(word, SCENE_TYPE.BODY.size) <= CONTENT_W)

/** 모든 줄이 좌우 줄 표 조건(이름 한 줄·12자·240 폭, 값 줄 40자 이하·낱말마다 480 폭)에 드는지 — 계획 표지와 그리기가 같은 함수로 본다 */
export function fitsCompareRows(compare: DesigncutCompare): boolean {
  const rows = compare.rows.flatMap((row) => linesOf(row).map((value) => ({ label: row.label, value })))
  return compare.rows.length > 0 && fitsInfoRows(rows) && (!compare.source || sourceFits(compare.source))
}

/** 상품 정보 표 아래 비교 줄 — 계획 칸이 있고(장면 모드·상품 정보 표) 칸에 들 때만. 아니면 표 그대로 */
export function withCompareRows(build: (ctx: CutContext) => CutResult | null): (ctx: CutContext) => CutResult | null {
  return (ctx) => {
    const base = build(ctx)
    const compare = ctx.section.compare
    if (!base || !ctx.scene || ctx.section.key !== INFO_TABLE_KEY || !compare || !fitsCompareRows(compare)) return base
    const block = drawCompare(ctx, compare, base.height)
    const z = Math.max(0, ...base.elements.map((e) => e.zIndex ?? 0))
    block.elements.forEach((e, i) => (e.zIndex = z + i + 1))
    return { ...base, elements: [...base.elements, ...block.elements], height: block.bottom }
  }
}

function drawCompare(ctx: CutContext, compare: DesigncutCompare, top: number): { elements: CanvasElement[]; bottom: number } {
  const { colors: c } = ctx
  const surf = surfaceOf(ctx.section.bg, c)
  const t = tk(ctx)
  const b = new CutBuilder()
  let y = b.text('designcut-compare-label', COMPARE_LABEL, TYPE.LABEL, MARGIN, top + BLOCK_GAP - 36, CONTENT_W, accentTextOn(surf.dark, c)).bottom + LABEL_GAP
  const group = uid('compare-names')
  const nameColor = accentTextOn(surf.dark, c)
  const nameDrop = Math.max(0, Math.round((Math.ceil(t.BODY.size * t.BODY.lineHeight) - Math.ceil(TYPE.LABEL.size * TYPE.LABEL.lineHeight)) / 2))
  compare.rows.forEach((row, i) => {
    const box = b.shape('designcut-row', 'rect', MARGIN, y, CONTENT_W, 0, { fill: 'transparent' })
    const name = b.text(TABLE_NAME_ELEMENT, row.label.trim(), TYPE.LABEL, MARGIN, y + nameDrop, INFO_NAME_W, nameColor)
    name.el.groupId = group
    const [ours, other] = linesOf(row)
    const first = b.text(`designcut-compare-ours-${i}`, ours, t.BODY, MARGIN + INFO_NAME_W + INFO_COL_GAP, y, INFO_VALUE_W, surf.text)
    const second = b.text(`designcut-compare-other-${i}`, other, t.BODY, MARGIN + INFO_NAME_W + INFO_COL_GAP, first.bottom + 8, INFO_VALUE_W, surf.text)
    const bottom = Math.max(name.bottom, second.bottom)
    box.transform.height = bottom - y
    contain(box, [name.el, first.el, second.el])
    y = bottom + 32
    b.shape(`designcut-compare-rule-${i}`, 'rect', MARGIN, y, CONTENT_W, 2, { fill: rgba(surf.text, 0.25) })
    y += 34
  })
  if (compare.source) y = b.text('designcut-compare-source', lineOf('출처:', compare.source.trim()), t.BODY, MARGIN, y + SOURCE_GAP - 34, CONTENT_W, surf.text).bottom + 34
  return { elements: b.elements, bottom: y + 36 }
}
