/**
 * GIF 칸(움직이는 띠 motion_band) 프레임 엮기 — 순수 함수(sharp·네트워크 없음). 오너 2026-11-05 22:45 "GIF 칸 … 컨셉도 확실히".
 * 설계: 세션 B work/pdp-b/gif/DESIGN.md 4-1·4-2·4-3·0-1절(무료 실측 근거).
 * - 고리 규칙은 동작 종류로 나눈다:
 *   · 오가는 동작(돌기·접기 펴기·빗질) — 고리가 안 맞으면(고리 비율 > 2.5) 왕복(1→N→2)으로 엮는다
 *   · 끝 모습이 결과인 동작(착용·조립·붙이기) — 왕복하면 '벗기'처럼 보여 마지막 프레임을 머물게 한 뒤 처음으로 돌아간다(≥ 800ms)
 * - 옵션 칸은 오너 옵션 사진을 밀기 전환(천천히-빠르게-천천히)으로 엮는다. 알파 섞기는 두 옵션 글자가 겹쳐 쓰지 않는다(4-1절).
 * - 판독(깜빡임·고리·밝기)은 4절 기준과 같은 식이다. 자동 판독은 글자 겹침·이중 노출·끊김을 못 잡는다(4-1·4-4절) — 전환 규칙으로 막는다.
 * 프레임은 RGB 원시 버퍼(폭×높이×3)다.
 */

export type LoopKind = 'pingpong' | 'hold' | 'plain'

export interface FrameSet {
  frames: Buffer[]
  /** 프레임별 지연(ms) */
  delays: number[]
  width: number
  height: number
}

export const LOOP_RULES = Object.freeze({
  /** 이음새(끝→첫) 차 ÷ 이웃 프레임 차 중앙값이 이보다 크면 고리가 끊긴 것 — 오가는 동작은 왕복으로 다시 엮는다 */
  seamRatioMax: 2.5,
  /** 끝 모습이 결과인 동작의 마지막 프레임 머무름 */
  holdMs: 1000,
  holdMinMs: 800,
  /** 깜빡임: 이웃 차 최대 > 중앙값 × 3 이면서 > 0.08 */
  flickerRatioMax: 3,
  flickerAbsMin: 0.08,
  /** 프레임 평균 밝기 변화(0~255) — 참조 GIF에만(옵션 밀기는 배경색이 다른 옵션 사이 바뀜이 의도된 것) */
  brightnessJumpMax: 8,
  maxFrames: 64,
  minTotalMs: 1500,
  maxTotalMs: 6000,
})

/** 왕복 1→N→2 — 끝·처음 프레임은 한 번만(N 프레임이면 2N-2장) */
export function pingpong(set: FrameSet): FrameSet {
  if (set.frames.length < 3) return set
  const back = (a: number[] | Buffer[]) => a.slice(1, -1).reverse()
  return { ...set, frames: [...set.frames, ...(back(set.frames) as Buffer[])], delays: [...set.delays, ...(back(set.delays) as number[])] }
}

/** 마지막 프레임 머무름 — 지연만 늘리고 프레임은 그대로(용량이 거의 같다) */
export function holdLast(set: FrameSet, holdMs: number = LOOP_RULES.holdMs): FrameSet {
  if (set.frames.length === 0) return set
  const delays = set.delays.slice()
  delays[delays.length - 1] = Math.max(delays[delays.length - 1] ?? 0, holdMs)
  return { ...set, delays }
}

export interface SlideOptions {
  /** 옵션 한 장 머무름 */
  holdMs: number
  /** 두 옵션 사이 밀기 프레임 수 */
  between: number
  betweenMs: number
}

/** 옵션 밀기 기본 — 3×70(28프레임 5.7초 q80 557KB, 0-1-4절). 8×40은 1.26MB라 칸 예산을 넘는다 */
export const SLIDE_DEFAULTS: Readonly<SlideOptions> = Object.freeze({ holdMs: 600, between: 3, betweenMs: 70 })

/** 같은 크기 사진들(RGB) → 밀기 전환 프레임. 마지막 사진 뒤에 첫 사진으로 밀려 고리가 이어진다 */
export function slideFrames(images: Buffer[], width: number, height: number, opts: SlideOptions = SLIDE_DEFAULTS): FrameSet {
  const row = width * 3
  const frames: Buffer[] = []
  const delays: number[] = []
  for (let i = 0; i < images.length; i++) {
    const a = images[i]
    const b = images[(i + 1) % images.length]
    frames.push(a)
    delays.push(opts.holdMs)
    if (images.length < 2) continue
    for (let k = 1; k <= opts.between; k++) {
      const t = k / (opts.between + 1)
      const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t) // 천천히-빠르게-천천히
      const off = Math.round(e * width)
      const m = Buffer.alloc(a.length)
      for (let y = 0; y < height; y++) {
        a.copy(m, y * row, y * row + off * 3, (y + 1) * row) // a는 왼쪽으로 off만큼 밀린다
        b.copy(m, y * row + (width - off) * 3, y * row, y * row + off * 3) // b는 오른쪽에서 들어온다
      }
      frames.push(m)
      delays.push(opts.betweenMs)
    }
  }
  return { frames, delays, width, height }
}

export interface LoopMetrics {
  frames: number
  totalMs: number
  diffMedian: number
  flickerRatio: number
  seamRatio: number
  brightnessJump: number
}

function grey(frame: Buffer): Float64Array {
  const g = new Float64Array(frame.length / 3)
  for (let p = 0, q = 0; q < g.length; p += 3, q++) g[q] = (0.299 * frame[p] + 0.587 * frame[p + 1] + 0.114 * frame[p + 2]) / 255
  return g
}

/** 4절 판독값 — 이웃 프레임 평균 절대차·깜빡임 비율·고리 비율·최대 밝기 변화(0~255) */
export function loopMetrics(set: FrameSet): LoopMetrics {
  const g = set.frames.map(grey)
  const meanOf = (a: Float64Array) => a.reduce((s, x) => s + x, 0) / a.length
  const diff = (x: Float64Array, y: Float64Array) => {
    let s = 0
    for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i])
    return s / x.length
  }
  const d: number[] = []
  for (let i = 1; i < g.length; i++) d.push(diff(g[i - 1], g[i]))
  const sorted = [...d].sort((a, b) => a - b)
  const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
  const seam = g.length > 1 ? diff(g[g.length - 1], g[0]) : 0
  const means = g.map(meanOf)
  let jump = 0
  for (let i = 1; i < means.length; i++) jump = Math.max(jump, Math.abs(means[i] - means[i - 1]))
  return {
    frames: set.frames.length,
    totalMs: set.delays.reduce((s, x) => s + x, 0),
    diffMedian: med,
    flickerRatio: med > 0 ? Math.max(...d) / med : 0,
    seamRatio: med > 0 ? seam / med : 0,
    brightnessJump: jump * 255,
  }
}

export type LoopProblem = 'flicker' | 'seam' | 'brightness' | 'too_many_frames' | 'too_short' | 'too_long' | 'no_hold'

/** 4절 형식·판독 검사 — 문제 목록(빈 목록이면 통과). kind는 엮은 뒤의 고리 종류, source는 참조 GIF(gif)·옵션 밀기(slide) */
export function loopProblems(set: FrameSet, kind: LoopKind, source: 'gif' | 'slide'): LoopProblem[] {
  const m = loopMetrics(set)
  const R = LOOP_RULES
  const out: LoopProblem[] = []
  const maxDiff = m.diffMedian * m.flickerRatio
  if (m.flickerRatio > R.flickerRatioMax && maxDiff > R.flickerAbsMin) out.push('flicker')
  if (kind !== 'hold' && m.seamRatio > R.seamRatioMax) out.push('seam') // 머무름 고리의 끝→처음은 의도된 되감기
  if (kind === 'hold' && (set.delays[set.delays.length - 1] ?? 0) < R.holdMinMs) out.push('no_hold')
  if (source === 'gif' && m.brightnessJump > R.brightnessJumpMax) out.push('brightness')
  if (m.frames > R.maxFrames) out.push('too_many_frames')
  if (m.totalMs < R.minTotalMs) out.push('too_short')
  if (m.totalMs > R.maxTotalMs) out.push('too_long')
  return out
}

/**
 * 참조 GIF 고리 엮기 — 동작 종류(칸이 정한다)대로:
 * hold면 마지막 프레임 머무름, 오가는 동작은 그대로 두되 고리가 끊기면 왕복으로 바꾼다.
 */
export function loopForMotion(set: FrameSet, motion: 'back_and_forth' | 'ends_in_result'): { set: FrameSet; kind: LoopKind } {
  if (motion === 'ends_in_result') return { set: holdLast(set), kind: 'hold' }
  return loopMetrics(set).seamRatio > LOOP_RULES.seamRatioMax ? { set: pingpong(set), kind: 'pingpong' } : { set, kind: 'plain' }
}

/**
 * 프레임 줄이기 — keepEvery장마다 한 장(첫 장·마지막 장은 늘 남긴다). 뺀 프레임의 지연은 앞에 남긴 프레임에 더해 전체 길이가 같다.
 * 줄일 게 없으면(3장 미만이거나 줄어들지 않으면) 그대로 돌려준다
 */
export function thinFrames(set: FrameSet, keepEvery = 2): FrameSet {
  const n = set.frames.length
  if (n < 3 || keepEvery < 2) return set
  const keep = [...Array(n).keys()].filter((i) => i % keepEvery === 0 || i === n - 1)
  if (keep.length >= n) return set
  const delays = keep.map((k, j) => set.delays.slice(k, j + 1 < keep.length ? keep[j + 1] : n).reduce((sum, d) => sum + d, 0))
  return { ...set, frames: keep.map((k) => set.frames[k]), delays }
}

/**
 * GIF 칸 예산 사다리의 엮기 후보(세션 B ③, 통합 05:1x 권장안) — 칸 예산을 넘으면 이 순서로 해 본다:
 *   ① 원래 고리(loopForMotion) ② 왕복이었으면 왕복 대신 머무름(끝 프레임 유지) ③ 프레임 줄이기(②까지의 마지막 고리 꼴 그대로)
 * q70은 encodeBandLadder가 마지막 후보에만 쓴다. 같은 꼴이 겹치면 뺀다
 */
export function motionLadderOf(set: FrameSet, motion: 'back_and_forth' | 'ends_in_result'): Array<{ set: FrameSet; kind: LoopKind }> {
  const first = loopForMotion(set, motion)
  const out = [first]
  if (first.kind === 'pingpong') out.push({ set: holdLast(set), kind: 'hold' })
  const last = out[out.length - 1]
  const thin = thinFrames(set)
  if (thin.frames.length < set.frames.length) out.push({ set: last.kind === 'hold' ? holdLast(thin) : thin, kind: last.kind })
  return out
}
