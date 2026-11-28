/**
 * 상세페이지(PDP) 잡 run 드라이버 규칙 — 진행 화면(PdpProgress)과 편집기 다시 만들기(regenDriver)가 같이 쓴다.
 * 의존성을 받는 순수 함수라 시험에서 가짜 API로 돌린다. 브라우저가 드라이버인 구조(§6.3)는 그대로다.
 *
 * R12a(운영 첫 잡 3ac1adf4, 11-08~09): 탭이 뒤로 가 JS가 멈춘 사이 Clerk 세션 토큰(짧은 수명)이 낡아,
 * 탭이 돌아온 뒤 첫 /run이 401이었다(5번, 5초 뒤 다시 보내면 200). 지금까지는 401에서 루프가 멈춰 사람이 '계속 실행'을 눌러야 했다.
 * - 401이면 토큰을 새로 받고(getToken skipCache) 잠시 쉬었다가, 받은 토큰을 Authorization 머리에 실어 몇 번까지 다시 보낸다.
 *   401은 라우트 맨 앞 인증(requireOwner)에서 거절된 것이라 잡은 한 걸음도 나아가지 않았다. 그래서 다시 보내도 두 번 도는 일이 없다.
 *   상한을 넘으면 마지막 401을 그대로 던진다(호출부가 지금처럼 멈추고 사유를 띄운다).
 * - 탭이 다시 보이면(visibilitychange·pageshow) 미완료 잡을 이어 간다. drive는 한 화면에 하나만 돈다(singleFlight).
 * 401 밖의 오류·busy 대기·정체 판정·호출 수 상한은 그대로다.
 * R13c: 구독 작업자가 진행 중인 잡(busy + worker)은 잠금 busy 상한에 세지 않고 끝날 때까지 기다린다(WORKER_WAIT_LIMITS).
 * AX-CT-29: 구독 멈춤 표지 잡은 막히면 API로 잇지 않고 멈춘다 — run이 { job, halted: true }를 돌려주면 대기를 멈추고 멈춤 상자를 띄운다
 * (이어 하기 = resume API). 클라이언트 번들에 들어가므로 타입만 들여온다.
 */
import type { PdpJobRow, SubscriptionHaltReason, SubscriptionHaltRecord } from './pdp-state'

/** 401 한 번에 이어서 다시 보내는 횟수(첫 호출 제외)와 그 사이 쉬는 시간 — 운영에서 5초 뒤 다시 보내면 통했다 */
export const AUTH_RETRY_LIMITS = { maxRetries: 3, waitMs: 3_000 }

export interface AuthRetryDeps {
  /** 새 세션 토큰을 받는다(Clerk getToken({ skipCache: true })). 받지 못하거나 로그아웃이면 null */
  refreshToken: () => Promise<string | null>
  sleep: (ms: number) => Promise<void>
  /** 화면이 닫히면 false — 더 부르지 않는다 */
  alive: () => boolean
}

export function isUnauthorized(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 401
}

/** 새로 받은 토큰을 실을 머리 — 토큰이 없으면(첫 호출·받기 실패) 지금처럼 Clerk 쿠키만 쓴다 */
export function bearerHeaders(token: string | null): Record<string, string> | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined
}

/**
 * call이 401로 끝나면 토큰을 새로 받고 쉬었다가 다시 부른다. 연속 401이 상한을 넘거나 화면이 닫히면 마지막 오류를 던진다.
 * 401 밖의 오류는 바로 던진다(지금 처리 그대로).
 */
export async function withAuthRetry<T>(
  call: (token: string | null) => Promise<T>,
  deps: AuthRetryDeps,
  limits = AUTH_RETRY_LIMITS,
): Promise<T> {
  let token: string | null = null
  for (let retries = 0; ; retries++) {
    try {
      return await call(token)
    } catch (error) {
      if (!isUnauthorized(error) || retries >= limits.maxRetries || !deps.alive()) throw error
      token = await deps.refreshToken().catch(() => null)
      await deps.sleep(limits.waitMs)
      if (!deps.alive()) throw error
    }
  }
}

/** 연속 401 상한을 넘었을 때 띄울 말 — 서버 사유(로그인이 필요합니다.) 뒤에 한 일과 할 일을 붙인다 */
export function authGiveUpMessage(error: unknown, limits = AUTH_RETRY_LIMITS): string {
  const reason = error instanceof Error && error.message ? error.message : '로그인이 필요합니다.'
  return `${reason} 로그인 토큰을 새로 받아 ${limits.maxRetries}번 다시 보냈지만 거절됐습니다. 페이지를 새로 고친 뒤 '계속 실행'을 눌러 주세요.`
}

// ─── 진행 화면 drive 루프 ───────────────────────────────────────────────

/**
 * 순수 상한 고정값으로는 이미지 단계(여러 run에 걸친다)가 완주 전에 잘릴 수 있다 — 최악 경로(단계당 재시도 + Pro 20여 장 이미지)를
 * 감안한 절대 상한. 실제 종료는 정체 감지가 대부분 담당한다.
 * 다른 곳(다른 탭·작업자)이 이 잡을 진행 중이면 run은 아무것도 하지 않고 busy를 돌려준다(잡 진행 잠금) — 정체로 보지 않고
 * 호출 수에도 세지 않은 채 잠시 뒤 다시 부른다. 잠금은 run 상한(300초) 남짓이면 풀리므로 이어진 대기 횟수 상한을 둔다(약 7분 30초).
 */
export const PDP_BUSY_GIVE_UP = '다른 곳(다른 탭·작업자)이 이 잡을 진행 중입니다 — 잠시 뒤 다시 열어 주세요.'

// ─── 구독 작업자 잡 기다리기(R13c) ──────────────────────────────────────

/**
 * 구독 표지 잡(R13)은 Railway 작업자가 20~25분 진행한다. 작업자가 살아 있으면 웹 run은 아무것도 하지 않고 busy + worker: true를 돌려준다
 * (route webRunTurn). 이 대기는 잠금 busy 상한(90×5초)에 세지 않는다 — 세면 작업자 잡이 7분 30초에 '다른 곳이 진행 중'으로 멈춘다.
 * 끝없는 반복은 서버 넘겨받기 규칙과 아래 두 상한이 막는다.
 * - 서버: 표지 잡을 5분(WORKER_STALE_MS) 동안 아무도 저장하지 않으면 웹 run이 API로 넘겨받아 진행한다(busy가 아니게 된다).
 *   작업자 잠금 기한(PDP_RUN_LEASE_MS 340초)도 updated_at에 들어가므로, updated_at이 바뀌지 않는 가장 긴 정상 구간은 약 10분 40초다.
 * - staleMs(15분): 받은 잡의 updated_at이 이만큼 그대로면 서버도 넘겨받지 못한 것이다 — 멈추고 사유를 띄운다.
 * - maxWaitMs(60분): 작업자 대기 전체 상한(작업자 잡 20~25분의 두 배 넘게). 작업은 서버에서 이어지고, 다시 열거나 탭이 보이면 이어 본다.
 * 시간은 기다린 횟수 × workerMs로 센다(요청 시간은 빼므로 실제로는 더 오래 기다린다). 클라이언트 번들이라 서버 상수는 들여오지 않는다
 * (값의 관계는 시험이 서버 상수로 고정한다).
 */
export const WORKER_WAIT_LIMITS = { workerMs: 10_000, staleMs: 15 * 60_000, maxWaitMs: 60 * 60_000 }

export type WorkerWaitStop = 'worker-stale' | 'worker-limit'

/** busy + worker 응답을 센다 — 다음(next)은 계속 기다리면 null, 멈출 때는 그 사유 */
export function createWorkerWait(limits = WORKER_WAIT_LIMITS) {
  let waitedMs = 0
  let sameMs = 0
  let lastUpdatedAt: string | null = null
  return {
    next(job: Pick<PdpJobRow, 'updated_at'>): WorkerWaitStop | null {
      waitedMs += limits.workerMs
      if (job.updated_at === lastUpdatedAt) sameMs += limits.workerMs
      else {
        lastUpdatedAt = job.updated_at
        sameMs = 0
      }
      if (sameMs >= limits.staleMs) return 'worker-stale'
      if (waitedMs > limits.maxWaitMs) return 'worker-limit'
      return null
    },
  }
}

const minutes = (ms: number) => Math.round(ms / 60_000)

/**
 * stopJob = 구독 멈춤 표지 잡(AX-CT-29) — 서버가 넘겨받지 않는 잡이라 정체 문구가 다르다(작업자가 앞 잡을 진행 중이면 이 잡은 저장 없이
 * 차례를 기다린다). 표지 없는 잡의 문구는 그대로다
 */
export function workerGiveUpMessage(stop: WorkerWaitStop, limits = WORKER_WAIT_LIMITS, stopJob = false): string {
  if (stop === 'worker-stale' && stopJob) {
    return `구독 작업자가 앞 잡을 진행 중이라 이 잡은 ${minutes(limits.staleMs)}분 넘게 차례를 기다리고 있습니다. API로 대신 진행하지 않습니다. 잠시 뒤 '계속 실행'을 눌러 주세요.`
  }
  return stop === 'worker-stale'
    ? `구독 작업자 쪽 저장이 ${minutes(limits.staleMs)}분 넘게 없는데 서버가 넘겨받지 못했습니다. 잠시 뒤 '계속 실행'을 눌러 주세요.`
    : `구독 작업자를 ${minutes(limits.maxWaitMs)}분 기다렸지만 아직 끝나지 않았습니다. 작업은 서버에서 이어지니 잠시 뒤 다시 열어 주세요.`
}

/** 화면이 작업자 진행 중일 때 띄우는 말 */
export const WORKER_ACTIVE_NOTE =
  '구독 작업자가 이 잡을 진행 중입니다. 끝날 때까지 기다리며 진행을 보여 줍니다(탭을 닫아도 작업은 서버에서 이어집니다).'

/**
 * 순수 상한 고정값으로는 이미지 단계(여러 run에 걸친다)가 완주 전에 잘릴 수 있다 — 최악 경로(단계당 재시도 + Pro 20여 장 이미지)를
 * 감안한 절대 상한. 실제 종료는 정체 감지가 대부분 담당한다.
 * 다른 곳(다른 탭)이 이 잡을 진행 중이면 run은 아무것도 하지 않고 busy를 돌려준다(잡 진행 잠금) — 정체로 보지 않고
 * 호출 수에도 세지 않은 채 잠시 뒤 다시 부른다. 잠금은 run 상한(300초) 남짓이면 풀리므로 이어진 대기 횟수 상한을 둔다(약 7분 30초).
 * 구독 작업자 대기(busy + worker)는 이 상한 밖이다(worker — 위 WORKER_WAIT_LIMITS).
 */
export const PDP_DRIVE_LIMITS = { maxRunCalls: 60, busyMs: 5_000, maxBusyWaits: 90, worker: WORKER_WAIT_LIMITS }

/**
 * settled = 잡이 done·failed / stalled = 진행 없음 / limit = 호출 수 상한 / busy = 잠금 대기 상한 / stopped = 화면이 닫힘
 * worker-stale·worker-limit = 구독 작업자 대기 상한(workerGiveUpMessage)
 */
export type PdpDriveEnd = 'settled' | 'stalled' | 'limit' | 'busy' | 'stopped' | 'halted' | WorkerWaitStop

/** /run 응답 — busy: 이번 호출은 아무것도 하지 않았다 / worker: 그 까닭이 구독 작업자 진행(R13) / halted: 구독 멈춤 표지 잡이 멈춰 있다(AX-CT-29) */
export type PdpRunResponse = { job: PdpJobRow; busy?: boolean; worker?: boolean; halted?: boolean }

export interface PdpDriveDeps extends AuthRetryDeps {
  runOnce: (token: string | null) => Promise<PdpRunResponse>
  onJob: (job: PdpJobRow) => void
  /** 응답마다 구독 작업자가 진행 중인지 알린다(화면 안내) */
  onWorker?: (active: boolean) => void
}

// ─── 구독 멈춤(AX-CT-29) ────────────────────────────────────────────────

type HaltCarrier = { section_plan?: { subscription_halt?: SubscriptionHaltRecord } }

/** 멈춤 사유 쉬운 말 */
export const SUBSCRIPTION_HALT_REASON_LABELS: Readonly<Record<SubscriptionHaltReason, string>> = {
  worker_stale: '작업자가 5분 넘게 응답 없음',
  quota: '구독 한도 소진',
  unavailable: '구독 로그인 만료 또는 쓸 수 없는 모델',
  timeout: '구독 응답 시간 초과',
  process: '구독 실행 실패',
}

/** 잡의 멈춤 기록 — 없으면 null(칸이 없거나 옛 잡) */
export function subscriptionHaltOf(job: HaltCarrier): SubscriptionHaltRecord | null {
  return job.section_plan?.subscription_halt ?? null
}

/** 멈춤 상자 문구 — 단계 이름은 호출부가 화면 이름으로 바꿔 넘긴다 */
export function subscriptionHaltMessage(record: SubscriptionHaltRecord, stageLabel: string): string {
  return `구독 작업자가 멈춰 생성을 멈췄습니다(단계: ${stageLabel}, 사유: ${SUBSCRIPTION_HALT_REASON_LABELS[record.reason]}). API 로 대신 진행하지 않습니다. 작업자를 확인한 뒤 '이어 하기'를 누르면 멈춘 단계부터 이어집니다.`
}

export function isTerminalStep(step: PdpJobRow['current_step']): boolean {
  return step === 'done' || step === 'failed'
}

/** current_step이 done/failed가 될 때까지 run을 순차로 부른다. 401 밖의 오류는 던진다(호출부가 사유를 띄운다) */
export async function drivePdpJob(deps: PdpDriveDeps, limits = PDP_DRIVE_LIMITS): Promise<PdpDriveEnd> {
  // 정체 감지 — 직전 응답과 (단계·section_images 수·progress·비용·재시도 대기 수)가 완전히 같으면 더 돌려도
  // 진행되지 않는다는 뜻이므로 바로 멈춘다(잡 상태 기반 종료, 고정 호출 수 상한 대신).
  let prevSignature: string | null = null
  let busyWaits = 0
  const workerWait = createWorkerWait(limits.worker)
  for (let i = 0; i < limits.maxRunCalls && deps.alive(); ) {
    const { job, busy, worker, halted } = await withAuthRetry(deps.runOnce, deps)
    if (!deps.alive()) return 'stopped'
    deps.onJob(job)
    // 구독 멈춤 — 더 부르지 않는다(멈춤 상자의 '이어 하기'만 다시 시작한다)
    if (halted) return 'halted'
    const byWorker = Boolean(busy && worker)
    deps.onWorker?.(byWorker)
    if (isTerminalStep(job.current_step)) return 'settled'
    if (byWorker) {
      // 구독 작업자가 진행 중 — 잠금 busy·호출 수·정체에 세지 않고 기다리며 받은 잡(단계·장수·비용)을 그린다
      const stop = workerWait.next(job)
      if (stop) return stop
      await deps.sleep(limits.worker.workerMs)
      continue
    }
    if (busy) {
      // 이어서 기다린 횟수만 센다(진행한 run이 끼면 처음부터) — 상한에 닿으면 조용히 멈추지 않고 사유를 띄운다
      if (++busyWaits > limits.maxBusyWaits) return 'busy'
      await deps.sleep(limits.busyMs)
      continue
    }
    busyWaits = 0
    i++
    // cost_usd 포함: 게이트 재생성이 슬롯을 소비한 run은 단계·장수·진행률이 그대로여도 비용은 늘어난다 — 정체로 오탐하지 않기 위함(E2E 2026-08-10 실측)
    // 재시도 대기 수 포함: 실패 컷 재시도(섹션당 1회)가 다시 실패한 run은 재시도 대기 표지(retryPending)만 줄어든다 — 정체로 오탐하지 않기 위함
    const retryPendingCount = job.section_images.filter((e) => e.retryPending).length
    const signature = `${job.current_step}:${job.section_images.length}:${job.progress}:${job.cost_usd}:${retryPendingCount}`
    if (signature === prevSignature) return 'stalled'
    prevSignature = signature
  }
  return deps.alive() ? 'limit' : 'stopped'
}

// ─── drive 하나만·탭 복귀 이어 가기 ──────────────────────────────────────

/** 한 화면에 drive 하나 — 이미 돌면 새로 시작하지 않고 null을 돌려준다(첫 불러오기·버튼·탭 복귀가 모두 이 문을 지난다) */
export function createSingleFlight() {
  let current: Promise<void> | null = null
  return {
    running: () => current !== null,
    run(task: () => Promise<void>): Promise<void> | null {
      if (current) return null
      current = task().finally(() => {
        current = null
      })
      return current
    },
  }
}

/** 탭이 다시 보였을 때 이어 갈지 — 잡을 불러왔고, 끝나지 않았고(실패도 아님 — 실패 재시도는 사람이 누른다), 멈춤 기록이 없고, 도는 drive가 없을 때만 */
export function shouldResumeOnVisible(job: (Pick<PdpJobRow, 'current_step'> & HaltCarrier) | null, running: boolean): boolean {
  return !running && job !== null && !isTerminalStep(job.current_step) && !subscriptionHaltOf(job)
}

interface ListenTarget {
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

/**
 * 탭이 다시 보이면 onVisible을 부른다 — visibilitychange(뒤로 갔던 탭이 앞으로)와 pageshow(뒤로 가기 캐시에서 되살아남).
 * 두 이벤트가 겹쳐 와도 onVisible 쪽(singleFlight)이 drive를 하나만 돌린다. 돌려준 함수로 듣기를 그만둔다.
 */
export function onTabVisible(doc: ListenTarget & { visibilityState: string }, win: ListenTarget, onVisible: () => void): () => void {
  const handle = () => {
    if (doc.visibilityState === 'visible') onVisible()
  }
  doc.addEventListener('visibilitychange', handle)
  win.addEventListener('pageshow', handle)
  return () => {
    doc.removeEventListener('visibilitychange', handle)
    win.removeEventListener('pageshow', handle)
  }
}
