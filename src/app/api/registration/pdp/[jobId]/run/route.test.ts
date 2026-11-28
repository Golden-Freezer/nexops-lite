import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getPdpJob, updatePdpJobIfUnchanged } from '@/lib/registration/pdp-jobs'
import { runPdpStep } from '@/lib/registration/pdp-pipeline'
import { POST } from './route'

const h = vi.hoisted(() => ({ others: vi.fn(), runs: vi.fn() }))

vi.mock('@/lib/registration/pdp-subscription', async (orig) => ({
  ...(await orig<typeof import('@/lib/registration/pdp-subscription')>()),
  listOtherSubscriptionJobs: (...a: unknown[]) => h.others(...a),
}))
vi.mock('@/lib/ops/job-runs', async (orig) => ({
  ...(await orig<typeof import('@/lib/ops/job-runs')>()),
  recordJobRun: (...a: unknown[]) => h.runs(...a),
}))
vi.mock('@/lib/auth/clerk', () => ({
  requireOwner: vi.fn().mockResolvedValue('user-1'),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({})),
}))
vi.mock('@/lib/registration/pdp-jobs', async (orig) => ({
  isPdpJobLeased: (await orig<typeof import('@/lib/registration/pdp-jobs')>()).isPdpJobLeased,
  getPdpJob: vi.fn(),
  updatePdpJobIfUnchanged: vi.fn(),
}))
vi.mock('@/lib/registration/pdp-pipeline', () => ({
  runPdpStep: vi.fn(),
}))

function call(jobId = 'job-1') {
  return POST(new NextRequest(`http://localhost/api/registration/pdp/${jobId}/run`, { method: 'POST' }), {
    params: Promise.resolve({ jobId }),
  })
}

describe('POST /api/registration/pdp/[jobId]/run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('codex-image 잡도 로컬 웹 경로에서 진행한다', async () => {
    const job = { id: 'job-1', image_model: 'codex-image', current_step: 'images' }
    vi.mocked(getPdpJob).mockResolvedValue(job as never)
    vi.mocked(runPdpStep).mockResolvedValue({ ...job, current_step: 'done' } as never)

    const res = await call()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ job: { ...job, current_step: 'done' } })
    expect(runPdpStep).toHaveBeenCalledWith('job-1', 'user-1')
    expect(getPdpJob).toHaveBeenCalledWith(expect.anything(), 'user-1', 'job-1')
  })

  it('다른 모델 잡은 기존처럼 한 스텝 진행한다', async () => {
    vi.mocked(getPdpJob).mockResolvedValue({ id: 'job-1', image_model: 'gpt-image-2', current_step: 'design' } as never)
    vi.mocked(runPdpStep).mockResolvedValue({ id: 'job-1', current_step: 'copywriting' } as never)

    const res = await call()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ job: { id: 'job-1', current_step: 'copywriting' } })
    expect(runPdpStep).toHaveBeenCalledWith('job-1', 'user-1')
  })

  it('다른 곳이 잡을 진행 중이면(잠금 기한이 미래) busy를 함께 돌려준다 — 화면이 잠시 뒤 다시 부른다', async () => {
    const leased = { id: 'job-1', current_step: 'images', updated_at: new Date(Date.now() + 300_000).toISOString() }
    vi.mocked(getPdpJob).mockResolvedValue({ ...leased, image_model: 'gpt-image-2' } as never)
    vi.mocked(runPdpStep).mockResolvedValue(leased as never)

    const res = await call()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ job: leased, busy: true })
  })

  it('방금 끝난 run의 해제 시각(지금)은 잠금이 아니다 — busy 없음', async () => {
    const released = { id: 'job-1', current_step: 'images', updated_at: new Date().toISOString() }
    vi.mocked(getPdpJob).mockResolvedValue({ ...released, image_model: 'gpt-image-2' } as never)
    vi.mocked(runPdpStep).mockResolvedValue(released as never)

    expect(await (await call()).json()).toEqual({ job: released })
  })

  it('잡이 없으면 기존처럼 404', async () => {
    vi.mocked(getPdpJob).mockResolvedValue(null)
    vi.mocked(runPdpStep).mockRejectedValue(new Error('PDP 잡을 찾을 수 없습니다: job-1'))

    const res = await call()

    expect(res.status).toBe(404)
  })
})

describe('POST /api/registration/pdp/[jobId]/run — 구독 표지 잡(R13)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const marked = (updatedAgoMs: number, step = 'design') => ({
    id: 'job-1',
    image_model: 'higgsfield-ms-2k',
    current_step: step,
    model_batch: 'new',
    model_backend: 'subscription',
    spec_sheet: { productName: '컵' },
    section_plan: {},
    updated_at: new Date(Date.now() - updatedAgoMs).toISOString(),
  })

  it('작업자가 살아 있으면(마지막 저장 5분 안) 진행하지 않고 busy·worker를 돌려준다', async () => {
    const job = marked(60_000)
    vi.mocked(getPdpJob).mockResolvedValue(job as never)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ job, busy: true, worker: true })
    expect(runPdpStep).not.toHaveBeenCalled()
  })

  it('5분 넘게 아무도 저장하지 않았으면 표지를 API로 바꾸고 웹이 이어서 진행한다', async () => {
    const job = marked(6 * 60_000)
    vi.mocked(getPdpJob).mockResolvedValue(job as never)
    vi.mocked(updatePdpJobIfUnchanged).mockResolvedValue({ ...job, model_backend: undefined } as never)
    vi.mocked(runPdpStep).mockResolvedValue({ id: 'job-1', current_step: 'copywriting', updated_at: new Date().toISOString() } as never)
    const res = await call()
    expect(res.status).toBe(200)
    expect(vi.mocked(updatePdpJobIfUnchanged).mock.calls[0][3]).toEqual({ specSheet: { productName: '컵', modelBatch: 'new' } })
    expect(runPdpStep).toHaveBeenCalledWith('job-1', 'user-1')
  })

  it('넘겨받기 저장이 0행이면(그사이 작업자가 저장) 진행하지 않고 busy', async () => {
    const job = marked(6 * 60_000)
    vi.mocked(getPdpJob).mockResolvedValue(job as never)
    vi.mocked(updatePdpJobIfUnchanged).mockResolvedValue(null)
    const body = await (await call()).json()
    expect(body).toMatchObject({ busy: true, worker: true })
    expect(runPdpStep).not.toHaveBeenCalled()
  })

  it('멈춘 잡(failed)의 다시 시도는 웹이 진행한다', async () => {
    const job = marked(60_000, 'failed')
    vi.mocked(getPdpJob).mockResolvedValue(job as never)
    vi.mocked(runPdpStep).mockResolvedValue({ ...job, current_step: 'design', updated_at: new Date().toISOString() } as never)
    await call()
    expect(runPdpStep).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/registration/pdp/[jobId]/run — 구독 멈춤 표지 잡(AX-CT-29)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.others.mockReset().mockResolvedValue([])
    h.runs.mockReset().mockResolvedValue({ recorded: true })
  })

  const stop = (updatedAgoMs: number, step = 'design', over: Record<string, unknown> = {}) => ({
    id: 'job-1',
    image_model: 'higgsfield-ms-2k',
    current_step: step,
    model_batch: 'new',
    model_backend: 'subscription',
    subscription_stop: true,
    spec_sheet: { productName: '컵' },
    section_plan: {},
    updated_at: new Date(Date.now() - updatedAgoMs).toISOString(),
    ...over,
  })

  it('5분 넘게 조용하고 다른 구독 잡도 조용하면 표지를 API로 바꾸지 않고 멈춤을 저장 — halted·사건 줄 1개·runPdpStep 0회', async () => {
    const job = stop(6 * 60_000)
    vi.mocked(getPdpJob).mockResolvedValue(job as never)
    vi.mocked(updatePdpJobIfUnchanged).mockImplementation(async (_db, _u, _j, patch) => ({ ...job, ...patch, section_plan: patch.sectionPlan }) as never)
    h.others.mockResolvedValue([{ updated_at: new Date(Date.now() - 9 * 60_000).toISOString() }])
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.halted).toBe(true)
    expect(body.job.model_backend).toBe('subscription')
    expect(body.job.section_plan.subscription_halt).toMatchObject({ stage: 'design', reason: 'worker_stale' })
    expect(updatePdpJobIfUnchanged).toHaveBeenCalledTimes(1)
    // 표지(spec_sheet)는 건드리지 않는다 — 멈춤 기록과 error만
    expect(Object.keys(vi.mocked(updatePdpJobIfUnchanged).mock.calls[0][3]).sort()).toEqual(['error', 'sectionPlan'])
    expect(runPdpStep).not.toHaveBeenCalled()
    expect(h.runs).toHaveBeenCalledTimes(1)
    expect(h.runs.mock.calls[0][1]).toMatchObject({
      jobKey: 'pdp-subscription-halt',
      status: 'failed',
      detail: { job: 'job-1', stage: 'design', reason: 'worker_stale' },
    })
  })

  it('이미 멈춤 기록이 있으면 같은 잡을 다시 불러도 저장·사건 줄이 더 생기지 않고 halted만 돌려준다', async () => {
    const job = stop(6 * 60_000, 'design', { section_plan: { subscription_halt: { at: 'x', stage: 'design', reason: 'worker_stale', detail: '' } } })
    vi.mocked(getPdpJob).mockResolvedValue(job as never)
    for (let i = 0; i < 2; i++) expect(await (await call()).json()).toEqual({ job, halted: true })
    expect(updatePdpJobIfUnchanged).not.toHaveBeenCalled()
    expect(h.runs).not.toHaveBeenCalled()
    expect(runPdpStep).not.toHaveBeenCalled()
  })

  it('(가) 같은 사용자의 첫 구독 잡이 잠금을 쥐었으면 둘째 잡은 6분 지나도 halted가 아니라 worker로 기다린다', async () => {
    const job = stop(6 * 60_000)
    vi.mocked(getPdpJob).mockResolvedValue(job as never)
    h.others.mockResolvedValue([{ updated_at: new Date(Date.now() + 300_000).toISOString() }])
    expect(await (await call()).json()).toEqual({ job, busy: true, worker: true })
    expect(updatePdpJobIfUnchanged).not.toHaveBeenCalled()
    expect(h.runs).not.toHaveBeenCalled()
    expect(runPdpStep).not.toHaveBeenCalled()
  })

  it('(가) 첫 잡이 잠금 없이 5분 안에 저장했어도 worker, 첫 잡도 조용하면 halted', async () => {
    const job = stop(6 * 60_000)
    vi.mocked(getPdpJob).mockResolvedValue(job as never)
    vi.mocked(updatePdpJobIfUnchanged).mockImplementation(async (_db, _u, _j, patch) => ({ ...job, section_plan: patch.sectionPlan }) as never)
    h.others.mockResolvedValue([{ updated_at: new Date(Date.now() - 4 * 60_000).toISOString() }])
    expect(await (await call()).json()).toMatchObject({ busy: true, worker: true })
    h.others.mockResolvedValue([{ updated_at: new Date(Date.now() - 7 * 60_000).toISOString() }])
    expect(await (await call()).json()).toMatchObject({ halted: true })
    expect(runPdpStep).not.toHaveBeenCalled()
  })

  it('작업자 생존 재료를 읽지 못하면 멈추지 않고 기다린다(멈춤 저장·사건 줄 없음)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const job = stop(6 * 60_000)
    vi.mocked(getPdpJob).mockResolvedValue(job as never)
    h.others.mockRejectedValue(new Error('db down'))
    expect(await (await call()).json()).toEqual({ job, busy: true, worker: true })
    expect(updatePdpJobIfUnchanged).not.toHaveBeenCalled()
  })

  it('최근 5분 안에 저장한 진행 중 잡은 worker — 다른 잡은 읽지도 않는다', async () => {
    const job = stop(60_000)
    vi.mocked(getPdpJob).mockResolvedValue(job as never)
    expect(await (await call()).json()).toEqual({ job, busy: true, worker: true })
    expect(h.others).not.toHaveBeenCalled()
    expect(runPdpStep).not.toHaveBeenCalled()
  })

  it('failed·done stop 잡은 읽기만 — { job }만 돌려주고 웹은 단계도 표지 변경도 하지 않는다(LLM 0콜)', async () => {
    for (const step of ['failed', 'done']) {
      const job = stop(3_600_000, step)
      vi.mocked(getPdpJob).mockResolvedValue(job as never)
      expect(await (await call()).json()).toEqual({ job })
    }
    expect(runPdpStep).not.toHaveBeenCalled()
    expect(updatePdpJobIfUnchanged).not.toHaveBeenCalled()
    expect(h.runs).not.toHaveBeenCalled()
  })
})
