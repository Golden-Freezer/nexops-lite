'use client'

import { useState, useEffect, useMemo } from 'react'
import { X } from 'lucide-react'
import type { SettlementFormData } from '@/types/settlement'
import { simulateTotal } from '@/lib/calc/margin'
import { apiFetch } from '@/lib/api-client'

interface ProductOption {
  id: string
  productName: string
  optionName: string | null
  keyword: string
}

interface SettlementFormProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: SettlementFormData) => Promise<unknown>
  error?: string | null
}

const inputClass =
  'w-full h-10 px-3 border border-slate-200 rounded-lg text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-colors'

export function SettlementForm({ open, onClose, onSubmit, error }: SettlementFormProps) {
  const [products, setProducts] = useState<ProductOption[]>([])
  const [productsLoading, setProductsLoading] = useState(false)
  const [productsError, setProductsError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 폼 필드
  const [productId, setProductId] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [salesQuantity, setSalesQuantity] = useState(0)
  const [sellingPrice, setSellingPrice] = useState(0)
  const [unitCost, setUnitCost] = useState(0)
  const [fulfillmentFee, setFulfillmentFee] = useState(0)
  const [commissionRate, setCommissionRate] = useState(0)
  const [returnRate, setReturnRate] = useState(8)
  const [adCost, setAdCost] = useState(0)

  // 상품 목록 로드
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setProductsLoading(true)
    setProductsError(null)
    // 소싱 뷰(사업장 무관)로 빠지지 않도록 product 뷰 + X-Business-Id 헤더 강제 (2026-07-15 격리 조사)
    apiFetch('/api/products?purpose=product')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || '상품 조회 실패')
        return json
      })
      .then((json) => {
        if (cancelled) return
        const rows = Array.isArray(json.data) ? json.data : []
        setProducts(
          rows.map((p: { id: string; productName: string; optionName: string | null; keyword: string }) => ({
            id: p.id,
            productName: p.productName || p.keyword || '',
            optionName: p.optionName || null,
            keyword: p.keyword || '',
          }))
        )
      })
      .catch((loadError) => {
        if (cancelled) return
        setProducts([])
        setProductsError(loadError instanceof Error ? loadError.message : '상품 조회 실패')
      })
      .finally(() => { if (!cancelled) setProductsLoading(false) })
    return () => { cancelled = true }
  }, [open])

  // 실시간 미리보기 계산
  const preview = useMemo(() => {
    if (!salesQuantity || !sellingPrice) return null
    return simulateTotal({
      sellingPrice,
      unitCost,
      fulfillmentFee,
      commissionRate: commissionRate / 100,
      quantity: salesQuantity,
      returnRate: returnRate / 100,
      adCost,
    })
  }, [salesQuantity, sellingPrice, unitCost, fulfillmentFee, commissionRate, returnRate, adCost])

  const resetForm = () => {
    setProductId('')
    setPeriodStart('')
    setPeriodEnd('')
    setSalesQuantity(0)
    setSellingPrice(0)
    setUnitCost(0)
    setFulfillmentFee(0)
    setCommissionRate(0)
    setReturnRate(8)
    setAdCost(0)
  }

  const handleSubmit = async () => {
    if (!productId || !periodStart || !periodEnd) return
    if (!salesQuantity || !sellingPrice || unitCost < 0) return

    setSubmitting(true)
    try {
      const result = await onSubmit({
        productId,
        periodStart,
        periodEnd,
        salesQuantity,
        sellingPrice,
        unitCost,
        fulfillmentFee,
        commissionRate: commissionRate / 100,
        returnRate: returnRate / 100,
        adCost,
      })
      if (result) {
        resetForm()
        onClose()
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 오버레이 */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* 모달 */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85dvh] overflow-y-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-700">정산 입력</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 본문 */}
        <div className="px-6 py-5 space-y-4">
          {/* 상품 선택 */}
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">상품 선택</label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              disabled={productsLoading || !!productsError}
              className={inputClass}
            >
              <option value="">{productsLoading ? '상품을 불러오는 중...' : '상품을 선택하세요'}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.productName || p.keyword}{p.optionName ? ` (${p.optionName})` : ''}
                </option>
              ))}
            </select>
            {productsError && <p role="alert" className="mt-1.5 text-xs text-red-600">{productsError}</p>}
          </div>

          {/* 정산 기간 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">시작일</label>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">종료일</label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          {/* 수량 / 단가 입력 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">판매수량</label>
              <input
                type="number"
                value={salesQuantity || ''}
                onChange={(e) => setSalesQuantity(Number(e.target.value))}
                placeholder="0"
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">판매가 (단품)</label>
              <input
                type="number"
                value={sellingPrice || ''}
                onChange={(e) => setSellingPrice(Number(e.target.value))}
                placeholder="0"
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">원가 (단품)</label>
              <input
                type="number"
                value={unitCost || ''}
                onChange={(e) => setUnitCost(Number(e.target.value))}
                placeholder="0"
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">입출고비 (단품)</label>
              <input
                type="number"
                value={fulfillmentFee || ''}
                onChange={(e) => setFulfillmentFee(Number(e.target.value))}
                placeholder="0"
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">수수료율 (%)</label>
              <input
                type="number"
                step="0.1"
                value={commissionRate || ''}
                onChange={(e) => setCommissionRate(Number(e.target.value))}
                placeholder="10.8"
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">반품율 (%)</label>
              <input
                type="number"
                step="0.1"
                value={returnRate}
                onChange={(e) => setReturnRate(Number(e.target.value))}
                placeholder="8"
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">광고비</label>
              <input
                type="number"
                value={adCost}
                onChange={(e) => setAdCost(Number(e.target.value))}
                placeholder="0"
                className={inputClass}
              />
            </div>
          </div>

          {/* 실시간 미리보기 */}
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          {preview && (
            <div className="bg-slate-50 rounded-lg p-4 space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase">예상 결과</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">총매출</span>
                  <span className="font-mono text-slate-700">
                    {preview.totalRevenue.toLocaleString('ko-KR')}원
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">총마진</span>
                  <span className="font-mono text-slate-700">
                    {preview.totalMargin.toLocaleString('ko-KR')}원
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">마진율</span>
                  <span className="font-mono text-slate-700">
                    {(preview.totalMarginRate * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">순이익</span>
                  <span
                    className={`font-mono font-semibold ${
                      preview.netProfit >= 0 ? 'text-blue-600' : 'text-red-600'
                    }`}
                  >
                    {preview.netProfit.toLocaleString('ko-KR')}원
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !productId || !periodStart || !periodEnd || !salesQuantity || !sellingPrice || unitCost < 0}
            className="px-4 py-2 text-sm font-medium text-white bg-brand-500 hover:bg-brand-600 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {submitting ? '등록 중...' : '정산 등록'}
          </button>
        </div>
      </div>
    </div>
  )
}
