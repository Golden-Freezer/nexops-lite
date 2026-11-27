'use client'

import { useState } from 'react'
import { CategorySelect } from '@/components/shared/CategorySelect'
import { Plus, X } from 'lucide-react'
import { validateNameLength, getStatusColor } from '@/lib/naming/validators'
import type { ProductFormData, SkuOption } from '@/types/product'

interface ComputedFields {
  stockQuantity?: number | null
  weeklyAvgSales?: number | null
  inventoryWeeks?: number | null
  purchaseRequired?: number | null
  inventoryStatus?: '재고부족' | '재고과잉' | '-'
}

interface ProductFormProps {
  initial?: Partial<ProductFormData>
  computed?: ComputedFields
  onSubmit: (data: ProductFormData) => void
  loading?: boolean
}

const defaultData: ProductFormData = {
  keyword: '',
  productName: '',
  categoryPath: '',
  commissionRate: 0.108,
  saleType: '로켓그로스',
  status: 'draft',
  searchTags: [],
  coupangProductUrl: '',
  notes: '',
  sku: '',
  skuOptions: [],
}

export function ProductForm({ initial, computed, onSubmit, loading }: ProductFormProps) {
  const [data, setData] = useState<ProductFormData>({ ...defaultData, ...initial })
  const [tagInput, setTagInput] = useState('')

  const update = <K extends keyof ProductFormData>(field: K, value: ProductFormData[K]) => {
    setData((d) => ({ ...d, [field]: value }))
  }

  // 카테고리 변경 시 SKU 자동 생성
  const handleCategoryChange = (path: string, categories: { major: string; mid: string; sub: string }) => {
    update('categoryPath', path)
    // 대분류가 선택되면 다음 SKU 조회
    if (categories.major) {
      fetch(`/api/products/next-sku?major=${encodeURIComponent(categories.major)}`)
        .then((res) => res.json())
        .then((json) => {
          if (json.data?.sku) {
            update('sku', json.data.sku)
          }
        })
        .catch(() => {})
    }
  }

  const handleRateChange = (rate: number) => {
    update('commissionRate', rate)
  }

  // 상품명 SEO 검증
  const nameValidation = validateNameLength(data.productName)

  const addTag = () => {
    if (tagInput.trim() && !data.searchTags.includes(tagInput.trim())) {
      update('searchTags', [...data.searchTags, tagInput.trim()])
      setTagInput('')
    }
  }

  const removeTag = (idx: number) => {
    update('searchTags', data.searchTags.filter((_, i) => i !== idx))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(data)
  }

  const inputClass =
    'w-full h-10 px-3 border border-slate-200 rounded-lg text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-colors'

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-6 shadow-card space-y-5">
      <h2 className="text-base font-semibold text-slate-700">상품 정보</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-slate-700 mb-1.5 block">키워드 *</label>
          <input
            type="text"
            value={data.keyword}
            onChange={(e) => update('keyword', e.target.value)}
            placeholder="예: 유모차스트랩"
            className={inputClass}
            required
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 mb-1.5 block">
            상품명
            {data.productName && (
              <span className={`ml-2 text-xs font-normal ${getStatusColor(nameValidation.status)}`}>
                {nameValidation.length}/{nameValidation.maxRecommended}자
              </span>
            )}
          </label>
          <input
            type="text"
            value={data.productName}
            onChange={(e) => update('productName', e.target.value)}
            placeholder="예: 페어넥스 유모차스트랩 블랙"
            className={inputClass}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 mb-1.5 block">수수료율 (%)</label>
          <input
            type="number"
            step="0.1"
            value={(data.commissionRate * 100).toFixed(1)}
            onChange={(e) => update('commissionRate', Number(e.target.value) / 100)}
            className={inputClass}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 mb-1.5 block">판매 유형</label>
          <select
            value={data.saleType}
            onChange={(e) => update('saleType', e.target.value as ProductFormData['saleType'])}
            className={inputClass}
          >
            <option value="로켓그로스">로켓그로스</option>
            <option value="판매자배송">판매자배송</option>
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 mb-1.5 block">상태</label>
          <select
            value={data.status}
            onChange={(e) => update('status', e.target.value as ProductFormData['status'])}
            className={inputClass}
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      {/* 카테고리 선택 (수수료 자동 연동) */}
      <CategorySelect
        onRateChange={handleRateChange}
        onCategoryChange={handleCategoryChange}
      />

      {/* 쿠팡 식별자 */}
      <div className="border-t border-slate-100 pt-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">쿠팡 식별자</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">바코드</label>
            <input type="text" value={data.barcode || ''} onChange={(e) => update('barcode', e.target.value)} placeholder="바코드" className={inputClass} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">등록상품ID</label>
            <input type="text" value={data.coupangProductId || ''} onChange={(e) => update('coupangProductId', e.target.value)} placeholder="쿠팡 등록상품ID" className={inputClass} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">쿠팡 노출 상품명</label>
            <input type="text" value={data.coupangDisplayName || ''} onChange={(e) => update('coupangDisplayName', e.target.value)} placeholder="쿠팡에 노출되는 상품명" className={inputClass} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">업체상품ID</label>
            <input type="text" value={data.vendorProductId || ''} onChange={(e) => update('vendorProductId', e.target.value)} placeholder="업체상품ID" className={inputClass} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">옵션ID</label>
            <input type="text" value={data.coupangOptionId || ''} onChange={(e) => update('coupangOptionId', e.target.value)} placeholder="쿠팡 옵션ID" className={inputClass} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">옵션명</label>
            <input type="text" value={data.optionName || ''} onChange={(e) => update('optionName', e.target.value)} placeholder="등록 옵션명" className={inputClass} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">노출ID</label>
            <input type="text" value={data.coupangExposureId || ''} onChange={(e) => update('coupangExposureId', e.target.value)} placeholder="Product ID / 노출ID" className={inputClass} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">조건값</label>
            <input type="text" value={data.conditionValue || ''} onChange={(e) => update('conditionValue', e.target.value)} placeholder="조건값" className={inputClass} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">반품 재판매</label>
            <input type="text" value={data.returnResaleInfo || ''} onChange={(e) => update('returnResaleInfo', e.target.value)} placeholder="반품 재판매 추가" className={inputClass} />
          </div>
        </div>
      </div>

      {/* 원가/비용 */}
      <div className="border-t border-slate-100 pt-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">원가 / 비용</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">원가 (₩)</label>
            <input type="number" value={data.unitCostDefault ?? ''} onChange={(e) => update('unitCostDefault', e.target.value ? Number(e.target.value) : null)} placeholder="0" className={inputClass} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">입출고배송비 (₩)</label>
            <input type="number" value={data.fulfillmentFeeDefault ?? ''} onChange={(e) => update('fulfillmentFeeDefault', e.target.value ? Number(e.target.value) : null)} placeholder="0" className={inputClass} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">판매자할인쿠폰 (₩)</label>
            <input type="number" value={data.sellerDiscountCoupon ?? ''} onChange={(e) => update('sellerDiscountCoupon', e.target.value ? Number(e.target.value) : null)} placeholder="0" className={inputClass} />
          </div>
        </div>
      </div>

      {/* 재고/발주 */}
      <div className="border-t border-slate-100 pt-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">재고 / 발주</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">입고소요 (주)</label>
            <input type="number" step="0.5" value={data.leadTimeWeeks ?? ''} onChange={(e) => update('leadTimeWeeks', e.target.value ? Number(e.target.value) : null)} placeholder="2" className={inputClass} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1 block">재고수량</label>
            <div className="h-10 px-3 flex items-center bg-slate-50 border border-slate-100 rounded-lg text-sm text-slate-600">{computed?.stockQuantity ?? '-'}</div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1 block">주평균판매</label>
            <div className="h-10 px-3 flex items-center bg-slate-50 border border-slate-100 rounded-lg text-sm text-slate-600">{computed?.weeklyAvgSales?.toFixed(1) ?? '-'}</div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1 block">재고주차</label>
            <div className="h-10 px-3 flex items-center bg-slate-50 border border-slate-100 rounded-lg text-sm text-slate-600">{computed?.inventoryWeeks?.toFixed(1) ?? '-'}</div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1 block">구매필요</label>
            <div className={`h-10 px-3 flex items-center bg-slate-50 border border-slate-100 rounded-lg text-sm ${(computed?.purchaseRequired ?? 0) > 0 ? 'text-red-600 font-medium' : 'text-slate-600'}`}>{computed?.purchaseRequired ?? '-'}</div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1 block">상태</label>
            <div className="h-10 px-3 flex items-center">
              {computed?.inventoryStatus ? (
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${
                  computed.inventoryStatus === '재고부족' ? 'bg-red-50 text-red-700 border-red-200'
                    : computed.inventoryStatus === '재고과잉' ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-slate-50 text-slate-500 border-slate-200'
                }`}>{computed.inventoryStatus}</span>
              ) : '-'}
            </div>
          </div>
        </div>
      </div>

      {/* SKU 관리 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm font-medium text-slate-700">SKU 관리</label>
          <button
            type="button"
            onClick={() => {
              const options = data.skuOptions || []
              update('skuOptions', [...options, { sku: '', label: '' }])
            }}
            className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            옵션 추가
          </button>
        </div>
        {(!data.skuOptions || data.skuOptions.length === 0) ? (
          <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-4 text-center">
            <p className="text-xs text-slate-400">등록된 SKU가 없습니다. 옵션 추가를 눌러 SKU를 입력하세요.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {data.skuOptions.map((opt, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={opt.label}
                  onChange={(e) => {
                    const options = [...(data.skuOptions || [])]
                    options[idx] = { ...options[idx], label: e.target.value }
                    update('skuOptions', options)
                  }}
                  placeholder="옵션명 (예: 블랙 M)"
                  className={`flex-1 ${inputClass}`}
                />
                <input
                  type="text"
                  value={opt.sku}
                  onChange={(e) => {
                    const options = [...(data.skuOptions || [])]
                    options[idx] = { ...options[idx], sku: e.target.value }
                    update('skuOptions', options)
                    // 첫 번째 SKU를 대표 SKU로 설정
                    if (idx === 0) update('sku', e.target.value)
                  }}
                  placeholder="SKU 코드"
                  className={`flex-1 ${inputClass} font-mono`}
                />
                <button
                  type="button"
                  onClick={() => {
                    const options = (data.skuOptions || []).filter((_, i) => i !== idx)
                    update('skuOptions', options)
                    // 대표 SKU 갱신
                    update('sku', options[0]?.sku || '')
                  }}
                  className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            {data.skuOptions.length > 1 && (
              <p className="text-xs text-slate-400">첫 번째 SKU가 대표 SKU로 사용됩니다.</p>
            )}
          </div>
        )}
      </div>

      <div>
        <label className="text-sm font-medium text-slate-700 mb-1.5 block">쿠팡 URL</label>
        <input
          type="url"
          value={data.coupangProductUrl}
          onChange={(e) => update('coupangProductUrl', e.target.value)}
          placeholder="https://www.coupang.com/..."
          className={inputClass}
        />
      </div>

      {/* 검색태그 */}
      <div>
        <label className="text-sm font-medium text-slate-700 mb-1.5 block">검색태그</label>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
            placeholder="태그 입력 후 Enter"
            className={`flex-1 ${inputClass}`}
          />
          <button
            type="button"
            onClick={addTag}
            className="px-3 h-10 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 transition-colors"
          >
            추가
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {data.searchTags.map((tag, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded text-xs text-slate-600"
            >
              {tag}
              <button type="button" onClick={() => removeTag(i)} className="text-slate-400 hover:text-slate-600">
                &times;
              </button>
            </span>
          ))}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-slate-700 mb-1.5 block">메모</label>
        <textarea
          value={data.notes}
          onChange={(e) => update('notes', e.target.value)}
          rows={3}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none resize-none"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full h-10 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50"
      >
        {loading ? '저장 중...' : '저장'}
      </button>
    </form>
  )
}
