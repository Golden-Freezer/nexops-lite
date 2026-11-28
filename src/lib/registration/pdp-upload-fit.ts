/**
 * 컷 저장 크기 맞추기(하네스 R08a) — 새 배치 MS 2k(힉스필드) 컷만 부른다. 지금 배치(2.6·NB 등)는 지나가지 않는다(바이트 그대로).
 * 저장 버킷 sourcing-product-images의 파일 상한은 5,000,000바이트다(2026-11-08 버킷 설정 읽기). MS 2k PNG는 4.0~4.8MB가 흔하고,
 * R08 P07 잡 80962f2d에서 3컷이 받은 뒤 올리기에서 실패했다(생성 성공·과금 뒤 → 재제출이 HTTP 422).
 * 상한 안이면 그대로, 넘을 때만 무손실 WebP(같은 픽셀)로 바꾸고, 그래도 넘으면 WebP 품질 90으로 바꾼다. 바꾼 것은 컷 기록(uploadFit)에
 * 원래 바이트·형식·품질로 남는다. 그래도 넘으면 올리지 않고 오류다(몰래 더 줄이지 않는다).
 */
import type sharpModule from 'sharp'

/** 저장 버킷 파일 상한(바이트) — 버킷 설정 file_size_limit */
export const PDP_UPLOAD_MAX_BYTES = 5_000_000
/** 무손실로도 넘을 때 쓰는 WebP 품질 */
export const PDP_UPLOAD_LOSSY_QUALITY = 90

export interface PdpUploadFitRecord {
  /** 원래 형식·바이트 */
  from: string
  originalBytes: number
  /** 바꾼 형식·바이트·품질('lossless' 또는 숫자) */
  to: 'image/webp'
  bytes: number
  quality: 'lossless' | number
}

export interface PdpUploadImage {
  base64: string
  mimeType: string
  /** 바꿨을 때만 */
  uploadFit?: PdpUploadFitRecord
}

type Sharp = typeof sharpModule
async function loadSharp(): Promise<Sharp> {
  const mod = await import('sharp')
  return (mod.default ?? mod) as Sharp
}

/** 저장 상한에 맞춘 이미지 — 상한 안이면 받은 그대로(같은 객체 내용), 넘으면 WebP(무손실 → 품질 90). 그래도 넘으면 오류 */
export async function fitPdpUpload(
  image: { base64: string; mimeType: string },
  max = PDP_UPLOAD_MAX_BYTES,
  sharp: () => Promise<Sharp> = loadSharp
): Promise<PdpUploadImage> {
  const bytes = Buffer.from(image.base64, 'base64')
  if (bytes.length <= max) return { base64: image.base64, mimeType: image.mimeType }
  const s = await sharp()
  const record = (out: Buffer, quality: PdpUploadFitRecord['quality']): PdpUploadImage => ({
    base64: out.toString('base64'),
    mimeType: 'image/webp',
    uploadFit: { from: image.mimeType, originalBytes: bytes.length, to: 'image/webp', bytes: out.length, quality },
  })
  const lossless = await s(bytes).webp({ lossless: true }).toBuffer()
  if (lossless.length <= max) return record(lossless, 'lossless')
  const lossy = await s(bytes).webp({ quality: PDP_UPLOAD_LOSSY_QUALITY }).toBuffer()
  if (lossy.length <= max) return record(lossy, PDP_UPLOAD_LOSSY_QUALITY)
  throw new Error(
    `저장 상한 ${max}바이트를 넘는다 — 원래 ${bytes.length}바이트, WebP 무손실 ${lossless.length}·품질 ${PDP_UPLOAD_LOSSY_QUALITY} ${lossy.length}바이트(올리지 않는다)`
  )
}
