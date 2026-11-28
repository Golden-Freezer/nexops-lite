import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { applyPhotoEdits, ringAverage } from './photo-edits'

const PINK = { r: 240, g: 200, b: 210 }

/** 40×40 분홍 바탕 가운데 10×10 검은 배지 */
async function badgeImage(): Promise<Buffer> {
  const badge = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer()
  return sharp({ create: { width: 40, height: 40, channels: 3, background: PINK } })
    .composite([{ input: badge, left: 15, top: 15 }])
    .png()
    .toBuffer()
}

async function pixel(buf: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * info.channels
  return [data[i], data[i + 1], data[i + 2]]
}

describe('원천 사진 참조용 편집', () => {
  it('fill은 상자를 둘레 평균색으로 덮어 글자 배지를 지운다', async () => {
    const src = await badgeImage()
    expect(await pixel(src, 20, 20)).toEqual([0, 0, 0])
    const out = await applyPhotoEdits(src, [{ kind: 'fill', box: [15, 15, 10, 10], note: '배지' }])
    expect(await pixel(out, 20, 20)).toEqual([PINK.r, PINK.g, PINK.b])
    expect(await pixel(out, 2, 2)).toEqual([PINK.r, PINK.g, PINK.b])
  })

  it('blur는 상자 안만 흐리고 밖은 그대로 둔다', async () => {
    const src = await badgeImage()
    const out = await applyPhotoEdits(src, [{ kind: 'blur', box: [12, 12, 16, 16], note: '브랜드' }])
    const center = await pixel(out, 20, 20)
    expect(center.some((v) => v > 0)).toBe(true) // 검정이 주변 분홍과 섞였다
    expect(await pixel(out, 2, 2)).toEqual([PINK.r, PINK.g, PINK.b])
  })

  it('편집이 없으면 원본 그대로, 상자가 그림 밖이면 거부한다', async () => {
    const src = await badgeImage()
    expect(await applyPhotoEdits(src, [])).toBe(src)
    await expect(applyPhotoEdits(src, [{ kind: 'fill', box: [35, 35, 10, 10], note: 'x' }])).rejects.toThrow('그림 밖')
  })

  it('둘레 평균은 상자 안 픽셀을 빼고 계산한다', () => {
    // 3×3 그림, 가운데 1칸 상자: 둘레 8칸 = 10, 가운데 = 250
    const data = Buffer.alloc(27, 10)
    data.fill(250, 12, 15)
    expect(ringAverage(data, { width: 3, height: 3, channels: 3 }, [1, 1, 1, 1])).toEqual({ r: 10, g: 10, b: 10 })
  })

  it('inpaint는 둘레에서 이어 채운다 — 단색 바탕은 그 색 그대로, 가로 그라데이션은 사각형 경계 없이 이어진다', async () => {
    const out = await applyPhotoEdits(await badgeImage(), [{ kind: 'inpaint', box: [15, 15, 10, 10], note: '배지' }])
    expect(await pixel(out, 20, 20)).toEqual([PINK.r, PINK.g, PINK.b])
    // 가로 그라데이션(x마다 회색 2씩) 가운데에 검은 배지 → 채운 칸은 같은 x의 바탕 값과 거의 같다
    const w = 60
    const grad = Buffer.alloc(w * w * 3)
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) grad.fill(60 + 2 * x, (y * w + x) * 3, (y * w + x) * 3 + 3)
    for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) grad.fill(0, (y * w + x) * 3, (y * w + x) * 3 + 3)
    const img = await sharp(grad, { raw: { width: w, height: w, channels: 3 } }).png().toBuffer()
    const filled = await applyPhotoEdits(img, [{ kind: 'inpaint', box: [20, 20, 20, 20], note: '배지' }])
    for (const x of [20, 30, 39]) expect(Math.abs((await pixel(filled, x, 30))[0] - (60 + 2 * x))).toBeLessThanOrEqual(2)
    expect(await pixel(filled, 10, 30)).toEqual([80, 80, 80])
  })

  it('blur feather는 상자 가장자리를 그대로 두고 안쪽만 흐린다, keepWhite는 흰 무늬를 흐리지 않는다', async () => {
    // 60×60 노랑 바탕, 가운데 세로 갈색 띠(글자 대신), 오른쪽에 흰 정사각(꽃잎 대신)
    const w = 60
    const yellow = [230, 180, 60]
    const buf = Buffer.alloc(w * w * 3)
    for (let i = 0; i < w * w; i++) buf.set(yellow, i * 3)
    for (let y = 0; y < w; y++) for (let x = 24; x < 32; x++) buf.set([90, 60, 40], (y * w + x) * 3)
    for (let y = 26; y < 34; y++) for (let x = 40; x < 48; x++) buf.set([255, 255, 255], (y * w + x) * 3)
    const img = await sharp(buf, { raw: { width: w, height: w, channels: 3 } }).png().toBuffer()
    const out = await applyPhotoEdits(img, [{ kind: 'blur', box: [4, 4, 52, 52], feather: 10, keepWhite: true, note: '브랜드' }])
    expect(await pixel(out, 28, 4)).toEqual([90, 60, 40]) // 상자 가장자리 — 페더 0이라 그대로(사각형 경계 없음)
    expect((await pixel(out, 28, 30))[0]).toBeGreaterThan(110) // 안쪽 갈색 띠는 바탕과 섞여 밝아졌다
    expect(await pixel(out, 44, 30)).toEqual([255, 255, 255]) // 흰 무늬는 그대로
  })
})
