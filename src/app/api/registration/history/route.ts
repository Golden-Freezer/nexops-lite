// /api/registration/history — 생성 히스토리(대표이미지 잡 + 상세페이지 잡) 한 페이지
// GET ?before=<created_at>&limit=20&track=standard|internalized → { entries, nextBefore, businesses }
//
// 오너 전용·읽기 전용. 두 잡 표를 같은 커서로 limit+1개씩 읽어 생성 시각 하나로 합친다(mergeHistoryPage).
// track을 고르면 상세페이지 잡만 그 트랙으로 서버에서 거르고 대표이미지 잡은 싣지 않는다(트랙 무관).

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { listThumbnailJobs } from '@/lib/registration/jobs'
import { listPdpJobs } from '@/lib/registration/pdp-jobs'
import { isGenerationTrack } from '@/lib/registration/pdp-state'
import { clampHistoryLimit, mergeHistoryPage, parseHistoryCursor } from '@/lib/registration/history'
import { listOwnedBusinesses } from '@/lib/sourcing/registration/businesses'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const userId = await requireOwner()
    const db = createAdminClient()
    const params = req.nextUrl.searchParams
    const limit = clampHistoryLimit(params.get('limit'))
    const before = parseHistoryCursor(params.get('before'))
    const trackParam = params.get('track')
    const track = isGenerationTrack(trackParam) ? trackParam : null

    const [thumbnails, pdps, businesses] = await Promise.all([
      track ? Promise.resolve([]) : listThumbnailJobs(db, userId, limit + 1, before),
      listPdpJobs(db, userId, limit + 1, { before, track }),
      listOwnedBusinesses(db, userId),
    ])
    const page = mergeHistoryPage(thumbnails, pdps, limit)
    return NextResponse.json({
      data: { ...page, businesses: businesses.map((b) => ({ id: b.id, name: b.name })) },
    })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration history GET error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
