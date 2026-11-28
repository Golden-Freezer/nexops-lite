/**
 * 움직이는 칸 자리 규칙(세션 B, 오너 2026-11-06 21:57 DIRECTIVE) — 엔진 자리(gif-sheet 감싸기 바이트 그대로)·대표 칸·고른 칸(상한 3)·예산·300초 run.
 * 가짜 deps·합성 GIF로 돈다(유료 호출·네트워크 0).
 */

import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import type { VisionImage } from '@/lib/agents/registration/thumbnail-vision-agent'
import { dHashDistance, dHashOf } from '../shot-composition'
import type { LineShot } from '../templatelib/shot-brief'
import { motionLadderOf, type FrameSet } from './assemble'
import { decodeGif, encodeBandLadder, fitPageBudget, MOTION_ENCODE } from './encode'
import { DEFAULT_MOTION_ENGINE, gifSheetEngine, motionEngineIdOf, resolveMotionEngine } from './engine'
import { clampPicks, HERO_MOTION_SECTION, MOTION_CELLS_MAX, motionCandidatesOf, pickLoopOf, pickMaxOf, type MotionCandidate } from './pick'
import { buildMotionCell, cellMaxBytesOf, gifPromptOf, gifTimeoutOf, HERO_FIRST_FRAME_MAX, MOTION_AFTER_CALL_MS, motionCanStart, type MotionDeps } from './stage'
import type { MotionTask } from './task'

const W = 64
const H = 64
function barFrame(i: number): Buffer {
  const f = Buffer.alloc(W * H * 3, 255)
  for (let y = 0; y < H; y++) for (let x = i * 4; x < Math.min(W, i * 4 + 8); x++) f.fill(0, (y * W + x) * 3, (y * W + x) * 3 + 3)
  return f
}
const bars = (n: number): FrameSet => ({ frames: [...Array(n).keys()].map(barFrame), delays: Array(n).fill(200), width: W, height: H })
async function gifOf(set: FrameSet): Promise<Buffer> {
  const pngs = await Promise.all(set.frames.map((f) => sharp(f, { raw: { width: set.width, height: set.height, channels: 3 } }).png().toBuffer()))
  return sharp(pngs, { join: { animated: true } }).gif({ delay: set.delays, loop: 0 }).toBuffer()
}

const gifTask: MotionTask = { action: '흔들어 섞는 모습', mode: 'gif', loop: 'back_and_forth', optionPhotos: [] }
const heroTask: MotionTask = { action: '대표 컷', mode: 'gif', loop: 'back_and_forth', optionPhotos: [], role: 'hero', aspect: '1:1' }

function depsOf(over: Partial<MotionDeps> = {}) {
  const uploads: Array<{ kind: string; mime: string; bytes: Buffer }> = []
  const deps: MotionDeps = {
    generateGif: vi.fn(async () => ({ base64: (await gifOf(bars(9))).toString('base64'), costUsd: 0.2 })),
    fetchPhoto: vi.fn(async () => null),
    judgeSheet: vi.fn(async () => ({ pass: true, reason: '' })),
    upload: vi.fn(async (kind, bytes, mime) => {
      uploads.push({ kind, mime, bytes })
      return `https://cdn.example.com/${kind}`
    }),
    elapsedMs: () => 10_000,
    budgetMs: 280_000,
    ...over,
  }
  return { deps, uploads }
}

/** 정지 대표 컷 — GIF 첫 프레임과 같은 그림(780 폭으로 디코드한 첫 프레임의 JPEG) */
async function stillOfFirstFrame(): Promise<VisionImage> {
  const frames = await decodeGif(await gifOf(bars(9)))
  const jpeg = await sharp(frames.frames[0], { raw: { width: frames.width, height: frames.height, channels: 3 } }).jpeg().toBuffer()
  return { data: jpeg.toString('base64'), mediaType: 'image/jpeg' as const }
}

/** 첫 프레임과 다른 그림 — 가로 줄무늬 */
async function stripes(): Promise<VisionImage> {
  const f = Buffer.alloc(W * H * 3, 255)
  for (let y = 0; y < H; y++) if (Math.floor(y / 8) % 2 === 0) f.fill(0, y * W * 3, (y + 1) * W * 3)
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (x > W / 2) f.fill(y * 4, (y * W + x) * 3, (y * W + x) * 3 + 3)
  const jpeg = await sharp(f, { raw: { width: W, height: H, channels: 3 } }).jpeg().toBuffer()
  return { data: jpeg.toString('base64'), mediaType: 'image/jpeg' as const }
}

describe('엔진 자리(④)', () => {
  it('gif-sheet 1:1은 지금 경로와 같은 호출(크기 인자 없음)·같은 디코드다', async () => {
    const gif = await gifOf(bars(9))
    const generateGif = vi.fn(async () => ({ base64: gif.toString('base64'), costUsd: 0.3 }))
    const out = await gifSheetEngine({ generateGif }).make({ prompt: 'P', action: 'a', loop: 'back_and_forth', aspect: '1:1', timeoutMs: 120_000 })
    expect(generateGif).toHaveBeenCalledWith('P', 120_000)
    expect(generateGif.mock.calls[0]).toHaveLength(2)
    const direct = await decodeGif(gif)
    expect(Buffer.concat(out!.frames.frames).equals(Buffer.concat(direct.frames))).toBe(true)
    expect(out?.frames.delays).toEqual(direct.delays)
    expect(out?.meta).toEqual({ engine: 'gif-sheet', source: { bytes: gif, mimeType: 'image/gif' } })
    expect(out?.costUsd).toBe(0.3)
  })

  it('3:4 칸은 시트 한도 안의 656×880으로 부르고 780×1040(칸 비율)로 디코드한다. 크기 없는 비율은 만들지 않는다', async () => {
    const gif = await gifOf(bars(9))
    const generateGif = vi.fn(async () => ({ base64: gif.toString('base64'), costUsd: 0.3 }))
    const engine = gifSheetEngine({ generateGif })
    const out = await engine.make({ prompt: 'P', action: 'a', loop: 'back_and_forth', aspect: '3:4', timeoutMs: 90_000 })
    expect(generateGif).toHaveBeenCalledWith('P', 90_000, '656x880')
    expect([out?.frames.width, out?.frames.height]).toEqual([780, 1040])
    expect(await engine.make({ prompt: 'P', action: 'a', loop: 'back_and_forth', aspect: '16:9', timeoutMs: 90_000 })).toBeNull()
  })

  it('받은 GIF를 못 읽으면 같은 오류를 던지되 이미 난 호출 비용을 싣는다 — stage가 비용을 더한다', async () => {
    const engine = gifSheetEngine({ generateGif: async () => ({ base64: Buffer.from('not a gif').toString('base64'), costUsd: 0.4 }) })
    const err = await engine.make({ prompt: 'P', action: 'a', loop: 'back_and_forth', aspect: '1:1', timeoutMs: 90_000 }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.costUsd).toBe(0.4)
    const { deps } = depsOf({ generateGif: async () => ({ base64: Buffer.from('not a gif').toString('base64'), costUsd: 0.4 }) })
    const outcome = await buildMotionCell(gifTask, 'BASE', deps)
    expect(outcome.costUsd).toBe(0.4)
    expect(outcome.reasons[0]).toMatch(/^GIF 실패: /)
  })

  it('엔진 고르기: 기본 gif-sheet, 계획 기록 → 로컬 env가 이기고 Vercel은 env 무시, 모르는 값은 버린다. 등록 안 된 video-clip은 gif-sheet와 까닭', () => {
    expect(DEFAULT_MOTION_ENGINE).toBe('gif-sheet')
    expect(motionEngineIdOf(undefined, {})).toBe('gif-sheet')
    expect(motionEngineIdOf('video-clip', {})).toBe('video-clip')
    expect(motionEngineIdOf('gif-sheet', { NEXOPS_PDP_MOTION_ENGINE: 'video-clip' })).toBe('video-clip')
    expect(motionEngineIdOf('gif-sheet', { NEXOPS_PDP_MOTION_ENGINE: 'video-clip', VERCEL: '1' })).toBe('gif-sheet')
    expect(motionEngineIdOf('omni', { NEXOPS_PDP_MOTION_ENGINE: 'x' })).toBe('gif-sheet')
    const r = resolveMotionEngine('video-clip', { generateGif: async () => ({ base64: '', costUsd: 0 }) })
    expect(r.engine.id).toBe('gif-sheet')
    expect(r.note).toBe('엔진 video-clip 없음 — gif-sheet로')
  })

  it('바이트 그대로: 엔진 없이(지금) · gif-sheet 엔진을 넘겨서 · 옛 경로(디코드 → 사다리 → 인코딩)가 같은 WebP를 올린다', async () => {
    const gif = await gifOf(bars(9))
    const a = depsOf()
    const b = depsOf()
    b.deps.engine = gifSheetEngine(b.deps)
    const outA = await buildMotionCell(gifTask, 'BASE', a.deps)
    const outB = await buildMotionCell(gifTask, 'BASE', b.deps)
    const legacy = await encodeBandLadder(motionLadderOf(await decodeGif(gif), gifTask.loop).map((c) => c.set))
    const webp = (u: typeof a.uploads) => u.find((x) => x.kind === 'motion')!.bytes
    expect(webp(a.uploads).equals(legacy.webp!)).toBe(true)
    expect(webp(b.uploads).equals(legacy.webp!)).toBe(true)
    expect(a.uploads.map((u) => u.kind)).toEqual(['poster', 'motion', 'gif'])
    expect(a.uploads.find((x) => x.kind === 'gif')!.bytes.equals(gif)).toBe(true)
    expect(outA).toEqual(outB)
  })
})

describe('대표 칸(①)', () => {
  it('지시에 첫 프레임 = 맨 끝 참조(대표 컷) 줄이 붙는다 — 대표 칸이 아니면 줄이 없다(지금 그대로)', () => {
    expect(gifPromptOf('B', heroTask)).toContain('Frame 1 must reproduce the LAST attached image')
    expect(gifPromptOf('B', gifTask)).not.toContain('Frame 1')
  })

  it('포스터는 정지 대표 컷 URL 그대로(포스터를 올리지 않는다), 첫 프레임이 대표 컷과 같으면 움직이는 WebP', async () => {
    const still = await stillOfFirstFrame()
    const { deps, uploads } = depsOf()
    const out = await buildMotionCell(heroTask, 'HERO', deps, { url: 'https://cdn.example.com/hero.jpg', image: still })
    expect(out.cell?.url).toBe('https://cdn.example.com/hero.jpg')
    expect(out.cell?.motion.status).toBe('ok')
    expect(uploads.map((u) => u.kind)).toEqual(['motion', 'gif'])
    expect(out.reasons).toEqual([])
  })

  it(`첫 프레임이 대표 컷과 다르면(구도 거리 > ${HERO_FIRST_FRAME_MAX}) 포스터 칸 — 정지 대표 컷이 남고 쓴 비용은 더한다`, async () => {
    const other = await stripes()
    const first = await stillOfFirstFrame()
    const [a, b] = await Promise.all([dHashOf(other.data), dHashOf(first.data)])
    expect(dHashDistance(a!, b!)).toBeGreaterThan(HERO_FIRST_FRAME_MAX)
    const { deps, uploads } = depsOf()
    const out = await buildMotionCell(heroTask, 'HERO', deps, { url: 'https://cdn.example.com/hero.jpg', image: other })
    expect(out.cell?.url).toBe('https://cdn.example.com/hero.jpg')
    expect(out.cell?.motion).toMatchObject({ status: 'poster', frames: 1, bytes: 0 })
    expect(out.cell?.motion.webpUrl).toBeUndefined()
    expect(out.reasons[0]).toMatch(/^검사 탈락: 첫 프레임이 대표 컷과 다름/)
    expect(uploads).toEqual([])
    expect(out.costUsd).toBe(0.2)
  })

  it('GIF가 실패해도 옵션 밀기·GIF 첫 프레임 포스터로 가지 않고 정지 대표 컷 포스터다', async () => {
    const still = await stillOfFirstFrame()
    const { deps, uploads } = depsOf({ generateGif: vi.fn(async () => Promise.reject(new Error('400 Invalid size'))) })
    const out = await buildMotionCell({ ...heroTask, optionPhotos: ['https://example.com/a.jpg', 'https://example.com/b.jpg'] }, 'HERO', deps, {
      url: 'https://cdn.example.com/hero.jpg',
      image: still,
    })
    expect(out.cell).toMatchObject({ url: 'https://cdn.example.com/hero.jpg', motion: { status: 'poster', reason: 'GIF 실패: 400 Invalid size' } })
    expect(deps.fetchPhoto).not.toHaveBeenCalled()
    expect(uploads).toEqual([])
  })

  it('칸 예산: 대표 칸(heroMaxBytes)·use가 아닌 고른 칸·motion_band(maxBytes)는 0.7MB(결정 카드 c13), 사용 동작 고른 칸만 1.5MB(J55)', () => {
    expect(cellMaxBytesOf(heroTask)).toBe(MOTION_ENCODE.heroMaxBytes)
    expect(cellMaxBytesOf(heroTask)).toBe(700 * 1024)
    expect(cellMaxBytesOf(gifTask)).toBe(700 * 1024)
    expect(cellMaxBytesOf({ role: 'pick' })).toBe(700 * 1024)
    expect(cellMaxBytesOf({ role: 'pick', useCell: true })).toBe(1500 * 1024)
    // 대표 칸은 표지가 붙어도 대표 칸 예산이다
    expect(cellMaxBytesOf({ role: 'hero', useCell: true })).toBe(700 * 1024)
  })
})

const lineShot = (key: string, over: Partial<LineShot> = {}): LineShot => ({ key, section: 'sub2_div_page', purpose: 'action', composition: 'in_use', aspect: '1:1', show: '쓰는 모습', ...over })

describe('고른 칸(②)', () => {
  it('후보: 움직임이 나은 목적·구도이고 내보내기가 바꿔 넣을 수 있는 칸만 — 사진 위 글·틀·치수·motion_band·크기 없는 비율은 뺀다', () => {
    const shots = [
      lineShot('k1_a'),
      lineShot('k2_a', { purpose: 'texture', composition: 'front' }),
      lineShot('k3_a', { overlayAnchor: 'top' as LineShot['overlayAnchor'] }),
      lineShot('k4_a', { clipShape: 'circle' }),
      lineShot('k5_a', { sizeCut: true }),
      lineShot('k6_a', { section: 'motion_band' }),
      lineShot('k7_a', { aspect: '16:9' }),
      lineShot('k8_a', { purpose: 'scale', composition: 'front', aspect: '3:4' }),
      lineShot('k9_a', { section: 'option_lineup', purpose: 'color', composition: 'front' }),
    ]
    const keys = (c: MotionCandidate[]) => c.map((x) => `${x.key}:${x.kinds.join('/')}`)
    expect(keys(motionCandidatesOf(shots, { textBearing: false, optionPhotos: 0 }))).toEqual(['k1_a:use/transform/assemble', 'k8_a:scale/use'])
    expect(keys(motionCandidatesOf(shots, { textBearing: false, optionPhotos: 2 }))).toEqual(['k1_a:use/transform/assemble', 'k8_a:scale/use', 'k9_a:slide'])
    // 인쇄물은 GIF 후보가 없고 옵션 밀기만
    expect(keys(motionCandidatesOf(shots, { textBearing: true, optionPhotos: 2 }))).toEqual(['k9_a:slide'])
  })

  it('상한은 대표 칸 포함 3 — 대표·motion_band를 빼고 남은 만큼만 고른다', () => {
    expect(MOTION_CELLS_MAX).toBe(3)
    expect(pickMaxOf(true, false)).toBe(2)
    expect(pickMaxOf(true, true)).toBe(1)
    expect(pickMaxOf(false, true)).toBe(2)
  })

  it('답 거르기: 모르는 키·받지 않는 종류·까닭 없음·같은 섹션 둘째 칸·같은 키·상한 밖은 버린다', () => {
    const candidates = motionCandidatesOf([lineShot('k1_a'), lineShot('k1_b'), lineShot('k2_a', { section: 'how_to' }), lineShot('k3_a', { section: 'point' })], { textBearing: false, optionPhotos: 0 })
    const raw = [
      { key: 'k9_z', kind: 'use', reason: '모름' },
      { key: 'k1_a', kind: 'slide', reason: '종류 밖' },
      { key: 'k1_a', kind: 'use', reason: '' },
      { key: 'k1_a', kind: 'use', reason: '누르는 힘이 보인다' },
      { key: 'k1_b', kind: 'use', reason: '같은 섹션' },
      { key: 'k2_a', kind: 'transform', reason: '접히는 모습' },
      { key: 'k3_a', kind: 'use', reason: '상한 밖' },
    ]
    expect(clampPicks(raw, candidates, 2)).toEqual({
      cells: [
        { key: 'k1_a', kind: 'use', reason: '누르는 힘이 보인다' },
        { key: 'k2_a', kind: 'transform', reason: '접히는 모습' },
      ],
      rejected: 5,
    })
    expect(clampPicks('not a list', candidates, 2)).toEqual({ cells: [], rejected: 0 })
  })

  it('고리 꼴: 변형·조립은 결과에서 머무름, 그 밖은 오가는 동작', () => {
    expect(['use', 'transform', 'assemble', 'scale', 'slide'].map((k) => pickLoopOf(k as never))).toEqual(['back_and_forth', 'ends_in_result', 'ends_in_result', 'back_and_forth', 'back_and_forth'])
  })

  it('대표 칸 섹션 키는 목록형 키(이름:번호)와 겹치지 않는다', () => {
    expect(HERO_MOTION_SECTION).toBe('hero_motion')
    expect(HERO_MOTION_SECTION).not.toContain(':')
  })
})

describe('예산(③)', () => {
  it('페이지 합 3MB(J55)를 넘으면 뒤 칸부터 빠지고 페이지 맨 위 대표 칸은 마지막까지 남는다', () => {
    expect(MOTION_ENCODE.pageMaxBytes).toBe(3000 * 1024)
    const hero = MOTION_ENCODE.heroMaxBytes
    expect(fitPageBudget([hero, 600 * 1024, 600 * 1024])).toEqual([])
    expect(fitPageBudget([hero, 700 * 1024, 700 * 1024], 1000 * 1024)).toEqual([1, 2])
    // 낮추기 전(결정 카드 c13 전)에 0.9MB로 만든 대표 칸이 남은 잡 — 3MB 안이면 남고, 넘으면 맨 뒤 칸부터 빠진다
    expect(fitPageBudget([900 * 1024, 700 * 1024, 700 * 1024])).toEqual([])
    expect(fitPageBudget([900 * 1024, 1500 * 1024, 700 * 1024])).toEqual([2])
  })

  it('칸 상한 합이 페이지 상한 안 — 상한 3칸(대표 칸 포함)을 모두 칸 상한까지 채워도 3MB를 넘지 않아 빠지는 칸이 없다(결정 카드 c13·J55)', () => {
    const full = [MOTION_ENCODE.heroMaxBytes, ...Array<number>(MOTION_CELLS_MAX - 1).fill(MOTION_ENCODE.maxBytes)]
    expect(full).toHaveLength(3)
    expect(full.reduce((s, b) => s + b, 0)).toBeLessThanOrEqual(MOTION_ENCODE.pageMaxBytes)
    expect(fitPageBudget(full)).toEqual([])
    // 고른 칸은 잡마다 하나다(대표 + motion_band + 고른 칸) — 고른 칸이 use(1.5MB)여도 2.9MB로 3MB 안
    const withUse = [MOTION_ENCODE.heroMaxBytes, MOTION_ENCODE.maxBytes, MOTION_ENCODE.useMaxBytes]
    expect(withUse.reduce((s, b) => s + b, 0)).toBeLessThanOrEqual(MOTION_ENCODE.pageMaxBytes)
    expect(fitPageBudget(withUse)).toEqual([])
  })
})

describe('300초 run(⑤)', () => {
  it('어느 시각에 시작하든 GIF 칸은 run 예산 안에서 끝난다 — 시작 시각 + GIF 상한 + 호출 뒤 몫 ≤ run 예산, 못 들어가면 다음 run', () => {
    for (const budget of [280_000, 300_000]) {
      for (let elapsed = 0; elapsed <= budget; elapsed += 5_000) {
        const timeout = gifTimeoutOf(elapsed, budget)
        if (motionCanStart(elapsed, budget)) {
          expect(timeout).toBeGreaterThan(0)
          expect(elapsed + timeout + MOTION_AFTER_CALL_MS).toBeLessThanOrEqual(budget)
        }
      }
    }
  })

  it('세 칸(대표 + 고른 둘)은 run 하나에 다 들어가지 않으면 남은 칸이 다음 run으로 넘어간다 — 칸마다 run 예산을 넘지 않는다', () => {
    // 한 칸씩 차례로 도는 가장 나쁜 꼴(동시 실행 없음) — 칸 하나가 GIF 상한을 다 쓴다고 본다
    const budget = 280_000
    const runs: number[][] = []
    let left = 3
    while (left > 0 && runs.length < 10) {
      const cells: number[] = []
      let elapsed = 0
      while (left > 0 && motionCanStart(elapsed, budget)) {
        // 참조 받기 15초 뒤에 GIF 상한을 정한다(stage가 부르는 시각)
        const timeout = gifTimeoutOf(elapsed + 15_000, budget)
        expect(timeout).toBeGreaterThan(0)
        const cost = 15_000 + timeout + MOTION_AFTER_CALL_MS
        cells.push(cost)
        elapsed += cost
        left -= 1
      }
      expect(elapsed).toBeLessThanOrEqual(budget)
      runs.push(cells)
    }
    expect(left).toBe(0)
    expect(runs.length).toBe(3)
  })
})
