'use client'

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { ChartTooltipContent } from '@/components/ui/chart'
import { fmtShort, fmtPct } from '@/lib/analytics/format'

interface PacingChartProps {
  current: number[] // 이번 달 1일~오늘 누적 배열
  previous: number[] // 지난달 1일~말일 누적 배열
  metricLabel: string // '누적 순이익' 등
  height?: number
}

/** MTD 페이싱 — 이번 달 vs 지난달 누적 비교 (x=경과일) */
export function PacingChart({ current, previous, metricLabel, height = 200 }: PacingChartProps) {
  const len = Math.max(current.length, previous.length)
  const data = Array.from({ length: len }, (_, i) => ({
    day: i + 1,
    current: i < current.length ? current[i] : null,
    previous: i < previous.length ? previous[i] : null,
  }))

  // 지난달 동일 시점 대비 (지난달이 더 짧으면 마지막값)
  const curLast = current.length > 0 ? current[current.length - 1] : 0
  const prevAtSame =
    previous.length === 0 ? 0 : previous[Math.min(current.length, previous.length) - 1]
  const deltaPct = prevAtSame !== 0 ? ((curLast - prevAtSame) / Math.abs(prevAtSame)) * 100 : 0
  const deltaText = `${deltaPct >= 0 ? '+' : '-'}${fmtPct(Math.abs(deltaPct))}`

  return (
    <div>
      <div className="flex justify-end mb-1">
        <span className="text-[10px] text-slate-400">
          지난달 동일 시점 대비{' '}
          <span className={`font-mono font-semibold ${deltaPct >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{deltaText}</span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}일`} />
          <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtShort} width={48} />
          <Tooltip
            content={
              <ChartTooltipContent
                labelFormatter={(v) => `${v}일차`}
                formatter={(value: number) => `${fmtShort(value)}원`}
              />
            }
          />
          <Line type="monotone" dataKey="previous" name={`지난달 ${metricLabel}`} stroke="var(--chart-ghost)" strokeWidth={2} strokeDasharray="4 3" strokeOpacity={0.7} dot={false} connectNulls={false} />
          <Line type="monotone" dataKey="current" name={`이번 달 ${metricLabel}`} stroke="var(--chart-profit)" strokeWidth={2} dot={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
