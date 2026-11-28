/**
 * 첫 칸 글 굽기(motion/text-bake.ts) — 합성 프레임 움직이는 WebP + SVG 글 층으로 돈다(유료·네트워크 0).
 * 프레임 수·지연 그대로, 글 깨짐(글 자리 오차), 첫 프레임 판독, 칸 예산 사다리, 실패는 skip.
 */

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { bakeTextOnMotion, TEXT_BAKE } from './text-bake'

const W = 320
const H = 320

/** 움직이는 사진 비슷한 프레임 — 대각 그러데이션 위로 원이 옮겨 간다 */
async function framePng(i: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9c7b0"/><stop offset="1" stop-color="#7a8fa6"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/><circle cx="${80 + i * 12}" cy="200" r="60" fill="#c0392b"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function motionWebp(n = 9, delay = 200): Promise<Buffer> {
  const frames = await Promise.all([...Array(n).keys()].map(framePng))
  return sharp(frames, { join: { animated: true } }).webp({ quality: 80, effort: 4, loop: 0, delay: Array(n).fill(delay) }).toBuffer()
}

/** 글 층 — 투명 바탕에 짙은 굵은 제목(글 깨짐 판독 대상) */
const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect x="0" y="0" width="${W}" height="70" fill="#ffffff" fill-opacity="0.0"/>
  <rect x="20" y="20" width="180" height="14" fill="#111111"/><rect x="20" y="44" width="120" height="8" fill="#111111"/>
  <rect x="220" y="20" width="4" height="40" fill="#111111"/><rect x="232" y="20" width="2" height="40" fill="#111111"/></svg>`
const overlayPng = () => sharp(Buffer.from(overlaySvg)).png().toBuffer()

/** 정지 칸 — 첫 프레임 + 글(편집기가 구운 그림과 같은 꼴) */
async function stillJpeg(): Promise<Buffer> {
  return sharp(await framePng(0)).composite([{ input: await overlayPng() }]).jpeg({ quality: 90 }).toBuffer()
}

describe('bakeTextOnMotion', () => {
  it('프레임 수·지연·무한 고리는 그대로이고 q80으로 굽는다', async () => {
    const out = await bakeTextOnMotion({ webp: await motionWebp(9, 200), overlay: await overlayPng(), still: await stillJpeg(), maxBytes: 700 * 1024 })
    expect(out.status).toBe('ok')
    if (out.status !== 'ok') return
    const meta = await sharp(out.webp, { animated: true }).metadata()
    expect(meta.pages).toBe(9)
    expect(meta.delay).toEqual(Array(9).fill(200))
    expect(meta.loop).toBe(0)
    expect(out.quality).toBe(80)
    expect(out.distance).toBeLessThanOrEqual(TEXT_BAKE.firstFrameMax)
  })

  it('글 깨짐: 모든 프레임의 글 자리(알파 > 128) 오차가 평균 ≤ 4/255이고 큰 차(> 48) 화소가 없다 — 실측 상한 3.6에 여유', async () => {
    const webp = await motionWebp(9)
    const overlay = await overlayPng()
    const out = await bakeTextOnMotion({ webp, overlay, still: await stillJpeg(), maxBytes: 700 * 1024 })
    if (out.status !== 'ok') throw new Error(out.reason)
    const alpha = await sharp(overlay).ensureAlpha().extractChannel(3).raw().toBuffer()
    for (const page of [0, 4, 8]) {
      const ideal = await sharp(webp, { page, pages: 1 }).flatten({ background: '#ffffff' }).composite([{ input: overlay }]).removeAlpha().raw().toBuffer()
      const got = await sharp(out.webp, { page, pages: 1 }).removeAlpha().raw().toBuffer()
      let sum = 0
      let n = 0
      let big = 0
      for (let p = 0; p < W * H; p++) {
        if (alpha[p] <= 128) continue
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(got[p * 3 + c] - ideal[p * 3 + c])
          sum += d
          n += 1
          if (d > 48) big += 1
        }
      }
      expect(n).toBeGreaterThan(0)
      expect(sum / n, `프레임 ${page}`).toBeLessThanOrEqual(4)
      expect(big, `프레임 ${page}`).toBe(0)
    }
  })

  it('글 층이 칸 크기와 다르면 프레임 크기로 늘린다', async () => {
    const small = await sharp(await overlayPng()).resize(160, 160).png().toBuffer()
    const out = await bakeTextOnMotion({ webp: await motionWebp(), overlay: small, still: await stillJpeg(), maxBytes: 700 * 1024 })
    expect(out.status).toBe('ok')
    if (out.status === 'ok') expect((await sharp(out.webp).metadata()).width).toBe(W)
  })

  it('첫 프레임이 정지 칸과 다르면 skip — 부르는 쪽이 포스터 JPEG를 둔다', async () => {
    const other = await sharp({ create: { width: W, height: H, channels: 3, background: '#000000' } })
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="0" y="0" width="${W / 2}" height="${H}" fill="#ffffff"/></svg>`) }])
      .jpeg()
      .toBuffer()
    const out = await bakeTextOnMotion({ webp: await motionWebp(), overlay: await overlayPng(), still: other, maxBytes: 700 * 1024 })
    expect(out).toMatchObject({ status: 'skip', reason: expect.stringMatching(/^첫 프레임이 정지 칸과 다름/) })
  })

  it('칸 예산: q80이 넘으면 q70, 그래도 넘으면 skip(내린 단계 기록)', async () => {
    const webp = await motionWebp()
    const base = { webp, overlay: await overlayPng(), still: await stillJpeg() }
    const q80 = await bakeTextOnMotion({ ...base, maxBytes: 700 * 1024 })
    if (q80.status !== 'ok') throw new Error(q80.reason)
    const q70 = await bakeTextOnMotion({ ...base, maxBytes: q80.bytes - 1 })
    expect(q70.status === 'ok' ? q70.quality : q70.reason).toBe(70)
    const none = await bakeTextOnMotion({ ...base, maxBytes: 100 })
    expect(none).toMatchObject({ status: 'skip', reason: expect.stringMatching(/^칸 예산 0KB 초과/) })
    expect(none.steps).toHaveLength(2)
  })

  it('정지 그림·한 프레임 파일·그림이 아닌 바이트는 skip이고 던지지 않는다', async () => {
    const still = await stillJpeg()
    const overlay = await overlayPng()
    expect(await bakeTextOnMotion({ webp: still, overlay, still, maxBytes: 700 * 1024 })).toMatchObject({ status: 'skip', reason: expect.stringContaining('움직이는 WebP가 아님') })
    const single = await sharp(await framePng(0)).webp().toBuffer()
    expect(await bakeTextOnMotion({ webp: single, overlay, still, maxBytes: 700 * 1024 })).toMatchObject({ status: 'skip', reason: '프레임이 하나뿐' })
    expect(await bakeTextOnMotion({ webp: Buffer.from('nope'), overlay, still, maxBytes: 700 * 1024 })).toMatchObject({ status: 'skip', reason: expect.stringMatching(/^굽기 실패/) })
  })
})
