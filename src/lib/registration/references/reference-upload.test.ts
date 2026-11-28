/**
 * 화면이 줄여 보낸 띠 입력 읽기 — 띠 수·합계 크기·위치·JPEG 머리 검사와 base64 변환을 고정한다.
 */

import { describe, expect, it } from 'vitest'
import { readStripUpload } from './reference-upload'

const jpeg = (bytes = 16) => {
  const b = new Uint8Array(bytes)
  b.set([0xff, 0xd8, 0xff])
  return b
}

function form(strips: Uint8Array<ArrayBuffer>[], positions: unknown) {
  const f = new FormData()
  strips.forEach((b, i) => f.append('strips', new File([b], `strip-${i + 1}.jpg`, { type: 'image/jpeg' })))
  if (positions !== undefined) f.append('positions', typeof positions === 'string' ? positions : JSON.stringify(positions))
  return f
}

describe('readStripUpload', () => {
  it('띠가 없으면 null(파일 입력으로 처리)', async () => {
    expect(await readStripUpload(new FormData())).toBeNull()
  })

  it('JPEG 띠와 위치 → ReferenceStrip(base64)', async () => {
    const out = await readStripUpload(form([jpeg(), jpeg()], [{ start: 0, end: 55.5 }, { start: 50, end: 100 }]))
    expect(out).toEqual({
      strips: [
        { data: Buffer.from(jpeg()).toString('base64'), mediaType: 'image/jpeg', start: 0, end: 55.5 },
        { data: Buffer.from(jpeg()).toString('base64'), mediaType: 'image/jpeg', start: 50, end: 100 },
      ],
    })
  })

  it.each([
    ['위치 없음', undefined],
    ['JSON 아님', 'not-json'],
    ['개수 다름', [{ start: 0, end: 100 }]],
    ['범위 밖', [{ start: 0, end: 50 }, { start: 40, end: 120 }]],
    ['끝이 시작보다 앞', [{ start: 0, end: 50 }, { start: 60, end: 40 }]],
  ] as const)('위치 오류(%s) → 거절', async (_, positions) => {
    expect(await readStripUpload(form([jpeg(), jpeg()], positions))).toEqual({ error: '띠 위치(positions)가 올바르지 않습니다.' })
  })

  it('JPEG가 아닌 띠 → 거절', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0])
    expect(await readStripUpload(form([png], [{ start: 0, end: 100 }]))).toEqual({ error: '띠는 JPEG만 받습니다.' })
  })

  it('16장 초과·합계 4MB 초과 → 거절', async () => {
    const many = Array.from({ length: 17 }, () => jpeg())
    const positions = many.map(() => ({ start: 0, end: 100 }))
    expect(await readStripUpload(form(many, positions))).toEqual({ error: '띠는 16장까지 받습니다.' })

    const big = [jpeg(2 * 1024 * 1024 + 1), jpeg(2 * 1024 * 1024)]
    const out = await readStripUpload(form(big, [{ start: 0, end: 50 }, { start: 50, end: 100 }]))
    expect(out).toMatchObject({ error: expect.stringContaining('띠 합계가 너무 큽니다') })
  })
})
