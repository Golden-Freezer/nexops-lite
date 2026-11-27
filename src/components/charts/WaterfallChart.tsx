'use client'

import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, ReferenceLine, LabelList } from 'recharts'
import { toWaterfallSegments, type WaterfallItem } from '@/lib/analytics/waterfall'
import { fmtShort } from '@/lib/analytics/format'

interface WaterfallChartProps {
  items: WaterfallItem[]
  height?: number // 기본 240
}

function segmentColor(kind: WaterfallItem['kind'], delta: number): string {
  if (kind === 'start') return 'var(--chart-revenue)'
  if (kind === 'minus') return 'var(--chart-cost)'
  return delta >= 0 ? 'var(--chart-profit)' : 'var(--chart-loss)'
}

/** 손익 워터폴 — 투명 베이스 스택 바. Y축 0 기준선 유지(잘라내기 금지) */
export function WaterfallChart({ items, height = 240 }: WaterfallChartProps) {
  const segments = toWaterfallSegments(items)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={segments} margin={{ top: 16, right: 5, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval={0} />
        <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtShort} width={48} />
        <ReferenceLine y={0} stroke="var(--chart-grid)" />
        {/* base: 투명 베이스 */}
        <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
        {/* delta: 보이는 막대 */}
        <Bar dataKey="delta" stackId="wf" maxBarSize={36} isAnimationActive={false}>
          {segments.map((s, i) => (
            <Cell key={`cell-${i}`} fill={segmentColor(s.kind, s.delta)} />
          ))}
          <LabelList
            dataKey="value"
            position="top"
            style={{ fontSize: 9, fill: '#64748B' }}
            formatter={(v: number) => fmtShort(v)}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
