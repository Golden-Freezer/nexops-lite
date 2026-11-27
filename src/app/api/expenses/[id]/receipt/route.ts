import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/auth/clerk'
import { getBusinessId } from '@/lib/auth/business'
import { getExpenseReceiptUrl } from '@/lib/supabase/storage'

/** GET /api/expenses/[id]/receipt — 지출 증빙 signed URL 발급 (1시간, audit §5-3) */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (r) { return r as NextResponse }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const businessId = await getBusinessId()
    const { id } = await params

    let query = supabase
      .from('expenses')
      .select('receipt_path')
      .eq('id', id)
      .eq('user_id', userId)
    query = businessId
      ? query.eq('business_id', businessId)
      : query.is('business_id', null)

    const { data, error } = await query.single()
    if (error || !data) {
      return NextResponse.json({ error: '해당 지출 내역을 찾을 수 없습니다.' }, { status: 404 })
    }
    if (!data.receipt_path) {
      return NextResponse.json({ error: '첨부된 증빙 파일이 없습니다.' }, { status: 404 })
    }

    const url = await getExpenseReceiptUrl(supabase, data.receipt_path, 60 * 60)
    return NextResponse.json({ data: { url } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '증빙 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
