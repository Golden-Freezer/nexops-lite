/**
 * 투명도 없는 움직이는 WebP(motion/opaque-webp.ts, AX-CT-37) — sharp 로 만든 알파 붙은 움직이는 WebP 를 넣어
 * 알파 비트 0·ALPH 0·프레임 수·길이·반복·그림이 그대로인지 바이트로 본다. 네트워크·저장 0.
 */

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { muxOpaqueAnimation, OPAQUE_WEBP_MAX_BYTES, opaqueAnimatedWebp, vp8ChunkOf, webpAlphaInfo, webpChunks } from './opaque-webp'

const W = 96
const H = 64

/** 프레임마다 다른 색 + 가운데만 바뀌고 왼쪽 위 8×8 은 투명한 움직이는 WebP — 앱 판처럼 VP8X 알파 비트·ALPH 가 붙는 입력 */
async function animatedWithAlpha(delays: number[], loop = 0): Promise<Buffer> {
  const frames = delays.map((_, i) => {
    const raw = Buffer.alloc(W * H * 4)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const at = (y * W + x) * 4
        const inner = x > 30 && x < 66 && y > 20 && y < 44
        raw[at] = inner ? 40 * i : 230
        raw[at + 1] = inner ? 200 - 20 * i : 220
        raw[at + 2] = 120
        raw[at + 3] = x < 8 && y < 8 ? 0 : 255
      }
    return raw
  })
  return sharp(Buffer.concat(frames), { raw: { width: W, height: H * delays.length, channels: 4, pageHeight: H } })
    .webp({ quality: 80, loop, delay: delays })
    .toBuffer()
}

async function framesOf(bytes: Buffer): Promise<Buffer[]> {
  const meta = await sharp(bytes, { animated: true }).metadata()
  const out: Buffer[] = []
  for (let i = 0; i < (meta.pages ?? 1); i++) out.push(await sharp(bytes, { page: i, pages: 1 }).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer())
  return out
}

describe('opaqueAnimatedWebp — 업로드 묶음용 투명도 없는 판', () => {
  it('알파 비트·ALPH 를 없애고 프레임 수·길이·반복은 그대로, 그림 차이는 작다', async () => {
    const delays = [400, 150, 150, 700]
    const src = await animatedWithAlpha(delays, 3)
    const before = webpAlphaInfo(src)
    // 입력에 투명도가 실제로 붙어 있어야 '없앴다'를 증명한다
    expect(before).toMatchObject({ alphaBit: true, animationBit: true, frames: 4, durationsMs: delays })
    expect(before.alphChunks).toBeGreaterThan(0)
    const out = await opaqueAnimatedWebp(src)
    const after = webpAlphaInfo(out)
    expect(after).toMatchObject({ vp8xFlags: 0x02, alphaBit: false, animationBit: true, alphChunks: 0, frames: 4, durationsMs: delays })
    expect((await sharp(out, { animated: true }).metadata()).loop).toBe(3)
    const [a, b] = [await framesOf(src), await framesOf(out)]
    expect(b).toHaveLength(a.length)
    for (let i = 0; i < a.length; i++) {
      let sum = 0
      for (let k = 0; k < a[i].length; k++) sum += Math.abs(a[i][k] - b[i][k])
      expect(sum / a[i].length, `프레임 ${i}`).toBeLessThan(4)
    }
    // 프레임은 모두 단순 'VP8 '(투명도·무손실 없음)이고 캔버스 전체·겹치기 안 함
    for (const c of webpChunks(out).filter((x) => x.tag === 'ANMF')) {
      expect(c.data.readUIntLE(0, 3)).toBe(0)
      expect(c.data.readUIntLE(6, 3)).toBe(W - 1)
      expect(c.data.readUIntLE(9, 3)).toBe(H - 1)
      expect(c.data[15]).toBe(0x02)
      expect(c.data.toString('ascii', 16, 20)).toBe('VP8 ')
    }
  })

  it('정지 WebP·WebP 아닌 것·너무 큰 것은 던진다', async () => {
    const still = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).webp().toBuffer()
    await expect(opaqueAnimatedWebp(still)).rejects.toThrow('프레임 1장')
    await expect(opaqueAnimatedWebp(Buffer.from('not a webp at all'))).rejects.toThrow('WebP 파일이 아닙니다')
    await expect(opaqueAnimatedWebp(Buffer.alloc(OPAQUE_WEBP_MAX_BYTES + 1))).rejects.toThrow('MB 를 넘습니다')
    // 바꾼 판이 응답 상한을 넘으면 던진다(부르는 쪽이 원본+알림) — 검수 S2
    const anim = await animatedWithAlpha([100, 100])
    await expect(opaqueAnimatedWebp(anim, 90, 100)).rejects.toThrow('상한을 넘습니다')
  })
})

describe('묶기 부품', () => {
  it('vp8ChunkOf 는 투명도 있는 정지 WebP(VP8X·ALPH)를 받지 않는다', async () => {
    const withAlpha = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).webp().toBuffer()
    expect(() => vp8ChunkOf(withAlpha)).toThrow('투명도 없는 정지 WebP 가 아닙니다')
    const plain = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).webp().toBuffer()
    expect(vp8ChunkOf(plain).toString('ascii', 0, 4)).toBe('VP8 ')
  })

  it('muxOpaqueAnimation — RIFF 길이·청크 순서(VP8X·ANIM·ANMF…)·길이 상한을 지키고, 빈 프레임·이상한 크기는 던진다', async () => {
    const plain = vp8ChunkOf(await sharp({ create: { width: 4, height: 2, channels: 3, background: '#fff' } }).webp().toBuffer())
    const out = muxOpaqueAnimation(4, 2, 0, [
      { vp8: plain, durationMs: 120 },
      { vp8: plain, durationMs: 0x1fffffff },
    ])
    expect(out.readUInt32LE(4)).toBe(out.length - 8)
    expect(webpChunks(out).map((c) => c.tag)).toEqual(['VP8X', 'ANIM', 'ANMF', 'ANMF'])
    expect(webpAlphaInfo(out).durationsMs).toEqual([120, 0xffffff])
    expect(() => muxOpaqueAnimation(4, 2, 0, [])).toThrow('프레임이 없습니다')
    expect(() => muxOpaqueAnimation(0, 2, 0, [{ vp8: plain, durationMs: 1 }])).toThrow('캔버스 크기')
  })
})
