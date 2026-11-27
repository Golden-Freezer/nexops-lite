'use client'

import type { ReactNode } from 'react'
import { kstTodayStr, monthRange } from '@/lib/analytics/date-buckets'
import { fmtShort } from '@/lib/analytics/format'

export interface CalendarHeatmapDay {
  date: string // 'YYYY-MM-DD'
  primary: number // 셀 표기 값 1 (예: 매출)
  secondary?: number // 셀 표기 값 2 (예: 순이익 — 음수면 heat-loss 색)
  intensity: number // 0~4 (색 단계)
}

interface CalendarHeatmapProps {
  ym: string // 'YYYY-MM'
  days: CalendarHeatmapDay[]
  renderCell?: (day: CalendarHeatmapDay) => ReactNode
  onSelectDate?: (date: string) => void
}

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일']

/** 월 달력 히트맵 — CSS grid, 주 시작=월요일 (date-buckets weekKey 규약과 통일) */
export function CalendarHeatmap({ ym, days, renderCell, onSelectDate }: CalendarHeatmapProps) {
  const { startDate, endDate } = monthRange(ym)
  const today = kstTodayStr()
  const dayMap = new Map(days.map((d) => [d.date, d]))

  // 월 시작 요일만큼 빈 셀 (월요일 시작: dow===0 ? 6 : dow-1)
  const firstDow = new Date(`${startDate}T00:00:00Z`).getUTCDay()
  const leadingBlanks = firstDow === 0 ? 6 : firstDow - 1
  const lastDay = Number(endDate.slice(8, 10))

  const cells: Array<{ date: string; day: number } | null> = []
  for (let i = 0; i < leadingBlanks; i++) cells.push(null)
  for (let d = 1; d <= lastDay; d++) {
    cells.push({ date: `${ym}-${String(d).padStart(2, '0')}`, day: d })
  }

  return (
    <div className="grid grid-cols-7 gap-1">
      {WEEKDAYS.map((w) => (
        <div key={w} className="text-[10px] text-slate-400 text-center py-1">
          {w}
        </div>
      ))}
      {cells.map((cell, i) => {
        if (!cell) return <div key={`blank-${i}`} />
        const day = dayMap.get(cell.date)
        const isLoss = day != null && day.secondary != null && day.secondary < 0
        const intensity = day?.intensity ?? 0
        const bg = isLoss ? 'var(--chart-heat-loss)' : `var(--chart-heat-${intensity})`
        const textCls = !isLoss && intensity >= 3 ? 'text-white' : 'text-slate-700'
        const isToday = cell.date === today

        return (
          <div
            key={cell.date}
            onClick={onSelectDate ? () => onSelectDate(cell.date) : undefined}
            className={`min-h-[52px] rounded p-1 ${textCls} ${isToday ? 'ring-1 ring-blue-400' : ''} ${
              onSelectDate ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''
            }`}
            style={{ backgroundColor: bg }}
          >
            {day && renderCell ? (
              renderCell(day)
            ) : (
              <>
                <p className="text-[10px] font-medium">{cell.day}</p>
                {day && (
                  <div className="hidden sm:block">
                    <p className="text-[10px] font-mono leading-tight">{fmtShort(day.primary)}</p>
                    {day.secondary != null && (
                      <p className="text-[10px] font-mono font-semibold leading-tight">
                        {day.secondary < 0 ? '-' : ''}{fmtShort(Math.abs(day.secondary))}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
