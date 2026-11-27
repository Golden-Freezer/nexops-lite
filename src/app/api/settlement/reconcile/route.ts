// /app/api/settlement/reconcile/route.ts
// 대조 조회 — 쿠팡 확정 정산(coupang_settlement_reports) + 같은 기간 우리 P&L 집계
// + 같은 정산일 창의 실제 계좌입금(coupang_wallet_events)을 조립해 반환한다.
// 조회·조립 로직은 lib/settlement/reconcile-query.ts에 격리(analyze 라우트와 공유).

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/auth/clerk'
import { requireOwnedBusinessId } from '@/lib/auth/business'
import { fetchReconciliationRows } from '@/lib/settlement/reconcile-query'

/** GET /api/settlement/reconcile?businessId&groupKey - 정산 대조 데이터 (읽기 전용) */
export async function GET(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (r) { return r as NextResponse }
    // 신규 테이블이 database.ts(자동 생성 타입)에 아직 없어 pnl/report 라우트 선례대로 캐스팅한다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const { searchParams } = new URL(request.url)

    let businessId: string
    try { businessId = await requireOwnedBusinessId(userId) } catch (response) { return response as NextResponse }
    const requestedBusinessId = searchParams.get('businessId')
    if (requestedBusinessId && requestedBusinessId !== businessId) {
      return NextResponse.json({ error: '선택한 사업장과 요청 사업장이 일치하지 않습니다.' }, { status: 403 })
    }

    const rows = await fetchReconciliationRows(supabase, userId, {
      businessId,
      groupKey: searchParams.get('groupKey'),
    })

    return NextResponse.json({ data: rows })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '정산 대조 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
