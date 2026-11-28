/**
 * 첫 칸 글 굽기 라우트 — 사용자 잡 격리(getPdpJob이 user_id로 읽는다), 잡에 없는 WebP URL 막기, 본문 상한, 칸 예산(대표 칸 heroMaxBytes·그 밖 maxBytes, 지금 둘 다 0.7MB), 응답 꼴.
 * 굽기(text-bake)와 WebP 받기는 가짜다.
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/clerk', () => ({ requireOwner: vi.fn().mockResolvedValue('user-1') }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/registration/pdp-jobs', () => ({ getPdpJob: vi.fn() }))
vi.mock('@/lib/registration/motion/text-bake', () => ({ bakeTextOnMotion: vi.fn(), MOTION_BAKE_BODY_MAX: 1536 * 1024 }))

const { getPdpJob } = await import('@/lib/registration/pdp-jobs')
const { bakeTextOnMotion, MOTION_BAKE_BODY_MAX } = await import('@/lib/registration/motion/text-bake')
const { POST } = await import('./route')
const { MOTION_ENCODE } = await import('@/lib/registration/motion/encode')

const HERO_WEBP = 'https://cdn.example.com/hero_motion-motion.webp'
const BAND_WEBP = 'https://cdn.example.com/k5_a-motion.webp'
const ok = { status: 'ok' as const, path: 'gpt26-ref', width: 780, height: 1040, frames: 9, durationMs: 1800, bytes: 1, quality: 80, loop: 'pingpong' }
const job = {
  id: 'job-1',
  section_images: [
    { section: 'hero', url: 'https://cdn.example.com/hero.jpg' },
    { section: 'hero_motion', url: 'https://cdn.example.com/hero.jpg', motion: { ...ok, webpUrl: HERO_WEBP } },
    { section: 'k5_a', url: 'https://cdn.example.com/k5.jpg', motion: { ...ok, webpUrl: BAND_WEBP } },
    { section: 'k6_a', url: 'https://cdn.example.com/k6.jpg', motion: { ...ok, status: 'poster', webpUrl: 'https://cdn.example.com/poster-only.webp' } },
  ],
}
const b64 = Buffer.from('png').toString('base64')
const call = (body: unknown, raw?: string) =>
  POST(new NextRequest('http://localhost/api/registration/pdp/job-1/motion-bake', { method: 'POST', body: raw ?? JSON.stringify(body) }), {
    params: Promise.resolve({ jobId: 'job-1' }),
  })

beforeEach(() => {
  vi.mocked(getPdpJob).mockReset().mockResolvedValue(job as never)
  vi.mocked(bakeTextOnMotion).mockReset().mockResolvedValue({ status: 'ok', webp: Buffer.from('RIFF....WEBP'), quality: 80, bytes: 12, frames: 9, distance: 3, steps: ['q80 9f 0KB'] })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))))
})

describe('POST motion-bake', () => {
  it('다른 사용자의 잡(못 찾음)은 404 — getPdpJob은 요청한 사용자로 읽는다', async () => {
    vi.mocked(getPdpJob).mockResolvedValue(null)
    const res = await call({ webpUrl: HERO_WEBP, overlay: b64, still: b64 })
    expect(res.status).toBe(404)
    expect(vi.mocked(getPdpJob).mock.calls[0][1]).toBe('user-1')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('잡의 움직이는 칸(status ok)이 아닌 URL은 400이고 받지 않는다 — 임의 URL·포스터로 내린 칸 모두', async () => {
    for (const webpUrl of ['https://evil.example.com/x.webp', 'https://cdn.example.com/poster-only.webp']) {
      const res = await call({ webpUrl, overlay: b64, still: b64 })
      expect(res.status, webpUrl).toBe(400)
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('입력이 비거나 base64가 아니면 400, 본문 상한을 넘으면 413', async () => {
    expect((await call({ webpUrl: HERO_WEBP, overlay: '', still: b64 })).status).toBe(400)
    expect((await call({ webpUrl: HERO_WEBP, overlay: '***', still: b64 })).status).toBe(400)
    expect((await call(null, 'not json')).status).toBe(400)
    expect((await call(null, 'x'.repeat(MOTION_BAKE_BODY_MAX + 1))).status).toBe(413)
  })

  it('대표 칸은 heroMaxBytes, 그 밖 칸은 maxBytes 예산(지금 둘 다 0.7MB — 결정 카드 c13)으로 굽고 image/webp를 돌려준다(저장하지 않는다)', async () => {
    const res = await call({ webpUrl: HERO_WEBP, overlay: b64, still: b64 })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('RIFF....WEBP')
    expect(vi.mocked(bakeTextOnMotion).mock.calls[0][0]).toMatchObject({ maxBytes: MOTION_ENCODE.heroMaxBytes, overlay: Buffer.from('png'), still: Buffer.from('png') })
    expect(MOTION_ENCODE.heroMaxBytes).toBe(700 * 1024)
    await call({ webpUrl: BAND_WEBP, overlay: b64, still: b64 })
    expect(vi.mocked(bakeTextOnMotion).mock.calls[1][0].maxBytes).toBe(MOTION_ENCODE.maxBytes)
    expect(fetch).toHaveBeenCalledWith(HERO_WEBP, expect.anything())
  })

  it('계획 기록에서 사용 동작(use)으로 고른 칸만 useMaxBytes(1.5MB, J55)로 굽는다 — 다른 종류·대표 칸은 0.7MB 그대로', async () => {
    const planned = (kind: string) => ({
      ...job,
      analysis: { enrichment: { version: 1, features: ['templatelib', 'motionband'] } },
      section_plan: { templatelib: { motion: { engine: 'gif-sheet', hero: true, cells: [{ key: 'k5_a', kind, reason: '까닭' }], candidates: 1, max: 1, rejected: 0 } } },
    })
    vi.mocked(getPdpJob).mockResolvedValue(planned('use') as never)
    await call({ webpUrl: BAND_WEBP, overlay: b64, still: b64 })
    expect(vi.mocked(bakeTextOnMotion).mock.calls[0][0].maxBytes).toBe(MOTION_ENCODE.useMaxBytes)
    expect(MOTION_ENCODE.useMaxBytes).toBe(1500 * 1024)
    await call({ webpUrl: HERO_WEBP, overlay: b64, still: b64 })
    expect(vi.mocked(bakeTextOnMotion).mock.calls[1][0].maxBytes).toBe(MOTION_ENCODE.heroMaxBytes)
    vi.mocked(getPdpJob).mockResolvedValue(planned('assemble') as never)
    await call({ webpUrl: BAND_WEBP, overlay: b64, still: b64 })
    expect(vi.mocked(bakeTextOnMotion).mock.calls[2][0].maxBytes).toBe(MOTION_ENCODE.maxBytes)
  })

  it('못 구우면 200 { skip: 까닭 } — 부르는 쪽이 포스터를 둔다', async () => {
    vi.mocked(bakeTextOnMotion).mockResolvedValue({ status: 'skip', reason: '첫 프레임이 정지 칸과 다름(구도 거리 30 > 18)', steps: [] })
    const res = await call({ webpUrl: HERO_WEBP, overlay: b64, still: b64 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skip: '첫 프레임이 정지 칸과 다름(구도 거리 30 > 18)', steps: [] })
  })

  it('WebP 받기가 실패하면 500(까닭 글)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 404 })))
    const res = await call({ webpUrl: HERO_WEBP, overlay: b64, still: b64 })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('움직이는 WebP 받기 HTTP 404')
  })
})
