/**
 * GET /api/registration/history — 트랙 필터·커서를 서버 조회 조건으로 넘기고, 각 표를 limit+1개씩 읽는다.
 * 옛 화면은 트랙 필터를 화면에서만 걸어 표준 잡이 많으면 내재화 잡이 30건 밖으로 밀려 안 보였다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const listThumbnailJobs = vi.fn()
const listPdpJobs = vi.fn()

vi.mock('@/lib/auth/clerk', () => ({ requireOwner: vi.fn().mockResolvedValue('owner') }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/registration/jobs', () => ({ listThumbnailJobs: (...a: unknown[]) => listThumbnailJobs(...a) }))
vi.mock('@/lib/registration/pdp-jobs', () => ({ listPdpJobs: (...a: unknown[]) => listPdpJobs(...a) }))
vi.mock('@/lib/sourcing/registration/businesses', () => ({
  listOwnedBusinesses: vi.fn().mockResolvedValue([{ id: 'biz-a', name: '페어넥스', coupangVendorId: null, isDefault: true }]),
}))

beforeEach(() => {
  listThumbnailJobs.mockReset().mockResolvedValue([])
  listPdpJobs.mockReset().mockResolvedValue([])
})

async function get(qs: string) {
  const { GET } = await import('./route')
  return GET(new NextRequest(`http://localhost/api/registration/history${qs}`))
}

describe('GET /api/registration/history', () => {
  it('기본: 두 표를 user 기준 limit+1개씩, 커서 없이 읽는다', async () => {
    const res = await get('?limit=10')
    expect(res.status).toBe(200)
    expect(listThumbnailJobs).toHaveBeenCalledWith(expect.anything(), 'owner', 11, null)
    expect(listPdpJobs).toHaveBeenCalledWith(expect.anything(), 'owner', 11, { before: null, track: null })
    const json = await res.json()
    expect(json.data.businesses).toEqual([{ id: 'biz-a', name: '페어넥스' }])
  })

  it('트랙을 고르면 대표이미지 잡은 읽지 않고 상세페이지 잡만 그 트랙으로', async () => {
    await get('?track=internalized&before=2026-10-28T09:00:00Z')
    expect(listThumbnailJobs).not.toHaveBeenCalled()
    expect(listPdpJobs).toHaveBeenCalledWith(expect.anything(), 'owner', 21, {
      before: '2026-10-28T09:00:00Z',
      track: 'internalized',
    })
  })

  it('알 수 없는 트랙·커서는 무시한다', async () => {
    await get('?track=bogus&before=garbage')
    expect(listThumbnailJobs).toHaveBeenCalledWith(expect.anything(), 'owner', 21, null)
    expect(listPdpJobs).toHaveBeenCalledWith(expect.anything(), 'owner', 21, { before: null, track: null })
  })
})
