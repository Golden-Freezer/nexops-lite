/**
 * GET /api/registration/pdp/[jobId]/editor — 한 번 완료된 잡(final_html)은 편집기 재생성으로 images 단계에 돌아가 있어도 연다
 * (pdp-image-regen-api). 완료 전 잡은 지금처럼 409.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ getPdpJob: vi.fn() }))

vi.mock('@/lib/auth/clerk', () => ({ requireOwner: vi.fn(async () => 'user-1') }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/registration/pdp-jobs', () => ({ getPdpJob: (...a: unknown[]) => h.getPdpJob(...a) }))
vi.mock('@/lib/registration/editor-data', () => ({
  getEditorData: vi.fn(async () => null),
  assembleEditorDataResponse: vi.fn(() => ({ ok: true })),
  upsertEditorData: vi.fn(),
}))

import { GET } from './route'

const open = () =>
  GET(new NextRequest('http://localhost/api/registration/pdp/job-1/editor'), {
    params: Promise.resolve({ jobId: 'job-1' }),
  })
const job = (current_step: string, final_html: string | null, final: unknown = { mainIntro: {} }) => ({
  id: 'job-1',
  current_step,
  final_html,
  copy_sections: { final },
})

beforeEach(() => h.getPdpJob.mockReset())

describe('편집기 GET — 열 수 있는 잡', () => {
  it('done 잡은 연다', async () => {
    h.getPdpJob.mockResolvedValue(job('done', '<html></html>'))
    expect((await open()).status).toBe(200)
  })

  it('재생성으로 images·compose에 돌아간 완료 잡(final_html 있음)도 연다', async () => {
    for (const step of ['images', 'compose', 'failed']) {
      h.getPdpJob.mockResolvedValue(job(step, '<html></html>'))
      expect((await open()).status).toBe(200)
    }
  })

  it('완료 전 잡(final_html 없음)·카피 없는 잡은 409', async () => {
    h.getPdpJob.mockResolvedValue(job('images', null))
    expect((await open()).status).toBe(409)
    h.getPdpJob.mockResolvedValue(job('done', '<html></html>', null))
    expect((await open()).status).toBe(409)
  })
})
