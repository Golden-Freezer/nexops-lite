// /api/registration/pdp/[jobId] — 잡 상태·결과 조회 / 삭제 (user_id 격리)
// 응답은 언랩 형태({ job }/{ ok }) — pdp-client.ts 계약.

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { deletePdpJob, getPdpJob } from '@/lib/registration/pdp-jobs'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await requireOwner()
    const { jobId } = await params
    const job = await getPdpJob(createAdminClient(), userId, jobId)
    if (!job) return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 })
    return NextResponse.json({ job })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration pdp job GET error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await requireOwner()
    const { jobId } = await params
    const db = createAdminClient()
    const job = await getPdpJob(db, userId, jobId)
    if (!job) return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 })
    await deletePdpJob(db, userId, jobId)
    return NextResponse.json({ ok: true })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration pdp job DELETE error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
