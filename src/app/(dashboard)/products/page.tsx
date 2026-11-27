'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Plus, Upload, Download, Filter, Search, Pencil, Save, X, Lock, Unlock, ChevronUp, ChevronDown, RefreshCw } from 'lucide-react'
import { FileImporter } from '@/components/features/import/FileImporter'
import { exportProductTemplate, PRODUCT_EXPORT_COLUMNS } from '@/lib/export/excel'
import { ExportButton } from '@/components/shared/ExportButton'
import { apiFetch } from '@/lib/api-client'
import { ProductsKpiSection } from '@/components/features/analytics/ProductsKpiSection'
import { calculateMargin } from '@/lib/calc/margin'

// ── 포맷 ──
const fmtW = (v: number | null) => v != null ? v.toLocaleString('ko-KR') : '-'
const fmtP = (v: number | null) => v != null ? `${(v * 100).toFixed(1)}%` : '-'
const fmtN = (v: number | null, d = 1) => v != null ? v.toFixed(d) : '-'

// ── 판매상태 ──
const SALES_STATUS: Record<string, { label: string; color: string }> = {
  active: { label: '판매중', color: 'bg-brand-50 text-brand-700' },
  paused: { label: '중지', color: 'bg-amber-100 text-amber-700' },
  soldout: { label: '품절', color: 'bg-red-100 text-red-700' },
  preparing: { label: '준비중', color: 'bg-blue-100 text-blue-700' },
  discontinued: { label: '종료', color: 'bg-slate-100 text-slate-500' },
}

// ── 재고상태 ──
const STOCK_STATUS: Record<string, { label: string; cls: string }> = {
  '발주필요': { label: '발주필요', cls: 'bg-red-50 text-red-700 border-red-200' },
  '정상': { label: '정상', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
  '과잉': { label: '과잉', cls: 'bg-blue-50 text-blue-600 border-blue-200' },
}
const mapStockStatus = (s: string) => s === '재고부족' ? '발주필요' : s === '재고과잉' ? '과잉' : s === '-' ? '정상' : s

// ── 정렬 ──
type SortKey = string
type SortDir = 'asc' | 'desc' | null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sortItems(items: any[], key: SortKey, dir: SortDir) {
  if (!dir || !key) return items
  return [...items].sort((a, b) => {
    const va = a[key], vb = b[key]
    // null은 정렬 방향과 무관하게 항상 뒤로 보낸다 (숫자 Infinity 치환은 문자열과
    // 비교 시 NaN 강제변환으로 "항상 동등" 판정되는 문제가 있었음)
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    const cmp = typeof va === 'number' && typeof vb === 'number'
      ? va - vb
      : String(va).toLowerCase().localeCompare(String(vb).toLowerCase())
    return dir === 'asc' ? cmp : -cmp
  })
}

export default function ProductsPage() {
  const router = useRouter()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [invFilter, setInvFilter] = useState('')
  const [salesFilter, setSalesFilter] = useState('')
  const [gradeFilter, setGradeFilter] = useState('') // '' | 'NEW' | '반품'
  const [costFilter, setCostFilter] = useState('') // '' | 'missing' — 원가 미확정(이동평균·기본원가 모두 없음)
  const [showFilters, setShowFilters] = useState(false)
  const [showImporter, setShowImporter] = useState(false)

  // 정렬
  const [sortKey, setSortKey] = useState<SortKey>('seq')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // 수정 모드
  const [editMode, setEditMode] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [edits, setEdits] = useState<Record<string, Record<string, any>>>({}) // { productId: { field: value } }
  const [unlockedCells, setUnlockedCells] = useState<Set<string>>(new Set()) // "productId:field"
  const [saving, setSaving] = useState(false)

  // 페이지네이션
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(15)

  // 모달
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [modalProduct, setModalProduct] = useState<any | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [modalEdits, setModalEdits] = useState<Record<string, any>>({})
  const [modalUnlocked, setModalUnlocked] = useState<Set<string>>(new Set())
  const [modalSaving, setModalSaving] = useState(false)
  const requestIdRef = useRef(0)

  const fetchProducts = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ purpose: 'product' })
    if (statusFilter) params.set('status', statusFilter)
    if (invFilter) params.set('inventoryStatus', invFilter)
    if (search) params.set('search', search)
    try {
      const response = await apiFetch(`/api/products?${params}`)
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '상품 목록 조회 실패')
      if (requestId === requestIdRef.current) setProducts(json.data || [])
    } catch (reason) {
      if (requestId === requestIdRef.current) {
        setError(reason instanceof Error ? reason.message : '상품 목록 조회 실패')
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [statusFilter, invFilter, search])

  useEffect(() => {
    const timer = setTimeout(() => void fetchProducts(), search ? 300 : 0)
    return () => {
      clearTimeout(timer)
      requestIdRef.current += 1
    }
  }, [fetchProducts, search])

  // 정렬 토글
  const toggleSort = (key: SortKey) => {
    setPage(0)
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc')
      else if (sortDir === 'desc') { setSortKey('seq'); setSortDir('asc') }
      else setSortDir('asc')
    } else {
      setSortKey(key); setSortDir('asc')
    }
  }

  const sorted = sortItems(products, sortKey, sortDir)
  const salesFiltered = salesFilter ? sorted.filter((p) => p.salesStatus === salesFilter) : sorted
  const gradeFiltered = gradeFilter
    ? salesFiltered.filter((p) => gradeFilter === '반품' ? p.isRefurbished : !p.isRefurbished)
    : salesFiltered
  const filtered = costFilter === 'missing'
    ? gradeFiltered.filter((p) => (p.avgCostKrw ?? p.unitCostDefault) == null)
    : gradeFiltered
  const totalPages = Math.ceil(filtered.length / pageSize)
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize)

  // ── 수정 모드 헬퍼 ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getEditValue = (id: string, field: string, original: any) => {
    return edits[id]?.[field] !== undefined ? edits[id][field] : original
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setEditValue = (id: string, field: string, value: any) => {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }
  const isLocked = (id: string, field: string) => !unlockedCells.has(`${id}:${field}`)
  const toggleLock = (id: string, field: string) => {
    if (isLocked(id, field)) {
      if (confirm('쿠팡 식별자를 변경하면 판매/재고 매칭에 영향을 줍니다. 잠금을 해제하시겠습니까?')) {
        setUnlockedCells((prev) => new Set(prev).add(`${id}:${field}`))
      }
    } else {
      const next = new Set(unlockedCells)
      next.delete(`${id}:${field}`)
      setUnlockedCells(next)
    }
  }

  // 저장
  const handleSaveAll = async () => {
    const changedIds = Object.keys(edits).filter((id) => Object.keys(edits[id]).length > 0)
    if (changedIds.length === 0) { setEditMode(false); return }
    setSaving(true)
    let failCount = 0
    for (const id of changedIds) {
      const changes = edits[id]
      const body: Record<string, unknown> = {}
      if (changes.coupangDisplayName !== undefined) body.coupangDisplayName = changes.coupangDisplayName
      if (changes.optionName !== undefined) body.optionName = changes.optionName
      if (changes.conditionValue !== undefined) body.conditionValue = String(changes.conditionValue)
      if (changes.sellerDiscountCoupon !== undefined) body.sellerDiscountCoupon = Number(changes.sellerDiscountCoupon)
      if (changes.commissionRate !== undefined) body.commissionRate = Number(changes.commissionRate) / 100
      if (changes.fulfillmentFeeDefault !== undefined) body.fulfillmentFeeDefault = Number(changes.fulfillmentFeeDefault)
      if (changes.unitCostDefault !== undefined) body.unitCostDefault = Number(changes.unitCostDefault)
      if (changes.leadTimeWeeks !== undefined) body.leadTimeWeeks = Number(changes.leadTimeWeeks)
      if (changes.salesStatus !== undefined) body.salesStatus = changes.salesStatus
      if (changes.barcode !== undefined) body.barcode = changes.barcode
      if (changes.coupangProductId !== undefined) body.coupangProductId = changes.coupangProductId
      if (changes.coupangExposureId !== undefined) body.coupangExposureId = changes.coupangExposureId
      if (changes.coupangOptionId !== undefined) body.coupangOptionId = changes.coupangOptionId
      try {
        const res = await apiFetch(`/api/products/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        if (!res.ok) failCount++
      } catch { failCount++ }
    }
    setSaving(false)
    setEditMode(false)
    setEdits({})
    setUnlockedCells(new Set())
    if (failCount > 0) alert(`${changedIds.length}건 중 ${failCount}건 저장 실패`)
    fetchProducts()
  }

  const cancelEdit = () => { setEditMode(false); setEdits({}); setUnlockedCells(new Set()) }

  // ── 모달 헬퍼 ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openModal = (p: any) => {
    if (editMode) return
    setModalProduct(p)
    setModalEdits({})
    setModalUnlocked(new Set())
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mVal = (field: string, original: any) => modalEdits[field] !== undefined ? modalEdits[field] : original
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mSet = (field: string, value: any) => setModalEdits((prev) => ({ ...prev, [field]: value }))

  const handleModalSave = async () => {
    if (!modalProduct) return
    setModalSaving(true)
    const body: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(modalEdits)) {
      if (k === 'commissionRate') body.commissionRate = Number(v) / 100
      else if (k === 'conditionValue') body.conditionValue = String(v)
      else if (['sellerDiscountCoupon', 'fulfillmentFeeDefault', 'unitCostDefault', 'leadTimeWeeks'].includes(k)) body[k] = Number(v)
      else body[k] = v
    }
    try {
      const res = await apiFetch(`/api/products/${modalProduct.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error || '저장 실패'); setModalSaving(false); return }
    } catch { alert('저장 중 오류가 발생했습니다.'); setModalSaving(false); return }
    setModalSaving(false)
    setModalProduct(null)
    fetchProducts()
  }

  // 마진 계산 (클라이언트) — 표준 공식(lib/calc/margin.ts calculateMargin)과 통일.
  // 기존 자체 계산식은 수수료VAT·입출고VAT·부가세를 누락해 마진 과대·최소ROAS 과소로 표시됐다 (audit §5-3)
  const calcMargin = (price: number, coupon: number, cost: number, rate: number, fulfillment: number) => {
    const finalPrice = price - coupon
    if (finalPrice <= 0) return { margin: null, marginRate: null, minRoas: null }
    const calc = calculateMargin({
      sellingPrice: finalPrice,
      unitCost: cost,
      fulfillmentFee: fulfillment,
      commissionRate: rate,
    })
    return {
      margin: calc.margin,
      marginRate: Math.round(calc.marginRate * 1000) / 1000,
      minRoas: Number.isFinite(calc.minRoas) ? Math.round(calc.minRoas * 10) / 10 : null,
    }
  }

  // ── 정렬 헤더 ──
  const SortTh = ({ k, children, align = 'right' }: { k: string; children: React.ReactNode; align?: string }) => (
    <th
      className={`px-2 py-2 font-medium text-slate-500 whitespace-nowrap text-[11px] cursor-pointer hover:text-slate-700 select-none text-${align}`}
      onClick={() => toggleSort(k)}
    >
      <span className="inline-flex items-center gap-0.5">
        {children}
        {sortKey === k && sortDir === 'asc' && <ChevronUp className="w-3 h-3" />}
        {sortKey === k && sortDir === 'desc' && <ChevronDown className="w-3 h-3" />}
      </span>
    </th>
  )

  const td = 'px-2 py-2 whitespace-nowrap text-[11px]'
  const inp = 'w-full h-6 px-1 border border-brand-300 rounded text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-brand-400'

  return (
    <>
      <Header title="상품 관리" />
      {/* 상품 KPI (ops-ux Phase 5 — 자기완결 섹션, 필터 비연동) */}
      <ProductsKpiSection />
      <div className="max-w-full mx-auto px-4 lg:px-6 py-4 space-y-3">
        {/* 상단 */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full min-w-[160px] flex-1 sm:w-auto">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }}
              placeholder="상품명/옵션명/바코드/옵션ID 검색..." className="h-8 w-full pl-8 pr-3 border border-slate-200 rounded-lg text-xs outline-none bg-white" />
          </div>
          <button onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1 h-8 px-3 border rounded-lg text-xs ${showFilters ? 'border-brand-400 text-brand-600 bg-brand-50' : 'border-slate-200 text-slate-500'}`}>
            <Filter className="w-3.5 h-3.5" /> 필터
          </button>

          {editMode ? (
            <>
              <button onClick={cancelEdit} className="flex items-center gap-1 h-8 px-3 border border-slate-200 text-slate-500 rounded-lg text-xs ml-auto">
                <X className="w-3.5 h-3.5" /> 취소
              </button>
              <button onClick={handleSaveAll} disabled={saving}
                className="flex items-center gap-1 h-8 px-4 bg-brand-500 text-white rounded-lg text-xs font-medium hover:bg-brand-600 disabled:opacity-50">
                <Save className="w-3.5 h-3.5" /> {saving ? '저장 중...' : '저장'}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => { setEditMode(true); setEdits({}) }}
                className="flex items-center gap-1 h-8 px-3 border border-amber-400 text-amber-600 rounded-lg text-xs hover:bg-amber-50 sm:ml-auto">
                <Pencil className="w-3.5 h-3.5" /> 수정
              </button>
              <ExportButton
                data={filtered}
                columns={PRODUCT_EXPORT_COLUMNS}
                filename="NexOps_상품목록"
                sheetName="상품"
                disabled={filtered.length === 0}
                title="화면 필터/정렬이 적용된 리포트 (재임포트용 아님)"
              />
              <button onClick={() => setShowImporter((v) => !v)} className="flex items-center gap-1 h-8 px-3 border border-brand-400 text-brand-600 rounded-lg text-xs">
                <Upload className="w-3.5 h-3.5" /> 임포트
              </button>
              <button onClick={() => router.push('/products/new')} className="flex items-center gap-1 h-8 px-4 bg-brand-500 text-white rounded-lg text-xs font-medium">
                <Plus className="w-3.5 h-3.5" /> 등록
              </button>
            </>
          )}
        </div>

        {/* 수정 모드 배너 */}
        {editMode && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-xs text-amber-700 flex items-center gap-2">
            <Pencil className="w-3.5 h-3.5" />
            수정 모드 — 셀을 직접 수정 후 [저장]을 누르세요. 🔒 잠금 항목은 클릭하여 해제할 수 있습니다.
          </div>
        )}

        {/* 필터 */}
        {showFilters && (
          <div className="bg-white rounded-lg border border-slate-200 p-3 flex flex-wrap gap-3">
            <select value={salesFilter} onChange={(e) => { setSalesFilter(e.target.value); setPage(0) }} className="h-9 px-3 border border-slate-200 rounded-lg text-sm bg-white">
              <option value="">전체 판매상태</option>
              {Object.entries(SALES_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={gradeFilter} onChange={(e) => { setGradeFilter(e.target.value); setPage(0) }} className="h-9 px-3 border border-slate-200 rounded-lg text-sm bg-white">
              <option value="">전체 등급</option>
              <option value="NEW">NEW</option>
              <option value="반품">반품</option>
            </select>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }} className="h-9 px-3 border border-slate-200 rounded-lg text-sm bg-white">
              <option value="">전체 상태</option>
              <option value="draft">Draft</option><option value="active">Active</option>
              <option value="inactive">Inactive</option><option value="archived">Archived</option>
            </select>
            <select value={invFilter} onChange={(e) => { setInvFilter(e.target.value); setPage(0) }} className="h-9 px-3 border border-slate-200 rounded-lg text-sm bg-white">
              <option value="">전체 재고</option>
              <option value="재고부족">발주필요</option><option value="재고과잉">과잉</option><option value="-">정상</option>
            </select>
            <select value={costFilter} onChange={(e) => { setCostFilter(e.target.value); setPage(0) }} className="h-9 px-3 border border-slate-200 rounded-lg text-sm bg-white">
              <option value="">전체 원가</option>
              <option value="missing">원가 미확정만</option>
            </select>
            <span className="text-xs text-slate-400 self-center ml-auto">{filtered.length}개 상품</span>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}
              className="h-8 px-2 border border-slate-200 rounded text-xs bg-white">
              <option value={15}>15개씩</option>
              <option value={30}>30개씩</option>
              <option value={50}>50개씩</option>
              <option value={100}>100개씩</option>
            </select>
          </div>
        )}

        {showImporter && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2">
              <span className="text-xs text-emerald-700 flex-1">
                처음이라면 템플릿을 받아 작성하세요. 옵션 ID 기준으로 신규 등록/수정되며, 빈 칸은 기존값이 유지됩니다.
              </span>
              <button onClick={() => exportProductTemplate(null)}
                className="flex items-center gap-1 h-7 px-3 border border-emerald-300 text-emerald-700 bg-white rounded-lg text-xs hover:bg-emerald-100">
                <Download className="w-3 h-3" /> 빈 템플릿
              </button>
              <button onClick={() => exportProductTemplate(products)} disabled={products.length === 0}
                className="flex items-center gap-1 h-7 px-3 border border-emerald-300 text-emerald-700 bg-white rounded-lg text-xs hover:bg-emerald-100 disabled:opacity-40">
                <Download className="w-3 h-3" /> 현재 상품으로 템플릿
              </button>
            </div>
            <FileImporter importType="product" onComplete={() => { fetchProducts(); setShowImporter(false) }} />
          </div>
        )}

        {/* 테이블 */}
        {loading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">로딩 중...</div>
        ) : error ? (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
            <p className="text-sm font-medium text-red-700">상품 목록을 불러오지 못했습니다.</p>
            <p className="mt-1 text-xs text-red-500">{error}</p>
            <button
              type="button"
              onClick={() => void fetchProducts()}
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:text-red-800"
            >
              <RefreshCw className="h-3.5 w-3.5" /> 다시 시도
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">등록된 상품이 없습니다.</div>
        ) : (
          <>
          <div className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden">
            <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
            <table className="w-full min-w-[1600px]">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-slate-200 bg-slate-50">
                  <SortTh k="seq" align="center">SEQ</SortTh>
                  <SortTh k="barcode" align="left">바코드</SortTh>
                  <SortTh k="coupangProductId" align="left">등록ID</SortTh>
                  <SortTh k="coupangExposureId" align="left">노출ID</SortTh>
                  <SortTh k="coupangOptionId" align="left">옵션ID</SortTh>
                  <SortTh k="coupangDisplayName" align="left">상품명</SortTh>
                  <SortTh k="optionName" align="left">옵션명</SortTh>
                  <SortTh k="productGrade" align="center">등급</SortTh>
                  <SortTh k="salesStatus" align="center">판매</SortTh>
                  <SortTh k="conditionValue">판매가</SortTh>
                  <SortTh k="sellerDiscountCoupon">쿠폰</SortTh>
                  <SortTh k="commissionRate">수수료%</SortTh>
                  <SortTh k="fulfillmentFeeDefault">입출고비</SortTh>
                  <SortTh k="avgCostKrw">원가</SortTh>
                  <SortTh k="estimatedMargin">마진</SortTh>
                  <SortTh k="estimatedMarginRate">마진율</SortTh>
                  <SortTh k="minRoas">최소ROAS</SortTh>
                  <SortTh k="inventoryStatus" align="center">재고상태</SortTh>
                  <SortTh k="stockQuantity">재고</SortTh>
                  <SortTh k="weeklyAvgSales">주평균</SortTh>
                  <SortTh k="inventoryWeeks">재고주차</SortTh>
                  <SortTh k="leadTimeWeeks">리드타임</SortTh>
                  <SortTh k="purchaseRequired">구매필요</SortTh>
                  <SortTh k="purchaseCount">매입</SortTh>
                </tr>
              </thead>
              <tbody>
                {paged.map((p) => {
                  const stk = mapStockStatus(p.inventoryStatus)
                  const stkCfg = STOCK_STATUS[stk] || STOCK_STATUS['정상']
                  const ss = SALES_STATUS[p.salesStatus || 'active'] || SALES_STATUS.active
                  const hasEdits = edits[p.id] && Object.keys(edits[p.id]).length > 0

                  // 수정모드: 편집값 또는 원본
                  const ev = (f: string) => getEditValue(p.id, f, p[f])
                  const editCell = (field: string, original: unknown, type: 'text' | 'number' = 'number', w = 'w-16') => {
                    if (!editMode) return <span className="font-mono">{original != null ? (type === 'number' ? Number(original).toLocaleString() : String(original)) : '-'}</span>;
                    return <input type={type} value={getEditValue(p.id, field, original) ?? ''} onChange={(e) => setEditValue(p.id, field, e.target.value)}
                      className={`${inp} ${w} ${edits[p.id]?.[field] !== undefined ? 'bg-amber-50 border-amber-400' : ''}`} />
                  }
                  const lockedCell = (field: string, original: unknown) => {
                    if (!editMode) return <span className="font-mono text-slate-600">{String(original || '-')}</span>;
                    const locked = isLocked(p.id, field)
                    return (
                      <span className="flex items-center gap-0.5">
                        <button type="button" onClick={(e) => { e.stopPropagation(); toggleLock(p.id, field) }} className="text-slate-400 hover:text-slate-600">
                          {locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3 text-amber-500" />}
                        </button>
                        {locked
                          ? <span className="font-mono text-slate-400 bg-slate-100 px-1 rounded">{String(original || '-')}</span>
                          : <input type="text" value={getEditValue(p.id, field, original) ?? ''} onChange={(e) => setEditValue(p.id, field, e.target.value)}
                              className={`${inp} w-20 ${edits[p.id]?.[field] !== undefined ? 'bg-amber-50 border-amber-400' : ''}`} onClick={(e) => e.stopPropagation()} />
                        }
                      </span>
                    )
                  }

                  return (
                    <tr key={p.id} onClick={() => openModal(p)}
                      className={`border-b border-slate-100 transition-colors ${editMode ? '' : 'cursor-pointer hover:bg-slate-50'} ${hasEdits ? 'bg-amber-50/30' : ''}`}>
                      <td className={`${td} text-center font-mono text-slate-500`}>{p.seq ?? '-'}</td>
                      <td className={`${td} text-left`}>{lockedCell('barcode', p.barcode)}</td>
                      <td className={`${td} text-left`}>{lockedCell('coupangProductId', p.coupangProductId)}</td>
                      <td className={`${td} text-left`}>{lockedCell('coupangExposureId', p.coupangExposureId)}</td>
                      <td className={`${td} text-left`}>{lockedCell('coupangOptionId', p.coupangOptionId)}</td>
                      <td className={`${td} text-left max-w-[140px] truncate`}>
                        {editMode
                          ? <input type="text" value={ev('coupangDisplayName') || ''} onChange={(e) => setEditValue(p.id, 'coupangDisplayName', e.target.value)}
                              className={`${inp} w-32 ${edits[p.id]?.coupangDisplayName !== undefined ? 'bg-amber-50 border-amber-400' : ''}`} onClick={(e) => e.stopPropagation()} />
                          : <span className="text-slate-700" title={p.coupangDisplayName}>{p.coupangDisplayName || p.productName || '-'}</span>
                        }
                      </td>
                      <td className={`${td} text-left max-w-[100px] truncate`}>
                        {editMode
                          ? <input type="text" value={ev('optionName') || ''} onChange={(e) => setEditValue(p.id, 'optionName', e.target.value)}
                              className={`${inp} w-24 ${edits[p.id]?.optionName !== undefined ? 'bg-amber-50 border-amber-400' : ''}`} onClick={(e) => e.stopPropagation()} />
                          : <span className="text-slate-600">{p.optionName || '-'}</span>
                        }
                      </td>
                      {/* 등급 */}
                      <td className={`${td} text-center`}>
                        {(() => {
                          const grade = p.productGrade || ''
                          if (grade.includes('반품')) return <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-purple-100 text-purple-700">{grade}</span>
                          return <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">NEW</span>
                        })()}
                      </td>
                      {/* 판매상태 */}
                      <td className={`${td} text-center`}>
                        {editMode
                          ? <select value={ev('salesStatus') || 'active'} onChange={(e) => { e.stopPropagation(); setEditValue(p.id, 'salesStatus', e.target.value) }}
                              onClick={(e) => e.stopPropagation()} className={`h-6 px-1 border rounded text-[10px] ${edits[p.id]?.salesStatus !== undefined ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`}>
                              {Object.entries(SALES_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                            </select>
                          : <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${ss.color}`}>{ss.label}</span>
                        }
                      </td>
                      <td className={`${td} text-right`} onClick={(e) => editMode && e.stopPropagation()}>{editCell('conditionValue', p.conditionValue ? Number(p.conditionValue) : null)}</td>
                      <td className={`${td} text-right text-orange-600`} onClick={(e) => editMode && e.stopPropagation()}>{editCell('sellerDiscountCoupon', p.sellerDiscountCoupon)}</td>
                      <td className={`${td} text-right`} onClick={(e) => editMode && e.stopPropagation()}>
                        {editMode
                          ? <input type="number" step="0.1" value={getEditValue(p.id, 'commissionRate', p.commissionRate != null ? (p.commissionRate * 100).toFixed(1) : '') ?? ''}
                              onChange={(e) => setEditValue(p.id, 'commissionRate', e.target.value)}
                              className={`${inp} w-12 ${edits[p.id]?.commissionRate !== undefined ? 'bg-amber-50 border-amber-400' : ''}`} />
                          : <span>{fmtP(p.commissionRate)}</span>
                        }
                      </td>
                      <td className={`${td} text-right`} onClick={(e) => editMode && e.stopPropagation()}>{editCell('fulfillmentFeeDefault', p.fulfillmentFeeDefault)}</td>
                      <td className={`${td} text-right font-medium ${p.avgCostKrw ? 'text-slate-700' : 'text-slate-400'}`}>
                        {fmtW(p.avgCostKrw ?? p.unitCostDefault)}
                      </td>
                      <td className={`${td} text-right font-mono ${(p.estimatedMargin ?? 0) > 0 ? 'text-blue-600' : (p.estimatedMargin ?? 0) < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                        {p.estimatedMargin != null ? p.estimatedMargin.toLocaleString() : '-'}
                      </td>
                      <td className={`${td} text-right ${(p.estimatedMarginRate ?? 0) > 0 ? 'text-blue-600' : (p.estimatedMarginRate ?? 0) < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                        {fmtP(p.estimatedMarginRate)}
                      </td>
                      <td className={`${td} text-right font-mono ${p.minRoas ? 'text-slate-700' : 'text-slate-400'}`}>
                        {p.minRoas ? `${(p.minRoas * 100).toFixed(0)}%` : '-'}
                      </td>
                      <td className={`${td} text-center`}>
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${stkCfg.cls}`}>{stkCfg.label}</span>
                      </td>
                      <td className={`${td} text-right font-medium text-slate-700`}>{p.stockQuantity ?? '-'}</td>
                      <td className={`${td} text-right text-slate-600`}>{fmtN(p.weeklyAvgSales)}</td>
                      <td className={`${td} text-right text-slate-600`}>{fmtN(p.inventoryWeeks)}</td>
                      <td className={`${td} text-right`} onClick={(e) => editMode && e.stopPropagation()}>
                        {editMode
                          ? editCell('leadTimeWeeks', p.leadTimeWeeks)
                          : <span className={`font-mono ${p.leadTimeSource === 'auto' ? 'text-emerald-600' : 'text-slate-600'}`}
                              title={p.leadTimeSource === 'auto' ? '매입 이력(발주→입고) 자동계산' : p.leadTimeSource === 'manual' ? '수동 입력값' : '기본값 2주'}>
                              {fmtN(p.leadTimeWeeks)}
                            </span>
                        }
                      </td>
                      <td className={`${td} text-right font-medium ${(p.purchaseRequired ?? 0) > 0 ? 'text-red-600' : 'text-slate-600'}`}>{p.purchaseRequired ?? '-'}</td>
                      <td className={`${td} text-right text-slate-500`}>{p.purchaseCount || '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 py-2">
              <button onClick={() => setPage(0)} disabled={page === 0}
                className="h-7 px-2 border border-slate-200 rounded text-xs text-slate-600 disabled:opacity-30">처음</button>
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                className="h-7 px-3 border border-slate-200 rounded text-xs text-slate-600 disabled:opacity-30">이전</button>
              <span className="text-xs text-slate-500">{page + 1} / {totalPages} ({filtered.length}개)</span>
              <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                className="h-7 px-3 border border-slate-200 rounded text-xs text-slate-600 disabled:opacity-30">다음</button>
              <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
                className="h-7 px-2 border border-slate-200 rounded text-xs text-slate-600 disabled:opacity-30">마지막</button>
            </div>
          )}
        </>
        )}
      </div>

      {/* ── 개별 수정 모달 ── */}
      {modalProduct && !editMode && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={() => setModalProduct(null)}>
          <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-xl bg-white shadow-2xl sm:mx-4 sm:max-w-lg sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700 truncate">상품 수정 — {modalProduct.coupangDisplayName || modalProduct.productName}</h3>
              <button onClick={() => setModalProduct(null)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {/* 쿠팡 식별자 */}
              <div>
                <h4 className="text-xs font-semibold text-slate-500 mb-2">쿠팡 식별자</h4>
                <div className="grid grid-cols-2 gap-2">
                  {(['barcode', 'coupangProductId', 'coupangExposureId', 'coupangOptionId'] as const).map((f) => {
                    const labels: Record<string, string> = { barcode: '바코드', coupangProductId: '등록ID', coupangExposureId: '노출ID', coupangOptionId: '옵션ID' }
                    const locked = !modalUnlocked.has(f)
                    return (
                      <div key={f}>
                        <label className="text-[10px] text-slate-500 flex items-center gap-1">
                          {labels[f]}
                          <button type="button" onClick={() => {
                            if (locked) { if (confirm('쿠팡 식별자 변경 시 매칭에 영향을 줍니다.')) setModalUnlocked((p) => new Set(p).add(f)) }
                            else { const n = new Set(modalUnlocked); n.delete(f); setModalUnlocked(n) }
                          }} className="text-slate-400 hover:text-slate-600">
                            {locked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5 text-amber-500" />}
                          </button>
                        </label>
                        <input type="text" value={mVal(f, modalProduct[f]) ?? ''} onChange={(e) => mSet(f, e.target.value)} disabled={locked}
                          className={`w-full h-8 px-2 border rounded text-xs font-mono ${locked ? 'bg-slate-50 border-slate-100 text-slate-400' : 'border-slate-200 bg-white'}`} />
                      </div>
                    )
                  })}
                </div>
              </div>
              {/* 상품 정보 */}
              <div>
                <h4 className="text-xs font-semibold text-slate-500 mb-2">상품 정보</h4>
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] text-slate-500">상품명</label>
                    <input type="text" value={mVal('coupangDisplayName', modalProduct.coupangDisplayName) ?? ''} onChange={(e) => mSet('coupangDisplayName', e.target.value)}
                      className="w-full h-8 px-2 border border-slate-200 rounded text-xs" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-500">옵션명</label>
                      <input type="text" value={mVal('optionName', modalProduct.optionName) ?? ''} onChange={(e) => mSet('optionName', e.target.value)}
                        className="w-full h-8 px-2 border border-slate-200 rounded text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500">판매상태</label>
                      <select value={mVal('salesStatus', modalProduct.salesStatus || 'active')} onChange={(e) => mSet('salesStatus', e.target.value)}
                        className="w-full h-8 px-2 border border-slate-200 rounded text-xs">
                        {Object.entries(SALES_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
              {/* 가격/비용 */}
              <div>
                <h4 className="text-xs font-semibold text-slate-500 mb-2">가격 / 비용</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { f: 'conditionValue', l: '판매가', o: modalProduct.conditionValue ? Number(modalProduct.conditionValue) : null },
                    { f: 'sellerDiscountCoupon', l: '할인쿠폰', o: modalProduct.sellerDiscountCoupon },
                    { f: 'commissionRate', l: '수수료(%)', o: modalProduct.commissionRate != null ? (modalProduct.commissionRate * 100).toFixed(1) : '' },
                    { f: 'fulfillmentFeeDefault', l: '입출고비', o: modalProduct.fulfillmentFeeDefault },
                    { f: 'unitCostDefault', l: '원가', o: modalProduct.unitCostDefault },
                    { f: 'leadTimeWeeks', l: '리드타임(주)', o: modalProduct.leadTimeWeeks },
                  ].map(({ f, l, o }) => (
                    <div key={f}>
                      <label className="text-[10px] text-slate-500">{l}</label>
                      <input type="number" step="any" value={mVal(f, o) ?? ''} onChange={(e) => mSet(f, e.target.value)}
                        className="w-full h-8 px-2 border border-slate-200 rounded text-xs text-right font-mono" />
                    </div>
                  ))}
                </div>
              </div>
              {/* 계산 결과 */}
              {(() => {
                const price = Number(mVal('conditionValue', modalProduct.conditionValue ? Number(modalProduct.conditionValue) : 0)) || 0
                const coupon = Number(mVal('sellerDiscountCoupon', modalProduct.sellerDiscountCoupon || 0)) || 0
                const cost = Number(modalProduct.avgCostKrw ?? mVal('unitCostDefault', modalProduct.unitCostDefault || 0)) || 0
                const rate = (Number(mVal('commissionRate', modalProduct.commissionRate != null ? (modalProduct.commissionRate * 100).toFixed(1) : 0)) || 0) / 100
                const ful = Number(mVal('fulfillmentFeeDefault', modalProduct.fulfillmentFeeDefault || 0)) || 0
                const { margin, marginRate, minRoas } = calcMargin(price, coupon, cost, rate, ful)
                return (
                  <div className="bg-slate-50 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div><p className="text-[10px] text-slate-400">최종판매가</p><p className="text-sm font-bold font-mono text-slate-700">{(price - coupon).toLocaleString()}</p></div>
                    <div><p className="text-[10px] text-slate-400">마진</p><p className={`text-sm font-bold font-mono ${(margin ?? 0) >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{margin != null ? margin.toLocaleString() : '-'}</p></div>
                    <div><p className="text-[10px] text-slate-400">마진율</p><p className={`text-sm font-bold ${(marginRate ?? 0) >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{fmtP(marginRate)}</p></div>
                    <div><p className="text-[10px] text-slate-400">최소ROAS</p><p className="text-sm font-bold font-mono text-slate-700">{minRoas ? `${(minRoas * 100).toFixed(0)}%` : '-'}</p></div>
                  </div>
                )
              })()}
            </div>
            {/* 하단 버튼 */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
              <button
                type="button"
                disabled
                title="판매·매입·재고 원장 보존을 위해 상품 삭제가 잠겨 있습니다."
                className="flex cursor-not-allowed items-center gap-1 text-xs text-slate-400"
              >
                <Lock className="w-3.5 h-3.5" /> 삭제 잠금
              </button>
              <div className="flex gap-2">
                <button onClick={() => setModalProduct(null)} className="h-8 px-4 border border-slate-200 rounded-lg text-xs text-slate-600">취소</button>
                <button onClick={handleModalSave} disabled={modalSaving}
                  className="h-8 px-6 bg-brand-500 text-white rounded-lg text-xs font-medium hover:bg-brand-600 disabled:opacity-50">
                  {modalSaving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
