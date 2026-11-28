/**
 * 구독 작업자 잡(R13) — 잡 표지 정하기(새 배치 + 스위치 on만), 웹 run 차례(작업자·넘겨받기·웹), 넘겨받기는 표지를 API로 바꾼
 * spec_sheet로 조건부 저장, 잇기 기록은 section_plan.subscription_fallback에 더한다(상한 100). 잡 저장소는 모의.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ update: vi.fn(), get: vi.fn(), updateJob: vi.fn(), recordRun: vi.fn(async () => ({ recorded: true })) }))
vi.mock('./pdp-jobs', async (orig) => ({
  isPdpJobLeased: (await orig<typeof import('./pdp-jobs')>()).isPdpJobLeased,
  updatePdpJobIfUnchanged: (...a: unknown[]) => h.update(...a),
  getPdpJob: (...a: unknown[]) => h.get(...a),
  updatePdpJob: (...a: unknown[]) => h.updateJob(...a),
}))
vi.mock('@/lib/ops/job-runs', async (orig) => ({
  ...(await orig<typeof import('@/lib/ops/job-runs')>()),
  recordJobRun: (...args: unknown[]) => (h.recordRun as (...a: unknown[]) => unknown)(...args),
}))

import type { SubscriptionFallbackRecord } from '@/lib/agents/llm/subscription-fallback'
import type { PdpJobRow } from './pdp-state'
import {
  haltForSubscription,
  haltStopJobAfterSoftStop,
  listOtherSubscriptionJobs,
  PDP_SUBSCRIPTION_STOP_ENV,
  PDP_SUBSCRIPTION_WORKER_ENV,
  recordSubscriptionFallbacks,
  resolveJobModelBackend,
  resolveJobSubscriptionStop,
  softStopOf,
  subscriptionResumePatch,
  takeOverFromWorker,
  WORKER_STALE_MS,
  webRunTurn,
} from './pdp-subscription'

const NOW = Date.parse('2026-11-09T02:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()
const db = {} as never

function job(overrides: Partial<PdpJobRow> = {}): PdpJobRow {
  return {
    id: 'job-1234567890',
    user_id: 'user-1',
    spec_sheet: { productName: '컵' },
    section_plan: {},
    current_step: 'design',
    updated_at: iso(NOW - 60_000),
    model_batch: 'new',
    model_route_snapshot: null,
    model_backend: 'subscription',
    ...overrides,
  } as PdpJobRow
}

const record = (i: number): SubscriptionFallbackRecord => ({
  stage: 'copywriting',
  agent: 'registration/pdp-copy',
  model: 'claude-opus-5-5',
  backend: 'claude-cli',
  reason: 'quota',
  detail: `한도 ${i}`,
  apiSuccess: true,
  costUsd: 0.1,
  at: iso(NOW),
})

beforeEach(() => h.update.mockReset())

describe('resolveJobModelBackend', () => {
  it('새 배치 + 스위치 on만 구독 — 지금 배치·스위치 없음·다른 값은 API', () => {
    expect(resolveJobModelBackend('new', { [PDP_SUBSCRIPTION_WORKER_ENV]: 'on' })).toBe('subscription')
    expect(resolveJobModelBackend('new', { [PDP_SUBSCRIPTION_WORKER_ENV]: ' on ' })).toBe('subscription')
    expect(resolveJobModelBackend('now', { [PDP_SUBSCRIPTION_WORKER_ENV]: 'on' })).toBe('api')
    expect(resolveJobModelBackend('new', {})).toBe('api')
    expect(resolveJobModelBackend('new', { [PDP_SUBSCRIPTION_WORKER_ENV]: 'true' })).toBe('api')
  })
})

describe('webRunTurn', () => {
  it('표지 없는 잡·끝난 잡·멈춘 잡은 웹이 진행한다', () => {
    expect(webRunTurn(job({ model_backend: undefined }), NOW)).toBe('web')
    expect(webRunTurn(job({ current_step: 'done' }), NOW)).toBe('web')
    expect(webRunTurn(job({ current_step: 'failed', updated_at: iso(NOW - 3_600_000) }), NOW)).toBe('web')
  })

  it('작업자가 잠금을 쥐었거나 마지막 저장이 5분 안이면 작업자 차례, 5분 넘게 아무도 저장하지 않았으면 넘겨받기', () => {
    expect(webRunTurn(job({ updated_at: iso(NOW + 300_000) }), NOW)).toBe('worker')
    expect(webRunTurn(job({ updated_at: iso(NOW - WORKER_STALE_MS + 1_000) }), NOW)).toBe('worker')
    expect(webRunTurn(job({ updated_at: iso(NOW - WORKER_STALE_MS) }), NOW)).toBe('takeover')
    expect(webRunTurn(job({ updated_at: 'bad' }), NOW)).toBe('takeover')
  })
})

describe('takeOverFromWorker', () => {
  it('표지를 뺀 spec_sheet로 조건부 저장한다(배치·스냅숏 키는 그대로)', async () => {
    const taken = job({ model_backend: 'api' })
    h.update.mockResolvedValue(taken)
    const current = job({ model_route_snapshot: { research: { model: 'gpt-6.1-sol', maxTokens: 8000 } } })
    await expect(takeOverFromWorker(db, 'user-1', current)).resolves.toBe(taken)
    expect(h.update).toHaveBeenCalledWith(db, 'user-1', current, {
      specSheet: { productName: '컵', modelBatch: 'new', modelRouteSnapshot: { research: { model: 'gpt-6.1-sol', maxTokens: 8000 } } },
    })
  })

  it('그사이 작업자가 저장했으면 null', async () => {
    h.update.mockResolvedValue(null)
    await expect(takeOverFromWorker(db, 'user-1', job())).resolves.toBeNull()
  })
})

describe('recordSubscriptionFallbacks', () => {
  it('기록이 없으면 저장하지 않고 그 잡을 돌려준다', async () => {
    const current = job()
    await expect(recordSubscriptionFallbacks(db, 'user-1', current, [])).resolves.toBe(current)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('있던 기록 뒤에 더해 조건부 저장한다 — 다른 section_plan 칸은 그대로, 상한 100(오래된 것부터 버린다)', async () => {
    const saved = job()
    h.update.mockResolvedValue(saved)
    const current = job({ section_plan: { reasoning: '근거', subscription_fallback: [record(0)] } })
    await expect(recordSubscriptionFallbacks(db, 'user-1', current, [record(1)])).resolves.toBe(saved)
    expect(h.update.mock.calls[0][3]).toEqual({
      sectionPlan: { reasoning: '근거', subscription_fallback: [record(0), record(1)] },
    })

    const many = Array.from({ length: 100 }, (_, i) => record(i))
    await recordSubscriptionFallbacks(db, 'user-1', job({ section_plan: { subscription_fallback: many } }), [record(100)])
    const merged = h.update.mock.calls[1][3].sectionPlan.subscription_fallback as SubscriptionFallbackRecord[]
    expect(merged).toHaveLength(100)
    expect(merged[0].detail).toBe('한도 1')
    expect(merged.at(-1)?.detail).toBe('한도 100')
  })

  it('저장 0행·저장 오류면 경고만 하고 그 잡을 돌려준다(잡 결과는 그대로)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const current = job()
    h.update.mockResolvedValueOnce(null)
    await expect(recordSubscriptionFallbacks(db, 'user-1', current, [record(1)])).resolves.toBe(current)
    h.update.mockRejectedValueOnce(new Error('db down'))
    await expect(recordSubscriptionFallbacks(db, 'user-1', current, [record(1)])).resolves.toBe(current)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

// ─── 구독 멈춤 표지 잡(AX-CT-29) ─────────────────────────────────────────

const stopJob = (overrides: Partial<PdpJobRow> = {}) => job({ subscription_stop: true, ...overrides })

describe('resolveJobSubscriptionStop', () => {
  it("구독 표지 잡 + env 'on'(앞뒤 공백·대소문자 무시)일 때만 — 없음·off·true·1·API 잡은 false", () => {
    const env = (v?: string) => (v === undefined ? {} : { [PDP_SUBSCRIPTION_STOP_ENV]: v })
    expect(resolveJobSubscriptionStop('subscription', env('on'))).toBe(true)
    expect(resolveJobSubscriptionStop('subscription', env(' ON '))).toBe(true)
    for (const v of [undefined, '', 'off', 'true', '1', 'yes']) expect(resolveJobSubscriptionStop('subscription', env(v))).toBe(false)
    expect(resolveJobSubscriptionStop('api', env('on'))).toBe(false)
  })
})

describe('webRunTurn — 구독 멈춤 표지 잡', () => {
  const HALT = { at: iso(NOW), stage: 'design', reason: 'worker_stale' as const, detail: '' }

  it('표지 없는 구독 잡은 지금과 같다 — 표지 칸이 false여도 멈춤 기록이 있어도 웹 판정은 그대로(현재 시험과 같은 결과)', () => {
    expect(webRunTurn(job({ updated_at: iso(NOW - WORKER_STALE_MS) }), NOW)).toBe('takeover')
    expect(webRunTurn(job({ updated_at: iso(NOW - WORKER_STALE_MS), subscription_stop: false }), NOW)).toBe('takeover')
    expect(webRunTurn(job({ current_step: 'failed' }), NOW)).toBe('web')
    expect(webRunTurn(job({ current_step: 'done' }), NOW)).toBe('web')
    // 잡 둘 판정 재료를 넘겨도 표지 없는 잡은 같다
    expect(webRunTurn(job({ updated_at: iso(NOW - WORKER_STALE_MS) }), NOW, [{ updated_at: iso(NOW) }])).toBe('takeover')
  })

  it('stop 잡은 웹이 진행하지 않는다 — done·failed는 읽기만(read), 멈춤 기록이 있으면 halted', () => {
    expect(webRunTurn(stopJob({ current_step: 'done' }), NOW)).toBe('read')
    expect(webRunTurn(stopJob({ current_step: 'failed', updated_at: iso(NOW - 3_600_000) }), NOW)).toBe('read')
    expect(webRunTurn(stopJob({ section_plan: { subscription_halt: HALT } }), NOW)).toBe('halted')
    expect(webRunTurn(stopJob({ section_plan: { subscription_halt: HALT }, updated_at: iso(NOW - 3_600_000) }), NOW)).toBe('halted')
  })

  it('진행 중 stop 잡 — 잠금·5분 안 저장은 worker, 5분 넘게 조용하면 takeover가 아니라 halt(표지는 API로 바꾸지 않는다)', () => {
    expect(webRunTurn(stopJob({ updated_at: iso(NOW + 300_000) }), NOW)).toBe('worker')
    expect(webRunTurn(stopJob({ updated_at: iso(NOW - WORKER_STALE_MS + 1_000) }), NOW)).toBe('worker')
    expect(webRunTurn(stopJob({ updated_at: iso(NOW - WORKER_STALE_MS) }), NOW)).toBe('halt')
    expect(webRunTurn(stopJob({ updated_at: 'bad' }), NOW)).toBe('halt')
  })

  it('작업자 생존(가) — 같은 사용자의 다른 구독 잡이 잠금을 쥐었거나 5분 안에 저장했으면 6분 조용해도 halted·halt가 아니다', () => {
    const quiet = stopJob({ updated_at: iso(NOW - 6 * 60_000) })
    // 첫 잡에 잠금(미래 시각) → 둘째 잡은 6분 지나도 worker
    expect(webRunTurn(quiet, NOW, [{ updated_at: iso(NOW + 300_000) }])).toBe('worker')
    // 첫 잡이 잠금 없이 5분 안에 저장 → worker
    expect(webRunTurn(quiet, NOW, [{ updated_at: iso(NOW - 4 * 60_000) }])).toBe('worker')
    // 첫 잡도 5분 넘게 조용 → 멈춤
    expect(webRunTurn(quiet, NOW, [{ updated_at: iso(NOW - 6 * 60_000) }])).toBe('halt')
    expect(webRunTurn(quiet, NOW, [{ updated_at: iso(NOW - 6 * 60_000) }, { updated_at: iso(NOW - 10 * 60_000) }])).toBe('halt')
    // 하나라도 살아 있으면 worker
    expect(webRunTurn(quiet, NOW, [{ updated_at: iso(NOW - 6 * 60_000) }, { updated_at: iso(NOW - 60_000) }])).toBe('worker')
  })
})

describe('haltForSubscription — 웹이 작업자 무응답을 판정했을 때', () => {
  const runs = h.recordRun
  const jobRunsDb = {} as never
  beforeEach(() => runs.mockReset())

  it('표지는 그대로 subscription — section_plan.subscription_halt(worker_stale)와 error 한 줄을 조건부 저장하고 사건 줄 1개(failed)를 남긴다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const current = stopJob({ section_plan: { reasoning: '근거' }, updated_at: iso(NOW - 6 * 60_000) })
    // 주의: 위 beforeEach가 mockReset()의 결과(이 모의)를 돌려줘 vitest가 정리 함수로 인자 없이 부른다 — 인자가 없으면 아무것도 안 한다
    h.update.mockImplementation(async (...args: unknown[]) => {
      const patch = args[3] as { sectionPlan: PdpJobRow['section_plan']; error: string } | undefined
      return patch ? { ...current, section_plan: patch.sectionPlan, error: patch.error } : undefined
    })
    const saved = await haltForSubscription(jobRunsDb, 'user-1', current, 'worker_stale', '작업자 무응답', NOW)
    expect(h.update).toHaveBeenCalledTimes(1)
    const patch = h.update.mock.calls[0][3]
    expect(Object.keys(patch).sort()).toEqual(['error', 'sectionPlan'])
    expect(patch).not.toHaveProperty('specSheet')
    expect(patch.sectionPlan).toEqual({
      reasoning: '근거',
      subscription_halt: { at: iso(NOW), stage: 'design', reason: 'worker_stale', detail: '작업자 무응답' },
    })
    expect(patch.error).toBe('[design] 구독 작업자 멈춤 — 작업자가 5분 넘게 응답 없음 (작업자 무응답)')
    expect(saved?.model_backend).toBe('subscription')
    expect(runs).toHaveBeenCalledTimes(1)
    expect((runs.mock.calls[0] as unknown[])[1]).toMatchObject({
      jobKey: 'pdp-subscription-halt',
      status: 'failed',
      userId: 'user-1',
      detail: { job: 'job-1234', stage: 'design', reason: 'worker_stale' },
    })
    // 저장된 잡(멈춤 기록 있음)을 다시 불러도 저장·줄이 더 생기지 않는다
    await expect(haltForSubscription(jobRunsDb, 'user-1', saved!, 'worker_stale', '작업자 무응답', NOW + 60_000)).resolves.toBe(saved)
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(runs).toHaveBeenCalledTimes(1)
    // webRunTurn도 이제 halted
    expect(webRunTurn(saved!, NOW + 60_000)).toBe('halted')
  })

  it('그사이 작업자가 저장했으면(0행) null — 사건 줄도 쓰지 않는다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.update.mockResolvedValue(null)
    await expect(haltForSubscription(jobRunsDb, 'user-1', stopJob(), 'worker_stale', '', NOW)).resolves.toBeNull()
    expect(runs).not.toHaveBeenCalled()
  })
})

describe('haltStopJobAfterSoftStop — 단계 안 구독 소프트 종료·프로세스 실패', () => {
  const runs = h.recordRun
  const jobRunsDb = {} as never
  beforeEach(() => {
    runs.mockReset()
    h.get.mockReset()
    h.update.mockReset()
    h.updateJob.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('지금 잡의 section_plan에 멈춤 기록을 합쳐 다시 읽은 잡 기준 조건부로 저장하고(단계가 쓴 칸 보존) 사건 줄 1개를 남긴다', async () => {
    const fresh = stopJob({ section_plan: { reasoning: '근거', activated_sections: ['hook'] } as never })
    h.get.mockResolvedValue(fresh)
    h.update.mockImplementation(async (_d: unknown, _u: string, _j: unknown, patch: Record<string, unknown>) => ({ ...fresh, ...patch }))
    await haltStopJobAfterSoftStop(jobRunsDb, 'user-1', stopJob(), { reason: 'quota', message: '한도 소진' }, 'copywriting', NOW)
    expect(h.update.mock.calls[0][2]).toBe(fresh) // 다시 읽은 잡의 updated_at 이 그대로일 때만
    const patch = h.update.mock.calls[0][3]
    expect(patch.sectionPlan).toMatchObject({
      reasoning: '근거',
      subscription_halt: { at: iso(NOW), stage: 'copywriting', reason: 'quota', detail: '한도 소진' },
    })
    expect(patch.error).toContain('[copywriting] 구독 작업자 멈춤 — 구독 한도 소진')
    expect(h.updateJob).not.toHaveBeenCalled() // 조건 없는 저장 0
    expect(runs).toHaveBeenCalledTimes(1)
    expect((runs.mock.calls[0] as unknown[])[1]).toMatchObject({ jobKey: 'pdp-subscription-halt', status: 'failed', detail: { stage: 'copywriting', reason: 'quota', at: iso(NOW) } })
  })

  it('이미 멈춤 기록이 있으면 기록·사건 줄을 더하지 않고 error만 같은 글로 조건부 저장한다(잠금은 이 저장이 푼다)', async () => {
    const halted = stopJob({ section_plan: { subscription_halt: { at: iso(NOW), stage: 'design', reason: 'process', detail: 'x' } } })
    h.get.mockResolvedValue(halted)
    h.update.mockImplementation(async (_d: unknown, _u: string, _j: unknown, patch: Record<string, unknown>) => ({ ...halted, ...patch }))
    await haltStopJobAfterSoftStop(jobRunsDb, 'user-1', stopJob(), { reason: 'quota', message: '한도' }, 'design', NOW)
    expect(Object.keys(h.update.mock.calls[0][3])).toEqual(['error'])
    expect(runs).not.toHaveBeenCalled()
  })

  it('덮어쓰기 경합(재검수 지적 1): 다시 읽은 뒤 웹이 먼저 멈춤을 기록했으면 0행 → 다시 읽어 웹의 기록을 지키고 사건 줄을 더 쓰지 않는다', async () => {
    const before = stopJob({ section_plan: { reasoning: '근거' } as never })
    const webHalt = { at: '2026-11-12T05:00:00.000Z', stage: 'design', reason: 'worker_stale' as const, detail: '웹' }
    const byWeb = stopJob({ section_plan: { reasoning: '근거', subscription_halt: webHalt } as never, updated_at: iso(NOW + 1000) })
    h.get.mockResolvedValueOnce(before).mockResolvedValueOnce(byWeb)
    h.update.mockResolvedValueOnce(null).mockImplementationOnce(async (_d: unknown, _u: string, _j: unknown, patch: Record<string, unknown>) => ({ ...byWeb, ...patch }))
    const out = await haltStopJobAfterSoftStop(jobRunsDb, 'user-1', stopJob(), { reason: 'quota', message: '한도' }, 'design', NOW)
    expect(h.update).toHaveBeenCalledTimes(2)
    expect(h.update.mock.calls[1][2]).toBe(byWeb)
    expect(Object.keys(h.update.mock.calls[1][3])).toEqual(['error']) // 웹 기록(section_plan)은 건드리지 않는다
    expect(out.section_plan.subscription_halt).toEqual(webHalt)
    expect(runs).not.toHaveBeenCalled() // 사건은 웹이 쓴 한 줄뿐 — 알림 1번, 열린 채 남는 사건 없음
    expect(h.updateJob).not.toHaveBeenCalled()
  })

  it('세 번 모두 그사이 바뀌면 쓰지 않고 마지막에 읽은 잡을 돌려준다(사건 줄 0)', async () => {
    const fresh = stopJob({ section_plan: {} })
    h.get.mockResolvedValue(fresh)
    h.update.mockResolvedValue(null)
    const out = await haltStopJobAfterSoftStop(jobRunsDb, 'user-1', stopJob(), { reason: 'timeout', message: '시간' }, 'design', NOW)
    expect(h.update).toHaveBeenCalledTimes(3)
    expect(out).toBe(fresh)
    expect(runs).not.toHaveBeenCalled()
    expect(h.updateJob).not.toHaveBeenCalled()
  })
})

describe('softStopOf · subscriptionResumePatch · listOtherSubscriptionJobs', () => {
  it('softStopOf — LlmSoftStopError만, 사유는 stop.reason(모르는 값은 unavailable)', () => {
    const make = (reason: string) => Object.assign(new Error('[local-llm:soft-stop] x'), { name: 'LlmSoftStopError', stop: { backend: 'claude-cli', reason, message: 'm' } })
    expect(softStopOf(make('quota'))).toEqual({ reason: 'quota', message: 'm', backend: 'claude-cli' })
    expect(softStopOf(make('process'))?.reason).toBe('process')
    expect(softStopOf(make('weird'))?.reason).toBe('unavailable')
    expect(softStopOf(new Error('x'))).toBeNull()
    expect(softStopOf('x')).toBeNull()
  })

  it('subscriptionResumePatch — 멈춤 기록·error를 지우고, 실패한 잡만 단계를 되돌린다(다른 section_plan 칸은 그대로)', () => {
    const halted = { at: iso(NOW), stage: 'design', reason: 'quota' as const, detail: '' }
    expect(subscriptionResumePatch({ section_images: [], section_plan: { reasoning: '근거', subscription_halt: halted }, current_step: 'design' }, 'design')).toEqual({
      sectionPlan: { reasoning: '근거' },
      error: null,
    })
    expect(subscriptionResumePatch({ section_images: [], section_plan: { subscription_halt: halted }, current_step: 'failed' }, 'copywriting')).toEqual({
      sectionPlan: {},
      error: null,
      currentStep: 'copywriting',
    })
  })

  it('listOtherSubscriptionJobs — 같은 사용자·구독 표지·진행 중·멈춤 기록 없음·이 잡 제외만 읽고 저장 시각만 돌려준다', async () => {
    const calls: unknown[][] = []
    const chain: Record<string, unknown> = {}
    for (const name of ['from', 'select', 'eq', 'not', 'neq', 'is']) chain[name] = (...a: unknown[]) => (calls.push([name, ...a]), chain)
    chain.limit = async () => ({ data: [{ id: 'j2', updated_at: iso(NOW) }], error: null })
    await expect(listOtherSubscriptionJobs(chain as never, 'user-1', 'job-1')).resolves.toEqual([{ updated_at: iso(NOW) }])
    expect(calls).toEqual([
      ['from', 'registration_pdp_jobs'],
      ['select', 'id, updated_at'],
      ['eq', 'user_id', 'user-1'],
      ['eq', 'spec_sheet->>modelBackend', 'subscription'],
      ['not', 'current_step', 'in', '(done,failed)'],
      ['neq', 'id', 'job-1'],
      ['is', 'section_plan->>subscription_halt', null],
    ])
    chain.limit = async () => ({ data: null, error: { message: 'boom' } })
    await expect(listOtherSubscriptionJobs(chain as never, 'user-1', 'job-1')).rejects.toThrow(/boom/)
  })
})
