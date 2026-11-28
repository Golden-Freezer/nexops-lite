/**
 * GIF 칸(움직이는 띠 motion_band) 인코딩 — 서버 sharp. 측정 근거: 세션 B work/pdp-b/gif/DESIGN.md 0-1-3·0-1-4절(78건, 무료·로컬).
 * - 기본: 움직이는 WebP 손실 q80·effort 4·loop 0·폭 780. q80은 원본 대비 SSIM 0.980~0.995였다.
 *   effort 6은 2~7%만 작고 15~25배 느리며, near-lossless는 5~15배 커서 쓰지 않는다.
 * - 칸 하나 ≤ 0.7MB. 넘으면 ① q70 ② 프레임 줄이기(호출부가 준 reduce) ③ 포스터 JPEG 한 장(움직임 없음) 순으로 내린다.
 * - 대표 칸(첫 화면, 움직이는 칸 자리 규칙 ①)도 ≤ 0.7MB(heroMaxBytes — 결정 카드 c13, 11-09에 0.9MB에서 낮춤). 따로 둔 값이라 대표 칸만 다시 바꿀 수 있다.
 *   운영 실측(11-05 이후 대표 칸 22개 151~657KB)에서 0.7MB를 넘은 칸은 없었다.
 * - 사용 동작(use) 고른 칸만 ≤ 1.5MB(useMaxBytes — 오너 11-11 00:5x 답·통합 decide 35, 하네스 J55). 경쟁 상세는 사용 장면 움직임 칸에 0.24~3.5MB를
 *   쓴다(J52). 대표 칸·transform·assemble·scale·옵션 밀기·motion_band 띠는 0.7MB 그대로, 칸 수 상한 3도 그대로다.
 * - 페이지 움직임 합 ≤ 3MB(pageMaxBytes — 같은 결정, 그 전 2.1MB = 0.7MB × 3칸). 대표 0.7 + use 1.5 + 띠 0.7 = 2.9MB라 칸 상한을 지키면
 *   넘지 않는다(고른 칸은 잡마다 하나). 그래도 넘는 묶음(예: 낮추기 전 0.9MB로 만든 대표 칸)은 뒤 칸부터 뺀다 — 운영 검사는 편집기 내보내기
 *   (exportUtils/motionParts overMotionBudget, 같은 값 detailImageLimits MOTION_PAGE_MAX_BYTES)이고 fitPageBudget은 같은 규칙의 서버 쪽 함수다.
 *   대표 칸은 페이지 맨 위라 가장 나중에 빠진다. 움직이는 칸이 없는 잡(motionband 꺼짐)은 이 값을 쓰지 않는다.
 * - 이미지 업로드 판은 이 WebP를 전체 이미지 목록의 GIF 칸 자리에 그대로 끼운다(쿠팡 IMAGE_NO_SPACE가 움직이는 WebP를 다시 인코딩하지 않고
 *   보여 준다 — 통합 gif-delivery 10절, P4 exportUtils/motionParts.ts). 포스터 JPEG는 편집기 화면·대체용이다.
 * sharp는 함수 안에서 불러온다(바이너리 로드 실패가 이 모듈을 쓰는 라우트 전체를 죽이지 않게).
 */
import type sharpModule from 'sharp'
import type { FrameSet } from './assemble'

export const MOTION_ENCODE = Object.freeze({
  width: 780,
  quality: 80,
  fallbackQuality: 70,
  effort: 4,
  maxBytes: 700 * 1024,
  heroMaxBytes: 700 * 1024,
  useMaxBytes: 1500 * 1024,
  pageMaxBytes: 3000 * 1024,
  posterQuality: 90,
  sheetCell: 256,
})

async function loadSharp(): Promise<typeof sharpModule> {
  const mod = await import('sharp')
  return (mod as unknown as { default?: typeof sharpModule }).default ?? (mod as unknown as typeof sharpModule)
}

/**
 * GIF 바이트 → 폭 width의 RGB 프레임(흰 바탕에 합성). 지연이 없으면 200ms.
 * height를 주면 그 높이로 가득 채워(cover) 칸 비율에 딱 맞춘다(대표 칸·고른 칸 — 편집기 사진 자리와 비율이 같아야 내보내기가 바꿔 넣는다). 없으면 지금 그대로 원본 비율
 */
export async function decodeGif(bytes: Buffer, width: number = MOTION_ENCODE.width, fitHeight?: number): Promise<FrameSet> {
  const sharp = await loadSharp()
  const meta = await sharp(bytes, { animated: true }).metadata()
  const pages = meta.pages ?? 1
  const pageHeight = meta.pageHeight ?? meta.height ?? 0
  if (!meta.width || !pageHeight) throw new Error('GIF 크기를 읽지 못했습니다.')
  const height = fitHeight ?? Math.round((pageHeight * width) / meta.width)
  const resize = fitHeight ? { kernel: 'lanczos3' as const, fit: 'cover' as const } : { kernel: 'lanczos3' as const }
  const frames: Buffer[] = []
  for (let i = 0; i < pages; i++) {
    frames.push(await sharp(bytes, { page: i, pages: 1 }).flatten({ background: '#ffffff' }).resize(width, height, resize).removeAlpha().raw().toBuffer())
  }
  const delays = Array.isArray(meta.delay) && meta.delay.length === pages ? meta.delay.map((d) => (d > 0 ? d : 200)) : frames.map(() => 200)
  return { frames, delays, width, height }
}

/** 사진 한 장 → width×height RGB(가득 채움 cover, 흰 바탕) — 옵션 밀기용 */
export async function photoFrame(bytes: Buffer, width: number, height: number): Promise<Buffer> {
  const sharp = await loadSharp()
  return sharp(bytes).flatten({ background: '#ffffff' }).resize(width, height, { fit: 'cover', kernel: 'lanczos3' }).removeAlpha().raw().toBuffer()
}

async function framesAsPng(set: FrameSet): Promise<Buffer[]> {
  const sharp = await loadSharp()
  return Promise.all(set.frames.map((f) => sharp(f, { raw: { width: set.width, height: set.height, channels: 3 } }).png({ compressionLevel: 1 }).toBuffer()))
}

export async function encodeWebp(set: FrameSet, quality: number = MOTION_ENCODE.quality): Promise<Buffer> {
  const sharp = await loadSharp()
  const pngs = await framesAsPng(set)
  return sharp(pngs, { join: { animated: true } }).webp({ quality, effort: MOTION_ENCODE.effort, loop: 0, delay: set.delays }).toBuffer()
}

/** 포스터 — 한 프레임의 JPEG(이미지 업로드 판·대체 칸·편집기 굽기용) */
export async function posterJpeg(set: FrameSet, index = 0): Promise<Buffer> {
  const sharp = await loadSharp()
  const i = Math.min(Math.max(0, index), set.frames.length - 1)
  return sharp(set.frames[i], { raw: { width: set.width, height: set.height, channels: 3 } }).jpeg({ quality: MOTION_ENCODE.posterQuality, mozjpeg: true }).toBuffer()
}

/** 3×3 프레임 모음 PNG(번호 순, 9장을 넘으면 고르게 골라 9장) — 상품 일치·글자 반전 비전 게이트 입력 */
export async function frameSheet(set: FrameSet, cell: number = MOTION_ENCODE.sheetCell): Promise<Buffer> {
  const sharp = await loadSharp()
  const n = set.frames.length
  const pick = n <= 9 ? [...Array(n).keys()] : [...Array(9).keys()].map((k) => Math.round((k * (n - 1)) / 8))
  const cellH = Math.round((set.height * cell) / set.width)
  const tiles = await Promise.all(
    pick.map(async (i, k) => ({
      input: await sharp(set.frames[i], { raw: { width: set.width, height: set.height, channels: 3 } }).resize(cell, cellH).png().toBuffer(),
      left: (k % 3) * cell,
      top: Math.floor(k / 3) * cellH,
    })),
  )
  return sharp({ create: { width: cell * 3, height: cellH * Math.ceil(pick.length / 3), channels: 3, background: '#ffffff' } }).composite(tiles).png().toBuffer()
}

export interface MotionEncodeResult {
  /** ok = 움직이는 WebP, poster = 예산을 못 맞춰 정지 한 장 */
  status: 'ok' | 'poster'
  webp: Buffer | null
  poster: Buffer
  quality: number | null
  frames: number
  bytes: number
  /** 내린 단계 기록(예: ['q80 812KB', 'q70 690KB']) */
  steps: string[]
}

/** 칸 예산 맞추기 — q80 → q70 → reduce(있으면, q70) → 포스터. 포스터는 늘 만든다(이미지 업로드 판에 들어간다) */
export async function encodeMotionBand(
  set: FrameSet,
  opts: { maxBytes?: number; reduce?: (set: FrameSet) => FrameSet | null; posterIndex?: number } = {},
): Promise<MotionEncodeResult> {
  const max = opts.maxBytes ?? MOTION_ENCODE.maxBytes
  const poster = await posterJpeg(set, opts.posterIndex ?? 0)
  const steps: string[] = []
  const tries: Array<[FrameSet, number]> = [
    [set, MOTION_ENCODE.quality],
    [set, MOTION_ENCODE.fallbackQuality],
  ]
  const smaller = opts.reduce ? opts.reduce(set) : null
  if (smaller && smaller.frames.length < set.frames.length) tries.push([smaller, MOTION_ENCODE.fallbackQuality])
  for (const [s, q] of tries) {
    const webp = await encodeWebp(s, q)
    steps.push(`q${q} ${s.frames.length}f ${Math.round(webp.length / 1024)}KB`)
    if (webp.length <= max) return { status: 'ok', webp, poster, quality: q, frames: s.frames.length, bytes: webp.length, steps }
  }
  steps.push('poster')
  return { status: 'poster', webp: null, poster, quality: null, frames: 1, bytes: poster.length, steps }
}

/**
 * GIF 칸 예산 사다리(세션 B ③, 통합 05:1x 권장안) — tries를 차례로 q80으로, 모두 넘으면 마지막 것을 q70으로, 그래도 넘으면 포스터.
 * 포스터는 첫 후보의 posterIndex 프레임(지금과 같은 장면)이다. pick은 고른 후보 번호(포스터면 null).
 * 옵션 밀기 칸은 지금처럼 encodeMotionBand를 쓴다
 */
export async function encodeBandLadder(
  tries: readonly FrameSet[],
  opts: { maxBytes?: number; posterIndex?: number } = {},
): Promise<MotionEncodeResult & { pick: number | null }> {
  if (tries.length === 0) throw new Error('예산 사다리 후보가 없습니다.')
  const max = opts.maxBytes ?? MOTION_ENCODE.maxBytes
  const poster = await posterJpeg(tries[0], opts.posterIndex ?? 0)
  const steps: string[] = []
  const plan: Array<[number, number]> = [
    ...tries.map((_, i): [number, number] => [i, MOTION_ENCODE.quality]),
    [tries.length - 1, MOTION_ENCODE.fallbackQuality],
  ]
  for (const [i, q] of plan) {
    const s = tries[i]
    const webp = await encodeWebp(s, q)
    steps.push(`q${q} ${s.frames.length}f ${Math.round(webp.length / 1024)}KB`)
    if (webp.length <= max) return { status: 'ok', webp, poster, quality: q, frames: s.frames.length, bytes: webp.length, steps, pick: i }
  }
  steps.push('poster')
  return { status: 'poster', webp: null, poster, quality: null, frames: 1, bytes: poster.length, steps, pick: null }
}

/** 페이지 움직임 합 예산 — 넘으면 뒤 칸부터 포스터로. 돌려주는 값은 포스터로 바꿀 칸 번호(순서대로) */
export function fitPageBudget(cellBytes: readonly number[], max: number = MOTION_ENCODE.pageMaxBytes): number[] {
  let total = cellBytes.reduce((s, b) => s + b, 0)
  const out: number[] = []
  for (let i = cellBytes.length - 1; i >= 0 && total > max; i--) {
    total -= cellBytes[i]
    out.unshift(i)
  }
  return out
}
