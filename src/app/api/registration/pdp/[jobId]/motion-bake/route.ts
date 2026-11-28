// /api/registration/pdp/[jobId]/motion-bake — 첫 칸 글 굽기(세션 B, 통합 2026-11-06 지시).
// POST { webpUrl, overlay, still }  (overlay = 글 층 PNG base64, still = 정지 칸 그림 base64)
//   → 이 사용자·이 잡의 section_images[].motion.webpUrl 가운데 하나만 받아(임의 URL 받기 차단) 서버 sharp로 프레임마다 글을 굽는다.
//   ok면 image/webp 바이트(저장하지 않는다 — 브라우저가 detail-images prepare/commit으로 올린다), 못 구우면 200 { skip: 까닭 }
//   (부르는 쪽이 지금처럼 포스터 JPEG를 둔다). 칸 예산은 motion/stage cellMaxBytesOf — 대표 칸 hero_motion 0.7MB(결정 카드 c13), 계획 기록에서
//   사용 동작(use)으로 고른 칸 1.5MB(오너 decide 35·J55), 그 밖 0.7MB.

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPdpJob } from '@/lib/registration/pdp-jobs'
import { HERO_MOTION_SECTION } from '@/lib/registration/motion/pick'
import { motionPlanOf } from '@/lib/registration/motion/task'
import { cellMaxBytesOf } from '@/lib/registration/motion/stage'
import { bakeTextOnMotion, MOTION_BAKE_BODY_MAX } from '@/lib/registration/motion/text-bake'

export const dynamic = 'force-dynamic'

/** 저장된 움직이는 WebP 받기 상한 */
const WEBP_FETCH_MS = 20_000
const WEBP_MAX_BYTES = 5 * 1024 * 1024

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/
const decode = (value: unknown): Buffer | null => (typeof value === 'string' && value.length > 0 && BASE64_RE.test(value) ? Buffer.from(value, 'base64') : null)

async function fetchWebp(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(WEBP_FETCH_MS) })
  if (!res.ok) throw new Error(`움직이는 WebP 받기 HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > WEBP_MAX_BYTES) throw new Error('움직이는 WebP가 너무 큼')
  return bytes
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await requireOwner()
    const { jobId } = await params
    const length = Number(req.headers.get('content-length') ?? 0)
    if (length > MOTION_BAKE_BODY_MAX) return bad(`본문이 ${Math.round(MOTION_BAKE_BODY_MAX / 1024)}KB를 넘습니다.`, 413)
    const db = createAdminClient()
    const job = await getPdpJob(db, userId, jobId)
    if (!job) return bad('잡을 찾을 수 없습니다.', 404)

    const raw = await req.text()
    if (raw.length > MOTION_BAKE_BODY_MAX) return bad(`본문이 ${Math.round(MOTION_BAKE_BODY_MAX / 1024)}KB를 넘습니다.`, 413)
    const body = (() => {
      try {
        return JSON.parse(raw) as { webpUrl?: unknown; overlay?: unknown; still?: unknown }
      } catch {
        return null
      }
    })()
    const overlay = decode(body?.overlay)
    const still = decode(body?.still)
    if (!body || typeof body.webpUrl !== 'string' || !overlay || !still) return bad('webpUrl·overlay·still이 필요합니다(overlay·still은 base64).')
    // 이 잡이 만든 움직이는 칸만 — 임의 URL을 서버가 받지 않는다
    const entry = (job.section_images ?? []).find((e) => e.motion?.status === 'ok' && e.motion.webpUrl === body.webpUrl)
    if (!entry) return bad('이 잡의 움직이는 칸이 아닙니다.', 400)

    const result = await bakeTextOnMotion({
      webp: await fetchWebp(body.webpUrl),
      overlay,
      still,
      maxBytes: cellMaxBytesOf({
        role: entry.section === HERO_MOTION_SECTION ? 'hero' : undefined,
        // 사용 동작으로 고른 칸 — 계획 기록(templatelib.motion.cells)의 같은 키가 use일 때만(J55). 고른 칸의 섹션 키는 컷 키다
        ...(motionPlanOf(job)?.cells.some((cell) => cell.key === entry.section && cell.kind === 'use') ? { useCell: true as const } : {}),
      }),
    })
    if (result.status === 'skip') return NextResponse.json({ skip: result.reason, steps: result.steps })
    return new NextResponse(new Uint8Array(result.webp), {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'no-store',
        'X-Motion-Bake': encodeURIComponent(`q${result.quality} ${result.frames}f ${Math.round(result.bytes / 1024)}KB 거리 ${result.distance ?? '-'}`),
      },
    })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration pdp motion-bake error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
