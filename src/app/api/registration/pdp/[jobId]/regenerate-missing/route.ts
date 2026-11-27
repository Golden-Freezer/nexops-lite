import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { assertLocalCodex } from '@/lib/local-codex/guard'
import { regenerateMissingPdpImages } from '@/lib/registration/pdp-image-retry'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/** POST — URL 없는 섹션만 이미지 큐에 되돌리고 기존 HTML을 재합성 대상으로 만든다. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    assertLocalCodex()
    const userId = await requireOwner()
    const { jobId } = await params
    const job = await regenerateMissingPdpImages(createAdminClient(), userId, jobId)
    return NextResponse.json({ job })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration pdp regenerate-missing POST error:', error)
    return NextResponse.json({ error: message }, { status: message.includes('찾을 수 없습니다') ? 404 : 500 })
  }
}
