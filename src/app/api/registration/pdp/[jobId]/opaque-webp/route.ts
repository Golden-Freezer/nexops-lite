// /api/registration/pdp/[jobId]/opaque-webp — 업로드 준비 묶음용 투명도 없는 움직이는 WebP(AX-CT-37).
// POST 본문 = 구운 움직이는 WebP 바이트(image/webp, 4MB 이하) → 같은 프레임·길이·반복의 투명도 없는 판(image/webp).
//   이 사용자의 잡일 때만 받는다. 저장하지 않는다 — 브라우저가 묶음 ZIP 에만 넣는다. 못 바꾸면 422 { error }(부르는 쪽이 원본을 넣고 알린다).

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPdpJob } from '@/lib/registration/pdp-jobs'
import { OPAQUE_WEBP_MAX_BYTES, opaqueAnimatedWebp } from '@/lib/registration/motion/opaque-webp'

export const dynamic = 'force-dynamic'
// 앱 칸 9~16프레임은 수 초, 오너 영상 50프레임도 한 번 펴기라 수 초 — 여유로 60초(검수 S1)
export const maxDuration = 60

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await requireOwner()
    const { jobId } = await params
    const tooBig = `본문이 ${Math.round(OPAQUE_WEBP_MAX_BYTES / 1024 / 1024)}MB 를 넘습니다.`
    if (Number(req.headers.get('content-length') ?? 0) > OPAQUE_WEBP_MAX_BYTES) return bad(tooBig, 413)
    const job = await getPdpJob(createAdminClient(), userId, jobId)
    if (!job) return bad('잡을 찾을 수 없습니다.', 404)
    const bytes = Buffer.from(await req.arrayBuffer())
    if (bytes.length === 0) return bad('WebP 바이트가 필요합니다.')
    if (bytes.length > OPAQUE_WEBP_MAX_BYTES) return bad(tooBig, 413)
    let webp: Buffer
    try {
      webp = await opaqueAnimatedWebp(bytes)
    } catch (e) {
      return bad(e instanceof Error ? e.message : '바꾸지 못했습니다.', 422)
    }
    return new NextResponse(new Uint8Array(webp), {
      status: 200,
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'no-store' },
    })
  } catch (error: unknown) {
    // requireOwner 는 막힐 때 NextResponse 를 던진다(motion-bake 와 같은 꼴)
    if (error instanceof NextResponse) return error
    console.error('registration pdp opaque-webp error:', error)
    return bad(error instanceof Error ? error.message : '서버 오류', 500)
  }
}
