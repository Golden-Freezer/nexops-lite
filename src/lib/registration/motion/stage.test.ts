/**
 * GIF 칸 생성(motion/stage.ts) — 가짜 deps로 돈다(유료 GIF 호출·네트워크 0). GIF는 합성 프레임으로 만든 작은 픽스처다.
 * 성공 꼴(SectionMotion), 시간 상한, 검사 탈락·실패·시간 부족에서 옵션 밀기 → 포스터 → null로 내려가기, 업로드 mime.
 */

import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { GIF_TOTAL_MAX_MS } from '@/lib/agents/image/generate'
import { animationRequestError, gifSheetOf } from '@/lib/agents/image/types'
import type { FrameSet } from './assemble'
import {
  buildMotionCell,
  gifPromptOf,
  gifTimeoutOf,
  isMotionRedo,
  MOTION_AFTER_CALL_MS,
  MOTION_GATE_NOTE,
  MOTION_GIF,
  MOTION_START_MIN_MS,
  motionCanStart,
  motionFallbackNote,
  motionGateSkip,
  motionOrStill,
  type MotionCell,
  type MotionDeps,
} from './stage'
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
const photo = (v: number) => sharp({ create: { width: 40, height: 40, channels: 3, background: { r: v, g: 120, b: 255 - v } } }).jpeg().toBuffer()

const gifTask: MotionTask = { action: '흔들어 섞는 모습', mode: 'gif', loop: 'back_and_forth', optionPhotos: [] }
const withPhotos = (task: MotionTask): MotionTask => ({ ...task, optionPhotos: ['https://example.com/a.jpg', 'https://example.com/b.jpg'] })

function depsOf(over: Partial<MotionDeps> = {}) {
  const uploads: Array<{ kind: string; mime: string; bytes: number }> = []
  const deps: MotionDeps = {
    generateGif: vi.fn(async () => ({ base64: (await gifOf(bars(9))).toString('base64'), costUsd: 0.2 })),
    fetchPhoto: vi.fn(async (url: string) => photo(url.endsWith('a.jpg') ? 40 : 200)),
    judgeSheet: vi.fn(async () => ({ pass: true, reason: '' })),
    upload: vi.fn(async (kind, bytes, mime) => {
      uploads.push({ kind, mime, bytes: bytes.length })
      return `https://cdn.example.com/${kind}`
    }),
    elapsedMs: () => 10_000,
    budgetMs: 280_000,
    ...over,
  }
  return { deps, uploads }
}

describe('시간', () => {
  it('GIF 호출 상한은 run 남은 시간에서 호출 뒤 몫을 뺀 값 — 하네스 300초 정책을 넘지 않고, 60초 아래면 0(부르지 않음)', () => {
    expect(gifTimeoutOf(10_000, 280_000)).toBe(280_000 - 10_000 - MOTION_AFTER_CALL_MS)
    expect(gifTimeoutOf(0, 900_000)).toBe(MOTION_GIF.maxCallMs)
    expect(MOTION_GIF.maxCallMs).toBe(GIF_TOTAL_MAX_MS)
    expect(gifTimeoutOf(280_000 - MOTION_AFTER_CALL_MS - MOTION_GIF.minCallMs + 1, 280_000)).toBe(0)
  })

  it('motion 태스크는 남은 시간이 시작 최소(참조 15초 + GIF 60초 + 호출 뒤 80초) 이상일 때만 시작한다 — 정지 컷 셈과 따로', () => {
    expect(MOTION_START_MIN_MS).toBe(155_000)
    expect(motionCanStart(280_000 - MOTION_START_MIN_MS, 280_000)).toBe(true)
    expect(motionCanStart(280_000 - MOTION_START_MIN_MS + 1, 280_000)).toBe(false)
  })
})

describe('buildMotionCell', () => {
  it('GIF 성공 — 포스터 JPEG가 url, 움직이는 WebP·원본 GIF는 motion에, 꼴은 SectionMotion(gpt26-ref·ok)', async () => {
    const { deps, uploads } = depsOf()
    const out = await buildMotionCell(gifTask, 'BASE', deps)
    expect(out.cell?.url).toBe('https://cdn.example.com/poster')
    expect(out.cell?.motion).toMatchObject({ path: 'gpt26-ref', status: 'ok', webpUrl: 'https://cdn.example.com/motion', gifUrl: 'https://cdn.example.com/gif', width: 780, quality: 80 })
    expect(out.cell!.motion.frames).toBeGreaterThanOrEqual(9)
    expect(out.cell!.motion.durationMs).toBeGreaterThanOrEqual(1800)
    expect(out.cell!.motion.reason).toBeUndefined()
    expect(out.costUsd).toBe(0.2)
    expect(uploads.map((u) => `${u.kind}:${u.mime}`)).toEqual(['poster:image/jpeg', 'motion:image/webp', 'gif:image/gif'])
    expect(deps.generateGif).toHaveBeenCalledWith(expect.stringContaining('흔들어 섞는 모습'), 280_000 - 10_000 - MOTION_AFTER_CALL_MS)
  })

  it('프레임 모음 검사에 떨어지면 옵션 밀기로 — 검사에 떨어진 GIF 프레임은 포스터로도 쓰지 않는다', async () => {
    const judgeSheet = vi.fn(async () => ({ pass: false, reason: '글자 반전' }))
    const slid = await buildMotionCell(withPhotos(gifTask), 'BASE', depsOf({ judgeSheet }).deps)
    expect(slid.cell?.motion).toMatchObject({ path: 'stills-slide', status: 'ok', reason: '검사 탈락: 글자 반전' })
    expect(slid.costUsd).toBe(0.2)
    const none = await buildMotionCell(gifTask, 'BASE', depsOf({ judgeSheet }).deps)
    expect(none).toEqual({ cell: null, costUsd: 0.2, reasons: ['검사 탈락: 글자 반전'], sentPrompt: gifPromptOf('BASE', gifTask) })
  })

  it('엔진에 넘긴 프롬프트를 결과에 남긴다(점검 고침 0) — 만든 칸·못 만든 칸 모두, GIF를 부르지 않았으면 없다', async () => {
    const { deps } = depsOf()
    const made = await buildMotionCell(gifTask, 'BASE', deps)
    expect(made.cell?.motion.status).toBe('ok')
    expect(made.sentPrompt).toBe(gifPromptOf('BASE', gifTask))
    // 엔진에 실제로 넘어간 글과 같다
    expect(vi.mocked(deps.generateGif).mock.calls[0][0]).toBe(made.sentPrompt)
    // 시간이 모자라 GIF를 부르지 않으면 칸이 없다
    const late = await buildMotionCell(gifTask, 'BASE', { ...deps, elapsedMs: () => deps.budgetMs })
    expect(late).not.toHaveProperty('sentPrompt')
  })

  it('검사 채점 실패(null·예외)는 통과로 본다(게이트와 같은 규칙)', async () => {
    const out = await buildMotionCell(gifTask, 'BASE', depsOf({ judgeSheet: vi.fn(async () => null) }).deps)
    expect(out.cell?.motion.status).toBe('ok')
    const thrown = await buildMotionCell(gifTask, 'BASE', depsOf({ judgeSheet: vi.fn(async () => Promise.reject(new Error('x'))) }).deps)
    expect(thrown.cell?.motion.status).toBe('ok')
  })

  it('GIF 실패는 잡을 막지 않는다 — 옵션 사진이 있으면 밀기, 없으면 null(부르는 쪽이 정지 컷)', async () => {
    const generateGif = vi.fn(async () => Promise.reject(new Error('OpenAI 500')))
    const slid = await buildMotionCell(withPhotos(gifTask), 'BASE', depsOf({ generateGif }).deps)
    expect(slid.cell?.motion).toMatchObject({ path: 'stills-slide', status: 'ok', reason: 'GIF 실패: OpenAI 500' })
    expect(await buildMotionCell(gifTask, 'BASE', depsOf({ generateGif }).deps)).toEqual({ cell: null, costUsd: 0, reasons: ['GIF 실패: OpenAI 500'], sentPrompt: gifPromptOf('BASE', gifTask) })
  })

  it('시간이 모자라면 GIF를 부르지 않고 옵션 밀기로 내려간다', async () => {
    const { deps } = depsOf({ elapsedMs: () => 200_000 })
    const out = await buildMotionCell(withPhotos(gifTask), 'BASE', deps)
    expect(deps.generateGif).not.toHaveBeenCalled()
    expect(out.cell?.motion).toMatchObject({ path: 'stills-slide', reason: 'GIF 시간 부족' })
  })

  it('옵션 밀기 칸(slide)은 GIF를 부르지 않고, 사진을 2장 못 받으면 null', async () => {
    const slideTask = withPhotos({ ...gifTask, mode: 'slide' })
    const { deps, uploads } = depsOf()
    const out = await buildMotionCell(slideTask, 'BASE', deps)
    expect(deps.generateGif).not.toHaveBeenCalled()
    expect(out.cell?.motion).toMatchObject({ path: 'stills-slide', status: 'ok', loop: 'plain', height: 780 })
    expect(out.cell!.motion.gifUrl).toBeUndefined()
    expect(uploads.map((u) => u.kind)).toEqual(['poster', 'motion'])
    const lost = await buildMotionCell(slideTask, 'BASE', depsOf({ fetchPhoto: vi.fn(async (url: string) => (url.endsWith('a.jpg') ? photo(1) : null)) }).deps)
    expect(lost).toEqual({ cell: null, costUsd: 0, reasons: ['옵션 사진 받기 1/2'] })
  })

  it('GIF 지시는 기존 프롬프트 뒤에 동작·고리·글자 지키기 줄을 붙인다', () => {
    const prompt = gifPromptOf('BASE', { action: '반으로 접어 넣는 모습', loop: 'ends_in_result' })
    expect(prompt.startsWith('BASE\n')).toBe(true)
    expect(prompt).toContain('반으로 접어 넣는 모습')
    expect(prompt).toContain('last frame shows the finished state')
    expect(prompt).toContain('never mirrored')
  })
})

describe('잡을 막지 않는다(통합 검토 ①)', () => {
  it('옵션 사진 바이트가 그림이 아니어도(sharp가 던짐) 던지지 않고 null + 까닭 — GIF 실패와 함께', async () => {
    const deps = depsOf({ generateGif: vi.fn(async () => Promise.reject(new Error('OpenAI 500'))), fetchPhoto: vi.fn(async () => Buffer.from('not an image')) }).deps
    const out = await buildMotionCell(withPhotos(gifTask), 'BASE', deps)
    expect(out.cell).toBeNull()
    expect(out.reasons[0]).toBe('GIF 실패: OpenAI 500')
    expect(out.reasons[1]).toMatch(/^옵션 밀기 실패: /)
  })

  it('업로드가 던져도 GIF·옵션 밀기·포스터 길을 모두 잡고, 이미 쓴 GIF 비용은 남긴다', async () => {
    const upload = vi.fn(async () => Promise.reject(new Error('storage down')))
    const out = await buildMotionCell(withPhotos(gifTask), 'BASE', depsOf({ upload }).deps)
    expect(out).toEqual({ cell: null, costUsd: 0.2, reasons: ['GIF 실패: storage down', '옵션 밀기 실패: storage down', '포스터 실패: storage down'], sentPrompt: gifPromptOf('BASE', withPhotos(gifTask)) })
  })
})

describe('motionOrStill — 이미지 단계 분기', () => {
  const cell: MotionCell = { url: 'P', costUsd: 0.2, motion: { path: 'gpt26-ref', status: 'ok', width: 780, height: 780, frames: 9, durationMs: 1800, bytes: 1, quality: 80, loop: 'plain' } }
  const still = () => vi.fn(async () => ({ entry: 'STILL', costUsd: 0.05 }))
  const toEntry = (c: MotionCell) => `MOTION:${c.url}`

  it('motion이 없거나 재생성·재시도면 GIF를 만들지 않고 정지 컷 그대로', async () => {
    const build = vi.fn()
    expect(await motionOrStill(undefined, false, build, toEntry, still())).toEqual({ entry: 'STILL', costUsd: 0.05 })
    expect(await motionOrStill(gifTask, true, build, toEntry, still())).toEqual({ entry: 'STILL', costUsd: 0.05 })
    expect(build).not.toHaveBeenCalled()
  })

  it('칸을 만들면 그 entry, 못 만들면 정지 컷 + 쓴 비용, 예외면 경고 남기고 정지 컷(던지지 않는다)', async () => {
    const s1 = still()
    expect(await motionOrStill(gifTask, false, async () => ({ cell, costUsd: 0.2, reasons: [] }), toEntry, s1)).toEqual({ entry: 'MOTION:P', costUsd: 0.2 })
    expect(s1).not.toHaveBeenCalled()
    const warn = vi.fn()
    expect(await motionOrStill(gifTask, false, async () => ({ cell: null, costUsd: 0.2, reasons: ['GIF 실패: x'] }), toEntry, still(), warn)).toEqual({ entry: 'STILL', costUsd: 0.25 })
    expect(warn).toHaveBeenLastCalledWith('GIF 칸을 못 만들어 정지 컷으로 — GIF 실패: x')
    expect(await motionOrStill(gifTask, false, async () => Promise.reject(new Error('boom')), toEntry, still(), warn)).toEqual({ entry: 'STILL', costUsd: 0.05 })
    expect(warn).toHaveBeenLastCalledWith('GIF 칸 예외로 정지 컷으로 — boom')
  })

  it('재생성·재시도 맥락은 편집기·게이트 재생성·각도·글자 자리·오류 재시도 모두다', () => {
    expect(isMotionRedo({})).toBe(false)
    for (const flags of [{ editorRegen: {} }, { regenScore: {} }, { angleOf: 'x' }, { copyZoneRetry: {} }, { errorRetry: true }]) expect(isMotionRedo(flags)).toBe(true)
  })
})

describe('내려서 만든 칸의 까닭 경고(세션 B ③ P4 확인 — K5 P06·P08)', () => {
  const still = () => vi.fn(async () => ({ entry: 'STILL', costUsd: 0.05 }))
  const toEntry = (c: MotionCell) => `MOTION:${c.url}:${c.motion.status}`
  const cellOf = (motion: Partial<MotionCell['motion']>): MotionCell => ({
    url: 'P',
    costUsd: 0.14,
    motion: { path: 'gpt26-ref', status: 'ok', width: 780, height: 780, frames: 9, durationMs: 1800, bytes: 1, quality: 80, loop: 'plain', ...motion },
  })

  it('까닭 한 줄: 포스터는 늘, 옵션 밀기는 GIF에서 내려왔을 때만, 그대로 된 칸은 없음', () => {
    expect(motionFallbackNote({ path: 'gpt26-ref', status: 'poster' }, ['GIF 칸 예산 초과(q80 800KB → q70 720KB → poster)'])).toBe(
      'GIF 칸을 포스터 한 장으로(GIF 첫 프레임) — GIF 칸 예산 초과(q80 800KB → q70 720KB → poster)',
    )
    expect(motionFallbackNote({ path: 'stills-slide', status: 'poster' }, [])).toBe('GIF 칸을 포스터 한 장으로(첫 옵션 사진) — 까닭 기록 없음')
    expect(motionFallbackNote({ path: 'stills-slide', status: 'ok' }, ['GIF 실패: x'])).toBe('GIF 칸을 옵션 밀기로 — GIF 실패: x')
    expect(motionFallbackNote({ path: 'gpt26-ref', status: 'ok' }, [])).toBeNull()
    expect(motionFallbackNote({ path: 'stills-slide', status: 'ok' }, [])).toBeNull()
  })

  it('motionOrStill은 내려서 만든 칸이면 경고를 남기고, entry·비용은 지금 그대로다(정지 컷을 부르지 않는다)', async () => {
    const warn = vi.fn()
    const s = still()
    const poster = await motionOrStill(gifTask, false, async () => ({ cell: cellOf({ status: 'poster' }), costUsd: 0.14, reasons: ['GIF 칸 예산 초과(q80 → q70 → poster)'] }), toEntry, s, warn)
    expect(poster).toEqual({ entry: 'MOTION:P:poster', costUsd: 0.14 })
    expect(warn).toHaveBeenLastCalledWith('GIF 칸을 포스터 한 장으로(GIF 첫 프레임) — GIF 칸 예산 초과(q80 → q70 → poster)')
    const slid = await motionOrStill(gifTask, false, async () => ({ cell: cellOf({ path: 'stills-slide' }), costUsd: 0, reasons: ['GIF 실패: OpenAI 500'] }), toEntry, s, warn)
    expect(slid).toEqual({ entry: 'MOTION:P:ok', costUsd: 0 })
    expect(warn).toHaveBeenLastCalledWith('GIF 칸을 옵션 밀기로 — GIF 실패: OpenAI 500')
    expect(s).not.toHaveBeenCalled()

    const quiet = vi.fn()
    expect(await motionOrStill(gifTask, false, async () => ({ cell: cellOf({}), costUsd: 0.14, reasons: [] }), toEntry, still(), quiet)).toEqual({ entry: 'MOTION:P:ok', costUsd: 0.14 })
    expect(quiet).not.toHaveBeenCalled()
  })

  it('buildMotionCell과 이어서 — GIF가 실패해 옵션 밀기로 가면 실행 로그에 그 까닭이 남는다', async () => {
    const warn = vi.fn()
    const deps = depsOf({ generateGif: vi.fn(async () => Promise.reject(new Error('OpenAI 500'))) }).deps
    const out = await motionOrStill(withPhotos(gifTask), false, (m) => buildMotionCell(m, 'BASE', deps), (c) => c.motion.path, still(), warn)
    expect(out).toEqual({ entry: 'stills-slide', costUsd: 0 })
    expect(warn).toHaveBeenCalledWith('GIF 칸을 옵션 밀기로 — GIF 실패: OpenAI 500')
    const ok = vi.fn()
    await motionOrStill(gifTask, false, (m) => buildMotionCell(m, 'BASE', depsOf().deps), (c) => c.motion.status, still(), ok)
    expect(ok).not.toHaveBeenCalled()
  })
})

/** 780² 잡음 PNG(같은 seed면 같은 바이트) — 밀기 칸 WebP가 칸 예산 0.7MB를 넘게 만든다 */
function noisePng(seed: number): Promise<Buffer> {
  const side = 780
  const raw = Buffer.alloc(side * side * 3)
  let s = seed
  for (let i = 0; i < raw.length; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    raw[i] = s >>> 24
  }
  return sharp(raw, { raw: { width: side, height: side, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer()
}

describe('GIF 시트 400(K5 P04 재발 막기, 세션 B ③ P6)', () => {
  const SHEET_400 =
    "OpenAI 이미지 생성 실패(400): No supported sheet fits 9 GIF frames at size '1024x1024'. Invalid size '3072x3072'. Requested resolution exceeds the current pixel budget."
  const sheet400 = () => vi.fn(async () => Promise.reject(new Error(SHEET_400)))
  const SHEET_REASON = /^GIF 실패: OpenAI 이미지 생성 실패\(400\): No supported sheet fits 9 GIF frames/

  it('GIF 요청은 768²×9 — 3×3 시트 2,304²라 시트 한도 안(1024²면 막힌다)', () => {
    expect(MOTION_GIF).toMatchObject({ size: '768x768', frameCount: 9 })
    expect(gifSheetOf(MOTION_GIF.size, MOTION_GIF.frameCount)).toEqual({ width: 2304, height: 2304 })
    expect(animationRequestError('gpt-image-2.6-sunburst', MOTION_GIF, MOTION_GIF.size)).toBeNull()
    expect(animationRequestError('gpt-image-2.6-sunburst', MOTION_GIF, '1024x1024')).toMatch(/^GIF 시트 3072x3072/)
  })

  it('400 시트 오류면 옵션 밀기(ok) → 밀기 포스터(칸 예산 초과) → null(정지 컷) 순으로 내려가고 GIF 비용은 0', async () => {
    const slid = await buildMotionCell(withPhotos(gifTask), 'BASE', depsOf({ generateGif: sheet400() }).deps)
    expect(slid.cell?.motion).toMatchObject({ path: 'stills-slide', status: 'ok', width: 780, height: 780 })
    expect(slid.cell!.motion.reason).toMatch(SHEET_REASON)
    expect(slid.costUsd).toBe(0)

    const noisy = depsOf({ generateGif: sheet400(), fetchPhoto: vi.fn(async (url: string) => noisePng(url.endsWith('a.jpg') ? 1 : 2)) })
    const poster = await buildMotionCell(withPhotos(gifTask), 'BASE', noisy.deps)
    expect(poster.cell?.motion).toMatchObject({ path: 'stills-slide', status: 'poster', frames: 1, durationMs: 0, loop: 'plain' })
    expect(poster.cell!.motion.webpUrl).toBeUndefined()
    expect(poster.cell!.motion.reason).toMatch(/옵션 밀기 칸 예산 초과\(q80 .+ → q70 .+ → poster\)$/)
    expect(noisy.uploads.map((u) => `${u.kind}:${u.mime}`)).toEqual(['poster:image/jpeg'])
    expect(poster.costUsd).toBe(0)

    const none = await buildMotionCell(gifTask, 'BASE', depsOf({ generateGif: sheet400() }).deps)
    expect(none.cell).toBeNull()
    expect(none.costUsd).toBe(0)
    expect(none.reasons).toHaveLength(1)
    expect(none.reasons[0]).toMatch(SHEET_REASON)
  }, 60_000)

  it('이미지 단계는 null이면 경고를 남기고 정지 컷으로 간다 — K5 P04 실잡 로그와 같은 꼴, 부르기 전 시트 오류도 같은 길', async () => {
    const still = vi.fn(async () => ({ entry: 'STILL', costUsd: 0.05 }))
    const warn = vi.fn()
    const deps = depsOf({ generateGif: sheet400() }).deps
    const out = await motionOrStill(gifTask, false, (m) => buildMotionCell(m, 'BASE', deps), (c) => c.url, still, warn)
    expect(out).toEqual({ entry: 'STILL', costUsd: 0.05 })
    expect(warn).toHaveBeenLastCalledWith(expect.stringMatching(/^GIF 칸을 못 만들어 정지 컷으로 — GIF 실패: OpenAI 이미지 생성 실패\(400\): No supported sheet/))

    const preflight = new Error(animationRequestError('gpt-image-2.6-sunburst', MOTION_GIF, '1024x1024') ?? '')
    const blocked = await buildMotionCell(gifTask, 'BASE', depsOf({ generateGif: vi.fn(async () => Promise.reject(preflight)) }).deps)
    expect(blocked).toEqual({ cell: null, costUsd: 0, reasons: [`GIF 실패: ${preflight.message}`.slice(0, 'GIF 실패: '.length + 200)], sentPrompt: gifPromptOf('BASE', gifTask) })
  })
})

describe('GIF 칸 entry의 일반 게이트(통합 검토 ②)', () => {
  it('motion이 있는 entry는 일반 게이트·쌍·글자 자리를 건너뛰는 skip, 없으면 null(지금 게이트 그대로)', () => {
    expect(motionGateSkip({ motion: { path: 'gpt26-ref' } })).toEqual({ verdict: 'skip', unjudged: MOTION_GATE_NOTE, costUsd: 0 })
    expect(motionGateSkip({})).toBeNull()
  })
})
