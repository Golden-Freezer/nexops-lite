import { describe, expect, it } from 'vitest'
import { createHiggsfieldClient, higgsfieldKeysFromEnv, imageUrlsOf, pollDelayMs } from './higgsfield'

type Call = { url: string; init?: RequestInit }

function fakeFetch(responses: Array<{ status?: number; body?: unknown }>) {
  const calls: Call[] = []
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const r = responses.shift() ?? { status: 500, body: { detail: 'no more' } }
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {})
    return new Response(text, { status: r.status ?? 200 })
  }
  return { calls, impl }
}

const opts = (fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, clock = { t: 0 }) => ({
  keyId: 'kid',
  keySecret: 'ksecret',
  fetchImpl,
  sleep: async (ms: number) => {
    clock.t += ms
  },
  now: () => clock.t,
  random: () => 0.5,
})

describe('higgsfield 클라이언트', () => {
  it('키 이름만 알리고 값은 싣지 않는다', () => {
    expect(() => higgsfieldKeysFromEnv({ HF_API_KEY_ID: 'a' })).toThrow('HF_API_KEY_SECRET')
    expect(higgsfieldKeysFromEnv({ HF_API_KEY_ID: ' a ', HF_API_KEY_SECRET: 'b' })).toEqual({ keyId: 'a', keySecret: 'b' })
  })

  it("SECRET 칸에 'ID:SECRET' 한 줄이 들어 있으면 앞의 ID:를 뗀다", () => {
    expect(higgsfieldKeysFromEnv({ HF_API_KEY_ID: 'kid', HF_API_KEY_SECRET: 'kid:sec' })).toEqual({ keyId: 'kid', keySecret: 'sec' })
    expect(higgsfieldKeysFromEnv({ HF_API_KEY_ID: 'kid', HF_API_KEY_SECRET: 'other:sec' })).toEqual({ keyId: 'kid', keySecret: 'other:sec' })
  })

  it('폴링 간격은 2초에서 10초까지 늘고 지터는 ±20%', () => {
    expect(pollDelayMs(0, () => 0.5)).toBe(2000)
    expect(pollDelayMs(1, () => 0.5)).toBe(3000)
    expect(pollDelayMs(20, () => 0.5)).toBe(10000)
    expect(pollDelayMs(0, () => 0)).toBe(1600)
    expect(pollDelayMs(0, () => 1)).toBe(2400)
  })

  it('이미지 주소는 images[].url에서 https만', () => {
    expect(imageUrlsOf({ images: [{ url: 'https://x/a.png' }, { url: 'http://x/b.png' }, 'https://x/c.png'] })).toEqual(['https://x/a.png', 'https://x/c.png'])
    expect(imageUrlsOf({})).toEqual([])
  })

  it('제출 → 폴링 → 완료, 인증 헤더는 힉스필드 주소에만', async () => {
    const f = fakeFetch([
      { body: { status: 'queued', request_id: 'r1', status_url: 'https://api.higgsfield.ai/requests/r1/status' } },
      { body: { status: 'in_progress', request_id: 'r1' } },
      { body: { status: 'completed', request_id: 'r1', images: [{ url: 'https://cdn.example/r1.png' }] } },
    ])
    const c = createHiggsfieldClient(opts(f.impl))
    const r = await c.generate('/marketing-studio/image/sunburst', { prompt: 'p' }, { idempotencyKey: 'k1' })
    expect(r).toMatchObject({ requestId: 'r1', status: 'completed', imageUrls: ['https://cdn.example/r1.png'], polls: 2 })
    expect(f.calls[0]!.url).toBe('https://api.higgsfield.ai/marketing-studio/image/sunburst')
    const h = f.calls[0]!.init!.headers as Record<string, string>
    expect(h.Authorization).toBe('Key kid:ksecret')
    expect(h['Idempotency-Key']).toBe('k1')
    expect(JSON.parse(String(f.calls[0]!.init!.body))).toEqual({ prompt: 'p' })
  })

  it('nsfw·failed도 종료 상태로 돌려준다(이미지 없음)', async () => {
    const f = fakeFetch([{ body: { status: 'queued', request_id: 'r2' } }, { body: { status: 'nsfw', request_id: 'r2' } }])
    const r = await createHiggsfieldClient(opts(f.impl)).generate('/m', { prompt: 'p' })
    expect(r.status).toBe('nsfw')
    expect(r.imageUrls).toEqual([])
    expect(f.calls[1]!.url).toBe('https://api.higgsfield.ai/requests/r2/status')
  })

  it('운영(R05): submit은 요청 정보만, pollUntil은 기한이 지나면 null(요청은 그대로) — 같은 상태 주소로 이어 받으면 완료', async () => {
    const clock = { t: 0 }
    const f = fakeFetch([
      { body: { status: 'queued', request_id: 'r7', status_url: 'https://api.higgsfield.ai/requests/r7/status' } },
      { body: { status: 'in_progress', request_id: 'r7' } },
      { body: { status: 'in_progress', request_id: 'r7' } },
      { body: { status: 'completed', request_id: 'r7', images: [{ url: 'https://cdn.example/r7.png' }] } },
    ])
    const c = createHiggsfieldClient(opts(f.impl, clock))
    const sub = await c.submit('/marketing-studio/image/sunburst', { prompt: 'p' }, { idempotencyKey: 'k7' })
    expect(sub).toEqual({ requestId: 'r7', statusUrl: 'https://api.higgsfield.ai/requests/r7/status', submittedAt: 0, status: 'queued' })
    expect(new Headers(f.calls[0]!.init?.headers).get('Idempotency-Key')).toBe('k7')
    // 기한 5초 — 2초·3초 폴링 두 번 뒤 기한이 지나 null
    expect(await c.pollUntil(sub, 5_000)).toBeNull()
    expect(f.calls).toHaveLength(3)
    // 다음 run — 다시 제출하지 않고 같은 상태 주소만 본다
    const r = await c.pollUntil(sub, clock.t + 60_000)
    expect(r).toMatchObject({ requestId: 'r7', status: 'completed', imageUrls: ['https://cdn.example/r7.png'] })
    expect(f.calls.slice(1).every((x) => x.url === 'https://api.higgsfield.ai/requests/r7/status')).toBe(true)
  })

  it('시간 한도를 넘기면 오류', async () => {
    const f = fakeFetch(Array.from({ length: 50 }, (_, i) => ({ body: { status: i === 0 ? 'queued' : 'in_progress', request_id: 'r3' } })))
    await expect(createHiggsfieldClient(opts(f.impl)).generate('/m', { prompt: 'p' }, { timeoutMs: 15_000 })).rejects.toThrow('끝나지 않음')
  })

  it('오류 응답은 사유만, 키는 메시지에 없다', async () => {
    const f = fakeFetch([{ status: 422, body: { detail: 'bad aspect' } }])
    const err = await createHiggsfieldClient(opts(f.impl)).generate('/m', { prompt: 'p' }).catch((e: Error) => e)
    expect(String(err)).toContain('HTTP 422: bad aspect')
    expect(String(err)).not.toContain('ksecret')
  })

  it('다른 주소의 status_url에는 키를 보내지 않는다', async () => {
    const f = fakeFetch([{ body: { status: 'queued', request_id: 'r4', status_url: 'https://evil.example/status' } }])
    await expect(createHiggsfieldClient(opts(f.impl)).generate('/m', { prompt: 'p' })).rejects.toThrow('기본 URL 밖')
    expect(f.calls).toHaveLength(1)
  })

  it('사용량 읽기: 모델별 건수·단가·비용을 숫자로', async () => {
    const f = fakeFetch([
      { body: { time_series: [{ bucket: '2026-11-06T00:00:00', results: [{ model: 'marketing-studio/image/sunburst', quantity: '1', unit_price: '0.0782', cost: '0.0782' }] }], total: 1 } },
    ])
    const rows = await createHiggsfieldClient(opts(f.impl)).usage('2026-11-06T00:00:00Z', '2026-11-07T00:00:00Z')
    expect(rows).toEqual([{ bucket: '2026-11-06T00:00:00', model: 'marketing-studio/image/sunburst', quantity: 1, unitPrice: 0.0782, cost: 0.0782 }])
    expect(f.calls[0]!.url).toContain('https://api.higgsfield.ai/models/usage?start=')
    expect(f.calls[0]!.url).toContain('expand=time_series')
  })

  it('참조 업로드: 주소 받기 → 자격 증명 없이 PUT → public_url', async () => {
    const f = fakeFetch([{ body: { upload_url: 'https://s3.example/put', upload_headers: { 'x-amz-acl': 'public-read' }, public_url: 'https://cdn.example/ref.jpg' } }, { body: '' }])
    const url = await createHiggsfieldClient(opts(f.impl)).uploadReference(new Uint8Array([1, 2, 3]), 'image/jpeg')
    expect(url).toBe('https://cdn.example/ref.jpg')
    expect(JSON.parse(String(f.calls[0]!.init!.body))).toEqual({ content_type: 'image/jpeg' })
    const put = f.calls[1]!.init!.headers as Record<string, string>
    expect(f.calls[1]!.init!.method).toBe('PUT')
    expect(put.Authorization).toBeUndefined()
    expect(put['x-amz-acl']).toBe('public-read')
  })
})
