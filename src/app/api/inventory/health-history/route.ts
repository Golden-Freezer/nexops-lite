import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/auth/clerk'
import { getBusinessId } from '@/lib/auth/business'

/** GET /api/inventory/health-history?productId=xxx&limit=30 */
export async function GET(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (r) { return r as NextResponse }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const businessId = await getBusinessId()

    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('productId')
    const limit = Number(searchParams.get('limit') || 30)

    let query = supabase
      .from('inventory_health_history')
      .select('id, product_id, sku, coupang_stock, storage_fee_monthly, health_grade, snapshot_date, created_at')
      .eq('user_id', userId)
      .order('snapshot_date', { ascending: false })
      .limit(limit)

    if (businessId) query = query.eq('business_id', businessId)
    if (productId) query = query.eq('product_id', productId)

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data: data || [] })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '조회 실패' }, { status: 500 })
  }
}
