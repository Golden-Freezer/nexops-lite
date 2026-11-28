// POST /api/registration/pdp/[jobId]/run — 상태기계 한 스텝 전진
// analysis → research → design → copywriting → images → compose → done. 프론트가 done/failed까지 재호출.
// maxDuration 300(속도 개선 1차 — cron/coupang-sync와 같은 상한): images 스텝 run 1회가 hero 뒤 동시 4장씩, 최악 소요가
// 시간 예산 280초 안에 들 때만 새 컷을 시작한다(pdp-image-stage RUN_TIME_BUDGET_MS·GENERATION_WORST_MS).
// 응답은 언랩 형태({ job, busy? }) — pdp-client.ts 계약. busy: 다른 곳(탭·작업자)이 이 잡을 진행 중이라 이번 호출은 아무것도
// 하지 않았다(잡 진행 잠금) — 화면은 잠시 뒤 다시 부른다.
// 라이트는 로컬 Next 개발 서버가 Codex CLI를 직접 실행하므로 codex-image 잡도 이 경로에서 진행한다.
// 구독 표지 잡(R13)은 Railway 구독 작업자가 진행한다 — 작업자가 살아 있으면 아무것도 하지 않고 busy(+worker)로 돌려주고, 5분 동안 아무도
// 저장하지 않았으면 표지를 API로 바꾸고 웹이 이어서 진행한다(pdp-subscription webRunTurn). 화면은 busy를 잠금과 같이 기다린다.
// 구독 멈춤 표지 잡(AX-CT-29)은 웹이 절대 진행하지 않는다(runPdpStep·takeOver 없음) — 읽기만: 멈춤 기록이 있으면 { job, halted: true },
// 진행 중이면 작업자 생존(잠금·5분 안 저장·같은 사용자의 다른 구독 잡)을 보고 기다리거나 멈춤을 기록하고, done·failed면 { job }만 돌려준다.

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPdpJob, isPdpJobLeased } from '@/lib/registration/pdp-jobs'
import { runPdpStep } from '@/lib/registration/pdp-pipeline'
import {
  haltForSubscription,
  listOtherSubscriptionJobs,
  takeOverFromWorker,
  webRunTurn,
  WORKER_STALE_MS,
} from '@/lib/registration/pdp-subscription'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await requireOwner()
    const { jobId } = await params
    const db = createAdminClient()
    const current = await getPdpJob(db, userId, jobId)
    if (current) {
      // 구독 멈춤 표지 잡의 작업자 생존 판정 재료 — 이 잡이 조용할 때만 다른 구독 잡을 읽는다(읽기 실패는 작업자가 살아 있는 것으로 본다)
      let others: Awaited<ReturnType<typeof listOtherSubscriptionJobs>> = []
      if (current.subscription_stop && webRunTurn(current) === 'halt') {
        try {
          others = await listOtherSubscriptionJobs(db, userId, jobId)
        } catch (e) {
          console.warn('[registration/pdp] 작업자 생존 판정 재료 읽기 실패 — 기다립니다', e instanceof Error ? e.message : e)
          return NextResponse.json({ job: current, busy: true, worker: true })
        }
      }
      const turn = webRunTurn(current, Date.now(), others)
      if (turn === 'halted') return NextResponse.json({ job: current, halted: true })
      if (turn === 'read') return NextResponse.json({ job: current })
      if (turn === 'halt') {
        const halted = await haltForSubscription(
          db,
          userId,
          current,
          'worker_stale',
          `구독 작업자가 ${Math.round(WORKER_STALE_MS / 60_000)}분 넘게 이 잡을 저장하지 않았습니다`
        )
        // 그사이 작업자가 저장했으면(조건부 갱신 0행) 멈추지 않고 기다린다
        if (!halted) return NextResponse.json({ job: (await getPdpJob(db, userId, jobId)) ?? current, busy: true, worker: true })
        return NextResponse.json({ job: halted, halted: true })
      }
      if (turn === 'worker') return NextResponse.json({ job: current, busy: true, worker: true })
      if (turn === 'takeover') {
        const taken = await takeOverFromWorker(db, userId, current)
        if (!taken) return NextResponse.json({ job: (await getPdpJob(db, userId, jobId)) ?? current, busy: true, worker: true })
      }
    }
    const job = await runPdpStep(jobId, userId)
    return NextResponse.json({ job, ...(isPdpJobLeased(job) ? { busy: true } : {}) })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration pdp run POST error:', error)
    const notFound = message.includes('찾을 수 없습니다')
    return NextResponse.json({ error: message }, { status: notFound ? 404 : 500 })
  }
}
