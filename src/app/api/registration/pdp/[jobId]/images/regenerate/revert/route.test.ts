/**
 * POST /api/registration/pdp/[jobId]/images/regenerate/revert(P1-4) — 오너 전용·잡 소유(user_id) 조회, 진행 잠금·대기면 409,
 * 되돌릴 컷이 없으면 409 not_revertible, 통과하면 그 섹션만 url·장식을 맞바꿔 쓴다(단계는 그대로, 생성·예산 없음).
 * 막힘 판정(planEditorRegen)은 모의로 갈래를 고르고, 맞바꾸기(revertEditorRegen)는 실제 함수다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PdpJobRow } from '@/lib/registration/pdp-state'
import type { RegenPlan } from '@/lib/registration/pdp-image-regen-request'

const h = vi.hoisted(() => ({ getPdpJob: vi.fn(), updateIfUnchanged: vi.fn(), plan: vi.fn() }))

vi.mock('@/lib/auth/clerk', () => ({ requireOwner: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/registration/pdp-jobs', () => ({
  getPdpJob: (...a: unknown[]) => h.getPdpJob(...a),
  updatePdpJobIfUnchanged: (...a: unknown[]) => h.updateIfUnchanged(...a),
}))
vi.mock('@/lib/registration/pdp-image-regen-request', () => ({ planEditorRegen: (...a: unknown[]) => h.plan(...a) }))

import { POST } from './route'
import { requireOwner } from '@/lib/auth/clerk'

const OLD = 'https://cdn.test/hero-old.png'
const NEW = 'https://cdn.test/hero-new.png'
const JOB = {
  id: 'job-1',
  user_id: 'user-1',
  updated_at: '2026-10-29T00:00:00.000Z',
  current_step: 'done',
  section_images: [
    {
      section: 'hero',
      url: NEW,
      annotationStatus: 'done',
      editorRegen: { requestedAt: '2026-10-29T00:00:00.000Z', status: 'done', previousUrl: OLD, previous: { annotationStatus: 'skipped' } },
    },
    { section: 'usage', url: 'https://cdn.test/usage.png' },
  ],
} as unknown as PdpJobRow
const plan = (block: Extract<RegenPlan, { ok: true }>['block'] = null) => ({ ok: true, block })
const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/registration/pdp/job-1/images/regenerate/revert', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ jobId: 'job-1' }) }
  )

beforeEach(() => {
  vi.mocked(requireOwner).mockReset().mockResolvedValue('user-1')
  h.getPdpJob.mockReset().mockResolvedValue(JOB)
  h.updateIfUnchanged.mockReset().mockImplementation(async (_db, _u, _job, patch) => ({ ...JOB, ...patch }))
  h.plan.mockReset().mockReturnValue(plan())
})

describe('POST …/images/regenerate/revert', () => {
  it('그 섹션만 맞바꿔 쓰고 단계는 그대로(소유 조회는 user_id)', async () => {
    const res = await post({ section: 'hero' })
    expect(res.status).toBe(200)
    expect(h.getPdpJob).toHaveBeenCalledWith({}, 'user-1', 'job-1')
    const patch = h.updateIfUnchanged.mock.calls[0][3]
    expect(Object.keys(patch)).toEqual(['sectionImages'])
    const [hero, usage] = patch.sectionImages
    expect(hero).toMatchObject({ url: OLD, annotationStatus: 'skipped', editorRegen: { previousUrl: NEW } })
    expect(usage).toBe(JOB.section_images[1])
    expect((await res.json()).section).toBe('hero')
  })

  it('진행 잠금·재생성 대기면 409(쓰기 없음), 다른 이미지 일·예산 사유는 막지 않는다', async () => {
    h.plan.mockReturnValueOnce(plan({ code: 'busy', error: '진행 중' }))
    expect((await post({ section: 'hero' })).status).toBe(409)
    h.plan.mockReturnValueOnce(plan({ code: 'already_pending', error: '대기' }))
    const pending = await post({ section: 'hero' })
    expect(await pending.json()).toMatchObject({ code: 'already_pending' })
    expect(h.updateIfUnchanged).not.toHaveBeenCalled()
    h.plan.mockReturnValueOnce(plan({ code: 'other_work', error: '다른 일' }))
    expect((await post({ section: 'hero' })).status).toBe(200)
  })

  it('되돌릴 컷이 없으면 409 not_revertible, 본문이 틀리면 400, 잡이 없으면 404', async () => {
    const none = await post({ section: 'usage' })
    expect(none.status).toBe(409)
    expect(await none.json()).toMatchObject({ code: 'not_revertible' })
    expect((await post({})).status).toBe(400)
    h.getPdpJob.mockResolvedValueOnce(null)
    expect((await post({ section: 'hero' })).status).toBe(404)
  })

  it('읽은 뒤 바뀌었으면(조건부 쓰기 실패) 409 busy', async () => {
    h.updateIfUnchanged.mockResolvedValueOnce(null)
    const res = await post({ section: 'hero' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'busy' })
  })
})
