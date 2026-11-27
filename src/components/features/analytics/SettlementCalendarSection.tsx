'use client'

import { useState, useEffect, useMemo } from 'react'
import { Loader2, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { CalendarHeatmap } from '@/components/charts/CalendarHeatmap'
import { useAnalyticsPnl } from '@/hooks/useAnalyticsPnl'
import { kstTodayStr, monthRange, calcIntensity } from '@/lib/analytics/date-buckets'
import { estimatePayout } from '@/lib/analytics/payout'
import { fmtShort } from '@/lib/analytics/format'
import type { PnlBucket } from '@/lib/analytics/types'

/** ym 문자열 ± n개월 */
function shiftYm(ym: string, delta: number): string {
  let [y, m] = ym.split('-').map(Number)
  m += delta
  while (m < 1) { m += 12; y -= 1 }
  while (m > 12) { m -= 12; y += 1 }
  return `${y}-${String(m).padStart(2, '0')}`
}

/** 정산 캘린더 — 자기완결 섹션: 월 달력 + 일별 매출/순이익 히트맵 */
export function SettlementCalendarSection() {
  const currentYm = kstTodayStr().slice(0, 7)
  const [ym, setYm] = useState(currentYm)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const { summary, buckets, loading, error, fetchPnl } = useAnalyticsPnl()

  useEffect(() => {
    const { startDate, endDate } = monthRange(ym)
    setSelectedDate(null)
    fetchPnl(startDate, endDate, 'daily')
  }, [ym, fetchPnl])

  // 히트맵 농도: 그 달 양수 순이익 최대값 기준
  const days = useMemo(() => {
    const max = Math.max(0, ...buckets.map((b) => b.netProfit))
    return buckets.map((b) => ({
      date: b.bucket,
      primary: b.revenue,
      secondary: b.netProfit,
      intensity: calcIntensity(b.netProfit, max),
    }))
  }, [buckets])

  const selectedBucket = selectedDate ? buckets.find((b) => b.bucket === selectedDate) : null
  const [y, m] = ym.split('-').map(Number)

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5 space-y-3">
      {/* 월 이동 + 범례 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setYm(shiftYm(ym, -1))}
            className="p-1 rounded hover:bg-slate-100 text-slate-500"
            aria-label="이전 달"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-slate-700 min-w-[90px] text-center">
            {y}년 {m}월
          </span>
          <button
            onClick={() => setYm(shiftYm(ym, 1))}
            disabled={ym >= currentYm}
            className="p-1 rounded hover:bg-slate-100 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="다음 달"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <span>적자</span>
          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'var(--chart-heat-loss)' }} />
          <span className="ml-1">0</span>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: `var(--chart-heat-${i})` }} />
          ))}
          <span>최고</span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : error ? (
        <p className="text-xs text-slate-400 text-center py-10">{error}</p>
      ) : (
        <>
          {/* 월 합계 스트립 */}
          {summary && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 border-b border-slate-100 pb-2">
              <SummaryItem label="매출" value={summary.totalRevenue} />
              <SummaryItem label="마진" value={summary.totalMargin} />
              <SummaryItem label="광고비" value={summary.totalAdSpend} />
              <SummaryItem label="순이익" value={summary.netProfit} bold signed />
              <SummaryItem label="예상 정산금(추정)" value={estimatePayout(summary)} />
            </div>
          )}

          <CalendarHeatmap ym={ym} days={days} onSelectDate={setSelectedDate} />

          {/* 일 상세 패널 */}
          {selectedBucket && <DayDetail bucket={selectedBucket} onClose={() => setSelectedDate(null)} />}
        </>
      )}
    </div>
  )
}

function SummaryItem({ label, value, bold, signed }: { label: string; value: number; bold?: boolean; signed?: boolean }) {
  const color = signed ? (value >= 0 ? 'text-blue-600' : 'text-red-600') : 'text-slate-700'
  return (
    <span className="flex items-center gap-1">
      <span className="text-slate-400">{label}</span>
      <span className={`font-mono ${bold ? 'font-bold' : 'font-medium'} ${color}`}>
        {value < 0 ? '-' : ''}{fmtShort(Math.abs(value))}원
      </span>
    </span>
  )
}

function DayDetail({ bucket, onClose }: { bucket: PnlBucket; onClose: () => void }) {
  const rows: Array<{ label: string; value: number; signed?: boolean }> = [
    { label: '매출', value: bucket.revenue },
    { label: '원가', value: bucket.cost },
    { label: '수수료(VAT포함)', value: bucket.commission + bucket.commissionVat },
    { label: '입출고(VAT포함)', value: bucket.fulfillment + bucket.fulfillmentVat },
    { label: '쿠폰', value: bucket.coupon },
    { label: '광고비', value: bucket.adSpend },
    { label: '지출', value: bucket.expenses },
    { label: '순이익', value: bucket.netProfit, signed: true },
  ]
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-700">{bucket.bucket}</span>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-slate-200 text-slate-400" aria-label="닫기">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between">
            <span className="text-xs text-slate-500">{r.label}</span>
            <span
              className={`text-xs font-mono font-medium ${
                r.signed ? (r.value >= 0 ? 'text-blue-600' : 'text-red-600') : 'text-slate-700'
              }`}
            >
              {r.value < 0 ? '-' : ''}{fmtShort(Math.abs(r.value))}원
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
