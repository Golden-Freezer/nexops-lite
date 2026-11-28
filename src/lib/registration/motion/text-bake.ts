/**
 * 첫 칸 글 굽기(세션 B, 통합 2026-11-06 지시 — 대표 컷 위에 글이 얹히는 K 첫 칸) — 서버 sharp.
 * 내보내기는 사진 위에 글이 얹힌 칸에 움직이는 WebP를 넣지 못했다(motionParts '사진 위에 얹은 요소'). 쿠팡 상세는 이미지라
 * 글이 움직이는 칸에 보이려면 프레임마다 글이 들어가야 하고, 브라우저에는 움직이는 WebP 인코더가 없다 — 그래서 여기서 굽는다.
 *   저장된 움직이는 WebP → 프레임 풀기 → 프레임마다 글 층(투명 PNG, 편집기가 찍은 칸 크기) 얹기 → 같은 지연·무한 고리로 q80, 넘으면 q70(칸 예산)
 *   → 첫 프레임 ↔ 정지 칸(편집기가 구운 포스터 + 글) 구도 거리 ≤ DHASH_TWIN_MAX면 돌려준다. 아니면 skip(부르는 쪽이 지금처럼 포스터 JPEG)
 * 실측 근거(work/pdp-b/motion-text-bake): 실제 2.6 WebP 3개에 글 층을 얹은 q80은 원본 대비 +1~7%(340~449KB), 글 자리 오차 평균 1.3~2.8/255·큰 차(>48) 0%,
 * 저장된 WebP를 한 번 더 인코딩한 손실은 PSNR 45~47dB.
 * 던지지 않는다 — 실패는 skip과 까닭이다. sharp는 함수 안에서 불러온다(encode.ts와 같은 까닭).
 */

import type sharpModule from 'sharp'
import { DHASH_TWIN_MAX, dHashDistance, dHashOf } from '../shot-composition'
import { MOTION_ENCODE } from './encode'

/**
 * motion-bake 라우트 본문 상한 — 글 층 PNG는 대부분 투명이라 작고, 정지 칸 JPEG는 칸 하나다(Vercel 본문 한도 4.5MB 안).
 * 라우트 파일은 Next.js 규칙상 라우트 함수 밖의 값을 내보낼 수 없어 여기 둔다.
 */
export const MOTION_BAKE_BODY_MAX = 1536 * 1024

export const TEXT_BAKE = Object.freeze({
  qualities: [MOTION_ENCODE.quality, MOTION_ENCODE.fallbackQuality] as readonly number[],
  /** 첫 프레임 ↔ 정지 칸 구도 거리 상한 — 같은 구도 판정과 같은 값 */
  firstFrameMax: DHASH_TWIN_MAX,
  /** 프레임 수 상한(assemble LOOP_RULES.maxFrames와 같은 값) — 넘는 파일은 굽지 않는다 */
  maxFrames: 64,
})

export type TextBakeResult =
  | { status: 'ok'; webp: Buffer; quality: number; bytes: number; frames: number; distance: number | null; steps: string[] }
  | { status: 'skip'; reason: string; steps: string[] }

async function loadSharp(): Promise<typeof sharpModule> {
  const mod = await import('sharp')
  return (mod as unknown as { default?: typeof sharpModule }).default ?? (mod as unknown as typeof sharpModule)
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200)

/**
 * 글 굽기 하나. overlay는 칸 크기(WebP 프레임 크기와 같지 않으면 프레임 크기로 늘린다), still은 정지 칸 그림(아무 형식).
 * maxBytes는 칸 예산(motion/stage cellMaxBytesOf — 지금 대표 칸·그 밖 모두 0.7MB, 결정 카드 c13)
 */
export async function bakeTextOnMotion(input: { webp: Buffer; overlay: Buffer; still: Buffer; maxBytes: number }): Promise<TextBakeResult> {
  const steps: string[] = []
  try {
    const sharp = await loadSharp()
    const meta = await sharp(input.webp, { animated: true }).metadata()
    if (meta.format !== 'webp') return { status: 'skip', reason: `움직이는 WebP가 아님(${meta.format ?? '모름'})`, steps }
    const pages = meta.pages ?? 1
    const width = meta.width ?? 0
    const height = meta.pageHeight ?? meta.height ?? 0
    if (pages < 2) return { status: 'skip', reason: '프레임이 하나뿐', steps }
    if (pages > TEXT_BAKE.maxFrames) return { status: 'skip', reason: `프레임 ${pages}장 > ${TEXT_BAKE.maxFrames}`, steps }
    if (!width || !height) return { status: 'skip', reason: '크기를 읽지 못함', steps }
    const delay = Array.isArray(meta.delay) && meta.delay.length === pages ? meta.delay : Array(pages).fill(200)
    const overlay = await sharp(input.overlay).ensureAlpha().resize(width, height, { fit: 'fill' }).png().toBuffer()
    const frames: Buffer[] = []
    for (let i = 0; i < pages; i++) {
      frames.push(
        await sharp(input.webp, { page: i, pages: 1 })
          .flatten({ background: '#ffffff' })
          .composite([{ input: overlay }])
          .png({ compressionLevel: 1 })
          .toBuffer(),
      )
    }
    const [first, still] = await Promise.all([dHashOf(frames[0].toString('base64')), dHashOf(input.still.toString('base64'))])
    const distance = first && still ? dHashDistance(first, still) : null
    if (distance !== null && distance > TEXT_BAKE.firstFrameMax) {
      return { status: 'skip', reason: `첫 프레임이 정지 칸과 다름(구도 거리 ${distance} > ${TEXT_BAKE.firstFrameMax})`, steps }
    }
    for (const quality of TEXT_BAKE.qualities) {
      const webp = await sharp(frames, { join: { animated: true } }).webp({ quality, effort: MOTION_ENCODE.effort, loop: 0, delay }).toBuffer()
      steps.push(`q${quality} ${pages}f ${Math.round(webp.length / 1024)}KB`)
      if (webp.length <= input.maxBytes) return { status: 'ok', webp, quality, bytes: webp.length, frames: pages, distance, steps }
    }
    return { status: 'skip', reason: `칸 예산 ${Math.round(input.maxBytes / 1024)}KB 초과(${steps.join(' → ')})`, steps }
  } catch (e) {
    return { status: 'skip', reason: `굽기 실패: ${errorText(e)}`, steps }
  }
}
