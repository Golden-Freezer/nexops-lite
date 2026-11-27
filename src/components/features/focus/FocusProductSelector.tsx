'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, DatabaseZap, Loader2, Plus, Target, WalletCards } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import type { FocusProduct, FocusProductStatus } from '@/types/focus'

interface FocusProductSelectorProps {
  products: FocusProduct[]
  selectedId: string
  loading: boolean
  budget: number | null
  targetRoas: number | null
  freshness: string | null
  onSelect: (id: string) => void
  onRegister: () => void
}

const STATUS_META: Record<FocusProductStatus, { label: string; className: string }> = {
  active: { label: '활성', className: 'bg-green-100 text-green-700' },
  paused_seasonal: { label: '시즌 중지', className: 'bg-amber-100 text-amber-700' },
  discontinued: { label: '판매 종료', className: 'bg-slate-100 text-slate-600' },
}

const formatWon = (value: number | null) =>
  value == null ? '—' : `${Math.round(value).toLocaleString('ko-KR')}원`

function relativeFreshness(value: string | null): string {
  if (!value) return '광고 데이터 미수집'
  const observedAt = new Date(value).getTime()
  if (!Number.isFinite(observedAt)) return '광고 데이터 미수집'

  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - observedAt) / 60_000))
  if (elapsedMinutes < 1) return '방금 수집'
  if (elapsedMinutes < 60) return `${elapsedMinutes}분 전 수집`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours}시간 전 수집`
  return `${Math.floor(elapsedHours / 24)}일 전 수집`
}

function productLabel(product: FocusProduct): string {
  return product.label || product.product_name || product.coupang_exposure_id
}

function productStatus(product: FocusProduct): FocusProductStatus {
  return product.status ?? (product.is_active ? 'active' : 'discontinued')
}

function StatusBadge({ status }: { status: FocusProductStatus }) {
  const meta = STATUS_META[status]
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.className}`}>
      {meta.label}
    </span>
  )
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>
  } catch {
    return {}
  }
}

export function FocusProductSelector({
  products,
  selectedId,
  loading,
  budget,
  targetRoas,
  freshness,
  onSelect,
  onRegister,
}: FocusProductSelectorProps) {
  const selectorRef = useRef<HTMLDetailsElement>(null)
  const [listedProducts, setListedProducts] = useState(products)
  const [listLoading, setListLoading] = useState(false)
  const [nextStatus, setNextStatus] = useState<FocusProductStatus>('active')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  const loadAllProducts = async (): Promise<boolean> => {
    setListLoading(true)
    try {
      const response = await apiFetch('/api/focus/products?includeInactive=1')
      const json = await parseJson(response)
      if (!response.ok) throw new Error(String(json.error || '주력상품 목록 조회에 실패했습니다.'))
      setListedProducts((json.data as FocusProduct[] | undefined) ?? [])
      return true
    } catch (reason) {
      setStatusError(reason instanceof Error ? reason.message : '주력상품 목록 조회에 실패했습니다.')
      return false
    } finally {
      setListLoading(false)
    }
  }

  useEffect(() => {
    setListedProducts(products)
    if (!loading) void loadAllProducts()
    // 부모 목록이 바뀔 때마다 보관 상품까지 다시 동기화한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, loading])

  const selectedProduct = useMemo(
    () => listedProducts.find((product) => product.id === selectedId) ?? null,
    [listedProducts, selectedId],
  )
  const selectedStatus = selectedProduct ? productStatus(selectedProduct) : null
  const activeProducts = listedProducts.filter((product) => productStatus(product) === 'active')
  const archivedProducts = listedProducts.filter((product) => productStatus(product) !== 'active')
  const isEmpty = !loading && !listLoading && listedProducts.length === 0
  const hasFreshness = Boolean(freshness)

  useEffect(() => {
    if (selectedStatus) setNextStatus(selectedStatus)
    setNote('')
    setStatusError(null)
  }, [selectedId, selectedStatus])

  const selectProduct = (id: string) => {
    onSelect(id)
    selectorRef.current?.removeAttribute('open')
  }

  const updateStatus = async () => {
    if (!selectedProduct || nextStatus === selectedStatus) return
    setSaving(true)
    setStatusError(null)
    try {
      const response = await apiFetch('/api/focus/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedProduct.id,
          status: nextStatus,
          note: note.trim() || null,
        }),
      })
      const json = await parseJson(response)
      if (!response.ok) throw new Error(String(json.error || '상태 변경에 실패했습니다.'))

      const updated = json.data as FocusProduct
      setListedProducts((current) => current.map((product) => (
        product.id === updated.id ? updated : product
      )))
      setNote('')
      await loadAllProducts()
    } catch (reason) {
      setStatusError(reason instanceof Error ? reason.message : '상태 변경에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const renderProduct = (product: FocusProduct) => {
    const status = productStatus(product)
    const selected = product.id === selectedId
    return (
      <button
        key={product.id}
        type="button"
        role="option"
        aria-selected={selected}
        onClick={() => selectProduct(product.id)}
        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 ${
          selected ? 'bg-emerald-50 text-emerald-800' : 'text-slate-700'
        }`}
      >
        <span className="min-w-0 truncate">
          {productLabel(product)} · {product.coupang_exposure_id}
        </span>
        <StatusBadge status={status} />
      </button>
    )
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:min-w-[260px] sm:w-auto sm:flex-1">
          <span className="mb-1 block text-[11px] font-medium text-slate-500">주력상품</span>
          <details ref={selectorRef} className="relative">
            <summary className="flex h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 truncate">
                {loading || listLoading
                  ? '주력상품 불러오는 중...'
                  : isEmpty
                    ? '등록된 주력상품이 없습니다 — 등록하세요'
                    : selectedProduct
                      ? `${productLabel(selectedProduct)} · ${selectedProduct.coupang_exposure_id}`
                      : '주력상품을 선택하세요'}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {selectedStatus && <StatusBadge status={selectedStatus} />}
                <ChevronDown className="h-4 w-4 text-slate-400" />
              </span>
            </summary>
            {!isEmpty && (
              <div role="listbox" className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">활성</p>
                {activeProducts.length > 0
                  ? activeProducts.map(renderProduct)
                  : <p className="px-3 py-2 text-xs text-slate-400">활성 상품이 없습니다.</p>}
                {archivedProducts.length > 0 && (
                  <details className="border-t border-slate-100" open={selectedStatus !== 'active'}>
                    <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                      보관됨 ({archivedProducts.length})
                    </summary>
                    {archivedProducts.map(renderProduct)}
                  </details>
                )}
              </div>
            )}
          </details>
        </div>

        <div className="flex min-h-10 w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 sm:w-auto">
          <div className="flex items-center gap-1.5">
            <WalletCards className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-[11px] text-slate-500">현재 예산</span>
            <strong className="text-xs text-slate-700">{formatWon(budget)}</strong>
          </div>
          <div className="flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-[11px] text-slate-500">목표 ROAS</span>
            <strong className="text-xs text-slate-700">
              {targetRoas == null ? '—' : `${targetRoas.toLocaleString('ko-KR')}%`}
            </strong>
          </div>
        </div>

        <span className={`inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-full px-3 text-[11px] font-medium sm:w-auto sm:justify-start ${
          hasFreshness ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
        }`}>
          <DatabaseZap className="h-3.5 w-3.5" />
          {relativeFreshness(freshness)}
        </span>

        <button type="button" onClick={onRegister} className={`inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium text-white transition-colors sm:w-auto ${
          isEmpty ? 'bg-emerald-600 shadow-sm hover:bg-emerald-700' : 'bg-slate-700 hover:bg-slate-800'
        }`}>
          <Plus className="h-4 w-4" /> 주력상품 등록
        </button>
      </div>

      {selectedProduct && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <label className="w-full sm:w-auto sm:min-w-36">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">운영 상태</span>
            <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value as FocusProductStatus)} disabled={saving} className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-400 disabled:bg-slate-50">
              <option value="active">활성</option>
              <option value="paused_seasonal">시즌 중지</option>
              <option value="discontinued">판매 종료</option>
            </select>
          </label>
          <label className="w-full sm:min-w-[220px] sm:w-auto sm:flex-1">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">메모 (선택)</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} disabled={saving} placeholder="상태 변경 사유를 입력하세요" className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-700 outline-none placeholder:text-slate-300 focus:border-emerald-400 disabled:bg-slate-50" />
          </label>
          <button type="button" onClick={() => void updateStatus()} disabled={saving || nextStatus === selectedStatus} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            상태 저장
          </button>
        </div>
      )}
      {statusError && <p className="mt-2 text-xs text-red-600">{statusError}</p>}
    </section>
  )
}
