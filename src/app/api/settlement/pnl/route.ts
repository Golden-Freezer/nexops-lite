import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/auth/clerk'
import { requireOwnedBusinessId } from '@/lib/auth/business'
import { aggregatePnl, fetchPnlRows } from '@/lib/analytics/pnl-aggregator'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** GET /api/settlement/pnl - 기간별 자동 P&L 집계 */
export async function GET(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (response) { return response as NextResponse }

    let businessId: string
    try { businessId = await requireOwnedBusinessId(userId) } catch (response) { return response as NextResponse }

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    if (!startDate || !endDate || !DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate)) {
      return NextResponse.json(
        { error: 'startDate와 endDate를 YYYY-MM-DD 형식으로 입력해주세요.' },
        { status: 400 }
      )
    }
    if (startDate > endDate) {
      return NextResponse.json({ error: '시작일은 종료일보다 늦을 수 없습니다.' }, { status: 400 })
    }

    // 조회·집계를 분석 화면과 같은 정본에 위임한다. 모든 원장은 fetchAllRows로
    // 끝까지 읽고, 판매 시점 unit_cost를 우선해 과거 손익이 현재 평균원가 변경으로
    // 소급 변동하지 않게 한다.
    // database.ts보다 운영 DB가 앞선 컬럼을 포함하므로 기존 라우트와 동일하게 캐스팅한다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const rows = await fetchPnlRows(supabase, userId, businessId, startDate, endDate)
    const { summary, buckets } = aggregatePnl(rows, startDate, endDate, 'daily')

    const daily = buckets.map(({ bucket, ...values }) => ({ date: bucket, ...values }))

    return NextResponse.json({
      data: {
        summary,
        daily,
        period: { startDate, endDate },
        counts: {
          salesRows: rows.sales.length,
          adRows: rows.ads.length,
          expenseRows: rows.expenses.length,
        },
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'P&L 집계 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
