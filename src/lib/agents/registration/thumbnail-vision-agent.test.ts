/**
 * fetchImageAsBase64 — 참조·생성 이미지 내려받기 시간 상한(무응답 URL 하나가 run을 다 쓰지 않게). 가짜 fetch.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../_base', () => ({ callAgent: vi.fn() }))

import { fetchImageAsBase64, IMAGE_FETCH_TIMEOUT_MS } from './thumbnail-vision-agent'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchImageAsBase64 — 시간 상한', () => {
  it('응답이 없으면 상한에서 끊고 null(호출부가 유효분만 쓴다)', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const started = Date.now()
    await expect(fetchImageAsBase64('https://img.test/hang.png', 30)).resolves.toBeNull()
    expect(Date.now() - started).toBeLessThan(1_500)
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('정상 응답은 base64와 형식을 돌려준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })),
    )
    await expect(fetchImageAsBase64('https://img.test/a.png')).resolves.toEqual({ data: 'AQID', mediaType: 'image/png' })
  })

  it('기본 상한은 20~30초 사이다', () => {
    expect(IMAGE_FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(20_000)
    expect(IMAGE_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(30_000)
  })
})
