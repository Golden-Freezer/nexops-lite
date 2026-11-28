/**
 * 분석 단계가 자동 감지한 사용연령 면제 표시를 spec에 남기는지(오너 2026-11-01 반려동물·2026-11-02 식품). 표는 spec만 보는데 감지 값은 analysis에 있다.
 * 분석 에이전트·DB는 모의(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  detected: 'food',
  patches: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/agents/budget', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: vi.fn(async () => ({ allowed: true, spentUsd: 0, budgetUsd: 1000 })),
}))
vi.mock('./pdp-jobs', async (orig) => ({
  isPdpJobLeased: (await orig<typeof import('./pdp-jobs')>()).isPdpJobLeased,
  PdpLeaseLostError: (await orig<typeof import('./pdp-jobs')>()).PdpLeaseLostError,
  getPdpJob: vi.fn(async () => h.job),
  claimPdpJobRun: vi.fn(async (_db: unknown, _user: string, job: PdpJobRow) => ({
    job,
    leaseUntil: new Date(Date.now() + 340_000).toISOString(),
  })),
  updatePdpJob: vi.fn(async (_db: unknown, _user: string, _id: string, patch: Record<string, unknown>) => {
    h.patches.push(patch)
    return h.job
  }),
}))
vi.mock('@/lib/agents/registration/pdp-analysis-agent', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/registration/pdp-analysis-agent')>()),
  runPdpAnalysis: vi.fn(async () => ({
    success: true,
    data: { analysis: { keywords: ['a'], detected_category: h.detected }, warnings: [] },
    usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
  })),
}))

import { runPdpStep } from './pdp-pipeline'

const makeJob = (spec: Record<string, unknown>) =>
  ({
    id: 'job-1',
    user_id: 'user-1',
    spec_sheet: { productName: '소스', ...spec },
    analysis: {},
    research_result: {},
    design_prompts: {},
    section_plan: {},
    copy_sections: {},
    section_images: [],
    mode: 'premium',
    status: 'pending',
    current_step: 'pending',
    progress: 0,
    error: null,
    cost_usd: 0,
    created_at: '2026-11-02T00:00:00Z',
    updated_at: '2026-11-02T00:00:00Z',
  }) as unknown as PdpJobRow

const analysisPatch = () => h.patches.find((p) => p.analysis !== undefined)!

describe('분석 단계 — 자동 감지한 반려동물·식품', () => {
  beforeEach(() => {
    h.patches = []
    h.detected = 'food'
  })

  it.each(['food', 'pet'])('카테고리가 비었고 %s로 감지하면 spec에 남긴다', async (detected) => {
    h.detected = detected
    h.job = makeJob({})
    await runPdpStep('job-1', 'user-1')
    expect(analysisPatch().specSheet).toEqual({ productName: '소스', detectedCategory: detected })
  })

  it('사람이 고른 카테고리는 쓰지 않는다', async () => {
    h.job = makeJob({ category: 'household' })
    await runPdpStep('job-1', 'user-1')
    expect(analysisPatch()).not.toHaveProperty('specSheet')
  })

  it('다른 카테고리로 감지하면 spec을 쓰지 않는다', async () => {
    h.detected = 'household'
    h.job = makeJob({})
    await runPdpStep('job-1', 'user-1')
    expect(analysisPatch()).not.toHaveProperty('specSheet')
  })
})
