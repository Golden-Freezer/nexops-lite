import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  assertLocalCodex: vi.fn(),
  requireOwner: vi.fn(),
  createAdminClient: vi.fn(),
  regenerateMissingPdpImages: vi.fn(),
}))

vi.mock('@/lib/local-codex/guard', () => ({ assertLocalCodex: mocks.assertLocalCodex }))
vi.mock('@/lib/auth/clerk', () => ({ requireOwner: mocks.requireOwner }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/registration/pdp-image-retry', () => ({
  regenerateMissingPdpImages: mocks.regenerateMissingPdpImages,
}))

import { POST } from './route'

describe('POST /api/registration/pdp/[jobId]/regenerate-missing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.requireOwner.mockResolvedValue('user-1')
    mocks.createAdminClient.mockReturnValue({ fake: 'db' })
    mocks.regenerateMissingPdpImages.mockResolvedValue({ id: 'job-1', current_step: 'images' })
  })

  afterEach(() => vi.restoreAllMocks())

  it('가짜 DB로 URL 없는 섹션 재생성 서비스를 호출하고 실제 Codex는 호출하지 않는다', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/registration/pdp/job-1/regenerate-missing', { method: 'POST' }),
      { params: Promise.resolve({ jobId: 'job-1' }) },
    )

    expect(response.status).toBe(200)
    expect(mocks.regenerateMissingPdpImages).toHaveBeenCalledWith({ fake: 'db' }, 'user-1', 'job-1')
  })

  it('Vercel 가드가 막으면 DB나 생성 서비스를 건드리지 않는다', async () => {
    mocks.assertLocalCodex.mockImplementation(() => { throw new Error('로컬 전용') })
    const response = await POST(
      new NextRequest('https://example.com/api/registration/pdp/job-1/regenerate-missing', { method: 'POST' }),
      { params: Promise.resolve({ jobId: 'job-1' }) },
    )

    expect(response.status).toBe(500)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
    expect(mocks.regenerateMissingPdpImages).not.toHaveBeenCalled()
  })
})
