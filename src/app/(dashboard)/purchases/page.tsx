'use client'

import { kstTodayStr } from '@/lib/analytics/date-buckets'
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Plus, Package, Loader2, X, Search, Filter, Trash2, Upload,
  ChevronUp, ChevronDown, LayoutDashboard, List, Truck, ClipboardCheck,
  CreditCard, ArrowRight, TrendingUp, AlertTriangle, DollarSign, PackageCheck,
  BarChart3, ShoppingCart, Copy,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { usePurchases } from '@/hooks/usePurchases'
import type { PurchaseForm } from '@/types/purchases'
import {
  calcUnitCostKrw, PURCHASE_STATUSES, PURCHASE_STATUS_COLORS,
  type PurchaseStatus,
} from '@/types/purchases'
import { PURCHASE_EXPORT_COLUMNS } from '@/lib/export/excel'
import { ExportButton } from '@/components/shared/ExportButton'
import { FileImporter } from '@/components/features/import/FileImporter'
import { PeriodSelector } from '@/components/features/settlement/PeriodSelector'
import { getDefaultPeriod } from '@/hooks/useReport'
import { apiFetch } from '@/lib/api-client'
import type { PeriodFilter } from '@/types/settlement'

const PAYMENT_LABELS: Record<string, { label: string; color: string }> = {
  unpaid: { label: '미결제', color: 'bg-red-50 text-red-600' },
  paid: { label: '결제완료', color: 'bg-green-50 text-green-600' },
  none: { label: '해당없음', color: 'bg-slate-50 text-slate-400' },
}

const CURRENCY_LABELS: Record<string, string> = { CNY: '¥', USD: '$', KRW: '₩' }

const ARRIVED_LOCKED_FIELDS = new Set<keyof PurchaseForm>([
  'productId', 'quantity', 'unitPrice', 'currency', 'exchangeRate', 'shippingCost',
  'payment1Vat', 'inspectionFee', 'labelingFee', 'packagingFee', 'customsDocFee',
  'agencyFee', 'payment2Vat', 'domesticShipping', 'customsDuty', 'customsVat',
])

interface ProductOption { id: string; productName: string | null; optionName: string | null; coupangOptionId: string | null }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PR = any
type SortDir = 'asc' | 'desc' | null

function sortItems(items: PR[], key: string, dir: SortDir): PR[] {
  if (!dir || !key) return items
  return [...items].sort((a, b) => {
    let va = key.includes('.') ? key.split('.').reduce((o: PR, k: string) => o?.[k], a) : a[key]
    let vb = key.includes('.') ? key.split('.').reduce((o: PR, k: string) => o?.[k], b) : b[key]
    if (va == null) va = dir === 'asc' ? Infinity : -Infinity
    if (vb == null) vb = dir === 'asc' ? Infinity : -Infinity
    if (typeof va === 'string') va = va.toLowerCase()
    if (typeof vb === 'string') vb = vb.toLowerCase()
    return va < vb ? (dir === 'asc' ? -1 : 1) : va > vb ? (dir === 'asc' ? 1 : -1) : 0
  })
}

function getName(p: PR): string {
  const name = p.products?.product_name || p.product_name_memo || '-'
  const opt = p.products?.option_name
  return opt && p.products?.product_name ? `${name} (${opt})` : name
}

function getProductLabel(p: ProductOption): string {
  const name = p.productName || p.optionName || '이름 없음'
  return p.optionName && p.productName ? `${name} (${p.optionName})` : name
}

// 상태 순서 인덱스 (8단계)
const STATUS_ORDER: PurchaseStatus[] = ['ordered', 'paid_1688', 'collecting', 'processing', 'shipped', 'customs', 'domestic', 'arrived']

// ── 대시보드 탭 ──
function PurchaseDashboard({ purchases, period, onFilterByStatus }: { purchases: PR[]; period: PeriodFilter; onFilterByStatus?: (status: string) => void }) {
  const active = purchases.filter((p: PR) => p.status !== 'cancelled' && p.status !== 'arrived')
  const arrived = purchases.filter((p: PR) => p.status === 'arrived')
  const totalActive = active.length

  const pipeline = STATUS_ORDER.map(s => {
    const items = (s === 'arrived' ? arrived : active).filter((p: PR) => p.status === s)
    const total = items.reduce((sum: number, p: PR) => sum + (Number(p.total_amount_krw) || 0), 0)
    return { status: s, label: PURCHASE_STATUSES[s], color: PURCHASE_STATUS_COLORS[s], count: items.length, total, items }
  })

  // 결제 통계 (cancelled 제외)
  const validPurchases = purchases.filter((p: PR) => p.status !== 'cancelled')
  // 기간 필터 적용 (발주일 기준) — 기간 의존 집계에만 사용
  const periodPurchases = validPurchases.filter((p: PR) => {
    const d = p.order_date || ''
    return d >= period.periodStart && d <= period.periodEnd
  })
  const unpaid1 = validPurchases.filter((p: PR) => p.payment1_status === 'unpaid' && Number(p.payment1_total) > 0)
  const unpaid2 = validPurchases.filter((p: PR) => p.payment2_status === 'unpaid' && Number(p.payment2_total) > 0)
  const unpaid3 = validPurchases.filter((p: PR) => p.payment3_status === 'unpaid' && Number(p.payment3_total) > 0)
  const unpaid1Total = unpaid1.reduce((s: number, p: PR) => s + Number(p.payment1_total || 0), 0)
  const unpaid2Total = unpaid2.reduce((s: number, p: PR) => s + Number(p.payment2_total || 0), 0)
  const unpaid3Total = unpaid3.reduce((s: number, p: PR) => s + Number(p.payment3_total || 0), 0)
  const totalUnpaid = unpaid1Total + unpaid2Total + unpaid3Total

  const paid1Count = validPurchases.filter((p: PR) => p.payment1_status === 'paid' || p.payment1_status === 'none').length
  const paid2Count = validPurchases.filter((p: PR) => p.payment2_status === 'paid' || p.payment2_status === 'none').length
  const paid3Count = validPurchases.filter((p: PR) => p.payment3_status === 'paid' || p.payment3_status === 'none').length
  const validCount = validPurchases.length

  // KPI: 총 매입액(기간), 기간 입고(기간)
  const totalPurchaseAmount = periodPurchases.reduce((s: number, p: PR) => s + (Number(p.total_amount_krw) || 0), 0)
  const now = new Date()
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  // 기간 내 입고 (arrival_date 기준)
  const periodArrived = arrived.filter((p: PR) => {
    const d = p.arrival_date || ''
    return d >= period.periodStart && d <= period.periodEnd
  })
  const periodArrivedAmount = periodArrived.reduce((s: number, p: PR) => s + (Number(p.total_amount_krw) || 0), 0)

  // 예상 입고 (향후 30일 + 지연 건)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const upcoming = purchases
    .filter((p: PR) => {
      if (p.status === 'arrived' || p.status === 'cancelled') return false
      const d = p.expected_arrival_date || p.arrival_date
      if (!d) return false
      // 'YYYY-MM-DD'는 UTC 자정으로 파싱되므로 로컬 자정(today)과 비교하면 9시간 어긋난다 (audit §5-3)
      const diff = (new Date(`${d}T00:00:00`).getTime() - today.getTime()) / 86400000
      return diff >= -30 && diff <= 30
    })
    .sort((a: PR, b: PR) => (a.expected_arrival_date || a.arrival_date || '').localeCompare(b.expected_arrival_date || b.arrival_date || ''))
    .slice(0, 10)

  // 월별 매입 추이 (최근 6개월)
  const monthlyData = useMemo(() => {
    const months: { key: string; label: string; count: number; amount: number; arrivedCount: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = `${d.getMonth() + 1}월`
      const monthPurchases = validPurchases.filter((p: PR) => (p.order_date || '').startsWith(key))
      const monthArrivals = arrived.filter((p: PR) => (p.arrival_date || '').startsWith(key))
      months.push({
        key, label,
        count: monthPurchases.length,
        amount: monthPurchases.reduce((s: number, p: PR) => s + (Number(p.total_amount_krw) || 0), 0),
        arrivedCount: monthArrivals.length,
      })
    }
    return months
  }, [validPurchases, arrived, now])
  const maxMonthAmount = Math.max(...monthlyData.map(m => m.amount), 1)

  // 상품별 매입 TOP 5 (기간 기준)
  const productRanking = useMemo(() => {
    const map = new Map<string, { name: string; count: number; amount: number; qty: number }>()
    for (const p of periodPurchases) {
      const name = getName(p)
      const prev = map.get(name) || { name, count: 0, amount: 0, qty: 0 }
      map.set(name, {
        name,
        count: prev.count + 1,
        amount: prev.amount + (Number(p.total_amount_krw) || 0),
        qty: prev.qty + (Number(p.quantity) || 0),
      })
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount).slice(0, 5)
  }, [periodPurchases])
  const maxProductAmount = productRanking.length > 0 ? productRanking[0].amount : 1

  const fmt = (v: number) => v.toLocaleString('ko-KR')
  const fmtShort = (v: number) => Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(1)}만` : fmt(v)
  const getDday = (dateStr: string) => {
    // 로컬 자정 기준으로 파싱해 today(로컬 자정)와 같은 기준으로 계산 (audit §5-3 D-day 하루 밀림)
    const diff = Math.ceil((new Date(`${dateStr}T00:00:00`).getTime() - today.getTime()) / 86400000)
    if (diff === 0) return 'D-Day'
    return diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`
  }

  const handlePipelineClick = (status: string) => {
    if (onFilterByStatus) onFilterByStatus(status)
  }

  return (
    <div className="space-y-3">
      {/* 데이터 없을 때 빈 상태 */}
      {purchases.length === 0 && (
        <div className="bg-brand-50 rounded-xl border border-brand-200 p-4 text-center">
          <Truck className="w-8 h-8 text-brand-400 mx-auto mb-1.5" />
          <p className="text-sm text-brand-700 font-medium">매입 내역이 없습니다</p>
          <p className="text-xs text-brand-600 mt-0.5">목록 탭에서 매입을 등록하거나 Excel 파일을 Import하세요.</p>
        </div>
      )}

      {/* KPI 카드 (현재 2 + 기간 2) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center"><Truck className="w-3.5 h-3.5 text-indigo-600" /></div>
            <span className="text-xs text-slate-500">진행중</span>
          </div>
          <p className="text-xl font-bold text-slate-800">{totalActive}<span className="text-xs font-normal text-slate-400 ml-0.5">건</span></p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${totalUnpaid > 0 ? 'bg-red-50' : 'bg-slate-50'}`}><AlertTriangle className={`w-3.5 h-3.5 ${totalUnpaid > 0 ? 'text-red-500' : 'text-slate-400'}`} /></div>
            <span className="text-xs text-slate-500">미결제 잔액</span>
          </div>
          <p className={`text-xl font-bold font-mono ${totalUnpaid > 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmtShort(totalUnpaid)}<span className="text-xs font-normal text-slate-400 ml-0.5">원</span></p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center"><DollarSign className="w-3.5 h-3.5 text-blue-600" /></div>
            <span className="text-xs text-slate-500">총 매입액</span>
            <span className="text-[9px] text-slate-400 bg-slate-100 rounded px-1 ml-auto">기간</span>
          </div>
          <p className="text-xl font-bold text-slate-800 font-mono">{fmtShort(totalPurchaseAmount)}<span className="text-xs font-normal text-slate-400 ml-0.5">원</span></p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center"><PackageCheck className="w-3.5 h-3.5 text-green-600" /></div>
            <span className="text-xs text-slate-500">기간 입고</span>
            <span className="text-[9px] text-slate-400 bg-slate-100 rounded px-1 ml-auto">기간</span>
          </div>
          <p className="text-xl font-bold text-slate-800">{periodArrived.length}<span className="text-xs font-normal text-slate-400 ml-0.5">건</span>{periodArrivedAmount > 0 && <span className="text-[10px] text-slate-400 font-mono ml-1.5">{fmtShort(periodArrivedAmount)}원</span>}</p>
        </div>
      </div>

      {/* 파이프라인 (8단계, 항상 전체 표시) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <Truck className="w-4 h-4" /> 매입 파이프라인
          <span className="text-xs font-normal text-slate-400 ml-auto">클릭하여 필터링</span>
        </h3>
        {/* 진행률 바 */}
        {totalActive > 0 && (
          <div className="flex h-2 rounded-full overflow-hidden mb-3 bg-slate-100">
            {pipeline.filter(s => s.status !== 'arrived').map(s => {
              const pct = (s.count / totalActive) * 100
              if (pct === 0) return null
              return (
                <div key={s.status} className={`${s.color.split(' ')[0].replace('-100', '-400')} transition-all`} style={{ width: `${pct}%` }}
                  title={`${s.label}: ${s.count}건 (${pct.toFixed(0)}%)`} />
              )
            })}
          </div>
        )}
        <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
          {pipeline.map((s, i) => (
            <div key={s.status} className="flex items-center gap-1.5">
              {i > 0 && <ArrowRight className="w-3 h-3 text-slate-300 flex-shrink-0" />}
              <button onClick={() => handlePipelineClick(s.status)}
                className={`rounded-lg p-2.5 min-w-[92px] border text-left transition-all hover:shadow-sm hover:border-slate-300 ${s.count > 0 ? 'border-slate-200 bg-white' : 'border-dashed border-slate-100 bg-slate-50/50'}`}>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${s.color}`}>{s.label}</span>
                <p className="text-base font-bold text-slate-800 mt-1">{s.count}<span className="text-xs font-normal text-slate-400 ml-0.5">건</span></p>
                <p className="text-[11px] text-slate-500 font-mono">{s.total > 0 ? `${fmtShort(s.total)}원` : '-'}</p>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 2단 구성: (좌) 결제 현황 + 예상 입고 / (우) 상품 TOP5 + 월별 추이 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
      <div className="space-y-3">
      {/* 결제 현황 (1·2·3차 통합) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <CreditCard className="w-4 h-4" /> 결제 현황
          {totalUnpaid > 0 && <span className="text-xs font-normal text-red-500 ml-auto">미결제 {fmt(totalUnpaid)}원</span>}
        </h3>
        <div className="space-y-2.5">
          {[
            { label: '1차 (구매대행)', unpaidCount: unpaid1.length, unpaidTotal: unpaid1Total, paidCount: paid1Count, bar: 'bg-blue-400' },
            { label: '2차 (작업/통관)', unpaidCount: unpaid2.length, unpaidTotal: unpaid2Total, paidCount: paid2Count, bar: 'bg-purple-400' },
            { label: '3차 (관부가세/입고)', unpaidCount: unpaid3.length, unpaidTotal: unpaid3Total, paidCount: paid3Count, bar: 'bg-amber-400' },
          ].map(row => {
            const paidPct = validCount > 0 ? Math.round((row.paidCount / validCount) * 100) : 0
            return (
              <div key={row.label}>
                <div className="flex items-center justify-between mb-1 text-xs">
                  <span className="text-slate-600">{row.label}</span>
                  <span className="text-slate-500">
                    {row.unpaidCount > 0
                      ? <><span className="text-red-600 font-medium">{row.unpaidCount}건</span> <span className="font-mono">{fmt(row.unpaidTotal)}원</span></>
                      : <span className="text-slate-400">완료</span>}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${row.bar} rounded-full transition-all`} style={{ width: `${paidPct}%` }} />
                  </div>
                  <span className="text-[10px] text-slate-500 font-medium w-9 text-right">{paidPct}%</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 예상 입고 일정 (현재 현황) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4" /> 예상 입고 일정
          </h3>
          {upcoming.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">예정된 입고 건이 없습니다.</p>
          ) : (
            <div className="space-y-1 max-h-[176px] overflow-auto pr-1">
              {upcoming.map((p: PR) => {
                const date = p.expected_arrival_date || p.arrival_date
                const diff = Math.ceil((new Date(date).getTime() - today.getTime()) / 86400000)
                const isOverdue = diff < 0
                const isToday = diff === 0
                const statusInfo = PURCHASE_STATUSES[p.status as PurchaseStatus] || p.status
                return (
                  <div key={p.id} className={`flex items-center gap-2 py-1 px-2 rounded-lg ${isOverdue ? 'bg-red-50' : isToday ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
                    <span className={`font-mono text-[11px] w-9 flex-shrink-0 font-semibold text-center ${isOverdue ? 'text-red-600' : isToday ? 'text-amber-600' : 'text-slate-500'}`}>
                      {getDday(date)}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${PURCHASE_STATUS_COLORS[p.status as PurchaseStatus] || ''}`}>{statusInfo}</span>
                    <span className="text-slate-800 truncate flex-1 text-xs">{getName(p)}</span>
                    <span className="text-slate-500 font-mono text-[10px] flex-shrink-0">{p.quantity?.toLocaleString()}개</span>
                    <span className="text-slate-500 font-mono text-[10px] flex-shrink-0 w-14 text-right">{fmtShort(Number(p.total_amount_krw) || 0)}원</span>
                  </div>
                )
              })}
            </div>
          )}
      </div>

      </div>

      {/* 우측 컬럼 */}
      <div className="space-y-3">
        {/* 상품별 매입 TOP 5 */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <ShoppingCart className="w-4 h-4" /> 상품별 매입 TOP 5
            <span className="text-[10px] font-normal text-slate-400 ml-auto">기간 내</span>
          </h3>
          {productRanking.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-3">매입 데이터가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {productRanking.map((item, i) => (
                <div key={item.name}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-700 truncate flex-1 mr-2">
                      <span className="text-slate-400 mr-1.5">{i + 1}.</span>{item.name}
                    </span>
                    <span className="text-xs font-mono text-slate-600 flex-shrink-0">{fmtShort(item.amount)}원</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-400 rounded-full transition-all" style={{ width: `${(item.amount / maxProductAmount) * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-slate-400 w-16 text-right">{item.count}건 / {item.qty.toLocaleString()}개</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 월별 매입 추이 (CSS 바 차트) */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> 월별 매입 추이 <span className="text-[10px] font-normal text-slate-400">(최근 6개월)</span>
          </h3>
          <div className="flex gap-2 h-20">
            {monthlyData.map(m => {
              const pct = maxMonthAmount > 0 ? (m.amount / maxMonthAmount) * 100 : 0
              const isCurrentMonth = m.key === thisMonth
              return (
                <div key={m.key} className="flex-1 flex flex-col items-center gap-1 h-full">
                  <span className="text-[10px] font-mono text-slate-500">{m.amount > 0 ? fmtShort(m.amount) : ''}</span>
                  <div className="w-full flex-1 flex items-end min-h-0">
                    <div className={`w-full rounded-t-md transition-all ${isCurrentMonth ? 'bg-brand-500' : 'bg-brand-200'}`}
                      style={{ height: `${Math.max(pct, 2)}%` }} />
                  </div>
                  <div className="text-center leading-tight">
                    <p className={`text-[11px] font-medium ${isCurrentMonth ? 'text-brand-600' : 'text-slate-600'}`}>{m.label}</p>
                    <p className="text-[10px] text-slate-400">{m.count}건</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}

// ── 메인 페이지 ──
export default function PurchasesPage() {
  const {
    purchases, loading, error, setError, fetchPurchases, addPurchase,
    updatePurchase, deletePurchase, isPurchaseMutating,
  } = usePurchases()
  const [products, setProducts] = useState<ProductOption[]>([])
  const [productsError, setProductsError] = useState<string | null>(null)
  const [showImporter, setShowImporter] = useState(false)
  const [activeTab, setActiveTab] = useState<'list' | 'dashboard'>('dashboard')
  // 대시보드 기간 필터 (발주일 기준 집계에만 적용)
  const [dashPeriod, setDashPeriod] = useState<PeriodFilter>(getDefaultPeriod())

  // 필터
  const [filterStatus, setFilterStatus] = useState('')
  const [filterProductId, setFilterProductId] = useState('')
  const [filterStartDate, setFilterStartDate] = useState('')
  const [filterEndDate, setFilterEndDate] = useState('')
  const [filterPayment, setFilterPayment] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  // 정렬 + 페이지네이션
  const [sortKey, setSortKey] = useState<string>('order_date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(15)

  // 모달
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingUpdatedAt, setEditingUpdatedAt] = useState<string | null>(null)
  const [editingOriginalStatus, setEditingOriginalStatus] = useState<PurchaseStatus | null>(null)

  const emptyForm: PurchaseForm = {
    productId: '',
    orderDate: kstTodayStr(),
    quantity: 0,
    unitPrice: 0,
    currency: 'CNY',
    exchangeRate: 200,
    shippingCost: 0,
    payment1Vat: 0,
    payment1Status: 'unpaid',
    inspectionFee: 0,
    labelingFee: 0,
    packagingFee: 0,
    customsDocFee: 0,
    agencyFee: 0,
    payment2Vat: 0,
    payment2Status: 'unpaid',
    domesticShipping: 0,
    customsDuty: 0,
    customsVat: 0,
    payment3Status: 'unpaid',
    status: 'ordered',
  }
  const [form, setForm] = useState(emptyForm)

  const loadProducts = useCallback(async () => {
    setProductsError(null)
    try {
      const response = await apiFetch('/api/products?purpose=product&limit=500')
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '상품 목록 조회 실패')
      if (!Array.isArray(json.data)) throw new Error('상품 목록 응답 형식이 올바르지 않습니다.')
      setProducts(json.data)
    } catch (productError) {
      setProductsError(productError instanceof Error ? productError.message : '상품 목록을 조회하지 못했습니다.')
    }
  }, [])

  useEffect(() => { void loadProducts() }, [loadProducts])

  const loadPurchases = useCallback(() => {
    fetchPurchases({
      status: filterStatus || undefined,
      productId: filterProductId || undefined,
      startDate: filterStartDate || undefined,
      endDate: filterEndDate || undefined,
    })
  }, [fetchPurchases, filterStatus, filterProductId, filterStartDate, filterEndDate])

  useEffect(() => { loadPurchases() }, [loadPurchases])

  // 필터 + 정렬
  const filtered = useMemo(() => {
    let list = [...purchases]
    if (filterPayment) {
      list = list.filter((p: PR) => {
        if (filterPayment === 'unpaid') return ['payment1_status', 'payment2_status', 'payment3_status'].some(k => p[k] === 'unpaid')
        return ['payment1_status', 'payment2_status', 'payment3_status'].every(k => p[k] === 'paid' || p[k] === 'none')
      })
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter((p: PR) => getName(p).toLowerCase().includes(q) || (p.po_number || '').toLowerCase().includes(q))
    }
    return sortItems(list, sortKey, sortDir)
  }, [purchases, filterPayment, searchQuery, sortKey, sortDir])

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize)

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

  // 폼 계산
  const unitCostKrw = calcUnitCostKrw({
    unitPrice: form.unitPrice,
    exchangeRate: form.exchangeRate || 1,
    shippingCost: form.shippingCost || 0,
    payment1Vat: form.payment1Vat,
    inspectionFee: form.inspectionFee,
    labelingFee: form.labelingFee,
    packagingFee: form.packagingFee,
    customsDocFee: form.customsDocFee,
    payment2Vat: form.payment2Vat,
    agencyFee: form.agencyFee,
    domesticShipping: form.domesticShipping || 0,
    customsDuty: form.customsDuty,
    customsVat: form.customsVat,
    quantity: form.quantity,
  })
  const totalKrw = Math.round(unitCostKrw * form.quantity)

  const openNew = () => {
    setForm(emptyForm)
    setEditingId(null)
    setEditingUpdatedAt(null)
    setEditingOriginalStatus(null)
    setModalOpen(true)
  }
  const openEdit = (p: PR) => {
    setForm({
      productId: p.product_id || '',
      poNumber: p.po_number || '',
      orderDate: p.order_date,
      arrivalDate: p.arrival_date || '',
      expectedArrivalDate: p.expected_arrival_date || '',
      leadTimeWeeks: p.lead_time_weeks || undefined,
      quantity: p.quantity,
      unitPrice: Number(p.unit_price),
      currency: p.currency || 'CNY',
      exchangeRate: Number(p.exchange_rate || 1),
      shippingCost: Number(p.shipping_cost || 0),
      payment1Vat: Number(p.payment1_vat || 0),
      payment1Status: p.payment1_status || 'unpaid',
      inspectionFee: Number(p.inspection_fee || 0),
      labelingFee: Number(p.labeling_fee || 0),
      packagingFee: Number(p.packaging_fee || 0),
      customsDocFee: Number(p.customs_doc_fee || 0),
      agencyFee: Number(p.agency_fee || 0),
      payment2Vat: Number(p.payment2_vat || 0),
      payment2Status: p.payment2_status || 'unpaid',
      domesticShipping: Number(p.domestic_shipping || 0),
      customsDuty: Number(p.customs_duty || 0),
      customsVat: Number(p.customs_vat || 0),
      payment3Status: p.payment3_status || 'unpaid',
      status: p.status,
      notes: p.notes || '',
      productNameMemo: p.product_name_memo || '',
    })
    setEditingId(p.id)
    setEditingUpdatedAt(p.updated_at || null)
    setEditingOriginalStatus(p.status as PurchaseStatus)
    setModalOpen(true)
  }
  // 이전 매입 복사 → 신규 등록 폼에 비용/상품 정보를 채우고, 거래성 필드(발주일/번호/상태/결제/입고)는 초기화
  const openCopy = (p: PR) => {
    setForm({
      productId: p.product_id || '',
      poNumber: '',
      orderDate: kstTodayStr(),
      arrivalDate: '',
      expectedArrivalDate: '',
      leadTimeWeeks: p.lead_time_weeks || undefined,
      quantity: p.quantity,
      unitPrice: Number(p.unit_price),
      currency: p.currency || 'CNY',
      exchangeRate: Number(p.exchange_rate || 1),
      shippingCost: Number(p.shipping_cost || 0),
      payment1Vat: Number(p.payment1_vat || 0),
      payment1Status: 'unpaid',
      inspectionFee: Number(p.inspection_fee || 0),
      labelingFee: Number(p.labeling_fee || 0),
      packagingFee: Number(p.packaging_fee || 0),
      customsDocFee: Number(p.customs_doc_fee || 0),
      agencyFee: Number(p.agency_fee || 0),
      payment2Vat: Number(p.payment2_vat || 0),
      payment2Status: 'unpaid',
      domesticShipping: Number(p.domestic_shipping || 0),
      customsDuty: Number(p.customs_duty || 0),
      customsVat: Number(p.customs_vat || 0),
      payment3Status: 'unpaid',
      status: 'ordered',
      notes: p.notes || '',
      productNameMemo: p.product_name_memo || '',
    })
    setEditingId(null)
    setEditingUpdatedAt(null)
    setEditingOriginalStatus(null)
    setModalOpen(true)
  }
  // 수정 모달에서 현재 입력값을 그대로 신규 등록으로 전환 (거래성 필드만 초기화)
  const copyFromForm = () => {
    setForm(f => ({
      ...f,
      poNumber: '',
      orderDate: kstTodayStr(),
      arrivalDate: '',
      expectedArrivalDate: '',
      payment1Status: 'unpaid',
      payment2Status: 'unpaid',
      payment3Status: 'unpaid',
      status: 'ordered',
    }))
    setEditingId(null)
    setEditingUpdatedAt(null)
    setEditingOriginalStatus(null)
  }
  const closeModal = () => {
    setModalOpen(false)
    setEditingId(null)
    setEditingUpdatedAt(null)
    setEditingOriginalStatus(null)
  }

  const handleSubmit = async () => {
    if (!form.productId && !form.productNameMemo) { setError('상품을 선택하거나 상품명을 입력하세요.'); return }
    if (form.quantity <= 0) { setError('수량을 입력하세요.'); return }
    if (editingId) {
      if (!editingUpdatedAt) { setError('매입 버전을 확인할 수 없습니다. 목록을 새로고침해 주세요.'); return }
      const result = await updatePurchase(editingId, form, { expectedUpdatedAt: editingUpdatedAt })
      if (result) closeModal()
      return
    }
    const created = await addPurchase(form)
    if (created) closeModal()
  }

  const handleStatusChange = async (purchase: PR, newStatus: string) => {
    if (!purchase.updated_at) { setError('매입 버전을 확인할 수 없습니다. 목록을 새로고침해 주세요.'); return }
    const arrivalDate = newStatus === 'arrived' ? kstTodayStr() : undefined
    await updatePurchase(
      purchase.id,
      { status: newStatus, ...(arrivalDate ? { arrivalDate } : {}) },
      { expectedUpdatedAt: purchase.updated_at },
    )
  }

  const handleDelete = async () => {
    if (!editingId || !confirm('이 매입 건을 삭제하시겠습니까?')) return
    if (!editingUpdatedAt) { setError('매입 버전을 확인할 수 없습니다. 목록을 새로고침해 주세요.'); return }
    const result = await deletePurchase(editingId, { expectedUpdatedAt: editingUpdatedAt })
    if (result) closeModal()
  }

  const isKrw = form.currency === 'KRW'
  const isArrivedLocked = editingOriginalStatus === 'arrived'
  const thCls = 'px-2 py-2 text-[11px] font-medium text-slate-500 whitespace-nowrap cursor-pointer select-none hover:text-slate-700'

  // 폼 input helper
  const numInput = (label: string, key: keyof typeof form, opts?: { step?: string; placeholder?: string; disabled?: boolean; title?: string }) => (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type="number" step={opts?.step || '1'} value={(form[key] as number) || ''}
        onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
        disabled={opts?.disabled || (isArrivedLocked && ARRIVED_LOCKED_FIELDS.has(key))}
        placeholder={opts?.placeholder} title={opts?.title}
        className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm text-right disabled:bg-slate-50 disabled:text-slate-400" />
    </div>
  )

  return (
    <>
      <Header title="매입 관리" />
      <div className="max-w-full px-4 lg:px-6 py-4 space-y-3">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg flex justify-between">
            {error}
            <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </div>
        )}
        {productsError && (
          <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            <span>상품 선택지를 불러오지 못했습니다: {productsError}</span>
            <button onClick={() => void loadProducts()} className="font-medium underline">다시 시도</button>
          </div>
        )}

        {/* 탭 */}
        <div className="flex w-full items-center gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 sm:w-fit">
          <button onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${activeTab === 'dashboard' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <LayoutDashboard className="w-3.5 h-3.5" /> 대시보드
          </button>
          <button onClick={() => setActiveTab('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${activeTab === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <List className="w-3.5 h-3.5" /> 목록
          </button>
        </div>

        {/* 대시보드 탭 */}
        {activeTab === 'dashboard' && !loading && (
          <>
            <PeriodSelector value={dashPeriod} onChange={setDashPeriod} />
            <PurchaseDashboard purchases={purchases} period={dashPeriod} onFilterByStatus={(status) => {
              setFilterStatus(status)
              setPage(0)
              setActiveTab('list')
            }} />
          </>
        )}

        {/* 목록 탭 */}
        {activeTab === 'list' && (
          <>
            {/* 필터 */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Filter className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-medium text-slate-600">필터</span>
                <div className="relative w-full min-w-[200px] flex-1 sm:ml-2 sm:max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input type="text" value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setPage(0) }}
                    placeholder="상품명 / 발주번호" className="w-full h-8 pl-8 pr-3 border border-slate-200 rounded-lg text-sm" />
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
                  <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}
                    className="h-8 px-2 border border-slate-200 rounded text-xs text-slate-600">
                    <option value={15}>15개</option><option value={30}>30개</option><option value={50}>50개</option><option value={100}>100개</option>
                  </select>
                  <button onClick={() => setShowImporter(v => !v)}
                    className="flex items-center gap-1 px-3 h-8 border border-brand-300 text-brand-600 rounded text-xs hover:bg-brand-50">
                    <Upload className="w-3.5 h-3.5" /> Import
                  </button>
                  <ExportButton
                    data={filtered}
                    columns={PURCHASE_EXPORT_COLUMNS}
                    filename="NexOps_매입내역"
                    sheetName="매입"
                    disabled={filtered.length === 0}
                  />
                  <button onClick={openNew}
                    className="flex items-center gap-1 px-3 h-8 bg-brand-500 text-white rounded text-xs font-medium hover:bg-brand-600">
                    <Plus className="w-3.5 h-3.5" /> 등록
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(0) }}
                  className="h-9 px-3 border border-slate-200 rounded-lg text-sm">
                  <option value="">전체 상태</option>
                  {Object.entries(PURCHASE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select value={filterPayment} onChange={(e) => { setFilterPayment(e.target.value); setPage(0) }}
                  className="h-9 px-3 border border-slate-200 rounded-lg text-sm">
                  <option value="">전체 결제</option>
                  <option value="unpaid">미결제 있음</option>
                  <option value="paid">전액 결제완료</option>
                </select>
                <select value={filterProductId} onChange={(e) => { setFilterProductId(e.target.value); setPage(0) }}
                  className="h-9 px-3 border border-slate-200 rounded-lg text-sm">
                  <option value="">전체 상품</option>
                  {products.map(p => <option key={p.id} value={p.id}>{getProductLabel(p)}</option>)}
                </select>
                <input type="date" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)}
                  className="h-9 px-3 border border-slate-200 rounded-lg text-sm" />
                <input type="date" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)}
                  className="h-9 px-3 border border-slate-200 rounded-lg text-sm" />
              </div>
            </div>

            {showImporter && <FileImporter importType="purchase" onComplete={() => { loadPurchases(); setShowImporter(false) }} />}

            {loading && (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
            )}

            {!loading && (
              <>
                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <span>총 {filtered.length}건</span>
                  {filtered.length > 0 && <span>총액 {Math.ceil(filtered.reduce((s: number, p: PR) => s + (Number(p.total_amount_krw) || 0), 0)).toLocaleString()}원</span>}
                </div>

                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
                  <table className="w-full min-w-[900px] text-[11px]">
                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                      <tr>
                        <th className={`text-left ${thCls}`} onClick={() => toggleSort('order_date')}>발주일<SortIcon col="order_date" /></th>
                        <th className={`text-left ${thCls}`} onClick={() => toggleSort('products.product_name')}>상품<SortIcon col="products.product_name" /></th>
                        <th className={`text-right ${thCls}`} onClick={() => toggleSort('quantity')}>수량<SortIcon col="quantity" /></th>
                        <th className={`text-right ${thCls}`} onClick={() => toggleSort('unit_cost_krw')}>실원가<SortIcon col="unit_cost_krw" /></th>
                        <th className={`text-right ${thCls}`} onClick={() => toggleSort('total_amount_krw')}>총액<SortIcon col="total_amount_krw" /></th>
                        <th className={`text-center ${thCls}`} onClick={() => toggleSort('status')}>상태<SortIcon col="status" /></th>
                        <th className="px-2 py-2 text-center font-medium text-slate-600 whitespace-nowrap">1차</th>
                        <th className="px-2 py-2 text-center font-medium text-slate-600 whitespace-nowrap">2차</th>
                        <th className="px-2 py-2 text-center font-medium text-slate-600 whitespace-nowrap">3차</th>
                        <th className={`text-left ${thCls}`}>입고일<SortIcon col="expected_arrival_date" /></th>
                        <th className={`text-left ${thCls}`}>메모</th>
                        <th className="px-2 py-2 text-center font-medium text-slate-600 whitespace-nowrap">복사</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paged.length === 0 ? (
                        <tr>
                          <td colSpan={12} className="px-2 py-12 text-center">
                            <Package className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                            <p className="text-xs text-slate-400">{purchases.length === 0 ? '등록된 매입 내역이 없습니다.' : '검색 결과가 없습니다.'}</p>
                          </td>
                        </tr>
                      ) : paged.map((p: PR) => {
                        const statusColor = PURCHASE_STATUS_COLORS[p.status as PurchaseStatus] || ''
                        const rowMutating = isPurchaseMutating(p.id)
                        const unitCost = Math.ceil(Number(p.unit_cost_krw || 0))
                        const p1 = PAYMENT_LABELS[p.payment1_status || 'unpaid'] || PAYMENT_LABELS.unpaid
                        const p2 = PAYMENT_LABELS[p.payment2_status || 'unpaid'] || PAYMENT_LABELS.unpaid
                        const p3 = PAYMENT_LABELS[p.payment3_status || 'unpaid'] || PAYMENT_LABELS.unpaid
                        const arrDate = p.expected_arrival_date || p.arrival_date
                        return (
                          <tr key={p.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => openEdit(p)}>
                            <td className="px-2 py-2 text-slate-600 whitespace-nowrap">{p.order_date}</td>
                            <td className="px-2 py-2 text-slate-800 font-medium max-w-[160px]">
                              <div className="truncate" title={getName(p)}>
                                {getName(p)}
                                {!p.product_id && <span className="text-[10px] text-red-400 ml-1">(미연결)</span>}
                              </div>
                            </td>
                            <td className="px-2 py-2 text-right font-mono">{p.quantity?.toLocaleString()}</td>
                            <td className="px-2 py-2 text-right font-mono font-medium">{unitCost > 0 ? unitCost.toLocaleString() : '-'}</td>
                            <td className="px-2 py-2 text-right font-mono font-medium">{Math.ceil(Number(p.total_amount_krw || 0)).toLocaleString()}</td>
                            <td className="px-2 py-2 text-center">
                              <select value={p.status} disabled={rowMutating}
                                onClick={e => e.stopPropagation()} onChange={e => handleStatusChange(p, e.target.value)}
                                className={`text-xs px-2 py-0.5 rounded-full border-0 ${statusColor} cursor-pointer disabled:cursor-wait disabled:opacity-50`}>
                                {Object.entries(PURCHASE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                            </td>
                            <td className="px-2 py-2 text-center"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${p1.color}`}>{p1.label}</span></td>
                            <td className="px-2 py-2 text-center"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${p2.color}`}>{p2.label}</span></td>
                            <td className="px-2 py-2 text-center"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${p3.color}`}>{p3.label}</span></td>
                            <td className="px-2 py-2 text-slate-500 text-xs whitespace-nowrap">{arrDate || '-'}</td>
                            <td className="px-2 py-2 text-slate-400 text-xs max-w-[100px]"><div className="truncate">{p.notes || '-'}</div></td>
                            <td className="px-2 py-2 text-center">
                              <button onClick={e => { e.stopPropagation(); openCopy(p) }} title="이 매입을 복사하여 새로 등록"
                                className="inline-flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-brand-600 hover:bg-brand-50">
                                <Copy className="w-3.5 h-3.5" />
                              </button>
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

      </div>

      {/* ── 등록/수정 모달 ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center"
          onClick={() => { if (!loading) closeModal() }}>
          <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-xl bg-white shadow-2xl sm:mx-4 sm:max-w-2xl sm:rounded-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700">{editingId ? '매입 수정' : '매입 등록'}</h3>
              <button onClick={closeModal} disabled={loading}><X className="w-4 h-4 text-slate-400" /></button>
            </div>

            <div className="px-5 py-4 space-y-5">
              {isArrivedLocked && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  입고 완료 건의 상품·수량·원가는 재고 장부와 연결되어 잠겨 있습니다. 먼저 상태를 입고 완료 이전으로 저장한 뒤 수정해 주세요.
                </div>
              )}
              {/* 상품 */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">상품 선택</label>
                <select value={form.productId} onChange={e => setForm({ ...form, productId: e.target.value })}
                  disabled={isArrivedLocked}
                  className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm disabled:bg-slate-50 disabled:text-slate-400">
                  <option value="">상품을 선택하세요</option>
                  {products.map(p => <option key={p.id} value={p.id}>{getProductLabel(p)}</option>)}
                </select>
              </div>
              {!form.productId && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">상품명 메모 (미연결)</label>
                  <input type="text" value={form.productNameMemo || ''} placeholder="직접 입력"
                    onChange={e => setForm({ ...form, productNameMemo: e.target.value })}
                    disabled={isArrivedLocked}
                    className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm disabled:bg-slate-50 disabled:text-slate-400" />
                </div>
              )}

              {/* 발주 정보 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">발주일 *</label>
                  <input type="date" value={form.orderDate} onChange={e => setForm({ ...form, orderDate: e.target.value })}
                    className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm" />
                </div>
                {numInput('수량 *', 'quantity')}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">발주번호</label>
                  <input type="text" value={form.poNumber || ''} placeholder="PO-2026-001"
                    onChange={e => setForm({ ...form, poNumber: e.target.value })}
                    className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">상태</label>
                  <select value={form.status || 'ordered'} onChange={e => setForm({ ...form, status: e.target.value })}
                    className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm">
                    {Object.entries(PURCHASE_STATUSES).map(([k, v]) => (
                      <option key={k} value={k} disabled={!editingId && k === 'arrived'}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 1차 결제 */}
              <fieldset className="border border-blue-200 rounded-lg p-3 space-y-3">
                <legend className="text-xs font-semibold text-blue-700 px-2 flex items-center gap-1">
                  <CreditCard className="w-3 h-3" /> 1차 결제 — 구매대행 (1688)
                </legend>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">통화</label>
                    <select value={form.currency || 'CNY'} disabled={isArrivedLocked} onChange={e => {
                      const c = e.target.value
                      setForm({ ...form, currency: c, exchangeRate: c === 'KRW' ? 1 : form.exchangeRate })
                    }} className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm disabled:bg-slate-50 disabled:text-slate-400">
                      <option value="CNY">CNY</option><option value="USD">USD</option><option value="KRW">KRW</option>
                    </select>
                  </div>
                  {numInput(`단가 (${CURRENCY_LABELS[form.currency || 'CNY']})`, 'unitPrice', { step: '0.01' })}
                  {numInput(`구매대행수수료 (${CURRENCY_LABELS[form.currency || 'CNY']})`, 'agencyFee', { step: '0.01' })}
                  {numInput('환율', 'exchangeRate', { step: '0.01', disabled: isKrw })}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {numInput('구입금액 VAT', 'payment1Vat')}
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">1차 결제</label>
                    <select value={form.payment1Status || 'unpaid'} onChange={e => setForm({ ...form, payment1Status: e.target.value })}
                      className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm">
                      <option value="unpaid">미결제</option><option value="paid">결제완료</option><option value="none">해당없음</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">1차 소계</label>
                    <div className="h-9 px-3 border border-slate-100 rounded-lg text-sm text-right bg-blue-50 flex items-center justify-end font-mono text-blue-700">
                      {(Math.round(form.unitPrice * (form.exchangeRate || 1) * form.quantity + (form.agencyFee || 0) * (form.exchangeRate || 1)) + (form.payment1Vat || 0)).toLocaleString()}원
                    </div>
                  </div>
                </div>
              </fieldset>

              {/* 2차 결제 */}
              <fieldset className="border border-purple-200 rounded-lg p-3 space-y-3">
                <legend className="text-xs font-semibold text-purple-700 px-2 flex items-center gap-1">
                  <CreditCard className="w-3 h-3" /> 2차 결제 — 작업비용/통관서류
                </legend>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {numInput('국제배송비 (원)', 'shippingCost')}
                  {numInput('검수비', 'inspectionFee')}
                  {numInput('라벨링비', 'labelingFee')}
                  {numInput('포장비', 'packagingFee')}
                  {numInput('통관서류비', 'customsDocFee')}
                  {numInput('2차 VAT', 'payment2Vat')}
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">2차 결제</label>
                    <select value={form.payment2Status || 'unpaid'} onChange={e => setForm({ ...form, payment2Status: e.target.value })}
                      className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm">
                      <option value="unpaid">미결제</option><option value="paid">결제완료</option><option value="none">해당없음</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">2차 소계</label>
                    <div className="h-9 px-3 border border-slate-100 rounded-lg text-sm text-right bg-purple-50 flex items-center justify-end font-mono text-purple-700">
                      {((form.shippingCost || 0) + (form.inspectionFee || 0) + (form.labelingFee || 0) + (form.packagingFee || 0) + (form.customsDocFee || 0) + (form.payment2Vat || 0)).toLocaleString()}원
                    </div>
                  </div>
                </div>
              </fieldset>

              {/* 3차 결제 */}
              <fieldset className="border border-amber-200 rounded-lg p-3 space-y-3">
                <legend className="text-xs font-semibold text-amber-700 px-2 flex items-center gap-1">
                  <CreditCard className="w-3 h-3" /> 3차 결제 — 관부가세/입고
                </legend>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {numInput('관세', 'customsDuty')}
                  {numInput('부가세 (관부가세)', 'customsVat')}
                  {numInput('입고택배비', 'domesticShipping')}
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">3차 결제</label>
                    <select value={form.payment3Status || 'unpaid'} onChange={e => setForm({ ...form, payment3Status: e.target.value })}
                      className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm">
                      <option value="unpaid">미결제</option><option value="paid">결제완료</option><option value="none">해당없음</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">3차 소계</label>
                    <div className="h-9 px-3 border border-slate-100 rounded-lg text-sm text-right bg-amber-50 flex items-center justify-end font-mono text-amber-700">
                      {((form.customsDuty || 0) + (form.customsVat || 0) + (form.domesticShipping || 0)).toLocaleString()}원
                    </div>
                  </div>
                </div>
              </fieldset>

              {/* 자동 계산 */}
              <div className="bg-slate-50 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-500">실원가(개당)</span>
                  <p className="text-lg font-bold text-slate-800 font-mono">{Math.ceil(unitCostKrw).toLocaleString()}원</p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-500">총액</span>
                  <p className="text-lg font-bold text-brand-600 font-mono">{Math.ceil(totalKrw).toLocaleString()}원</p>
                </div>
              </div>

              {/* 입고 정보 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {numInput('입고소요(주)', 'leadTimeWeeks')}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">예상 입고일</label>
                  <input type="date" value={form.expectedArrivalDate || ''} onChange={e => setForm({ ...form, expectedArrivalDate: e.target.value })}
                    className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">실제 입고일</label>
                  <input type="date" value={form.arrivalDate || ''} onChange={e => setForm({ ...form, arrivalDate: e.target.value })}
                    className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm" />
                </div>
              </div>

              {/* 메모 */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">메모</label>
                <input type="text" value={form.notes || ''} placeholder="비고"
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm" />
              </div>
            </div>

            <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100">
              {editingId ? (
                <button onClick={handleDelete} disabled={loading}
                  className="h-9 px-4 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 flex items-center gap-1">
                  <Trash2 className="w-3.5 h-3.5" /> 삭제
                </button>
              ) : <div />}
              <div className="flex gap-2">
                {editingId && (
                  <button onClick={copyFromForm} disabled={loading} title="현재 내용을 복사하여 새 매입으로 등록"
                    className="h-9 px-4 border border-brand-300 text-brand-600 rounded-lg text-sm hover:bg-brand-50 flex items-center gap-1">
                    <Copy className="w-3.5 h-3.5" /> 복사하여 새로 등록
                  </button>
                )}
                <button onClick={closeModal} disabled={loading}
                  className="h-9 px-4 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">취소</button>
                <button onClick={handleSubmit} disabled={loading}
                  className="h-9 px-6 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50">
                  {loading ? '저장 중...' : editingId ? '수정' : '등록'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
