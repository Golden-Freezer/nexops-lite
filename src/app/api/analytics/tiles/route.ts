import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/auth/clerk'
import { requireBusinessId } from '@/lib/auth/business'
import { fetchPnlRows, aggregatePnl, type PnlRawRows } from '@/lib/analytics/pnl-aggregator'
import { estimatePayout } from '@/lib/analytics/payout'
import { kstTodayStr, kstDateStr, monthKey, monthRange } from '@/lib/analytics/date-buckets'
import type { PeriodTile } from '@/lib/analytics/types'

/** rows를 기간으로 잘라낸다 (날짜 문자열 비교) */
function sliceRows(rows: PnlRawRows, start: string, end: string): PnlRawRows {
  return {
    sales: rows.sales.filter((r) => r.order_date >= start && r.order_date <= end),
    ads: rows.ads.filter((r) => r.ad_date >= start && r.ad_date <= end),
    expenses: rows.expenses.filter((r) => r.expense_date >= start && r.expense_date <= end),
    costMap: rows.costMap,
  }
}

/**
 * GET /api/analytics/tiles — 오늘/어제/이번달/지난달 타일 (읽기 전용, 파라미터 없음)
 * 조회는 지난달 1일 ~ 오늘 1회, 기간별 집계는 rows 분할로 수행.
 */
export async function GET() {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (r) { return r as NextResponse }
    let businessId: string
    try { businessId = await requireBusinessId() } catch (r) { return r as Response }

    // KST 기준 4개 기간
    const today = kstTodayStr()
    const yesterday = kstDateStr(-1)
    const mtdStart = `${today.slice(0, 7)}-01`
    // 지난달 키 = 이번 달 1일에서 하루 뺀 날짜의 월 키
    const prevMonthLastDay = new Date(new Date(`${mtdStart}T00:00:00Z`).getTime() - 86400 * 1000)
      .toISOString()
      .slice(0, 10)
    const lastMonth = monthRange(monthKey(prevMonthLastDay))

    const periods: Array<{ key: PeriodTile['key']; label: string; startDate: string; endDate: string }> = [
      { key: 'today', label: '오늘', startDate: today, endDate: today },
      { key: 'yesterday', label: '어제', startDate: yesterday, endDate: yesterday },
      { key: 'mtd', label: '이번 달', startDate: mtdStart, endDate: today },
      { key: 'lastMonth', label: '지난 달', startDate: lastMonth.startDate, endDate: lastMonth.endDate },
    ]

    const supabase = createAdminClient()
    const allRows = await fetchPnlRows(supabase, userId, businessId, lastMonth.startDate, today)

    const tiles: PeriodTile[] = periods.map((p) => {
      const { summary } = aggregatePnl(sliceRows(allRows, p.startDate, p.endDate), p.startDate, p.endDate, 'daily')
      return {
        key: p.key,
        label: p.label,
        startDate: p.startDate,
        endDate: p.endDate,
        revenue: summary.totalRevenue,
        adSpend: summary.totalAdSpend,
        expenses: summary.totalExpenses,
        margin: summary.totalMargin,
        netProfit: summary.netProfit,
        marginRate: summary.totalRevenue > 0 ? (summary.totalMargin / summary.totalRevenue) * 100 : 0,
        estimatedPayout: estimatePayout(summary),
      }
    })

    return NextResponse.json({ data: { tiles } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '기간 타일 집계 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
