/**
 * D 사용 방법 칸 '주기' 줄(적용 C5 ④ R-D3 D, 통합 11-04 01:14 ④·03:3x) — 입력 칸 사용·교체·배송 주기(schedule)만 사용 방법(T5) 단계 아래 같은 섹션에 그린다.
 * 꼴은 수치 줄(metricRows)·상품 정보 좌우 줄(infoRows, P6)과 같다: 이름(왼쪽 240 칸, 표 이름 한 묶음)·기간(오른쪽 480 칸, 장면 BODY_BOLD 두 줄까지).
 * - 값은 scheduleOf(input-values — 효과 시간표 줄·규제 표현 줄 뺌, 2줄 미만이면 없음)와 같은 inputSlotsOf.schedule이다. 기간·횟수를 짓지 않는다
 * - 하나라도 칸에 안 들면 주기 줄 전체를 그리지 않는다 — 자르거나 고르지 않는다. 사용 방법 칸이 없으면 자리도 없다
 * - 입력이 없으면 계획에 칸이 없고 사용 방법 칸은 지금 그대로다
 */

import { MOBILE_LIMITS, TABLE_NAME_ELEMENT } from '@/lib/registration/editor/utils/mobileReadability'
import type { ScheduleItem } from '@/lib/registration/input-slots'
import { uid } from '../helpers'
import { CutBuilder, approxTextWidth, contain } from './build'
import { INFO_COL_GAP, INFO_NAME_W, INFO_VALUE_W } from './infoRows'
import { tk, type CutContext } from './templatesScene'
import { CONTENT_W, MARGIN, SCENE_TYPE, TYPE, accentTextOn, rgba, type surfaceOf } from './tokens'

/** 주기 줄 상한(입력 칸 schedule 2~6줄과 같다) — 계약(contract.ts)도 같은 값으로 읽는다 */
export const SCHEDULE_ROWS_MIN = 2
export const SCHEDULE_ROWS_MAX = 6
/** 단계 → 위 구분선, 구분선 ↔ 행 사이 */
const STEPS_GAP = 56
const ROW_GAP = 28
const RULE_H = 2

/** 이름 — 한 줄·12자 이하(장식 라벨 규칙 M5)이고 이름 칸 240에 LABEL 한 줄로 든다(수치 줄과 같은 조건) */
const labelFits = (raw: string) => {
  const label = raw.trim()
  return label.length > 0 && !label.includes('\n') && label.length <= MOBILE_LIMITS.annotationLabelMaxChars && approxTextWidth(label, TYPE.LABEL.size) <= INFO_NAME_W
}
/** 기간 — 줄바꿈 없이 기간 칸 480에 장면 BODY_BOLD 두 줄 안으로 든다 */
const periodFits = (raw: string) => {
  const period = raw.trim()
  return period.length > 0 && !period.includes('\n') && period.length <= MOBILE_LIMITS.twoColumnMaxChars && approxTextWidth(period, SCENE_TYPE.BODY_BOLD.size) <= INFO_VALUE_W * 2
}

/** 줄이 2~6개이고 모두 칸에 드는지 — 계획 표지와 그리기가 같은 함수로 본다 */
export function fitsScheduleRows(rows: ReadonlyArray<ScheduleItem>): boolean {
  return rows.length >= SCHEDULE_ROWS_MIN && rows.length <= SCHEDULE_ROWS_MAX && rows.every((row) => labelFits(row.label) && periodFits(row.period))
}

/**
 * 사용 방법 단계 아래 주기 줄 — 위 구분선, 행(이름 왼쪽·기간 오른쪽), 행마다 아래 구분선. top은 마지막 단계 아래 끝, 반환값은 마지막 구분선 아래 끝.
 * 부르는 쪽이 fitsScheduleRows로 먼저 본다
 */
export function drawScheduleRows(b: CutBuilder, ctx: CutContext, surf: ReturnType<typeof surfaceOf>, rows: ReadonlyArray<ScheduleItem>, top: number): number {
  const t = tk(ctx)
  const rule = rgba(surf.text, 0.25)
  const group = uid('schedule-names')
  const nameColor = accentTextOn(surf.dark, ctx.colors)
  // 이름 한 줄을 기간 첫 줄과 같은 가운데 높이에
  const nameDrop = Math.max(0, Math.round((Math.ceil(t.BODY_BOLD.size * t.BODY_BOLD.lineHeight) - Math.ceil(TYPE.LABEL.size * TYPE.LABEL.lineHeight)) / 2))
  let y = top + STEPS_GAP
  b.shape('designcut-schedule-rule-top', 'rect', MARGIN, y, CONTENT_W, RULE_H, { fill: rule })
  y += RULE_H
  rows.forEach((row, i) => {
    y += ROW_GAP
    const box = b.shape('designcut-row', 'rect', MARGIN, y, CONTENT_W, 0, { fill: 'transparent' })
    const name = b.text(TABLE_NAME_ELEMENT, row.label.trim(), TYPE.LABEL, MARGIN, y + nameDrop, INFO_NAME_W, nameColor)
    name.el.groupId = group
    const period = b.text(`designcut-schedule-period-${i}`, row.period.trim(), t.BODY_BOLD, MARGIN + INFO_NAME_W + INFO_COL_GAP, y, INFO_VALUE_W, surf.text)
    const bottom = Math.max(name.bottom, period.bottom)
    box.transform.height = bottom - y
    contain(box, [name.el, period.el])
    y = bottom + ROW_GAP
    b.shape(`designcut-schedule-rule-${i}`, 'rect', MARGIN, y, CONTENT_W, RULE_H, { fill: rule })
    y += RULE_H
  })
  return y
}
