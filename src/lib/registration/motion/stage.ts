/**
 * GIF 칸 생성(세션 B ③ P3, 설계 DESIGN 0·1-2·4절) — 이미지 단계가 task.motion이 있는 컷을 여기로 넘긴다.
 *   gif:   2.6 참조 GIF(호출 상한은 run 남은 시간) → 3×3 프레임 모음 검사(글자 반전·상품 일치) → 고리 엮기 → 780 WebP(칸 0.7MB 내림) + 포스터 JPEG
 *   slide: 실물 옵션 사진 밀기(3×70) → 같은 인코딩
 * 실패·시간 부족·검사 탈락·예산 초과는 옵션 밀기 → 포스터 한 장으로 내려가고 잡을 막지 않는다(이 함수는 던지지 않는다). GIF 프레임도 옵션 사진도 없으면 null —
 * 부르는 쪽이 지금처럼 정지 컷을 만든다. 기록 꼴은 C와 정한 SectionMotion 그대로다. 외부 호출은 deps로만 한다(시험은 가짜).
 */

import type { VisionImage } from '@/lib/agents/registration/thumbnail-vision-agent'
import type { SectionMotion } from '../pdp-state'
import { DHASH_TWIN_MAX, dHashDistance, dHashOf } from '../shot-composition'
import { motionLadderOf, slideFrames, type FrameSet, type LoopKind } from './assemble'
import { encodeBandLadder, encodeMotionBand, frameSheet, MOTION_ENCODE, photoFrame, posterJpeg, type MotionEncodeResult } from './encode'
import { frameHeightOf, gifSheetEngine, type MotionEngine } from './engine'
import { CORRECT_USE_LINE } from '../templatelib/handling-facts'
import type { MotionTask } from './task'

/**
 * GIF 요청 — 9프레임 × 200ms(1.8초, 설계 4절 실측 꼴), 프레임 768², 하네스 GIF 정책 상한 300초.
 * 768²×9 = 3×3 시트 2,304²가 실측으로 된 값이다(설계 2절). 1024²×9는 시트 3,072²라 400이 났다(K5 P04, 세션 B ③ P6) —
 * 크기·프레임 수를 바꾸면 GIF_SHEET_MAX_PIXELS(animationRequestError)가 부르기 전에 막는다. 780 폭으로 늘리는 건 decodeGif가 한다
 */
export const MOTION_GIF = Object.freeze({ frameCount: 9, frameDurationMs: 200, size: '768x768' as const, maxCallMs: 300_000, minCallMs: 60_000 })
/** GIF 호출 뒤에 남겨 둘 시간 — 인코딩·업로드 25초 + 프레임 모음 검사 40초 + 저장 여유 15초 */
export const MOTION_AFTER_CALL_MS = 80_000
/** motion 태스크를 시작할 최소 남은 시간 — 참조 받기 15초 + GIF 최소 60초 + 호출 뒤 80초. 모자라면 다음 run으로 미룬다 */
export const MOTION_START_MIN_MS = 15_000 + MOTION_GIF.minCallMs + MOTION_AFTER_CALL_MS

/** 이 run에서 GIF 호출에 줄 시간 — 모자라면 0(GIF를 부르지 않고 옵션 밀기·포스터로 내려간다) */
export function gifTimeoutOf(elapsedMs: number, budgetMs: number): number {
  const left = budgetMs - elapsedMs - MOTION_AFTER_CALL_MS
  return left < MOTION_GIF.minCallMs ? 0 : Math.min(left, MOTION_GIF.maxCallMs)
}

/** motion 태스크를 지금 시작해도 되나(이미지 풀 canStart) — 정지 컷 셈(GENERATION_WORST_MS)과 따로 센다 */
export const motionCanStart = (elapsedMs: number, budgetMs: number): boolean => budgetMs - elapsedMs >= MOTION_START_MIN_MS

/** 보여 줄 동작을 실은 칸(beatShown)의 크기 줄 — 폰 화면에서 동작이 읽히게 */
export const MOTION_BEAT_SIZE_LINE = 'Make this action large and clear enough to read at phone size — a full, visible movement, not a slight wobble.'

/** GIF 지시 — 기존 컷 프롬프트 뒤에 동작·고리·글자 지키기 줄을 붙인다(그리지 않는 참고 글) */
export function gifPromptOf(base: string, task: Pick<MotionTask, 'action' | 'loop' | 'role' | 'beatShown'>): string {
  const loop =
    task.loop === 'ends_in_result'
      ? 'The motion ends in its result state; the last frame shows the finished state clearly.'
      : 'The motion is a smooth back-and-forth; the last frame returns close to the first frame.'
  return [
    base,
    '',
    'ANIMATION (do not render this text):',
    `- Show this one action with the exact product from the reference photos: ${task.action}`,
    // 보여 줄 동작·설계(showbeat 잡, J63) — J59 켬 '두피를 문지르는 모습' 칸이 작은 흔들림으로 끝났다. 다른 칸은 줄이 없다(지금 그대로)
    ...(task.beatShown ? [`- ${MOTION_BEAT_SIZE_LINE}`] : []),
    // 실물 쓰는 법 그대로(오너 11-05 지적: 빗을 반대로 쥔 빗질, 세션 B ③ P5)
    // 정지 손·몸 컷과 같은 글(templatelib/handling-facts CORRECT_USE_LINE, 점검 고침 3) — 바이트 그대로
    `- ${CORRECT_USE_LINE}`,
    `- ${loop}`,
    '- Keep the same camera, framing, lighting and background in every frame. Only the product and hands move.',
    '- Keep every printed letter, number and logo on the product exactly as in the reference — never mirrored, never invented.',
    // 대표 칸(움직이는 칸 자리 규칙 ①) — 첫 프레임만 보여도 대표 컷 구실을 하게. 대표 칸이 아니면 줄이 없다(지금 그대로)
    ...(task.role === 'hero'
      ? ['- Frame 1 must reproduce the LAST attached image (the hero image) exactly: same composition, framing, product position and size, background and light. Later frames add only the small motion.']
      : []),
  ].join('\n')
}

export interface MotionDeps {
  /** 2.6 참조 GIF 한 번(편집 엔드포인트, 상품 실물 사진 첨부) — 실패는 던진다. timeoutMs는 호출 상한, size는 1:1이 아닌 칸의 프레임 크기(1:1은 넘기지 않는다) */
  generateGif: (prompt: string, timeoutMs: number, size?: string) => Promise<{ base64: string; costUsd: number }>
  /** 움직임 엔진(motion/engine.ts) — 없으면 generateGif를 감싼 gif-sheet(지금 경로 그대로) */
  engine?: MotionEngine
  /** 실물 옵션 사진 받기 — 못 받으면 null(그 사진은 뺀다) */
  fetchPhoto: (url: string) => Promise<Buffer | null>
  /** 3×3 프레임 모음 검사(글자 반전·새 글자·상품 불일치) — pass false면 탈락, null이면 채점 실패(통과로 본다, 게이트와 같은 규칙) */
  judgeSheet: (sheet: Buffer, action: string) => Promise<{ pass: boolean; reason: string; costUsd?: number } | null>
  /** 업로드 — 공개 URL을 돌려준다 */
  upload: (kind: 'motion' | 'poster' | 'gif', bytes: Buffer, mimeType: string) => Promise<string>
  /** run 시작부터 지난 시간과 run 예산 */
  elapsedMs: () => number
  budgetMs: number
}

export interface MotionCell {
  /** section_images[].url — 포스터 JPEG(편집기 미리보기·대체용) */
  url: string
  motion: SectionMotion
  costUsd: number
}

/** 칸 결과 — cell이 null이면 부르는 쪽이 정지 컷을 만든다. 그때도 이미 쓴 GIF 비용(costUsd)과 까닭(reasons)은 남긴다 */
export interface MotionOutcome {
  cell: MotionCell | null
  costUsd: number
  reasons: string[]
  /** 움직임 엔진에 실제로 넘긴 프롬프트(점검 고침 0) — GIF를 부르지 않았으면(옵션 밀기만·시간 부족) 없다 */
  sentPrompt?: string
}

const durationOf = (set: FrameSet) => set.delays.reduce((sum, d) => sum + d, 0)
const LOOP_LABEL: Record<LoopKind, string> = { pingpong: '왕복', hold: '머무름', plain: '고리' }
/** 사다리 까닭 글의 엮기 이름 — 예: '왕복 16프레임' */
const loopLabelOf = (c: { set: FrameSet; kind: LoopKind }) => `${LOOP_LABEL[c.kind]} ${c.set.frames.length}프레임`
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200)

interface Encoded {
  path: SectionMotion['path']
  set: FrameSet
  loop: LoopKind
  encoded: MotionEncodeResult
  gif?: Buffer
}

async function uploadCell(deps: MotionDeps, cell: Encoded, reasons: string[], costUsd: number, posterUrl?: string): Promise<MotionCell> {
  const { encoded, set } = cell
  // 대표 칸은 포스터가 정지 대표 컷 그대로다(올리지 않는다) — 내보내기가 그 URL 자리에 움직이는 WebP를 바꿔 넣는다
  const url = posterUrl ?? (await deps.upload('poster', encoded.poster, 'image/jpeg'))
  const ok = encoded.status === 'ok' && encoded.webp
  const webpUrl = ok ? await deps.upload('motion', encoded.webp!, 'image/webp') : undefined
  // 원본 GIF는 기록용이다 — 못 올려도 움직이는 WebP 칸은 그대로 두고 까닭만 남긴다(전에는 칸 전체가 포스터로 내려갔다)
  let gifUrl: string | undefined
  if (ok && cell.gif) {
    try {
      gifUrl = await deps.upload('gif', cell.gif, 'image/gif')
    } catch (e) {
      reasons.push(`원본 GIF 올리기 실패(움직이는 WebP는 그대로): ${errorText(e)}`)
    }
  }
  return {
    url,
    costUsd,
    motion: {
      path: cell.path,
      status: ok ? 'ok' : 'poster',
      ...(webpUrl ? { webpUrl } : {}),
      ...(gifUrl ? { gifUrl } : {}),
      width: set.width,
      height: set.height,
      frames: encoded.frames,
      durationMs: ok ? durationOf(set) : 0,
      bytes: encoded.bytes,
      quality: encoded.quality,
      loop: ok ? cell.loop : 'plain',
      ...(reasons.length > 0 ? { reason: reasons.join(' · ') } : {}),
    },
  }
}

async function slideSet(task: MotionTask, deps: MotionDeps, reasons: string[]): Promise<FrameSet | null> {
  if (task.optionPhotos.length < 2) return null
  const photos = (await Promise.all(task.optionPhotos.map((url) => deps.fetchPhoto(url).catch(() => null)))).filter((b): b is Buffer => b !== null)
  if (photos.length < 2) {
    reasons.push(`옵션 사진 받기 ${photos.length}/${task.optionPhotos.length}`)
    return null
  }
  const width = MOTION_ENCODE.width
  // 고른 칸(pick)은 그 칸 비율로 — 1:1(지금 motion_band)은 폭 그대로
  const height = frameHeightOf(task.aspect ?? '1:1', width) ?? width
  const frames = await Promise.all(photos.map((p) => photoFrame(p, width, height)))
  return slideFrames(frames, width, height)
}

/** 대표 칸 포스터 — 정지 대표 컷(URL·받은 그림). 첫 프레임 검사와 포스터 자리에 쓴다 */
export interface MotionPoster {
  url: string
  image: VisionImage
}

/**
 * 대표 칸 첫 프레임 ↔ 정지 대표 컷 구도 거리 상한 — 같은 페이지 구도 쌍 판정(shot-composition DHASH_TWIN_MAX, '같은 구도로 본다')과 같은 값.
 * 2.6 GIF가 첫 프레임을 지키는지는 아직 유료로 재지 않았다(미확인)
 */
export const HERO_FIRST_FRAME_MAX = DHASH_TWIN_MAX

/** 첫 프레임이 대표 컷과 다르면 까닭 — 지문을 못 내면 null(통과로 본다, 프레임 검사와 같은 규칙) */
async function firstFrameMismatch(frames: FrameSet, still: VisionImage): Promise<string | null> {
  const [a, b] = await Promise.all([posterJpeg(frames, 0).then((jpeg) => dHashOf(jpeg.toString('base64'))), dHashOf(still.data)])
  if (!a || !b) return null
  const distance = dHashDistance(a, b)
  return distance > HERO_FIRST_FRAME_MAX ? `첫 프레임이 대표 컷과 다름(구도 거리 ${distance} > ${HERO_FIRST_FRAME_MAX})` : null
}

/**
 * 칸 하나 예산 — 대표 칸은 heroMaxBytes(0.7MB, 결정 카드 c13), 사용 동작(use)으로 고른 칸은 useMaxBytes(1.5MB, 오너 decide 35·J55),
 * 그 밖(transform·assemble·scale 고른 칸·옵션 밀기·motion_band 띠)은 maxBytes(0.7MB). 셋의 합은 페이지 3MB 안이다(움직이는 칸 자리 규칙 ③)
 */
export const cellMaxBytesOf = (task: Pick<MotionTask, 'role' | 'useCell'>): number =>
  task.role === 'hero' ? MOTION_ENCODE.heroMaxBytes : task.useCell ? MOTION_ENCODE.useMaxBytes : MOTION_ENCODE.maxBytes

/** 대표 칸을 움직이지 못했을 때의 기록 — 정지 대표 컷이 포스터(움직임 없음, 올린 파일 없음). 내보내기는 ok 칸만 바꿔 넣는다 */
export function heroPosterMotion(reasons: readonly string[], set?: FrameSet | null): SectionMotion {
  return {
    path: 'gpt26-ref',
    status: 'poster',
    width: set?.width ?? 0,
    height: set?.height ?? 0,
    frames: 1,
    durationMs: 0,
    bytes: 0,
    quality: null,
    loop: 'plain',
    ...(reasons.length > 0 ? { reason: reasons.join(' · ') } : {}),
  }
}

/** 엔진이 프레임을 못 내고 던질 때 이미 쓴 비용(gif-sheet 디코드 실패 등) */
const spentOf = (e: unknown) => (e && typeof e === 'object' && typeof (e as { costUsd?: unknown }).costUsd === 'number' ? (e as { costUsd: number }).costUsd : 0)

/**
 * GIF 칸 하나 — 포스터 URL + SectionMotion. 내려가는 순서: GIF(ok) → 옵션 밀기(ok) → 포스터(GIF 첫 프레임 또는 첫 옵션 사진) → null.
 * reason에는 내려간 까닭을 모두 남긴다(예: 'GIF 실패: … · 옵션 사진 받기 1/2').
 */
export async function buildMotionCell(task: MotionTask, basePrompt: string, deps: MotionDeps, poster?: MotionPoster): Promise<MotionOutcome> {
  const reasons: string[] = []
  let costUsd = 0
  let sentPrompt: string | undefined
  const done = (cell: MotionCell): MotionOutcome => ({ cell, costUsd: cell.costUsd, reasons, ...(sentPrompt ? { sentPrompt } : {}) })
  let gifFrames: FrameSet | null = null
  // 대표 칸 — 정지 대표 컷이 포스터이자 첫 프레임 기준이다(그 밖의 칸은 지금 그대로)
  const hero = task.role === 'hero' ? poster : undefined
  if (task.mode === 'gif') {
    const timeoutMs = gifTimeoutOf(deps.elapsedMs(), deps.budgetMs)
    if (timeoutMs === 0) reasons.push('GIF 시간 부족')
    else {
      try {
        const engine = deps.engine ?? gifSheetEngine(deps)
        const aspect = task.aspect ?? '1:1'
        const input = { prompt: gifPromptOf(basePrompt, task), action: task.action, loop: task.loop, aspect, timeoutMs, ...(hero ? { still: hero.image } : {}) }
        sentPrompt = input.prompt
        const out = await engine.make(input).catch((e: unknown) => {
          costUsd += spentOf(e)
          throw e
        })
        if (!out) throw new Error(`엔진 ${engine.id}이 ${aspect} 칸을 만들지 않음`)
        costUsd += out.costUsd
        const gif = out.meta.source?.bytes
        gifFrames = out.frames
        const verdict = await deps.judgeSheet(await frameSheet(gifFrames), task.action).catch(() => null)
        costUsd += verdict?.costUsd ?? 0
        const firstFrame = hero ? await firstFrameMismatch(gifFrames, hero.image).catch(() => null) : null
        if (verdict && !verdict.pass) reasons.push(`검사 탈락: ${verdict.reason}`)
        else if (firstFrame) reasons.push(`검사 탈락: ${firstFrame}`)
        else {
          // 칸 예산 사다리 — 원래 고리 → (왕복이면) 머무름 → 프레임 줄이기를 q80으로, 마지막 것만 q70, 그래도 넘으면 포스터. 칸 예산은 cellMaxBytesOf
          const ladder = motionLadderOf(gifFrames, task.loop)
          const encoded = await encodeBandLadder(
            ladder.map((c) => c.set),
            { maxBytes: cellMaxBytesOf(task) },
          )
          if (encoded.status === 'ok' && encoded.pick !== null) {
            const { set, kind } = ladder[encoded.pick]
            // 사다리를 내려갔으면(첫 후보 q80이 아니면) 까닭을 남긴다 — 이미지 단계 경고(motionFallbackNote)로 보인다
            if (encoded.steps.length > 1) reasons.push(`칸 예산으로 ${loopLabelOf(ladder[0])} 대신 ${loopLabelOf(ladder[encoded.pick])}(${encoded.steps.join(' → ')})`)
            return done(await uploadCell(deps, { path: 'gpt26-ref', set, loop: kind, encoded, gif }, reasons, costUsd, hero?.url))
          }
          reasons.push(`GIF 칸 예산 초과(${encoded.steps.join(' → ')})`)
        }
      } catch (e) {
        reasons.push(`GIF 실패: ${errorText(e)}`)
      }
    }
  }
  // 대표 칸은 옵션 밀기·GIF 첫 프레임 포스터로 내려가지 않는다 — 정지 대표 컷이 그대로 포스터다(움직임 없음, 올리기 없음)
  if (hero) return done({ url: hero.url, costUsd, motion: heroPosterMotion(reasons, gifFrames) })
  try {
    const slide = await slideSet(task, deps, reasons)
    if (slide) {
      const encoded = await encodeMotionBand(slide)
      if (encoded.status !== 'ok') reasons.push(`옵션 밀기 칸 예산 초과(${encoded.steps.join(' → ')})`)
      return done(await uploadCell(deps, { path: 'stills-slide', set: slide, loop: 'plain', encoded }, reasons, costUsd))
    }
  } catch (e) {
    // 받은 바이트가 그림이 아니거나(sharp) 인코딩·업로드가 실패해도 잡을 막지 않는다
    reasons.push(`옵션 밀기 실패: ${errorText(e)}`)
  }
  // 포스터 한 장 — 검사에 떨어진 GIF도 첫 프레임(참조 사진과 가장 가까운 장면)은 쓴다. 글자 반전은 첫 3프레임에서도 났으므로(P03) 검사 탈락이면 쓰지 않는다
  const tainted = reasons.some((r) => r.startsWith('검사 탈락'))
  if (gifFrames && !tainted) {
    try {
      const poster = await posterJpeg(gifFrames, 0)
      const encoded: MotionEncodeResult = { status: 'poster', webp: null, poster, quality: null, frames: 1, bytes: poster.length, steps: ['poster'] }
      return done(await uploadCell(deps, { path: 'gpt26-ref', set: gifFrames, loop: 'plain', encoded }, reasons, costUsd))
    } catch (e) {
      reasons.push(`포스터 실패: ${errorText(e)}`)
    }
  }
  return { cell: null, costUsd, reasons, ...(sentPrompt ? { sentPrompt } : {}) }
}

/** GIF 칸 entry의 일반 게이트 — 일반 게이트·shotdiv 쌍·글자 자리 재생성을 건너뛴다(3×3 프레임 모음 검사가 이 칸의 게이트). motion이 없으면 null */
export const MOTION_GATE_NOTE = 'GIF 칸 — 프레임 모음 검사로 판정'
export function motionGateSkip(entry: { motion?: unknown }): { verdict: 'skip'; unjudged: string; costUsd: number } | null {
  return entry.motion ? { verdict: 'skip', unjudged: MOTION_GATE_NOTE, costUsd: 0 } : null
}

/** 재생성·재시도 맥락 — 이때는 GIF를 다시 만들지 않고 정지 컷으로 간다(유료 두 배·재생성 지시 버림을 막는다) */
export interface RedoFlags {
  editorRegen?: unknown
  regenScore?: unknown
  angleOf?: unknown
  copyZoneRetry?: unknown
  errorRetry?: boolean
}
export const isMotionRedo = (f: RedoFlags): boolean => Boolean(f.editorRegen || f.regenScore || f.angleOf || f.copyZoneRetry || f.errorRetry)

/**
 * 칸을 내려서 만들었으면 그 까닭 한 줄(이미지 단계 경고) — 포스터 한 장이거나, GIF 칸이 옵션 밀기로 갔을 때. 내려가지 않았으면(까닭 없는 ok) null.
 * 포스터 칸도 '만든 칸'이라 정지 컷 경고가 나지 않아 실행 로그로 가를 수 없었다(K5 P06·P08 확인, 세션 B ③ P4)
 */
export function motionFallbackNote(motion: Pick<SectionMotion, 'path' | 'status'>, reasons: readonly string[]): string | null {
  const why = reasons.length > 0 ? reasons.join(' · ') : '까닭 기록 없음'
  if (motion.status === 'poster') return `GIF 칸을 포스터 한 장으로(${motion.path === 'gpt26-ref' ? 'GIF 첫 프레임' : '첫 옵션 사진'}) — ${why}`
  if (reasons.length > 0) return `GIF 칸을 ${motion.path === 'stills-slide' ? '옵션 밀기' : '참조 GIF'}로 — ${why}`
  return null
}

/**
 * 이미지 단계의 GIF 칸 분기 — motion이 없거나 재생성·재시도면 정지 컷 그대로. 칸을 만들면 그 entry(내려서 만들었으면 까닭 경고), 못 만들거나 예외면
 * 경고를 남기고 정지 컷으로 내려가며 이미 쓴 비용은 더한다. 이 함수는 build의 예외로 run을 멈추지 않는다(still의 동작은 지금 그대로다)
 */
export async function motionOrStill<E>(
  motion: MotionTask | undefined,
  redo: boolean,
  build: (motion: MotionTask) => Promise<MotionOutcome>,
  toEntry: (cell: MotionCell, outcome: MotionOutcome) => E,
  still: () => Promise<{ entry: E; costUsd: number }>,
  warn: (message: string) => void = (message) => console.warn(message),
): Promise<{ entry: E; costUsd: number }> {
  if (!motion || redo) return still()
  let spent = 0
  try {
    const out = await build(motion)
    if (out.cell) {
      const note = motionFallbackNote(out.cell.motion, out.reasons)
      if (note) warn(note)
      return { entry: toEntry(out.cell, out), costUsd: out.costUsd }
    }
    spent = out.costUsd
    warn(`GIF 칸을 못 만들어 정지 컷으로 — ${out.reasons.join(' · ')}`)
  } catch (e) {
    warn(`GIF 칸 예외로 정지 컷으로 — ${errorText(e)}`)
  }
  const fallback = await still()
  return { ...fallback, costUsd: fallback.costUsd + spent }
}
