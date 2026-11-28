/**
 * 원본 합성 렌더(묶음 4) — NEXFIT photo_composite.py 이식의 결정론: 프레임 크기, 컷별 배경(그라데이션·짙은·단색), 제품 점유율·위치,
 * 접지 그림자, 원본 직접 배치의 테두리 색 채움·중앙 크롭. 실제 sharp로 렌더하고 PNG를 다시 읽어 픽셀을 본다(유료 0).
 */

import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  backdropRaw,
  borderColor,
  hexRgb,
  parseFrameSize,
  renderCutoutCut,
  renderDirectCut,
  type RgbaImage,
} from './composite-render'

const FRAME = { width: 200, height: 300 }
const PALETTE = { bgMain: '#F0E8D8', bgSub: '#C8D0B8' }

/** 가운데 빨간 세로 막대(20×60, 알파 255)·나머지 투명 — 세로로 길어 높이 점유율이 먼저 걸린다(가로 상한 78%는 아래 시험) */
function redSquare(size = 100): RgbaImage {
  const data = new Uint8Array(size * size * 4)
  for (let y = 20; y < 80; y++) {
    for (let x = 40; x < 60; x++) data.set([220, 20, 20, 255], (y * size + x) * 4)
  }
  return { data, width: size, height: size }
}

async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const at = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3))
  return { info, at, data }
}

/** 빨간 픽셀이 있는 행 범위 */
function redRows(data: Buffer, w: number, h: number): { top: number; bottom: number } {
  let top = -1
  let bottom = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      if (data[i] > 180 && data[i + 1] < 80) {
        if (top < 0) top = y
        bottom = y
        break
      }
    }
  }
  return { top, bottom }
}

describe('배경·도구', () => {
  it('프레임 크기는 생성 크기 문자열, 못 읽으면 1024×1536', () => {
    expect(parseFrameSize('1024x1024')).toEqual({ width: 1024, height: 1024 })
    expect(parseFrameSize('bad')).toEqual({ width: 1024, height: 1536 })
    expect(hexRgb('#0a0B0c', [0, 0, 0])).toEqual([10, 11, 12])
    expect(hexRgb('nope', [1, 2, 3])).toEqual([1, 2, 3])
  })

  it('gradient는 bgMain→bgSub, deep은 bgSub→그 음영(0.78), flat은 bgMain 단색', () => {
    const at = (raw: Uint8Array, y: number) => Array.from(raw.subarray(y * 4 * 3, y * 4 * 3 + 3))
    const g = backdropRaw(4, 3, PALETTE, 'gradient')
    expect(at(g, 0)).toEqual([240, 232, 216])
    expect(at(g, 2)).toEqual([200, 208, 184])
    const d = backdropRaw(4, 3, PALETTE, 'deep')
    expect(at(d, 0)).toEqual([200, 208, 184])
    expect(at(d, 2)).toEqual([156, 162, 144])
    const f = backdropRaw(4, 3, PALETTE, 'flat')
    expect(at(f, 0)).toEqual(at(f, 2))
    // 팔레트가 없으면 NEXFIT 기본색
    expect(at(backdropRaw(1, 1, {}, 'flat'), 0)).toEqual([247, 247, 245])
  })

  it('테두리가 균일하면 그 색, 고르지 않으면 null', () => {
    const uniform = { data: new Uint8Array(30 * 30 * 3).fill(250), width: 30, height: 30 }
    expect(borderColor(uniform)).toEqual([250, 250, 250])
    const noisy = new Uint8Array(30 * 30 * 3)
    for (let i = 0; i < noisy.length; i += 3) noisy.set(i % 2 ? [0, 0, 0] : [255, 255, 255], i)
    expect(borderColor({ data: noisy, width: 30, height: 30 })).toBeNull()
  })
})

describe('누끼 제품 컷(renderCutoutCut)', () => {
  it('hero: 프레임 크기·그라데이션 배경·제품 높이 58%·가운데·아래쪽 접지 그림자', async () => {
    const png = await renderCutoutCut({ cutout: redSquare(), section: 'hero', frame: FRAME, palette: PALETTE })
    const { info, at, data } = await pixels(png)
    expect([info.width, info.height]).toEqual([200, 300])
    expect(at(100, 0)).toEqual([240, 232, 216])
    const { top, bottom } = redRows(data, 200, 300)
    expect(bottom - top + 1).toBe(Math.round(300 * 0.58))
    expect(top).toBe(Math.round((300 - 174) * 0.46))
    expect(at(100, 150)).toEqual([220, 20, 20])
    // 제품 바로 아래는 그림자로 배경보다 어둡고, 제품에서 먼 위쪽 가장자리는 배경 그대로다
    const bgColumn = backdropRaw(1, 300, PALETTE, 'gradient')
    expect(at(100, bottom + 3)[0]).toBeLessThan(bgColumn[(bottom + 3) * 3])
    expect(at(5, 5)).toEqual(Array.from(bgColumn.subarray(5 * 3, 5 * 3 + 3)))
  })

  it('컷마다 다르다 — premium_hero는 짙은 배경·66%, product_exposure는 단색·50%', async () => {
    const premium = await pixels(
      await renderCutoutCut({ cutout: redSquare(), section: 'premium_hero', frame: FRAME, palette: PALETTE })
    )
    expect(premium.at(100, 0)).toEqual([200, 208, 184])
    const pr = redRows(premium.data, 200, 300)
    expect(pr.bottom - pr.top + 1).toBe(Math.round(300 * 0.66))
    const exposure = await pixels(
      await renderCutoutCut({ cutout: redSquare(), section: 'product_exposure', frame: FRAME, palette: PALETTE })
    )
    expect(exposure.at(0, 0)).toEqual(exposure.at(0, 299))
    const er = redRows(exposure.data, 200, 300)
    expect(er.bottom - er.top + 1).toBe(Math.round(300 * 0.5))
  })

  it('가로가 긴 제품은 가로 78% 상한에 맞춘다', async () => {
    const wide = new Uint8Array(100 * 20 * 4)
    for (let p = 0; p < 100 * 20; p++) wide.set([220, 20, 20, 255], p * 4)
    const { data } = await pixels(
      await renderCutoutCut({
        cutout: { data: wide, width: 100, height: 20 },
        section: 'hero',
        frame: FRAME,
        palette: PALETTE,
      })
    )
    let minX = 200
    let maxX = -1
    for (let x = 0; x < 200; x++) {
      const i = (150 * 200 + x) * 3
      if (data[i] > 180 && data[i + 1] < 80) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
      }
    }
    expect(maxX - minX + 1).toBe(Math.round(200 * 0.78))
  })

  it('바탕의 잔여 알파(5 이하)는 버린다 — 제품 상자가 사진 전체로 넓어지지 않는다', async () => {
    const hazy = redSquare()
    for (let i = 3; i < hazy.data.length; i += 4) if (hazy.data[i] === 0) hazy.data[i] = 3
    const { data } = await pixels(
      await renderCutoutCut({ cutout: hazy, section: 'hero', frame: FRAME, palette: PALETTE })
    )
    const { top, bottom } = redRows(data, 200, 300)
    expect(bottom - top + 1).toBe(Math.round(300 * 0.58))
  })

  it('디자인 컷 잡(solid)은 짙은 그라데이션 대신 컷 바탕 단색이다', async () => {
    const { at } = await pixels(
      await renderCutoutCut({
        cutout: redSquare(),
        section: 'premium_hero',
        frame: FRAME,
        palette: PALETTE,
        solid: true,
      })
    )
    expect(at(5, 0)).toEqual([240, 232, 216])
    expect(at(5, 299)).toEqual([240, 232, 216])
  })

  it('불투명 영역이 없으면 던진다(호출부가 그 컷을 생성 경로로)', async () => {
    const empty = { data: new Uint8Array(10 * 10 * 4), width: 10, height: 10 }
    await expect(renderCutoutCut({ cutout: empty, section: 'hero', frame: FRAME, palette: PALETTE })).rejects.toThrow()
  })
})

describe('K 칸 합성 모양(결정 카드 c18·J29)', () => {
  it('k_solo는 단색·62%, k_label은 단색·74%(글자가 읽히게 크게) — 셋 모두 컷 바탕 단색 위', async () => {
    const solo = await pixels(await renderCutoutCut({ cutout: redSquare(), section: 'k_solo', frame: FRAME, palette: PALETTE }))
    const sr = redRows(solo.data, 200, 300)
    expect(sr.bottom - sr.top + 1).toBe(Math.round(300 * 0.62))
    expect(solo.at(0, 0)).toEqual(solo.at(0, 299))
    const label = await pixels(await renderCutoutCut({ cutout: redSquare(), section: 'k_label', frame: FRAME, palette: PALETTE }))
    const lr = redRows(label.data, 200, 300)
    expect(lr.bottom - lr.top + 1).toBe(Math.round(300 * 0.74))
  })

  it('k_detail은 제품 가운데를 크게 — 제품이 프레임 위아래를 넘쳐 가운데 줄이 꽉 찬다(누끼·직접 배치 모두)', async () => {
    const detail = await pixels(await renderCutoutCut({ cutout: redSquare(), section: 'k_detail', frame: FRAME, palette: PALETTE }))
    const dr = redRows(detail.data, 200, 300)
    expect([dr.top, dr.bottom]).toEqual([0, 299])
    expect(detail.at(100, 0)).toEqual([220, 20, 20])
    const photo = { data: new Uint8Array(100 * 100 * 3).fill(90), width: 100, height: 100 }
    for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) photo.data.set([220, 20, 20], (y * 100 + x) * 3)
    const direct = await pixels(await renderDirectCut({ photo, section: 'k_detail', frame: FRAME, palette: PALETTE }))
    const hero = await pixels(await renderDirectCut({ photo, section: 'hero', frame: FRAME, palette: PALETTE }))
    const reds = (d: Buffer) => { let n = 0; for (let i = 0; i < d.length; i += 3) if (d[i] > 180 && d[i + 1] < 80) n++; return n }
    expect(reds(direct.data)).toBeGreaterThan(reds(hero.data) * 2)
  })
})

describe('원본 직접 배치(renderDirectCut)', () => {
  /** 흰 테두리(균일) 사진 — 가운데 파란 사각 */
  function photo(): { data: Uint8Array; width: number; height: number } {
    const w = 100
    const data = new Uint8Array(w * w * 3).fill(250)
    for (let y = 30; y < 70; y++) for (let x = 30; x < 70; x++) data.set([20, 20, 220], (y * w + x) * 3)
    return { data, width: w, height: w }
  }

  it('테두리가 균일하면 여백을 그 색으로 채우고 원본을 가운데 둔다(fit 86%)', async () => {
    const { info, at } = await pixels(
      await renderDirectCut({ photo: photo(), section: 'hero', frame: FRAME, palette: PALETTE })
    )
    expect([info.width, info.height]).toEqual([200, 300])
    expect(at(0, 0)).toEqual([250, 250, 250])
    expect(at(100, 150)).toEqual([20, 20, 220])
  })

  it('product_exposure는 중앙 82%를 잘라 더 가깝게 담는다', async () => {
    const hero = await pixels(
      await renderDirectCut({ photo: photo(), section: 'hero', frame: FRAME, palette: PALETTE })
    )
    const close = await pixels(
      await renderDirectCut({ photo: photo(), section: 'product_exposure', frame: FRAME, palette: PALETTE })
    )
    const blueWidth = (p: Awaited<ReturnType<typeof pixels>>) => {
      let n = 0
      for (let x = 0; x < 200; x++) if (p.at(x, 150)[2] > 180 && p.at(x, 150)[0] < 80) n++
      return n
    }
    expect(blueWidth(close)).toBeGreaterThan(blueWidth(hero))
  })

  it('디자인 컷 잡(solid)은 사진 테두리 색 대신 컷 바탕 단색을 쓴다', async () => {
    const { at } = await pixels(
      await renderDirectCut({ photo: photo(), section: 'hero', frame: FRAME, palette: PALETTE, solid: true })
    )
    expect(at(0, 0)).toEqual([240, 232, 216])
  })

  it('테두리가 고르지 않으면 팔레트 배경을 쓴다', async () => {
    const p = photo()
    for (let x = 0; x < 100; x += 2) p.data.set([0, 0, 0], x * 3)
    for (let x = 0; x < 100; x += 2) p.data.set([0, 0, 0], (99 * 100 + x) * 3)
    const { at } = await pixels(await renderDirectCut({ photo: p, section: 'hero', frame: FRAME, palette: PALETTE }))
    expect(at(100, 0)).toEqual([240, 232, 216])
  })
})
