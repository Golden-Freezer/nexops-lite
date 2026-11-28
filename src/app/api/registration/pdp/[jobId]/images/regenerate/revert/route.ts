// POST /api/registration/pdp/[jobId]/images/regenerate/revert — 편집기 재생성 직전 컷으로 되돌리기(P1-4, 유료 0)
// 본문 { section }. done 기록의 url·장식·비율을 바뀌기 전 것과 맞바꾼다(다시 부르면 되돌림 취소 — revertEditorRegen).
// 단계는 바꾸지 않는다(생성 없음). 편집기는 받은 잡의 기록으로 캔버스 src를 바꾼다(regenTarget pendingApplies — 바뀌기 전 url 자리).
// 막히면 409 { error, code }: busy(다른 곳 진행 중)·already_pending(그 컷 재생성 중)·not_revertible(되돌릴 컷 없음)

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPdpJob, updatePdpJobIfUnchanged } from '@/lib/registration/pdp-jobs'
import { planEditorRegen } from '@/lib/registration/pdp-image-regen-request'
import { parseRegenRequest, revertEditorRegen, type RegenRevertResponse } from '@/lib/registration/pdp-image-regen'

export const dynamic = 'force-dynamic'

const conflict = (error: string, code: string) => NextResponse.json({ error, code }, { status: 409 })

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await requireOwner()
    const { jobId } = await params
    const parsed = parseRegenRequest(await req.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const section = parsed.value.section
    const db = createAdminClient()
    const job = await getPdpJob(db, userId, jobId)
    if (!job) return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 })
    // 진행 잠금·대기는 재생성 요청과 같은 판정(다른 이미지 일·예산은 생성이 없어 보지 않는다)
    const plan = planEditorRegen(job, { section })
    if (plan.ok && plan.block && (plan.block.code === 'busy' || plan.block.code === 'already_pending')) {
      return conflict(plan.block.error, plan.block.code)
    }
    const nowIso = new Date().toISOString()
    const entry = job.section_images.find((e) => e.section === section)
    const reverted = entry ? revertEditorRegen(entry, nowIso) : null
    if (!reverted) return conflict('되돌릴 직전 컷이 없습니다.', 'not_revertible')
    const updated = await updatePdpJobIfUnchanged(db, userId, job, {
      sectionImages: job.section_images.map((e) => (e.section === section ? reverted : e)),
    })
    if (!updated) return conflict('이 잡을 다른 곳이 진행 중입니다. 잠시 뒤 다시 시도해 주세요.', 'busy')
    const res: RegenRevertResponse = { job: updated, section }
    return NextResponse.json(res)
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration pdp image regenerate revert POST error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
