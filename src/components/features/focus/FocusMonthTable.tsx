'use client'

import { CircleDot } from 'lucide-react'
import type { DailyOpsRow, FocusDailyTotals } from '@/types/focus'

interface FocusMonthTableProps {
  rows: DailyOpsRow[]
  totals: FocusDailyTotals
  yesterday: string
}

const weekdays = ['일', '월', '화', '수', '목', '금', '토']
const cellClass = 'whitespace-nowrap px-2 py-2 text-right tabular-nums'

const formatNumber = (value: number | null) =>
  value == null ? '—' : Math.round(value).toLocaleString('ko-KR')
const formatPercent = (value: number | null, digits = 1) =>
  value == null ? '—' : `${value.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`

function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  return `${Number(date.slice(8, 10))}일 (${weekdays[parsed.getUTCDay()]})`
}

function AdCostCell({ row }: { row: DailyOpsRow }) {
  if (row.ad_cost_basis === 'missing' || row.ad_cost == null) {
    return <span className="text-slate-400" title="수집안됨">—</span>
  }

  const provisional = row.ad_cost_basis === 'provisional_tablemetric'
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {formatNumber(row.ad_cost)}
      <span
        title={provisional ? '광고센터 잠정값, 정산 도착 시 자동 교체' : '정산 광고비'}
        className={`rounded px-1 py-0.5 text-[9px] font-medium ${
          provisional ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
        }`}
      >
        {provisional ? '잠정' : '정산'}
      </span>
    </span>
  )
}

function SettingCell({ value, changed, percent = false }: {
  value: number | null
  changed: boolean
  percent?: boolean
}) {
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {percent ? formatPercent(value, 0) : formatNumber(value)}
      {changed && value != null && (
        <CircleDot className="h-3 w-3 text-emerald-500" aria-label="설정 변경" />
      )}
    </span>
  )
}

export function FocusMonthTable({ rows, totals, yesterday }: FocusMonthTableProps) {
  const organicTotal = rows.reduce((sum, row) => sum + (row.organic_qty ?? 0), 0)
  const hasAdCost = rows.some((row) => row.ad_cost_basis !== 'missing' && row.ad_cost != null)
  const monthlyRoas = totals.ad_cost > 0 ? (totals.revenue / totals.ad_cost) * 100 : null
  const organicRate = totals.sales_qty !== 0 ? organicTotal / totals.sales_qty : null

  return (
    <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 px-3 py-2 text-[10px] text-slate-500">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-100" />자동수집</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-100" />외부수확</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-blue-100" />계산</span>
        <span className="ml-auto">금액 단위: 원</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1240px] border-collapse text-[11px]">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {['날짜', '판매량', '총매출', '총마진', '광고예산', '목표ROAS', '집행광고비', '광고전환판매', '일반판매', '광고수익율', '일순익', '자연판매%', '비고'].map((header) => (
                <th key={header} className="whitespace-nowrap border-b border-slate-200 px-2 py-2 text-right font-semibold first:text-left last:text-left">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {rows.map((row) => {
              const isYesterday = row.date === yesterday
              return (
                <tr key={row.date} className={isYesterday ? 'bg-green-50 font-semibold' : 'hover:bg-slate-50/60'}>
                  <td className="whitespace-nowrap px-2 py-2 text-left">{formatDate(row.date)}</td>
                  <td className={`${cellClass} bg-emerald-50/30`}>{formatNumber(row.sales_qty)}</td>
                  <td className={`${cellClass} bg-emerald-50/30`}>{formatNumber(row.revenue)}</td>
                  <td className={`${cellClass} bg-emerald-50/30 ${row.margin != null && row.margin < 0 ? 'text-red-600' : row.margin != null && row.margin > 0 ? 'text-blue-600' : ''}`}>
                    {formatNumber(row.margin)}
                  </td>
                  <td className={cellClass}><SettingCell value={row.budget} changed={row.setting_changed_on_date} /></td>
                  <td className={cellClass}><SettingCell value={row.target_roas} changed={row.setting_changed_on_date} percent /></td>
                  <td className={`${cellClass} bg-amber-50/30`}><AdCostCell row={row} /></td>
                  <td className={`${cellClass} bg-amber-50/30`}>{formatNumber(row.ad_units)}</td>
                  <td className={`${cellClass} bg-blue-50/30 ${row.organic_qty != null && row.organic_qty < 0 ? 'text-red-600' : ''}`}>
                    {formatNumber(row.organic_qty)}
                  </td>
                  <td className={`${cellClass} bg-blue-50/30`}>{formatPercent(row.roas_pct)}</td>
                  <td className={`${cellClass} bg-blue-50/30 font-medium ${row.net_profit != null && row.net_profit < 0 ? 'text-red-600' : row.net_profit != null && row.net_profit > 0 ? 'text-blue-600' : ''}`}>
                    {formatNumber(row.net_profit)}
                  </td>
                  <td className={`${cellClass} bg-blue-50/30 ${row.organic_rate != null && row.organic_rate < 0 ? 'text-red-600' : ''}`}>
                    {formatPercent(row.organic_rate == null ? null : row.organic_rate * 100)}
                  </td>
                  <td className="max-w-[180px] px-2 py-2 text-left" title={row.note || undefined}>
                    <span className="block truncate text-slate-500">{row.note || '—'}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-700">
            <tr>
              <td className="px-2 py-2 text-left">월 합계</td>
              <td className={cellClass}>{formatNumber(totals.sales_qty)}</td>
              <td className={cellClass}>{formatNumber(totals.revenue)}</td>
              <td className={`${cellClass} ${totals.margin < 0 ? 'text-red-600' : totals.margin > 0 ? 'text-blue-600' : ''}`}>{formatNumber(totals.margin)}</td>
              <td className={cellClass}>—</td>
              <td className={cellClass}>—</td>
              <td className={cellClass}>{formatNumber(hasAdCost ? totals.ad_cost : null)}</td>
              <td className={cellClass}>{formatNumber(totals.ad_units)}</td>
              <td className={`${cellClass} ${organicTotal < 0 ? 'text-red-600' : ''}`}>{formatNumber(organicTotal)}</td>
              <td className={cellClass}>{formatPercent(monthlyRoas)}</td>
              <td className={`${cellClass} ${totals.net_profit < 0 ? 'text-red-600' : totals.net_profit > 0 ? 'text-blue-600' : ''}`}>
                {formatNumber(totals.net_profit)}
              </td>
              <td className={`${cellClass} ${organicRate != null && organicRate < 0 ? 'text-red-600' : ''}`}>
                {formatPercent(organicRate == null ? null : organicRate * 100)}
              </td>
              <td className="px-2 py-2 text-left">
                {totals.provisionalDays > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-medium text-amber-700">
                    잠정 {totals.provisionalDays}일 포함
                  </span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
