/**
 * 구독 작업자 잡(R13, 오너 I4-1·I2-3) — 잡 표지 정하기 · 웹 run의 차례 판정 · 작업자 무응답 때 웹이 API로 넘겨받기 · 잇기 기록 저장.
 *
 * - 표지: 새 배치 잡을 만들 때 Vercel env NEXOPS_PDP_SUBSCRIPTION_WORKER=on(오너 승인 뒤 오너 손 — R13b)이면 spec_sheet 예약 키
 *   modelBackend 'subscription'(pdp-model-batch, DDL 없음). env가 없으면 지금과 같은 잡(키 없음 = API)이라 운영 바이트가 그대로다.
 * - 진행: 표지 잡은 Railway 구독 작업자(scripts/pdp-worker/worker.mts)가 큐로 읽어 runPdpStep으로 진행한다. 웹 run은 작업자가 살아
 *   있으면(잠금이 있거나 마지막 저장이 5분 안) 아무것도 하지 않고 busy를 돌려준다(화면은 잠시 뒤 다시 부른다 — 잡 진행 잠금과 같은 응답).
 * - 무응답: 표지 잡을 5분 동안 아무도 저장하지 않으면 웹이 표지를 API로 바꾸고 이어서 진행한다(오너 I2-3 "막히면 API"). 작업자 심박
 *   테이블을 두면 DDL이 필요해 잡의 잠금·마지막 저장 시각만으로 판정한다. 5분은 근거 없는 권장값이다(R12 기록으로 조정).
 * - 끝난 잡(done)·멈춘 잡(failed)의 '다시 시도'는 웹이 그대로 진행한다(표지는 그대로 — 막힌 구독 콜은 API로 이어진다). 작업자는
 *   failed 잡을 큐에서 집지 않는다.
 * - 구독 멈춤 표지 잡(AX-CT-29, spec_sheet subscriptionStop — 잡 생성 때 Vercel env NEXOPS_PDP_SUBSCRIPTION_STOP=on): 위 세 자리 어디서도
 *   API로 잇지 않는다. 웹은 이 잡을 절대 진행하지 않고(읽기만), 막히면 section_plan.subscription_halt로 멈추고 ops_job_runs
 *   'pdp-subscription-halt' 한 줄(관제 사건 → 텔레그램 1회)을 남긴다. 다시 시작은 resume API('이어 하기') 한 곳뿐이다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SubscriptionFallbackRecord } from '@/lib/agents/llm/subscription-fallback'
import { OPS_JOB_KEYS, recordJobRun } from '@/lib/ops/job-runs'
import { getPdpJob, isPdpJobLeased, updatePdpJobIfUnchanged } from './pdp-jobs'
import { MODEL_BACKEND_SPEC_KEY, specSheetForSave, type PdpModelBackend, type PdpModelBatch } from './pdp-model-batch'
import { SUBSCRIPTION_HALT_REASON_LABELS } from './pdp-run-driver'
import type { PdpJobRow, SubscriptionHaltReason, SubscriptionHaltRecord } from './pdp-state'

/** 잡 생성 때 구독 표지를 다는 스위치(Vercel env) — 'on'일 때만 */
export const PDP_SUBSCRIPTION_WORKER_ENV = 'NEXOPS_PDP_SUBSCRIPTION_WORKER'
/** 구독 멈춤 표지를 잡 생성 때 다는 스위치(Vercel env) — 'on'일 때만, 기본 꺼짐(AX-CT-29) */
export const PDP_SUBSCRIPTION_STOP_ENV = 'NEXOPS_PDP_SUBSCRIPTION_STOP'
/** 표지 잡을 이만큼 아무도 저장하지 않으면 작업자가 없다고 본다 */
export const WORKER_STALE_MS = 5 * 60_000
/** 잡 하나에 남기는 잇기 기록 상한(오래된 것부터 버린다) — section_plan이 커지지 않게 */
const MAX_FALLBACK_RECORDS = 100

/** 새 잡의 LLM 백엔드 — 새 배치 + 작업자 스위치 on이면 구독, 아니면 API(지금 배치는 구독 표지를 달지 않는다) */
export function resolveJobModelBackend(
  batch: PdpModelBatch,
  env: Record<string, string | undefined> = process.env
): PdpModelBackend {
  return batch === 'new' && env[PDP_SUBSCRIPTION_WORKER_ENV]?.trim() === 'on' ? 'subscription' : 'api'
}

/**
 * 새 잡이 구독 멈춤 표지를 다는가 — 구독 표지(backend 'subscription')를 다는 잡이고 env가 정확히 'on'(앞뒤 공백·대소문자 무시)일 때만.
 * 그 밖(env 없음·off·true·1·API 잡)은 false라 저장 바이트가 지금과 같다
 */
export function resolveJobSubscriptionStop(
  backend: PdpModelBackend,
  env: Record<string, string | undefined> = process.env
): boolean {
  return backend === 'subscription' && env[PDP_SUBSCRIPTION_STOP_ENV]?.trim().toLowerCase() === 'on'
}

/**
 * web = 웹이 진행 · worker = 작업자 차례(busy로 돌려준다) · takeover = 작업자 무응답 — 웹이 표지를 API로 바꾸고 진행
 * 구독 멈춤 표지 잡만: halted = 멈춤 기록이 이미 있다({ job, halted }) · halt = 작업자가 모두 조용하다 — 멈춤을 기록한다 ·
 * read = 끝난·실패한 잡이라 읽기만({ job }, LLM 0콜)
 */
export type WebRunTurn = 'web' | 'worker' | 'takeover' | 'halted' | 'halt' | 'read'

/** 작업자 생존 판정 재료 — 같은 사용자의 다른 구독 표지 진행 중(done·failed·멈춤 아님) 잡의 마지막 저장 시각(잠금 기한 포함) */
export type WorkerLivenessJob = Pick<PdpJobRow, 'updated_at'>

function savedWithin(job: WorkerLivenessJob, now: number): boolean {
  if (isPdpJobLeased(job, now)) return true
  const at = Date.parse(job.updated_at)
  return Number.isFinite(at) && now - at < WORKER_STALE_MS
}

export function webRunTurn(
  job: Pick<PdpJobRow, 'model_backend' | 'current_step' | 'updated_at'> &
    Partial<Pick<PdpJobRow, 'subscription_stop' | 'section_plan'>>,
  now = Date.now(),
  others: readonly WorkerLivenessJob[] = []
): WebRunTurn {
  if (job.model_backend !== 'subscription') return 'web'
  if (job.subscription_stop) {
    // 구독 멈춤 표지 잡 — 웹은 진행하지 않는다(표지를 API로 바꾸지도, runPdpStep을 부르지도 않는다)
    if (job.section_plan?.subscription_halt) return 'halted'
    if (job.current_step === 'done' || job.current_step === 'failed') return 'read'
    if (savedWithin(job, now)) return 'worker'
    // 작업자는 큐를 한 잡씩 끝까지 돌린다 — 이 잡이 오래 조용해도 같은 사용자의 다른 구독 잡을 진행 중이면 작업자는 살아 있다
    if (others.some((other) => savedWithin(other, now))) return 'worker'
    return 'halt'
  }
  if (job.current_step === 'done' || job.current_step === 'failed') return 'web'
  if (savedWithin(job, now)) return 'worker'
  return 'takeover'
}

/**
 * 작업자 무응답 — 표지를 API로 바꾼다(읽은 뒤 바뀌지 않았을 때만). 그사이 작업자가 저장했으면 null(웹은 busy로 돌려준다).
 * 이후 작업자 큐에 다시 잡히지 않는다
 */
export async function takeOverFromWorker(db: SupabaseClient, userId: string, job: PdpJobRow): Promise<PdpJobRow | null> {
  console.warn(`[registration/pdp] 구독 작업자 무응답(${Math.round(WORKER_STALE_MS / 60_000)}분) — 잡 ${job.id.slice(0, 8)}을 API로 잇습니다`)
  return updatePdpJobIfUnchanged(db, userId, job, {
    specSheet: specSheetForSave({ ...job, model_backend: 'api' }, job.spec_sheet),
  })
}

/**
 * 단계에서 모은 잇기 기록을 잡 section_plan.subscription_fallback에 더한다(청구액 표시) — 기록이 없으면 아무것도 하지 않는다.
 * 그사이 다른 저장이 있었으면(조건부 갱신 0행) 기록을 남기지 못한다고 경고만 한다(잡 결과·청구액 cost_usd는 그대로)
 */
export async function recordSubscriptionFallbacks(
  db: SupabaseClient,
  userId: string,
  job: PdpJobRow,
  records: readonly SubscriptionFallbackRecord[]
): Promise<PdpJobRow> {
  if (records.length === 0) return job
  const merged = [...(job.section_plan.subscription_fallback ?? []), ...records].slice(-MAX_FALLBACK_RECORDS)
  try {
    const saved = await updatePdpJobIfUnchanged(db, userId, job, {
      sectionPlan: { ...job.section_plan, subscription_fallback: merged },
    })
    if (saved) return saved
    console.warn(`[registration/pdp] 잡 ${job.id.slice(0, 8)}이 그사이 바뀌어 구독 잇기 기록 ${records.length}건을 남기지 못했습니다`)
  } catch (error) {
    console.warn('[registration/pdp] 구독 잇기 기록 저장 실패 — 잡 결과는 그대로입니다.', {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return job
}

// ─── 구독 멈춤(AX-CT-29) ───────────────────────────────────────────────

const MAX_HALT_DETAIL_CHARS = 200

/** 멈춤 기록 한 건 — 사유 글은 앞 200자만(비밀값은 없다: CLI 마지막 줄·소프트 종료 글) */
export function buildSubscriptionHalt(
  stage: string,
  reason: SubscriptionHaltReason,
  detail: string,
  now = Date.now()
): SubscriptionHaltRecord {
  return { at: new Date(now).toISOString(), stage, reason, detail: detail.slice(0, MAX_HALT_DETAIL_CHARS) }
}

/** error 칸 한 줄 — 지금 소프트 종료 저장 꼴('[단계] …')을 따른다(화면 stripStepFailurePrefix가 앞 표지를 뗀다) */
export function subscriptionHaltError(record: SubscriptionHaltRecord): string {
  const detail = record.detail ? ` (${record.detail.slice(0, 100)})` : ''
  return `[${record.stage}] 구독 작업자 멈춤 — ${SUBSCRIPTION_HALT_REASON_LABELS[record.reason]}${detail}`
}

/** 멈춤 저장 몫 — section_plan.subscription_halt와 error 한 줄(다른 section_plan 칸은 그대로) */
export function subscriptionHaltPatch(job: Pick<PdpJobRow, 'section_plan'>, record: SubscriptionHaltRecord) {
  return { sectionPlan: { ...job.section_plan, subscription_halt: record }, error: subscriptionHaltError(record) }
}

/**
 * 멈춤 사건 줄(관제 사건 → 텔레그램 1회) — 실패해도 본 작업을 막지 않는다(recordJobRun). 멈춤 시각(at)을 함께 남겨 멈춤마다 다른 사건이
 * 된다(같은 잡이 이어 하기 뒤 다시 멈춰도 알림이 다시 간다 — signals pdpSubscriptionHaltSignal)
 */
export async function recordSubscriptionHaltRun(
  db: SupabaseClient,
  userId: string,
  jobId: string,
  record: SubscriptionHaltRecord
): Promise<void> {
  await recordJobRun(db, {
    jobKey: OPS_JOB_KEYS.pdpSubscriptionHalt,
    status: 'failed',
    userId,
    detail: { job: jobId.slice(0, 8), stage: record.stage, reason: record.reason, at: record.at },
  })
}

/** '이어 하기' — 그 멈춤(같은 at)의 사건을 닫는 ok 줄 */
export async function recordSubscriptionResumeRun(
  db: SupabaseClient,
  userId: string,
  jobId: string,
  halt: Pick<SubscriptionHaltRecord, 'stage' | 'at'>
): Promise<void> {
  await recordJobRun(db, {
    jobKey: OPS_JOB_KEYS.pdpSubscriptionHalt,
    status: 'ok',
    userId,
    detail: { job: jobId.slice(0, 8), stage: halt.stage, at: halt.at, resumed: true },
  })
}

/**
 * 멈춤 기록이 있는 채로 잡이 끝났다(합성 마지막 저장, pdp-jobs finishClearingHalt — 결정 46) — 이어 할 것이 없으므로 그 멈춤(같은 at)의
 * 사건을 닫는 ok 줄
 */
export async function recordSubscriptionFinishRun(
  db: SupabaseClient,
  userId: string,
  jobId: string,
  halt: Pick<SubscriptionHaltRecord, 'stage' | 'at'>
): Promise<void> {
  await recordJobRun(db, {
    jobKey: OPS_JOB_KEYS.pdpSubscriptionHalt,
    status: 'ok',
    userId,
    detail: { job: jobId.slice(0, 8), stage: halt.stage, at: halt.at, finished: true },
  })
}

/**
 * 웹 run이 작업자 무응답을 판정했을 때 — 멈춤을 기록한다(읽은 뒤 바뀌지 않았을 때만). 표지는 API로 바꾸지 않는다.
 * 이미 멈춤 기록이 있으면 아무것도 쓰지 않고 그 잡을 돌려준다(사건 줄 중복 방지). 그사이 작업자가 저장했으면 null
 */
export async function haltForSubscription(
  db: SupabaseClient,
  userId: string,
  job: PdpJobRow,
  reason: SubscriptionHaltReason,
  detail: string,
  now = Date.now()
): Promise<PdpJobRow | null> {
  if (job.section_plan.subscription_halt) return job
  const record = buildSubscriptionHalt(job.current_step, reason, detail, now)
  const saved = await updatePdpJobIfUnchanged(db, userId, job, subscriptionHaltPatch(job, record))
  if (!saved) return null
  console.warn(`[registration/pdp] 구독 작업자 멈춤(${reason}) — 잡 ${job.id.slice(0, 8)}·${record.stage}, API로 잇지 않습니다`)
  await recordSubscriptionHaltRun(db, userId, job.id, record)
  return saved
}

/** 파이프라인이 단계 안의 소프트 종료(LlmSoftStopError)에서 꺼낸 사유 — 이름·stop 칸으로만 판별한다(PdpLeaseLostError와 같은 방식) */
export function softStopOf(error: unknown): { reason: SubscriptionHaltReason; message: string; backend?: string } | null {
  if (!(error instanceof Error) || error.name !== 'LlmSoftStopError') return null
  const stop = (error as { stop?: { reason?: unknown; message?: unknown; backend?: unknown } }).stop
  const reason = stop?.reason
  const known = reason === 'quota' || reason === 'unavailable' || reason === 'timeout' || reason === 'process'
  return {
    reason: known ? reason : 'unavailable',
    message: typeof stop?.message === 'string' ? stop.message : error.message,
    ...(typeof stop?.backend === 'string' ? { backend: stop.backend } : {}),
  }
}

/**
 * 구독 멈춤 표지 잡의 단계가 구독 소프트 종료·프로세스 실패로 멈췄다 — 멈춤 기록과 error 한 줄을 이 저장으로 함께 남기고(잠금도 푼다)
 * 사건 줄을 쓴다. 단계가 이미 쓴 section_plan을 잃지 않게 지금 잡을 다시 읽어 합친다. 멈춤 기록이 이미 있으면 줄을 더 쓰지 않는다.
 * 저장은 다시 읽은 뒤 바뀌지 않았을 때만 한다(조건부 — 웹 멈춤 haltForSubscription과 같은 규칙). 그사이 웹이 멈춤을 기록했거나
 * '이어 하기'가 지웠으면 0행이라 다시 읽어 판단한다 — 멈춤 기록끼리의 경합은 한 기록이 다른 기록을 덮어 사건 줄이 둘 남고 덮인 사건이
 * 열린 채 남는 길이 없다(AX-CT-29 재검수 지적 1). 단계의 다른 저장이 멈춤 기록을 지우지 않는 것은 pdp-jobs updatePdpJob(결정 45)이 맡는다.
 * 세 번 모두 그사이 바뀌면 쓰지 않고 마지막에 읽은 잡을 돌려준다(잠금은 기한이 지나면 풀린다)
 */
export async function haltStopJobAfterSoftStop(
  db: SupabaseClient,
  userId: string,
  job: PdpJobRow,
  stop: { reason: SubscriptionHaltReason; message: string },
  stage: string = job.current_step,
  now = Date.now()
): Promise<PdpJobRow> {
  let fresh = job
  for (let attempt = 0; attempt < HALT_SAVE_ATTEMPTS; attempt++) {
    fresh = (await getPdpJob(db, userId, job.id)) ?? job
    const existing = fresh.section_plan.subscription_halt
    if (existing) {
      // 이미 멈춤 기록이 있다(웹이 먼저 기록) — 사건 줄을 더 쓰지 않고 error 한 줄·잠금만 정리한다
      const kept = await updatePdpJobIfUnchanged(db, userId, fresh, { error: subscriptionHaltError(existing) })
      if (kept) return kept
      continue
    }
    const record = buildSubscriptionHalt(stage, stop.reason, stop.message, now)
    const saved = await updatePdpJobIfUnchanged(db, userId, fresh, subscriptionHaltPatch(fresh, record))
    if (!saved) continue
    console.warn(`[registration/pdp] 구독 작업자 멈춤(${stop.reason}) — 잡 ${job.id.slice(0, 8)}·${record.stage}, API로 잇지 않습니다`)
    await recordSubscriptionHaltRun(db, userId, job.id, record)
    return saved
  }
  console.warn(`[registration/pdp] 구독 작업자 멈춤 저장을 ${HALT_SAVE_ATTEMPTS}번 모두 다른 저장과 겹쳐 쓰지 않았습니다 — 잡 ${job.id.slice(0, 8)}`)
  return fresh
}

/** 소프트 종료 멈춤 저장의 조건부 저장 시도 수 */
const HALT_SAVE_ATTEMPTS = 3

/** 같은 사용자의 다른 구독 표지 진행 중(done·failed·멈춤 아님) 잡의 마지막 저장 시각 — 작업자 생존 판정 재료(webRunTurn others) */
export async function listOtherSubscriptionJobs(db: SupabaseClient, userId: string, excludeJobId: string): Promise<WorkerLivenessJob[]> {
  const { data, error } = await db
    .from('registration_pdp_jobs')
    .select('id, updated_at')
    .eq('user_id', userId)
    .eq(`spec_sheet->>${MODEL_BACKEND_SPEC_KEY}`, 'subscription')
    .not('current_step', 'in', '(done,failed)')
    .neq('id', excludeJobId)
    .is('section_plan->>subscription_halt', null)
    .limit(20)
  if (error) throw new Error(`구독 표지 잡 조회 실패: ${error.message}`)
  return ((data ?? []) as Array<{ updated_at: string }>).map((row) => ({ updated_at: row.updated_at }))
}

/**
 * '이어 하기' 저장 몫 — 멈춤 기록·error를 지우고, 실패한 잡이면 다시 돌릴 단계로 되돌린다(step = resolveStepToRun).
 * 실패한 잡을 images로 되돌릴 때는 url 없는 첫 화면(hero) 칸을 지운다 — 웹 '다시 시도'가 runImagesStep retryLostHero로 하던 거르기
 * (pdp-image-stage와 같은 조건)를 여기서 한다. 작업자는 failed가 아닌 잡을 받으므로 retryLostHero를 붙이지 않고, 실패한 hero 칸이
 * 남으면 hero 일감이 안 생겨 heroLost로 바로 다시 실패한다(검수 A). 지울 칸이 없으면 sectionImages를 저장하지 않는다
 */
export function subscriptionResumePatch(
  job: Pick<PdpJobRow, 'section_plan' | 'current_step' | 'section_images'>,
  step: PdpJobRow['current_step']
) {
  const { subscription_halt: _halt, ...sectionPlan } = job.section_plan
  void _halt
  const failed = job.current_step === 'failed'
  const kept = failed && step === 'images' ? job.section_images.filter((e) => e.section !== 'hero' || e.url) : job.section_images
  return {
    sectionPlan,
    error: null,
    ...(failed ? { currentStep: step } : {}),
    ...(kept.length !== job.section_images.length ? { sectionImages: kept } : {}),
  }
}
