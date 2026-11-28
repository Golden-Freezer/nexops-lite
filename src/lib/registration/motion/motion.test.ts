/**
 * GIF 칸 엮기·인코딩(motion/assemble.ts·encode.ts) — 합성 프레임으로 돈다(유료·네트워크 0).
 * 고정: 왕복 2N-2장 · 머무름 ≥ 800ms · 옵션 밀기 3×70 · 고리가 끊긴 오가는 동작만 왕복 · 판독 기준(4절) ·
 * GIF 풀기 780 폭 · WebP q80 effort 4 loop 0 · 칸 예산 q80 → q70 → 프레임 줄이기 → 포스터 · 페이지 합은 뒤 칸부터 포스터.
 */
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { holdLast, LOOP_RULES, loopForMotion, loopMetrics, loopProblems, motionLadderOf, pingpong, SLIDE_DEFAULTS, slideFrames, thinFrames, type FrameSet } from './assemble'
import { decodeGif, encodeBandLadder, encodeMotionBand, encodeWebp, fitPageBudget, frameSheet, MOTION_ENCODE, posterJpeg } from './encode'

const W = 64
const H = 48

/** 가로로 움직이는 검은 막대(흰 바탕) — i번째 프레임은 막대가 x = i·step */
function barFrame(i: number, step = 2, w = W, h = H): Buffer {
  const f = Buffer.alloc(w * h * 3, 255)
  for (let y = 0; y < h; y++) for (let x = i * step; x < Math.min(w, i * step + 8); x++) f.fill(0, (y * w + x) * 3, (y * w + x) * 3 + 3)
  return f
}
const bars = (n: number, step = 2): FrameSet => ({ frames: [...Array(n).keys()].map((i) => barFrame(i, step)), delays: Array(n).fill(200), width: W, height: H })
const solid = (v: number) => Buffer.alloc(W * H * 3, v)

describe('엮기(순수)', () => {
  it('왕복 1→N→2는 2N-2장, 지연도 같은 순서', () => {
    const s = pingpong(bars(9))
    expect(s.frames).toHaveLength(16)
    expect(s.frames[9].equals(s.frames[7])).toBe(true)
    expect(s.frames[15].equals(s.frames[1])).toBe(true)
    expect(pingpong(bars(2)).frames).toHaveLength(2)
  })

  it('머무름은 마지막 지연만 늘린다(≥ 기본 1000ms), 프레임 수 그대로', () => {
    const s = holdLast(bars(9))
    expect(s.frames).toHaveLength(9)
    expect(s.delays.at(-1)).toBe(1000)
    expect(s.delays.slice(0, -1).every((d) => d === 200)).toBe(true)
  })

  it('옵션 밀기 기본 3×70·머무름 600: 사진 N장이면 N×4프레임, 사이 프레임은 a가 왼쪽으로 밀리고 b가 들어온다', () => {
    expect(SLIDE_DEFAULTS).toEqual({ holdMs: 600, between: 3, betweenMs: 70 })
    const s = slideFrames([solid(0), solid(255)], W, H)
    expect(s.frames).toHaveLength(8)
    expect(s.delays.slice(0, 4)).toEqual([600, 70, 70, 70])
    const mid = s.frames[2] // t = 0.5 → 절반 밀림: 왼쪽 반은 a(검정), 오른쪽 반은 b(흰색)
    expect(mid[0]).toBe(0)
    expect(mid[(W - 1) * 3]).toBe(255)
    expect(slideFrames([solid(9)], W, H).frames).toHaveLength(1)
  })

  it('판독: 고르게 움직이면 깜빡임·고리 문제 없음, 끝에서 처음으로 크게 튀면 고리(seam)', () => {
    const smooth = pingpong(bars(9))
    expect(loopProblems(smooth, 'pingpong', 'gif')).toEqual([])
    const m = loopMetrics(bars(9))
    expect(m.seamRatio).toBeGreaterThan(LOOP_RULES.seamRatioMax)
    expect(loopProblems(bars(9), 'plain', 'gif')).toContain('seam')
    expect(loopProblems(holdLast(bars(9)), 'hold', 'gif')).not.toContain('seam') // 머무름의 되감기는 의도
    expect(loopProblems(bars(9), 'hold', 'gif')).toContain('no_hold')
    expect(loopProblems(bars(4), 'pingpong', 'gif')).toContain('too_short')
  })

  it('밝기 기준(8/255)은 참조 GIF에만 — 옵션 밀기의 배경색 바뀜은 의도된 것', () => {
    const s = slideFrames([solid(0), solid(255)], W, H, { holdMs: 1000, between: 3, betweenMs: 70 })
    expect(loopProblems(s, 'plain', 'slide')).not.toContain('brightness')
    expect(loopProblems(s, 'plain', 'gif')).toContain('brightness')
  })

  it('동작 종류: 끝 모습이 결과면 머무름, 오가는 동작은 고리가 끊길 때만 왕복', () => {
    expect(loopForMotion(bars(9), 'ends_in_result').kind).toBe('hold')
    expect(loopForMotion(bars(9), 'back_and_forth')).toMatchObject({ kind: 'pingpong' })
    expect(loopForMotion(pingpong(bars(9)), 'back_and_forth').kind).toBe('plain')
  })
})

async function gifOf(set: FrameSet): Promise<Buffer> {
  const pngs = await Promise.all(set.frames.map((f) => sharp(f, { raw: { width: set.width, height: set.height, channels: 3 } }).png().toBuffer()))
  return sharp(pngs, { join: { animated: true } }).gif({ delay: set.delays, loop: 0 }).toBuffer()
}

describe('인코딩(sharp)', () => {
  it('GIF 풀기: 프레임 수·지연 그대로, 폭 780(비율 유지)', async () => {
    const decoded = await decodeGif(await gifOf(bars(9)))
    expect(decoded.frames).toHaveLength(9)
    expect([decoded.width, decoded.height]).toEqual([780, 585])
    expect(decoded.frames[0].length).toBe(780 * 585 * 3)
    expect(decoded.delays).toEqual(Array(9).fill(200))
  }, 30_000)

  it('GIF 칸 요청 크기 768²·9프레임(세션 B ③ P6) → 780² 프레임으로 풀고, 칸 WebP도 780²·9프레임', async () => {
    const side = 768
    const set768: FrameSet = { frames: [...Array(9).keys()].map((i) => barFrame(i, 80, side, side)), delays: Array(9).fill(200), width: side, height: side }
    const gif = await gifOf(set768)
    const meta = await sharp(gif, { animated: true }).metadata()
    expect([meta.width, meta.pageHeight, meta.pages]).toEqual([768, 768, 9])
    const decoded = await decodeGif(gif)
    expect([decoded.width, decoded.height, decoded.frames.length]).toEqual([780, 780, 9])
    expect(decoded.frames[0].length).toBe(780 * 780 * 3)
    const band = await encodeMotionBand(decoded)
    expect(band).toMatchObject({ status: 'ok', quality: 80, frames: 9 })
    const webp = await sharp(band.webp!, { animated: true }).metadata()
    expect([webp.format, webp.width, webp.pageHeight, webp.pages]).toEqual(['webp', 780, 780, 9])
    const poster = await sharp(band.poster).metadata()
    expect([poster.format, poster.width, poster.height]).toEqual(['jpeg', 780, 780])
  }, 30_000)

  it('WebP: 움직이는 WebP(프레임 수·지연·무한 고리), 기본 q80 effort 4', async () => {
    expect(MOTION_ENCODE).toMatchObject({ width: 780, quality: 80, fallbackQuality: 70, effort: 4, maxBytes: 700 * 1024, heroMaxBytes: 700 * 1024, useMaxBytes: 1500 * 1024, pageMaxBytes: 3000 * 1024 })
    const webp = await encodeWebp(pingpong(bars(9)))
    const meta = await sharp(webp, { animated: true }).metadata()
    expect([meta.format, meta.pages, meta.loop]).toEqual(['webp', 16, 0])
    expect(meta.delay).toEqual(Array(16).fill(200))
  })

  it('칸 예산: 넉넉하면 q80, 모자라면 q70 → 프레임 줄이기 → 포스터 순, 포스터 JPEG는 늘 만든다', async () => {
    const set = pingpong(bars(9))
    const ok = await encodeMotionBand(set)
    expect(ok).toMatchObject({ status: 'ok', quality: 80, frames: 16 })
    expect((await sharp(ok.poster).metadata()).format).toBe('jpeg')

    const q80 = (await encodeWebp(set, 80)).length
    const q70 = (await encodeWebp(set, 70)).length
    const reduce = (s: FrameSet) => ({ ...s, frames: s.frames.slice(0, 9), delays: s.delays.slice(0, 9) })
    const toQ70 = await encodeMotionBand(set, { maxBytes: q80 - 1 })
    if (q70 < q80) expect(toQ70).toMatchObject({ status: 'ok', quality: 70 })
    const toReduce = await encodeMotionBand(set, { maxBytes: Math.min(q80, q70) - 1, reduce })
    expect(toReduce.steps[2]).toMatch(/^q70 9f /)
    const toPoster = await encodeMotionBand(set, { maxBytes: 10, reduce })
    expect(toPoster).toMatchObject({ status: 'poster', webp: null, quality: null, frames: 1 })
    expect(toPoster.steps.at(-1)).toBe('poster')
  })

  it('포스터는 고른 프레임, 3×3 모음은 9장(넘으면 고르게 9장)', async () => {
    const set = bars(9)
    const p = await sharp(await posterJpeg(set, 3)).raw().toBuffer({ resolveWithObject: true })
    expect([p.info.width, p.info.height]).toEqual([W, H])
    const sheet = await sharp(await frameSheet(pingpong(set), 32)).metadata()
    expect([sheet.width, sheet.height]).toEqual([96, 72])
  })

  it('페이지 합 예산: 넘으면 뒤 칸부터 포스터로', () => {
    expect(fitPageBudget([600 * 1024, 640 * 1024])).toEqual([])
    expect(fitPageBudget([700 * 1024, 700 * 1024, 300 * 1024])).toEqual([])
    // 페이지 3MB(J55) — 0.9MB 대표 칸 + 0.7MB 둘(2.3MB)은 이제 남는다. 3MB를 넘으면 맨 뒤 칸부터 빠지고 맨 앞 대표 칸은 남는다
    expect(fitPageBudget([900 * 1024, 700 * 1024, 700 * 1024])).toEqual([])
    expect(fitPageBudget([900 * 1024, 1500 * 1024, 700 * 1024])).toEqual([2])
    expect(fitPageBudget([900 * 1024, 700 * 1024, 700 * 1024], 1400 * 1024)).toEqual([1, 2])
    expect(fitPageBudget([900 * 1024, 900 * 1024], 1400 * 1024)).toEqual([1])
  })
})

describe('GIF 칸 예산 사다리(세션 B ③ — 통합 05:1x 권장안)', () => {
  it('프레임 줄이기: 한 장 건너 남기고 첫·끝 장은 늘 남긴다. 뺀 지연은 앞 장에 더해 전체 길이가 같다', () => {
    const set = bars(9)
    const thin = thinFrames(set)
    expect(thin.frames).toEqual([0, 2, 4, 6, 8].map((i) => set.frames[i]))
    expect(thin.delays).toEqual([400, 400, 400, 400, 200])
    const even = thinFrames(bars(8))
    expect(even.frames).toEqual([0, 2, 4, 6, 7].map((i) => bars(8).frames[i]))
    expect(even.delays.reduce((a, b) => a + b, 0)).toBe(1600)
    expect(thinFrames(bars(2)).frames).toHaveLength(2)
  })

  it('후보 순서: 오가는 동작이 왕복이면 왕복 → 머무름 → 머무름 줄이기, 끝이 결과면 머무름 → 머무름 줄이기, 이어지는 고리면 고리 → 고리 줄이기', () => {
    const seam = bars(9)
    expect(loopForMotion(seam, 'back_and_forth').kind).toBe('pingpong')
    const a = motionLadderOf(seam, 'back_and_forth')
    expect(a.map((c) => `${c.kind}:${c.set.frames.length}`)).toEqual(['pingpong:16', 'hold:9', 'hold:5'])
    expect(a[1].set.delays.at(-1)).toBe(LOOP_RULES.holdMs)
    expect(a[2].set.delays.at(-1)).toBe(LOOP_RULES.holdMs)
    expect(motionLadderOf(seam, 'ends_in_result').map((c) => `${c.kind}:${c.set.frames.length}`)).toEqual(['hold:9', 'hold:5'])
    const smooth = pingpong(bars(5))
    expect(loopForMotion(smooth, 'back_and_forth').kind).toBe('plain')
    expect(motionLadderOf(smooth, 'back_and_forth').map((c) => `${c.kind}:${c.set.frames.length}`)).toEqual(['plain:8', 'plain:5'])
  })

  it('인코딩: 후보를 q80으로 차례로, 다 넘으면 마지막 후보만 q70, 그래도 넘으면 포스터(첫 후보의 장면)', async () => {
    const tries = motionLadderOf(bars(9), 'back_and_forth').map((c) => c.set)
    const q80 = await Promise.all(tries.map((s) => encodeWebp(s, 80)))
    const q70last = (await encodeWebp(tries[2], 70)).length
    const sizes = q80.map((b) => b.length)
    expect(sizes[0]).toBeGreaterThan(sizes[1])
    expect(sizes[1]).toBeGreaterThan(sizes[2])

    expect(await encodeBandLadder(tries)).toMatchObject({ status: 'ok', pick: 0, quality: 80, frames: 16 })
    const toHold = await encodeBandLadder(tries, { maxBytes: sizes[0] - 1 })
    expect(toHold).toMatchObject({ status: 'ok', pick: 1, quality: 80, frames: 9 })
    expect(toHold.steps).toHaveLength(2)
    const toThin = await encodeBandLadder(tries, { maxBytes: sizes[1] - 1 })
    expect(toThin).toMatchObject({ status: 'ok', pick: 2, quality: 80, frames: 5 })
    if (q70last < sizes[2]) {
      const toQ70 = await encodeBandLadder(tries, { maxBytes: sizes[2] - 1 })
      expect(toQ70).toMatchObject({ status: 'ok', pick: 2, quality: 70, frames: 5 })
      expect(toQ70.steps.map((s) => s.split(' ').slice(0, 2).join(' '))).toEqual(['q80 16f', 'q80 9f', 'q80 5f', 'q70 5f'])
    }
    const poster = await encodeBandLadder(tries, { maxBytes: 10 })
    expect(poster).toMatchObject({ status: 'poster', pick: null, webp: null, quality: null, frames: 1 })
    expect(poster.steps.at(-1)).toBe('poster')
    expect(poster.poster.equals(await posterJpeg(tries[0], 0))).toBe(true)
    await expect(encodeBandLadder([])).rejects.toThrow('후보가 없습니다')
  })
})
