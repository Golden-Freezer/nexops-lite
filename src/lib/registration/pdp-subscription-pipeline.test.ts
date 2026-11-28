/**
 * 파이프라인 × 구독 표지 잡(R13) — 표지 잡은 단계 안에서 백엔드 'subscription'으로 보이고(pdpRoute가 구독 route를 고른다), 단계 안에서
 * 일어난 API 잇기 기록은 단계가 끝난 뒤 section_plan.subscription_fallback에 조건부 저장된다. 표지 없는 잡은 'api'·추가 저장 없음.
 * 설계 콜이 실패해도 모은 잇기 기록은 남는다. LLM·DB는 모의(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  plan: null as PdpJobRow['section_plan'] | null,
  prompts: null as PdpJobRow['design_prompts'] | null,
  seen: [] as Array<{ name: string; backend: string; route: unknown }>,
  /** 계획 콜 안에서 구독이 막혀 API로 잇는다 */
  fallback: false,
  planFails: false,
  /** 계획 콜이 실제 callLlm으로 구독을 부른다 — 백엔드가 등록돼 있지 않아 소프트 종료로 멈춘다 */
  realCall: false,
  apiCalls: 0,
  runs: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/agents/_base', () => ({ callAgent: async () => (h.apiCalls++, { success: true, data: 'ok', usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, duration: 0 }) }))
vi.mock('@/lib/agents/openai-chat', () => ({ callOpenAiChat: async () => (h.apiCalls++, { success: true, data: 'ok', usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, duration: 0 }) }))
vi.mock('@/lib/ops/job-runs', async (orig) => ({
  ...(await orig<typeof import('@/lib/ops/job-runs')>()),
  recordJobRun: async (_db: unknown, input: Record<string, unknown>) => (h.runs.push(input), { recorded: true }),
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
  claimPdpJobRun: vi.fn(async (_db: unknown, _u: string, job: PdpJobRow) => ({
    job,
    leaseUntil: new Date(Date.now() + 340_000).toISOString(),
  })),
  updatePdpJob: vi.fn(async (_db: unknown, _u: string, _id: string, patch: Record<string, unknown>) => {
    const job = { ...h.job!, updated_at: new Date().toISOString() }
    if (patch.error !== undefined) job.error = patch.error as string | null
    if (patch.sectionPlan !== undefined) job.section_plan = patch.sectionPlan as PdpJobRow['section_plan']
    if (patch.designPrompts !== undefined) job.design_prompts = patch.designPrompts as PdpJobRow['design_prompts']
    if (patch.currentStep !== undefined) job.current_step = patch.currentStep as PdpJobRow['current_step']
    if (patch.costUsd !== undefined) job.cost_usd = patch.costUsd as number
    h.job = job
    return job
  }),
  updatePdpJobIfUnchanged: vi.fn(async (_db: unknown, _u: string, _job: PdpJobRow, patch: Record<string, unknown>) => {
    const job = { ...h.job!, updated_at: new Date().toISOString() }
    if (patch.sectionPlan !== undefined) job.section_plan = patch.sectionPlan as PdpJobRow['section_plan']
    if (patch.error !== undefined) job.error = patch.error as string | null
    if (patch.currentStep !== undefined) job.current_step = patch.currentStep as PdpJobRow['current_step']
    h.job = job
    return job
  }),
}))

async function observe(name: string) {
  const { currentPdpBackend } = await import('@/lib/registration/pdp-model-batch-context')
  const { pdpRoute } = await import('@/lib/registration/pdp-model-routes')
  h.seen.push({ name, backend: currentPdpBackend(), route: pdpRoute('design/section-planning') })
}

vi.mock('@/lib/agents/registration/pdp-design-agent', () => ({
  planPdpSections: vi.fn(async () => {
    await observe('plan')
    if (h.realCall) {
      const { callLlm } = await import('@/lib/agents/llm')
      const { pdpRoute } = await import('@/lib/registration/pdp-model-routes')
      await callLlm(pdpRoute('design/section-planning'), { system: 's', messages: [], agentName: 'registration/pdp-design-plan', runContext: { stage: 'design' } }, (t) => t)
    }
    if (h.fallback) {
      const { callWithSubscriptionFallback } = await import('@/lib/agents/llm/subscription-fallback')
      const { LlmSoftStopError } = await import('@/lib/agents/llm/local-llm-backend')
      await callWithSubscriptionFallback(
        { model: 'claude-opus-5-5', maxTokens: 8000, effort: 'high', backend: 'subscription', subscriptionFallback: 'api' },
        { system: 's', messages: [], agentName: 'registration/pdp-design-plan', runContext: { stage: 'design' } },
        'claude-cli',
        {
          subscription: async () => {
            throw new LlmSoftStopError({ backend: 'claude-cli', reason: 'quota', message: '한도', at: new Date().toISOString() })
          },
          api: async () => ({ success: true, data: 'ok', usage: { inputTokens: 1, outputTokens: 1, cost: 0.12 }, duration: 1 }),
        }
      )
    }
    if (h.planFails) throw new Error('계획 실패')
    return { sectionPlan: h.plan, usedFallback: false, error: null, costUsd: 0.12 }
  }),
  generatePdpDesignPrompts: vi.fn(async () => {
    await observe('prompts')
    return { designPrompts: h.prompts, usedFallback: false, error: null, costUsd: 0 }
  }),
}))

import { clearLocalLlmBackends, peekLocalLlmSoftStop } from '@/lib/agents/llm/local-llm-backend'
import { claimPdpJobRun, updatePdpJob, updatePdpJobIfUnchanged } from './pdp-jobs'
import { runPdpStep } from './pdp-pipeline'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'

beforeEach(() => {
  const full = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  h.plan = full.section_plan
  h.prompts = full.design_prompts
  h.job = { ...rewindTo(full, 'design'), model_batch: 'new', model_route_snapshot: null, model_backend: 'subscription' }
  h.seen = []
  h.fallback = false
  h.planFails = false
  h.realCall = false
  h.apiCalls = 0
  h.runs = []
  clearLocalLlmBackends()
  vi.mocked(updatePdpJobIfUnchanged).mockClear()
})

describe('파이프라인 — 구독 표지 잡(R13)', () => {
  it('표지 잡은 단계 안에서 백엔드 subscription — 새 배치 Claude 단계 route가 구독 + API 잇기다', async () => {
    await runPdpStep(h.job!.id, 'user-1')
    expect(h.seen.map((s) => s.backend)).toEqual(['subscription', 'subscription'])
    expect(h.seen[0].route).toMatchObject({ model: 'claude-opus-5-5', backend: 'subscription', subscriptionFallback: 'api' })
    // 잇기가 없으면 추가 저장도 없다
    expect(updatePdpJobIfUnchanged).not.toHaveBeenCalled()
  })

  it('표지 없는 잡은 api — 새 배치 표 그대로(구독 없음)', async () => {
    h.job = { ...h.job!, model_backend: undefined }
    await runPdpStep(h.job.id, 'user-1')
    expect(h.seen.map((s) => s.backend)).toEqual(['api', 'api'])
    expect(h.seen[0].route).not.toHaveProperty('backend')
  })

  it('단계 안의 API 잇기는 단계가 끝난 뒤 section_plan.subscription_fallback에 남는다(청구액·사유)', async () => {
    h.fallback = true
    const out = await runPdpStep(h.job!.id, 'user-1')
    expect(out.current_step).toBe('copywriting')
    expect(updatePdpJobIfUnchanged).toHaveBeenCalledTimes(1)
    expect(out.section_plan.subscription_fallback).toEqual([
      expect.objectContaining({ stage: 'design', backend: 'claude-cli', reason: 'quota', costUsd: 0.12, apiSuccess: true }),
    ])
    // 설계 단계가 쓴 계획 칸은 그대로 남는다
    expect(out.section_plan.section_order).toEqual(h.plan!.section_order)
  })

  it('설계 콜이 실패해도 모은 잇기 기록은 남는다(실패 기록 뒤)', async () => {
    h.fallback = true
    h.planFails = true
    const out = await runPdpStep(h.job!.id, 'user-1')
    expect(out.error).toContain('[design]')
    expect(out.section_plan.subscription_fallback).toHaveLength(1)
  })
})

describe('파이프라인 — 구독 멈춤 표지 잡(AX-CT-29)', () => {
  const stopJob = (): PdpJobRow => ({ ...h.job!, subscription_stop: true })

  it('단계 안에서 멈춤 표지 route(subscriptionHalt, 잇기 없음)를 본다 — 표지 없는 구독 잡은 지금처럼 잇기 route', async () => {
    h.job = stopJob()
    await runPdpStep(h.job.id, 'user-1')
    expect(h.seen[0].route).toMatchObject({ model: 'claude-opus-5-5', backend: 'subscription', subscriptionHalt: true })
    expect(h.seen[0].route).not.toHaveProperty('subscriptionFallback')
  })

  it('구독 백엔드가 미등록이어도 라이트 callLlm은 로컬 Codex 경로로 계속하고 멈춤·폴백 기록을 만들지 않는다', async () => {
    h.job = stopJob()
    h.realCall = true
    const out = await runPdpStep(h.job.id, 'user-1')
    expect(h.apiCalls).toBe(1)
    expect(out.current_step).toBe('copywriting')
    expect(out.model_backend).toBe('subscription')
    expect(out.section_plan).not.toHaveProperty('subscription_halt')
    expect(out.section_plan).not.toHaveProperty('subscription_fallback')
    expect(out.error).toBeNull()
    expect(updatePdpJobIfUnchanged).not.toHaveBeenCalled()
    expect(h.runs).toHaveLength(0)
    expect(peekLocalLlmSoftStop()).toBeNull()
  })

  it('구독 소프트 종료 사유(quota)는 오류의 stop.reason 그대로 기록한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.job = stopJob()
    h.planFails = false
    const { LlmSoftStopError } = await import('@/lib/agents/llm/local-llm-backend')
    const { planPdpSections } = await import('@/lib/agents/registration/pdp-design-agent')
    vi.mocked(planPdpSections).mockRejectedValueOnce(
      new LlmSoftStopError({ backend: 'claude-cli', reason: 'quota', message: '한도 소진', at: new Date().toISOString() })
    )
    const out = await runPdpStep(h.job.id, 'user-1')
    expect(out.section_plan.subscription_halt).toMatchObject({ reason: 'quota', detail: '한도 소진' })
    expect(h.runs).toHaveLength(1)
  })

  it('프로세스 실패(reason process)도 단계 실패(3회 규칙)로 세지 않고 멈춤으로 기록한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.job = stopJob()
    const { LlmSoftStopError } = await import('@/lib/agents/llm/local-llm-backend')
    const { planPdpSections } = await import('@/lib/agents/registration/pdp-design-agent')
    vi.mocked(planPdpSections).mockRejectedValueOnce(
      new LlmSoftStopError({ backend: 'codex-cli', reason: 'process', message: 'codex exit 1', at: new Date().toISOString() })
    )
    const out = await runPdpStep(h.job.id, 'user-1')
    expect(out.current_step).toBe('design')
    expect(out.section_plan.subscription_halt).toMatchObject({ reason: 'process', detail: 'codex exit 1' })
    expect(out.error).not.toMatch(/\(\d\/\d\)/)
  })

  it('표지 없는 구독 잡은 소프트 종료도 지금처럼 error만 남긴다(멈춤 기록·사건 줄 없음)', async () => {
    h.job = { ...h.job!, subscription_stop: undefined }
    const { LlmSoftStopError } = await import('@/lib/agents/llm/local-llm-backend')
    const { planPdpSections } = await import('@/lib/agents/registration/pdp-design-agent')
    vi.mocked(planPdpSections).mockRejectedValueOnce(
      new LlmSoftStopError({ backend: 'claude-cli', reason: 'quota', message: '한도 소진', at: new Date().toISOString() })
    )
    const out = await runPdpStep(h.job.id, 'user-1')
    expect(out.section_plan).not.toHaveProperty('subscription_halt')
    expect(out.error).toContain('[design]')
    expect(h.runs).toHaveLength(0)
  })
})

describe('파이프라인 — 멈춘 stop 잡 앞 가드(AX-CT-29 검수 2)', () => {
  const HALT = { at: '2026-11-12T01:00:00.000Z', stage: 'design', reason: 'quota' as const, detail: '한도' }

  it('멈춤 기록이 있는 stop 잡은 진행하지 않고 그대로 돌려준다 — 잠금·단계·저장·사건 줄 0(멈춤 기록을 덮지 않는다)', async () => {
    vi.mocked(claimPdpJobRun).mockClear()
    vi.mocked(updatePdpJob).mockClear()
    const halted: PdpJobRow = { ...h.job!, subscription_stop: true, section_plan: { ...h.job!.section_plan, subscription_halt: HALT } }
    h.job = halted
    const out = await runPdpStep(halted.id, 'user-1')
    expect(out).toBe(halted)
    expect(claimPdpJobRun).not.toHaveBeenCalled()
    expect(updatePdpJob).not.toHaveBeenCalled()
    expect(h.seen).toHaveLength(0)
    expect(h.runs).toHaveLength(0)
  })

  it('표지 없는 구독 잡은 section_plan 에 멈춤 칸이 있어도 지금처럼 진행한다(가드는 stop 잡만)', async () => {
    h.job = { ...h.job!, subscription_stop: undefined, section_plan: { ...h.job!.section_plan, subscription_halt: HALT } }
    await runPdpStep(h.job.id, 'user-1')
    expect(h.seen.length).toBeGreaterThan(0)
  })
})

describe('파이프라인 — 단계 마지막 저장이 웹 멈춤 기록을 지우지 않는다(AX-CT-29 결정 45)', () => {
  const HALT = { at: '2026-11-12T05:00:00.000Z', stage: 'design', reason: 'worker_stale' as const, detail: '웹' }

  /** 실제 updatePdpJob 이 쓰는 꼴만 흉내 내는 행 하나(eq·is 조건을 실제로 따진다) */
  function rowDb(stored: Record<string, unknown>) {
    return {
      from: () => {
        const conds: Array<(r: Record<string, unknown>) => boolean> = []
        let fields: Record<string, unknown> | null = null
        const b = {
          update: (f: Record<string, unknown>) => ((fields = f), b),
          eq: (c: string, v: unknown) => (conds.push((r) => r[c] === v), b),
          is: (c: string, v: unknown) => (conds.push((r) => ((r.section_plan as Record<string, unknown>)[c.replace(/^section_plan->>/, '')] ?? null) === v), b),
          select: () =>
            fields
              ? {
                  single: async () => {
                    if (!conds.every((c) => c(stored))) return { data: null, error: { code: 'PGRST116', message: '0 rows' } }
                    Object.assign(stored, fields)
                    return { data: { ...stored }, error: null }
                  },
                }
              : b,
          maybeSingle: async () => ({ data: conds.every((c) => c(stored)) ? { section_plan: stored.section_plan } : null, error: null }),
        }
        return b
      },
    } as never
  }

  it('웹 멈춤 기록 뒤 설계 단계의 마지막 저장 → 기록 보존·단계 결과 저장·사건 줄 0, 다음 runPdpStep 은 가드로 멈춘다', async () => {
    const actual = await vi.importActual<typeof import('./pdp-jobs')>('./pdp-jobs')
    const { specSheetForSave } = await import('./pdp-model-batch')
    const { planPdpSections } = await import('@/lib/agents/registration/pdp-design-agent')
    const job: PdpJobRow = { ...h.job!, user_id: 'user-1', subscription_stop: true }
    h.job = job
    const { model_batch: _b, model_route_snapshot: _s, model_backend: _m, subscription_stop: _t, ...columns } = job
    void [_b, _s, _m, _t]
    const stored: Record<string, unknown> = { ...columns, spec_sheet: specSheetForSave(job, job.spec_sheet) }
    const db = rowDb(stored)
    const original = vi.mocked(updatePdpJob).getMockImplementation()
    vi.mocked(updatePdpJob).mockImplementation(async (_d, u, id, patch) => {
      const out = await actual.updatePdpJob(db, u, id, patch)
      h.job = out
      return out
    })
    try {
      // 설계 콜이 도는 사이(한 run 이 약 640초 넘게 저장 없이 돌아 잠금이 풀린 뒤) 웹이 멈춤을 기록했다 — 메모리의 잡은 모른다
      vi.mocked(planPdpSections).mockImplementationOnce(async () => {
        stored.section_plan = { ...(stored.section_plan as object), subscription_halt: HALT }
        stored.updated_at = new Date().toISOString()
        return { sectionPlan: h.plan!, usedFallback: false, error: null, costUsd: 0.12 } as never
      })
      const out = await runPdpStep(job.id, 'user-1')
      expect(out.section_plan.subscription_halt).toEqual(HALT)
      expect(out.current_step).toBe('copywriting') // 단계 결과는 저장된다
      expect(out.section_plan.activated_sections?.length).toBeGreaterThan(0)
      expect((stored.section_plan as Record<string, unknown>).subscription_halt).toEqual(HALT)
      expect(h.runs).toHaveLength(0) // 사건 줄은 웹이 쓴 한 줄뿐(여기서 더 쓰지 않는다)

      vi.mocked(claimPdpJobRun).mockClear()
      h.seen = []
      const again = await runPdpStep(job.id, 'user-1')
      expect(again).toBe(out) // 멈춘 stop 잡 가드 — '이어 하기'만 푼다
      expect(claimPdpJobRun).not.toHaveBeenCalled()
      expect(h.seen).toHaveLength(0)
    } finally {
      vi.mocked(updatePdpJob).mockImplementation(original!)
    }
  })
})
