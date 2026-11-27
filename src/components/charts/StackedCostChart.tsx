'use client'

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import { ChartTooltipContent } from '@/components/ui/chart'
import { fmtShort } from '@/lib/analytics/format'

interface StackedCostChartProps {
  data: Array<{ bucket: string; cost: number; fee: number; ad: number; expense: number; etc: number }>
  xTickFormatter?: (v: string) => string
  height?: number
}

/** 비용 구성 스택 바 — 원가는 맨 아래(정확 비교 위치), 이후 수수료·광고·지출·기타 */
export function StackedCostChart({ data, xTickFormatter, height = 240 }: StackedCostChartProps) {
  const series: Array<{ key: 'cost' | 'fee' | 'ad' | 'expense' | 'etc'; name: string; color: string }> = [
    { key: 'cost', name: '원가', color: 'var(--chart-cost)' },
    { key: 'fee', name: '수수료·입출고', color: 'var(--chart-fee)' },
    { key: 'ad', name: '광고비', color: 'var(--chart-ad)' },
    { key: 'expense', name: '지출', color: 'var(--chart-expense)' },
    { key: 'etc', name: '기타', color: 'var(--chart-muted)' },
  ]

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="bucket" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTickFormatter} />
        <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtShort} width={48} />
        <Tooltip content={<ChartTooltipContent labelFormatter={xTickFormatter} formatter={(v: number) => `${fmtShort(v)}원`} />} />
        <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} stackId="cost" fill={s.color} maxBarSize={28} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
