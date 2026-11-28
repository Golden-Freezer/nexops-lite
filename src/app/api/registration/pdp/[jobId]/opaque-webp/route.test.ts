/**
 * POST /api/registration/pdp/[jobId]/opaque-webp(AX-CT-37) — 오너 잡일 때만 바꾸고, 저장 0, 크기·실패 응답 코드를 본다.
 * 변환 함수는 가짜로 둔다(실제 바이트 변환은 motion/opaque-webp.test.ts).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { getPdpJob } from '@/lib/registration/pdp-jobs'
import { opaqueAnimatedWebp } from '@/lib/registration/motion/opaque-webp'
import { POST } from './route'

vi.mock('@/lib/auth/clerk', () => ({ requireOwner: vi.fn().mockResolvedValue('user-1') }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/registration/pdp-jobs', () => ({ getPdpJob: vi.fn() }))
vi.mock('@/lib/registration/motion/opaque-webp', () => ({ opaqueAnimatedWebp: vi.fn(), OPAQUE_WEBP_MAX_BYTES: 64 }))

function call(body: Uint8Array, headers: Record<string, string> = {}, jobId = 'job-1') {
  return POST(
    new NextRequest(`http://localhost/api/registration/pdp/${jobId}/opaque-webp`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/webp', ...headers },
      body: new Blob([new Uint8Array(body)]),
    }),
    { params: Promise.resolve({ jobId }) }
  )
}

describe('POST /api/registration/pdp/[jobId]/opaque-webp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireOwner).mockResolvedValue('user-1')
    vi.mocked(getPdpJob).mockResolvedValue({ id: 'job-1' } as never)
    vi.mocked(opaqueAnimatedWebp).mockResolvedValue(Buffer.from('RIFF-out'))
  })

  it('바꾼 바이트를 image/webp·no-store 로 돌려준다(이 사용자 잡으로 조회)', async () => {
    const res = await call(new Uint8Array([1, 2, 3]))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('RIFF-out')
    expect(getPdpJob).toHaveBeenCalledWith(expect.anything(), 'user-1', 'job-1')
    expect(Buffer.from(vi.mocked(opaqueAnimatedWebp).mock.calls[0][0])).toEqual(Buffer.from([1, 2, 3]))
  })

  it('남의 잡(조회 안 됨)은 404 이고 바꾸지 않는다', async () => {
    vi.mocked(getPdpJob).mockResolvedValue(null)
    expect((await call(new Uint8Array([1]))).status).toBe(404)
    expect(opaqueAnimatedWebp).not.toHaveBeenCalled()
  })

  it('오너가 아니면 requireOwner 가 던진 응답 그대로', async () => {
    vi.mocked(requireOwner).mockRejectedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    expect((await call(new Uint8Array([1]))).status).toBe(403)
    expect(getPdpJob).not.toHaveBeenCalled()
  })

  it('빈 본문은 400, 상한을 넘으면 413(content-length 머리로도, 실제 길이로도)', async () => {
    expect((await call(new Uint8Array(0))).status).toBe(400)
    const big = await call(new Uint8Array(65))
    expect(big.status).toBe(413)
    expect((await big.json()).error).toContain('MB 를 넘습니다')
    expect((await call(new Uint8Array([1]), { 'content-length': '100' })).status).toBe(413)
    expect(opaqueAnimatedWebp).not.toHaveBeenCalled()
  })

  it('바꾸지 못하면 422 { error }(부르는 쪽이 원본을 넣고 알린다)', async () => {
    vi.mocked(opaqueAnimatedWebp).mockRejectedValue(new Error('움직이는 WebP 가 아닙니다(프레임 1장).'))
    const res = await call(new Uint8Array([1]))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('움직이는 WebP 가 아닙니다(프레임 1장).')
  })

  it('잡 조회가 터지면 500', async () => {
    vi.mocked(getPdpJob).mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call(new Uint8Array([1]))).status).toBe(500)
  })
})
