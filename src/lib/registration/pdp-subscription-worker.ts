/**
 * Railway 구독 작업자의 큐·진행 고리(R13) — 진입점(scripts/pdp-worker/worker.mts)이 백엔드를 등록한 뒤 이 고리를 돈다.
 *
 * - 큐 = registration_pdp_jobs 그대로(DDL 없음): spec_sheet 예약 키 modelBackend 'subscription' + current_step이 done·failed가 아닌 잡,
 *   만든 순서대로. 여러 사용자 잡을 한 번에 읽지만 진행은 잡마다 그 행의 user_id로만 한다(runPdpStep(id, user_id) — 격리 유지).
 * - 잡 하나를 끝(done·failed)까지 이어서 진행한다. 다른 곳이 진행 중(잠금)이거나 상태가 그대로면(정체) 그 잡은 다음 차례로 넘긴다
 *   (화면 PdpProgress와 같은 정체 판정 + 오류 글). 한 잡에 run 상한을 둔다.
 * - 구독 콜이 막히면 단계 안에서 같은 모델 API로 잇는다(agents/llm/subscription-fallback) — 여기서는 따로 멈추지 않는다.
 * - 구독 멈춤 표지 잡(AX-CT-29)은 API로 잇지 않고 멈춘다(section_plan.subscription_halt) — 멈춤 기록이 있는 잡은 큐가 집지 않는다
 *   ('이어 하기'가 기록을 지우면 다시 잡힌다). 한 잡이 멈추면 그 잡만 다음 차례로 넘긴다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { PDP_HOSTED_WORKER } from './enrichment-switch'
import { isPdpJobLeased } from './pdp-jobs'
import { MODEL_BACKEND_SPEC_KEY } from './pdp-model-batch'
import type { PdpJobRow } from './pdp-state'

/** 작업자에 꼭 있어야 하는 env(값은 보지 않는다) — 잡 읽기·쓰기, API 잇기·Gemini 단계, MS 2k, 구독 로그인 볼륨 */
export const WORKER_REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'HF_API_KEY_ID',
  'HF_API_KEY_SECRET',
  'NEXOPS_CODEX_HOME',
  'NEXOPS_CLAUDE_CONFIG_DIR',
] as const
/** 로컬 실험 갈래 env — 운영 실행은 무시하지만 작업자에 있으면 잘못 켠 것이라 시작하지 않는다 */
const LOCAL_ARM_ENV = [
  'NEXOPS_PDP_LLM_BACKEND',
  'NEXOPS_PDP_MODEL_ARM',
  'NEXOPS_PDP_ENRICHMENT',
  'NEXOPS_PDP_ENRICHMENT_EXTRA',
  'NEXOPS_PDP_ENRICHMENT_SKIP',
] as const

/** 작업자를 시작하면 안 되는 사유(이름만 — 값은 출력하지 않는다). 빈 배열이면 시작한다 */
export function workerEnvProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = []
  if (env.NEXOPS_PDP_HOSTED?.trim() !== PDP_HOSTED_WORKER) {
    problems.push(`NEXOPS_PDP_HOSTED=${PDP_HOSTED_WORKER}가 아닙니다 — 운영 실행 값(단계 표·기한·스위치)을 쓰려면 필요합니다`)
  }
  for (const name of WORKER_REQUIRED_ENV) if (!env[name]?.trim()) problems.push(`${name}가 없습니다`)
  for (const name of LOCAL_ARM_ENV) if (env[name]?.trim()) problems.push(`${name}는 로컬 실험 갈래라 작업자에 두지 않습니다`)
  return problems
}

/** 오너 id env 두 이름 — 월 변동비 가드(variable-cost.ts ownerUserIdFromEnv)가 보는 이름과 같다. 둘 중 하나만 있으면 된다 */
export const WORKER_OWNER_ID_ENV = ['NEXI_OWNER_USER_ID', 'NEXOPS_WORKER_USER_ID'] as const

/**
 * 작업자를 막지는 않지만 알려야 하는 경고(AX-PL-17 ②′b) — 오너 id 가 없으면 12월 월 변동비 가드가 합계를 읽지 못해
 * 상세페이지 이미지 층(API 이미지)의 $300 상한이 빠진다(설계 11-4 읽기 실패 = 이미지 층 열림). 값은 글에 넣지 않는다. 빈 배열이면 경고 없음
 */
export function workerEnvWarnings(env: Record<string, string | undefined>): string[] {
  if (WORKER_OWNER_ID_ENV.some((name) => env[name]?.trim())) return []
  return [`오너 id(${WORKER_OWNER_ID_ENV.join(' 또는 ')})가 없습니다 — 12월 월 변동비 가드의 상세페이지 이미지 층이 열립니다(상한 $300이 빠짐). 시작은 막지 않습니다`]
}

/**
 * 작업자의 구독 이미지 길(AX-CT-35, 오너 X-189 '구독 길을 꺼진 채 만듦') 스위치 — 이 값이 정확히 'on'일 때만 진입점이 codex-image 백엔드를
 * 등록한다(움직이는 칸 구독 시트 엔진 codex-sheet가 부른다). 없으면 등록하지 않는다 — 등록만으로도 image_model 'codex-image' 잡이 작업자에서
 * 생성될 수 있어서다. 켜기는 오너 답 뒤에만(Railway 작업자 설정)
 */
export const WORKER_CODEX_IMAGE_ENV = 'NEXOPS_PDP_WORKER_CODEX_IMAGE'

export const workerCodexImageWanted = (env: Record<string, string | undefined>): boolean => env[WORKER_CODEX_IMAGE_ENV]?.trim() === 'on'

export interface WorkerQueueJob {
  id: string
  user_id: string
  current_step: string
}

/** 큐 읽기 — 구독 표지 잡 중 끝나지 않은 것(만든 순서) */
export async function listSubscriptionQueue(db: SupabaseClient, limit = 10): Promise<WorkerQueueJob[]> {
  const { data, error } = await db
    .from('registration_pdp_jobs')
    .select('id, user_id, current_step')
    .eq(`spec_sheet->>${MODEL_BACKEND_SPEC_KEY}`, 'subscription')
    .not('current_step', 'in', '(done,failed)')
    // 멈춤 기록이 있는 잡은 집지 않는다(구독 멈춤 표지 잡 — 기록이 없는 잡의 결과는 지금과 같다)
    .is('section_plan->>subscription_halt', null)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`구독 작업자 큐 조회 실패: ${error.message}`)
  return (data ?? []) as WorkerQueueJob[]
}

/** 화면(PdpProgress) 정체 판정과 같은 칸 + 오류 글(같은 단계 실패 횟수가 바뀌면 진행으로 본다) */
type StepView = Pick<PdpJobRow, 'current_step' | 'section_images' | 'progress' | 'cost_usd' | 'error' | 'updated_at'> & {
  section_plan?: Pick<PdpJobRow['section_plan'], 'subscription_halt'>
}

function signatureOf(job: StepView): string {
  const retryPending = job.section_images.filter((e) => e.retryPending).length
  return `${job.current_step}:${job.section_images.length}:${job.progress}:${job.cost_usd}:${retryPending}:${job.error ?? ''}`
}

export type DriveEnd = 'done' | 'failed' | 'busy' | 'stalled' | 'max-runs' | 'stopped' | 'error' | 'halted'

export interface DriveDeps {
  runStep: (jobId: string, userId: string) => Promise<StepView>
  log?: (line: string) => void
  /** 잡 하나의 run 상한 — 화면 ABSOLUTE_MAX_RUN_CALLS와 같은 값 */
  maxRuns?: number
  /** 종료 신호(SIGTERM)를 받았으면 true — 지금 run이 끝난 뒤 멈춘다 */
  shouldStop?: () => boolean
  now?: () => number
}

const DEFAULT_MAX_RUNS = 60

export async function driveSubscriptionJob(
  job: WorkerQueueJob,
  deps: DriveDeps
): Promise<{ runs: number; end: DriveEnd; step: string }> {
  const log = deps.log ?? (() => {})
  const maxRuns = deps.maxRuns ?? DEFAULT_MAX_RUNS
  let previous: string | null = null
  let step = job.current_step
  for (let runs = 0; runs < maxRuns; ) {
    if (deps.shouldStop?.()) return { runs, end: 'stopped', step }
    let after: StepView
    try {
      after = await deps.runStep(job.id, job.user_id)
    } catch (error) {
      log(`잡 ${job.id.slice(0, 8)} run 오류 — ${error instanceof Error ? error.message : String(error)}`)
      return { runs: runs + 1, end: 'error', step }
    }
    runs++
    step = after.current_step
    if (step === 'done' || step === 'failed') return { runs, end: step, step }
    // 구독 멈춤(AX-CT-29) — 이 잡은 여기서 멈춘다(저장된 기록이 큐에서도 뺀다). 다음 잡으로 넘어간다
    if (after.section_plan?.subscription_halt) return { runs, end: 'halted', step }
    if (isPdpJobLeased(after, deps.now?.())) return { runs, end: 'busy', step }
    const signature = signatureOf(after)
    if (signature === previous) return { runs, end: 'stalled', step }
    previous = signature
  }
  return { runs: maxRuns, end: 'max-runs', step }
}

export interface TickDeps extends DriveDeps {
  listQueue: () => Promise<WorkerQueueJob[]>
}

/** 한 바퀴 — 큐를 읽어 잡마다 끝까지 진행한다. 진행한 잡 수와 잡별 끝 */
export async function runWorkerTick(deps: TickDeps): Promise<Array<{ id: string; runs: number; end: DriveEnd; step: string }>> {
  const queue = await deps.listQueue()
  const results: Array<{ id: string; runs: number; end: DriveEnd; step: string }> = []
  for (const job of queue) {
    if (deps.shouldStop?.()) break
    const result = await driveSubscriptionJob(job, deps)
    deps.log?.(`잡 ${job.id.slice(0, 8)} ${job.current_step} → ${result.step} (run ${result.runs}, ${result.end})`)
    results.push({ id: job.id, ...result })
  }
  return results
}
