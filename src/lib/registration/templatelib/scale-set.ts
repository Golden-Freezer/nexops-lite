/**
 * 같은 축척 윤곽(적용 K7 4d T1-84·T2-32, 통합 11-04 04:0x ③·06:0x ①~③) — 옵션 사이즈 표(sizeMatrix)의 가로·세로 숫자를 한 축척으로 줄 세운다.
 * 읽기(scaleRows)와 배치(scaleLayout)를 엔진·입력 칸 채우기·표본·시험이 같이 쓴다. 다른 물건과의 비교는 짓지 않고, 숫자는 입력에서만 나온다.
 * 이 파일은 잎이다(engine·input-values를 부르지 않는다 — 순환 import를 피한다).
 */

import type { SizeMatrix } from '../input-slots'
import { SCALE_SET_LIMITS } from './template-types'

const UNIT_MM = { mm: 1, cm: 10, m: 1000 } as const
type Unit = keyof typeof UNIT_MM

/**
 * 축 열 이름 — 가로는 가로·너비·W, 세로는 세로·높이·H로 시작한다. 폭·길이는 읽지 않는다(가방 '가로 × 세로 × 폭'의 폭은 깊이, 길이는 축이 갈린다 — 통합 06:0x ①)
 */
const WIDTH_COLUMN = /^(가로|너비|w(?:idth)?)(?![a-z])/i
const HEIGHT_COLUMN = /^(세로|높이|h(?:eight)?)(?![a-z])/i
/** 열 이름 끝 단위 — '가로(cm)'·'가로 cm' */
const COLUMN_UNIT = /\s*\(?\s*(mm|cm|m)\s*\)?\s*$/i
/** 칸 글 전체가 숫자 하나(+ 단위) — 범위('20~22')·여러 값은 읽지 않는다 */
const CELL = /^(\d+(?:\.\d+)?)\s*(mm|cm|m)?$/i
/** 그린 글('가로 20cm')의 끝 숫자·단위 — 엔진이 칸 값을 다시 잴 때 */
const SHOWN = /(\d+(?:\.\d+)?)\s*(mm|cm|m)$/i

export interface ScaleRow {
  /** 행 이름(옵션 사이즈) */
  label: string
  /** 열 이름 + 칸 값('가로 20cm') — 입력 글 그대로, 칸에 단위가 없으면 열 이름의 단위만 붙인다 */
  width: string
  height: string
}

const charCount = (text: string) => [...text.replace(/\s/g, '')].length

/** 축 열 하나 — 이름이 맞는 열이 정확히 하나일 때만(둘이면 어느 쪽인지 모른다) */
function axisColumn(columns: readonly string[], pattern: RegExp): { index: number; name: string; unit: Unit | null } | null {
  const found = columns.flatMap((column, index) => (pattern.test(column.trim()) ? [index] : []))
  if (found.length !== 1) return null
  const raw = columns[found[0]].trim()
  const unit = raw.match(COLUMN_UNIT)?.[1]?.toLowerCase() as Unit | undefined
  const name = raw.replace(COLUMN_UNIT, '').trim()
  return name ? { index: found[0], name, unit: unit ?? null } : null
}

/** 칸 하나 — 숫자와 단위(칸 글 또는 열 이름). 단위가 없으면 비율을 믿을 수 없어 null */
function cellOf(cell: string, columnUnit: Unit | null): { mm: number; shown: string } | null {
  const text = cell.trim()
  const match = text.match(CELL)
  const value = Number(match?.[1])
  const unit = (match?.[2]?.toLowerCase() as Unit | undefined) ?? columnUnit
  if (!match || !Number.isFinite(value) || value <= 0 || !unit) return null
  return { mm: value * UNIT_MM[unit], shown: match[2] ? text : `${text}${unit}` }
}

/**
 * 사이즈 표 → 같은 축척 행. 가로 열·세로 열이 하나씩 있고, 행 2~5·이름 3자 이하·모든 칸이 숫자 + 단위·축마다 큰 값 ÷ 작은 값 ≤ 12일 때만이다.
 * 하나라도 아니면 빈 목록(자르지 않는다 — 일부만 실으면 그게 사이즈 전부처럼 읽힌다)
 */
export function scaleRows(matrix: SizeMatrix | null): ScaleRow[] {
  if (!matrix) return []
  const wCol = axisColumn(matrix.columns, WIDTH_COLUMN)
  const hCol = axisColumn(matrix.columns, HEIGHT_COLUMN)
  const { min, max, labelMax, ratioMax } = SCALE_SET_LIMITS
  if (!wCol || !hCol || matrix.rows.length < min || matrix.rows.length > max) return []
  const rows = matrix.rows.map((row) => {
    const label = row.label.trim()
    const w = cellOf(row.values[wCol.index] ?? '', wCol.unit)
    const h = cellOf(row.values[hCol.index] ?? '', hCol.unit)
    return label && charCount(label) <= labelMax && w && h ? { label, w, h } : null
  })
  if (rows.some((row) => row === null)) return []
  const ok = rows as Array<{ label: string; w: { mm: number; shown: string }; h: { mm: number; shown: string } }>
  const spread = (values: number[]) => Math.max(...values) / Math.min(...values)
  if (spread(ok.map((r) => r.w.mm)) > ratioMax || spread(ok.map((r) => r.h.mm)) > ratioMax) return []
  return ok.map((r) => ({ label: r.label, width: `${wCol.name} ${r.w.shown}`, height: `${hCol.name} ${r.h.shown}` }))
}

/** 그린 글('가로 20cm')의 mm — scaleRows가 만든 글이 아니면 null */
export function shownMm(text: string): number | null {
  const match = text.trim().match(SHOWN)
  const value = Number(match?.[1])
  return match && Number.isFinite(value) && value > 0 ? value * UNIT_MM[match[2].toLowerCase() as Unit] : null
}

/** 배치 — 열 폭에서 사각형이 차지하는 몫·사각형 높이 상한(px) */
export const SCALE_LAYOUT = { fill: 0.8, maxH: 360 } as const

export interface ScaleBox {
  /** 열 왼쪽 기준 사각형 왼쪽(열 가운데) */
  x: number
  w: number
  h: number
}

/**
 * 같은 축척 배치 — 열은 같은 폭이고, 축척 s 하나로 모든 사각형을 줄인다(s = min(열 폭 × 0.8 ÷ 가장 큰 가로, 360 ÷ 가장 큰 세로)).
 * 사각형은 열 가운데·바닥 맞춤이다. 크기는 입력 비 그대로라 반올림 말고는 늘리거나 줄이지 않는다
 */
export function scaleLayout(sizes: ReadonlyArray<{ w: number; h: number }>, width: number, gap: number): { colW: number; scale: number; boxes: ScaleBox[]; height: number } {
  const n = sizes.length
  const colW = Math.floor((width - gap * (n - 1)) / n)
  const scale = Math.min((colW * SCALE_LAYOUT.fill) / Math.max(...sizes.map((s) => s.w)), SCALE_LAYOUT.maxH / Math.max(...sizes.map((s) => s.h)))
  const boxes = sizes.map((s) => {
    const w = Math.max(1, Math.round(s.w * scale))
    return { x: Math.round((colW - w) / 2), w, h: Math.max(1, Math.round(s.h * scale)) }
  })
  return { colW, scale, boxes, height: Math.max(...boxes.map((b) => b.h)) }
}
