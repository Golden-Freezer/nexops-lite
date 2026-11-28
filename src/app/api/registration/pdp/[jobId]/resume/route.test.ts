/**
 * POST /api/registration/pdp/[jobId]/resume — 구독 멈춤 표지 잡의 '이어 하기'(AX-CT-29). 멈춤 기록·error를 지우고 실패한 잡은 다시 돌릴 단계로
 * 되돌린다(조건부 갱신) → 작업자 큐 결과에 다시 나타난다. stop 잡이 아니면 400. 잡 저장소·사건 줄은 모의(DB 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ runs: vi.fn(), step: vi.fn() }))

vi.mock('@/lib/auth/clerk', () => ({ requireOwner: vi.fn().mockResolvedValue('user-1') }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/registration/pdp-jobs', async (orig) => ({
  isPdpJobLeased: (await orig<typeof import('@/lib/registration/pdp-jobs')>()).isPdpJobLeased,
  getPdpJob: vi.fn(),
  updatePdpJobIfUnchanged: vi.fn(),
}))
vi.mock('@/lib/registration/pdp-pipeline', () => ({ resolveStepToRun: (...a: unknown[]) => h.step(...a) }))
vi.mock('@/lib/ops/job-runs', async (orig) => ({
  ...(await orig<typeof import('@/lib/ops/job-runs')>()),
  recordJobRun: (...a: unknown[]) => h.runs(...a),
}))

import { getPdpJob, updatePdpJobIfUnchanged } from '@/lib/registration/pdp-jobs'
import { POST } from './route'

const call = (jobId = 'job-1') =>
  POST(new NextRequest(`http://localhost/api/registration/pdp/${jobId}/resume`, { method: 'POST' }), {
    params: Promise.resolve({ jobId }),
  })

const HALT = { at: '2026-11-12T01:00:00.000Z', stage: 'design', reason: 'quota', detail: '한도' }
const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  user_id: 'user-1',
  current_step: 'design',
  model_backend: 'subscription',
  subscription_stop: true,
  spec_sheet: { productName: '컵' },
  section_images: [] as Array<Record<string, unknown>>,
  section_plan: { reasoning: '근거', subscription_halt: HALT },
  error: '[design] 구독 작업자 멈춤 — 구독 한도 소진',
  updated_at: new Date(Date.now() - 60_000).toISOString(),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.runs.mockReset().mockResolvedValue({ recorded: true })
  h.step.mockReset().mockReturnValue('design')
})

describe('POST /api/registration/pdp/[jobId]/resume', () => {
  it('멈춤 기록·error를 지우고 조건부 저장한다 — 진행 중 단계는 그대로, 멈춤 사건을 닫는 ok 줄 1개', async () => {
    const current = job()
    vi.mocked(getPdpJob).mockResolvedValue(current as never)
    vi.mocked(updatePdpJobIfUnchanged).mockImplementation(async (_db, _u, _j, patch) => ({ ...current, section_plan: patch.sectionPlan, error: patch.error }) as never)
    const res = await call()
    expect(res.status).toBe(200)
    expect(updatePdpJobIfUnchanged).toHaveBeenCalledWith(expect.anything(), 'user-1', current, { sectionPlan: { reasoning: '근거' }, error: null })
    const body = await res.json()
    expect(body.job.section_plan).toEqual({ reasoning: '근거' })
    expect(h.runs).toHaveBeenCalledTimes(1)
    expect(h.runs.mock.calls[0][1]).toMatchObject({ jobKey: 'pdp-subscription-halt', status: 'ok', userId: 'user-1' })
  })

  it('실패(failed) 잡은 resolveStepToRun이 고른 단계로 되돌린다 — 멈춤 기록이 없는 실패는 사건 줄을 쓰지 않는다', async () => {
    const failed = job({ current_step: 'failed', section_plan: { reasoning: '근거' }, error: '[copywriting] 실패' })
    vi.mocked(getPdpJob).mockResolvedValue(failed as never)
    h.step.mockReturnValue('copywriting')
    vi.mocked(updatePdpJobIfUnchanged).mockImplementation(async (_db, _u, _j, patch) => ({ ...failed, current_step: patch.currentStep, error: null }) as never)
    const res = await call()
    expect(res.status).toBe(200)
    expect(updatePdpJobIfUnchanged).toHaveBeenCalledWith(expect.anything(), 'user-1', failed, {
      sectionPlan: { reasoning: '근거' },
      error: null,
      currentStep: 'copywriting',
    })
    expect(h.runs).not.toHaveBeenCalled()
  })

  it('저장된 결과는 작업자 큐 조건(done·failed 아님·멈춤 기록 없음 — pdp-subscription-worker 시험이 그 필터를 확인)을 만족한다', async () => {
    const failed = job({ current_step: 'failed', section_plan: { subscription_halt: HALT }, error: 'x' })
    vi.mocked(getPdpJob).mockResolvedValue(failed as never)
    h.step.mockReturnValue('images')
    let saved: Record<string, unknown> = {}
    vi.mocked(updatePdpJobIfUnchanged).mockImplementation(async (_db, _u, _j, patch) => {
      saved = { ...failed, section_plan: patch.sectionPlan, current_step: patch.currentStep, error: patch.error }
      return saved as never
    })
    await call()
    // 큐 읽기 조건: current_step이 done·failed가 아니고 section_plan.subscription_halt가 없다
    expect(['done', 'failed']).not.toContain(saved.current_step)
    expect((saved.section_plan as Record<string, unknown>).subscription_halt).toBeUndefined()
  })

  it('stop 표지가 없는 잡·API 잡은 400(저장 없음)', async () => {
    vi.mocked(getPdpJob).mockResolvedValue(job({ subscription_stop: undefined }) as never)
    expect((await call()).status).toBe(400)
    vi.mocked(getPdpJob).mockResolvedValue(job({ model_backend: undefined }) as never)
    expect((await call()).status).toBe(400)
    expect(updatePdpJobIfUnchanged).not.toHaveBeenCalled()
  })

  it('done 잡은 400 — 다시 돌릴 단계가 없다(지금 화면에도 끝난 잡 다시 돌리기가 없다)', async () => {
    vi.mocked(getPdpJob).mockResolvedValue(job({ current_step: 'done', section_plan: {} }) as never)
    expect((await call()).status).toBe(400)
    expect(updatePdpJobIfUnchanged).not.toHaveBeenCalled()
  })

  it('멈춘 적 없는 진행 중 잡·잠금이 있는 잡은 409, 없는 잡은 404', async () => {
    vi.mocked(getPdpJob).mockResolvedValue(job({ section_plan: {} }) as never)
    expect((await call()).status).toBe(409)
    vi.mocked(getPdpJob).mockResolvedValue(job({ updated_at: new Date(Date.now() + 300_000).toISOString() }) as never)
    expect((await call()).status).toBe(409)
    vi.mocked(getPdpJob).mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(updatePdpJobIfUnchanged).not.toHaveBeenCalled()
  })

  it('그사이 잡이 바뀌었으면(조건부 갱신 0행) 409 — 사건 줄을 쓰지 않는다', async () => {
    vi.mocked(getPdpJob).mockResolvedValue(job() as never)
    vi.mocked(updatePdpJobIfUnchanged).mockResolvedValue(null)
    expect((await call()).status).toBe(409)
    expect(h.runs).not.toHaveBeenCalled()
  })

  it('산출물이 모두 있어 되돌릴 단계가 done이면 400', async () => {
    vi.mocked(getPdpJob).mockResolvedValue(job({ current_step: 'failed' }) as never)
    h.step.mockReturnValue('done')
    expect((await call()).status).toBe(400)
    expect(updatePdpJobIfUnchanged).not.toHaveBeenCalled()
  })
})

describe('이어 하기 — 첫 화면(hero) 실패로 끝난 stop 잡(AX-CT-29 검수 A)', () => {
  const images = [
    { section: 'hero', url: null, error: '첫 화면 생성 실패' },
    { section: 'usage', url: 'https://img/u.png' },
    { section: 'detail', url: null, retryPending: true },
  ]

  it('failed → images 로 되돌릴 때 url 없는 hero 칸을 지워 저장한다(작업자가 hero 를 처음부터 다시 만든다 — 웹 다시 시도의 retryLostHero 와 같은 거르기)', async () => {
    const failed = job({ current_step: 'failed', section_images: images, error: '[images] 첫 화면 실패' })
    vi.mocked(getPdpJob).mockResolvedValue(failed as never)
    h.step.mockReturnValue('images')
    vi.mocked(updatePdpJobIfUnchanged).mockImplementation(async (_db, _u, _j, patch) => ({ ...failed, ...patch }) as never)
    expect((await call()).status).toBe(200)
    const patch = vi.mocked(updatePdpJobIfUnchanged).mock.calls[0][3]
    expect(patch).toMatchObject({ currentStep: 'images', error: null })
    expect(patch.sectionImages?.map((e) => e.section)).toEqual(['usage', 'detail'])
  })

  it('url 이 있는 hero·images 가 아닌 단계·진행 중 멈춤은 section_images 를 건드리지 않는다', async () => {
    const withHero = [{ section: 'hero', url: 'https://img/h.png' }, ...images.slice(1)]
    for (const [over, step] of [
      [{ current_step: 'failed', section_images: withHero }, 'images'],
      [{ current_step: 'failed', section_images: images }, 'compose'],
      [{ current_step: 'images', section_images: images }, 'images'],
    ] as const) {
      vi.mocked(updatePdpJobIfUnchanged).mockReset().mockResolvedValue(job() as never)
      vi.mocked(getPdpJob).mockResolvedValue(job(over as Record<string, unknown>) as never)
      h.step.mockReturnValue(step)
      expect((await call()).status).toBe(200)
      expect(vi.mocked(updatePdpJobIfUnchanged).mock.calls[0][3]).not.toHaveProperty('sectionImages')
    }
  })

  it('이어 하기 ok 줄에 멈춤 시각(at)을 남긴다 — 그 멈춤의 사건만 닫는다', async () => {
    vi.mocked(getPdpJob).mockResolvedValue(job() as never)
    vi.mocked(updatePdpJobIfUnchanged).mockResolvedValue(job({ section_plan: {} }) as never)
    await call()
    expect(h.runs.mock.calls[0][1]).toMatchObject({ status: 'ok', detail: { job: 'job-1', stage: 'design', at: HALT.at, resumed: true } })
  })
})
