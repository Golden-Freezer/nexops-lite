/**
 * 구독 백엔드 소프트 종료(pdp-llm-subscription-backend) — 카피 단계에서 LlmSoftStopError가 나면 실패로 세지 않는다.
 * 사유만 잡 오류 칸에 남기고 그 저장으로 진행 잠금을 푼다(단계는 그대로, failed로 가지 않는다). 그 밖의 오류는 지금처럼
 * 실패로 센다. LLM·DB는 모의(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  copyThrows: null as Error | null,
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
    const job = { ...h.job! }
    if (patch.error !== undefined) job.error = patch.error as string | null
    if (patch.currentStep !== undefined) job.current_step = patch.currentStep as PdpJobRow['current_step']
    h.job = job
    return job
  }),
}))
vi.mock('@/lib/agents/registration/pdp-copy-agent', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/registration/pdp-copy-agent')>()),
  runPdpCopywriting: vi.fn(async () => {
    throw h.copyThrows
  }),
}))

import { LlmSoftStopError, LOCAL_LLM_SOFT_STOP_MARKER } from '@/lib/agents/llm/local-llm-backend'
import { updatePdpJob } from './pdp-jobs'
import { runPdpStep } from './pdp-pipeline'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'

const patches = () => vi.mocked(updatePdpJob).mock.calls.map(([, , , patch]) => patch)
const stop = new LlmSoftStopError({ backend: 'codex-cli', reason: 'quota', message: '구독 한도 소진', at: 'x' })

beforeEach(() => {
  h.job = rewindTo(fixtureToJob(loadEnrichmentFixture('A-track-i')), 'copywriting')
  h.copyThrows = null
  vi.mocked(updatePdpJob).mockClear()
})

describe('runPdpStep — 구독 소프트 종료', () => {
  it('실패로 세지 않고 사유만 남기며, 마지막 저장은 잠금을 싣지 않는다(잠금 해제)', async () => {
    h.copyThrows = stop
    const after = await runPdpStep(h.job!.id, h.job!.user_id)
    expect(after.current_step).toBe('copywriting')
    expect(after.error).toBe(`[copywriting] ${LOCAL_LLM_SOFT_STOP_MARKER} quota: 구독 한도 소진`)
    const last = patches().at(-1)!
    expect(last).toEqual({ error: after.error })
    expect(last).not.toHaveProperty('leaseUntil')
  })

  it('이전 실패가 두 번 쌓여(한 번 더면 failed) 있어도 소프트 종료는 failed로 넘기지 않고 횟수를 잇지 않는다', async () => {
    h.job = { ...h.job!, error: '[retry:copywriting:2] 이전 실패' }
    h.copyThrows = stop
    const after = await runPdpStep(h.job.id, h.job.user_id)
    expect(after.current_step).toBe('copywriting')
    expect(after.error).toContain(LOCAL_LLM_SOFT_STOP_MARKER)
    expect(after.error).not.toContain('[retry:')
  })

  it('그 밖의 오류는 지금처럼 실패로 센다(같은 조건이면 세 번째 실패로 failed)', async () => {
    h.job = { ...h.job!, error: '[retry:copywriting:2] 이전 실패' }
    h.copyThrows = new Error('네트워크 오류')
    const after = await runPdpStep(h.job.id, h.job.user_id)
    expect(after.current_step).toBe('failed')
    expect(after.error).toContain('네트워크 오류')
  })
})
