/**
 * 저해상도 참조 업스케일 — 작은 PNG·JPG를 메모리에서 만들어 확인한다(네트워크·유료 호출 0).
 */

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VisionImage } from '@/lib/agents/registration/thumbnail-vision-agent'
import { upscaleLowResReference } from './reference-upscale'

type Format = 'png' | 'jpeg' | 'webp' | 'gif'

async function picture(width: number, height: number, format: Format, orientation?: number): Promise<string> {
  let img = sharp({ create: { width, height, channels: 4, background: { r: 20, g: 80, b: 160, alpha: 0.5 } } })
  if (orientation) img = img.withMetadata({ orientation })
  return (await img.toFormat(format).toBuffer()).toString('base64')
}

async function inspect(ref: VisionImage) {
  const meta = await sharp(Buffer.from(ref.data, 'base64')).metadata()
  return {
    width: meta.width,
    height: meta.height,
    format: meta.format,
    hasAlpha: meta.hasAlpha,
    orientation: meta.orientation,
  }
}

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

describe('upscaleLowResReference — 긴 변 500 미만만 500으로(비율 유지)', () => {
  it('222×148 PNG(반투명) → 500×333 PNG, 투명도 유지', async () => {
    const out = await upscaleLowResReference({ data: await picture(222, 148, 'png'), mediaType: 'image/png' })
    expect(out.mediaType).toBe('image/png')
    expect(await inspect(out)).toMatchObject({ width: 500, height: 333, format: 'png', hasAlpha: true })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('222x148')
  })

  it('300×400 JPEG → 375×500 JPEG', async () => {
    const out = await upscaleLowResReference({ data: await picture(300, 400, 'jpeg'), mediaType: 'image/jpeg' })
    expect(out.mediaType).toBe('image/jpeg')
    expect(await inspect(out)).toMatchObject({ width: 375, height: 500, format: 'jpeg' })
  })

  it('499×100 WebP → 500×100 WebP(경계 바로 아래)', async () => {
    const out = await upscaleLowResReference({ data: await picture(499, 100, 'webp'), mediaType: 'image/webp' })
    expect(out.mediaType).toBe('image/webp')
    expect(await inspect(out)).toMatchObject({ width: 500, height: 100, format: 'webp' })
  })

  it('EXIF 방향(90° 회전 태그)은 픽셀에 적용한 뒤 키운다 — 저장 300×200·보이는 200×300 → 333×500', async () => {
    const out = await upscaleLowResReference({ data: await picture(300, 200, 'jpeg', 6), mediaType: 'image/jpeg' })
    expect(await inspect(out)).toMatchObject({ width: 333, height: 500, orientation: undefined })
  })

  it('형식은 실제 바이트 기준 — content-type이 jpeg라고 했어도 PNG면 PNG로 내보낸다', async () => {
    const out = await upscaleLowResReference({ data: await picture(200, 200, 'png'), mediaType: 'image/jpeg' })
    expect(out.mediaType).toBe('image/png')
    expect(await inspect(out)).toMatchObject({ width: 500, height: 500, format: 'png' })
  })

  it('긴 변 500 이상이면 받은 참조를 그대로(바이트 동일)', async () => {
    for (const [w, h] of [
      [500, 200],
      [200, 500],
      [1024, 1024],
    ]) {
      const ref: VisionImage = { data: await picture(w, h, 'jpeg'), mediaType: 'image/jpeg' }
      expect(await upscaleLowResReference(ref)).toBe(ref)
    }
    expect(warn).not.toHaveBeenCalled()
  })

  it('디코드할 수 없는 바이트·지원 밖 형식(GIF)은 원본 그대로 — 생성을 막지 않는다', async () => {
    const garbage: VisionImage = { data: Buffer.from('not an image').toString('base64'), mediaType: 'image/jpeg' }
    expect(await upscaleLowResReference(garbage)).toBe(garbage)
    const gif: VisionImage = { data: await picture(100, 80, 'gif'), mediaType: 'image/jpeg' }
    expect(await upscaleLowResReference(gif)).toBe(gif)
    expect(warn).not.toHaveBeenCalled()
  })

  it('sharp를 불러오지 못하면(배포 번들 누락) 원본 그대로 — 조용히 꺼지지 않게 경고는 한 번만', async () => {
    vi.resetModules()
    vi.doMock('sharp', () => {
      throw new Error('Cannot find module')
    })
    try {
      const fresh = await import('./reference-upscale')
      const ref: VisionImage = { data: await picture(222, 148, 'png'), mediaType: 'image/png' }
      expect(await fresh.upscaleLowResReference(ref)).toBe(ref)
      expect(await fresh.upscaleLowResReference(ref)).toBe(ref)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('sharp 로드 실패')
    } finally {
      vi.doUnmock('sharp')
      vi.resetModules()
    }
  })
})
