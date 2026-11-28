/**
 * D 사이즈 칸 수치 줄(적용 D6 P7 T1-63·T2-22, 통합 11-03 23:42) — 입력 칸 제품 수치(productMetrics)만 사이즈 칸(T6) 캡션 아래 같은 섹션에 그린다.
 * 꼴은 상품 정보 좌우 줄(infoRows, P6)과 같다: 이름(왼쪽 240 칸, 표 이름 TABLE_NAME_ELEMENT 한 묶음)·값(오른쪽 480 칸). 값만 장면 H2 큰 숫자
 * 한 줄이고 숫자와 단위는 한 칸이다(나누면 '7.3'과 'cm'이 다른 줄로 떨어진다 — K metric-rows와 같은 이유).
 * - 크기 글에서 읽은 이름 붙은 값(inputSlotsOf의 대체 출처)은 이미 사이즈 캡션·상품 정보 표 두 곳에 있어 쓰지 않는다(세 번째 반복)
 * - 입력 순서대로 앞 3줄(K sub_div.metric-rows 상한과 같다). 그중 하나라도 칸에 안 들면 수치 줄 전체를 그리지 않는다 — 자르거나 고르지 않는다
 * - 입력이 없으면 계획에 칸이 없고 사이즈 칸은 지금 그대로다
 * 행마다 보이지 않는 행 상자(designcut-row)로 이름·값을 묶어, 편집 뒤 리플로우가 행 안에서만 밀고 아래로는 행 높이 변화만 전한다
 */

import { MOBILE_LIMITS, TABLE_NAME_ELEMENT } from '@/lib/registration/editor/utils/mobileReadability'
import type { ProductMetric } from '@/lib/registration/input-slots'
import { uid } from '../helpers'
import { CutBuilder, approxTextWidth, contain } from './build'
import { INFO_COL_GAP, INFO_NAME_W, INFO_VALUE_W } from './infoRows'
import { tk, type CutContext } from './templatesScene'
import { CONTENT_W, MARGIN, SCENE_TYPE, TYPE, accentTextOn, rgba, type surfaceOf } from './tokens'

export type MetricRow = { name: string; value: string }

/** 수치 줄 상한(K sub_div.metric-rows와 같다) — 계약(contract.ts)도 같은 값으로 읽는다 */
export const METRIC_ROWS_MAX = 3
/** 캡션 → 위 구분선, 구분선 ↔ 행 사이 */
const CAPTION_GAP = 48
const ROW_GAP = 32
const RULE_H = 2

/** 이름 — 한 줄·12자 이하(장식 라벨 규칙 M5)이고 이름 칸 240에 LABEL 한 줄로 든다(상품 정보 좌우 줄과 같은 조건) */
const nameFits = (raw: string) => {
  const name = raw.trim()
  return name.length > 0 && !name.includes('\n') && name.length <= MOBILE_LIMITS.annotationLabelMaxChars && approxTextWidth(name, TYPE.LABEL.size) <= INFO_NAME_W
}
/** 값(숫자+단위) — 줄바꿈 없이 값 칸 480에 장면 H2(74) 한 줄로 든다. 큰 숫자는 줄을 바꾸지 않는다 */
const valueFits = (raw: string) => {
  const value = raw.trim()
  return value.length > 0 && !value.includes('\n') && value.length <= MOBILE_LIMITS.twoColumnMaxChars && approxTextWidth(value, SCENE_TYPE.H2.size) <= INFO_VALUE_W
}

/** 줄이 1~3개이고 모두 칸에 드는지 — 계획 표지와 그리기가 같은 함수로 본다 */
export function fitsMetricRows(rows: ReadonlyArray<MetricRow>): boolean {
  return rows.length > 0 && rows.length <= METRIC_ROWS_MAX && rows.every((row) => nameFits(row.name) && valueFits(row.value))
}

/** 입력 수치 → 줄. 입력 순서대로 앞 3개, 값과 단위는 한 칸 */
export function metricRowsOf(metrics: ReadonlyArray<ProductMetric>): MetricRow[] {
  return metrics.slice(0, METRIC_ROWS_MAX).map((m) => ({ name: m.name, value: `${m.value}${m.unit}` }))
}

/**
 * 사이즈 칸 캡션 아래 수치 줄 — 위 구분선, 행(이름 왼쪽·값 오른쪽 큰 숫자), 행마다 아래 구분선. top은 캡션 아래 끝, 반환값은 마지막 구분선 아래 끝.
 * 부르는 쪽이 fitsMetricRows로 먼저 본다
 */
export function drawMetricRows(b: CutBuilder, ctx: CutContext, surf: ReturnType<typeof surfaceOf>, rows: ReadonlyArray<MetricRow>, top: number): number {
  const t = tk(ctx)
  const rule = rgba(surf.text, 0.25)
  const group = uid('metric-names')
  const nameColor = accentTextOn(surf.dark, ctx.colors)
  // 이름 한 줄을 큰 숫자 한 줄과 같은 가운데 높이에
  const nameDrop = Math.max(0, Math.round((Math.ceil(t.H2.size * t.H2.lineHeight) - Math.ceil(TYPE.LABEL.size * TYPE.LABEL.lineHeight)) / 2))
  let y = top + CAPTION_GAP
  b.shape('designcut-metric-rule-top', 'rect', MARGIN, y, CONTENT_W, RULE_H, { fill: rule })
  y += RULE_H
  rows.forEach((row, i) => {
    y += ROW_GAP
    const box = b.shape('designcut-row', 'rect', MARGIN, y, CONTENT_W, 0, { fill: 'transparent' })
    const name = b.text(TABLE_NAME_ELEMENT, row.name.trim(), TYPE.LABEL, MARGIN, y + nameDrop, INFO_NAME_W, nameColor)
    name.el.groupId = group
    const value = b.text(`designcut-metric-value-${i}`, row.value.trim(), t.H2, MARGIN + INFO_NAME_W + INFO_COL_GAP, y, INFO_VALUE_W, surf.text)
    const bottom = Math.max(name.bottom, value.bottom)
    box.transform.height = bottom - y
    contain(box, [name.el, value.el])
    y = bottom + ROW_GAP
    b.shape(`designcut-metric-rule-${i}`, 'rect', MARGIN, y, CONTENT_W, RULE_H, { fill: rule })
    y += RULE_H
  })
  return y
}
