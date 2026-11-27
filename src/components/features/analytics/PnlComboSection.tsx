'use client'

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { ChartCard } from '@/components/charts/ChartCard'
import { TrendChart } from '@/components/charts/TrendChart'
import { WaterfallChart } from '@/components/charts/WaterfallChart'
import { StackedCostChart } from '@/components/charts/StackedCostChart'
import { kstTodayStr, monthRange } from '@/lib/analytics/date-buckets'
import { monthLabel } from '@/lib/analytics/format'
import type { PnlBucket, PnlSummaryData } from '@/lib/analytics/types'
import type { WaterfallItem } from '@/lib/analytics/waterfall'

/** 날짜 문자열 ± n일 (UTC 연산 — 타임존 무관) */
function shiftDate(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/** KST 이번 달 포함 최근 N개월 기간 */
function recentMonthsPeriod(months: number): { startDate: string; endDate: string } {
  const ym = kstTodayStr().slice(0, 7)
  let [y, m] = ym.split('-').map(Number)
  for (let i = 1; i < months; i++) {
    m -= 1
    if (m < 1) { m = 12; y -= 1 }
  }
  return { startDate: monthRange(`${y}-${String(m).padStart(2, '0')}`).startDate, endDate: monthRange(ym).endDate }
}

async function fetchPnlData(startDate: string, endDate: string, granularity: string) {
  const params = new URLSearchParams({ startDate, endDate, granularity })
  const res = await apiFetch(`/api/analytics/pnl?${params}`)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error)
  return json.data as { summary: PnlSummaryData; buckets: PnlBucket[] }
}

/** 정산 대시보드 시각화 강화 — 콤보·고스트·워터폴·비용 스택 (자기완결 섹션) */
export function PnlComboSection({ periodStart, periodEnd }: { periodStart: string; periodEnd: string }) {
  const [cur, setCur] = useState<{ summary: PnlSummaryData; buckets: PnlBucket[] } | null>(null)
  const [prevBuckets, setPrevBuckets] = useState<PnlBucket[]>([])
  const [monthly, setMonthly] = useState<PnlBucket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    // 직전 동일 길이 기간 (고스트 오버레이용)
    const lenDays =
      Math.round((new Date(`${periodEnd}T00:00:00Z`).getTime() - new Date(`${periodStart}T00:00:00Z`).getTime()) / 86400000) + 1
    const prevEnd = shiftDate(periodStart, -1)
    const prevStart = shiftDate(prevEnd, -(lenDays - 1))
    const m = recentMonthsPeriod(6)

    Promise.all([
      fetchPnlData(periodStart, periodEnd, 'daily'),
      fetchPnlData(prevStart, prevEnd, 'daily'),
      fetchPnlData(m.startDate, m.endDate, 'monthly'),
    ])
      .then(([current, prev, months]) => {
        if (cancelled) return
        setCur(current)
        setPrevBuckets(prev.buckets)
        setMonthly(months.buckets)
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : '조회 실패') })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [periodStart, periodEnd])

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto my-8" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
        <p className="text-xs text-slate-400 text-center py-6">{error}</p>
      </div>
    )
  }
  if (!cur) return null

  const isEmpty = cur.buckets.every((b) => b.revenue === 0 && b.adSpend === 0 && b.expenses === 0)
  const s = cur.summary

  // 1. 매출·마진율 콤보 데이터
  const comboData = cur.buckets.map((b) => ({
    bucket: b.bucket,
    revenue: b.revenue,
    marginRate: b.revenue > 0 ? Math.round((b.margin / b.revenue) * 1000) / 10 : 0,
  }))

  // 2. 순이익 + 전기 고스트 (인덱스 정렬: n번째 날 vs 전기 n번째 날)
  const ghostData = cur.buckets.map((b, i) => ({
    bucket: b.bucket,
    netProfit: b.netProfit,
    prevNetProfit: prevBuckets[i]?.netProfit ?? 0,
  }))

  // 3. 손익 워터폴 (total은 저장값 사용 — 반올림 차이는 무시)
  const waterfallItems: WaterfallItem[] = [
    { name: '매출', value: s.totalRevenue, kind: 'start' },
    { name: '쿠폰', value: s.totalCoupon, kind: 'minus' },
    { name: '원가', value: s.totalCost, kind: 'minus' },
    { name: '수수료', value: s.totalCommission + s.totalCommissionVat, kind: 'minus' },
    { name: '입출고', value: s.totalFulfillment + s.totalFulfillmentVat, kind: 'minus' },
    { name: '부가세', value: s.totalVat, kind: 'minus' },
    { name: '마진', value: s.totalMargin, kind: 'total' },
    { name: '광고비', value: s.totalAdSpend, kind: 'minus' },
    { name: '지출', value: s.totalExpenses, kind: 'minus' },
    { name: '순이익', value: s.netProfit, kind: 'total' },
  ]

  // 4. 월별 비용 구성
  const costData = monthly.map((b) => ({
    bucket: b.bucket,
    cost: b.cost,
    fee: b.commission + b.commissionVat + b.fulfillment + b.fulfillmentVat,
    ad: b.adSpend,
    expense: b.expenses,
    etc: b.coupon + b.vat,
  }))

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <ChartCard title="매출과 마진율" subtitle={`${periodStart} ~ ${periodEnd}`} empty={isEmpty} emptyText="데이터 없음">
        <TrendChart
          data={comboData}
          xKey="bucket"
          series={[
            { key: 'revenue', name: '매출', type: 'bar', color: 'var(--chart-muted)' },
            { key: 'marginRate', name: '마진율(%)', type: 'line', color: 'var(--chart-profit)', yAxis: 'right' },
          ]}
        />
      </ChartCard>

      <ChartCard title="순이익 (전기 대비)" subtitle="점선 = 직전 동일 기간" empty={isEmpty} emptyText="데이터 없음">
        <TrendChart
          data={ghostData}
          xKey="bucket"
          series={[
            { key: 'netProfit', name: '순이익', type: 'bar', color: 'var(--chart-profit)' },
            { key: 'prevNetProfit', name: '전기 순이익', type: 'line', color: 'var(--chart-ghost)', dashed: true },
          ]}
          colorByValue={{ key: 'netProfit', positive: 'var(--chart-profit)', negative: 'var(--chart-loss)' }}
          referenceLines={[{ y: 0, color: 'var(--chart-grid)' }]}
        />
      </ChartCard>

      <div className="lg:col-span-2">
        <ChartCard title="손익 구조 (기간 합계)" subtitle="매출 → 마진 → 순이익 워터폴" empty={isEmpty} emptyText="데이터 없음">
          <WaterfallChart items={waterfallItems} />
          {(s.coupangDeductionExpenses || 0) > 0 && (
            <p className="mt-2 text-right text-[11px] text-blue-600">
              쿠팡 정산 차감(참고·순이익 제외): {Math.round(s.coupangDeductionExpenses || 0).toLocaleString('ko-KR')}원
            </p>
          )}
        </ChartCard>
      </div>

      <div className="lg:col-span-2">
        <ChartCard
          title="비용 구성 (월별)"
          subtitle="최근 6개월 · 기타 = 쿠폰+부가세"
          empty={monthly.every((b) => b.revenue === 0 && b.adSpend === 0 && b.expenses === 0)}
          emptyText="데이터 없음"
        >
          <StackedCostChart data={costData} xTickFormatter={monthLabel} />
        </ChartCard>
      </div>
    </div>
  )
}
