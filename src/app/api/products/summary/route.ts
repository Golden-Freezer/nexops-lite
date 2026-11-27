import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/auth/clerk'
import { requireBusinessId } from '@/lib/auth/business'
import { fetchAllRows } from '@/lib/supabase/fetch-all'

/**
 * GET /api/products/summary — 상품 KPI 집계 (읽기 전용, 파라미터 없음)
 *
 * negativeMargin: products 테이블에 margin/selling_price 컬럼이 없어 산출 불가 →
 * 명세 지침에 따라 0 + negativeMarginAvailable=false 반환 (임의 조인 금지).
 */
export async function GET() {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (r) { return r as NextResponse }
    let businessId: string
    try { businessId = await requireBusinessId() } catch (r) { return r as Response }

    const supabase = createAdminClient()

    const { data: products, error: productsError } = await fetchAllRows(() =>
      supabase
        .from('products')
        .select('id, sales_status')
        .eq('user_id', userId)
        .eq('business_id', businessId)
        .eq('purpose', 'product')
    )
    if (productsError) {
      return NextResponse.json({ error: `상품 조회 실패: ${productsError.message}` }, { status: 500 })
    }

    type ProductRow = { id: string; sales_status: string | null }
    const productRows = (products || []) as ProductRow[]

    // sales_status: null → active 취급 (기존 dashboard 라우트와 동일)
    const isActive = (s: string | null) => (s || 'active') === 'active'
    const total = productRows.length
    const active = productRows.filter((p) => isActive(p.sales_status)).length
    const paused = productRows.filter((p) => ['paused', 'discontinued'].includes(p.sales_status || '')).length

    // 품절: 명시적으로 soldout인 상품 + 판매중이지만 쿠팡 재고가 0인 상품의 합집합.
    // 재고 미수집(null)은 0으로 간주하지 않고, 중복 inventory 행도 상품당 한 번만 센다.
    const activeIds = new Set(productRows.filter((p) => isActive(p.sales_status)).map((p) => p.id))
    const outOfStockIds = new Set(productRows.filter((p) => p.sales_status === 'soldout').map((p) => p.id))
    const { data: invRows, error: invError } = await fetchAllRows(() =>
      supabase
        .from('inventory')
        .select('product_id, coupang_stock, products!inner(user_id, business_id)')
        .eq('products.user_id', userId)
        .eq('products.business_id', businessId)
    )
    if (invError) {
      return NextResponse.json({ error: `재고 조회 실패: ${invError.message}` }, { status: 500 })
    }
    type InvRow = {
      product_id: string
      coupang_stock: number | null
      products: { user_id: string | null; business_id: string | null } | null
    }
    for (const row of (invRows || []) as InvRow[]) {
      if (row.products?.business_id !== businessId) continue
      if (!activeIds.has(row.product_id)) continue
      if (row.coupang_stock != null && Number(row.coupang_stock) <= 0) {
        outOfStockIds.add(row.product_id)
      }
    }
    const outOfStock = outOfStockIds.size

    return NextResponse.json({
      data: {
        total,
        active,
        paused,
        outOfStock,
        negativeMargin: 0,
        negativeMarginAvailable: false,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '상품 KPI 집계 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
