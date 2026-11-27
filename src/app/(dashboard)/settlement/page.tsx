'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Plus, Loader2, Download, X, Search, Filter,
  ChevronUp, ChevronDown, LayoutDashboard, List, Upload,
  DollarSign, TrendingUp, BarChart3, Receipt, Megaphone, Ticket, Truck, Calendar, Scale,
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { ChartTooltipContent } from '@/components/ui/chart'
import { SALES_EXPORT_COLUMNS } from '@/lib/export/excel'
import { ExportButton } from '@/components/shared/ExportButton'
import { Header } from '@/components/layout/Header'
import { PeriodSelector } from '@/components/features/settlement/PeriodSelector'
import { SettlementForm } from '@/components/features/settlement/SettlementForm'
import { BulkCouponModal } from '@/components/features/settlement/BulkCouponModal'
import { SettlementReconcile } from '@/components/features/settlement/SettlementReconcile'
import { FileImporter } from '@/components/features/import/FileImporter'
import { useSettlement } from '@/hooks/useSettlement'
import { useReport, getDefaultPeriod } from '@/hooks/useReport'
import { useSalesTransactions } from '@/hooks/useSalesTransactions'
import { usePnl } from '@/hooks/usePnl'
import { MonthlyPnlSection } from '@/components/features/analytics/MonthlyPnlSection'
import { SettlementCalendarSection } from '@/components/features/analytics/SettlementCalendarSection'
import { PnlComboSection } from '@/components/features/analytics/PnlComboSection'
import { apiFetch } from '@/lib/api-client'
import type { PeriodFilter } from '@/types/settlement'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TX = any
type SortDir = 'asc' | 'desc' | null

type Tab = 'dashboard' | 'daily-sales' | 'monthly' | 'calendar' | 'reconcile' | 'import'

function sortItems(items: TX[], key: string, dir: SortDir): TX[] {
  if (!dir || !key) return items
  return [...items].sort((a, b) => {
    let va = key.includes('.') ? key.split('.').reduce((o: TX, k: string) => o?.[k], a) : a[key]
    let vb = key.includes('.') ? key.split('.').reduce((o: TX, k: string) => o?.[k], b) : b[key]
    if (va == null) va = dir === 'asc' ? Infinity : -Infinity
    if (vb == null) vb = dir === 'asc' ? Infinity : -Infinity
    if (typeof va === 'string') va = va.toLowerCase()
    if (typeof vb === 'string') vb = vb.toLowerCase()
    return va < vb ? (dir === 'asc' ? -1 : 1) : va > vb ? (dir === 'asc' ? 1 : -1) : 0
  })
}

/** 기간 내 모든 날짜를 채워 빈 날짜도 0으로 표시 */
function fillMissingDates(daily: TX[], startDate: string, endDate: string): TX[] {
  const dataMap = new Map<string, TX>()
  for (const d of daily) dataMap.set(d.date, d)

  const result: TX[] = []
  const cur = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')

  while (cur <= end) {
    const y = cur.getFullYear()
    const m = String(cur.getMonth() + 1).padStart(2, '0')
    const day = String(cur.getDate()).padStart(2, '0')
    const key = `${y}-${m}-${day}`
    result.push(dataMap.get(key) || {
      date: key, revenue: 0, quantity: 0, cost: 0, commission: 0, commissionVat: 0,
      fulfillment: 0, fulfillmentVat: 0, coupon: 0, vat: 0, cancelAmount: 0,
      margin: 0, adSpend: 0, expenses: 0, netProfit: 0,
    })
    cur.setDate(cur.getDate() + 1)
  }
  return result
}

// ── 쿠폰 인라인 편집 셀 (일일매출 표) ──
function CouponCell({ tx, onSave }: { tx: TX; onSave: (id: string, value: number) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const cur = Number(tx.coupon_discount || 0)

  const start = () => { setValue(String(Math.ceil(cur) || 0)); setEditing(true) }
  const commit = async () => {
    if (!editing) return
    setEditing(false)
    const num = Number(value)
    if (!Number.isFinite(num) || num < 0 || num === cur) return
    setSaving(true)
    await onSave(tx.id, num)
    setSaving(false)
  }

  if (editing) {
    return (
      <td className="px-2 py-2 text-right">
        <input
          type="number" autoFocus value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          className="w-16 h-6 px-1 text-right border border-brand-400 rounded text-[11px] font-mono"
        />
      </td>
    )
  }
  return (
    <td className="px-2 py-2 text-right font-mono text-slate-500">
      <button type="button" onClick={start} title="쿠폰 직접 수정"
        className={`border-b border-dashed border-slate-300 hover:border-brand-500 hover:text-brand-600 ${saving ? 'opacity-40' : ''}`}>
        {cur !== 0 ? Math.ceil(cur).toLocaleString() : '-'}
      </button>
    </td>
  )
}

// ── 대시보드 탭 (P&L + SKU 랭킹) ──
function SettlementDashboard({ pnl, pnlDaily, ranking, loading, periodStart, periodEnd }: {
  pnl: TX | null
  pnlDaily: TX[]
  ranking: TX[]
  loading: boolean
  periodStart: string
  periodEnd: string
}) {
  const fmt = (v: number) => Math.ceil(v).toLocaleString('ko-KR')
  const fmtShort = (v: number) => Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(1)}만` : fmt(v)

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
  if (!pnl) return (
    <div className="text-center py-12">
      <Receipt className="w-12 h-12 text-slate-300 mx-auto mb-3" />
      <p className="text-sm text-slate-500">데이터가 없습니다.</p>
      <p className="text-xs text-slate-400 mt-1">엑셀 임포트 탭에서 판매 통계 파일을 업로드하세요.</p>
    </div>
  )

  const fmtWon = (v: number) => `${v.toLocaleString('ko-KR')}원`

  return (
    <div className="space-y-4">
      {/* KPI 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-7 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center"><DollarSign className="w-4 h-4 text-blue-600" /></div>
            <span className="text-xs text-slate-500">총 매출 <span className="text-[9px] text-slate-400 font-normal">(VAT포함)</span></span>
          </div>
          <p className="text-2xl font-bold text-slate-800 font-mono">{fmtShort(pnl.totalRevenue)}<span className="text-sm font-normal text-slate-400 ml-0.5">원</span></p>
          <p className="text-[10px] text-slate-400 mt-0.5">{pnl.totalQuantity}개 판매</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center"><Ticket className="w-4 h-4 text-rose-500" /></div>
            <span className="text-xs text-slate-500">쿠폰 할인</span>
          </div>
          <p className="text-2xl font-bold text-rose-500 font-mono">{pnl.totalCoupon > 0 ? '-' : ''}{fmtShort(pnl.totalCoupon)}<span className="text-sm font-normal text-slate-400 ml-0.5">원</span></p>
          <p className="text-[10px] text-slate-400 mt-0.5">매출 대비 {pnl.totalRevenue > 0 ? (pnl.totalCoupon / pnl.totalRevenue * 100).toFixed(1) : 0}%</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center"><Truck className="w-4 h-4 text-orange-500" /></div>
            <span className="text-xs text-slate-500">입출고배송비</span>
          </div>
          <p className="text-2xl font-bold text-orange-500 font-mono">{(pnl.totalFulfillment + pnl.totalFulfillmentVat) > 0 ? '-' : ''}{fmtShort(pnl.totalFulfillment + pnl.totalFulfillmentVat)}<span className="text-sm font-normal text-slate-400 ml-0.5">원</span></p>
          <p className="text-[10px] text-slate-400 mt-0.5">VAT 포함</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center"><TrendingUp className="w-4 h-4 text-blue-600" /></div>
            <span className="text-xs text-slate-500">마진</span>
          </div>
          <p className="text-2xl font-bold text-blue-600 font-mono">{fmtShort(pnl.totalMargin)}<span className="text-sm font-normal text-slate-400 ml-0.5">원</span></p>
          <p className="text-[10px] text-slate-400 mt-0.5">마진율 {pnl.totalRevenue > 0 ? (pnl.totalMargin / pnl.totalRevenue * 100).toFixed(1) : 0}%</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center"><Megaphone className="w-4 h-4 text-red-500" /></div>
            <span className="text-xs text-slate-500">광고비 <span className="text-[9px] text-slate-400 font-normal">(VAT포함)</span></span>
          </div>
          <p className="text-2xl font-bold text-red-500 font-mono">{pnl.totalAdSpend > 0 ? '-' : ''}{fmtShort(pnl.totalAdSpend)}<span className="text-sm font-normal text-slate-400 ml-0.5">원</span></p>
          <p className="text-[10px] text-slate-400 mt-0.5">ROAS {pnl.totalAdSpend > 0 ? (pnl.totalRevenue / pnl.totalAdSpend).toFixed(1) : '-'}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center"><Receipt className="w-4 h-4 text-amber-600" /></div>
            <span className="text-xs text-slate-500">운영 지출</span>
          </div>
          <p className="text-2xl font-bold text-amber-600 font-mono">{pnl.totalExpenses > 0 ? '-' : ''}{fmtShort(pnl.totalExpenses)}<span className="text-sm font-normal text-slate-400 ml-0.5">원</span></p>
          <p className="text-[10px] text-slate-400 mt-0.5">기타 운영 비용</p>
        </div>
        <div className={`bg-white rounded-xl border-2 p-4 ${pnl.netProfit >= 0 ? 'border-blue-300' : 'border-red-300'}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-slate-500">순이익</span>
          </div>
          <p className={`text-2xl font-bold font-mono ${pnl.netProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{fmtShort(pnl.netProfit)}<span className="text-sm font-normal text-slate-400 ml-0.5">원</span></p>
          <p className="text-[10px] text-slate-400 mt-0.5">= 마진 - 광고비 - 지출</p>
        </div>
      </div>

      {/* 비용 상세 */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">비용 상세</h3>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
          <div className="flex justify-between"><span className="text-slate-500">원가</span><span className="font-mono text-slate-700">{fmt(pnl.totalCost)}원</span></div>
          <div className="flex justify-between"><span className="text-slate-500">쿠폰 할인</span><span className="font-mono text-slate-700">{fmt(pnl.totalCoupon)}원</span></div>
          <div className="flex justify-between"><span className="text-slate-500">판매수수료</span><span className="font-mono text-slate-700">{fmt(pnl.totalCommission)}원</span></div>
          <div className="flex justify-between"><span className="text-slate-500">수수료 VAT</span><span className="font-mono text-slate-700">{fmt(pnl.totalCommissionVat)}원</span></div>
          <div className="flex justify-between"><span className="text-slate-500">입출고배송비</span><span className="font-mono text-slate-700">{fmt(pnl.totalFulfillment)}원</span></div>
          <div className="flex justify-between"><span className="text-slate-500">입출고 VAT</span><span className="font-mono text-slate-700">{fmt(pnl.totalFulfillmentVat)}원</span></div>
          <div className="flex justify-between"><span className="text-slate-500">부가세</span><span className="font-mono text-slate-700">{fmt(pnl.totalVat)}원</span></div>
          <div className="flex justify-between"><span className="text-slate-500">취소 금액</span><span className="font-mono text-slate-700">{fmt(pnl.totalCancelAmount)}원</span></div>
        </div>
        <hr className="border-slate-200 my-2" />
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
          <div className="flex justify-between"><span className="text-slate-500">광고비 <span className="text-[10px] text-slate-400">(VAT포함)</span></span><span className="font-mono text-red-600">{fmt(pnl.totalAdSpend)}원</span></div>
          <div className="flex justify-between"><span className="text-slate-500">운영 지출</span><span className="font-mono text-red-600">{fmt(pnl.totalExpenses)}원</span></div>
          <div className="flex justify-between"><span className="text-slate-500">쿠팡 정산 차감 <span className="text-[10px] text-blue-400">(참고·순이익 제외)</span></span><span className="font-mono text-blue-600">{fmt(pnl.coupangDeductionExpenses || 0)}원</span></div>
        </div>
        <hr className="border-slate-200 my-2" />
        <div className="flex justify-between text-sm font-semibold">
          <span className="text-slate-700">순이익</span>
          <span className={`font-mono ${pnl.netProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{fmt(pnl.netProfit)}원</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 일별 매출 추이 차트 */}
        {pnlDaily.length > 0 && (() => {
          const filled = fillMissingDates(pnlDaily, periodStart, periodEnd)
          const chartData = filled.slice(-21)
          return (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> 일별 매출 추이
              </h3>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(8)} tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v: number) => fmtShort(v)} tick={{ fontSize: 10 }} width={45} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltipContent labelFormatter={(l: string) => l} formatter={(v: number, name: string) => `${name === '순이익' ? '' : ''}${fmtWon(v)}`} />} />
                  <Bar dataKey="revenue" name="매출" radius={[3, 3, 0, 0]}>
                    {chartData.map((d: TX) => (
                      <Cell key={d.date} fill={d.netProfit >= 0 ? '#93c5fd' : '#fca5a5'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-400">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-300" /> 순이익 양수</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-300" /> 순이익 음수</span>
              </div>
            </div>
          )
        })()}

        {/* SKU 수익성 랭킹 TOP 5 */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> SKU 수익성 TOP 5
          </h3>
          {ranking.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">데이터가 없습니다.</p>
          ) : (
            <div className="space-y-2.5">
              {ranking.slice(0, 5).map((item: TX) => {
                const gradeColors: Record<string, string> = { A: 'bg-blue-100 text-blue-700', B: 'bg-green-100 text-green-700', C: 'bg-amber-100 text-amber-700', D: 'bg-red-100 text-red-700' }
                return (
                  <div key={item.productId} className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${gradeColors[item.grade] || ''}`}>{item.grade}</span>
                    <span className="text-xs text-slate-700 truncate flex-1">{item.productName}</span>
                    <span className="text-xs font-mono text-slate-500">{(item.avgMarginRate * 100).toFixed(1)}%</span>
                    <span className={`text-xs font-mono font-semibold ${item.totalNetProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{fmtShort(item.totalNetProfit)}원</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 일별 P&L 테이블 */}
      {pnlDaily.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-700">일별 매출/순이익</h3>
          </div>
          <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
            <table className="w-full min-w-[1100px] text-[11px]">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th className="text-left px-2 py-2 font-medium text-slate-500 whitespace-nowrap">날짜</th>
                  <th className="text-right px-2 py-2 font-medium text-slate-500 whitespace-nowrap">매출</th>
                  <th className="text-right px-2 py-2 font-medium text-slate-500 whitespace-nowrap">수량</th>
                  <th className="text-right px-2 py-2 font-medium text-slate-500 whitespace-nowrap">원가</th>
                  <th className="text-right px-2 py-2 font-medium text-slate-500 whitespace-nowrap">수수료</th>
                  <th className="text-right px-2 py-2 font-medium text-slate-500 whitespace-nowrap">수수료VAT</th>
                  <th className="text-right px-2 py-2 font-medium text-slate-500 whitespace-nowrap">입출고</th>
                  <th className="text-right px-2 py-2 font-medium text-slate-500 whitespace-nowrap">입출고VAT</th>
                  <th className="text-right px-2 py-2 font-medium text-slate-500 whitespace-nowrap">쿠폰</th>
                  <th className="text-right px-2 py-2 font-medium text-slate-500 whitespace-nowrap">부가세</th>
                  <th className="text-right px-2 py-2 font-medium text-slate-500 whitespace-nowrap">취소</th>
                  <th className="text-right px-2 py-2 font-medium text-slate-500 whitespace-nowrap">마진</th>
                  <th className="text-right px-2 py-2 font-medium text-slate-500 whitespace-nowrap">광고비</th>
                  <th className="text-right px-2 py-2 font-medium text-slate-500 whitespace-nowrap">지출</th>
                  <th className="text-right px-2 py-2 font-medium text-slate-500 whitespace-nowrap">순이익</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pnlDaily.map((d: TX) => {
                  const c = (v: number) => v !== 0 ? Math.ceil(v).toLocaleString() : '-'
                  return (
                    <tr key={d.date} className="hover:bg-slate-50">
                      <td className="px-2 py-2 text-slate-600 whitespace-nowrap">{d.date}</td>
                      <td className="px-2 py-2 text-right font-mono">{Math.ceil(d.revenue).toLocaleString()}</td>
                      <td className="px-2 py-2 text-right">{d.quantity}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-500">{c(d.cost)}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-500">{c(d.commission)}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-400">{c(d.commissionVat)}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-500">{c(d.fulfillment)}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-400">{c(d.fulfillmentVat)}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-500">{c(d.coupon)}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-400">{c(d.vat)}</td>
                      <td className="px-2 py-2 text-right font-mono text-red-400">{c(d.cancelAmount)}</td>
                      <td className="px-2 py-2 text-right font-mono text-blue-600">{Math.ceil(d.margin).toLocaleString()}</td>
                      <td className="px-2 py-2 text-right font-mono text-red-500">{d.adSpend > 0 ? `-${Math.ceil(d.adSpend).toLocaleString()}` : '-'}</td>
                      <td className="px-2 py-2 text-right font-mono text-red-500">{d.expenses > 0 ? `-${Math.ceil(d.expenses).toLocaleString()}` : '-'}</td>
                      <td className={`px-2 py-2 text-right font-mono font-semibold ${d.netProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{Math.ceil(d.netProfit).toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 메인 페이지 ──
export default function SettlementPage() {
  const { submitSettlement, error: settlementError, setError: setSettlementError } = useSettlement()
  const { ranking, loading: reportLoading, error: reportError, fetchRanking, setError: setReportError } = useReport()
  const { transactions, loading: salesLoading, error: salesError, setError: setSalesError, fetchTransactions, updateCoupon } = useSalesTransactions()
  const { summary: pnl, daily: pnlDaily, loading: pnlLoading, error: pnlError, setError: setPnlError, fetchPnl } = usePnl()

  const [activeTab, setActiveTab] = useState<Tab>('dashboard')
  const [period, setPeriod] = useState<PeriodFilter>(getDefaultPeriod)
  const [formOpen, setFormOpen] = useState(false)
  const [showImporter, setShowImporter] = useState(false)
  const [bulkCouponOpen, setBulkCouponOpen] = useState(false)
  const [taxExporting, setTaxExporting] = useState(false)
  const [taxExportError, setTaxExportError] = useState<string | null>(null)

  // 일일매출 필터/정렬/페이지네이션
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<string>('order_date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(15)

  const handlePeriodChange = useCallback((filter: PeriodFilter) => { setPeriod(filter); setPage(0) }, [])

  const handleTaxExport = async () => {
    setTaxExporting(true)
    setTaxExportError(null)
    try {
      const params = new URLSearchParams({
        startDate: period.periodStart,
        endDate: period.periodEnd,
      })
      const response = await apiFetch(`/api/export/tax-package?${params}`)
      if (!response.ok) {
        const json = await response.json()
        throw new Error(json.error || '세무 자료 다운로드 실패')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `NexOps_세무자료_${period.periodStart.replace(/-/g, '')}_${period.periodEnd.replace(/-/g, '')}.xlsx`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setTaxExportError(error instanceof Error ? error.message : '세무 자료 다운로드 실패')
    } finally {
      setTaxExporting(false)
    }
  }

  useEffect(() => {
    const { periodStart, periodEnd } = period
    if (activeTab === 'dashboard') {
      fetchPnl(periodStart, periodEnd)
      fetchRanking(periodStart, periodEnd)
    } else if (activeTab === 'daily-sales') {
      fetchTransactions(periodStart, periodEnd)
    }
  }, [activeTab, period, fetchPnl, fetchRanking, fetchTransactions])

  // 일일매출 필터 + 정렬
  const filtered = useMemo(() => {
    let list = [...transactions]
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter((tx: TX) =>
        (tx.products?.product_name || '').toLowerCase().includes(q) ||
        (tx.option_name || '').toLowerCase().includes(q) ||
        (tx.option_id || '').toLowerCase().includes(q)
      )
    }
    return sortItems(list, sortKey, sortDir)
  }, [transactions, searchQuery, sortKey, sortDir])

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize)
  const totalSalesAmount = filtered.reduce((s: number, tx: TX) => s + (Number(tx.total_amount) || 0), 0)

  // 쿠폰 일괄 설정용 상품 목록 (거래에 등장하는 매칭 상품, NEW/반품 등급 표기 + 옵션ID 검색용)
  const couponProducts = useMemo(() => {
    const map = new Map<string, { label: string; optionId: string }>()
    for (const tx of transactions as TX[]) {
      if (tx.product_id && !map.has(tx.product_id)) {
        const grade = tx.products?.product_grade || ''
        const prefix = grade.includes('반품') ? `[${grade}]` : '[NEW]'
        const name = tx.option_name || tx.products?.product_name || tx.product_id
        map.set(tx.product_id, { label: `${prefix} ${name}`, optionId: tx.option_id || '' })
      }
    }
    return Array.from(map.entries())
      .map(([productId, v]) => ({ productId, label: v.label, optionId: v.optionId }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko'))
  }, [transactions])

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : sortDir === 'desc' ? null : 'asc')
    else { setSortKey(key); setSortDir('asc') }
    setPage(0)
  }

  const SortIcon = ({ col }: { col: string }) => (
    <span className="inline-flex flex-col ml-0.5 -space-y-1">
      <ChevronUp className={`w-3 h-3 ${sortKey === col && sortDir === 'asc' ? 'text-brand-600' : 'text-slate-300'}`} />
      <ChevronDown className={`w-3 h-3 ${sortKey === col && sortDir === 'desc' ? 'text-brand-600' : 'text-slate-300'}`} />
    </span>
  )

  const thCls = 'px-2 py-2 text-[11px] font-medium text-slate-500 whitespace-nowrap cursor-pointer select-none hover:text-slate-700'

  return (
    <>
      <Header title="정산" />
      <div className="max-w-full px-4 lg:px-6 py-4 space-y-3">
        {[
          { key: 'pnl', message: pnlError, clear: () => setPnlError(null) },
          { key: 'ranking', message: reportError, clear: () => setReportError(null) },
          { key: 'sales', message: salesError, clear: () => setSalesError(null) },
          { key: 'settlement', message: settlementError, clear: () => setSettlementError(null) },
        ].filter((item) => item.message).map((item) => (
          <div key={item.key} role="alert" className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            <span>{item.message}</span>
            <button type="button" onClick={item.clear} aria-label="오류 닫기"><X className="h-4 w-4" /></button>
          </div>
        ))}
        {/* 탭 */}
        <div className="flex w-full items-center gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 sm:w-fit">
          <button onClick={() => setActiveTab('dashboard')}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded text-sm font-medium transition-colors ${activeTab === 'dashboard' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <LayoutDashboard className="w-3.5 h-3.5" /> 매출/손익
          </button>
          <button onClick={() => setActiveTab('daily-sales')}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded text-sm font-medium transition-colors ${activeTab === 'daily-sales' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <List className="w-3.5 h-3.5" /> 일일매출
          </button>
          <button onClick={() => setActiveTab('monthly')}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded text-sm font-medium transition-colors ${activeTab === 'monthly' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <BarChart3 className="w-3.5 h-3.5" /> 월별
          </button>
          <button onClick={() => setActiveTab('calendar')}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded text-sm font-medium transition-colors ${activeTab === 'calendar' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <Calendar className="w-3.5 h-3.5" /> 캘린더
          </button>
          <button onClick={() => setActiveTab('reconcile')}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded text-sm font-medium transition-colors ${activeTab === 'reconcile' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <Scale className="w-3.5 h-3.5" /> 정산 대조
          </button>
          <button onClick={() => setActiveTab('import')}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded text-sm font-medium transition-colors ${activeTab === 'import' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <Upload className="w-3.5 h-3.5" /> Import
          </button>
        </div>

        {/* 기간 셀렉터 (정산 대조는 정산주기 기준이라 기간 필터 부적합) */}
        {activeTab !== 'import' && activeTab !== 'reconcile' && (
          <div className="space-y-2">
            <PeriodSelector value={period} onChange={handlePeriodChange} />
            <div className="flex items-center justify-end gap-2">
              {taxExportError && <span className="text-[10px] text-red-500">{taxExportError}</span>}
              <button
                type="button"
                onClick={handleTaxExport}
                disabled={taxExporting}
                className="flex h-8 items-center gap-1 rounded border border-slate-200 px-3 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-40"
              >
                {taxExporting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Download className="h-3.5 w-3.5" />}
                세무자료 XLSX
              </button>
            </div>
          </div>
        )}

        {/* 대시보드 탭 */}
        {activeTab === 'dashboard' && (
          <>
            <SettlementDashboard pnl={pnl} pnlDaily={pnlDaily} ranking={ranking} loading={pnlLoading || reportLoading} periodStart={period.periodStart} periodEnd={period.periodEnd} />
            {/* 시각화 강화 (ops-ux Phase 6 — 자기완결 섹션) */}
            <PnlComboSection periodStart={period.periodStart} periodEnd={period.periodEnd} />
          </>
        )}

        {/* 일일매출 탭 */}
        {activeTab === 'daily-sales' && (
          <>
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Filter className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-medium text-slate-600">필터</span>
                <div className="relative w-full min-w-[200px] flex-1 sm:ml-2 sm:max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input type="text" value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setPage(0) }}
                    placeholder="상품명 / 옵션명 검색" className="w-full h-8 pl-8 pr-3 border border-slate-200 rounded-lg text-sm" />
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
                  <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}
                    className="h-8 px-2 border border-slate-200 rounded text-xs text-slate-600">
                    <option value={15}>15개</option><option value={30}>30개</option><option value={50}>50개</option><option value={100}>100개</option>
                  </select>
                  <button onClick={() => setBulkCouponOpen(true)}
                    disabled={couponProducts.length === 0} className="flex items-center gap-1 px-3 h-8 border border-rose-200 text-rose-600 rounded text-xs hover:bg-rose-50 disabled:opacity-40">
                    <Ticket className="w-3.5 h-3.5" /> 쿠폰 일괄 설정
                  </button>
                  <ExportButton
                    data={filtered}
                    columns={SALES_EXPORT_COLUMNS}
                    filename="NexOps_판매내역"
                    sheetName="판매"
                    disabled={filtered.length === 0}
                  />
                </div>
              </div>
            </div>

            {salesLoading && (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
            )}

            {!salesLoading && (
              <>
                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <span>총 {filtered.length}건</span>
                  {totalSalesAmount > 0 && <span>매출 합계 {Math.ceil(totalSalesAmount).toLocaleString()}원 <span className="text-[10px] text-slate-400">(VAT포함)</span></span>}
                  <span className="text-[11px] text-slate-400 ml-auto">💡 쿠폰 값을 클릭하면 직접 수정할 수 있습니다 (마진 자동 재계산)</span>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
                    <table className="w-full min-w-[1000px] text-[11px]">
                      <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                        <tr>
                          <th className={`text-left ${thCls}`} onClick={() => toggleSort('order_date')}>주문일<SortIcon col="order_date" /></th>
                          <th className={`text-left ${thCls}`} onClick={() => toggleSort('option_name')}>상품<SortIcon col="option_name" /></th>
                          <th className={`text-right ${thCls}`} onClick={() => toggleSort('order_quantity')}>수량<SortIcon col="order_quantity" /></th>
                          <th className={`text-right ${thCls}`} onClick={() => toggleSort('selling_price')}>판매가<span className="text-[9px] text-slate-400 font-normal">(VAT포함)</span><SortIcon col="selling_price" /></th>
                          <th className={`text-right ${thCls}`} onClick={() => toggleSort('total_amount')}>매출액<span className="text-[9px] text-slate-400 font-normal">(VAT포함)</span><SortIcon col="total_amount" /></th>
                          <th className={`text-right ${thCls}`} onClick={() => toggleSort('commission_fee')}>수수료<SortIcon col="commission_fee" /></th>
                          <th className={`text-right ${thCls}`} onClick={() => toggleSort('commission_vat')}>수수료VAT<SortIcon col="commission_vat" /></th>
                          <th className={`text-right ${thCls}`} onClick={() => toggleSort('fulfillment_fee')}>입출고<SortIcon col="fulfillment_fee" /></th>
                          <th className={`text-right ${thCls}`} onClick={() => toggleSort('fulfillment_vat')}>입출고VAT<SortIcon col="fulfillment_vat" /></th>
                          <th className={`text-right ${thCls}`} onClick={() => toggleSort('coupon_discount')}>쿠폰<SortIcon col="coupon_discount" /></th>
                          <th className={`text-right ${thCls}`} onClick={() => toggleSort('vat')}>부가세<SortIcon col="vat" /></th>
                          <th className={`text-right ${thCls}`} onClick={() => toggleSort('margin')}>마진<SortIcon col="margin" /></th>
                          <th className={`text-right ${thCls}`} onClick={() => toggleSort('cancel_amount')}>취소<SortIcon col="cancel_amount" /></th>
                          <th className={`text-center ${thCls}`} onClick={() => toggleSort('status')}>상태<SortIcon col="status" /></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {paged.length === 0 ? (
                          <tr>
                            <td colSpan={14} className="px-2 py-12 text-center">
                              <Receipt className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                              <p className="text-xs text-slate-400">{transactions.length === 0 ? '일일 매출 데이터가 없습니다.' : '검색 결과가 없습니다.'}</p>
                            </td>
                          </tr>
                        ) : paged.map((tx: TX) => {
                          const v = (val: unknown) => { const n = Number(val || 0); return n !== 0 ? Math.ceil(n).toLocaleString() : '-' }
                          return (
                          <tr key={tx.id} className="hover:bg-slate-50">
                            <td className="px-2 py-2 text-slate-600 whitespace-nowrap">{tx.order_date || ''}</td>
                            <td className="px-2 py-2 text-slate-800 max-w-[200px]"><div className="truncate">{tx.option_name || tx.products?.product_name || '-'}</div></td>
                            <td className="px-2 py-2 text-right font-mono">{tx.order_quantity || 0}</td>
                            <td className="px-2 py-2 text-right font-mono">{Math.ceil(Number(tx.selling_price || 0)).toLocaleString()}</td>
                            <td className="px-2 py-2 text-right font-mono font-medium">{Math.ceil(Number(tx.total_amount || 0)).toLocaleString()}</td>
                            <td className="px-2 py-2 text-right font-mono text-slate-500">{v(tx.commission_fee)}</td>
                            <td className="px-2 py-2 text-right font-mono text-slate-400">{v(tx.commission_vat)}</td>
                            <td className="px-2 py-2 text-right font-mono text-slate-500">{v(tx.fulfillment_fee)}</td>
                            <td className="px-2 py-2 text-right font-mono text-slate-400">{v(tx.fulfillment_vat)}</td>
                            <CouponCell tx={tx} onSave={updateCoupon} />
                            <td className="px-2 py-2 text-right font-mono text-slate-400">{v(tx.vat)}</td>
                            <td className={`px-2 py-2 text-right font-mono ${Number(tx.margin || 0) >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{Math.ceil(Number(tx.margin || 0)).toLocaleString()}</td>
                            <td className="px-2 py-2 text-right font-mono text-red-400">{v(tx.cancel_amount)}</td>
                            <td className="px-2 py-2 text-center">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                tx.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                                tx.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                                'bg-amber-100 text-amber-700'
                              }`}>
                                {tx.status === 'confirmed' ? '확정' : tx.status === 'cancelled' ? '취소' : '반품'}
                              </span>
                            </td>
                          </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 py-2">
                    <button onClick={() => setPage(0)} disabled={page === 0} className="h-7 px-2 border border-slate-200 rounded text-xs text-slate-600 disabled:opacity-30">처음</button>
                    <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="h-7 px-3 border border-slate-200 rounded text-xs text-slate-600 disabled:opacity-30">이전</button>
                    <span className="text-xs text-slate-500">{page + 1} / {totalPages} ({filtered.length}건)</span>
                    <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="h-7 px-3 border border-slate-200 rounded text-xs text-slate-600 disabled:opacity-30">다음</button>
                    <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="h-7 px-2 border border-slate-200 rounded text-xs text-slate-600 disabled:opacity-30">마지막</button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* 월별 탭 (ops-ux Phase 1 — 자기완결 섹션, 자체 기간 사용) */}
        {activeTab === 'monthly' && <MonthlyPnlSection />}

        {/* 캘린더 탭 (ops-ux Phase 4 — 자기완결 섹션, 자체 월 상태 사용) */}
        {activeTab === 'calendar' && <SettlementCalendarSection />}

        {/* 정산 대조 탭 — 자기완결 섹션, 정산주기 목록을 자체 로드 */}
        {activeTab === 'reconcile' && <SettlementReconcile />}

        {/* Import 탭 */}
        {activeTab === 'import' && (
          <div className="space-y-4">
            <FileImporter
              importType="sales"
              onComplete={() => fetchTransactions(period.periodStart, period.periodEnd)}
            />
          </div>
        )}
      </div>

      {/* 정산 입력 모달 */}
      <SettlementForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={submitSettlement}
        error={settlementError}
      />

      {/* 쿠폰 일괄 설정 모달 */}
      <BulkCouponModal
        open={bulkCouponOpen}
        onClose={() => setBulkCouponOpen(false)}
        products={couponProducts}
        defaultStart={period.periodStart}
        defaultEnd={period.periodEnd}
        onApplied={() => fetchTransactions(period.periodStart, period.periodEnd)}
      />
    </>
  )
}
