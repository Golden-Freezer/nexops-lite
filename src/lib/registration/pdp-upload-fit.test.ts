/**
 * 컷 저장 크기 맞추기(R08a) — 상한 안이면 그대로, 넘을 때만 WebP 무손실 → 품질 90, 그래도 넘으면 오류. 상한은 시험마다 실제 압축 크기로 정한다
 */
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchImageAsBase64 } from '@/lib/agents/registration/thumbnail-vision-agent'
import { imageAspectFromBase64 } from './pdp-annotation-stage'
import { fitPdpUpload, PDP_UPLOAD_LOSSY_QUALITY, PDP_UPLOAD_MAX_BYTES } from './pdp-upload-fit'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 압축이 잘 안 되는 잡음 PNG(무압축) — PNG가 WebP 무손실보다 크고, 무손실이 품질 90보다 크다 */
async function noisyPng(): Promise<Buffer> {
  return sharp({ create: { width: 160, height: 120, channels: 3, background: { r: 0, g: 0, b: 0 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
    .png({ compressionLevel: 0 })
    .toBuffer()
}

describe('fitPdpUpload', () => {
  it('저장 상한은 버킷 설정 5,000,000바이트', () => {
    expect(PDP_UPLOAD_MAX_BYTES).toBe(5_000_000)
  })

  it('상한 안이면 받은 바이트·형식 그대로(기록 없음)', async () => {
    const png = await noisyPng()
    const out = await fitPdpUpload({ base64: png.toString('base64'), mimeType: 'image/png' }, png.length)
    expect(out).toEqual({ base64: png.toString('base64'), mimeType: 'image/png' })
  })

  it('넘으면 무손실 WebP(같은 픽셀) — 원래 형식·바이트, 바꾼 형식·바이트·품질을 남긴다', async () => {
    const png = await noisyPng()
    const lossless = await sharp(png).webp({ lossless: true }).toBuffer()
    expect(lossless.length).toBeLessThan(png.length)
    const out = await fitPdpUpload({ base64: png.toString('base64'), mimeType: 'image/png' }, lossless.length)
    expect(out.mimeType).toBe('image/webp')
    expect(out.uploadFit).toEqual({ from: 'image/png', originalBytes: png.length, to: 'image/webp', bytes: lossless.length, quality: 'lossless' })
    const [a, b] = await Promise.all([sharp(png).raw().toBuffer(), sharp(Buffer.from(out.base64, 'base64')).raw().toBuffer()])
    expect(b.equals(a)).toBe(true)
  })

  it('무손실로도 넘으면 WebP 품질 90', async () => {
    const png = await noisyPng()
    const lossless = await sharp(png).webp({ lossless: true }).toBuffer()
    const lossy = await sharp(png).webp({ quality: PDP_UPLOAD_LOSSY_QUALITY }).toBuffer()
    expect(lossy.length).toBeLessThan(lossless.length)
    const out = await fitPdpUpload({ base64: png.toString('base64'), mimeType: 'image/png' }, lossy.length)
    expect(out.uploadFit).toEqual({ from: 'image/png', originalBytes: png.length, to: 'image/webp', bytes: lossy.length, quality: 90 })
  })

  it('바꾼 WebP(무손실 VP8L·품질 90 VP8)를 뒤 단계가 읽는다 — 장식 비율(imageAspectFromBase64)·게이트·장식 받기(fetchImageAsBase64 → image/webp)·서버 sharp', async () => {
    const png = await noisyPng()
    const lossless = await sharp(png).webp({ lossless: true }).toBuffer()
    const lossy = await sharp(png).webp({ quality: PDP_UPLOAD_LOSSY_QUALITY }).toBuffer()
    for (const max of [lossless.length, lossy.length]) {
      const out = await fitPdpUpload({ base64: png.toString('base64'), mimeType: 'image/png' }, max)
      expect(out.mimeType).toBe('image/webp')
      expect(imageAspectFromBase64(out.base64)).toBeCloseTo(160 / 120, 6)
      const bytes = Buffer.from(out.base64, 'base64')
      expect((await sharp(bytes).metadata()).format).toBe('webp')
      // 저장소는 올릴 때 준 형식(contentType)으로 돌려준다 — 게이트·장식 받기가 그 형식을 비전 입력 형식으로 쓴다
      vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/webp' } })))
      expect(await fetchImageAsBase64('https://cdn.test/pdp-hero.webp')).toEqual({ data: out.base64, mediaType: 'image/webp' })
    }
  })

  it('품질 90으로도 넘으면 올리지 않고 오류(몰래 더 줄이지 않는다)', async () => {
    const png = await noisyPng()
    const lossy = await sharp(png).webp({ quality: PDP_UPLOAD_LOSSY_QUALITY }).toBuffer()
    await expect(fitPdpUpload({ base64: png.toString('base64'), mimeType: 'image/png' }, lossy.length - 1)).rejects.toThrow('올리지 않는다')
  })
})
