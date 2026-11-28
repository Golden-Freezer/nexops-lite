/**
 * '이어 하기' → 작업자 큐가 다시 집음 → 첫 화면(hero) 일감이 생김까지 잇는 시험(AX-CT-29 재검수 지적 3).
 * route 시험(route.test.ts)은 resolveStepToRun을 모의한다 — 여기서는 실제 resolveStepToRun·buildImageTasks·isSectionSettled·
 * listSubscriptionQueue(필터는 가짜 DB가 PostgREST 꼴로 흉내)를 쓴다. 잡 저장소·인증·사건 줄만 모의(DB 0).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PdpJobRow, SectionImage } from '@/lib/registration/pdp-state'

const h = vi.hoisted(() => ({ job: null as PdpJobRow | null, saved: null as PdpJobRow | null }))

vi.mock('@/lib/auth/clerk', () => ({ requireOwner: vi.fn().mockResolvedValue('user-1') }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/ops/job-runs', async (orig) => ({
  ...(await orig<typeof import('@/lib/ops/job-runs')>()),
  recordJobRun: vi.fn(async () => ({ recorded: true })),
}))
vi.mock('@/lib/registration/pdp-jobs', async (orig) => ({
  ...(await orig<typeof import('@/lib/registration/pdp-jobs')>()),
  getPdpJob: vi.fn(async () => h.job),
  updatePdpJobIfUnchanged: vi.fn(async (_db: unknown, _u: string, _job: PdpJobRow, patch: Record<string, unknown>) => {
    const job: PdpJobRow = { ...h.job!, updated_at: new Date().toISOString() }
    if (patch.sectionPlan !== undefined) job.section_plan = patch.sectionPlan as PdpJobRow['section_plan']
    if (patch.sectionImages !== undefined) job.section_images = patch.sectionImages as SectionImage[]
    if (patch.currentStep !== undefined) job.current_step = patch.currentStep as PdpJobRow['current_step']
    if (patch.error !== undefined) job.error = patch.error as string | null
    h.saved = job
    return job
  }),
}))

import { fixtureToJob, loadEnrichmentFixture, rewindTo } from '@/lib/registration/__golden__/golden-harness'
import { buildImageTasks, isSectionSettled } from '@/lib/registration/pdp-image-tasks'
import { specSheetForSave } from '@/lib/registration/pdp-model-batch'
import { resolveStepToRun } from '@/lib/registration/pdp-pipeline'
import { listSubscriptionQueue } from '@/lib/registration/pdp-subscription-worker'
import { POST } from './route'

const call = (jobId: string) =>
  POST(new NextRequest(`http://localhost/api/registration/pdp/${jobId}/resume`, { method: 'POST' }), { params: Promise.resolve({ jobId }) })

/** 큐 조회를 PostgREST 꼴로 흉내 — spec_sheet->>modelBackend = subscription · current_step not in (done,failed) · section_plan->>subscription_halt is null */
function queueDb(rows: PdpJobRow[]) {
  const stored = rows.map((job) => ({ job, spec: specSheetForSave(job, job.spec_sheet) as unknown as Record<string, unknown> }))
  const conds: Array<(r: (typeof stored)[number]) => boolean> = []
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.select = () => chain
  chain.eq = (col: string, v: unknown) => (conds.push((r) => r.spec[col.replace('spec_sheet->>', '')] === v), chain)
  chain.not = (_c: string, _op: string, v: string) => {
    const out = v.slice(1, -1).split(',')
    return conds.push((r) => !out.includes(r.job.current_step)), chain
  }
  chain.is = (col: string, v: unknown) => {
    expect(col).toBe('section_plan->>subscription_halt')
    return conds.push((r) => ((r.job.section_plan as Record<string, unknown>).subscription_halt ?? null) === v), chain
  }
  chain.order = () => chain
  chain.limit = async () => ({
    data: stored.filter((r) => conds.every((c) => c(r))).map(({ job }) => ({ id: job.id, user_id: job.user_id, current_step: job.current_step })),
    error: null,
  })
  return chain as never
}

const HALT = { at: '2026-11-12T05:00:00.000Z', stage: 'images', reason: 'quota' as const, detail: '한도' }

function heroFailedStopJob(): PdpJobRow {
  // 이미지 단계 앞까지 끝난 새 배치 구독 멈춤 표지 잡 — 첫 화면 컷이 재시도까지 실패해 failed 로 끝났다(나머지 컷은 만들지 않음)
  const full = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  const before = rewindTo(full, 'images')
  return {
    ...before,
    id: 'job-hero-1',
    user_id: 'user-1',
    model_batch: 'new',
    model_backend: 'subscription',
    subscription_stop: true,
    current_step: 'failed',
    error: '[images] 첫 화면 컷을 만들지 못했습니다',
    section_images: [{ section: 'hero', url: '', error: '첫 화면 생성 실패' }],
    section_plan: { ...before.section_plan, subscription_halt: HALT },
    updated_at: new Date(Date.now() - 60_000).toISOString(),
  }
}

beforeEach(() => {
  h.job = null
  h.saved = null
})

describe('이어 하기 → 작업자 큐 → 첫 화면 일감(실제 단계 판정)', () => {
  it('hero 실패로 끝난 stop 잡: 이어 하기가 images 로 되돌리며 실패한 hero 칸을 지우고, 큐가 다시 집고, hero 가 끝나지 않은 칸이라 일감이 생긴다', async () => {
    const job = heroFailedStopJob()
    h.job = job
    // 전제: 실패한 hero 칸은 '끝난 칸'이다 — 지우지 않으면 hero 일감이 생기지 않는다(재검수 결함 A 의 원인)
    expect(buildImageTasks(job).some((t) => t.section === 'hero')).toBe(true)
    expect(isSectionSettled(job.section_images[0])).toBe(true)
    expect(resolveStepToRun(job)).toBe('images')

    const res = await call(job.id)
    expect(res.status).toBe(200)
    const saved = h.saved!
    expect(saved.current_step).toBe('images')
    expect(saved.section_plan).not.toHaveProperty('subscription_halt')
    expect(saved.section_images.find((e) => e.section === 'hero')).toBeUndefined()

    // 작업자 큐가 다시 집는다(멈추기 전 잡은 집지 않았다)
    expect(await listSubscriptionQueue(queueDb([job]))).toEqual([])
    expect(await listSubscriptionQueue(queueDb([saved]))).toEqual([{ id: saved.id, user_id: 'user-1', current_step: 'images' }])

    // 작업자 runPdpStep 이 고를 단계는 images, hero 칸은 끝나지 않았다 → 이미지 단계가 hero 일감을 만든다
    expect(resolveStepToRun(saved)).toBe('images')
    const hero = buildImageTasks(saved).find((t) => t.section === 'hero')
    expect(hero).toBeDefined()
    expect(isSectionSettled(saved.section_images.find((e) => e.section === 'hero'))).toBe(false)
  })
})
