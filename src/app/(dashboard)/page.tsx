'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ShoppingCart,
  Megaphone,
  FileSpreadsheet,
  ArrowRight,
  Loader2,
  Package,
  RefreshCw,
} from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { Header } from '@/components/layout/Header'
import { PeriodSelector } from '@/components/features/settlement/PeriodSelector'
import { PeriodTilesSection } from '@/components/features/analytics/PeriodTilesSection'
import { PacingSection } from '@/components/features/analytics/PacingSection'
import { PnlTrendSection } from '@/components/features/analytics/PnlTrendSection'
import { ProductProfitRankingSection } from '@/components/features/analytics/ProductProfitRankingSection'
import { getDefaultPeriod } from '@/hooks/useReport'
import type { PeriodFilter } from '@/types/settlement'

interface DashboardStockAlert {
  id: string
  product_name: string
  option_name: string
  coupang_stock: number
  avg_daily_sales: number
  reorder_point: number
  reorder_date: string | null
  days_until_reorder: number | null
  lead_time_days: number
  lead_time_source: string
  supplier_name: string | null
  status: 'danger' | 'warning'
}

interface DashboardData {
  totalRevenue: number
  totalQuantity: number
  totalMargin: number
  totalCost: number
  totalCommission: number
  totalFulfillment: number
  totalAdSpend: number
  totalExpenses: number
  coupangDeductionExpenses: number
  productCount: number
  stockAlertCount: number
  pendingPurchaseCount: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pendingPurchases: any[]
  stockAlerts: DashboardStockAlert[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recentImports: any[]
}

const fmt = (v: number) => v.toLocaleString('ko-KR')
const fmtShort = (v: number) => {
  if (Math.abs(v) >= 100000000) return `${(v / 100000000).toFixed(1)}억`
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)}만`
  return fmt(v)
}

export default function HomePage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [period, setPeriod] = useState<PeriodFilter>(getDefaultPeriod())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    // 기간이 바뀐 뒤 이전 기간 수치를 새 기간의 값처럼 표시하지 않는다.
    setData(null)
    const params = new URLSearchParams({ startDate: period.periodStart, endDate: period.periodEnd })
    apiFetch(`/api/dashboard?${params}`)
      .then(async (response) => {
        const json = await response.json()
        if (!response.ok) throw new Error(json.error || '대시보드 조회 실패')
        if (!json.data) throw new Error('대시보드 응답에 데이터가 없습니다.')
        if (!cancelled) setData(json.data)
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : '대시보드 조회 실패')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [period.periodEnd, period.periodStart, reloadKey])

  const marginRate = (data?.totalRevenue || 0) > 0 ? ((data?.totalMargin || 0) / (data?.totalRevenue || 1)) * 100 : 0

  if (loading && !data) {
    return (
      <>
        <Header title="대시보드" />
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
        </div>
      </>
    )
  }

  if (error && !data) {
    return (
      <>
        <Header title="대시보드" />
        <main className="flex min-h-[60vh] items-center justify-center px-4">
          <div role="alert" className="w-full max-w-lg rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
            <h2 className="mt-3 text-sm font-semibold text-red-800">대시보드 정보를 불러오지 못했습니다.</h2>
            <p className="mt-1 text-xs text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-700"
            >
              <RefreshCw className="h-3.5 w-3.5" /> 다시 시도
            </button>
          </div>
        </main>
      </>
    )
  }

  const hasData = (data?.totalRevenue || 0) > 0 || (data?.productCount || 0) > 0

  return (
    <>
    <Header title="대시보드" />
    <div className="max-w-7xl mx-auto px-4 lg:px-6 py-6 space-y-4">
      {/* 기간·요약 — 타이틀은 Header로 이동, 보조 요소는 본문 유지 */}
      <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <p className="text-xs text-slate-400">{period.periodStart} ~ {period.periodEnd} 기준</p>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>등록 상품 <strong className="text-slate-700 font-mono">{data?.productCount || 0}</strong>개</span>
          <span className="w-px h-3 bg-slate-300" />
          <span>판매 <strong className="text-slate-700 font-mono">{fmt(data?.totalQuantity || 0)}</strong>개</span>
        </div>
      </div>

      {/* 기간 타일 (ops-ux Phase 3 — 고정 4기간, 기간 필터와 무관) */}
      <PeriodTilesSection />

      {/* 이번 달 페이스 (ops-ux Phase 7) */}
      <PacingSection />

      {/* 기간 필터 */}
      <PeriodSelector value={period} onChange={setPeriod} />

      {/* KPI 5개 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard
          label="매출"
          value={fmtShort(data?.totalRevenue || 0)}
          unit="원"
          sub="선택 기간 합계"
          note="VAT포함"
        />
        <KpiCard
          label="마진"
          value={fmtShort(data?.totalMargin || 0)}
          unit="원"
          color={(data?.totalMargin || 0) >= 0 ? 'blue' : 'red'}
          sub={`마진율 ${marginRate.toFixed(1)}%`}
        />
        <KpiCard
          label="광고비"
          value={fmtShort(data?.totalAdSpend || 0)}
          unit="원"
          icon={<Megaphone className="w-3.5 h-3.5" />}
          note="VAT포함"
        />
        <KpiCard
          label="재고 경고"
          value={String(data?.stockAlertCount || 0)}
          unit="건"
          color={(data?.stockAlertCount || 0) > 0 ? 'amber' : undefined}
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
        />
        <KpiCard
          label="매입 대기"
          value={String(data?.pendingPurchaseCount || 0)}
          unit="건"
          icon={<ShoppingCart className="w-3.5 h-3.5" />}
        />
      </div>

      {/* 차트 + 상품 Top */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 일별·주별 손익 추이 */}
        <div className="lg:col-span-2">
          <PnlTrendSection period={period} />
        </div>

        <ProductProfitRankingSection periodStart={period.periodStart} periodEnd={period.periodEnd} />
      </div>

      {/* 손익 요약 + 매입/재고 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 손익 구조 */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">기간 손익 구조</h3>
          <div className="space-y-2">
            <PnlRow label="매출" value={data?.totalRevenue || 0} color="text-slate-800" bold note="VAT포함" />
            <PnlRow label="매출원가" value={-(data?.totalCost || 0)} color="text-slate-600" />
            <PnlRow label="판매수수료" value={-(data?.totalCommission || 0)} color="text-slate-600" />
            <PnlRow label="입출고비" value={-(data?.totalFulfillment || 0)} color="text-slate-600" />
            <div className="border-t border-slate-200 pt-2">
              <PnlRow label="매출이익" value={data?.totalMargin || 0} color={(data?.totalMargin || 0) >= 0 ? 'text-blue-600' : 'text-red-600'} bold />
            </div>
            <PnlRow label="광고비" value={-(data?.totalAdSpend || 0)} color="text-slate-600" note="VAT포함" />
            <PnlRow label="지출" value={-(data?.totalExpenses || 0)} color="text-slate-600" />
            <PnlRow label="쿠팡 정산 차감(참고)" value={data?.coupangDeductionExpenses || 0} color="text-blue-500" note="순이익 제외" />
            <div className="border-t border-slate-200 pt-2">
              <PnlRow
                label="영업이익"
                value={(data?.totalMargin || 0) - (data?.totalAdSpend || 0) - (data?.totalExpenses || 0)}
                color={(data?.totalMargin || 0) - (data?.totalAdSpend || 0) - (data?.totalExpenses || 0) >= 0 ? 'text-blue-700' : 'text-red-700'}
                bold
              />
            </div>
          </div>
        </div>

        {/* 매입 현황 */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-card">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">매입 현황</h3>
            <Link href="/purchases" className="text-[10px] text-brand-600 hover:text-brand-700 flex items-center gap-0.5">
              전체 <ArrowRight className="w-2.5 h-2.5" />
            </Link>
          </div>
          <div className="p-4 space-y-3">
            {(data?.pendingPurchases || []).length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">진행 중인 매입 없음</p>
            ) : (
              <>
                {/* 단계별 요약 */}
                <div className="flex flex-wrap gap-1.5">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {(() => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const pp = data?.pendingPurchases || [] as any[]
                    const statusMap: Record<string, { label: string; color: string }> = {
                      ordered: { label: '발주', color: 'bg-slate-100 text-slate-700' },
                      paid_1688: { label: '구매결제', color: 'bg-blue-100 text-blue-700' },
                      shipped: { label: '국제배송', color: 'bg-indigo-100 text-indigo-700' },
                      customs: { label: '통관중', color: 'bg-purple-100 text-purple-700' },
                      domestic: { label: '국내배송', color: 'bg-amber-100 text-amber-700' },
                    }
                    return Object.entries(statusMap).map(([k, v]) => {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const count = pp.filter((p: any) => p.status === k).length
                      if (count === 0) return null
                      return <span key={k} className={`text-[10px] px-2 py-1 rounded-full font-medium ${v.color}`}>{v.label} {count}건</span>
                    })
                  })()}
                </div>
                {/* 목록 */}
                <div className="space-y-1.5">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {(data?.pendingPurchases || []).slice(0, 6).map((p: any) => {
                    const statusMap: Record<string, { label: string; color: string }> = {
                      ordered: { label: '발주', color: 'bg-slate-100 text-slate-700' },
                      paid_1688: { label: '결제', color: 'bg-blue-100 text-blue-700' },
                      shipped: { label: '배송', color: 'bg-indigo-100 text-indigo-700' },
                      customs: { label: '통관', color: 'bg-purple-100 text-purple-700' },
                      domestic: { label: '입고중', color: 'bg-amber-100 text-amber-700' },
                    }
                    const si = statusMap[p.status] || statusMap.ordered
                    return (
                      <div key={p.id} className="flex items-center justify-between py-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${si.color}`}>{si.label}</span>
                          <span className="text-xs text-slate-700 truncate">{p.products?.product_name ? `${p.products.product_name}${p.products.option_name ? ` (${p.products.option_name})` : ''}` : p.products?.option_name || '-'}</span>
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          <span className="text-xs font-mono text-slate-600">{p.quantity}개</span>
                          <span className="text-[10px] text-slate-400 ml-1">{p.order_date?.slice(5)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* 재고 경고 */}
        <div className={`rounded-xl border shadow-card ${
          (data?.stockAlertCount || 0) > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'
        }`}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-amber-100">
            <h3 className={`text-sm font-semibold flex items-center gap-1.5 ${
              (data?.stockAlertCount || 0) > 0 ? 'text-amber-800' : 'text-slate-700'
            }`}>
              <AlertTriangle className="w-4 h-4" /> 재고 부족
            </h3>
            <Link href="/inventory" className="text-[10px] text-amber-700 hover:text-amber-800 flex items-center gap-0.5">
              전체 <ArrowRight className="w-2.5 h-2.5" />
            </Link>
          </div>
          <div className="p-4">
            {(data?.stockAlerts || []).length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">재고 부족 상품 없음</p>
            ) : (
              <div className="space-y-2">
                {(data?.stockAlerts || []).map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`text-[9px] px-1 py-0.5 rounded font-medium shrink-0 ${p.status === 'danger' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        {p.status === 'danger' ? '발주필요' : '주의'}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs text-slate-700 truncate">{p.product_name ? `${p.product_name}${p.option_name ? ` (${p.option_name})` : ''}` : p.option_name || '-'}</p>
                        <p className="text-[9px] text-slate-400 truncate">
                          {p.supplier_name ? `${p.supplier_name} · ` : ''}
                          리드타임 {p.lead_time_days}일 · {p.days_until_reorder === 0 ? '오늘 발주' : `발주 ${p.reorder_date?.slice(5) || '-'}`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <p className="text-xs font-mono text-red-600 font-medium">{p.coupang_stock}개</p>
                      <p className="text-[9px] text-slate-400">최소 {p.reorder_point}개</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 최근 활동 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-card">
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">최근 Import</h3>
        </div>
        <div className="px-5 py-3">
          {(data?.recentImports || []).length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-3">Import 이력 없음 — 정산 또는 광고 페이지에서 Excel 파일을 업로드하세요.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(data?.recentImports || []).map((imp: any) => {
                const typeLabel: Record<string, string> = { sales: '판매', ad_billing: '광고', product: '상품', inventory_health: '재고' }
                return (
                  <div key={imp.id} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-xs text-slate-600">{typeLabel[imp.import_type] || imp.import_type}</span>
                    <span className="text-xs font-mono text-slate-500">{imp.success_count}건</span>
                    <span className="text-[10px] text-slate-400">{imp.completed_at?.split('T')[0]}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 데이터 없을 때 가이드 */}
      {!hasData && (
        <div className="bg-brand-50 rounded-xl border border-brand-200 p-6 text-center">
          <Package className="w-10 h-10 text-brand-400 mx-auto mb-2" />
          <p className="text-sm text-brand-700 font-medium">시작하기</p>
          <p className="text-xs text-brand-600 mt-1">
            설정에서 사업자를 등록하고, 그로스판매장부를 한번에 Import하세요.
          </p>
          <div className="flex justify-center gap-3 mt-4">
            <Link href="/settings" className="px-4 py-2 bg-brand-500 text-white rounded-lg text-xs font-medium hover:bg-brand-600">설정 → 판매장부 Import</Link>
          </div>
        </div>
      )}
    </div>
    </>
  )
}

function KpiCard({ label, value, unit, change, sub, color, icon, note }: {
  label: string; value: string; unit?: string; change?: number; sub?: string
  color?: 'blue' | 'red' | 'amber'; icon?: React.ReactNode; note?: string
}) {
  const valueColor = color === 'blue' ? 'text-blue-600' : color === 'red' ? 'text-red-600' : color === 'amber' ? 'text-amber-600' : 'text-slate-800'
  const bgColor = color === 'amber' ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'
  return (
    <div className={`rounded-xl border p-4 shadow-card ${bgColor}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
          {icon} {label}
          {note && <span className="text-[9px] text-slate-400 font-normal">({note})</span>}
        </span>
        {change != null && change !== 0 && (
          <span className={`flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
            change > 0 ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-600'
          }`}>
            {change > 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
            {Math.abs(change).toFixed(1)}%
          </span>
        )}
      </div>
      <p className={`text-xl font-bold font-mono ${valueColor}`}>
        {value}{unit && <span className="text-[10px] font-normal text-slate-400 ml-0.5">{unit}</span>}
      </p>
      {sub && <p className="text-[10px] text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}

function PnlRow({ label, value, color, bold, note }: { label: string; value: number; color: string; bold?: boolean; note?: string }) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-x-2 gap-y-0.5">
      <span className={`text-xs ${bold ? 'font-semibold text-slate-700' : 'text-slate-500'}`}>{label}{note && <span className="text-[9px] text-slate-400 font-normal ml-1">({note})</span>}</span>
      <span className={`text-xs font-mono ${bold ? 'font-bold' : 'font-medium'} ${color}`}>
        {value >= 0 ? '' : '-'}{fmtShort(Math.abs(value))}원
      </span>
    </div>
  )
}
