import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/auth/clerk'
import { requireOwnedBusinessId } from '@/lib/auth/business'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { rankProductProfitability } from '@/lib/settlement/profit'
import { buildCampaignProductLinks } from '@/lib/ads/campaign-product-match'

/** GET /api/settlement/ranking - SKU 수익성 랭킹 (sales_transactions 기반) */
export async function GET(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (r) { return r as NextResponse }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const { searchParams } = new URL(request.url)
    let businessId: string
    try { businessId = await requireOwnedBusinessId(userId) } catch (r) { return r as Response }

    const periodStart = searchParams.get('periodStart')
    const periodEnd = searchParams.get('periodEnd')

    const buildSalesQuery = () => {
      let q = supabase
        .from('sales_transactions')
        .select('product_id, total_amount, margin, products ( product_name, keyword, sku )')
        .eq('user_id', userId)
        .eq('business_id', businessId)
        .eq('status', 'confirmed')
        .eq('products.user_id', userId)
        .eq('products.business_id', businessId)
      if (periodStart) q = q.gte('order_date', periodStart)
      if (periodEnd) q = q.lte('order_date', periodEnd)
      return q.order('product_id', { ascending: true }).order('id', { ascending: true })
    }

    const buildAdsQuery = () => {
      let q = supabase
        .from('ad_campaigns')
        .select('product_id, campaign_name, spent_amount, billable_amount, vat_amount')
        .eq('user_id', userId)
        .eq('business_id', businessId)
      if (periodStart) q = q.gte('ad_date', periodStart)
      if (periodEnd) q = q.lte('ad_date', periodEnd)
      return q.order('ad_date', { ascending: true }).order('id', { ascending: true })
    }

    // 캠페인명 → 상품 귀속용 상품 표기 목록 (ad_campaigns.product_id는 일일 교체 삽입이라 항상 NULL)
    const buildProductsQuery = () => {
      return supabase
        .from('products')
        .select('id, product_name, option_name, keyword')
        .eq('user_id', userId)
        .eq('business_id', businessId)
        .eq('purpose', 'product')
        .order('id', { ascending: true })
    }

    const buildExpensesQuery = () => {
      let q = supabase
        .from('expenses')
        .select('amount, payment_method')
        .eq('user_id', userId)
        .eq('business_id', businessId)
      if (periodStart) q = q.gte('expense_date', periodStart)
      if (periodEnd) q = q.lte('expense_date', periodEnd)
      return q.order('expense_date', { ascending: true }).order('id', { ascending: true })
    }

    const [salesResult, adsResult, expensesResult, productsResult] = await Promise.all([
      fetchAllRows(buildSalesQuery),
      fetchAllRows(buildAdsQuery),
      fetchAllRows(buildExpensesQuery),
      fetchAllRows(buildProductsQuery),
    ])
    if (salesResult.error) {
      return NextResponse.json({ error: `매출 데이터 조회 실패: ${salesResult.error.message}` }, { status: 500 })
    }
    if (adsResult.error) {
      return NextResponse.json({ error: `광고 데이터 조회 실패: ${adsResult.error.message}` }, { status: 500 })
    }
    if (expensesResult.error) {
      return NextResponse.json({ error: `운영비 조회 실패: ${expensesResult.error.message}` }, { status: 500 })
    }
    if (productsResult.error) {
      return NextResponse.json({ error: `상품 목록 조회 실패: ${productsResult.error.message}` }, { status: 500 })
    }

    const matchableProducts = (productsResult.data || []).map((row) => ({
      productId: row.id as string,
      text: [row.product_name, row.option_name, row.keyword].filter(Boolean).join(' '),
    }))
    const campaignLinks = buildCampaignProductLinks(
      (adsResult.data || []).map((row) => row.campaign_name as string | null),
      matchableProducts,
    )

    const ranking = rankProductProfitability(
      (salesResult.data || [])
        .filter((row) => row.product_id)
        .map((row) => ({
          productId: row.product_id as string,
          productName: row.products?.product_name || row.products?.keyword || '(상품명 없음)',
          sku: row.products?.sku || null,
          revenue: Number(row.total_amount) || 0,
          margin: Number(row.margin) || 0,
        })),
      (adsResult.data || []).map((row) => ({
        productId: row.product_id,
        productIds: row.campaign_name ? campaignLinks.get(row.campaign_name as string) ?? null : null,
        spentAmount: Number(row.spent_amount) || 0,
        billableAmount: row.billable_amount == null ? null : Number(row.billable_amount),
        vatAmount: Number(row.vat_amount) || 0,
      })),
      (expensesResult.data || [])
        .filter((row) => row.payment_method !== 'coupang_deduction')
        .reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
    )

    return NextResponse.json({ data: ranking })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '수익성 랭킹 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
