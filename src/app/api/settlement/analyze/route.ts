// GET /api/settlement/analyze?groupKey=...&force=true
// 규칙 대조표(ReconciliationRow) 위에 LLM 차액 귀속 해설을 얹는다. 대조표가 절대 진실이며,
// 해설은 표현 보강일 뿐이다. LLM/키/한도 실패는 오류가 아니라 폴백(analysis:null, fallback:true,
// 200) — UI가 대조표만 안내한다. (ads-insight coaching 라우트와 동일 계약)
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/clerk'
import { requireOwnedBusinessId } from '@/lib/auth/business'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchReconciliationRows } from '@/lib/settlement/reconcile-query'
import type { ReconciliationRow, SettlementAnalyzeInput } from '@/types/settlement-recon'

// callAgent 최악 케이스가 Vercel 기본 함수 한도보다 길어질 수 있어(coaching 라우트와 동일 근거)
// 여유를 둔다. analyzer-agent 자체는 1회 시도로 짧게 잡는다.
export const maxDuration = 60

/** 대조 행에서 사람이 읽는 정산주기 라벨을 구성한다(우선순위: 기간 → cycle). */
function buildPeriodLabel(row: ReconciliationRow): string {
  if (row.periodStart && row.periodEnd) {
    return `${row.periodStart.slice(0, 10)} ~ ${row.periodEnd.slice(0, 10)}`
  }
  return row.cycle ?? row.settlementGroupKey
}

export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuth()
    // 헤더 없으면 전 사업장 병합 조회가 되므로 필수화(coaching 라우트와 동일 근거)
    const businessId = await requireOwnedBusinessId(userId)
    const groupKey = req.nextUrl.searchParams.get('groupKey')
    if (!groupKey) {
      return NextResponse.json({ error: 'groupKey는 필수입니다.' }, { status: 400 })
    }
    // TODO(캐시): coaching 라우트의 JSONB 스냅샷 캐시(inputHash+force) 패턴을 정산에도 이식할
    // 테이블이 아직 없다(범위 밖 — DESIGN.md §검증 게이트). 1차 구현은 매 요청 LLM 호출.
    // force 파라미터는 골격만 남겨 캐시 도입 시 바로 배선 가능하게 한다.
    const force = req.nextUrl.searchParams.get('force') === 'true'
    void force

    // 신규 테이블이 database.ts에 아직 없어 pnl/report 라우트 선례대로 캐스팅한다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any
    const rows = await fetchReconciliationRows(db, userId, { businessId, groupKey })
    const row = rows[0]
    if (!row) {
      return NextResponse.json({ error: '대조할 정산 데이터가 없습니다.' }, { status: 404 })
    }

    const input: SettlementAnalyzeInput = {
      cycle: row.cycle,
      periodLabel: buildPeriodLabel(row),
      coupangFinalPayout: row.coupangFinalPayout,
      ourEstimatedPayout: row.ourEstimatedPayout,
      actualDeposit: row.actualDeposit,
      totalDiff: row.totalDiff,
      lines: row.lines,
    }

    // 키 미설정은 정상 폴백. analyzer-agent(→ Anthropic 클라이언트 생성)를 로드하지 않아
    // 모듈 평가 예외를 피한다(coaching 라우트와 동일 근거).
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({
        data: {
          analysis: null,
          reconciliation: row,
          fallback: true,
          reason: 'AI 해설 비활성 — API 키가 설정되지 않았습니다.',
        },
      })
    }

    // 키가 있을 때만 동적 로드. callAgent가 재시도 후에도 실패하면 success:false → 폴백.
    const { analyzeSettlement } = await import('@/lib/agents/settlement/analyzer-agent')
    const result = await analyzeSettlement(input)

    if (result.success && result.data && (result.data.headline || result.data.summary)) {
      return NextResponse.json({
        data: { analysis: result.data, reconciliation: row, fallback: false },
      })
    }
    return NextResponse.json({
      data: {
        analysis: null,
        reconciliation: row,
        fallback: true,
        reason: 'AI 해설 생성에 실패했습니다. 대조표를 참고하세요.',
      },
    })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('settlement analyze GET error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
