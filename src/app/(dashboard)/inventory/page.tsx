'use client'

import { kstTodayStr } from '@/lib/analytics/date-buckets'
import { calculateReorderPlan } from '@/lib/inventory/reorder'
import { useState, useCallback, useMemo, useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { useInventory } from '@/hooks/useInventory'
import { apiFetch } from '@/lib/api-client'
import { ExportButton } from '@/components/shared/ExportButton'
import {
  Loader2, Package, AlertTriangle, ChevronUp, ChevronDown,
  Upload, Search, Plus, ArrowRight, X, ShoppingCart,
} from 'lucide-react'
import { BarChart, Bar, ResponsiveContainer, Cell, Tooltip } from 'recharts'
import { ChartTooltipContent } from '@/components/ui/chart'
import type { InventoryItem, InventoryMovement, InboundFormData } from '@/types/inventory'
import { FileImporter } from '@/components/features/import/FileImporter'
import Link from 'next/link'
import { inferMovementQuantityMode, movementDisplayQuantity } from '@/lib/inventory/movement-contract'

type Tab = 'overview' | 'history'
type SalesPeriod = 7 | 14 | 30
type SortDir = 'asc' | 'desc' | null
type MovementType = 'inbound' | 'outbound' | 'adjustment'

const STOCK_STATUS: Record<string, { label: string; cls: string }> = {
  danger: { label: '발주필요', cls: 'bg-red-50 text-red-700 border-red-200' },
  warning: { label: '주의', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  normal: { label: '정상', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
  overstock: { label: '과잉', cls: 'bg-blue-50 text-blue-600 border-blue-200' },
}

const LEAD_TIME_SOURCE_LABEL: Record<InventoryItem['leadTimeSource'], string> = {
  supplier: '공급처 설정',
  purchase_history: '실입고 평균',
  purchase: '매입 입력',
  product: '상품 설정',
  default: '기본값',
}

const MOVEMENT_TYPES: { key: MovementType; label: string; color: string }[] = [
  { key: 'inbound', label: '입고', color: 'bg-green-100 text-green-700' },
  { key: 'outbound', label: '출고', color: 'bg-red-100 text-red-700' },
  { key: 'adjustment', label: '조정', color: 'bg-amber-100 text-amber-700' },
]

const OUTBOUND_REASONS = ['반품출고', '폐기', '샘플', '기타']
const ADJUSTMENT_REASONS = ['실사조정', '오류수정', '기타']

const fmtN = (v: number) => v.toLocaleString('ko-KR')
const fmtShort = (v: number) => Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(1)}만` : fmtN(v)

function getAvgSales(item: InventoryItem, period: SalesPeriod): number {
  if (period === 7) return item.avgSales7d
  if (period === 30) return item.avgSales30d
  return item.avgSales14d
}

function calcDerived(item: InventoryItem, period: SalesPeriod) {
  const avg = getAvgSales(item, period)
  const reorderPlan = calculateReorderPlan(
    item.coupangStock,
    avg,
    item.leadTimeDays,
    kstTodayStr()
  )

  // 발주 불필요: 반품 상품 / 판매중지 / 판매종료
  const salesStatus = item.salesStatus || 'active'
  const noReorder = item.isRefurbished || ['paused', 'discontinued'].includes(salesStatus)

  let status: string = 'normal'
  if (noReorder) {
    if (reorderPlan.reorderPoint > 0 && item.coupangStock > reorderPlan.reorderPoint * 3) status = 'overstock'
  } else {
    status = reorderPlan.stockStatus
  }
  return { avg, ...reorderPlan, status }
}

export default function InventoryPage() {
  const {
    items, movements, loading, error,
    fetchInventory,
    submitInbound, submitOutbound, submitAdjustment, setError,
  } = useInventory()

  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [period, setPeriod] = useState<SalesPeriod>(14)
  const [sortKey, setSortKey] = useState<string>('coupangStock')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')

  // Import
  const [showImporter, setShowImporter] = useState(false)

  // 입출고 모달
  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState<MovementType>('inbound')
  const [formProduct, setFormProduct] = useState('')
  const [formQty, setFormQty] = useState<number>(0)
  const [formCost, setFormCost] = useState<number>(0)
  const [formRef, setFormRef] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [formDate, setFormDate] = useState(kstTodayStr())
  const [formReason, setFormReason] = useState('')
  const [formSaving, setFormSaving] = useState(false)
  const [formOperationId, setFormOperationId] = useState('')

  useEffect(() => {
    if (modalOpen) setFormOperationId(crypto.randomUUID())
  }, [modalOpen, modalType, formProduct, formQty, formCost, formRef, formNotes, formDate, formReason])

  // 사이드패널
  const [selectedItem, setSelectedItem] = useState<(InventoryItem & ReturnType<typeof calcDerived>) | null>(null)
  const [panelMovements, setPanelMovements] = useState<InventoryMovement[]>([])
  const [panelHistory, setPanelHistory] = useState<{ snapshot_date: string; coupang_stock: number }[]>([])
  const [panelLoading, setPanelLoading] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)

  const resetForm = () => {
    setFormProduct(''); setFormQty(0); setFormCost(0); setFormRef(''); setFormNotes(''); setFormReason('')
    setFormDate(kstTodayStr())
  }

  const openMovementModal = (type: MovementType, productId?: string) => {
    resetForm()
    setModalType(type)
    if (productId) setFormProduct(productId)
    setModalOpen(true)
  }

  // 정렬
  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : sortDir === 'desc' ? null : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  // 파생 데이터
  const processed = useMemo(() => {
    let list = items.map((item) => ({ ...item, ...calcDerived(item, period) }))
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((i) => i.productName.toLowerCase().includes(q) || (i.barcode || '').toLowerCase().includes(q) || (i.optionName || '').toLowerCase().includes(q))
    }
    if (statusFilter) list = list.filter((i) => i.status === statusFilter)
    if (gradeFilter === 'NEW') list = list.filter((i) => !i.isRefurbished)
    else if (gradeFilter === '반품') list = list.filter((i) => i.isRefurbished)
    if (sortDir && sortKey) {
      list.sort((a, b) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const va = (a as any)[sortKey], vb = (b as any)[sortKey]
        // null은 정렬 방향과 무관하게 항상 뒤로 보낸다
        if (va == null && vb == null) return 0
        if (va == null) return 1
        if (vb == null) return -1
        const cmp = typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb))
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return list
  }, [items, period, search, statusFilter, gradeFilter, sortKey, sortDir])

  // KPI
  const totalSku = processed.length
  const dangerCount = processed.filter((i) => i.status === 'danger' || i.status === 'warning').length
  const totalValue = processed.reduce((s, i) => s + i.stockValue, 0)
  const totalDailySales = processed.reduce((s, i) => s + getAvgSales(i, period), 0)

  // 사이드패널 열기
  const openPanel = async (item: typeof processed[0]) => {
    setSelectedItem(item)
    setPanelLoading(true)
    setPanelError(null)
    setPanelMovements([])
    setPanelHistory([])
    try {
      const [movRes, histRes] = await Promise.all([
        apiFetch(`/api/inventory/movements?productId=${item.productId}&limit=10`),
        apiFetch(`/api/inventory/health-history?productId=${item.productId}&limit=14`),
      ])
      const movJson = await movRes.json()
      const histJson = await histRes.json()
      if (!movRes.ok) throw new Error(movJson.error || '최근 입출고 이력 조회 실패')
      if (!histRes.ok) throw new Error(histJson.error || '재고 변화 이력 조회 실패')
      setPanelMovements(movJson.data || [])
      setPanelHistory(histJson.data || [])
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : '이력을 조회하지 못했습니다.')
    } finally {
      setPanelLoading(false)
    }
  }

  // 폼 제출
  const handleFormSubmit = async () => {
    if (!formProduct) { setError('상품을 선택하세요.'); return }
    if (formQty <= 0 && modalType !== 'adjustment') { setError('수량을 입력하세요.'); return }
    if ((modalType === 'outbound' || modalType === 'adjustment') && !formReason) { setError('사유를 선택하세요.'); return }
    const item = items.find((inventoryItem) => inventoryItem.productId === formProduct)
    if (!item) { setError('선택한 상품의 재고 정보를 찾을 수 없습니다.'); return }
    if (modalType === 'outbound' && formQty > item.currentStock) {
      setError(`재고 부족: 현재 ${item.currentStock}개, 출고 요청 ${formQty}개`)
      return
    }
    setFormSaving(true)
    try {
      const data: InboundFormData & { reason?: string } = {
        operationId: formOperationId || crypto.randomUUID(),
        productId: formProduct,
        inventoryId: item.id,
        quantity: formQty,
        unitCost: formCost || undefined,
        referenceNo: formRef || undefined,
        notes: formReason ? `[${formReason}] ${formNotes}` : formNotes || undefined,
        movementDate: formDate,
      }
      if (modalType === 'inbound') await submitInbound(data)
      else if (modalType === 'outbound') await submitOutbound(data)
      else await submitAdjustment(data)
      setModalOpen(false)
      resetForm()
      // 사이드패널 새로고침
      if (selectedItem && selectedItem.productId === formProduct) openPanel(selectedItem)
    } catch { /* error handled in hook */ } finally {
      setFormSaving(false)
    }
  }

  // 정렬 헤더
  const SortTh = ({ k, children, align = 'right' }: { k: string; children: React.ReactNode; align?: string }) => (
    <th className={`px-2 py-2 font-medium text-slate-500 whitespace-nowrap text-[11px] cursor-pointer hover:text-slate-700 select-none text-${align}`}
      onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-0.5">
        {children}
        {sortKey === k && sortDir === 'asc' && <ChevronUp className="w-3 h-3" />}
        {sortKey === k && sortDir === 'desc' && <ChevronDown className="w-3 h-3" />}
      </span>
    </th>
  )

  const EXPORT_COLS = [
    { key: 'barcode', header: '바코드', width: 15 },
    { key: 'productName', header: '상품명', width: 30 },
    { key: 'optionName', header: '옵션명', width: 20 },
    { key: 'productGrade', header: '등급', width: 10 },
    { key: 'coupangStock', header: '쿠팡재고', width: 10 },
    { key: 'currentStock', header: '보유재고', width: 10 },
    { key: 'avg', header: `일평균(${period}일)`, width: 12 },
    { key: 'daysOfSupply', header: '재고일수', width: 10 },
    { key: 'reorderPoint', header: '최소재고', width: 10 },
    { key: 'leadTimeWeeks', header: '리드타임(주)', width: 10 },
    { key: 'status', header: '재고상태', width: 10, format: (v: string) => STOCK_STATUS[v]?.label || v },
  ]

  if (loading && items.length === 0) {
    return (<><Header title="재고 관리" /><div className="flex items-center justify-center min-h-[50vh]"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div></>)
  }

  return (
    <>
      <Header title="재고 관리" />
      <div className="max-w-full px-4 lg:px-6 py-4 space-y-3">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600 flex justify-between">
            {error} <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* 탭 (2탭) */}
        <div className="flex items-center gap-3 overflow-x-auto">
          <div className="flex border-b border-slate-200 whitespace-nowrap">
            {([
              { key: 'overview' as Tab, label: '재고현황' },
              { key: 'history' as Tab, label: '입출고 이력' },
            ]).map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === tab.key ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}>{tab.label}</button>
            ))}
          </div>
        </div>

        {/* ── 재고현황 탭 ── */}
        {activeTab === 'overview' && (
          <div className="space-y-3">
            {/* KPI */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-card">
                <span className="text-[11px] text-slate-500">총 SKU</span>
                <p className="text-xl font-bold font-mono text-slate-800 mt-1">{totalSku}<span className="text-xs font-normal text-slate-400 ml-0.5">개</span></p>
              </div>
              <div className={`rounded-xl border p-4 shadow-card ${dangerCount > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
                <span className="text-[11px] text-slate-500">발주필요</span>
                <p className={`text-xl font-bold font-mono mt-1 ${dangerCount > 0 ? 'text-red-600' : 'text-slate-800'}`}>{dangerCount}<span className="text-xs font-normal text-slate-400 ml-0.5">건</span></p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-card">
                <span className="text-[11px] text-slate-500">총 재고금액</span>
                <p className="text-xl font-bold font-mono text-slate-800 mt-1">{fmtShort(totalValue)}<span className="text-xs font-normal text-slate-400 ml-0.5">원</span></p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-card">
                <span className="text-[11px] text-slate-500">일 출고량 ({period}일)</span>
                <p className="text-xl font-bold font-mono text-slate-800 mt-1">{totalDailySales.toFixed(1)}<span className="text-xs font-normal text-slate-400 ml-0.5">개/일</span></p>
              </div>
            </div>

            {/* 필터/검색/액션 */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden">
                {([7, 14, 30] as SalesPeriod[]).map((d) => (
                  <button key={d} onClick={() => setPeriod(d)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${period === d ? 'bg-brand-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                    {d}일
                  </button>
                ))}
              </div>
              <div className="relative flex-1 min-w-[140px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="상품명/바코드 검색..."
                  className="h-8 w-full pl-8 pr-3 border border-slate-200 rounded-lg text-xs outline-none" />
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                className="h-9 w-full px-3 border border-slate-200 rounded-lg text-sm bg-white sm:w-auto">
                <option value="">전체 상태</option>
                <option value="danger">발주필요</option><option value="warning">주의</option>
                <option value="normal">정상</option><option value="overstock">과잉</option>
              </select>
              <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)}
                className="h-9 w-full px-3 border border-slate-200 rounded-lg text-sm bg-white sm:w-auto">
                <option value="">전체 등급</option>
                <option value="NEW">NEW</option><option value="반품">반품</option>
              </select>
              <ExportButton
                data={processed.map((item) => ({
                  ...item,
                  // 판매 0 상품의 Infinity가 파일에 기록되지 않도록 빈 값 처리
                  daysOfSupply: Number.isFinite(item.daysOfSupply) ? item.daysOfSupply : '',
                }))}
                columns={EXPORT_COLS}
                filename="NexOps_재고현황"
                sheetName="재고"
                disabled={processed.length === 0}
                className="sm:ml-auto"
              />
              <button onClick={() => setShowImporter(v => !v)}
                className="flex items-center gap-1 h-8 px-3 border border-brand-300 text-brand-600 rounded text-xs hover:bg-brand-50">
                <Upload className="w-3.5 h-3.5" /> Import
              </button>
              <button onClick={() => openMovementModal('inbound')}
                className="flex items-center gap-1 h-8 px-3 bg-brand-500 text-white rounded text-xs font-medium hover:bg-brand-600">
                <Plus className="w-3.5 h-3.5" /> 입출고 등록
              </button>
            </div>

            {/* Import 패널 */}
            {showImporter && (
              <FileImporter importType="inventory_health" onComplete={() => { fetchInventory(); setShowImporter(false) }} />
            )}

            {/* 테이블 + 사이드패널 레이아웃 */}
            <div className="flex flex-col gap-3 lg:flex-row">
              {/* 테이블 */}
              <div className={`min-w-0 flex-1 ${selectedItem ? 'lg:max-w-[calc(100%-320px)]' : ''}`}>
                {processed.length === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
                    <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm text-slate-500">재고 데이터가 없습니다.</p>
                    <p className="text-xs text-slate-400 mt-1">inventory_health 파일을 Import하세요.</p>
                  </div>
                ) : (
                  <div className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden">
                    <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
                      <table className="w-full min-w-[900px]">
                        <thead className="sticky top-0 z-10">
                          <tr className="border-b border-slate-200 bg-slate-50">
                            <SortTh k="productName" align="left">상품명</SortTh>
                            <SortTh k="productGrade" align="center">등급</SortTh>
                            <SortTh k="coupangStock">쿠팡재고</SortTh>
                            <SortTh k="currentStock">보유재고</SortTh>
                            <SortTh k="avg">일평균({period}일)</SortTh>
                            <SortTh k="daysOfSupply">재고일수</SortTh>
                            <SortTh k="reorderPoint">최소재고</SortTh>
                            <SortTh k="reorderDate">발주예정</SortTh>
                            <SortTh k="status" align="center">상태</SortTh>
                            <SortTh k="lastInboundAt">최종입고</SortTh>
                          </tr>
                        </thead>
                        <tbody>
                          {processed.map((item) => {
                            const stk = STOCK_STATUS[item.status] || STOCK_STATUS.normal
                            const grade = item.productGrade || ''
                            const isSelected = selectedItem?.productId === item.productId
                            return (
                              <tr key={item.id} onClick={() => openPanel(item)}
                                className={`border-b border-slate-100 text-[11px] cursor-pointer transition-colors ${item.status === 'danger' ? 'bg-red-50/30' : ''} ${isSelected ? 'bg-brand-50 border-brand-200' : 'hover:bg-slate-50'}`}>
                                <td className="px-2 py-2 text-slate-700 max-w-[160px]">
                                  <div className="truncate font-medium" title={item.productName}>{item.productName}</div>
                                  {item.optionName && <div className="truncate text-[10px] text-slate-400">{item.optionName}</div>}
                                </td>
                                <td className="px-2 py-2 text-center">
                                  {grade.includes('반품')
                                    ? <span className="px-1 py-0.5 rounded text-[9px] font-medium bg-purple-100 text-purple-700">{grade}</span>
                                    : <span className="px-1 py-0.5 rounded-full text-[9px] font-medium bg-green-100 text-green-700">NEW</span>}
                                </td>
                                <td className="px-2 py-2 text-right font-mono font-medium text-slate-700">{fmtN(item.coupangStock)}</td>
                                <td className="px-2 py-2 text-right font-mono text-slate-400">{fmtN(item.currentStock)}</td>
                                <td className="px-2 py-2 text-right font-mono text-slate-600">
                                  {item.avg > 0 ? item.avg.toFixed(1) : <span className="text-slate-300">-</span>}
                                </td>
                                <td className="px-2 py-2 text-right font-mono">
                                  {item.avg > 0 ? (
                                    <span className={item.daysOfSupply <= 14 ? 'text-red-600 font-medium' : 'text-slate-700'}>
                                      {isFinite(item.daysOfSupply) ? item.daysOfSupply : '-'}<span className="text-slate-400 text-[9px] ml-0.5">일</span>
                                    </span>
                                  ) : <span className="text-slate-300">-</span>}
                                </td>
                                <td className="px-2 py-2 text-right font-mono text-slate-500">{item.reorderPoint > 0 ? fmtN(item.reorderPoint) : '-'}</td>
                                <td className="px-2 py-2 text-right text-[10px]">
                                  {item.reorderDate ? (
                                    <span className={item.daysUntilReorder === 0 ? 'text-red-600 font-semibold' : 'text-slate-500'}>
                                      {item.daysUntilReorder === 0 ? '오늘' : item.reorderDate.slice(5)}
                                    </span>
                                  ) : <span className="text-slate-300">-</span>}
                                </td>
                                <td className="px-2 py-2 text-center">
                                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${stk.cls}`}>{stk.label}</span>
                                </td>
                                <td className="px-2 py-2 text-right text-slate-400 text-[10px]">{item.lastInboundAt?.split('T')[0] || '-'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 발주필요 → 매입 연동 */}
                {(() => {
                  const dangerItems = processed.filter((i) => i.status === 'danger' || i.status === 'warning')
                  if (dangerItems.length === 0) return null
                  return (
                    <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 mt-3">
                      <h4 className="text-xs font-semibold text-amber-800 mb-2 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> 발주필요 ({dangerItems.length}건)
                      </h4>
                      <div className="space-y-1.5">
                        {dangerItems.slice(0, 5).map((item) => (
                          <div key={item.id} className="flex flex-wrap items-center gap-2 text-xs">
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${STOCK_STATUS[item.status]?.cls}`}>
                              {STOCK_STATUS[item.status]?.label}
                            </span>
                            <span className="text-slate-700 truncate flex-1">{item.productName}</span>
                            <span className="font-mono text-red-600">{fmtN(item.coupangStock)}개</span>
                            <span className="text-slate-400">{item.avg > 0 ? `${item.avg.toFixed(1)}/일` : ''}</span>
                            <span className={item.daysUntilReorder === 0 ? 'text-red-600 font-medium' : 'text-slate-400'}>
                              {item.daysUntilReorder === 0 ? '오늘 발주' : item.reorderDate?.slice(5)}
                            </span>
                            <Link href={`/purchases?product=${item.productId}`}
                              className="flex items-center gap-0.5 px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-medium hover:bg-amber-200">
                              <ShoppingCart className="w-3 h-3" /> 매입
                            </Link>
                          </div>
                        ))}
                        {dangerItems.length > 5 && (
                          <button onClick={() => setStatusFilter('danger')} className="text-[10px] text-amber-600 flex items-center gap-0.5 mt-1">
                            전체 {dangerItems.length}건 보기 <ArrowRight className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })()}
              </div>

              {/* 사이드패널 */}
              {selectedItem && (
                <div className="max-h-[70dvh] w-full flex-shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card lg:max-h-[calc(100dvh-300px)] lg:w-[310px]">
                  <div className="overflow-y-auto h-full">
                    {/* 패널 헤더 */}
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-700 truncate">{selectedItem.productName}</p>
                        {selectedItem.optionName && <p className="text-[10px] text-slate-400 truncate">{selectedItem.optionName}</p>}
                      </div>
                      <button onClick={() => setSelectedItem(null)}><X className="w-4 h-4 text-slate-400" /></button>
                    </div>

                    {/* 재고 정보 */}
                    <div className="px-4 py-3 space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-slate-50 rounded-lg p-2 text-center">
                          <p className="text-[10px] text-slate-400">쿠팡재고</p>
                          <p className="text-lg font-bold font-mono text-slate-800">{fmtN(selectedItem.coupangStock)}</p>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2 text-center">
                          <p className="text-[10px] text-slate-400">보유재고</p>
                          <p className="text-lg font-bold font-mono text-slate-600">{fmtN(selectedItem.currentStock)}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-[10px] text-slate-400">일평균</p>
                          <p className="text-xs font-mono font-medium">{selectedItem.avg > 0 ? selectedItem.avg.toFixed(1) : '-'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400">재고일수</p>
                          <p className={`text-xs font-mono font-medium ${selectedItem.daysOfSupply <= 14 ? 'text-red-600' : ''}`}>
                            {selectedItem.avg > 0 && isFinite(selectedItem.daysOfSupply) ? `${selectedItem.daysOfSupply}일` : '-'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400">이동평균단가</p>
                          <p className="text-xs font-mono font-medium">{selectedItem.avgCostKrw ? `${Math.ceil(selectedItem.avgCostKrw).toLocaleString()}원` : '-'}</p>
                        </div>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-slate-400">총 재고금액</p>
                        <p className="text-sm font-bold font-mono text-slate-700">{fmtN(Math.ceil(selectedItem.stockValue))}원</p>
                      </div>

                      <div className="grid grid-cols-2 gap-2 rounded-lg border border-amber-100 bg-amber-50 p-2">
                        <div>
                          <p className="text-[10px] text-amber-600">리드타임</p>
                          <p className="text-xs font-medium text-amber-800">
                            {selectedItem.leadTimeDays}일
                            {selectedItem.supplierName ? ` · ${selectedItem.supplierName}` : ''}
                          </p>
                          <p className="text-[9px] text-amber-600">
                            {LEAD_TIME_SOURCE_LABEL[selectedItem.leadTimeSource]}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-amber-600">발주 예정</p>
                          <p className={`text-xs font-medium ${selectedItem.daysUntilReorder === 0 ? 'text-red-700' : 'text-amber-800'}`}>
                            {selectedItem.reorderDate
                              ? selectedItem.daysUntilReorder === 0 ? '오늘 발주 필요' : selectedItem.reorderDate
                              : '판매 이력 부족'}
                          </p>
                        </div>
                      </div>

                      {/* 빠른 조정 */}
                      <div className="border-t border-slate-100 pt-3">
                        <p className="text-xs font-semibold text-slate-600 mb-2">빠른 입출고</p>
                        <div className="flex gap-1.5">
                          <button onClick={() => openMovementModal('inbound', selectedItem.productId)}
                            className="flex-1 h-8 bg-green-50 text-green-700 border border-green-200 rounded text-xs font-medium hover:bg-green-100">
                            + 입고
                          </button>
                          <button onClick={() => openMovementModal('outbound', selectedItem.productId)}
                            className="flex-1 h-8 bg-red-50 text-red-700 border border-red-200 rounded text-xs font-medium hover:bg-red-100">
                            - 출고
                          </button>
                          <button onClick={() => openMovementModal('adjustment', selectedItem.productId)}
                            className="flex-1 h-8 bg-amber-50 text-amber-700 border border-amber-200 rounded text-xs font-medium hover:bg-amber-100">
                            조정
                          </button>
                        </div>
                      </div>

                      {/* 최근 이력 */}
                      <div className="border-t border-slate-100 pt-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-slate-600">최근 이력</p>
                          <button onClick={() => { setActiveTab('history') }} className="text-[10px] text-brand-600 flex items-center gap-0.5">
                            전체 <ArrowRight className="w-2.5 h-2.5" />
                          </button>
                        </div>
                        {panelLoading ? <Loader2 className="w-4 h-4 animate-spin text-slate-400 mx-auto" /> :
                          panelError ? (
                            <div className="rounded bg-red-50 px-2 py-1.5 text-[10px] text-red-600">
                              {panelError}
                              <button onClick={() => openPanel(selectedItem)} className="ml-2 underline">다시 시도</button>
                            </div>
                          ) : panelMovements.length === 0 ? <p className="text-[10px] text-slate-400 text-center">이력 없음</p> : (
                            <div className="space-y-1">
                              {panelMovements.slice(0, 5).map((m) => {
                                const mt = MOVEMENT_TYPES.find(t => t.key === m.movementType) || MOVEMENT_TYPES[0]
                                const displayQuantity = movementDisplayQuantity(m.movementType, m.quantity)
                                const quantityMode = m.quantityMode ?? inferMovementQuantityMode(m.movementType, m.referenceNo, m.notes)
                                const isAbsoluteAdjustment = m.movementType === 'adjustment' && quantityMode === 'absolute'
                                return (
                                  <div key={m.id} className="flex items-center gap-1.5 text-[10px] py-1">
                                    <span className="text-slate-400 w-16">{m.movementDate}</span>
                                    <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${mt.color}`}>{mt.label}</span>
                                    <span className={`font-mono flex-shrink-0 ${isAbsoluteAdjustment ? 'text-blue-600' : displayQuantity > 0 ? 'text-green-600' : displayQuantity < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                                      {isAbsoluteAdjustment ? `목표 ${displayQuantity}` : `${displayQuantity > 0 ? '+' : ''}${displayQuantity}`}
                                    </span>
                                    <span className="text-slate-400 truncate">{m.notes || m.referenceNo || ''}</span>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                      </div>

                      {/* 재고 변동 추이 */}
                      {panelHistory.length > 1 && (
                        <div className="border-t border-slate-100 pt-3">
                          <p className="text-xs font-semibold text-slate-600 mb-2">쿠팡재고 추이</p>
                          {(() => {
                            const data = [...panelHistory].reverse().map((d, i, arr) => ({
                              ...d,
                              isLast: i === arr.length - 1,
                              label: d.snapshot_date.slice(5),
                            }))
                            return (
                              <ResponsiveContainer width="100%" height={64}>
                                <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                                  <Tooltip content={<ChartTooltipContent hideLabel formatter={(v: number) => `${v.toLocaleString('ko-KR')}개`} />} />
                                  <Bar dataKey="coupang_stock" name="쿠팡재고" radius={[2, 2, 0, 0]}>
                                    {data.map((d) => (
                                      <Cell key={d.snapshot_date} fill={d.isLast ? 'var(--color-brand-500, #22c55e)' : 'var(--color-brand-200, #bbf7d0)'} />
                                    ))}
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            )
                          })()}
                          <div className="flex justify-between mt-1">
                            <span className="text-[9px] text-slate-400">{panelHistory.length}회 Import</span>
                            {(() => {
                              const latest = panelHistory[0]?.coupang_stock || 0
                              const prev = panelHistory[1]?.coupang_stock || 0
                              const diff = latest - prev
                              if (diff === 0) return null
                              return <span className={`text-[9px] font-mono ${diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                                전회 대비 {diff > 0 ? '+' : ''}{diff}
                              </span>
                            })()}
                          </div>
                        </div>
                      )}

                      {/* 매입 바로가기 */}
                      {(selectedItem.status === 'danger' || selectedItem.status === 'warning') && (
                        <div className="border-t border-slate-100 pt-3">
                          <Link href={`/purchases?product=${selectedItem.productId}`}
                            className="flex items-center justify-center gap-1.5 h-9 w-full bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-xs font-medium hover:bg-amber-100">
                            <ShoppingCart className="w-3.5 h-3.5" /> 매입 등록하기
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 이력 탭 ── */}
        {activeTab === 'history' && (
          <HistoryTab movements={movements} />
        )}
      </div>

      {/* ── 입출고 통합 모달 ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={() => setModalOpen(false)}>
          <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-xl bg-white shadow-2xl sm:mx-4 sm:max-w-md sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700">입출고 등록</h3>
              <button onClick={() => setModalOpen(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {/* 유형 선택 */}
              <div className="flex gap-2">
                {MOVEMENT_TYPES.map((t) => (
                  <button key={t.key} onClick={() => setModalType(t.key)}
                    className={`flex-1 h-9 rounded-lg text-sm font-medium border transition-colors ${
                      modalType === t.key
                        ? t.key === 'inbound' ? 'bg-green-50 border-green-300 text-green-700'
                          : t.key === 'outbound' ? 'bg-red-50 border-red-300 text-red-700'
                          : 'bg-amber-50 border-amber-300 text-amber-700'
                        : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}>{t.label}</button>
                ))}
              </div>

              {/* 상품 */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">상품 *</label>
                <select value={formProduct} onChange={(e) => setFormProduct(e.target.value)}
                  className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm">
                  <option value="">상품을 선택하세요</option>
                  {items.map((i) => <option key={i.productId} value={i.productId}>{i.productName} {i.optionName ? `(${i.optionName})` : ''}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    {modalType === 'adjustment' ? '조정 후 수량 *' : '수량 *'}
                  </label>
                  <input type="number" value={formQty || ''} onChange={(e) => setFormQty(Number(e.target.value))}
                    className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm text-right" />
                </div>
                {modalType === 'inbound' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">단가 (원)</label>
                    <input type="number" value={formCost || ''} onChange={(e) => setFormCost(Number(e.target.value))}
                      className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm text-right" />
                  </div>
                )}
                {(modalType === 'outbound' || modalType === 'adjustment') && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">사유 *</label>
                    <select value={formReason} onChange={(e) => setFormReason(e.target.value)}
                      className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm">
                      <option value="">선택</option>
                      {(modalType === 'outbound' ? OUTBOUND_REASONS : ADJUSTMENT_REASONS).map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">날짜</label>
                  <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)}
                    className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{modalType === 'inbound' ? '참조번호' : '메모'}</label>
                  <input type="text" value={modalType === 'inbound' ? formRef : formNotes}
                    onChange={(e) => modalType === 'inbound' ? setFormRef(e.target.value) : setFormNotes(e.target.value)}
                    placeholder={modalType === 'inbound' ? 'PO번호 등' : '비고'}
                    className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm" />
                </div>
              </div>

              {modalType === 'inbound' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">메모</label>
                  <input type="text" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="비고"
                    className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm" />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button onClick={() => setModalOpen(false)} className="h-9 px-4 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">취소</button>
              <button onClick={handleFormSubmit} disabled={formSaving}
                className="h-9 px-6 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50">
                {formSaving ? '처리 중...' : modalType === 'inbound' ? '입고 등록' : modalType === 'outbound' ? '출고 등록' : '조정 저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── 이력 탭 ──
function HistoryTab({ movements }: {
  movements: InventoryMovement[]
}) {
  const [historyRows, setHistoryRows] = useState<InventoryMovement[]>(movements)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 15

  useEffect(() => {
    // 별도 조회가 성공한 이력을 백그라운드 훅 실패의 빈 배열로 덮어쓰지 않는다.
    if (movements.length > 0) setHistoryRows(movements)
  }, [movements])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const res = await apiFetch('/api/inventory/movements')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '입출고 이력 조회 실패')
      if (!Array.isArray(json.data)) throw new Error('입출고 이력 응답 형식이 올바르지 않습니다.')
      setHistoryRows(json.data)
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : '입출고 이력을 조회하지 못했습니다.')
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => { void loadHistory() }, [loadHistory])

  let filtered = historyRows
  if (typeFilter) filtered = filtered.filter((m) => m.movementType === typeFilter)
  if (fromDate) filtered = filtered.filter((m) => m.movementDate >= fromDate)
  if (toDate) filtered = filtered.filter((m) => m.movementDate <= toDate)

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const exportRows = filtered.map((movement) => ({
    ...movement,
    quantity: movement.movementType === 'adjustment'
      && (movement.quantityMode ?? inferMovementQuantityMode(movement.movementType, movement.referenceNo, movement.notes)) === 'absolute'
      ? `목표 ${movement.quantity}`
      : movementDisplayQuantity(movement.movementType, movement.quantity),
  }))

  const HISTORY_EXPORT_COLS = [
    { key: 'movementDate', header: '날짜', width: 12 },
    { key: 'movementType', header: '유형', width: 8, format: (v: string) => v === 'inbound' ? '입고' : v === 'outbound' ? '출고' : '조정' },
    { key: 'productName', header: '상품명', width: 25 },
    { key: 'quantity', header: '수량', width: 10 },
    { key: 'unitCost', header: '단가', width: 10 },
    { key: 'referenceNo', header: '참조번호', width: 15 },
    { key: 'notes', header: '메모', width: 20 },
  ]

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0) }}
          className="h-9 w-full px-3 border border-slate-200 rounded-lg text-sm bg-white sm:w-auto">
          <option value="">전체 유형</option>
          <option value="inbound">입고</option><option value="outbound">출고</option><option value="adjustment">조정</option>
        </select>
        <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(0) }}
          className="h-9 w-full px-3 border border-slate-200 rounded-lg text-sm sm:w-auto" />
        <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(0) }}
          className="h-9 w-full px-3 border border-slate-200 rounded-lg text-sm sm:w-auto" />
        <span className="text-xs text-slate-400">{filtered.length}건</span>
        <ExportButton
          data={exportRows}
          columns={HISTORY_EXPORT_COLS}
          filename="NexOps_입출고이력"
          sheetName="이력"
          disabled={filtered.length === 0}
          className="ml-auto"
        />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <span>입출고 이력은 감사 기록으로 삭제할 수 없습니다. 파란 ‘목표’ 값은 구 수동 조정의 절대 재고이며, 오류는 새 조정 이력으로 정정하세요.</span>
        <button onClick={() => void loadHistory()} disabled={historyLoading} className="shrink-0 underline disabled:opacity-50">
          새로고침
        </button>
      </div>

      {historyError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {historyError}
          <button onClick={() => void loadHistory()} className="ml-2 underline">다시 시도</button>
        </div>
      )}

      {historyLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">이력이 없습니다.</div>
      ) : (
        <>
          <div className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden">
            <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
              <table className="w-full min-w-[780px] text-[11px]">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-2 py-2 text-left font-medium text-slate-500">날짜</th>
                    <th className="px-2 py-2 text-center font-medium text-slate-500">유형</th>
                    <th className="px-2 py-2 text-left font-medium text-slate-500">상품</th>
                    <th className="px-2 py-2 text-right font-medium text-slate-500">수량</th>
                    <th className="px-2 py-2 text-right font-medium text-slate-500">단가</th>
                    <th className="px-2 py-2 text-left font-medium text-slate-500">참조</th>
                    <th className="px-2 py-2 text-left font-medium text-slate-500">메모</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((m) => {
                    const displayQuantity = movementDisplayQuantity(m.movementType, m.quantity)
                    const quantityMode = m.quantityMode ?? inferMovementQuantityMode(m.movementType, m.referenceNo, m.notes)
                    const isAbsoluteAdjustment = m.movementType === 'adjustment' && quantityMode === 'absolute'
                    return (
                      <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-2 py-2 text-slate-600">{m.movementDate}</td>
                      <td className="px-2 py-2 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          m.movementType === 'inbound' ? 'bg-green-100 text-green-700' : m.movementType === 'outbound' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                        }`}>{m.movementType === 'inbound' ? '입고' : m.movementType === 'outbound' ? '출고' : '조정'}</span>
                      </td>
                      <td className="px-2 py-2 text-slate-700 truncate max-w-[160px]">{m.productName || '-'}</td>
                      <td className={`px-2 py-2 text-right font-mono ${isAbsoluteAdjustment ? 'text-blue-600' : displayQuantity > 0 ? 'text-green-600' : displayQuantity < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                        {isAbsoluteAdjustment ? `목표 ${displayQuantity}` : `${displayQuantity > 0 ? '+' : ''}${displayQuantity}`}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-slate-500">{m.unitCost ? fmtN(m.unitCost) : '-'}</td>
                      <td className="px-2 py-2 text-slate-400 truncate max-w-[100px]">{m.referenceNo || '-'}</td>
                      <td className="px-2 py-2 text-slate-400 truncate max-w-[140px]">{m.notes || '-'}</td>
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
    </div>
  )
}
