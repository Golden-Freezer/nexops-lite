'use client'

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts'
import { ChartTooltipContent } from '@/components/ui/chart'
import { fmtShort } from '@/lib/analytics/format'

export interface TrendSeries {
  key: string
  name: string
  type: 'bar' | 'line' // combo는 bar+line 혼합으로 표현
  color: string // 'var(--chart-*)'
  yAxis?: 'left' | 'right' // 기본 left. right는 %축
  dashed?: boolean // 고스트 오버레이용
}

export interface TrendChartProps {
  data: Array<Record<string, string | number>>
  xKey: string // 'date' | 'month' 등
  series: TrendSeries[]
  height?: number // 기본 200
  xTickFormatter?: (v: string) => string // 기본: 일 키는 'MM-DD', 월 키는 그대로
  valueFormatter?: (v: number) => string // 툴팁/Y축. 기본 fmtShort
  referenceLines?: Array<{ y: number; label?: string; color?: string }>
  colorByValue?: { key: string; positive: string; negative: string } // 값 부호별 바 색
}

/** 기본 X축 포맷: 'YYYY-MM-DD'는 'MM-DD'로, 월 키('YYYY-MM')는 그대로 */
function defaultXTick(v: string): string {
  return v.length === 10 ? v.slice(5) : v
}

/** 시계열 표준 차트 — 기존 페이지 인라인 recharts 패턴의 공용화 */
export function TrendChart({
  data,
  xKey,
  series,
  height = 200,
  xTickFormatter = defaultXTick,
  valueFormatter = fmtShort,
  referenceLines,
  colorByValue,
}: TrendChartProps) {
  const rightSeries = series.find((s) => s.yAxis === 'right')

  // 좌축(금액)은 0 시작 — 단 음수 값 시리즈가 있으면 auto (이중축 혼동 방지 규칙)
  const hasNegativeLeft = data.some((row) =>
    series.some((s) => (s.yAxis ?? 'left') === 'left' && Number(row[s.key]) < 0)
  )

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={xTickFormatter}
        />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={valueFormatter}
          width={48}
          domain={hasNegativeLeft ? ['auto', 'auto'] : [0, 'auto']}
        />
        {rightSeries && (
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 10, fill: rightSeries.color }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${v}%`}
            width={36}
          />
        )}
        <Tooltip
          content={
            <ChartTooltipContent
              labelFormatter={xTickFormatter}
              formatter={(value: number) => valueFormatter(value)}
            />
          }
        />
        {referenceLines?.map((r, i) => (
          <ReferenceLine
            key={`ref-${i}`}
            yAxisId="left"
            y={r.y}
            stroke={r.color ?? 'var(--chart-loss)'}
            strokeDasharray="3 3"
            label={r.label ? { value: r.label, fontSize: 10, fill: r.color ?? 'var(--chart-loss)', position: 'insideTopRight' } : undefined}
          />
        ))}
        {series.map((s) =>
          s.type === 'bar' ? (
            <Bar key={s.key} yAxisId={s.yAxis ?? 'left'} dataKey={s.key} name={s.name} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={28}>
              {colorByValue?.key === s.key &&
                data.map((row, i) => (
                  <Cell key={`cell-${i}`} fill={Number(row[s.key]) >= 0 ? colorByValue.positive : colorByValue.negative} />
                ))}
            </Bar>
          ) : (
            <Line
              key={s.key}
              yAxisId={s.yAxis ?? 'left'}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? '4 3' : undefined}
              strokeOpacity={s.dashed ? 0.7 : 1}
              dot={false}
            />
          )
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
