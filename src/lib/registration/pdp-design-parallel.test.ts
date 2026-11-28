/**
 * 설계 단계 콜 ①(섹션 계획)·②(디자인 프롬프트) 병렬(속도 개선 1차) — 서로의 산출을 쓰지 않으므로 함께 부른다.
 * 잡 진행 잠금을 쥐지 못하면 아무것도 하지 않고, 단계의 마지막 저장은 잠금을 푼다. 잠금을 잃으면 실패로 기록하지 않는다.
 * LLM·DB는 모의(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  plan: null as PdpJobRow['section_plan'] | null,
  prompts: null as PdpJobRow['design_prompts'] | null,
  calls: [] as Array<{ name: string; start: number; end: number }>,
  /** 콜이 받은 기한·그때의 잡 배치(R03) */
  seen: [] as Array<{ name: string; deadlineAt?: number; batch: string }>,
  claimable: true,
  /** 계획 콜이 던질 오류 */
  planThrows: null as Error | null,
  /** 단계 기록(currentStep) 저장이 실패한다 */
  failStepWrite: false,
}))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/agents/budget', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: vi.fn(async () => ({ allowed: true, spentUsd: 0, budgetUsd: 1000 })),
}))
vi.mock('./pdp-jobs', async (orig) => ({
  isPdpJobLeased: (await orig<typeof import('./pdp-jobs')>()).isPdpJobLeased,
  PdpLeaseLostError: (await orig<typeof import('./pdp-jobs')>()).PdpLeaseLostError,
  getPdpJob: vi.fn(async () => h.job),
  claimPdpJobRun: vi.fn(async (_db: unknown, _u: string, job: PdpJobRow) => {
    const leaseUntil = new Date(Date.now() + 340_000).toISOString()
    if (h.claimable) return { job, leaseUntil }
    // 읽은 뒤 쥐기 전에 다른 곳이 먼저 쥐었다
    h.job = { ...h.job!, updated_at: leaseUntil }
    return null
  }),
  updatePdpJob: vi.fn(async (_db: unknown, _u: string, _id: string, patch: Record<string, unknown>) => {
    if (h.failStepWrite && patch.currentStep !== undefined) throw new Error('PDP 잡 갱신 실패: 일시 오류')
    const job = { ...h.job! }
    if (patch.error !== undefined) job.error = patch.error as string | null
    if (patch.sectionPlan !== undefined) job.section_plan = patch.sectionPlan as PdpJobRow['section_plan']
    if (patch.designPrompts !== undefined) job.design_prompts = patch.designPrompts as PdpJobRow['design_prompts']
    if (patch.currentStep !== undefined) job.current_step = patch.currentStep as PdpJobRow['current_step']
    if (patch.costUsd !== undefined) job.cost_usd = patch.costUsd as number
    h.job = job
    return job
  }),
}))
vi.mock('@/lib/agents/registration/pdp-design-agent', () => ({
  planPdpSections: vi.fn(async (input: { deadlineAt?: number }) => {
    if (h.planThrows) throw h.planThrows
    const { currentPdpBatch } = await import('@/lib/registration/pdp-model-batch-context')
    h.seen.push({ name: 'plan', deadlineAt: input.deadlineAt, batch: currentPdpBatch() })
    const start = Date.now()
    await sleep(40)
    h.calls.push({ name: 'plan', start, end: Date.now() })
    return { sectionPlan: h.plan, usedFallback: false, error: null, costUsd: 0.01 }
  }),
  generatePdpDesignPrompts: vi.fn(async (input: { deadlineAt?: number }) => {
    const { currentPdpBatch } = await import('@/lib/registration/pdp-model-batch-context')
    h.seen.push({ name: 'prompts', deadlineAt: input.deadlineAt, batch: currentPdpBatch() })
    const start = Date.now()
    await sleep(40)
    h.calls.push({ name: 'prompts', start, end: Date.now() })
    return { designPrompts: h.prompts, usedFallback: false, error: null, costUsd: 0.02 }
  }),
  // 설계 ① 건너뛰기(skipdesign1 잡만, J07) — 콜 없이 기본 계획
  skippedSectionPlan: vi.fn(() => {
    h.calls.push({ name: 'skip', start: Date.now(), end: Date.now() })
    return { sectionPlan: h.plan, usedFallback: false, error: null, costUsd: 0 }
  }),
}))

import { PdpLeaseLostError, getPdpJob, isPdpJobLeased, updatePdpJob } from './pdp-jobs'
import { resolveStepToRun, runPdpStep } from './pdp-pipeline'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'

/** 잡 갱신에 넘긴 패치 — 잠금 기한(leaseUntil)을 실었는지 본다 */
const patches = () => vi.mocked(updatePdpJob).mock.calls.map(([, , , patch]) => patch)

beforeEach(() => {
  const full = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  h.plan = full.section_plan
  h.prompts = full.design_prompts
  h.job = rewindTo(full, 'design')
  h.calls = []
  h.seen = []
  h.claimable = true
  h.planThrows = null
  h.failStepWrite = false
  vi.mocked(updatePdpJob).mockClear()
  vi.mocked(getPdpJob).mockClear()
})

describe('설계 단계 — 콜 ①·② 병렬', () => {
  it('두 콜이 겹쳐 돈다(한쪽이 끝나기 전에 다른 쪽이 시작) — 결과는 둘 다 기록된다', async () => {
    const startCost = h.job!.cost_usd
    const out = await runPdpStep(h.job!.id, 'user-1')
    const [a, b] = h.calls
    expect(h.calls.map((c) => c.name).sort()).toEqual(['plan', 'prompts'])
    expect(Math.max(a.start, b.start)).toBeLessThan(Math.min(a.end, b.end))
    expect(out.current_step).toBe('copywriting')
    expect(out.design_prompts).toEqual(h.prompts)
    expect(out.cost_usd).toBeCloseTo(startCost + 0.03, 6)
    // 단계의 마지막 저장은 기한 없이 — 잠금을 푼다
    expect(patches().at(-1)).not.toHaveProperty('leaseUntil')
  })

  it('skipdesign1 기록 잡(기본 off, J07)은 설계 ①을 부르지 않고 기본 계획을 쓴다 — ②는 그대로 부르고 ① 비용은 0', async () => {
    const analysis = h.job!.analysis as unknown as { enrichment?: { version: 1; features: string[] } }
    const features = [...(analysis.enrichment?.features ?? []), 'skipdesign1']
    h.job = { ...h.job!, analysis: { ...h.job!.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis'] }
    const startCost = h.job.cost_usd
    const out = await runPdpStep(h.job.id, 'user-1')
    expect(h.calls.map((c) => c.name).sort()).toEqual(['prompts', 'skip'])
    expect(out.current_step).toBe('copywriting')
    expect(out.design_prompts).toEqual(h.prompts)
    expect(out.cost_usd).toBeCloseTo(startCost + 0.02, 6)
  })

  it('잡 진행 잠금을 쥐지 못하면(다른 곳이 먼저 쥐었다) 콜을 부르지 않고 다시 읽은 잡을 돌려준다 — 잠금이 보여 화면은 busy로 기다린다', async () => {
    h.claimable = false
    const out = await runPdpStep(h.job!.id, 'user-1')
    expect(isPdpJobLeased(out)).toBe(true)
    expect(h.calls).toHaveLength(0)
    expect(updatePdpJob).not.toHaveBeenCalled()
  })
})

describe('잡 진행 잠금 — 할 일이 없는 잡', () => {
  it("산출이 다 있는 잡('done' 판정)은 단계·진행률·오류만 기록하고 잠금을 싣지 않는다 — 쥔 채 돌려주면 화면이 기한까지 기다린다", async () => {
    h.job = { ...fixtureToJob(loadEnrichmentFixture('A-track-i')), current_step: 'compose' }
    expect(resolveStepToRun(h.job)).toBe('done')
    const out = await runPdpStep(h.job.id, 'user-1')
    expect(out.current_step).toBe('done')
    // 진행률은 끝(100) — 편집기 재생성 뒤 images → done은 compose를 거치지 않는다(pdp-image-regen-api)
    expect(patches()).toEqual([{ currentStep: 'done', progress: 100, error: null }])
    expect(h.calls).toHaveLength(0)
  })
})

describe('잡 진행 잠금 — 실패 경로', () => {
  it('잠금을 잃으면(기한이 지나 다른 곳이 쥐었다) 실패로 기록하지 않고 다시 읽은 잡을 돌려준다 — 기록하면 쥔 쪽의 잠금을 푼다', async () => {
    h.planThrows = new PdpLeaseLostError(h.job!.id)
    const out = await runPdpStep(h.job!.id, 'user-1')
    expect(updatePdpJob).not.toHaveBeenCalled()
    expect(getPdpJob).toHaveBeenCalledTimes(2)
    expect(out).toBe(h.job)
  })

  it('잠금을 쥔 뒤 단계 기록이 실패해도 실패 기록이 잠금을 푼다(500으로 끝나 잠금이 남지 않는다)', async () => {
    h.job = { ...h.job!, current_step: 'pending' }
    h.failStepWrite = true
    const out = await runPdpStep(h.job.id, 'user-1')
    expect(out.error).toContain('[design]')
    expect(patches().at(-1)).not.toHaveProperty('leaseUntil')
    expect(h.calls).toHaveLength(0)
  })
})

describe('설계 단계 — 잡 모델 배치(R03)', () => {
  it('새 배치 잡은 콜 ①·②가 같은 280초 기한을 받고 단계 안에서 새 배치로 보인다', async () => {
    h.job = { ...h.job!, model_batch: 'new', model_route_snapshot: null }
    const before = Date.now()
    await runPdpStep(h.job.id, 'user-1')
    expect(h.seen.map((c) => c.name).sort()).toEqual(['plan', 'prompts'])
    for (const c of h.seen) {
      expect(c.batch, c.name).toBe('new')
      expect(c.deadlineAt, c.name).toBeGreaterThanOrEqual(before + 280_000)
      expect(c.deadlineAt, c.name).toBeLessThanOrEqual(Date.now() + 280_000)
    }
    expect(h.seen[0].deadlineAt).toBe(h.seen[1].deadlineAt)
  })

  it('지금 배치 잡(배치 칸 없음)은 기한 없이 지금 그대로', async () => {
    await runPdpStep(h.job!.id, 'user-1')
    expect(h.seen).toHaveLength(2)
    for (const c of h.seen) {
      expect(c.batch, c.name).toBe('now')
      expect(c.deadlineAt, c.name).toBeUndefined()
    }
  })
})
