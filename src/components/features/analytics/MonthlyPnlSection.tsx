'use client'

import { useEffect, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { ChartCard } from '@/components/charts/ChartCard'
import { TrendChart } from '@/components/charts/TrendChart'
import { Sparkline } from '@/components/charts/Sparkline'
import { useAnalyticsPnl } from '@/hooks/useAnalyticsPnl'
import { kstTodayStr, monthRange } from '@/lib/analytics/date-buckets'
import { fmtShort, fmtPct, monthLabel } from '@/lib/analytics/format'
import type { PnlBucket } from '@/lib/analytics/types'

/** KST 이번 달 포함 최근 N개월의 조회 기간 */
function recentMonthsPeriod(months: number): { startDate: string; endDate: string } {
  const ym = kstTodayStr().slice(0, 7)
  let [y, m] = ym.split('-').map(Number)
  for (let i = 1; i < months; i++) {
    m -= 1
    if (m < 1) {
      m = 12
      y -= 1
    }
  }
  const startYm = `${y}-${String(m).padStart(2, '0')}`
  return { startDate: monthRange(startYm).startDate, endDate: monthRange(ym).endDate }
}

interface RowDef {
  label: string
  value: (b: PnlBucket) => number
  bold?: boolean
  signed?: boolean // 양수 파랑 / 음수 빨강
  invert?: boolean // 비용 항목 (표기는 그대로, 스타일 구분 없음)
}

const ROWS: RowDef[] = [
  { label: '매출', value: (b) => b.revenue },
  { label: '쿠폰할인', value: (b) => b.coupon },
  { label: '판매수수료(VAT포함)', value: (b) => b.commission + b.commissionVat },
  { label: '입출고비(VAT포함)', value: (b) => b.fulfillment + b.fulfillmentVat },
  { label: '원가', value: (b) => b.cost },
  { label: '부가세', value: (b) => b.vat },
  { label: '마진', value: (b) => b.margin, bold: true, signed: true },
  { label: '광고비', value: (b) => b.adSpend },
  { label: '지출', value: (b) => b.expenses },
  { label: '순이익', value: (b) => b.netProfit, bold: true, signed: true },
]

/** 월별 P&L 섹션 — 자기완결: 자체 fetch/로딩/에러 처리, 실패해도 호스트 페이지에 영향 없음 */
export function MonthlyPnlSection({ months = 6 }: { months?: number }) {
  const { buckets, loading, error, fetchPnl } = useAnalyticsPnl()

  useEffect(() => {
    const { startDate, endDate } = recentMonthsPeriod(months)
    fetchPnl(startDate, endDate, 'monthly')
  }, [months, fetchPnl])

  const isEmpty = useMemo(
    () => buckets.every((b) => b.revenue === 0 && b.adSpend === 0 && b.expenses === 0),
    [buckets]
  )

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

  return (
    <div className="space-y-3">
      <ChartCard
        title="월별 순이익"
        subtitle={`최근 ${months}개월`}
        empty={buckets.length === 0 || isEmpty}
        emptyText="데이터 없음 — 정산 탭에서 판매 통계를 Import하세요."
      >
        <TrendChart
          data={buckets.map((b) => ({ bucket: b.bucket, revenue: b.revenue, netProfit: b.netProfit }))}
          xKey="bucket"
          series={[
            { key: 'revenue', name: '매출', type: 'bar', color: 'var(--chart-muted)' },
            { key: 'netProfit', name: '순이익', type: 'bar', color: 'var(--chart-profit)' },
          ]}
          colorByValue={{ key: 'netProfit', positive: 'var(--chart-profit)', negative: 'var(--chart-loss)' }}
          xTickFormatter={monthLabel}
        />
      </ChartCard>

      {!isEmpty && buckets.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">월별 P&L</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="px-2 py-2 text-left font-medium text-slate-500 whitespace-nowrap">항목</th>
                  {buckets.map((b) => (
                    <th key={b.bucket} className="px-2 py-2 text-right font-medium text-slate-500 whitespace-nowrap">
                      {monthLabel(b.bucket)}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-medium text-slate-500 whitespace-nowrap">추이</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => {
                  const values = buckets.map(row.value)
                  return (
                    <tr key={row.label} className="border-b border-slate-100 last:border-0">
                      <td className={`px-2 py-1.5 whitespace-nowrap ${row.bold ? 'font-semibold text-slate-700' : 'text-slate-500'}`}>
                        {row.label}
                      </td>
                      {values.map((v, i) => (
                        <td
                          key={buckets[i].bucket}
                          className={`px-2 py-1.5 text-right font-mono whitespace-nowrap ${
                            row.bold ? 'font-bold' : 'font-medium'
                          } ${row.signed ? (v >= 0 ? 'text-blue-600' : 'text-red-600') : 'text-slate-600'}`}
                        >
                          {v < 0 ? '-' : ''}{fmtShort(Math.abs(v))}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right">
                        <Sparkline points={values} width={64} height={16} />
                      </td>
                    </tr>
                  )
                })}
                {/* 마진율 행 — 스파크라인 제외 */}
                <tr>
                  <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">마진율(%)</td>
                  {buckets.map((b) => {
                    const rate = b.revenue > 0 ? (b.margin / b.revenue) * 100 : 0
                    return (
                      <td key={b.bucket} className="px-2 py-1.5 text-right font-mono font-medium text-slate-600 whitespace-nowrap">
                        {fmtPct(rate)}
                      </td>
                    )
                  })}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-slate-400 mt-2">매출·광고비 VAT 포함 · 원가는 이동평균 우선</p>
        </div>
      )}
    </div>
  )
}
