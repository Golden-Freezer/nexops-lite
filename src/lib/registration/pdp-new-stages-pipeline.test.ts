/**
 * 새 단계 5개 파이프라인 자리(R10) — 기획(리서치 뒤 run 하나)·카피 뒤 사실 감사(카피 뒤 run 하나)·첫 화면 심사·최종 검수(compose 안,
 * done 전). 켠 잡(새 배치 + newstages)은 결과 키만 더하고 다른 칸은 그대로, 꺼진 잡은 단계 판정·저장이 바이트까지 같다.
 * LLM·DB는 모의(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  calls: [] as Array<{ agent: string; model: string; effort?: string; maxTokens: number; timeoutMs?: number; maxRetries?: number; deadlineAt?: number; text: string; runContext?: unknown }>,
  replies: {} as Record<string, string>,
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/agents/budget', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: vi.fn(async () => ({ allowed: true, spentUsd: 0, budgetUsd: 1000 })),
}))
vi.mock('@/lib/agents/_base', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/_base')>()),
  callAgent: async (
    o: { config: { model: string; maxTokens: number; effort?: string }; agentName: string; timeoutMs?: number; maxRetries?: number; deadlineAt?: number; runContext?: unknown; messages: Array<{ content: unknown }> },
    parser: (t: string) => unknown,
  ) => {
    const text = typeof o.messages[0]?.content === 'string' ? (o.messages[0].content as string) : JSON.stringify(o.messages[0]?.content)
    h.calls.push({ agent: o.agentName, model: o.config.model, effort: o.config.effort, maxTokens: o.config.maxTokens, timeoutMs: o.timeoutMs, maxRetries: o.maxRetries, deadlineAt: o.deadlineAt, text, runContext: o.runContext })
    const usage = { inputTokens: 10, outputTokens: 20, cost: 0.05 }
    const reply = h.replies[o.agentName]
    if (reply === undefined) return { success: false, error: { message: `모의 답 없음 ${o.agentName}`, stage: 'api', attempts: 1 }, usage, duration: 1 }
    try {
      return { success: true, data: parser(reply), usage, duration: 1 }
    } catch (e) {
      return { success: false, error: { message: (e as Error).message, stage: 'parse', attempts: 1 }, usage, duration: 1 }
    }
  },
}))
vi.mock('./pdp-jobs', async (orig) => ({
  isPdpJobLeased: (await orig<typeof import('./pdp-jobs')>()).isPdpJobLeased,
  PdpLeaseLostError: (await orig<typeof import('./pdp-jobs')>()).PdpLeaseLostError,
  getPdpJob: vi.fn(async () => h.job),
  claimPdpJobRun: vi.fn(async (_db: unknown, _u: string, job: PdpJobRow) => ({ job, leaseUntil: new Date(Date.now() + 340_000).toISOString() })),
  updatePdpJob: vi.fn(async (_db: unknown, _u: string, _id: string, patch: Record<string, unknown>) => {
    const job = { ...h.job! }
    const fields: Array<[string, keyof PdpJobRow]> = [
      ['researchResult', 'research_result'],
      ['sectionPlan', 'section_plan'],
      ['designPrompts', 'design_prompts'],
      ['copySections', 'copy_sections'],
      ['finalHtml', 'final_html'],
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

import { resolveStepToRun, runPdpStep } from './pdp-pipeline'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'

const PLAN = {
  core_promise: '약속',
  target: '직장인',
  appeals: [{ rank: 1, appeal: 'a', evidence: 'e', source: 'spec' }],
  flow: [{ step: 1, section: 'hook_3step', say: 's', appeals: [1] }],
  hook: { promise: 'p', hero_moment: 'h' },
  cta: 'c',
  dropped: [],
  risks: [],
}
const AUDIT = { items: [], summary: { checked: 0, unsupported: 0, regulated: 0 } }

const full = () => fixtureToJob(loadEnrichmentFixture('A-track-i'))
function on(job: PdpJobRow): PdpJobRow {
  return { ...job, model_batch: 'new', analysis: { ...job.analysis, enrichment: { version: 1, features: ['newstages'] } } }
}
const off = (job: PdpJobRow): PdpJobRow => ({ ...on(job), model_batch: 'now' })
const planRecord = { version: 1 as const, stage: 'plan' as const, status: 'skipped' as const, reason: 'no_input' as const }
const auditRecord = { version: 1 as const, stage: 'factAudit' as const, status: 'skipped' as const, reason: 'no_input' as const }

beforeEach(() => {
  h.calls = []
  h.replies = {
    'registration/pdp-page-plan': JSON.stringify(PLAN),
    'registration/pdp-fact-audit': JSON.stringify(AUDIT),
    'registration/pdp-final-review': '{"flags":[],"pass":true}',
  }
})

describe('기획 — 리서치 뒤·설계 앞 run 하나', () => {
  it('켠 잡은 리서치가 있어도 research를 한 번 더 골라 기획만 부르고 page_plan 키만 더한다', async () => {
    const start = on(rewindTo(full(), 'design'))
    expect(resolveStepToRun(start)).toBe('research')
    h.job = start
    const out = await runPdpStep(start.id, 'user-1')
    expect(h.calls.map((c) => c.agent)).toEqual(['registration/pdp-page-plan'])
    expect(h.calls[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh', maxTokens: 20_000, timeoutMs: 240_000, maxRetries: 0 })
    expect(h.calls[0].deadlineAt).toEqual(expect.any(Number))
    const { page_plan, ...rest } = out.research_result
    expect(rest).toEqual(start.research_result)
    expect(page_plan).toMatchObject({ stage: 'plan', status: 'done', result: PLAN, route: { name: 'research/page-plan', model: 'claude-opus-5-5' } })
    expect(out.current_step).toBe('design')
    expect(out.cost_usd).toBeCloseTo(start.cost_usd + 0.05, 6)
    expect(resolveStepToRun(out)).toBe('design')
  })

  it('기획이 실패해도 기록하고 설계로 넘어간다(단계를 막지 않는다)', async () => {
    h.replies['registration/pdp-page-plan'] = '{"core_promise":"a","appeals":['
    const start = on(rewindTo(full(), 'design'))
    h.job = start
    const out = await runPdpStep(start.id, 'user-1')
    expect(out.research_result.page_plan).toMatchObject({ status: 'failed', failure: { kind: 'truncated' } })
    expect(out.current_step).toBe('design')
  })

  it('꺼진 잡(지금 배치)은 판정이 그대로 — 리서치가 있으면 design', () => {
    expect(resolveStepToRun(off(rewindTo(full(), 'design')))).toBe('design')
    expect(resolveStepToRun(rewindTo(full(), 'design'))).toBe('design')
  })
})

describe('사실 감사 — 카피 뒤 run 하나', () => {
  it('켠 잡은 카피가 있어도 copywriting을 한 번 더 골라 감사만 부르고 fact_audit 키만 더한다(카피는 그대로)', async () => {
    const base = on(rewindTo(full(), 'images'))
    const start = { ...base, research_result: { ...base.research_result, page_plan: planRecord } }
    expect(resolveStepToRun(start)).toBe('copywriting')
    h.job = start
    const out = await runPdpStep(start.id, 'user-1')
    // 골든 A-track-i 카피 화면 글 74줄·1,417자 → 40줄 기준으로 37줄 두 묶음을 동시에(R11c — R11b 1,500자 기준만이면 한 콜이었다)
    expect(h.calls.map((c) => c.agent)).toEqual(['registration/pdp-fact-audit', 'registration/pdp-fact-audit'])
    expect(h.calls[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh', maxTokens: 20_000, timeoutMs: 200_000, maxRetries: 1 })
    expect(h.calls[0].text).toContain('## 감사할 화면 글(id: 글)')
    expect(h.calls[0].text).toContain('- mainIntro.')
    const { fact_audit, ...rest } = out.copy_sections
    expect(rest).toEqual(start.copy_sections)
    expect(fact_audit).toMatchObject({ stage: 'factAudit', status: 'done', result: AUDIT })
    expect(out.current_step).toBe('images')
    expect(resolveStepToRun(out)).toBe('images')
  })

  it('꺼진 잡은 카피가 있으면 images', () => {
    expect(resolveStepToRun(off(rewindTo(full(), 'images')))).toBe('images')
  })
})

describe('첫 화면 심사·최종 검수 — compose 안, done 전', () => {
  const composeJob = (make: (job: PdpJobRow) => PdpJobRow) => {
    const base = make(rewindTo(full(), 'compose'))
    return {
      ...base,
      research_result: { ...base.research_result, page_plan: planRecord },
      copy_sections: { ...base.copy_sections, fact_audit: auditRecord },
      design_prompts: { ...base.design_prompts, director: { version: 1 as const, stage: 'director' as const, status: 'skipped' as const, reason: 'no_input' as const } },
    }
  }

  it('켠 잡 — 합성하고 첫 화면은 웹 생략, 최종 검수를 부른 뒤 done. 다른 section_plan 칸은 그대로', async () => {
    const start = composeJob(on)
    expect(resolveStepToRun(start)).toBe('compose')
    h.job = start
    const out = await runPdpStep(start.id, 'user-1')
    expect(h.calls.map((c) => c.agent)).toEqual(['registration/pdp-final-review'])
    expect(h.calls[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh', maxTokens: 12_000 })
    expect(out.current_step).toBe('done')
    expect(out.final_html).toEqual(expect.any(String))
    const { first_screen, final_review, ...rest } = out.section_plan
    expect(rest).toEqual(start.section_plan)
    expect(first_screen).toEqual({ version: 1, stage: 'firstScreen', status: 'skipped', reason: 'web_no_renderer' })
    expect(final_review).toMatchObject({ stage: 'finalReview', status: 'done', result: { flags: [], pass: true } })
    expect(out.cost_usd).toBeCloseTo(start.cost_usd + 0.05, 6)
  })

  it('꺼진 잡 — 부르지 않고 section_plan이 그대로, 합성 결과(final_html)는 켠 잡과 같다', async () => {
    const offStart = composeJob(off)
    h.job = offStart
    const offOut = await runPdpStep(offStart.id, 'user-1')
    expect(h.calls).toHaveLength(0)
    expect(offOut.section_plan).toEqual(offStart.section_plan)
    expect(offOut.cost_usd).toBe(offStart.cost_usd)

    const onStart = composeJob(on)
    h.job = onStart
    const onOut = await runPdpStep(onStart.id, 'user-1')
    expect(onOut.final_html).toBe(offOut.final_html)
  })
})

describe('하네스 K<n>-NS 모양 시험 잡(R11a) — 첫 생성의 기획·카피 뒤 감사·합성 뒤 검수', () => {
  // 시험 잡(cost_pool test) + 새 배치 + newstages — 하네스가 만드는 잡과 같은 켬 조건. 이미지 단계의 감독·칸 감사는 k-line-run 시험
  const harness = (job: PdpJobRow): PdpJobRow => ({ ...on(job), cost_pool: 'test' })
  const director = { version: 1 as const, stage: 'director' as const, status: 'skipped' as const, reason: 'no_input' as const }

  it('세 자리 모두 새 단계 route로 부르고 기록한다 — 콜은 시험 풀(run_id = 잡 id), 첫 화면 심사는 웹 생략(web_no_renderer)', async () => {
    const research = harness(rewindTo(full(), 'design'))
    h.job = research
    const planned = await runPdpStep(research.id, 'user-1')
    expect(planned.research_result.page_plan).toMatchObject({ status: 'done', route: { name: 'research/page-plan' } })

    const copyBase = harness(rewindTo(full(), 'images'))
    const copied = { ...copyBase, research_result: { ...copyBase.research_result, page_plan: planRecord } }
    expect(resolveStepToRun(copied)).toBe('copywriting')
    h.job = copied
    const audited = await runPdpStep(copied.id, 'user-1')
    expect(audited.copy_sections.fact_audit).toMatchObject({ status: 'done', route: { name: 'copy/fact-audit' } })

    const composeBase = harness(rewindTo(full(), 'compose'))
    const composing = {
      ...composeBase,
      research_result: { ...composeBase.research_result, page_plan: planRecord },
      copy_sections: { ...composeBase.copy_sections, fact_audit: auditRecord },
      design_prompts: { ...composeBase.design_prompts, director },
    }
    expect(resolveStepToRun(composing)).toBe('compose')
    h.job = composing
    const finished = await runPdpStep(composing.id, 'user-1')
    expect(finished.section_plan.first_screen).toEqual({ version: 1, stage: 'firstScreen', status: 'skipped', reason: 'web_no_renderer' })
    expect(finished.section_plan.final_review).toMatchObject({ status: 'done', route: { name: 'compose/final-review' } })
    expect(finished.current_step).toBe('done')
    // 카피 뒤 감사는 골든 74줄이라 두 묶음(R11c 40줄 기준)
    expect(h.calls.map((c) => c.agent)).toEqual(['registration/pdp-page-plan', 'registration/pdp-fact-audit', 'registration/pdp-fact-audit', 'registration/pdp-final-review'])
    for (const call of h.calls) expect(call.runContext).toMatchObject({ costPool: 'pdp-test', runId: research.id })
  })
})
