import { describe, expect, it, vi } from 'vitest'
import type { EditorRegenRecord, PdpJobRow, PdpStep } from '@/lib/registration/pdp-state'
import { DRIVE_LIMITS, driveRegen, type DriveDeps } from './regenDriver'
import { RegenApiError } from '../services/regenApi'
import { AUTH_RETRY_LIMITS, WORKER_WAIT_LIMITS } from '@/lib/registration/pdp-run-driver'

const T0 = '2026-10-29T01:00:00.000Z'

function job(step: PdpStep, record: Partial<EditorRegenRecord> | null, extra: Partial<PdpJobRow> = {}): PdpJobRow {
  return {
    current_step: step,
    progress: step === 'done' ? 100 : 70,
    cost_usd: 0.1,
    error: null,
    section_images: [
      { section: 'hero', url: record?.status === 'done' ? 'https://img.test/new.png' : 'https://img.test/old.png', ...(record ? { editorRegen: { requestedAt: T0, status: 'pending', ...record } } : {}) },
    ],
    ...extra,
  } as unknown as PdpJobRow
}

function deps(runs: Array<{ job: PdpJobRow; busy?: boolean }>, gets: PdpJobRow[] = []): DriveDeps & { calls: { run: number; get: number } } {
  const calls = { run: 0, get: 0 }
  return {
    calls,
    api: {
      runOnce: vi.fn(async () => runs[Math.min(calls.run++, runs.length - 1)]),
      getJob: vi.fn(async () => gets[Math.min(calls.get++, gets.length - 1)]),
    },
    sleep: vi.fn(async () => {}),
    alive: () => true,
  }
}

describe('driveRegen — runner web(run 반복)', () => {
  it('busy는 기다렸다 다시 부르고, 그 섹션 기록이 done이 되면 새 url·이전 url로 끝난다', async () => {
    const d = deps([
      { job: job('images', { status: 'pending' }) },
      { job: job('images', { status: 'pending' }), busy: true },
      { job: job('compose', { status: 'done', previousUrl: 'https://img.test/old.png' }) },
    ])
    const onJob = vi.fn()
    const out = await driveRegen('j', 'hero', T0, 'web', { ...d, onJob })
    expect(out).toEqual({ state: 'done', url: 'https://img.test/new.png', previousUrl: 'https://img.test/old.png' })
    expect(d.calls.run).toBe(3)
    expect(onJob).toHaveBeenCalledTimes(3)
    expect(d.sleep).toHaveBeenCalledWith(DRIVE_LIMITS.busyMs)
  })

  it('rejected·잡 실패는 이전 이미지를 둔 채 사유와 함께 끝난다', async () => {
    expect(await driveRegen('j', 'hero', T0, 'web', deps([{ job: job('done', { status: 'rejected', message: '다른 상품' }) }]))).toEqual({ state: 'rejected', message: '다른 상품' })
    expect(await driveRegen('j', 'hero', T0, 'web', deps([{ job: job('failed', { status: 'pending' }, { error: '단계 실패' }) }]))).toEqual({ state: 'failed', message: '단계 실패' })
  })

  it('다른 요청의 done 기록은 결과로 보지 않는다 — 잡이 끝났는데 이 요청이 대기면 waiting', async () => {
    const out = await driveRegen('j', 'hero', T0, 'web', deps([{ job: job('done', { status: 'done', requestedAt: 'older' }) }]))
    expect(out.state).toBe('waiting')
  })

  it('같은 상태가 이어지면(정체) 상한 전에 waiting으로 멈추고, 화면이 닫히면 더 부르지 않는다', async () => {
    const stalled = deps([{ job: job('images', { status: 'pending' }) }])
    expect((await driveRegen('j', 'hero', T0, 'web', stalled)).state).toBe('waiting')
    expect(stalled.calls.run).toBe(DRIVE_LIMITS.maxStalls + 1)

    const closed = { ...deps([{ job: job('images', { status: 'pending' }) }]), alive: () => false }
    expect(await driveRegen('j', 'hero', T0, 'web', closed)).toEqual({ state: 'stopped' })
    expect(closed.calls.run).toBe(0)
  })
})

describe('driveRegen — runner local(코덱스, 읽기만)', () => {
  it('run을 부르지 않고 잡을 간격마다 읽어 결과를 기다린다', async () => {
    const d = deps([], [job('images', { status: 'pending' }), job('done', { status: 'done', previousUrl: 'https://img.test/old.png' })])
    const out = await driveRegen('j', 'hero', T0, 'local', d)
    expect(out.state).toBe('done')
    expect(d.calls.run).toBe(0)
    expect(d.calls.get).toBe(2)
    expect(d.sleep).toHaveBeenCalledWith(DRIVE_LIMITS.pollMs)
  })

  it('실행기가 처리하지 않으면 상한에서 waiting(서버 대기는 남는다)', async () => {
    const d = deps([], [job('images', { status: 'pending' })])
    const out = await driveRegen('j', 'hero', T0, 'local', d, { ...DRIVE_LIMITS, maxPolls: 3 })
    expect(out.state).toBe('waiting')
    expect(d.calls.get).toBe(3)
  })
})

describe('driveRegen — 401이면 토큰을 새로 받아 다시 보낸다(R12a, 진행 화면과 같은 규칙)', () => {
  const unauthorized = () => new RegenApiError('로그인이 필요합니다.', 401)

  it('web: run이 401이어도 새 토큰을 실어 다시 보내 결과까지 간다', async () => {
    const tokens: Array<string | null | undefined> = []
    const answers = [unauthorized(), { job: job('compose', { status: 'done', previousUrl: 'https://img.test/old.png' }) }]
    const d: DriveDeps = {
      api: {
        runOnce: vi.fn(async (_id: string, token?: string | null) => {
          const next = answers[Math.min(tokens.push(token) - 1, answers.length - 1)]
          if (next instanceof Error) throw next
          return next
        }),
        getJob: vi.fn(),
      },
      sleep: vi.fn(async () => {}),
      alive: () => true,
      refreshToken: vi.fn(async () => 'fresh'),
    }
    expect((await driveRegen('j', 'hero', T0, 'web', d)).state).toBe('done')
    expect(tokens).toEqual([null, 'fresh'])
    expect(d.sleep).toHaveBeenCalledWith(AUTH_RETRY_LIMITS.waitMs)
  })

  it('web: 연속 401이 상한을 넘으면 지금처럼 오류로 던진다(창이 사유를 띄운다)', async () => {
    const runOnce = vi.fn(async () => {
      throw unauthorized()
    })
    const d: DriveDeps = { api: { runOnce, getJob: vi.fn() }, sleep: vi.fn(async () => {}), alive: () => true, refreshToken: async () => null }
    await expect(driveRegen('j', 'hero', T0, 'web', d)).rejects.toMatchObject({ status: 401 })
    expect(runOnce).toHaveBeenCalledTimes(AUTH_RETRY_LIMITS.maxRetries + 1)
  })

  it('local: 잡 읽기가 401이어도 다시 읽어 이어 간다, 401 밖의 오류는 그대로 던진다', async () => {
    let gets = 0
    const getJob = vi.fn(async () => {
      if (++gets === 1) throw unauthorized()
      return job('done', { status: 'done', previousUrl: 'https://img.test/old.png' })
    })
    const d: DriveDeps = { api: { runOnce: vi.fn(), getJob }, sleep: vi.fn(async () => {}), alive: () => true }
    expect((await driveRegen('j', 'hero', T0, 'local', d)).state).toBe('done')
    expect(getJob).toHaveBeenCalledTimes(2)

    const broken: DriveDeps = {
      api: { runOnce: vi.fn(async () => { throw new RegenApiError('서버 오류', 500) }), getJob: vi.fn() },
      sleep: vi.fn(async () => {}),
      alive: () => true,
    }
    await expect(driveRegen('j', 'hero', T0, 'web', broken)).rejects.toMatchObject({ status: 500 })
    expect(broken.api.runOnce).toHaveBeenCalledTimes(1)
  })
})

describe('driveRegen — 구독 작업자 잡(R13c, busy + worker는 잠금 busy 상한 밖)', () => {
  const workerBusy = (savedAt: string) => ({ job: job('images', { status: 'pending' }, { updated_at: savedAt }), busy: true, worker: true })

  it('작업자가 재생성을 진행하는 동안 잠금 busy 상한(20번)을 넘게 기다렸다가 결과로 끝난다', async () => {
    const runs = [
      ...Array.from({ length: 40 }, (_, k) => workerBusy(`2026-11-09T00:0${Math.floor(k / 10)}:00.000Z`)),
      { job: job('compose', { status: 'done', previousUrl: 'https://img.test/old.png' }) },
    ]
    const d = deps(runs)
    const out = await driveRegen('j', 'hero', T0, 'web', d)
    expect(out).toEqual({ state: 'done', url: 'https://img.test/new.png', previousUrl: 'https://img.test/old.png' })
    expect(d.calls.run).toBe(41)
    expect(d.sleep).toHaveBeenCalledWith(WORKER_WAIT_LIMITS.workerMs)
  })

  it('작업자 쪽 저장이 오래 없으면 waiting(편집기를 다시 열면 이어서 반영), 잠금 busy 상한은 그대로', async () => {
    const stale = deps([workerBusy('2026-11-09T00:00:00.000Z')])
    const out = await driveRegen('j', 'hero', T0, 'web', stale)
    expect(out).toMatchObject({ state: 'waiting', reason: expect.stringContaining('구독 작업자') })
    expect(stale.calls.run).toBe(WORKER_WAIT_LIMITS.staleMs / WORKER_WAIT_LIMITS.workerMs + 1)

    const locked = deps([{ job: job('images', { status: 'pending' }), busy: true }])
    expect(await driveRegen('j', 'hero', T0, 'web', locked)).toMatchObject({ state: 'waiting', reason: expect.stringContaining('다른 곳') })
    expect(locked.calls.run).toBe(DRIVE_LIMITS.maxBusyWaits + 1)
  })
})
