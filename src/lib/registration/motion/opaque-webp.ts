/**
 * 투명도 없는 움직이는 WebP(AX-CT-37 — 오너 2026-11-20 18:4x '업로드 준비를 알아서').
 * 앱이 만든 움직이는 WebP 는 libwebp 애니메이션 인코더가 바뀐 부분만 담는 프레임에 투명도를 써서 VP8X 알파 비트(0x10)와 ALPH 청크가 붙는다
 * (11-19·11-20 구디백 실측 0x12·ALPH 8/9). 11-16 실측으로는 투명도 없는 판이 쿠팡 상세설명 '이미지 업로드'에서 움직였다(wingDetailHtml.ts 주석).
 * 그래서 프레임마다 흰 바탕에 펴서 투명도 없는 정지 WebP(단순 'VP8 ')로 굽고, 캔버스 전체를 덮는 ANMF(겹치기 안 함)로 직접 묶는다.
 * 프레임 수·길이·반복 수는 그대로다. 저장하지 않는다 — 업로드 준비 묶음(내보내기)에서만 쓴다.
 */

import type sharpModule from 'sharp'

/** 받는 바이트 상한(Vercel 요청 본문 한도 안) */
export const OPAQUE_WEBP_MAX_BYTES = 4 * 1024 * 1024
/** 프레임 수 상한 — 앱 칸은 9~16, 오너 영상 다듬은 판도 50 */
export const OPAQUE_WEBP_MAX_FRAMES = 200
/** 프레임 정지 WebP 품질 */
export const OPAQUE_WEBP_QUALITY = 90
/** 돌려주는 바이트 상한 — Vercel 응답 본문 한도(4.5MB) 안. 바꾸면 16~20% 커지므로 넘으면 던져 원본+알림 길로 보낸다 */
export const OPAQUE_WEBP_MAX_OUT_BYTES = Math.floor(4.25 * 1024 * 1024)
/** 한 번에 펴는 RGB 바이트 상한(함수 메모리) */
export const OPAQUE_WEBP_MAX_RAW_BYTES = 512 * 1024 * 1024

const RIFF = Buffer.from('RIFF')
const WEBP = Buffer.from('WEBP')

export interface WebpChunk {
  tag: string
  /** 머리 8바이트 뒤 내용(채움 바이트 빼고) */
  data: Buffer
}

/** RIFF WEBP 의 맨 위 청크 목록 — 꼴이 틀리면 던진다 */
export function webpChunks(bytes: Buffer): WebpChunk[] {
  if (bytes.length < 12 || !bytes.subarray(0, 4).equals(RIFF) || !bytes.subarray(8, 12).equals(WEBP)) throw new Error('WebP 파일이 아닙니다.')
  const end = Math.min(bytes.length, 8 + bytes.readUInt32LE(4))
  const chunks: WebpChunk[] = []
  let at = 12
  while (at + 8 <= end) {
    const size = bytes.readUInt32LE(at + 4)
    if (at + 8 + size > end) throw new Error('WebP 청크가 잘렸습니다.')
    chunks.push({ tag: bytes.toString('ascii', at, at + 4), data: bytes.subarray(at + 8, at + 8 + size) })
    at += 8 + size + (size % 2)
  }
  return chunks
}

export interface WebpAlphaInfo {
  /** VP8X 플래그 바이트(VP8X 가 없으면 null) */
  vp8xFlags: number | null
  alphaBit: boolean
  animationBit: boolean
  /** 맨 위·ANMF 안의 ALPH 청크 수 */
  alphChunks: number
  frames: number
  durationsMs: number[]
}

/** 투명도·프레임 정보(시험·검사용) — ANMF 안 청크까지 본다 */
export function webpAlphaInfo(bytes: Buffer): WebpAlphaInfo {
  const chunks = webpChunks(bytes)
  const vp8x = chunks.find((c) => c.tag === 'VP8X')
  const flags = vp8x ? vp8x.data[0] : null
  let alph = chunks.filter((c) => c.tag === 'ALPH').length
  const durations: number[] = []
  for (const c of chunks.filter((x) => x.tag === 'ANMF')) {
    durations.push(c.data.readUIntLE(12, 3))
    let at = 16
    while (at + 8 <= c.data.length) {
      const size = c.data.readUInt32LE(at + 4)
      if (c.data.toString('ascii', at, at + 4) === 'ALPH') alph++
      at += 8 + size + (size % 2)
    }
  }
  return {
    vp8xFlags: flags,
    alphaBit: flags !== null && (flags & 0x10) !== 0,
    animationBit: flags !== null && (flags & 0x02) !== 0,
    alphChunks: alph,
    frames: durations.length,
    durationsMs: durations,
  }
}

const chunk = (tag: string, data: Buffer) =>
  Buffer.concat([Buffer.from(tag, 'ascii'), u32(data.length), data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)])
const u32 = (v: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(v)
  return b
}
const u24 = (v: number) => {
  const b = Buffer.alloc(3)
  b.writeUIntLE(v, 0, 3)
  return b
}

/** 단순 정지 WebP(RIFF + 'VP8 ' 하나) → 'VP8 ' 청크(머리 포함). 알파·VP8L·VP8X 꼴이면 던진다 */
export function vp8ChunkOf(still: Buffer): Buffer {
  const chunks = webpChunks(still)
  if (chunks.length !== 1 || chunks[0].tag !== 'VP8 ') throw new Error(`투명도 없는 정지 WebP 가 아닙니다(${chunks.map((c) => c.tag).join(',')})`)
  return chunk('VP8 ', chunks[0].data)
}

export interface OpaqueFrame {
  /** 'VP8 ' 청크(머리 포함) */
  vp8: Buffer
  durationMs: number
}

/** 프레임 묶기 — VP8X(애니메이션 비트만) + ANIM(흰 바탕·반복 수) + ANMF(캔버스 전체·겹치기 안 함·지우기 없음) */
export function muxOpaqueAnimation(width: number, height: number, loop: number, frames: readonly OpaqueFrame[]): Buffer {
  if (frames.length === 0) throw new Error('프레임이 없습니다.')
  if (width < 1 || height < 1 || width > 16384 || height > 16384) throw new Error(`캔버스 크기가 이상합니다: ${width}×${height}`)
  const parts = [
    chunk('VP8X', Buffer.concat([Buffer.from([0x02, 0, 0, 0]), u24(width - 1), u24(height - 1)])),
    chunk('ANIM', Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.from([loop & 0xff, (loop >> 8) & 0xff])])),
    ...frames.map((f) =>
      chunk(
        'ANMF',
        Buffer.concat([u24(0), u24(0), u24(width - 1), u24(height - 1), u24(Math.max(0, Math.min(0xffffff, Math.round(f.durationMs)))), Buffer.from([0x02]), f.vp8])
      )
    ),
  ]
  const body = Buffer.concat([WEBP, ...parts])
  return Buffer.concat([RIFF, u32(body.length), body])
}

async function loadSharp(): Promise<typeof sharpModule> {
  const mod = await import('sharp')
  return (mod as unknown as { default?: typeof sharpModule }).default ?? (mod as unknown as typeof sharpModule)
}

/** 움직이는 WebP → 투명도 없는 판(프레임 수·길이·반복 그대로). 정지 WebP·너무 크거나 프레임이 많으면 던진다 */
export async function opaqueAnimatedWebp(
  bytes: Buffer,
  quality: number = OPAQUE_WEBP_QUALITY,
  maxOutBytes: number = OPAQUE_WEBP_MAX_OUT_BYTES
): Promise<Buffer> {
  if (bytes.length > OPAQUE_WEBP_MAX_BYTES) throw new Error(`WebP 가 ${Math.round(OPAQUE_WEBP_MAX_BYTES / 1024 / 1024)}MB 를 넘습니다.`)
  webpChunks(bytes)
  const sharp = await loadSharp()
  const meta = await sharp(bytes, { animated: true }).metadata()
  const pages = meta.pages ?? 1
  const width = meta.width ?? 0
  const height = meta.pageHeight ?? meta.height ?? 0
  if (pages < 2) throw new Error('움직이는 WebP 가 아닙니다(프레임 1장).')
  if (pages > OPAQUE_WEBP_MAX_FRAMES) throw new Error(`프레임이 ${OPAQUE_WEBP_MAX_FRAMES}장을 넘습니다.`)
  if (!width || !height) throw new Error('WebP 크기를 읽지 못했습니다.')
  if (pages * width * height * 3 > OPAQUE_WEBP_MAX_RAW_BYTES) throw new Error(`WebP 가 너무 큽니다(${width}×${height}×${pages}프레임).`)
  const delays = Array.isArray(meta.delay) && meta.delay.length === pages ? meta.delay : Array<number>(pages).fill(200)
  // 한 번만 펴서(흰 바탕·투명도 뺌) 프레임별로 자른다 — 프레임마다 다시 디코드하면 시간이 프레임 수 제곱으로 는다(검수 S1)
  const { data, info } = await sharp(bytes, { animated: true }).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const frameBytes = width * height * 3
  if (info.channels !== 3 || info.width !== width || data.length !== frameBytes * pages) throw new Error('WebP 프레임을 펴지 못했습니다.')
  const frames: OpaqueFrame[] = []
  for (let i = 0; i < pages; i++) {
    const still = await sharp(data.subarray(i * frameBytes, (i + 1) * frameBytes), { raw: { width, height, channels: 3 } })
      .webp({ quality, effort: 6 })
      .toBuffer()
    frames.push({ vp8: vp8ChunkOf(still), durationMs: delays[i] })
  }
  const out = muxOpaqueAnimation(width, height, meta.loop ?? 0, frames)
  if (out.length > maxOutBytes) throw new Error(`바꾼 WebP 가 ${(out.length / 1024 / 1024).toFixed(1)}MB 로 상한을 넘습니다.`)
  return out
}
