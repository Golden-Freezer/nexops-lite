'use client'

import { useMemo, useState } from 'react'
import { X, Loader2, Ticket, Search } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'

interface ProductOption { productId: string; label: string; optionId?: string }

interface BulkCouponModalProps {
  open: boolean
  onClose: () => void
  products: ProductOption[]
  defaultStart: string
  defaultEnd: string
  onApplied: () => void
}

/** 상품 × 기간 판매자할인쿠폰 일괄 설정 (개당 쿠폰 × 수량 적용 + 마진 재계산) */
export function BulkCouponModal({ open, onClose, products, defaultStart, defaultEnd, onApplied }: BulkCouponModalProps) {
  const [productId, setProductId] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(defaultEnd)
  const [perUnit, setPerUnit] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ matched: number; updated: number } | null>(null)

  // 상품명 / 옵션ID로 필터링 (선택된 상품은 검색어와 무관하게 목록에 유지)
  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase()
    if (!q) return products
    return products.filter((p) =>
      p.productId === productId ||
      p.label.toLowerCase().includes(q) ||
      (p.optionId || '').toLowerCase().includes(q)
    )
  }, [products, productSearch, productId])

  if (!open) return null

  const submit = async () => {
    setError(null); setResult(null)
    if (!productId) { setError('상품을 선택하세요.'); return }
    const perUnitCoupon = Number(perUnit)
    if (!Number.isFinite(perUnitCoupon) || perUnitCoupon < 0) { setError('개당 쿠폰 금액을 올바르게 입력하세요.'); return }
    setSubmitting(true)
    try {
      const res = await apiFetch('/api/sales/bulk-coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, startDate, endDate, perUnitCoupon }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setResult(json.data)
      onApplied()
    } catch (e) {
      setError(e instanceof Error ? e.message : '적용 실패')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[85dvh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><Ticket className="w-4 h-4 text-rose-500" /> 쿠폰 일괄 설정</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-slate-500">선택한 상품의 기간 내 매출에 <b>개당 쿠폰 × 판매수량</b>을 일괄 적용하고 마진을 재계산합니다. 이후 임포트에도 반영됩니다.</p>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600">상품</label>
            <div className="relative mt-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input type="text" value={productSearch} onChange={(e) => setProductSearch(e.target.value)}
                placeholder="상품명 / 옵션ID 검색" className="w-full h-8 pl-8 pr-3 border border-slate-200 rounded-lg text-sm" />
            </div>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className="w-full h-9 mt-1.5 px-2 border border-slate-200 rounded-lg text-sm">
              <option value="">{filteredProducts.length === 0 ? '검색 결과 없음' : `상품 선택… (${filteredProducts.length}개)`}</option>
              {filteredProducts.map((p) => (
                <option key={p.productId} value={p.productId}>
                  {p.label}{p.optionId ? ` · ${p.optionId}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-slate-600">시작일</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full h-9 mt-1 px-2 border border-slate-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">종료일</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full h-9 mt-1 px-2 border border-slate-200 rounded-lg text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">개당 쿠폰 금액 (원)</label>
            <input type="number" value={perUnit} onChange={(e) => setPerUnit(e.target.value)} placeholder="예: 1000" className="w-full h-9 mt-1 px-2 border border-slate-200 rounded-lg text-sm font-mono" />
          </div>
        </div>

        {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
        {result && <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2">{result.updated}건 적용 완료 (대상 {result.matched}건). 마진이 재계산되었습니다.</div>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">닫기</button>
          <button onClick={submit} disabled={submitting} className="flex-1 h-9 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-50 flex items-center justify-center gap-1">
            {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> 적용 중…</> : '일괄 적용'}
          </button>
        </div>
      </div>
    </div>
  )
}
