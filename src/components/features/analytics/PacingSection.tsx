'use client'

import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/api-client'
import { ChartCard } from '@/components/charts/ChartCard'
import { PacingChart } from '@/components/charts/PacingChart'
import { kstTodayStr, monthKey, monthRange } from '@/lib/analytics/date-buckets'
import { toCumulative } from '@/lib/analytics/pacing'
import type { PnlBucket } from '@/lib/analytics/types'

async function fetchDailyBuckets(startDate: string, endDate: string): Promise<PnlBucket[]> {
  const params = new URLSearchParams({ startDate, endDate, granularity: 'daily' })
  const res = await apiFetch(`/api/analytics/pnl?${params}`)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error)
  return json.data.buckets || []
}

/** 이번 달 페이스 — 이번 달 vs 지난달 누적 순이익 비교 (자기완결 섹션) */
export function PacingSection() {
  const [current, setCurrent] = useState<number[]>([])
  const [previous, setPrevious] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const today = kstTodayStr()
    const mtdStart = `${today.slice(0, 7)}-01`
    const prevMonthLastDay = new Date(new Date(`${mtdStart}T00:00:00Z`).getTime() - 86400 * 1000)
      .toISOString()
      .slice(0, 10)
    const lastMonth = monthRange(monthKey(prevMonthLastDay))

    Promise.all([fetchDailyBuckets(mtdStart, today), fetchDailyBuckets(lastMonth.startDate, lastMonth.endDate)])
      .then(([cur, prev]) => {
        if (cancelled) return
        setCurrent(toCumulative(cur.map((b) => b.netProfit)))
        setPrevious(toCumulative(prev.map((b) => b.netProfit)))
      })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [])

  if (loading) return <ChartCard title="이번 달 페이스 (누적 순이익)" loading />
  // 실패하거나 이번 달 데이터가 전부 0이면 미렌더 (홈 최상단 과밀 방지)
  if (failed || current.length === 0 || current.every((v) => v === 0)) return null

  return (
    <ChartCard title="이번 달 페이스 (누적 순이익)" subtitle="실선 = 이번 달 · 점선 = 지난달">
      <PacingChart current={current} previous={previous} metricLabel="누적 순이익" />
    </ChartCard>
  )
}
