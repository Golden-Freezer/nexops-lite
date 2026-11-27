import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateProfitLoss } from '@/lib/settlement/profit'
import { mapRowToSettlementItem } from '@/lib/settlement/mapper'
import { requireAuth } from '@/lib/auth/clerk'
import { requireOwnedBusinessId } from '@/lib/auth/business'
import { fetchAllRows } from '@/lib/supabase/fetch-all'

/** GET /api/settlement/report - 상품별 손익 리포트 */
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
      return NextResponse.json({ error: `정산 데이터 조회 실패: ${error.message}` }, { status: 500 })
    }

    const items = (data || []).map(mapRowToSettlementItem)
    const report = calculateProfitLoss(items)

    return NextResponse.json({ data: report })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '손익 리포트 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
