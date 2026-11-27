import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/auth/clerk'
import { requireBusinessId } from '@/lib/auth/business'
import { fetchPnlRows, aggregatePnl } from '@/lib/analytics/pnl-aggregator'
import type { Granularity } from '@/lib/analytics/types'

/**
 * GET /api/analytics/pnl — granularity별 P&L 집계 (읽기 전용)
 *
 * 쿼리 파라미터:
 *   startDate, endDate — 필수 (YYYY-MM-DD)
 *   granularity — 'daily' | 'weekly' | 'monthly' (기본 daily)
 */
export async function GET(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (r) { return r as NextResponse }
    let businessId: string
    try { businessId = await requireBusinessId() } catch (r) { return r as Response }

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const granularity = searchParams.get('granularity') || 'daily'

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'startDate, endDate가 필요합니다.' }, { status: 400 })
    }
    if (granularity !== 'daily' && granularity !== 'weekly' && granularity !== 'monthly') {
      return NextResponse.json({ error: 'granularity는 daily|weekly|monthly 중 하나여야 합니다.' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const rows = await fetchPnlRows(supabase, userId, businessId, startDate, endDate)
    const { summary, buckets } = aggregatePnl(rows, startDate, endDate, granularity as Granularity)

    return NextResponse.json({
      data: { summary, buckets, granularity, period: { startDate, endDate } },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '집계 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
