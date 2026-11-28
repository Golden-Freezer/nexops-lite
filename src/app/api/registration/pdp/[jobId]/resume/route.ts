// POST /api/registration/pdp/[jobId]/resume — 구독 멈춤 표지 잡의 '이어 하기'(AX-CT-29)
// 멈춤 기록(section_plan.subscription_halt)·error를 지우고, 실패(failed)한 잡이면 다시 돌릴 단계로 되돌린다(resolveStepToRun — 산출물 기준).
// 저장되면 구독 작업자 큐가 이 잡을 다시 집는다(웹은 stop 잡을 진행하지 않는다 — run 라우트). 단계 되돌리기·작업자 넘기기는 이 한 곳뿐이다.
// 구독 멈춤 표지 잡만 받는다(400). 끝난(done) 잡은 다시 돌릴 단계가 없어 400(지금 화면에도 끝난 잡 다시 돌리기 단추는 없다).
// 읽은 뒤 바뀌었으면(그사이 작업자 저장) 조건부 갱신이 0행이라 409로 돌려준다 — 화면이 잡을 다시 읽는다.
// 응답은 언랩 형태({ job }) — pdp-client.ts 계약.

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPdpJob, isPdpJobLeased, updatePdpJobIfUnchanged } from '@/lib/registration/pdp-jobs'
import { resolveStepToRun } from '@/lib/registration/pdp-pipeline'
import { recordSubscriptionResumeRun, subscriptionResumePatch } from '@/lib/registration/pdp-subscription'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await requireOwner()
    const { jobId } = await params
    const db = createAdminClient()
    const job = await getPdpJob(db, userId, jobId)
    if (!job) return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 })
    if (job.model_backend !== 'subscription' || !job.subscription_stop) {
      return NextResponse.json({ error: '구독 멈춤 표지 잡만 이어 할 수 있습니다.', job }, { status: 400 })
    }
    if (job.current_step === 'done') {
      return NextResponse.json({ error: '이미 끝난 잡이라 이어 할 단계가 없습니다.', job }, { status: 400 })
    }
    const halt = job.section_plan.subscription_halt
    if (job.current_step !== 'failed' && !halt) {
      // 멈춘 적도 실패한 적도 없는 진행 중 잡 — 작업자가 진행하고 있다
      return NextResponse.json({ error: '작업자가 진행 중인 잡입니다. 멈춘 뒤에 이어 하세요.', job }, { status: 409 })
    }
    if (isPdpJobLeased(job)) {
      return NextResponse.json({ error: '다른 곳이 이 잡을 진행 중입니다. 잠시 뒤 다시 시도하세요.', job }, { status: 409 })
    }
    const step = resolveStepToRun(job)
    if (step === 'done') {
      return NextResponse.json({ error: '이어 할 단계가 없습니다(산출물이 모두 있습니다).', job }, { status: 400 })
    }
    const saved = await updatePdpJobIfUnchanged(db, userId, job, subscriptionResumePatch(job, step))
    if (!saved) {
      return NextResponse.json({ error: '그사이 잡이 바뀌었습니다. 화면을 새로 고친 뒤 다시 시도하세요.', job: (await getPdpJob(db, userId, jobId)) ?? job }, { status: 409 })
    }
    // 멈춤 사건을 닫는 ok 줄 — 멈춤 기록이 있던 잡만(실패만 한 잡은 멈춤 사건이 없다)
    if (halt) await recordSubscriptionResumeRun(db, userId, jobId, halt)
    return NextResponse.json({ job: saved })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration pdp resume POST error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
