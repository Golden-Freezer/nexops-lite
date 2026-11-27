'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { ProductForm } from '@/components/features/products/ProductForm'
import { CostHistoryTable } from '@/components/features/products/CostHistoryTable'
import type { ProductFormData, CostHistoryItem } from '@/types/product'
import { apiFetch } from '@/lib/api-client'

export default function ProductDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [product, setProduct] = useState<any>(null)
  const [costs, setCosts] = useState<CostHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<'not-found' | 'error' | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadProduct() {
      setLoading(true)
      setLoadError(null)

      try {
        const [prodResponse, costsResponse] = await Promise.all([
          apiFetch(`/api/products/${id}`),
          apiFetch(`/api/products/${id}/costs`),
        ])

        if (prodResponse.status === 404 || costsResponse.status === 404) {
          if (!cancelled) setLoadError('not-found')
          return
        }
        if (!prodResponse.ok || !costsResponse.ok) {
          throw new Error('상품 상세 조회 실패')
        }

        const [prodJson, costsJson] = await Promise.all([
          prodResponse.json(),
          costsResponse.json(),
        ])
        if (!prodJson.data || !Array.isArray(costsJson.data)) {
          throw new Error('상품 상세 응답 형식 오류')
        }
        if (cancelled) return

        setProduct(prodJson.data)
        setCosts(
          costsJson.data.map((c: any) => ({
            id: c.id,
            supplierId: c.supplier_id,
            supplierName: c.suppliers?.name || null,
            unitCost: c.unit_cost,
            sellingPrice: c.selling_price,
            fulfillmentFee: c.fulfillment_fee,
            commissionRate: c.commission_rate,
            margin: c.margin,
            marginRate: c.margin_rate,
            minRoas: c.min_roas,
            returnRate: c.return_rate,
            createdAt: c.created_at,
          }))
        )
      } catch {
        if (!cancelled) setLoadError('error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadProduct()
    return () => {
      cancelled = true
    }
  }, [id])

  const handleSubmit = async (data: ProductFormData) => {
    setSaving(true)
    try {
      await apiFetch(`/api/products/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      router.push('/products')
    } catch {
      // 에러 처리
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <>
        <Header title="상품 상세" />
        <div className="max-w-3xl mx-auto px-4 lg:px-6 py-6">
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
            <p className="text-sm text-slate-400">로딩 중...</p>
          </div>
        </div>
      </>
    )
  }

  if (loadError === 'not-found') {
    return (
      <>
        <Header title="상품 상세" />
        <div className="max-w-3xl mx-auto px-4 lg:px-6 py-6">
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
            <p className="text-sm text-slate-500">상품을 찾을 수 없습니다.</p>
          </div>
        </div>
      </>
    )
  }

  if (loadError === 'error' || !product) {
    return (
      <>
        <Header title="상품 상세" />
        <div className="max-w-3xl mx-auto px-4 lg:px-6 py-6">
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
            <p role="alert" className="text-sm text-slate-500">
              상품 정보를 불러오지 못했습니다.
            </p>
          </div>
        </div>
      </>
    )
  }

  const options = product.options as { skuOptions?: { sku: string; label: string }[] } | null
  const initialData: Partial<ProductFormData> = {
    keyword: product.keyword,
    productName: product.product_name || '',
    categoryPath: product.category_path || '',
    commissionRate: product.commission_rate || 0.108,
    saleType: product.sale_type || '로켓그로스',
    status: product.status || 'draft',
    searchTags: product.search_tags || [],
    coupangProductUrl: product.coupang_product_url || '',
    notes: product.notes || '',
    sku: product.sku || '',
    skuOptions: options?.skuOptions || (product.sku ? [{ sku: product.sku, label: '' }] : []),
    // Excel '01.상품' 신규 필드
    barcode: product.barcode || '',
    coupangProductId: product.coupang_product_id || '',
    coupangDisplayName: product.coupang_display_name || '',
    vendorProductId: product.vendor_product_id || '',
    coupangOptionId: product.coupang_option_id || '',
    optionName: product.option_name || '',
    conditionValue: product.condition_value || '',
    returnResaleInfo: product.return_resale_info || '',
    coupangExposureId: product.coupang_exposure_id || '',
    fulfillmentFeeDefault: product.fulfillment_fee_default ?? null,
    unitCostDefault: product.unit_cost_default ?? null,
    sellerDiscountCoupon: product.seller_discount_coupon ?? null,
    leadTimeWeeks: product.lead_time_weeks ?? 2,
  }

  const computed = {
    stockQuantity: product.stockQuantity ?? null,
    weeklyAvgSales: product.weeklyAvgSales ?? null,
    inventoryWeeks: product.inventoryWeeks ?? null,
    purchaseRequired: product.purchaseRequired ?? null,
    inventoryStatus: product.inventoryStatus ?? '-',
  }

  return (
    <>
      <Header title={`상품: ${product.keyword || product.product_name || ''}`} />
      <div className="max-w-3xl mx-auto px-4 lg:px-6 py-6 space-y-6">
        <div className="flex justify-end">
          <button
            type="button"
            disabled
            title="판매·매입·재고 원장 보존을 위해 상품 삭제가 잠겨 있습니다."
            className="flex h-8 cursor-not-allowed items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs text-slate-400"
          >
            <Lock className="w-3.5 h-3.5" />
            상품 삭제 잠금
          </button>
        </div>
        <ProductForm
          initial={initialData}
          computed={computed}
          onSubmit={handleSubmit}
          loading={saving}
        />

        {/* 원가 히스토리 */}
        <CostHistoryTable items={costs} />
      </div>
    </>
  )
}
