import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/auth/clerk'
import { getBusinessId } from '@/lib/auth/business'

/** GET /api/import/calendar?month=2026-06
 *  해당 월의 일별 Import 현황 반환
 */
export async function GET(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (r) { return r as NextResponse }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const businessId = await getBusinessId()

    const { searchParams } = new URL(request.url)
    const month = searchParams.get('month') || new Date().toISOString().slice(0, 7)
    const startDate = `${month}-01`
    const endDate = `${month}-31`

    // 판매통계 (sales_transactions) — order_date 기준 일별 건수
    let salesQuery = supabase
      .from('sales_transactions')
      .select('order_date')
      .eq('user_id', userId)
      .eq('source', 'coupang_import')
      .gte('order_date', startDate)
      .lte('order_date', endDate)
    if (businessId) salesQuery = salesQuery.eq('business_id', businessId)
    const { data: salesData } = await salesQuery

    // 광고정산 (ad_campaigns) — ad_date 기준 일별 건수
    let adsQuery = supabase
      .from('ad_campaigns')
      .select('ad_date')
      .eq('user_id', userId)
      .eq('source', 'coupang_import')
      .gte('ad_date', startDate)
      .lte('ad_date', endDate)
    if (businessId) adsQuery = adsQuery.eq('business_id', businessId)
    const { data: adsData } = await adsQuery

    // 재고건강 (inventory_health_history) — snapshot_date 기준
    let healthQuery = supabase
      .from('inventory_health_history')
      .select('snapshot_date')
      .eq('user_id', userId)
      .gte('snapshot_date', startDate)
      .lte('snapshot_date', endDate)
    if (businessId) healthQuery = healthQuery.eq('business_id', businessId)
    const { data: healthData } = await healthQuery

    // 일별 집계
    const calendar: Record<string, { sales: number; ads: number; health: number }> = {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (salesData || []) as any[]) {
      const d = row.order_date
      if (!calendar[d]) calendar[d] = { sales: 0, ads: 0, health: 0 }
      calendar[d].sales++
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (adsData || []) as any[]) {
      const d = row.ad_date
      if (!calendar[d]) calendar[d] = { sales: 0, ads: 0, health: 0 }
      calendar[d].ads++
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (healthData || []) as any[]) {
      const d = row.snapshot_date
      if (!calendar[d]) calendar[d] = { sales: 0, ads: 0, health: 0 }
      calendar[d].health++
    }

    return NextResponse.json({ data: calendar, month })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '조회 실패' }, { status: 500 })
  }
}
