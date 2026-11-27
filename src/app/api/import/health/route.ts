// GET /api/import/health — 오너 전용. 최근 N일(오늘 제외) 사업장별 판매·광고 임포트 결손 요약.
// 위젯(넥시)이 폴링해 "광고 임포트 밀림 / 광고 포털 로그인 필요" 알림을 띄운다.
// 읽기 전용. 쿠팡 세션 만료 자체는 서버가 알 수 없으므로(브라우저 상태) 결손 날짜만 돌려주고,
// UI가 "광고가 밀렸다 → 광고 포털 로그인 확인" 문구를 유도한다.
// 인증은 ai-staff 라우트가 확립한 Clerk 세션 OR Bearer 개인토큰 이중 경로를 그대로 쓴다.

import { NextRequest, NextResponse } from 'next/server'
import { bearerCorsPreflight, withBearerCors } from '@/lib/auth/bearer-cors'
import { requireOwnerRequest } from '@/lib/auth/owner-api-token'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeImportHealth } from '@/lib/import/health'

export function OPTIONS() {
  return bearerCorsPreflight()
}

export async function GET(req: NextRequest) {
  try {
    const userId = await requireOwnerRequest(req)
    const supabase = createAdminClient()
    const daysRaw = Number(new URL(req.url).searchParams.get('days') ?? 5)
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(1, Math.floor(daysRaw)), 30) : 5
    const report = await computeImportHealth(supabase, userId, days)
    return withBearerCors(req, NextResponse.json({ data: report }))
  } catch (error: unknown) {
    if (error instanceof NextResponse) return withBearerCors(req, error)
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('import/health GET error:', error)
    return withBearerCors(req, NextResponse.json({ error: message }, { status: 500 }))
  }
}
