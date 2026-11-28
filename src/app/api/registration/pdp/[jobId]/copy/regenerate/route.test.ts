/**
 * /api/registration/pdp/[jobId]/copy/regenerate(pdp-copy-regen-api) — 오너 전용·잡 소유(user_id) 조회, GET은 쓰기 없는 사전 조회
 * (blocked), POST는 막히면 409 code(호출 없음), 통과하면 진행 잠금 → 1콜 → 가드 → 비용·기록 저장 뒤 후보를 돌려준다.
 * 잡 조회·잠금·저장과 모델 호출은 모의, 검사·흐름·가드는 실제 함수다(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import type { PdpJobRow } from '@/lib/registration/pdp-state'

const h = vi.hoisted(() => ({
  getPdpJob: vi.fn(),
  claim: vi.fn(),
  updateIfUnchanged: vi.fn(),
  budget: vi.fn(),
  model: vi.fn(),
}))

vi.mock('@/lib/auth/clerk', () => ({ requireOwner: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/agents/budget', () => ({ checkMonthlyBudget: (...a: unknown[]) => h.budget(...a) }))
vi.mock('@/lib/registration/pdp-jobs', async (orig) => ({
  ...(await orig<typeof import('@/lib/registration/pdp-jobs')>()),
  getPdpJob: (...a: unknown[]) => h.getPdpJob(...a),
  claimPdpJobRun: (...a: unknown[]) => h.claim(...a),
  updatePdpJobIfUnchanged: (...a: unknown[]) => h.updateIfUnchanged(...a),
}))
vi.mock('@/lib/agents/registration/pdp-copy-regen-agent', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/registration/pdp-copy-regen-agent')>()),
  callCopyRegenModel: (...a: unknown[]) => h.model(...a),
}))

import { GET, POST } from './route'
import { requireOwner } from '@/lib/auth/clerk'
import { fixtureToJob, loadEnrichmentFixture } from '@/lib/registration/__golden__/golden-harness'

const PAST = '2026-10-29T00:00:00.000Z'
const LEASE = '2999-01-01T00:00:00.000Z'
const CURRENT = '매일 쓰는 컵이라\n세척이 쉬워야 해요'

function job(over: Partial<PdpJobRow> = {}): PdpJobRow {
  return { ...fixtureToJob(loadEnrichmentFixture('A-track-i')), id: 'job-1', cost_usd: 1, updated_at: PAST, ...over }
}

const params = { params: Promise.resolve({ jobId: 'job-1' }) }
const url = 'http://localhost/api/registration/pdp/job-1/copy/regenerate'
const post = (body: unknown) =>
  POST(
    new NextRequest(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    params
  )
const get = (query: string) => GET(new NextRequest(`${url}?${query}`), params)
const BODY = { sectionType: 'hook_3step', elementName: 'headline', currentText: CURRENT, note: '더 짧게' }

beforeEach(() => {
  vi.mocked(requireOwner).mockReset().mockResolvedValue('user-1')
  h.getPdpJob.mockReset().mockResolvedValue(job())
  h.claim
    .mockReset()
    .mockImplementation(async (_db, _u, j: PdpJobRow) => ({ job: { ...j, updated_at: LEASE }, leaseUntil: LEASE }))
  h.updateIfUnchanged.mockReset().mockImplementation(async (_db, _u, j: PdpJobRow, patch) => ({ ...j, ...patch }))
  h.budget.mockReset().mockResolvedValue({ allowed: true, spentUsd: 1, budgetUsd: 50 })
  h.model
    .mockReset()
    .mockResolvedValue({ ok: true, candidates: ['입구가 넓어서\n솔이 바닥까지 닿아요'], costUsd: 0.008 })
})

describe('POST — 즉시 처리', () => {
  it('통과 후보를 돌려주고, 잠금을 쥔 행에 비용·기록을 저장한다(오너 user_id로만 조회·잠금·저장)', async () => {
    const res = await post(BODY)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      status: 'ok',
      candidates: ['입구가 넓어서\n솔이 바닥까지 닿아요'],
      rejected: [],
      costUsd: 0.008,
      recorded: true,
      estimate: { model: 'claude-sonnet-5-5', billed: true },
    })
    expect(h.getPdpJob).toHaveBeenCalledWith(expect.anything(), 'user-1', 'job-1')
    expect(h.claim).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      expect.objectContaining({ id: 'job-1', updated_at: PAST })
    )
    // 셋째 인자는 예산 풀 — 운영 잡이면 undefined(시험 잡은 'pdp-test')
    expect(h.budget).toHaveBeenCalledWith('registration/pdp-copy-regen', 'claude-sonnet-5-5', undefined)
    const [prompts, runContext] = h.model.mock.calls[0]
    expect(prompts.user).toContain(`<current_copy>\n${CURRENT}\n</current_copy>`)
    expect(prompts.user).toContain('<owner_note>\n더 짧게\n</owner_note>')
    expect(runContext).toEqual({ userId: 'user-1', stage: 'editor-copy-regen' })
    const [, userId, saved, patch] = h.updateIfUnchanged.mock.calls[0]
    expect(userId).toBe('user-1')
    expect(saved.updated_at).toBe(LEASE)
    expect(patch.costUsd).toBeCloseTo(1.008)
    expect(patch.sectionPlan.editor_copy_regen.at(-1)).toMatchObject({
      sectionType: 'hook_3step',
      status: 'ok',
      passed: 1,
    })
    // 카피·HTML·편집기 저장본은 건드리지 않는다
    expect(Object.keys(patch).sort()).toEqual(['costUsd', 'sectionPlan'])
  })

  it('완료 전 잡·잠금 중·예산 막힘은 409 code — 모델을 부르지 않고 쓰지 않는다', async () => {
    h.getPdpJob.mockResolvedValue(job({ final_html: null }))
    let res = await post(BODY)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'not_ready' })

    h.getPdpJob.mockResolvedValue(job({ current_step: 'images', updated_at: LEASE }))
    res = await post(BODY)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: '이미지 생성 중이라 잠시 뒤 다시 시도해 주세요.',
      code: 'busy',
      busy: true,
      busyKind: 'images',
    })

    h.getPdpJob.mockResolvedValue(job())
    h.budget.mockResolvedValue({ allowed: true, spentUsd: 49.99, budgetUsd: 50 })
    res = await post(BODY)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'budget' })

    expect(h.model).not.toHaveBeenCalled()
    expect(h.claim).not.toHaveBeenCalled()
    expect(h.updateIfUnchanged).not.toHaveBeenCalled()
  })

  it('읽은 뒤 다른 곳이 잠금을 쥐었으면(claim null) 409 busy — 모델을 부르지 않는다', async () => {
    h.claim.mockResolvedValue(null)
    const res = await post(BODY)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'busy', busy: true, busyKind: 'job' })
    expect(h.model).not.toHaveBeenCalled()
  })

  it('후보가 모두 탈락하면 200 rejected(이전 카피 유지), 모델 실패는 200 failed', async () => {
    h.model.mockResolvedValue({ ok: true, candidates: [CURRENT], costUsd: 0.005 })
    let body = await (await post(BODY)).json()
    expect(body).toMatchObject({ status: 'rejected', candidates: [], rejected: [{ reason: 'duplicate' }] })

    h.model.mockResolvedValue({ ok: false, error: '시간 초과', stage: 'timeout', costUsd: 0 })
    body = await (await post(BODY)).json()
    expect(body).toMatchObject({ status: 'failed', candidates: [] })
  })

  it('잘못된 본문은 400, 잡이 없으면(남의 잡 포함) 404, 오너가 아니면 requireOwner 응답 그대로', async () => {
    expect((await post({ sectionType: 'hero', currentText: CURRENT })).status).toBe(400)
    expect((await post({ sectionType: 'hook_3step', currentText: '' })).status).toBe(400)
    expect((await post({ ...BODY, prompt: 'x', currentText: '가'.repeat(301) })).status).toBe(400)
    h.getPdpJob.mockResolvedValue(null)
    expect((await post(BODY)).status).toBe(404)
    vi.mocked(requireOwner).mockRejectedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    expect((await post(BODY)).status).toBe(403)
    expect(h.model).not.toHaveBeenCalled()
  })
})

describe('GET — 사전 조회', () => {
  it('상한 추정을 주고 막히지 않았으면 blocked null — 쓰지 않는다', async () => {
    const res = await get('sectionType=hook_3step')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      sectionType: 'hook_3step',
      blocked: null,
      estimate: { model: 'claude-sonnet-5-5', billed: true },
    })
    expect(body.estimate.maxUsd).toBeGreaterThan(0.03)
    expect(h.claim).not.toHaveBeenCalled()
    expect(h.updateIfUnchanged).not.toHaveBeenCalled()
    expect(h.model).not.toHaveBeenCalled()
  })

  it('막힌 사유는 409가 아니라 blocked로 준다(이미지 생성 중·예산 포함)', async () => {
    h.getPdpJob.mockResolvedValue(job({ current_step: 'images', updated_at: LEASE }))
    expect((await (await get('sectionType=cta')).json()).blocked).toMatchObject({ code: 'busy', busyKind: 'images' })
    h.getPdpJob.mockResolvedValue(job())
    h.budget.mockResolvedValue({ allowed: false, spentUsd: 50, budgetUsd: 50 })
    expect((await (await get('sectionType=cta')).json()).blocked).toMatchObject({ code: 'budget' })
  })

  it('모르는 섹션은 400, 잡이 없으면 404', async () => {
    expect((await get('sectionType=hero')).status).toBe(400)
    expect((await get('')).status).toBe(400)
    h.getPdpJob.mockResolvedValue(null)
    expect((await get('sectionType=cta')).status).toBe(404)
  })
})
