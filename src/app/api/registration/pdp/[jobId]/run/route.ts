// POST /api/registration/pdp/[jobId]/run — 상태기계 한 스텝 전진
// analysis → research → design → copywriting → images → compose → done. 프론트가 done/failed까지 재호출.
// maxDuration 120 기준: images 스텝 run 1회 = high 1장 / medium 2장(§9.1 ③).
// 응답은 언랩 형태({ job }) — pdp-client.ts 계약.

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { runPdpStep } from '@/lib/registration/pdp-pipeline'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await requireOwner()
    const { jobId } = await params
    const job = await runPdpStep(jobId, userId)
    return NextResponse.json({ job })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration pdp run POST error:', error)
    const notFound = message.includes('찾을 수 없습니다')
    return NextResponse.json({ error: message }, { status: notFound ? 404 : 500 })
  }
}
