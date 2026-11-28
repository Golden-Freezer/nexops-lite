/**
 * /api/registration/pdp/[jobId]/images/regenerate(pdp-image-regen-api) — 오너 전용·잡 소유(user_id) 조회, GET은 쓰기 없는
 * 사전 조회(blocked), POST는 막히면 409 code, 통과하면 재생성 대기 표시 + images로 되돌림(읽은 뒤 바뀌지 않았을 때만).
 * 요청 검사(planEditorRegen)는 모의로 갈래를 고르고, 예산 판정(regenBudgetBlock)은 실제 함수를 쓴다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import type { PdpJobRow } from '@/lib/registration/pdp-state'
import type { RegenPlan } from '@/lib/registration/pdp-image-regen-request'

const h = vi.hoisted(() => ({
  getPdpJob: vi.fn(),
  updateIfUnchanged: vi.fn(),
  plan: vi.fn(),
  budget: vi.fn(),
}))

vi.mock('@/lib/auth/clerk', () => ({ requireOwner: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/agents/budget', () => ({ checkMonthlyBudget: (...a: unknown[]) => h.budget(...a) }))
vi.mock('@/lib/registration/pdp-jobs', () => ({
  getPdpJob: (...a: unknown[]) => h.getPdpJob(...a),
  updatePdpJobIfUnchanged: (...a: unknown[]) => h.updateIfUnchanged(...a),
}))
vi.mock('@/lib/registration/pdp-image-regen-request', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/registration/pdp-image-regen-request')>()),
  planEditorRegen: (...a: unknown[]) => h.plan(...a),
}))

import { GET, POST } from './route'
import { requireOwner } from '@/lib/auth/clerk'

const JOB = {
  id: 'job-1',
  user_id: 'user-1',
  updated_at: '2026-10-29T00:00:00.000Z',
  section_images: [
    { section: 'hero', url: 'https://cdn.test/hero.png' },
    { section: 'usage', url: 'https://cdn.test/usage.png' },
  ],
} as unknown as PdpJobRow
const ESTIMATE = { model: 'gpt-image-2', quality: 'medium', billed: true, imageUsd: 0.05, maxImageUsd: 0.1 }
const okPlan = (block: Extract<RegenPlan, { ok: true }>['block'] = null): RegenPlan => ({
  ok: true,
  task: { section: 'hero', prompt: 'P', aspectRatio: '3:4', effectOnly: false, skipGate: false },
  estimate: ESTIMATE as never,
  runner: 'web',
  block,
})
const params = { params: Promise.resolve({ jobId: 'job-1' }) }
const url = 'http://localhost/api/registration/pdp/job-1/images/regenerate'
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

beforeEach(() => {
  vi.mocked(requireOwner).mockReset().mockResolvedValue('user-1')
  h.getPdpJob.mockReset().mockResolvedValue(JOB)
  h.updateIfUnchanged
    .mockReset()
    .mockImplementation(async (_db, _u, _job, patch) => ({ ...JOB, ...patch, current_step: 'images' }))
  h.plan.mockReset().mockReturnValue(okPlan())
  h.budget.mockReset().mockResolvedValue({ allowed: true, spentUsd: 1, budgetUsd: 50 })
})

describe('POST — 재생성 요청', () => {
  it('통과하면 그 섹션에 대기를 적고 images로 되돌린 뒤 잡·실행기·추정을 돌려준다', async () => {
    const res = await post({ section: 'hero', style: 'lifestyle', note: '더 밝게' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ section: 'hero', runner: 'web', estimate: ESTIMATE, job: { id: 'job-1' } })

    expect(h.getPdpJob).toHaveBeenCalledWith({}, 'user-1', 'job-1')
    expect(h.plan).toHaveBeenCalledWith(JOB, { section: 'hero', style: 'lifestyle', note: '더 밝게' })
    const [, user, job, patch] = h.updateIfUnchanged.mock.calls[0]
    expect(user).toBe('user-1')
    expect(job).toBe(JOB)
    expect(patch).toMatchObject({ currentStep: 'images', progress: 75 })
    expect(patch.sectionImages[0]).toMatchObject({
      section: 'hero',
      url: 'https://cdn.test/hero.png',
      pendingRegen: true,
      editorRegen: { style: 'lifestyle', note: '더 밝게', status: 'pending' },
    })
    expect(patch.sectionImages[1]).toStrictEqual(JOB.section_images[1])
    // final_html·편집기 저장본은 패치에 없다
    expect(Object.keys(patch).sort()).toStrictEqual(['currentStep', 'progress', 'sectionImages'])
  })

  it('막히면 409 code — busy는 busy: true도 준다. 쓰지 않는다', async () => {
    for (const code of ['busy', 'already_pending', 'not_ready', 'other_work'] as const) {
      h.plan.mockReturnValueOnce(okPlan({ code, error: `막힘 ${code}` }))
      const res = await post({ section: 'hero' })
      expect(res.status).toBe(409)
      expect(await res.json()).toStrictEqual({
        error: `막힘 ${code}`,
        code,
        ...(code === 'busy' ? { busy: true } : {}),
      })
    }
    expect(h.updateIfUnchanged).not.toHaveBeenCalled()
    expect(h.budget).not.toHaveBeenCalled()
  })

  it('월 예산 남은 한도가 최대 비용보다 작으면 409 budget', async () => {
    h.budget.mockResolvedValue({ allowed: true, spentUsd: 49.95, budgetUsd: 50 })
    const res = await post({ section: 'hero' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'budget' })
    // 둘째·셋째 인자는 모델(없음)·예산 풀 — 운영 잡이면 undefined(시험 잡은 'pdp-test')
    expect(h.budget).toHaveBeenCalledWith('registration/pdp-image', undefined, undefined)
    expect(h.updateIfUnchanged).not.toHaveBeenCalled()
  })

  it('단계 실패로 멈춘 잡을 다시 요청하면 옛 실패 문구를 비운다', async () => {
    h.getPdpJob.mockResolvedValue({ ...JOB, current_step: 'failed', error: '[images] 실패' })
    const res = await post({ section: 'hero' })
    expect(res.status).toBe(200)
    expect(h.updateIfUnchanged.mock.calls[0][3]).toMatchObject({ currentStep: 'images', error: null })
  })

  it('읽은 뒤 run이 쥐었으면(조건부 갱신 0행) 409 busy', async () => {
    h.updateIfUnchanged.mockResolvedValue(null)
    const res = await post({ section: 'hero' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'busy', busy: true })
  })

  it('잘못된 본문은 400, 잡이 없으면(남의 잡 포함) 404, 검사 400은 그대로', async () => {
    expect((await post({ section: 'hero', style: 'scene' })).status).toBe(400)
    expect((await post(null)).status).toBe(400)
    h.getPdpJob.mockResolvedValueOnce(null)
    expect((await post({ section: 'hero' })).status).toBe(404)
    h.plan.mockReturnValueOnce({ ok: false, status: 400, error: '이 잡에 없는 이미지 섹션입니다: x' })
    const res = await post({ section: 'x' })
    expect(res.status).toBe(400)
    expect(h.updateIfUnchanged).not.toHaveBeenCalled()
  })

  it('오너가 아니면 requireOwner의 응답을 그대로 돌려준다', async () => {
    vi.mocked(requireOwner).mockRejectedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    expect((await post({ section: 'hero' })).status).toBe(403)
    expect(h.getPdpJob).not.toHaveBeenCalled()
  })
})

describe('GET — 사전 조회(쓰기 없음)', () => {
  it('비용 추정·실행기를 주고 막히지 않았으면 blocked null', async () => {
    const res = await get('section=hero&style=macro')
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({ section: 'hero', runner: 'web', estimate: ESTIMATE, blocked: null, revertible: false })
    expect(h.plan).toHaveBeenCalledWith(JOB, { section: 'hero', style: 'macro' })
    expect(h.updateIfUnchanged).not.toHaveBeenCalled()
  })

  it('바뀐 컷(done + previousUrl)이면 revertible true — 창이 직전 컷으로 되돌리기를 보인다(P1-4)', async () => {
    const done = {
      ...JOB,
      section_images: [
        { section: 'hero', url: 'https://cdn.test/hero-new.png', editorRegen: { requestedAt: 'x', status: 'done', previousUrl: 'https://cdn.test/hero.png' } },
      ],
    }
    h.getPdpJob.mockResolvedValueOnce(done)
    expect(await (await get('section=hero')).json()).toMatchObject({ revertible: true })
  })

  it('막힌 사유는 409가 아니라 blocked로 준다(예산 포함)', async () => {
    h.plan.mockReturnValueOnce(okPlan({ code: 'busy', error: '진행 중' }))
    expect(await (await get('section=hero')).json()).toMatchObject({ blocked: { code: 'busy', error: '진행 중' } })
    h.budget.mockResolvedValue({ allowed: false, spentUsd: 50, budgetUsd: 50 })
    const res = await get('section=hero')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ blocked: { code: 'budget' } })
    expect(h.updateIfUnchanged).not.toHaveBeenCalled()
  })

  it('section이 없거나 모르는 style이면 400', async () => {
    expect((await get('')).status).toBe(400)
    expect((await get('section=hero&style=comparison')).status).toBe(400)
  })
})
