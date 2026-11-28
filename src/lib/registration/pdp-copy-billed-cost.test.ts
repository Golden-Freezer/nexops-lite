/**
 * 실패·잘린 시도 값을 잡 비용에(하네스 R12d) — R11 P07 K11-N 잡 ff8b9c85에서 카피 1단(새 배치 Opus 5.5, 상한 12,000) 첫 시도가 상한에서
 * 잘린 값 0.3886달러가 사용 기록(ai_usage_log)·원장에는 있고 잡 cost_usd에는 빠졌다(원장 6.6209 · 잡 6.2324). 공급자(callAgent·callGemini)만
 * 모의하고 실제 카피 에이전트·파이프라인으로 카피 단계를 돌려, 잡 cost_usd 증가가 모든 콜의 과금 합(앞선 잘린 시도 포함)과 같은지, 그 값이
 * 잡당 상한 판정에 드는지 본다. J34 뒤 새 배치 원문 카피 3단은 Gemini argon(callGemini — 같은 spent 계약), 점 카드 다시 받기는 callAgent다. 유료 0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => {
  const state = {
    job: null as PdpJobRow | null,
    /** 카피 콜이 돌려줄 카피(골든 최종본) */
    reply: '',
    /** 에이전트 이름 → 첫 콜에 더할 앞선 잘린 시도 값(spent에만 든다 — callAgent·callGemini 계약) */
    truncatedFirst: {} as Record<string, { inputTokens: number; outputTokens: number; cost: number }>,
    /** 콜마다 과금된 값(spent ?? usage) */
    billed: [] as Array<{ agent: string; cost: number }>,
  }
  /** 공급자 한 콜 — 앞선 잘린 시도가 있으면 spent = 그 시도 + 마지막 시도(usage는 마지막 시도 그대로) */
  const call = (agentName: string, parser: (t: string) => unknown) => {
    const usage = { inputTokens: 10, outputTokens: 20, cost: 0.05 }
    const extra = state.truncatedFirst[agentName]
    delete state.truncatedFirst[agentName]
    const spent = extra
      ? { inputTokens: extra.inputTokens + usage.inputTokens, outputTokens: extra.outputTokens + usage.outputTokens, cost: extra.cost + usage.cost }
      : undefined
    state.billed.push({ agent: agentName, cost: (spent ?? usage).cost })
    try {
      return { success: true, data: parser(state.reply), usage, duration: 1, ...(spent ? { spent } : {}) }
    } catch (e) {
      return { success: false, error: { message: (e as Error).message, stage: 'parse', attempts: 1 }, usage, duration: 1, ...(spent ? { spent } : {}) }
    }
  }
  return Object.assign(state, { call })
})

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/agents/budget', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: vi.fn(async () => ({ allowed: true, spentUsd: 0, budgetUsd: 1000 })),
}))
vi.mock('@/lib/agents/_base', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/_base')>()),
  callAgent: async (o: { agentName: string }, parser: (t: string) => unknown) => h.call(o.agentName, parser),
}))
vi.mock('@/lib/agents/llm/providers/gemini', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/llm/providers/gemini')>()),
  callGemini: async (_route: unknown, request: { agentName: string }, parser: (t: string) => unknown) => h.call(request.agentName, parser),
}))
vi.mock('./pdp-jobs', async (orig) => ({
  isPdpJobLeased: (await orig<typeof import('./pdp-jobs')>()).isPdpJobLeased,
  PdpLeaseLostError: (await orig<typeof import('./pdp-jobs')>()).PdpLeaseLostError,
  getPdpJob: vi.fn(async () => h.job),
  claimPdpJobRun: vi.fn(async (_db: unknown, _u: string, job: PdpJobRow) => ({ job, leaseUntil: new Date(Date.now() + 340_000).toISOString() })),
  updatePdpJob: vi.fn(async (_db: unknown, _u: string, _id: string, patch: Record<string, unknown>) => {
    const job = { ...h.job! }
    const fields: Array<[string, keyof PdpJobRow]> = [
      ['copySections', 'copy_sections'],
      ['currentStep', 'current_step'],
      ['progress', 'progress'],
      ['costUsd', 'cost_usd'],
      ['error', 'error'],
    ]
    for (const [key, column] of fields) if (patch[key] !== undefined) (job as Record<string, unknown>)[column] = patch[key]
    h.job = job
    return job
  }),
}))

import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'
import { jobCostCapReached } from './job-cost-cap'
import { runPdpStep } from './pdp-pipeline'

/** ff8b9c85 카피 1단 첫 시도(사용 기록 success=false 행) — 출력 12,000에서 잘림, 110초 */
const P07_STAGE1_TRUNCATED = { inputTokens: 9_000, outputTokens: 12_000, cost: 0.388592 }

/** 새 배치 시험 잡(K<n>-N 모양 — 새 단계 없음)을 카피 단계로 되감는다. 연령 게이트는 빼서 재생성 없이 본다 */
function copyJob(costUsd: number): PdpJobRow {
  const full = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  h.reply = JSON.stringify(full.copy_sections.final)
  const base = rewindTo(full, 'copywriting')
  const { minAgeYears: _age, ...spec } = base.spec_sheet
  void _age
  return { ...base, spec_sheet: spec, model_batch: 'new', cost_pool: 'test', cost_usd: costUsd } as PdpJobRow
}

beforeEach(() => {
  h.billed = []
  h.truncatedFirst = {}
})

describe('카피 단계 — 앞선 잘린 시도 값이 잡 cost_usd에 든다', () => {
  it('카피 1단 첫 시도가 잘리고 두 번째에 끝나면, 잡 비용 증가 = 모든 콜의 과금 합(잘린 시도 0.3886 포함)', async () => {
    const start = copyJob(1.2)
    h.job = start
    h.truncatedFirst['registration/pdp-copy-stage1'] = P07_STAGE1_TRUNCATED
    const out = await runPdpStep(start.id, 'user-1')

    expect(out.current_step).toBe('images')
    expect(h.billed[0]).toEqual({ agent: 'registration/pdp-copy-stage1', cost: expect.closeTo(0.388592 + 0.05, 9) })
    const billedSum = h.billed.reduce((sum, call) => sum + call.cost, 0)
    expect(billedSum).toBeCloseTo(0.05 * h.billed.length + 0.388592, 9)
    expect(out.cost_usd - start.cost_usd).toBeCloseTo(billedSum, 9)
  })

  it('잘린 시도가 없으면 지금과 같다 — 잡 비용 증가 = 콜 수 × 마지막 시도 값', async () => {
    const start = copyJob(1.2)
    h.job = start
    const out = await runPdpStep(start.id, 'user-1')
    expect(out.cost_usd - start.cost_usd).toBeCloseTo(0.05 * h.billed.length, 9)
  })

  it('잡당 상한 판정에 든다 — 상한 바로 아래 잡이 잘린 시도 값으로 상한에 닿는다(빠졌으면 닿지 않았다)', async () => {
    // 콜 수를 먼저 잰다(잘림 없음) — 마지막 시도 값만 더하면 상한 0.2 아래에서 멈추게 시작 비용을 정한다
    h.job = copyJob(0)
    await runPdpStep(h.job.id, 'user-1')
    const calls = h.billed.length
    h.billed = []
    const start = copyJob(10 - 0.05 * calls - 0.2)
    h.job = start
    h.truncatedFirst['registration/pdp-copy-stage1'] = P07_STAGE1_TRUNCATED
    const out = await runPdpStep(start.id, 'user-1')
    expect(h.billed).toHaveLength(calls)
    const lastAttemptsOnly = start.cost_usd + 0.05 * calls
    expect(jobCostCapReached({ ...out, cost_usd: lastAttemptsOnly }, 10)).toBeNull()
    expect(jobCostCapReached(out, 10)).toMatchObject({ capUsd: 10, spentUsd: expect.closeTo(10 - 0.2 + 0.388592, 9) })
  })
})
