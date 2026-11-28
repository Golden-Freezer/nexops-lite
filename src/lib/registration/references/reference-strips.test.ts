import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { inspectPdf, planStrips, sliceReferenceImage, sniffReferenceType } from './reference-strips'

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 240, g: 230, b: 220 } } }).png().toBuffer()

describe('planStrips — 띠 계획(1,400px, 80px 겹침, 16장까지)', () => {
  it('짧은 페이지는 한 장', () => {
    expect(planStrips(1200)).toEqual({ strips: [{ top: 0, height: 1200 }], sampled: false })
  })

  it('겹쳐 자르고 마지막 띠는 페이지 끝에 맞춘다', () => {
    const { strips, sampled } = planStrips(4000)
    expect(sampled).toBe(false)
    expect(strips.map((s) => s.top)).toEqual([0, 1320, 2600])
    expect(strips.at(-1)!.top + strips.at(-1)!.height).toBe(4000)
  })

  it('16장을 넘으면 처음·끝을 포함해 균등 표집한다', () => {
    const { strips, sampled } = planStrips(40_000)
    expect(sampled).toBe(true)
    expect(strips).toHaveLength(16)
    expect(strips[0].top).toBe(0)
    expect(strips.at(-1)!.top).toBe(40_000 - 1400)
  })
})

describe('sliceReferenceImage — 폭 860으로 줄여 JPEG 띠', () => {
  it('긴 캡처를 띠로 자르고 세로 위치(%)를 단다', async () => {
    const out = await sliceReferenceImage(await png(1000, 5000))
    if ('error' in out) throw new Error(out.error)
    // 1000×5000 → 860×4300 → 띠 4장(0·1320·2640·2900)
    expect(out.strips).toHaveLength(4)
    expect(out.strips[0]).toMatchObject({ mediaType: 'image/jpeg', start: 0 })
    expect(out.strips.at(-1)!.end).toBe(100)
    const first = await sharp(Buffer.from(out.strips[0].data, 'base64')).metadata()
    expect([first.width, first.height, first.format]).toEqual([860, 1400, 'jpeg'])
  })

  it('좁은 캡처·읽을 수 없는 바이트는 거절한다', async () => {
    expect(await sliceReferenceImage(await png(400, 3000))).toEqual({ error: expect.stringContaining('최소 500px') })
    expect(await sliceReferenceImage(new Uint8Array([1, 2, 3]))).toEqual({ error: '이미지를 읽지 못했습니다.' })
  })
})

describe('inspectPdf — 머리와 쪽 수', () => {
  const pdf = (body: string) => new Uint8Array(Buffer.from(`%PDF-1.4\n${body}\n%%EOF`, 'latin1'))

  it('쪽 객체(/Type /Page)를 센다 — /Pages는 세지 않는다', () => {
    expect(inspectPdf(pdf('<< /Type /Pages /Count 3 >> << /Type /Page >> << /Type/Page >> << /Type /Page >>'))).toEqual({ pages: 3 })
  })

  it('쪽 객체가 압축돼 안 보이면 /Count 최댓값, 그것도 없으면 null', () => {
    expect(inspectPdf(pdf('<< /Count 12 >> << /Count 40 >>'))).toEqual({ pages: 40 })
    expect(inspectPdf(pdf('stream xx endstream'))).toEqual({ pages: null })
  })

  it('PDF 머리가 없으면 거절한다', () => {
    expect(inspectPdf(new Uint8Array(Buffer.from('hello')))).toEqual({ error: 'PDF 파일이 아닙니다.' })
  })
})

describe('sniffReferenceType', () => {
  it('PNG·JPEG·WebP는 image, %PDF-는 pdf, 나머지는 null', async () => {
    expect(sniffReferenceType(await png(10, 10))).toBe('image')
    expect(sniffReferenceType(await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).jpeg().toBuffer())).toBe('image')
    expect(sniffReferenceType(await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).webp().toBuffer())).toBe('image')
    expect(sniffReferenceType(new Uint8Array(Buffer.from('%PDF-1.7')))).toBe('pdf')
    expect(sniffReferenceType(new Uint8Array(Buffer.from('PK\u0003\u0004')))).toBeNull()
  })
})
