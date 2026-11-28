import { describe, expect, it, vi } from 'vitest'
import { PdpApiError } from './pdp-client'
import { PDP_RUN_LEASE_MS } from './pdp-jobs'
import { WORKER_STALE_MS, webRunTurn } from './pdp-subscription'
import type { PdpJobRow, PdpStep } from './pdp-state'
import {
  AUTH_RETRY_LIMITS,
  PDP_DRIVE_LIMITS,
  WORKER_WAIT_LIMITS,
  authGiveUpMessage,
  bearerHeaders,
  createSingleFlight,
  createWorkerWait,
  drivePdpJob,
  isUnauthorized,
  onTabVisible,
  shouldResumeOnVisible,
  subscriptionHaltMessage,
  subscriptionHaltOf,
  SUBSCRIPTION_HALT_REASON_LABELS,
  withAuthRetry,
  workerGiveUpMessage,
  type PdpDriveDeps,
  type PdpRunResponse,
} from './pdp-run-driver'

const unauthorized = () => new PdpApiError('로그인이 필요합니다.', 401)

function job(step: PdpStep, progress: number, images = 0, extra: Partial<PdpJobRow> = {}): PdpJobRow {
  return {
    id: 'job-1',
    current_step: step,
    progress,
    cost_usd: progress / 100,
    error: null,
    section_images: Array.from({ length: images }, (_, i) => ({ section: `s${i}`, url: `https://img.test/${i}.png` })),
    ...extra,
  } as unknown as PdpJobRow
}

type RunResult = PdpRunResponse
type Step = RunResult | Error | (() => Promise<RunResult>)

/** 차례대로 응답하는 가짜 run — Error면 던지고, 함수면 그 약속을 기다린다. 받은 토큰을 남긴다 */
function fakeRun(steps: Step[]) {
  const tokens: Array<string | null> = []
  const runOnce = vi.fn(async (token: string | null) => {
    tokens.push(token)
    const next = steps[Math.min(tokens.length - 1, steps.length - 1)]
    if (typeof next === 'function') return next()
    if (next instanceof Error) throw next
    return next
  })
  return { runOnce, tokens }
}

function driveDeps(steps: Step[], extra: Partial<PdpDriveDeps> = {}) {
  const run = fakeRun(steps)
  let minted = 0
  const deps = {
    runOnce: run.runOnce,
    onJob: vi.fn(),
    refreshToken: vi.fn(async () => `fresh-${++minted}`),
    sleep: vi.fn(async () => {}),
    alive: () => true,
    ...extra,
  }
  return { deps, run }
}

describe('withAuthRetry — 401이면 토큰을 새로 받아 다시 보낸다(R12a)', () => {
  it('401 뒤 200이면 결과를 돌려준다 — 토큰 한 번 새로 받고, 쉬고, 그 토큰을 실어 다시 보낸다', async () => {
    const { deps, run } = driveDeps([unauthorized(), { job: job('images', 70) }])
    const out = await withAuthRetry(deps.runOnce, deps)
    expect(out.job.progress).toBe(70)
    expect(run.tokens).toEqual([null, 'fresh-1'])
    expect(deps.refreshToken).toHaveBeenCalledTimes(1)
    expect(deps.sleep).toHaveBeenCalledWith(AUTH_RETRY_LIMITS.waitMs)
  })

  it(`연속 401이 상한(${AUTH_RETRY_LIMITS.maxRetries}번 다시)을 넘으면 마지막 401을 그대로 던진다`, async () => {
    const { deps, run } = driveDeps([unauthorized()])
    const error = await withAuthRetry(deps.runOnce, deps).catch((e) => e)
    expect(isUnauthorized(error)).toBe(true)
    expect(run.runOnce).toHaveBeenCalledTimes(AUTH_RETRY_LIMITS.maxRetries + 1)
    expect(deps.refreshToken).toHaveBeenCalledTimes(AUTH_RETRY_LIMITS.maxRetries)
    expect(authGiveUpMessage(error)).toContain(`로그인이 필요합니다. 로그인 토큰을 새로 받아 ${AUTH_RETRY_LIMITS.maxRetries}번 다시 보냈지만`)
  })

  it('401 밖의 오류(500·409)는 다시 보내지 않고 바로 던진다(지금 처리 그대로)', async () => {
    for (const status of [500, 409, 403]) {
      const { deps, run } = driveDeps([new PdpApiError('서버 오류', status)])
      await expect(withAuthRetry(deps.runOnce, deps)).rejects.toMatchObject({ status })
      expect(run.runOnce).toHaveBeenCalledTimes(1)
      expect(deps.refreshToken).not.toHaveBeenCalled()
    }
  })

  it('토큰 받기가 실패해도(오프라인 등) 토큰 없이 다시 보낸다 — 쿠키는 Clerk가 새로 고친다', async () => {
    const { deps, run } = driveDeps([unauthorized(), { job: job('images', 70) }], {
      refreshToken: vi.fn(async () => {
        throw new Error('clerk_offline')
      }),
    })
    await expect(withAuthRetry(deps.runOnce, deps)).resolves.toMatchObject({ job: { progress: 70 } })
    expect(run.tokens).toEqual([null, null])
  })

  it('쉬는 사이 화면이 닫히면 더 보내지 않는다', async () => {
    let alive = true
    const { deps, run } = driveDeps([unauthorized(), { job: job('images', 70) }], {
      alive: () => alive,
      sleep: vi.fn(async () => {
        alive = false
      }),
    })
    await expect(withAuthRetry(deps.runOnce, deps)).rejects.toMatchObject({ status: 401 })
    expect(run.runOnce).toHaveBeenCalledTimes(1)
  })

  it('토큰이 있을 때만 Authorization 머리를 싣는다', () => {
    expect(bearerHeaders(null)).toBeUndefined()
    expect(bearerHeaders('t')).toEqual({ Authorization: 'Bearer t' })
  })
})

describe('drivePdpJob — 진행 화면 run 반복', () => {
  it('탭 복귀 뒤 첫 run이 401이어도 200이 오면 끝까지 이어 간다(운영 첫 잡 3ac1adf4 모양)', async () => {
    const { deps, run } = driveDeps([
      { job: job('images', 70, 3) },
      unauthorized(),
      { job: job('images', 75, 6) },
      { job: job('compose', 90, 8) },
      { job: job('done', 100, 8) },
    ])
    await expect(drivePdpJob(deps)).resolves.toBe('settled')
    expect(run.tokens).toEqual([null, null, 'fresh-1', null, null])
    expect(deps.onJob).toHaveBeenCalledTimes(4)
    expect(deps.onJob).toHaveBeenLastCalledWith(expect.objectContaining({ current_step: 'done' }))
  })

  it('연속 401이 상한을 넘으면 401로 멈춘다(호출부가 사유를 띄우고 계속 실행 칸을 연다)', async () => {
    const { deps, run } = driveDeps([{ job: job('images', 70, 3) }, unauthorized()])
    await expect(drivePdpJob(deps)).rejects.toMatchObject({ status: 401 })
    expect(run.runOnce).toHaveBeenCalledTimes(1 + AUTH_RETRY_LIMITS.maxRetries + 1)
    expect(deps.onJob).toHaveBeenCalledTimes(1)
  })

  it('401 다시 보내기는 run 호출 수에 세지 않는다 — 진행한 run만 상한에 닿는다', async () => {
    const { deps } = driveDeps([{ job: job('images', 70, 3) }, unauthorized(), unauthorized(), { job: job('images', 75, 6) }])
    await expect(drivePdpJob(deps, { ...PDP_DRIVE_LIMITS, maxRunCalls: 2 })).resolves.toBe('limit')
    expect(deps.onJob).toHaveBeenCalledTimes(2)
  })

  it('busy 대기·정체 판정·401 밖의 오류는 지금 그대로다', async () => {
    const busy = driveDeps([{ job: job('images', 70, 3), busy: true }])
    await expect(drivePdpJob(busy.deps, { ...PDP_DRIVE_LIMITS, maxBusyWaits: 2 })).resolves.toBe('busy')
    expect(busy.deps.sleep).toHaveBeenCalledWith(PDP_DRIVE_LIMITS.busyMs)
    expect(busy.deps.refreshToken).not.toHaveBeenCalled()

    const stalled = driveDeps([{ job: job('images', 70, 3) }])
    await expect(drivePdpJob(stalled.deps)).resolves.toBe('stalled')
    expect(stalled.run.runOnce).toHaveBeenCalledTimes(2)

    const broken = driveDeps([{ job: job('images', 70, 3) }, new PdpApiError('요청 실패(504)', 504)])
    await expect(drivePdpJob(broken.deps)).rejects.toMatchObject({ status: 504 })
    expect(broken.run.runOnce).toHaveBeenCalledTimes(2)
  })
})

/** 진행 화면 배선과 같은 모양 — 잡마다 singleFlight 하나, 첫 불러오기·버튼·탭 복귀가 모두 drive()를 부른다 */
function progressScreen(steps: Step[]) {
  const { deps, run } = driveDeps(steps)
  const flight = createSingleFlight()
  let latest: PdpJobRow | null = null
  const ends: string[] = []
  const drive = () =>
    flight.run(async () => {
      try {
        ends.push(await drivePdpJob({ ...deps, onJob: (j) => (latest = j) }))
      } catch (e) {
        ends.push(isUnauthorized(e) ? 'auth' : 'error')
      }
    })
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const win = new EventTarget()
  const stop = onTabVisible(doc, win, () => {
    if (shouldResumeOnVisible(latest, flight.running())) void drive()
  })
  return { run, flight, drive, doc, win, stop, ends, latest: () => latest }
}

describe('탭이 다시 보이면 미완료 잡을 이어 간다 — drive는 하나만', () => {
  it('401 상한으로 멈춘 잡은 탭이 다시 보이면 이어서 끝까지 간다', async () => {
    const steps: Step[] = [{ job: job('images', 70, 3) }, ...Array(AUTH_RETRY_LIMITS.maxRetries + 1).fill(unauthorized())]
    const screen = progressScreen(steps)
    await screen.drive()
    expect(screen.ends).toEqual(['auth'])
    steps.push({ job: job('images', 80, 6) }, { job: job('done', 100, 8) })

    screen.doc.visibilityState = 'hidden'
    screen.doc.dispatchEvent(new Event('visibilitychange'))
    expect(screen.flight.running()).toBe(false)

    screen.doc.visibilityState = 'visible'
    screen.doc.dispatchEvent(new Event('visibilitychange'))
    expect(screen.flight.running()).toBe(true)
    await vi.waitFor(() => expect(screen.flight.running()).toBe(false))
    expect(screen.ends).toEqual(['auth', 'settled'])
    expect(screen.latest()?.current_step).toBe('done')
  })

  it('도는 drive가 있으면 visibilitychange·pageshow·버튼이 겹쳐 와도 run은 한 줄로만 간다', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const screen = progressScreen([
      { job: job('images', 70, 3) },
      async () => {
        await gate
        return { job: job('images', 75, 6) }
      },
      { job: job('done', 100, 8) },
    ])
    const first = screen.drive()
    expect(first).not.toBeNull()
    // 두 번째 run이 응답을 기다리는 사이(탭이 뒤에 있어 늦게 처리되는 모양) 탭이 돌아온다
    await vi.waitFor(() => expect(screen.run.runOnce).toHaveBeenCalledTimes(2))
    expect(screen.latest()?.current_step).toBe('images')
    screen.doc.dispatchEvent(new Event('visibilitychange'))
    screen.win.dispatchEvent(new Event('pageshow'))
    expect(screen.drive()).toBeNull()
    expect(screen.run.runOnce).toHaveBeenCalledTimes(2)
    release()
    await first
    expect(screen.ends).toEqual(['settled'])
    expect(screen.run.runOnce).toHaveBeenCalledTimes(3)
  })

  it('끝난 잡·실패 잡·아직 안 불러온 잡은 탭이 보여도 부르지 않는다(실패 재시도는 사람이 누른다)', async () => {
    expect(shouldResumeOnVisible(null, false)).toBe(false)
    expect(shouldResumeOnVisible(job('done', 100), false)).toBe(false)
    expect(shouldResumeOnVisible(job('failed', 70), false)).toBe(false)
    expect(shouldResumeOnVisible(job('images', 70), true)).toBe(false)
    expect(shouldResumeOnVisible(job('images', 70), false)).toBe(true)

    const screen = progressScreen([{ job: job('failed', 70, 3, { error: '단계 실패' }) }])
    await screen.drive()
    screen.doc.dispatchEvent(new Event('visibilitychange'))
    screen.win.dispatchEvent(new Event('pageshow'))
    expect(screen.flight.running()).toBe(false)
    expect(screen.run.runOnce).toHaveBeenCalledTimes(1)
  })

  it('듣기를 그만두면 탭이 보여도 부르지 않는다(화면이 닫힘)', async () => {
    const screen = progressScreen([{ job: job('images', 70, 3) }])
    await screen.drive()
    const calls = screen.run.runOnce.mock.calls.length
    screen.stop()
    screen.doc.dispatchEvent(new Event('visibilitychange'))
    screen.win.dispatchEvent(new Event('pageshow'))
    expect(screen.flight.running()).toBe(false)
    expect(screen.run.runOnce).toHaveBeenCalledTimes(calls)
  })
})

describe('구독 작업자 잡 기다리기(R13c) — busy + worker는 잠금 busy 상한 밖', () => {
  const T0 = Date.parse('2026-11-09T00:00:00.000Z')
  const at = (ms: number) => new Date(T0 + ms).toISOString()
  /** 작업자가 진행 중인 응답 — updated_at은 작업자 저장 시각 */
  const byWorker = (progress: number, images: number, savedAtMs: number): Step => ({
    job: job('images', progress, images, { updated_at: at(savedAtMs) }),
    busy: true,
    worker: true,
  })
  const waitsOf = (ms: number) => ms / WORKER_WAIT_LIMITS.workerMs

  it('작업자 잡 25분(잠금 busy 상한 90번을 훨씬 넘게) 동안 멈추지 않고 진행을 그리다가, 끝나면 멈춘다', async () => {
    // 10초마다 묻고, 작업자는 1분마다 저장한다(장수·비용이 는다) — 25분 = 150번
    const steps: Step[] = Array.from({ length: waitsOf(25 * 60_000) }, (_, n) => {
      const minute = Math.floor((n * WORKER_WAIT_LIMITS.workerMs) / 60_000)
      return byWorker(40 + minute * 2, minute, minute * 60_000)
    })
    steps.push({ job: job('done', 100, 25) })
    const onWorker = vi.fn()
    const { deps, run } = driveDeps(steps, { onWorker })
    await expect(drivePdpJob(deps)).resolves.toBe('settled')
    expect(run.runOnce).toHaveBeenCalledTimes(steps.length)
    expect(steps.length - 1).toBeGreaterThan(PDP_DRIVE_LIMITS.maxBusyWaits)
    expect(deps.sleep).toHaveBeenCalledWith(WORKER_WAIT_LIMITS.workerMs)
    expect(deps.sleep).not.toHaveBeenCalledWith(PDP_DRIVE_LIMITS.busyMs)
    // 응답마다 받은 잡을 그린다(단계·장수·비용) — 작업자 진행 안내는 끝 응답에서 꺼진다
    expect(deps.onJob).toHaveBeenCalledTimes(steps.length)
    expect(deps.onJob).toHaveBeenNthCalledWith(100, expect.objectContaining({ progress: 40 + 16 * 2, cost_usd: (40 + 16 * 2) / 100 }))
    expect(onWorker.mock.calls.slice(0, -1).every(([active]) => active === true)).toBe(true)
    expect(onWorker).toHaveBeenLastCalledWith(false)
  })

  it('작업자 대기가 실패로 끝나도 지금처럼 멈춘다(실패 재시도는 사람이 누른다)', async () => {
    const { deps } = driveDeps([byWorker(70, 3, 0), byWorker(72, 4, 60_000), { job: job('failed', 72, 4, { error: '단계 실패' }) }])
    await expect(drivePdpJob(deps)).resolves.toBe('settled')
    expect(deps.onJob).toHaveBeenLastCalledWith(expect.objectContaining({ current_step: 'failed' }))
  })

  it('잠금 busy(worker 없음)는 상한 그대로 — 90번 넘게 이어지면 멈춘다', async () => {
    const { deps, run } = driveDeps([{ job: job('images', 70, 3), busy: true }])
    await expect(drivePdpJob(deps)).resolves.toBe('busy')
    expect(run.runOnce).toHaveBeenCalledTimes(PDP_DRIVE_LIMITS.maxBusyWaits + 1)
  })

  it(`updated_at이 ${WORKER_WAIT_LIMITS.staleMs / 60_000}분 그대로면(서버도 넘겨받지 못함) 멈추고 사유를 띄운다`, async () => {
    const { deps, run } = driveDeps([byWorker(70, 3, 0)])
    await expect(drivePdpJob(deps)).resolves.toBe('worker-stale')
    expect(run.runOnce).toHaveBeenCalledTimes(waitsOf(WORKER_WAIT_LIMITS.staleMs) + 1)
    expect(workerGiveUpMessage('worker-stale')).toContain('15분 넘게')
  })

  it(`작업자가 저장을 이어 가도 전체 ${WORKER_WAIT_LIMITS.maxWaitMs / 60_000}분을 넘으면 멈춘다(작업은 서버에서 이어진다)`, async () => {
    let n = 0
    const runOnce = vi.fn(async () => {
      n += 1
      return { job: job('images', 70, 3, { updated_at: at(n * 1000) }), busy: true, worker: true }
    })
    const { deps } = driveDeps([], { runOnce })
    await expect(drivePdpJob(deps)).resolves.toBe('worker-limit')
    expect(runOnce).toHaveBeenCalledTimes(waitsOf(WORKER_WAIT_LIMITS.maxWaitMs) + 1)
    expect(workerGiveUpMessage('worker-limit')).toContain('60분')
  })

  it('작업자 대기는 run 호출 수·정체 판정에 세지 않는다 — 넘겨받은 뒤 웹 run은 지금 규칙대로', async () => {
    // 작업자 대기 120번(updated_at은 30번마다 바뀐다) 뒤 웹 run 두 번이 같은 응답 → 정체
    const steps: Step[] = Array.from({ length: 120 }, (_, k) => byWorker(70, 3, Math.floor(k / 30) * 300_000))
    steps.push({ job: job('images', 75, 6) }, { job: job('images', 75, 6) })
    const { deps, run } = driveDeps(steps)
    await expect(drivePdpJob(deps, { ...PDP_DRIVE_LIMITS, maxRunCalls: 3 })).resolves.toBe('stalled')
    expect(run.runOnce).toHaveBeenCalledTimes(122)
  })

  it('작업자가 잠금을 쥔 채 죽어도 서버가 넘겨받을 때까지 기다린다(잠금 340초 + 무응답 5분 < staleMs)', async () => {
    expect(WORKER_WAIT_LIMITS.staleMs).toBeGreaterThan(PDP_RUN_LEASE_MS + WORKER_STALE_MS + WORKER_WAIT_LIMITS.workerMs)
    let now = T0
    const leased = job('images', 70, 3, { model_backend: 'subscription', updated_at: at(PDP_RUN_LEASE_MS) })
    let takenOverAt: number | null = null
    const runOnce = vi.fn(async () => {
      if (takenOverAt === null && webRunTurn(leased, now) === 'worker') return { job: leased, busy: true, worker: true }
      takenOverAt ??= now
      return { job: job('done', 100, 8) }
    })
    const sleep = vi.fn(async (ms: number) => {
      now += ms
    })
    const { deps } = driveDeps([], { runOnce, sleep })
    await expect(drivePdpJob(deps)).resolves.toBe('settled')
    expect(takenOverAt).not.toBeNull()
    const waited = (takenOverAt ?? 0) - T0
    expect(waited).toBeGreaterThanOrEqual(PDP_RUN_LEASE_MS + WORKER_STALE_MS)
    expect(waited).toBeLessThan(WORKER_WAIT_LIMITS.staleMs)
  })

  it('작업자 대기 중 401도 지금처럼 토큰을 새로 받아 다시 보낸다', async () => {
    const { deps, run } = driveDeps([byWorker(70, 3, 0), unauthorized(), byWorker(72, 4, 60_000), { job: job('done', 100, 8) }])
    await expect(drivePdpJob(deps)).resolves.toBe('settled')
    expect(run.tokens).toEqual([null, null, 'fresh-1', null])
  })

  it('createWorkerWait — updated_at이 바뀌면 그대로인 시간을 처음부터 센다', () => {
    const wait = createWorkerWait({ workerMs: 1, staleMs: 3, maxWaitMs: 100 })
    const seen = ['a', 'a', 'a', 'b', 'b', 'b', 'b'].map((u) => wait.next({ updated_at: u }))
    expect(seen).toEqual([null, null, null, null, null, null, 'worker-stale'])
  })
})

describe('구독 멈춤(AX-CT-29) — halted 응답이면 대기를 멈추고 멈춤 상자를 띄운다', () => {
  const halt = { at: '2026-11-12T01:00:00.000Z', stage: 'design', reason: 'quota' as const, detail: '한도' }
  const workerBusy = (savedAtMs: number): Step => ({ job: job('design', 40, 0, { updated_at: new Date(Date.parse('2026-11-12T01:00:00Z') + savedAtMs).toISOString() }), busy: true, worker: true })
  const halted = (extra: Partial<PdpJobRow> = {}) => job('design', 40, 0, { section_plan: { subscription_halt: halt }, ...extra })

  it('halted 응답이면 job을 화면에 알리고 더 부르지 않고 halted로 끝난다(작업자 대기·잠금 busy·정체에 세지 않는다)', async () => {
    const { deps, run } = driveDeps([{ job: halted(), halted: true }, { job: job('done', 100, 8) }])
    await expect(drivePdpJob(deps)).resolves.toBe('halted')
    expect(run.runOnce).toHaveBeenCalledTimes(1)
  })

  it('작업자 대기 도중에 halted가 오면 거기서 멈춘다', async () => {
    const { deps, run } = driveDeps([workerBusy(0), workerBusy(10_000), { job: halted(), halted: true }, { job: job('done', 100, 8) }])
    await expect(drivePdpJob(deps)).resolves.toBe('halted')
    expect(run.runOnce).toHaveBeenCalledTimes(3)
  })

  it('멈춤 기록이 있는 잡은 탭이 다시 보여도 이어 가지 않는다 — 기록이 없는 잡은 지금과 같다', () => {
    expect(shouldResumeOnVisible(halted(), false)).toBe(false)
    expect(shouldResumeOnVisible(job('design', 40), false)).toBe(true)
    expect(shouldResumeOnVisible(job('design', 40, 0, { section_plan: {} }), false)).toBe(true)
  })

  it('멈춤 기록 읽기 · 사유 쉬운 말 · 상자 문구', () => {
    expect(subscriptionHaltOf(halted())).toEqual(halt)
    expect(subscriptionHaltOf(job('design', 40))).toBeNull()
    expect(SUBSCRIPTION_HALT_REASON_LABELS).toEqual({
      worker_stale: '작업자가 5분 넘게 응답 없음',
      quota: '구독 한도 소진',
      unavailable: '구독 로그인 만료 또는 쓸 수 없는 모델',
      timeout: '구독 응답 시간 초과',
      process: '구독 실행 실패',
    })
    const text = subscriptionHaltMessage(halt, '섹션 디자인')
    expect(text).toContain('단계: 섹션 디자인')
    expect(text).toContain('사유: 구독 한도 소진')
    expect(text).toContain('API 로 대신 진행하지 않습니다')
    expect(text).toContain("'이어 하기'")
  })
})

describe('작업자 대기 상한 문구 — 구독 멈춤 표지 잡(AX-CT-29 검수 3)', () => {
  it('stop 잡의 정체(worker-stale)는 차례 대기 문구 — 서버가 넘겨받는다는 말이 없다. 표지 없는 잡·시간 상한 문구는 그대로', () => {
    const stop = workerGiveUpMessage('worker-stale', undefined, true)
    expect(stop).toContain('앞 잡을 진행 중')
    expect(stop).toContain('API로 대신 진행하지 않습니다')
    expect(stop).not.toContain('넘겨받지')
    expect(workerGiveUpMessage('worker-stale')).toBe(workerGiveUpMessage('worker-stale', undefined, false))
    expect(workerGiveUpMessage('worker-stale')).toContain('넘겨받지 못했습니다')
    expect(workerGiveUpMessage('worker-limit', undefined, true)).toBe(workerGiveUpMessage('worker-limit'))
  })
})
