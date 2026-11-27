/**
 * 날짜/버킷 유틸 — 순수 함수만 (DOM/DB 접근 금지)
 * 규약: nexops-analytics-conventions §3
 * - 날짜 문자열은 전부 'YYYY-MM-DD' (문자열 비교 가능)
 * - 주 버킷 = 월요일 시작, 키는 그 주 월요일 날짜
 * - 월 키 = 'YYYY-MM'
 */

import type { Granularity } from './types'

export type ComparisonMode = 'previous-week' | 'previous-month' | 'previous-period'

export interface ComparisonPeriod {
  startDate: string
  endDate: string
  label: '전주' | '전월' | '직전 동일 기간'
}

/** 로컬 기준 YYYY-MM-DD (useReport.ts의 toDateStr과 동일 구현) */
export function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** KST 기준 오늘 — 서버/브라우저의 로컬 타임존과 무관 */
export function kstTodayStr(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

/** KST 오늘 ± offsetDays일 */
export function kstDateStr(offsetDays: number, now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000).toISOString().slice(0, 10)
}

/** 날짜 문자열을 UTC 자정 Date로 파싱 (타임존 영향 없는 순수 날짜 연산용) */
function parseUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`)
}

function utcToStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** 날짜 문자열 ± n일 (UTC 연산 — 타임존 무관) */
export function shiftDate(dateStr: string, deltaDays: number): string {
  const d = parseUtc(dateStr)
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return utcToStr(d)
}

/** 비교 기준에 맞는 직전 기간. 월 비교는 월말 여부를 보존한다. */
export function comparisonPeriod(
  startDate: string,
  endDate: string,
  mode: ComparisonMode = 'previous-period'
): ComparisonPeriod {
  if (mode === 'previous-month') {
    const [year, month] = startDate.slice(0, 7).split('-').map(Number)
    const previousMonthDate = new Date(Date.UTC(year, month - 2, 1))
    const previousMonth = `${previousMonthDate.getUTCFullYear()}-${String(previousMonthDate.getUTCMonth() + 1).padStart(2, '0')}`
    const previousRange = monthRange(previousMonth)
    const previousLastDay = Number(previousRange.endDate.slice(8))
    const startDay = Math.min(Number(startDate.slice(8)), previousLastDay)
    const currentIsMonthEnd = endDate === monthRange(startDate.slice(0, 7)).endDate
    const endDay = currentIsMonthEnd
      ? previousLastDay
      : Math.min(Number(endDate.slice(8)), previousLastDay)

    return {
      startDate: `${previousMonth}-${String(startDay).padStart(2, '0')}`,
      endDate: `${previousMonth}-${String(endDay).padStart(2, '0')}`,
      label: '전월',
    }
  }

  const lengthDays =
    Math.round((parseUtc(endDate).getTime() - parseUtc(startDate).getTime()) / 86400000) + 1
  const previousEnd = shiftDate(startDate, -1)

  return {
    startDate: shiftDate(previousEnd, -(lengthDays - 1)),
    endDate: previousEnd,
    label: mode === 'previous-week' ? '전주' : '직전 동일 기간',
  }
}

/** 전기 대비 증감률. 전기 값이 0이면 비교 불가(null)로 처리한다. */
export function percentageChange(current: number, previous: number): number | null {
  if (previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

/** '2026-06-15' → '2026-06' */
export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7)
}

/** 그 주 월요일 날짜. 월요일 시작 (dow === 0 ? 6 : dow - 1 — getPresetDates('week')와 동일) */
export function weekKey(dateStr: string): string {
  const d = parseUtc(dateStr)
  const dow = d.getUTCDay()
  const diff = dow === 0 ? 6 : dow - 1
  d.setUTCDate(d.getUTCDate() - diff)
  return utcToStr(d)
}

export function bucketKey(dateStr: string, g: Granularity): string {
  if (g === 'monthly') return monthKey(dateStr)
  if (g === 'weekly') return weekKey(dateStr)
  return dateStr
}

/**
 * 기간 내 모든 버킷 키를 오름차순으로 반환.
 * daily: 날짜 전부 / weekly: 각 주 월요일 (기간 시작이 주 중간이면 그 주 월요일부터) / monthly: 'YYYY-MM' 전부
 */
export function enumerateBuckets(startDate: string, endDate: string, g: Granularity): string[] {
  const keys: string[] = []
  if (startDate > endDate) return keys

  if (g === 'monthly') {
    let [y, m] = monthKey(startDate).split('-').map(Number)
    const endKey = monthKey(endDate)
    let key = `${y}-${String(m).padStart(2, '0')}`
    while (key <= endKey) {
      keys.push(key)
      m += 1
      if (m > 12) {
        m = 1
        y += 1
      }
      key = `${y}-${String(m).padStart(2, '0')}`
    }
    return keys
  }

  if (g === 'weekly') {
    const d = parseUtc(weekKey(startDate))
    while (utcToStr(d) <= endDate) {
      keys.push(utcToStr(d))
      d.setUTCDate(d.getUTCDate() + 7)
    }
    return keys
  }

  // daily
  const d = parseUtc(startDate)
  while (utcToStr(d) <= endDate) {
    keys.push(utcToStr(d))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return keys
}

/**
 * keys 순서대로 정렬된 완전한 배열 반환.
 * 있는 버킷은 유지, 없는 버킷은 empty()로 채움 (settlement page의 fillMissingDates 패턴)
 */
export function fillMissingBuckets<T extends { bucket: string }>(
  rows: T[],
  keys: string[],
  empty: (bucket: string) => T
): T[] {
  const map = new Map(rows.map((r) => [r.bucket, r]))
  return keys.map((k) => map.get(k) ?? empty(k))
}

/** '2026-06' → { startDate: '2026-06-01', endDate: '2026-06-30' } (윤년/말일 정확히) */
export function monthRange(ym: string): { startDate: string; endDate: string } {
  const [y, m] = ym.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { startDate: `${ym}-01`, endDate: `${ym}-${String(lastDay).padStart(2, '0')}` }
}

/**
 * 캘린더 히트맵 농도 (Phase 4) — 그 달 양수 순이익 최대값(max) 기준 0~4 단계.
 * 음수/0 순이익은 0 (적자 날은 히트맵 쪽에서 heat-loss 색으로 별도 처리)
 */
export function calcIntensity(netProfit: number, max: number): number {
  if (netProfit <= 0 || max <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((netProfit / max) * 4)))
}
