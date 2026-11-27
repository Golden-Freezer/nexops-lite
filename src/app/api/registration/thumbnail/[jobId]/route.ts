// /api/registration/thumbnail/[jobId] — 잡 폴링·컷 채택·삭제
// GET: { status, progress, cuts, visionAnalysis, error, costUsd } (2초 폴링 대상)
// PATCH: { selectedCut } — 채택 시 연결 드래프트 form.content.heroImages[0]에 URL 반영
// DELETE: 잡 삭제 (user_id 필터 강제)

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { getThumbnailJob, updateThumbnailJob, deleteThumbnailJob } from '@/lib/registration/jobs'
import { THUMBNAIL_CUTS, type ThumbnailCut } from '@/lib/registration/thumbnail-types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ jobId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const userId = await requireOwner()
    const { jobId } = await params
    const job = await getThumbnailJob(createAdminClient(), userId, jobId)
    if (!job) return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 })
    return NextResponse.json({ data: job })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration thumbnail job GET error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const userId = await requireOwner()
    const { jobId } = await params
    const body = (await req.json()) as { selectedCut?: string }
    const selectedCut = body.selectedCut as ThumbnailCut
    if (!THUMBNAIL_CUTS.includes(selectedCut)) {
      return NextResponse.json({ error: '유효하지 않은 컷입니다.' }, { status: 400 })
    }

    const db = createAdminClient()
    const job = await getThumbnailJob(db, userId, jobId)
    if (!job) return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 })
    const url = job.cuts[selectedCut]?.url
    if (!url) {
      return NextResponse.json({ error: '해당 컷의 이미지가 없습니다.' }, { status: 400 })
    }

    const updated = await updateThumbnailJob(db, userId, jobId, { selectedCut })


    return NextResponse.json({ data: updated })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration thumbnail job PATCH error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const userId = await requireOwner()
    const { jobId } = await params
    await deleteThumbnailJob(createAdminClient(), userId, jobId)
    return NextResponse.json({ data: { ok: true } })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration thumbnail job DELETE error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
