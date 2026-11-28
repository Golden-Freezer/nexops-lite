/**
 * GIF 칸 예산 사다리의 이음(motion/stage.ts) — encodeBandLadder만 가짜로 바꿔 고른 후보가 기록·경고로 이어지는지 본다(유료·네트워크 0).
 * 실제 사다리 인코딩(q80 차례 → 마지막 q70 → 포스터)은 motion.test.ts가 sharp로 본다.
 */

import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pdpImageExtOf, uploadPdpImage } from '../storage'
import type { FrameSet } from './assemble'
import { encodeBandLadder } from './encode'
import { buildMotionCell, motionOrStill, type MotionDeps } from './stage'
import type { MotionTask } from './task'

vi.mock('./encode', async (importOriginal) => {
  const real = await importOriginal<typeof import('./encode')>()
  return { ...real, encodeBandLadder: vi.fn(real.encodeBandLadder) }
})

const W = 64
function barFrame(i: number): Buffer {
  const f = Buffer.alloc(W * W * 3, 255)
  for (let y = 0; y < W; y++) for (let x = i * 2; x < Math.min(W, i * 2 + 8); x++) f.fill(0, (y * W + x) * 3, (y * W + x) * 3 + 3)
  return f
}
const bars: FrameSet = { frames: [...Array(9).keys()].map(barFrame), delays: Array(9).fill(200), width: W, height: W }
async function gifB64(): Promise<string> {
  const pngs = await Promise.all(bars.frames.map((f) => sharp(f, { raw: { width: W, height: W, channels: 3 } }).png().toBuffer()))
  return (await sharp(pngs, { join: { animated: true } }).gif({ delay: bars.delays, loop: 0 }).toBuffer()).toString('base64')
}

const task: MotionTask = { action: '빗질하는 모습', mode: 'gif', loop: 'back_and_forth', optionPhotos: [] }
function depsOf(): MotionDeps {
  return {
    generateGif: vi.fn(async () => ({ base64: await gifB64(), costUsd: 0.14 })),
    fetchPhoto: vi.fn(async () => null),
    judgeSheet: vi.fn(async () => ({ pass: true, reason: '' })),
    upload: vi.fn(async (kind) => `https://cdn.example.com/${kind}`),
    elapsedMs: () => 10_000,
    budgetMs: 280_000,
  }
}
const WEBP = Buffer.from('RIFF\0\0\0\0WEBPVP8X')
const POSTER = Buffer.from([0xff, 0xd8, 0xff])

describe('buildMotionCell — 칸 예산 사다리 이음', () => {
  it('왕복이 넘어 머무름(9프레임)을 고르면 기록은 머무름 꼴이고, 까닭이 남아 이미지 단계 경고로 보인다', async () => {
    vi.mocked(encodeBandLadder).mockImplementationOnce(async (tries) => {
      expect(tries.map((t) => t.frames.length)).toEqual([16, 9, 5])
      return { status: 'ok', webp: WEBP, poster: POSTER, quality: 80, frames: 9, bytes: 512_000, steps: ['q80 16f 812KB', 'q80 9f 500KB'], pick: 1 }
    })
    const out = await buildMotionCell(task, 'BASE', depsOf())
    expect(out.cell?.motion).toMatchObject({ path: 'gpt26-ref', status: 'ok', loop: 'hold', frames: 9, durationMs: 8 * 200 + 1000, quality: 80 })
    expect(out.reasons).toEqual(['칸 예산으로 왕복 16프레임 대신 머무름 9프레임(q80 16f 812KB → q80 9f 500KB)'])
    const warn = vi.fn()
    vi.mocked(encodeBandLadder).mockImplementationOnce(async () => ({
      status: 'ok', webp: WEBP, poster: POSTER, quality: 70, frames: 5, bytes: 690_000, steps: ['q80 16f 1200KB', 'q80 9f 900KB', 'q80 5f 760KB', 'q70 5f 674KB'], pick: 2,
    }))
    await motionOrStill(task, false, (m) => buildMotionCell(m, 'BASE', depsOf()), (c) => c.motion, async () => ({ entry: null as never, costUsd: 0 }), warn)
    expect(warn).toHaveBeenCalledWith('GIF 칸을 참조 GIF로 — 칸 예산으로 왕복 16프레임 대신 머무름 5프레임(q80 16f 1200KB → q80 9f 900KB → q80 5f 760KB → q70 5f 674KB)')
  })

  it('첫 후보가 q80으로 맞으면 까닭이 없고 지금과 같은 꼴(왕복)이다', async () => {
    vi.mocked(encodeBandLadder).mockImplementationOnce(async () => ({ status: 'ok', webp: WEBP, poster: POSTER, quality: 80, frames: 16, bytes: 400_000, steps: ['q80 16f 400KB'], pick: 0 }))
    const out = await buildMotionCell(task, 'BASE', depsOf())
    expect(out.cell?.motion).toMatchObject({ status: 'ok', loop: 'pingpong', frames: 16, durationMs: 16 * 200 })
    expect(out.reasons).toEqual([])
  })

  it('사다리를 다 내려가도 넘으면 지금처럼 포스터(GIF 첫 프레임)로, 까닭에 사다리 단계가 모두 남는다', async () => {
    vi.mocked(encodeBandLadder).mockImplementationOnce(async () => ({
      status: 'poster', webp: null, poster: POSTER, quality: null, frames: 1, bytes: 3, steps: ['q80 16f 1500KB', 'q80 9f 1100KB', 'q80 5f 900KB', 'q70 5f 820KB', 'poster'], pick: null,
    }))
    const warn = vi.fn()
    const motion = await motionOrStill(task, false, (m) => buildMotionCell(m, 'BASE', depsOf()), (c) => c.motion, async () => ({ entry: null as never, costUsd: 0 }), warn)
    expect(motion.entry).toMatchObject({ path: 'gpt26-ref', status: 'poster', frames: 1 })
    expect(warn).toHaveBeenCalledWith('GIF 칸을 포스터 한 장으로(GIF 첫 프레임) — GIF 칸 예산 초과(q80 16f 1500KB → q80 9f 1100KB → q80 5f 900KB → q70 5f 820KB → poster)')
  })
})

describe('GIF 칸 올리기(세션 B ③ — 포스터 칸이 된 다른 길)', () => {
  const failOn = (bad: 'gif' | 'motion') =>
    vi.fn(async (kind: 'motion' | 'poster' | 'gif') => {
      if (kind === bad) throw new Error(`PDP 이미지 업로드 실패(k17_clip_0-${kind}): mime type image/${bad === 'gif' ? 'gif' : 'webp'} is not supported`)
      return `https://cdn.example.com/${kind}`
    })

  it('원본 GIF(기록용)를 못 올려도 움직이는 WebP 칸은 그대로 — gifUrl만 빠지고 까닭이 경고로 보인다', async () => {
    const warn = vi.fn()
    const deps = { ...depsOf(), upload: failOn('gif') }
    const out = await motionOrStill(task, false, (m) => buildMotionCell(m, 'BASE', deps), (c) => c.motion, async () => ({ entry: null as never, costUsd: 0 }), warn)
    expect(out.entry).toMatchObject({ path: 'gpt26-ref', status: 'ok', webpUrl: 'https://cdn.example.com/motion' })
    expect(out.entry.gifUrl).toBeUndefined()
    expect(out.costUsd).toBe(0.14)
    expect(warn).toHaveBeenCalledWith(
      'GIF 칸을 참조 GIF로 — 원본 GIF 올리기 실패(움직이는 WebP는 그대로): PDP 이미지 업로드 실패(k17_clip_0-gif): mime type image/gif is not supported',
    )
  })

  it('움직이는 WebP를 못 올리면 지금처럼 포스터 칸으로 내려가고, 그 까닭이 경고로 보인다', async () => {
    const warn = vi.fn()
    const deps = { ...depsOf(), upload: failOn('motion') }
    const out = await motionOrStill(task, false, (m) => buildMotionCell(m, 'BASE', deps), (c) => c.motion, async () => ({ entry: null as never, costUsd: 0 }), warn)
    expect(out.entry).toMatchObject({ path: 'gpt26-ref', status: 'poster' })
    expect(warn).toHaveBeenCalledWith(
      'GIF 칸을 포스터 한 장으로(GIF 첫 프레임) — GIF 실패: PDP 이미지 업로드 실패(k17_clip_0-motion): mime type image/webp is not supported',
    )
  })

  it('파일 확장자는 mime대로 — GIF는 gif(전에는 png로 붙었다), 나머지는 지금 그대로', async () => {
    expect(['image/jpeg', 'image/webp', 'image/gif', 'image/png', 'application/octet-stream'].map(pdpImageExtOf)).toEqual(['jpg', 'webp', 'gif', 'png', 'png'])
    const paths: Array<{ path: string; contentType: string }> = []
    const db = {
      storage: {
        from: () => ({
          upload: async (path: string, _b: Buffer, o: { contentType: string }) => (paths.push({ path, contentType: o.contentType }), { error: null }),
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example.com/${path}` } }),
        }),
      },
    } as unknown as SupabaseClient
    await uploadPdpImage(db, 'u', 'j', 'k17_clip_0-gif', 'R0lG', 'image/gif')
    expect(paths[0].path).toMatch(/^u\/registration\/j\/pdp-k17_clip_0-gif-\d+\.gif$/)
    expect(paths[0].contentType).toBe('image/gif')
  })
})
