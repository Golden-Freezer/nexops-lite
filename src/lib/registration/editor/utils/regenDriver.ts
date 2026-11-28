/**
 * 재생성 요청 뒤 진행(묶음 5 ③) — 의존성을 주입받는 순수 루프라 시험에서 가짜 API로 돌린다.
 * runner 'web': 기존 run 라우트를 반복 호출한다(PdpProgress와 같은 busy 대기·정체 감지). 'local'(codex-image): 로컬 실행기가
 * 진행하므로 잡을 일정 간격으로 읽기만 한다. 끝은 그 섹션 editorRegen.status(이 요청의 requestedAt)로 판단한다.
 * 상한에 닿거나 멈추면 'waiting'으로 돌려준다 — 기록은 서버에 남아 있어 편집기를 다시 열면 결과를 이어서 반영한다.
 * 401(탭이 뒤에 있던 사이 낡은 세션 토큰)은 진행 화면과 같은 규칙으로 토큰을 새로 받아 다시 보낸다(R12a, pdp-run-driver withAuthRetry).
 * 연속 401이 상한을 넘으면 지금처럼 오류로 던진다(창이 사유를 띄운다).
 * 구독 작업자 잡(R13)의 run은 작업자가 진행하는 동안 busy + worker를 돌려준다 — 진행 화면과 같은 규칙으로 잠금 busy 상한(20×3초)에
 * 세지 않고 기다린다(R13c, pdp-run-driver createWorkerWait). 그 상한(updated_at 15분 그대로·전체 60분)에 닿으면 'waiting'이다.
 */

import type { RegenRunner } from '@/lib/registration/pdp-image-regen'
import type { PdpJobRow } from '@/lib/registration/pdp-state'
import type { RegenApi } from '../services/regenApi'
import { WORKER_WAIT_LIMITS, createWorkerWait, withAuthRetry, type AuthRetryDeps } from '@/lib/registration/pdp-run-driver'
import { regenStateOf, type RegenState } from './regenTarget'

export type DriveOutcome = Exclude<RegenState, { state: 'pending' }> | { state: 'waiting'; reason: string } | { state: 'stopped' }

export interface DriveDeps {
  api: Pick<RegenApi, 'getJob' | 'runOnce'>
  sleep: (ms: number) => Promise<void>
  /** 모달이 닫히면 false — 더 부르지 않는다 */
  alive: () => boolean
  onJob?: (job: PdpJobRow) => void
  /** 401이면 새 세션 토큰을 받는다(Clerk getToken skipCache) — 없으면 토큰 없이 쉬었다 다시 보낸다(쿠키는 Clerk가 새로 고친다) */
  refreshToken?: () => Promise<string | null>
}

export const DRIVE_LIMITS = { maxRuns: 30, maxBusyWaits: 20, busyMs: 3000, maxStalls: 2, pollMs: 5000, maxPolls: 120, worker: WORKER_WAIT_LIMITS }

function settled(job: PdpJobRow, section: string, requestedAt: string): DriveOutcome | null {
  const s = regenStateOf(job.section_images, section, requestedAt)
  if (s && s.state !== 'pending') return s
  if (job.current_step === 'failed') return { state: 'failed', message: job.error || '잡이 실패로 멈췄습니다.' }
  return null
}

export async function driveRegen(
  jobId: string,
  section: string,
  requestedAt: string,
  runner: RegenRunner,
  deps: DriveDeps,
  limits = DRIVE_LIMITS,
): Promise<DriveOutcome> {
  const auth: AuthRetryDeps = { refreshToken: deps.refreshToken ?? (async () => null), sleep: deps.sleep, alive: deps.alive }
  if (runner === 'local') {
    for (let i = 0; i < limits.maxPolls && deps.alive(); i++) {
      await deps.sleep(limits.pollMs)
      if (!deps.alive()) break
      const job = await withAuthRetry((token) => deps.api.getJob(jobId, token), auth)
      deps.onJob?.(job)
      const out = settled(job, section, requestedAt)
      if (out) return out
    }
    return deps.alive()
      ? { state: 'waiting', reason: '로컬 실행기가 아직 처리하지 않았습니다. 실행기가 켜져 있는지 확인해 주세요. 편집기를 다시 열면 결과를 이어서 반영합니다.' }
      : { state: 'stopped' }
  }

  let prev: string | null = null
  let stalls = 0
  let busyWaits = 0
  const workerWait = createWorkerWait(limits.worker)
  for (let i = 0; i < limits.maxRuns && deps.alive(); ) {
    const { job, busy, worker } = await withAuthRetry((token) => deps.api.runOnce(jobId, token), auth)
    if (!deps.alive()) break
    deps.onJob?.(job)
    const out = settled(job, section, requestedAt)
    if (out) return out
    if (job.current_step === 'done') {
      return { state: 'waiting', reason: '잡은 끝났지만 이 재생성은 아직 대기 중입니다. 잠시 뒤 다시 열어 확인해 주세요.' }
    }
    if (busy && worker) {
      // 구독 작업자가 이 재생성을 진행 중 — 잠금 busy 상한 밖에서 기다린다
      if (workerWait.next(job)) {
        return { state: 'waiting', reason: '구독 작업자가 아직 이 잡을 진행 중입니다. 편집기를 다시 열면 결과를 이어서 반영합니다.' }
      }
      await deps.sleep(limits.worker.workerMs)
      continue
    }
    if (busy) {
      if (++busyWaits > limits.maxBusyWaits) return { state: 'waiting', reason: '다른 곳(다른 탭·작업자)이 이 잡을 진행 중입니다.' }
      await deps.sleep(limits.busyMs)
      continue
    }
    busyWaits = 0
    i++
    const signature = `${job.current_step}:${job.progress}:${job.cost_usd}:${job.section_images.length}`
    if (signature === prev) {
      if (++stalls >= limits.maxStalls) return { state: 'waiting', reason: '진행이 멈췄습니다. 잠시 뒤 다시 열어 확인해 주세요.' }
    } else stalls = 0
    prev = signature
  }
  return deps.alive() ? { state: 'waiting', reason: '실행 횟수 상한에 닿았습니다. 잠시 뒤 다시 열어 확인해 주세요.' } : { state: 'stopped' }
}
