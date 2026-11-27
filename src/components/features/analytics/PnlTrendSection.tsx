'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChartCard } from '@/components/charts/ChartCard'
import { DeltaBadge } from '@/components/charts/DeltaBadge'
import { TrendChart } from '@/components/charts/TrendChart'
import { apiFetch } from '@/lib/api-client'
import {
  comparisonPeriod,
  percentageChange,
  type ComparisonMode,
} from '@/lib/analytics/date-buckets'
import { fmtShort } from '@/lib/analytics/format'
import type { Granularity, PnlBucket, PnlSummaryData } from '@/lib/analytics/types'
import type { PeriodFilter } from '@/types/settlement'

interface PnlResponse {
  summary: PnlSummaryData
  buckets: PnlBucket[]
}
async function fetchPnl(startDate: string, endDate: string, granularity: Granularity): Promise<PnlResponse> {
  const params = new URLSearchParams({ startDate, endDate, granularity })
  const response = await apiFetch(`/api/analytics/pnl?${params}`)
  const json = await response.json()
  if (!response.ok) throw new Error(json.error || '손익 추이 조회 실패')
  return json.data as PnlResponse
}

function comparisonMode(type: PeriodFilter['type']): ComparisonMode {
  if (type === 'week' || type === 'last7') return 'previous-week'
  if (type === 'month' || type === 'last-month') return 'previous-month'
  return 'previous-period'
}

/** 대시보드 메인 손익 추이 — 일/주 전환과 전주·전월·직전 기간 비교를 한 번에 제공한다. */
export function PnlTrendSection({ period }: { period: PeriodFilter }) {
  const [granularity, setGranularity] = useState<Extract<Granularity, 'daily' | 'weekly'>>('daily')
  const [current, setCurrent] = useState<PnlResponse | null>(null)
  const [previous, setPrevious] = useState<PnlResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const comparison = useMemo(
    () => comparisonPeriod(period.periodStart, period.periodEnd, comparisonMode(period.type)),
    [period.periodEnd, period.periodStart, period.type]
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      fetchPnl(period.periodStart, period.periodEnd, granularity),
      fetchPnl(comparison.startDate, comparison.endDate, granularity),
    ])
      .then(([currentData, previousData]) => {
        if (cancelled) return
        setCurrent(currentData)
        setPrevious(previousData)
      })
      .catch((reason) => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : '손익 추이 조회 실패')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [comparison.endDate, comparison.startDate, granularity, period.periodEnd, period.periodStart])

  const isEmpty =
    !current ||
    current.buckets.every(
      (bucket) => bucket.revenue === 0 && bucket.margin === 0 && bucket.adSpend === 0 && bucket.expenses === 0
    )

  const chartData =
    current?.buckets.map((bucket, index) => ({
      bucket: bucket.bucket,
      revenue: bucket.revenue,
      margin: bucket.margin,
      netProfit: bucket.netProfit,
      previousNetProfit: previous?.buckets[index]?.netProfit ?? 0,
    })) ?? []

  const periodLabel = `${period.periodStart} ~ ${period.periodEnd}`
  const comparisonLabel = `${comparison.label} ${comparison.startDate} ~ ${comparison.endDate}`

  return (
    <ChartCard
      title={`${granularity === 'daily' ? '일별' : '주별'} 손익 추이`}
      subtitle={`${periodLabel} · ${comparisonLabel}`}
      loading={loading}
      empty={!loading && (Boolean(error) || isEmpty)}
      emptyText={error || '선택 기간의 손익 데이터가 없습니다.'}
      action={
        <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
          {(['daily', 'weekly'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setGranularity(value)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                granularity === value
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {value === 'daily' ? '일' : '주'}
            </button>
          ))}
        </div>
      }
    >
      {current && previous && (
        <>
          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <SummaryMetric
              label="매출"
              value={current.summary.totalRevenue}
              delta={percentageChange(current.summary.totalRevenue, previous.summary.totalRevenue)}
              comparisonLabel={comparison.label}
            />
            <SummaryMetric
              label="마진"
              value={current.summary.totalMargin}
              delta={percentageChange(current.summary.totalMargin, previous.summary.totalMargin)}
              comparisonLabel={comparison.label}
              emphasize
            />
            <SummaryMetric
              label="순이익"
              value={current.summary.netProfit}
              delta={percentageChange(current.summary.netProfit, previous.summary.netProfit)}
              comparisonLabel={comparison.label}
              emphasize
            />
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400">
            <Legend color="var(--chart-muted)" label="매출" square />
            <Legend color="var(--chart-margin)" label="마진" />
            <Legend color="var(--chart-profit)" label="순이익" />
            <Legend color="var(--chart-ghost)" label={`${comparison.label} 순이익`} dashed />
          </div>

          <TrendChart
            data={chartData}
            xKey="bucket"
            height={190}
            series={[
              { key: 'revenue', name: '매출', type: 'bar', color: 'var(--chart-muted)' },
              { key: 'margin', name: '마진', type: 'line', color: 'var(--chart-margin)' },
              { key: 'netProfit', name: '순이익', type: 'line', color: 'var(--chart-profit)' },
              {
                key: 'previousNetProfit',
                name: `${comparison.label} 순이익`,
                type: 'line',
                color: 'var(--chart-ghost)',
                dashed: true,
              },
            ]}
            referenceLines={[{ y: 0, color: 'var(--chart-grid)' }]}
          />
        </>
      )}
    </ChartCard>
  )
}

function SummaryMetric({
  label,
  value,
  delta,
  comparisonLabel,
  emphasize = false,
}: {
  label: string
  value: number
  delta: number | null
  comparisonLabel: string
  emphasize?: boolean
}) {
  const tone = emphasize ? (value >= 0 ? 'text-blue-600' : 'text-red-600') : 'text-slate-800'

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-slate-500">{label}</span>
        {delta == null ? (
          <span className="text-[9px] text-slate-400">{comparisonLabel} 데이터 없음</span>
        ) : (
          <DeltaBadge value={delta} />
        )}
      </div>
      <p className={`mt-1 font-mono text-sm font-bold ${tone}`}>{fmtShort(value)}원</p>
    </div>
  )
}

function Legend({
  color,
  label,
  square = false,
  dashed = false,
}: {
  color: string
  label: string
  square?: boolean
  dashed?: boolean
}) {
  return (
    <span className="flex items-center gap-1">
      <span
        className={square ? 'h-2 w-2 rounded-sm' : 'h-0 w-3 border-t-2'}
        style={
          square
            ? { backgroundColor: color }
            : { borderColor: color, borderTopStyle: dashed ? 'dashed' : 'solid' }
        }
      />
      {label}
    </span>
  )
}
