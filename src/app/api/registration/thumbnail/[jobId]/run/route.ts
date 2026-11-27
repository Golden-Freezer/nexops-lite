// POST /api/registration/thumbnail/[jobId]/run — 상태기계 한 스텝 전진
// 분석 → cutout → studio → usage → 게이트(+재생성/재판정). 프론트가 done/failed까지 재호출.
// maxDuration 120 기준: run 1회 = 이미지 최대 1장(gpt-image-2 high ~70s 실측, §9.1).

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { runThumbnailStep } from '@/lib/registration/thumbnail-pipeline'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await requireOwner()
    const { jobId } = await params
    const job = await runThumbnailStep(createAdminClient(), userId, jobId)
    if (!job) return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 })
    return NextResponse.json({ data: job })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration thumbnail run POST error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
