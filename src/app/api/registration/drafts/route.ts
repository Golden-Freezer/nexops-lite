// /api/registration/drafts — 등록 대기 목록(상품등록 첫 화면)
// GET ?page=1&status=draft|ready → { items, total, page, pageSize }
//
// 오너 전용·읽기 전용. 등록 임시저장(sourcing_registration_drafts)을 user_id로만 읽고(listDrafts),
// 사업장 이름은 오너 본인 사업장 목록으로 붙인다. 쿠팡·운영 테이블 미접촉.

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { listDrafts } from '@/lib/sourcing/registration/drafts'
import { listOwnedBusinesses } from '@/lib/sourcing/registration/businesses'
import {
  DRAFT_PAGE_SIZE,
  parseDraftPage,
  parseDraftStatus,
  toDraftListItem,
  type DraftListPage,
} from '@/lib/registration/draft-list'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const userId = await requireOwner()
    const db = createAdminClient()
    const page = parseDraftPage(req.nextUrl.searchParams.get('page'))
    const status = parseDraftStatus(req.nextUrl.searchParams.get('status'))

    const [{ drafts, total }, businesses] = await Promise.all([
      listDrafts(db, userId, { limit: DRAFT_PAGE_SIZE, offset: (page - 1) * DRAFT_PAGE_SIZE, status }),
      listOwnedBusinesses(db, userId),
    ])
    const names = new Map(businesses.map((b) => [b.id, b.name]))
    const body: DraftListPage = {
      items: drafts.map((d) => toDraftListItem(d, names)),
      total,
      page,
      pageSize: DRAFT_PAGE_SIZE,
    }
    return NextResponse.json({ data: body })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration drafts GET error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
