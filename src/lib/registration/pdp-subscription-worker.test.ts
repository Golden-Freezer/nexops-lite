/**
 * Railway 구독 작업자 고리(R13) — env 점검(이름만), 큐 읽기 조건(표지 + 끝나지 않은 단계, 만든 순서), 잡 하나를 끝까지·정체·잠금·오류·
 * run 상한·종료 신호에서 멈추기, 한 바퀴. runPdpStep·DB는 모의.
 */

import { describe, expect, it, vi } from 'vitest'
import { ownerUserIdFromEnv } from '@/lib/cost/variable-cost'
import type { PdpJobRow } from './pdp-state'
import {
  driveSubscriptionJob,
  listSubscriptionQueue,
  runWorkerTick,
  WORKER_CODEX_IMAGE_ENV,
  WORKER_REQUIRED_ENV,
  workerCodexImageWanted,
  workerEnvProblems,
  workerEnvWarnings,
} from './pdp-subscription-worker'

type View = Pick<PdpJobRow, 'current_step' | 'section_images' | 'progress' | 'cost_usd' | 'error' | 'updated_at'>
const NOW = Date.parse('2026-11-09T02:00:00Z')
const view = (current_step: string, progress: number, extra: Partial<View> = {}): View =>
  ({
    current_step,
    section_images: [],
    progress,
    cost_usd: 0,
    error: null,
    updated_at: new Date(NOW).toISOString(),
    ...extra,
  }) as View
const QJOB = { id: 'job-abcdef123', user_id: 'user-1', current_step: 'analysis' }

describe('workerEnvProblems', () => {
  const full = Object.fromEntries([...WORKER_REQUIRED_ENV.map((k) => [k, 'x']), ['NEXOPS_PDP_HOSTED', 'railway-worker']])

  it('필수 env가 다 있고 운영 실행 표지면 문제 없음 — 값은 사유에 들어가지 않는다', () => {
    expect(workerEnvProblems(full)).toEqual([])
    const problems = workerEnvProblems({ ...full, SUPABASE_SERVICE_ROLE_KEY: '', NEXOPS_PDP_HOSTED: 'vercel' })
    expect(problems).toHaveLength(2)
    expect(problems.join(' ')).toContain('SUPABASE_SERVICE_ROLE_KEY가 없습니다')
    expect(problems.join(' ')).not.toContain('vercel')
  })

  it('로컬 실험 갈래 env가 있으면 시작하지 않는다', () => {
    expect(workerEnvProblems({ ...full, NEXOPS_PDP_LLM_BACKEND: 'subscription' })).toEqual([
      'NEXOPS_PDP_LLM_BACKEND는 로컬 실험 갈래라 작업자에 두지 않습니다',
    ])
    expect(workerEnvProblems({ ...full, NEXOPS_PDP_ENRICHMENT_SKIP: 'long' })).toHaveLength(1)
  })
})

describe('workerEnvWarnings(AX-PL-17 ②′b — 오너 id 없음은 경고, 시작은 막지 않는다)', () => {
  const full = Object.fromEntries([...WORKER_REQUIRED_ENV.map((k) => [k, 'x']), ['NEXOPS_PDP_HOSTED', 'railway-worker']])

  it('두 이름이 다 없으면(빈 값·공백 포함) 경고 한 줄 — 시작을 막는 문제(problems)에는 들어가지 않는다', () => {
    for (const env of [full, { ...full, NEXI_OWNER_USER_ID: '', NEXOPS_WORKER_USER_ID: '  ' }]) {
      const warnings = workerEnvWarnings(env)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('상세페이지 이미지 층이 열립니다')
      expect(workerEnvProblems(env)).toEqual([])
    }
  })

  it('둘 중 하나라도 있으면 경고 없음 — 값은 글에 나오지 않는다', () => {
    expect(workerEnvWarnings({ ...full, NEXI_OWNER_USER_ID: 'user_secret_1' })).toEqual([])
    expect(workerEnvWarnings({ ...full, NEXOPS_WORKER_USER_ID: 'user_secret_2' })).toEqual([])
    expect(workerEnvWarnings(full).join(' ')).not.toContain('user_secret')
  })

  it('작업자 경고 ⇔ 가드 판정 — 경고가 없는 env 조합이면 가드(ownerUserIdFromEnv)도 안 던지고, 경고가 있으면 던진다', () => {
    const combos: Array<Record<string, string | undefined>> = [
      {},
      { NEXI_OWNER_USER_ID: 'user_a' },
      { NEXOPS_WORKER_USER_ID: 'user_b' },
      { NEXI_OWNER_USER_ID: 'user_a', NEXOPS_WORKER_USER_ID: 'user_b' },
      { NEXI_OWNER_USER_ID: '' },
      { NEXOPS_WORKER_USER_ID: '' },
      { NEXI_OWNER_USER_ID: '   ' },
      { NEXOPS_WORKER_USER_ID: '   ' },
      { NEXI_OWNER_USER_ID: '  ', NEXOPS_WORKER_USER_ID: 'user_b' },
      { NEXI_OWNER_USER_ID: 'user_a', NEXOPS_WORKER_USER_ID: '  ' },
      { NEXI_OWNER_USER_ID: '', NEXOPS_WORKER_USER_ID: '  ' },
    ]
    for (const env of combos) {
      let guardThrows = false
      try {
        ownerUserIdFromEnv(env as NodeJS.ProcessEnv)
      } catch {
        guardThrows = true
      }
      expect(workerEnvWarnings(env).length === 0, JSON.stringify(env)).toBe(!guardThrows)
    }
  })

  it('필수 env 목록(WORKER_REQUIRED_ENV)에는 오너 id 가 없다 — 시작을 막지 않는다', () => {
    expect(WORKER_REQUIRED_ENV).not.toContain('NEXI_OWNER_USER_ID')
    expect(WORKER_REQUIRED_ENV).not.toContain('NEXOPS_WORKER_USER_ID')
  })
})

describe('listSubscriptionQueue', () => {
  it('구독 표지 + done·failed가 아닌 잡을 만든 순서로 읽는다(user_id 칸도 읽어 잡마다 그 값으로 진행)', async () => {
    const calls: Array<[string, ...unknown[]]> = []
    const chain: Record<string, unknown> = {}
    for (const name of ['from', 'select', 'eq', 'not', 'is', 'order']) {
      chain[name] = (...args: unknown[]) => (calls.push([name, ...args]), chain)
    }
    chain.limit = async (...args: unknown[]) => (calls.push(['limit', ...args]), { data: [QJOB], error: null })
    await expect(listSubscriptionQueue(chain as never, 5)).resolves.toEqual([QJOB])
    expect(calls).toEqual([
      ['from', 'registration_pdp_jobs'],
      ['select', 'id, user_id, current_step'],
      ['eq', 'spec_sheet->>modelBackend', 'subscription'],
      ['not', 'current_step', 'in', '(done,failed)'],
      // 멈춤 기록(AX-CT-29)이 있는 잡은 집지 않는다 — 기록이 없는 잡의 결과는 지금과 같다
      ['is', 'section_plan->>subscription_halt', null],
      ['order', 'created_at', { ascending: true }],
      ['limit', 5],
    ])
  })

  it('조회 오류는 던진다', async () => {
    const chain: Record<string, unknown> = {}
    for (const name of ['from', 'select', 'eq', 'not', 'is', 'order']) chain[name] = () => chain
    chain.limit = async () => ({ data: null, error: { message: 'boom' } })
    await expect(listSubscriptionQueue(chain as never)).rejects.toThrow(/boom/)
  })
})

describe('listSubscriptionQueue — 구독 멈춤 기록(AX-CT-29)', () => {
  type Row = { id: string; user_id: string; current_step: string; spec_sheet: Record<string, unknown>; section_plan: Record<string, unknown>; created_at: string }
  const row = (id: string, over: Partial<Row> = {}): Row => ({
    id,
    user_id: 'user-1',
    current_step: 'design',
    spec_sheet: { modelBackend: 'subscription', subscriptionStop: true },
    section_plan: {},
    created_at: `2026-11-12T0${id.length}:00:00Z`,
    ...over,
  })
  /** PostgREST 필터를 흉내 내는 가짜 DB — spec_sheet->>키, section_plan->>키 is null만 지원 */
  function fakeQueue(rows: Row[]) {
    const conds: Array<(r: Row) => boolean> = []
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.select = () => chain
    chain.eq = (col: string, v: unknown) => (conds.push((r) => r.spec_sheet[col.replace('spec_sheet->>', '')] === v), chain)
    chain.not = (_c: string, _op: string, v: string) => {
      const out = v.slice(1, -1).split(',')
      conds.push((r) => !out.includes(r.current_step))
      return chain
    }
    chain.is = (col: string, v: unknown) => (conds.push((r) => (r.section_plan[col.replace(/^section_plan->>?/, '')] ?? null) === v), chain)
    chain.order = () => chain
    chain.limit = async () => ({
      data: rows.filter((r) => conds.every((c) => c(r))).map(({ id, user_id, current_step }) => ({ id, user_id, current_step })),
      error: null,
    })
    return chain
  }
  const halt = { at: '2026-11-12T01:00:00Z', stage: 'design', reason: 'quota', detail: '한도' }

  it('멈춤 기록이 있는 잡은 큐가 집지 않는다 — 기록이 없는 잡만 나온다(기록 없는 잡의 결과는 지금과 같다)', async () => {
    const rows = [row('a1'), row('b22', { section_plan: { subscription_halt: halt } }), row('c333', { spec_sheet: { modelBackend: 'subscription' } })]
    const queue = await listSubscriptionQueue(fakeQueue(rows) as never)
    expect(queue.map((j) => j.id)).toEqual(['a1', 'c333'])
  })

  it("이어 하기로 기록이 지워지면 다시 잡힌다 — failed 잡은 단계가 되돌려진 뒤에만", async () => {
    const halted = row('b22', { section_plan: { subscription_halt: halt } })
    expect(await listSubscriptionQueue(fakeQueue([halted]) as never)).toEqual([])
    const resumed = { ...halted, section_plan: {} }
    expect((await listSubscriptionQueue(fakeQueue([resumed]) as never)).map((j) => j.id)).toEqual(['b22'])
    expect(await listSubscriptionQueue(fakeQueue([{ ...resumed, current_step: 'failed' }]) as never)).toEqual([])
  })
})

describe('driveSubscriptionJob — 구독 멈춤(AX-CT-29)', () => {
  it('멈춤 기록이 저장되면 그 잡은 거기서 멈추고(halted) 다음 잡으로 넘어간다', async () => {
    const haltedView = { ...view('design', 40), section_plan: { subscription_halt: { at: 'x', stage: 'design', reason: 'quota' as const, detail: '' } } }
    const runStep = vi.fn(async (id: string) => (id === QJOB.id ? haltedView : view('done', 100)))
    const second = { ...QJOB, id: 'job-second00' }
    const results = await runWorkerTick({ listQueue: async () => [QJOB, second], runStep, now: () => NOW })
    expect(results.map((r) => [r.id, r.end, r.runs])).toEqual([
      [QJOB.id, 'halted', 1],
      [second.id, 'done', 1],
    ])
  })
})

describe('driveSubscriptionJob', () => {
  it('done까지 이어서 진행한다 — 잡마다 그 행의 user_id로', async () => {
    const runStep = vi
      .fn()
      .mockResolvedValueOnce(view('research', 20))
      .mockResolvedValueOnce(view('design', 40))
      .mockResolvedValueOnce(view('done', 100))
    await expect(driveSubscriptionJob(QJOB, { runStep, now: () => NOW })).resolves.toEqual({ runs: 3, end: 'done', step: 'done' })
    expect(runStep).toHaveBeenCalledWith('job-abcdef123', 'user-1')
  })

  it('failed·다른 곳의 잠금·정체(같은 상태)·오류에서 멈춘다 — 오류 글이 바뀌면(재시도 횟수) 진행으로 본다', async () => {
    const failed = vi.fn().mockResolvedValueOnce(view('failed', 40))
    await expect(driveSubscriptionJob(QJOB, { runStep: failed, now: () => NOW })).resolves.toMatchObject({ end: 'failed' })

    const leased = vi.fn().mockResolvedValue(view('images', 60, { updated_at: new Date(NOW + 300_000).toISOString() }))
    await expect(driveSubscriptionJob(QJOB, { runStep: leased, now: () => NOW })).resolves.toMatchObject({ runs: 1, end: 'busy' })

    const retrying = vi
      .fn()
      .mockResolvedValueOnce(view('design', 40, { error: '[design] 실패 (1/3)' }))
      .mockResolvedValueOnce(view('design', 40, { error: '[design] 실패 (2/3)' }))
      .mockResolvedValueOnce(view('design', 40, { error: '[design] 실패 (2/3)' }))
    await expect(driveSubscriptionJob(QJOB, { runStep: retrying, now: () => NOW })).resolves.toEqual({
      runs: 3,
      end: 'stalled',
      step: 'design',
    })

    const log = vi.fn()
    const broken = vi.fn().mockRejectedValue(new Error('db down'))
    await expect(driveSubscriptionJob(QJOB, { runStep: broken, log })).resolves.toMatchObject({ runs: 1, end: 'error' })
    expect(log.mock.calls[0][0]).toContain('db down')
  })

  it('run 상한·종료 신호에서 멈춘다', async () => {
    let n = 0
    const growing = vi.fn(async () => view('images', 60, { section_images: Array(++n).fill({}) as View['section_images'] }))
    await expect(driveSubscriptionJob(QJOB, { runStep: growing, maxRuns: 4, now: () => NOW })).resolves.toMatchObject({
      runs: 4,
      end: 'max-runs',
    })
    let stop = false
    const once = vi.fn(async () => ((stop = true), view('research', 20)))
    await expect(driveSubscriptionJob(QJOB, { runStep: once, shouldStop: () => stop, now: () => NOW })).resolves.toEqual({
      runs: 1,
      end: 'stopped',
      step: 'research',
    })
  })
})

describe('runWorkerTick', () => {
  it('큐의 잡을 차례로 끝까지 진행하고 잡별 끝을 돌려준다', async () => {
    const second = { ...QJOB, id: 'job-second00' }
    const runStep = vi.fn(async (id: string) => view(id === QJOB.id ? 'done' : 'failed', 100))
    const log = vi.fn()
    const results = await runWorkerTick({ listQueue: async () => [QJOB, second], runStep, log, now: () => NOW })
    expect(results.map((r) => [r.id, r.end])).toEqual([
      [QJOB.id, 'done'],
      [second.id, 'failed'],
    ])
    expect(log).toHaveBeenCalledTimes(2)
  })
})

describe('workerCodexImageWanted — 구독 이미지 길 스위치(AX-CT-35, 꺼짐)', () => {
  it("값이 정확히 'on'일 때만 등록한다 — 없거나 다른 값이면 등록하지 않는다(지금 그대로)", () => {
    expect(WORKER_CODEX_IMAGE_ENV).toBe('NEXOPS_PDP_WORKER_CODEX_IMAGE')
    expect(workerCodexImageWanted({})).toBe(false)
    for (const value of ['', 'off', '1', 'true', 'ON ', 'yes']) expect(workerCodexImageWanted({ [WORKER_CODEX_IMAGE_ENV]: value }), value).toBe(value.trim() === 'on')
    expect(workerCodexImageWanted({ [WORKER_CODEX_IMAGE_ENV]: ' on ' })).toBe(true)
  })

  it('이 스위치는 작업자 시작 점검(필수 env)에 들지 않는다 — 없어도 작업자는 지금처럼 시작한다', () => {
    expect(WORKER_REQUIRED_ENV as readonly string[]).not.toContain(WORKER_CODEX_IMAGE_ENV)
  })
})
