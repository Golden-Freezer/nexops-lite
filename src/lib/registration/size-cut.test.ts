import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { sizeLine } from './editor/utils/sectionConverter/designCut/sizeLines'
import { buildSizeSinglePrompt, measureProductBox, productBoxOfPixels } from './size-cut'

const WIDTH = 100
const HEIGHT = 200

/** 단색 바탕에 사각형 하나 그린 RGB 픽셀 */
function pixels(rect: { x: number; y: number; w: number; h: number } | null, background = 255, ink = 40): Uint8Array {
  const data = new Uint8Array(WIDTH * HEIGHT * 3).fill(background)
  if (!rect) return data
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) for (let c = 0; c < 3; c++) data[(y * WIDTH + x) * 3 + c] = ink
  return data
}

describe('productBoxOfPixels — 제품 경계', () => {
  it('단색 바탕 위 제품 경계를 비율로 낸다', () => {
    expect(productBoxOfPixels(pixels({ x: 20, y: 50, w: 40, h: 100 }), WIDTH, HEIGHT, 3)).toEqual({ left: 0.2, top: 0.25, width: 0.4, height: 0.5, aspect: 0.5, background: '#ffffff' })
  })

  it('바탕과 비슷한 제품 일부가 빠지면 믿지 못한다고 표시한다(R15 P11: 흰 스티커 위 인쇄만 잡힘)', () => {
    const data = pixels({ x: 50, y: 50, w: 30, h: 100 })
    // 경계 왼쪽의 옅은 부분 — 바탕과 15단계 차이(문턱 28 아래, 옅은 문턱 위)
    for (let y = 50; y < 150; y++) for (let x = 20; x < 50; x++) for (let c = 0; c < 3; c++) data[(y * WIDTH + x) * 3 + c] = 240
    expect(productBoxOfPixels(data, WIDTH, HEIGHT, 3)).toMatchObject({ left: 0.5, uncertain: true })
  })

  it('아래 변의 옅은 그림자는 믿음을 깎지 않는다', () => {
    const data = pixels({ x: 20, y: 50, w: 40, h: 100 })
    for (let y = 150; y < 190; y++) for (let x = 20; x < 60; x++) for (let c = 0; c < 3; c++) data[(y * WIDTH + x) * 3 + c] = 240
    expect(productBoxOfPixels(data, WIDTH, HEIGHT, 3)?.uncertain).toBeUndefined()
  })

  it('옅은 그림자·작은 잡티는 경계에 넣지 않는다', () => {
    const data = pixels({ x: 20, y: 50, w: 40, h: 100 })
    for (let x = 20; x < 60; x++) for (let c = 0; c < 3; c++) data[(160 * WIDTH + x) * 3 + c] = 235
    for (let c = 0; c < 3; c++) data[(10 * WIDTH + 90) * 3 + c] = 0
    expect(productBoxOfPixels(data, WIDTH, HEIGHT, 3)).toMatchObject({ left: 0.2, top: 0.25, width: 0.4, height: 0.5 })
  })

  it('제품이 없으면 null', () => {
    expect(productBoxOfPixels(pixels(null), WIDTH, HEIGHT, 3)).toBeNull()
  })

  it('프레임을 꽉 채우면 null — 경계를 잴 수 없다', () => {
    expect(productBoxOfPixels(pixels({ x: 1, y: 1, w: 98, h: 198 }), WIDTH, HEIGHT, 3)).toBeNull()
  })

  it('네 귀퉁이가 다르면(단색 바탕이 아니면) null', () => {
    const data = pixels({ x: 20, y: 50, w: 40, h: 100 })
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) for (let c = 0; c < 3; c++) data[(y * WIDTH + x) * 3 + c] = 90
    expect(productBoxOfPixels(data, WIDTH, HEIGHT, 3)).toBeNull()
  })
})

describe('measureProductBox — 실제 이미지', () => {
  it('PNG에서 경계를 잰다', async () => {
    const png = await sharp({ create: { width: 512, height: 768, channels: 3, background: '#ffffff' } })
      .composite([{ input: await sharp({ create: { width: 200, height: 400, channels: 3, background: '#223344' } }).png().toBuffer(), left: 156, top: 184 }])
      .png()
      .toBuffer()
    const box = await measureProductBox(png.toString('base64'))
    expect(box?.aspect).toBeCloseTo(0.667, 2)
    expect(box?.width).toBeCloseTo(200 / 512, 1)
    expect(box?.height).toBeCloseTo(400 / 768, 1)
  })

  it('이미지가 아니면 null', async () => {
    expect(await measureProductBox(Buffer.from('not image').toString('base64'))).toBeNull()
  })
})

describe('sizeLine — 치수선 자리', () => {
  const frame = { x: 100, y: 100, w: 300, h: 400 }
  // 3:4 사진 안 정중앙, 픽셀 비율 0.75
  const box = { left: 0.25, top: 0.25, width: 0.5, height: 0.5, aspect: 0.75 }
  const dims = (w: number, h: number, unit = 'mm') => [
    { axis: 'w', value: w, unit },
    { axis: 'h', value: h, unit },
  ]

  it('사진은 틀에 그대로 들어가고, 선은 제품 경계에 놓인다', () => {
    expect(sizeLine(frame, box, dims(75, 100))).toEqual({ x: 175, y: 200, w: 150, h: 200 })
  })

  it('사진 비율이 틀과 다르면 contain 자리에 맞춘다 — 2:3 사진은 좌우 여백이 생긴다', () => {
    const tall = { left: 0.25, top: 0.25, width: 0.5, height: 0.5, aspect: 2 / 3 }
    // 400 높이에 폭 267, 왼쪽 여백 약 17
    expect(sizeLine(frame, tall, dims(67, 100))).toEqual({ x: 183, y: 200, w: 133, h: 200 })
  })

  it('제품 비율이 입력과 20% 넘게 다르면 null — 두 개가 찍힌 사진 같은 경우 틀린 선을 긋지 않는다', () => {
    expect(sizeLine(frame, box, dims(57, 168))).toBeNull()
  })

  it('20% 안이면 선을 긋는다', () => {
    expect(sizeLine(frame, box, dims(85, 100))).not.toBeNull()
  })

  it('단위가 달라도 환산해 비교한다', () => {
    expect(sizeLine(frame, box, [{ axis: 'w', value: 7.5, unit: 'cm' }, { axis: 'h', value: 100, unit: 'mm' }])).not.toBeNull()
  })

  it('모르는 단위면 null', () => {
    expect(sizeLine(frame, box, [{ axis: 'w', value: 1, unit: '자' }, { axis: 'h', value: 1, unit: 'mm' }])).toBeNull()
  })

  it('경계를 못 쟀거나 믿기 어려우면 null', () => {
    expect(sizeLine(frame, null, dims(75, 100))).toBeNull()
    expect(sizeLine(frame, { ...box, uncertain: true }, dims(75, 100))).toBeNull()
  })

  it('치수 축이 없으면 null', () => {
    expect(sizeLine(frame, box, [])).toBeNull()
  })

  it('방향이 확실한 한 축은 비율을 볼 수 없어도 그 축 선을 긋는다', () => {
    expect(sizeLine(frame, box, [{ axis: 'h', value: 100, unit: 'mm' }])).toEqual({ x: 175, y: 200, w: 150, h: 200 })
  })
})

describe('buildSizeSinglePrompt', () => {
  it('제품 하나·전체 실루엣·입력 치수·표시 금지', () => {
    const prompt = buildSizeSinglePrompt({ productName: '머리빗', size: '57mm×168mm', bgMain: '#F0F0F0' })
    expect(prompt).toContain('Exactly ONE unit')
    expect(prompt).toContain('57mm×168mm')
    expect(prompt).toContain('#F0F0F0')
    expect(prompt).toContain('No rulers, arrows, lines, numbers or text')
  })
})
