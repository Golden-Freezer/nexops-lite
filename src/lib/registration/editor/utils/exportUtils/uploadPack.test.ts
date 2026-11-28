/**
 * 업로드 준비 묶음(exportUtils/uploadPack.ts, AX-CT-37) — 이름 순서·미리보기 없음·안내 글·투명도 없는 판 실패 시 원본+알림·서버 요청.
 * ZIP·서버는 가짜로 둔다. 네트워크·저장 0.
 */

import { describe, expect, it, vi } from 'vitest'
import { buildUploadPack, requestOpaqueWebp, UPLOAD_GUIDE_NAME, uploadPackGuide, uploadPackName, type PackPart } from './uploadPack'

const jpg = (s: string): PackPart => ({ blob: new Blob([s], { type: 'image/jpeg' }), mime: 'image/jpeg' })
const webp = (s: string): PackPart => ({ blob: new Blob([s], { type: 'image/webp' }), mime: 'image/webp' })

type ZipFile = { name: string; blob: Blob }

function fakeZip() {
  const seen: ZipFile[][] = []
  const zip = vi.fn(async (files: ZipFile[]) => {
    seen.push(files)
    return new Blob(['zip'])
  })
  return { seen, zip }
}

describe('uploadPackName', () => {
  it('올릴 순서 두 자리, 99장 넘으면 세 자리', () => {
    expect(uploadPackName(0, 5, 'jpg')).toBe('01.jpg')
    expect(uploadPackName(9, 12, 'webp')).toBe('10.webp')
    expect(uploadPackName(0, 100, 'jpg')).toBe('001.jpg')
  })
})

describe('buildUploadPack', () => {
  it('굽기 순서대로 01.webp·02.jpg… + 올리는 법.txt 만 담고, 움직이는 칸은 투명도 없는 판으로 바꾼다', async () => {
    const { seen, zip } = fakeZip()
    const opaque = vi.fn(async (b: Blob) => new Blob([`opaque:${await b.text()}`], { type: 'image/webp' }))
    const pack = await buildUploadPack([webp('m0'), jpg('a'), jpg('b'), webp('m1'), jpg('c')], '구디백', { opaque, zip })
    expect(pack.files).toEqual(['01.webp', '02.jpg', '03.jpg', '04.webp', '05.jpg'])
    expect(pack.motionFiles).toEqual(['01.webp', '04.webp'])
    expect(pack.notes).toEqual([])
    expect(opaque).toHaveBeenCalledTimes(2)
    const files = seen[0]
    // 미리보기(-full-preview)·옛 이름(-detail-full-) 없음, 안내 글은 맨 끝 하나
    expect(files.map((f) => f.name)).toEqual([...pack.files, UPLOAD_GUIDE_NAME])
    expect(await files[0].blob.text()).toBe('opaque:m0')
    expect(await files[1].blob.text()).toBe('a')
    expect(await files[3].blob.text()).toBe('opaque:m1')
    const guide = await files[5].blob.text()
    expect(guide).toContain('구디백')
    expect(guide).toContain('01.webp → 02.jpg → 03.jpg → 04.webp → 05.jpg')
    expect(guide).toContain('움직이는 칸: 01.webp, 04.webp')
    expect(guide).not.toContain('알림')
    expect(pack.zip).toBeInstanceOf(Blob)
  })

  it('투명도 없는 판으로 못 바꾸면 원본을 넣고 알림을 남긴다(묶음은 만든다)', async () => {
    const { seen, zip } = fakeZip()
    const opaque = vi.fn(async (): Promise<Blob> => {
      throw new Error('HTTP 422')
    })
    const pack = await buildUploadPack([jpg('a'), webp('m')], '상품', { opaque, zip })
    expect(pack.files).toEqual(['01.jpg', '02.webp'])
    expect(await seen[0][1].blob.text()).toBe('m')
    expect(pack.notes).toHaveLength(1)
    expect(pack.notes[0]).toContain('02.webp')
    expect(pack.notes[0]).toContain('HTTP 422')
    const guide = await seen[0][2].blob.text()
    expect(guide).toContain('알림')
    expect(guide).toContain('- 02.webp: 투명도 없는 판으로 바꾸지 못해 원본을 넣었습니다')
  })

  it('움직이는 칸이 없으면 서버를 부르지 않고, 조각이 없으면 던진다', async () => {
    const { zip } = fakeZip()
    const opaque = vi.fn(async (b: Blob) => b)
    const pack = await buildUploadPack([jpg('a')], '상품', { opaque, zip })
    expect(opaque).not.toHaveBeenCalled()
    expect(pack.motionFiles).toEqual([])
    await expect(buildUploadPack([], '상품', { opaque, zip })).rejects.toThrow('구운 전체 이미지가 없습니다')
  })
})

describe('uploadPackGuide', () => {
  it('이미지 업로드 방식·바꾸기 전 캡처·되돌리기·이 글은 올리지 않음을 적는다(줄끝 CRLF)', () => {
    const g = uploadPackGuide({ productName: 'P', fileNames: ['01.jpg'], motionFiles: [], notes: [] })
    expect(g).toContain("'이미지 업로드'")
    expect(g).toContain('캡처')
    expect(g).toContain('되돌리기')
    expect(g).toContain(`${UPLOAD_GUIDE_NAME})은 올리지 않습니다`)
    expect(g).toContain('움직이는 칸: 없음')
    expect(g.split('\r\n').length).toBeGreaterThan(5)
    expect(g.replace(/\r\n/g, '')).not.toContain('\n')
  })
})

describe('requestOpaqueWebp', () => {
  it('잡 경로로 POST 하고 image/webp 응답을 Blob 으로', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([7, 8]), { status: 200, headers: { 'content-type': 'image/webp' } }))
    const out = await requestOpaqueWebp('job/1', new Blob(['x']), fetchImpl as unknown as typeof fetch)
    expect(fetchImpl).toHaveBeenCalledWith('/api/registration/pdp/job%2F1/opaque-webp', expect.objectContaining({ method: 'POST' }))
    expect(out.type).toBe('image/webp')
    expect(new Uint8Array(await out.arrayBuffer())).toEqual(new Uint8Array([7, 8]))
  })

  it('오류 응답은 서버 error 글로, 글이 없으면 HTTP 코드로 던진다', async () => {
    const f422 = vi.fn(async () => new Response(JSON.stringify({ error: '프레임 1장' }), { status: 422, headers: { 'content-type': 'application/json' } }))
    await expect(requestOpaqueWebp('j', new Blob(['x']), f422 as unknown as typeof fetch)).rejects.toThrow('프레임 1장')
    const f500 = vi.fn(async () => new Response('oops', { status: 500 }))
    await expect(requestOpaqueWebp('j', new Blob(['x']), f500 as unknown as typeof fetch)).rejects.toThrow('HTTP 500')
    // 200 이어도 webp 가 아니면 던진다
    const fJson = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(requestOpaqueWebp('j', new Blob(['x']), fJson as unknown as typeof fetch)).rejects.toThrow('HTTP 200')
  })
})
