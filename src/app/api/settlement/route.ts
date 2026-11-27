import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateSettlementTotals } from '@/lib/settlement/profit'
import { mapRowToSettlementItem } from '@/lib/settlement/mapper'
import { requireAuth } from '@/lib/auth/clerk'
import { requireOwnedBusinessId } from '@/lib/auth/business'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import type { SettlementFormData } from '@/types/settlement'

/** GET /api/settlement - 정산 내역 목록 (기간 필터) */
export async function GET(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (r) { return r as NextResponse }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const { searchParams } = new URL(request.url)
    let businessId: string
    try { businessId = await requireOwnedBusinessId(userId) } catch (response) { return response as NextResponse }

    const periodStart = searchParams.get('periodStart')
    const periodEnd = searchParams.get('periodEnd')

    const buildQuery = () => {
      let query = supabase
        .from('settlements')
        .select(`*, products ( product_name, keyword, sku )`)
        .eq('user_id', userId)
        .eq('business_id', businessId)
        .eq('products.user_id', userId)
        .eq('products.business_id', businessId)
      if (periodStart) query = query.gte('period_start', periodStart)
      if (periodEnd) query = query.lte('period_end', periodEnd)
      return query
        .order('period_start', { ascending: false })
        .order('id', { ascending: true })
    }

    const { data, error } = await fetchAllRows(buildQuery)

    if (error) {
      return NextResponse.json({ error: `정산 목록 조회 실패: ${error.message}` }, { status: 500 })
    }

    const items = (data || []).map(mapRowToSettlementItem)
    return NextResponse.json({ data: items })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '정산 목록 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

/** POST /api/settlement - 정산 내역 등록 (자동 계산) */
export async function POST(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (r) { return r as NextResponse }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const body: SettlementFormData = await request.json()
    let businessId: string
    try { businessId = await requireOwnedBusinessId(userId) } catch (response) { return response as NextResponse }

    if (!body.productId || !body.periodStart || !body.periodEnd) {
      return NextResponse.json({ error: '상품, 정산 시작일, 종료일은 필수입니다.' }, { status: 400 })
    }
    if (!body.salesQuantity || !body.sellingPrice || body.unitCost == null || body.unitCost < 0) {
      return NextResponse.json({ error: '판매수량, 판매가, 원가는 필수입니다.' }, { status: 400 })
    }
    if (body.commissionRate == null || body.fulfillmentFee == null) {
      return NextResponse.json({ error: '수수료율, 입출고비는 필수입니다.' }, { status: 400 })
    }

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id')
      .eq('id', body.productId)
      .eq('user_id', userId)
      .eq('business_id', businessId)
      .maybeSingle()
    if (productError) {
      return NextResponse.json({ error: `상품 확인 실패: ${productError.message}` }, { status: 500 })
    }
    if (!product) {
      return NextResponse.json({ error: '선택한 사업장의 상품을 찾을 수 없습니다.' }, { status: 404 })
    }

    const calculated = calculateSettlementTotals(body)
    const { net_profit: generatedNetProfit, ...calculatedFields } = calculated
    void generatedNetProfit

    const { data, error } = await supabase
      .from('settlements')
      .insert({
        user_id: userId,
        business_id: businessId,
        product_id: body.productId,
        period_start: body.periodStart,
        period_end: body.periodEnd,
        sales_quantity: body.salesQuantity,
        ...calculatedFields,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: `정산 등록 실패: ${error.message}` }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '정산 등록 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
