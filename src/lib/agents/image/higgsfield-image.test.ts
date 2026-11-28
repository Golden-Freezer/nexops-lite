/**
 * MS 2k 운영 공급자(R05) — 지시 덜어 내기·비율·참조 키우기·제출/이어 받기/기한·키 없음. 힉스필드는 가짜 클라이언트(유료 호출 0)
 */
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import type { createHiggsfieldClient, HiggsfieldResult, HiggsfieldSubmission } from './higgsfield'
import {
  fitHiggsfieldPrompt,
  generateHiggsfieldImage,
  HF_PROMPT_DROP_ORDER,
  HF_PROMPT_MAX,
  HF_REASON_MAX,
  HF_REF_UPSCALE_SIDE,
  higgsfieldIdempotencyKey,
  higgsfieldReasonOf,
  isHiggsfieldBalanceReason,
  MS2K_MODEL_PATH,
  msAspectOf,
  prepareReference,
} from './higgsfield-image'
import {
  IMAGE_PENDING_MAX_MS,
  IMAGE_PROVIDER_BALANCE_LABEL,
  ImageContentRejectedError,
  ImagePendingError,
  ImageProviderBalanceError,
  type GenImageInput,
} from './types'

const KEYS = { HF_API_KEY_ID: 'id-1', HF_API_KEY_SECRET: 'secret-1' }
const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

async function pngOf(width: number, height: number): Promise<string> {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 200, b: 200 } } }).png().toBuffer()
  return buf.toString('base64')
}

type Client = ReturnType<typeof createHiggsfieldClient>
function fakeClient(results: Array<HiggsfieldResult | null>) {
  const calls = { uploads: [] as string[], submits: [] as Array<{ path: string; body: Record<string, unknown>; key?: string }>, polls: [] as HiggsfieldSubmission[] }
  const client = {
    uploadReference: vi.fn(async (_bytes: Uint8Array, contentType: string) => {
      calls.uploads.push(contentType)
      return `https://cdn.higgsfield.test/ref-${calls.uploads.length}.png`
    }),
    submit: vi.fn(async (path: string, body: Record<string, unknown>, o: { idempotencyKey?: string } = {}) => {
      calls.submits.push({ path, body, key: o.idempotencyKey })
      return { requestId: 'req-1', statusUrl: 'https://api.higgsfield.ai/requests/req-1/status', submittedAt: 1_000, status: 'queued' }
    }),
    pollUntil: vi.fn(async (sub: HiggsfieldSubmission) => {
      calls.polls.push(sub)
      return results.shift() ?? null
    }),
    download: vi.fn(async () => PNG_BYTES),
    generate: vi.fn(),
    usage: vi.fn(),
  } as unknown as Client
  return { client, calls }
}
const done = (status: HiggsfieldResult['status'] = 'completed'): HiggsfieldResult => ({
  requestId: 'req-1',
  status,
  imageUrls: status === 'completed' ? ['https://cdn.higgsfield.test/out.png'] : [],
  raw: {},
  submittedAt: 1_000,
  finishedAt: 50_000,
  polls: 5,
})
const input = (extra: Partial<GenImageInput> = {}): GenImageInput => ({
  prompt: 'Premium studio photo of the product.',
  model: 'higgsfield-ms-2k',
  size: '1024x1536',
  referenceImages: [],
  runContext: { userId: 'u1', stage: 'images/hero' },
  ...extra,
})

describe('지시 덜어 내기(MS 5000자)', () => {
  it('상한 안이면 그대로', () => {
    expect(fitHiggsfieldPrompt('short')).toEqual({ prompt: 'short', dropped: [], originalLength: 5 })
  })

  it('운영 조립 지시 — 정해진 순서로 블록을 덜고 바탕 장면·식별 카드·부품·컷 지시는 남긴다', () => {
    const block = (head: string, n: number) => `${head}\n${'x'.repeat(n)}`
    const prompt = [
      block('Premium studio product photography', 1500),
      block('PRODUCT CONSISTENCY RULES (ABSOLUTE):', 900),
      block('VERIFICATION CHECKLIST BEFORE OUTPUT:', 300),
      block('PRODUCT IDENTITY (read from the photos)', 600),
      block('GLOBAL STYLE CHARTER (identical across ALL images)', 1500),
      block('[모바일 판독 기준] 뷰포트 390px', 550),
      block('[실측 디자인 레시피 — 역할별 중앙값]', 1300),
      block('REFERENCE ROLES: the FIRST attached image', 400),
      block('[Shot direction]', 300),
      block('PRODUCT PARTS (count them exactly)', 800),
    ].join('\n\n')
    expect(prompt.length).toBeGreaterThan(HF_PROMPT_MAX)
    const fit = fitHiggsfieldPrompt(prompt)
    expect(fit.prompt.length).toBeLessThanOrEqual(HF_PROMPT_MAX)
    expect(fit.originalLength).toBe(prompt.length)
    // 페이지용 → 헌장 → 검수 순서로 덜어 내고, 상한 안에 들면 멈춘다(일치 규칙은 남는다)
    expect(fit.dropped).toEqual(['[실측 디자인 레시피', '[모바일 판독 기준', 'GLOBAL STYLE CHARTER', 'VERIFICATION CHECKLIST'])
    for (const kept of ['Premium studio product photography', 'PRODUCT IDENTITY', 'REFERENCE ROLES', '[Shot direction]', 'PRODUCT PARTS', 'PRODUCT CONSISTENCY RULES']) {
      expect(fit.prompt).toContain(kept)
    }
  })

  it('첫 블록(바탕 장면)은 머리가 같아도 덜지 않는다', () => {
    const prompt = `GLOBAL STYLE CHARTER first\n${'a'.repeat(3000)}\n\nGLOBAL STYLE CHARTER again\n${'b'.repeat(3000)}`
    const fit = fitHiggsfieldPrompt(prompt)
    expect(fit.prompt.startsWith('GLOBAL STYLE CHARTER first')).toBe(true)
    expect(fit.prompt).not.toContain('again')
  })

  it('덜어도 넘으면 몰래 자르지 않고 오류', () => {
    expect(() => fitHiggsfieldPrompt(`scene\n${'x'.repeat(HF_PROMPT_MAX + 10)}`)).toThrow('보내지 않는다')
  })

  it('덜어 낼 머리 목록 — 남겨야 할 블록 머리는 들어 있지 않다', () => {
    for (const keep of ['PRODUCT IDENTITY', 'PRINTED MARKS', 'REFERENCE ROLES', '[Shot direction]', 'PRODUCT PARTS', 'Correct use']) {
      expect(HF_PROMPT_DROP_ORDER.some((head) => head.startsWith(keep) || keep.startsWith(head))).toBe(false)
    }
  })
})

describe('비율·참조', () => {
  it('컷 크기 → MS 비율', () => {
    expect(msAspectOf('1024x1536')).toBe('2:3')
    expect(msAspectOf('1536x1024')).toBe('3:2')
    expect(msAspectOf('1024x1024')).toBe('1:1')
    expect(msAspectOf(undefined)).toBe('1:1')
  })

  it('짧은 변 300 미만 원본은 512로 키워 PNG로 올린다(공급자 거절 방지), 충분하면 그대로', async () => {
    const small = await prepareReference({ base64: await pngOf(332, 296), mimeType: 'image/jpeg' })
    expect(small.upscaled).toBe(true)
    expect(small.contentType).toBe('image/png')
    const meta = await sharp(Buffer.from(small.bytes)).metadata()
    expect(Math.min(meta.width!, meta.height!)).toBe(HF_REF_UPSCALE_SIDE)
    const big = await prepareReference({ base64: await pngOf(800, 600), mimeType: 'image/png' })
    expect(big.upscaled).toBe(false)
  })

  it('제출 키 — 같은 본문·단계면 같고, 지시·참조 주소·단계 중 하나라도 다르면 다르다(R08a)', () => {
    const body = { prompt: 'p', aspect_ratio: '2:3', image_urls: ['https://cdn.higgsfield.test/ref-1.png'] }
    const a = higgsfieldIdempotencyKey(input(), body)
    expect(higgsfieldIdempotencyKey(input(), { ...body })).toBe(a)
    expect(higgsfieldIdempotencyKey(input(), { ...body, prompt: 'other' })).not.toBe(a)
    expect(higgsfieldIdempotencyKey(input(), { ...body, image_urls: ['https://cdn.higgsfield.test/ref-2.png'] })).not.toBe(a)
    expect(higgsfieldIdempotencyKey(input({ runContext: { userId: 'u1', stage: 'images/point_1' } }), body)).not.toBe(a)
  })

  it('WebP 참조는 같은 픽셀의 PNG로 올린다(R08a — 저장 상한을 넘어 WebP로 저장된 첫 화면 컷이 스타일 참조가 될 때)', async () => {
    const png = Buffer.from(await pngOf(640, 480), 'base64')
    const webp = await sharp(png).webp({ lossless: true }).toBuffer()
    const out = await prepareReference({ base64: webp.toString('base64'), mimeType: 'image/webp' })
    expect(out).toMatchObject({ contentType: 'image/png', upscaled: false, converted: true })
    const [a, b] = await Promise.all([sharp(png).raw().toBuffer(), sharp(Buffer.from(out.bytes)).raw().toBuffer()])
    expect(b.equals(a)).toBe(true)
    // PNG·JPEG 참조는 지금처럼 그대로
    const same = await prepareReference({ base64: png.toString('base64'), mimeType: 'image/png' })
    expect(same.converted).toBeUndefined()
    expect(Buffer.from(same.bytes).equals(png)).toBe(true)
  })
})

describe('generateHiggsfieldImage', () => {
  it('키가 없으면 명시 오류 — 키 값은 싣지 않는다', async () => {
    await expect(generateHiggsfieldImage(input(), { env: {} })).rejects.toThrow('HF_API_KEY_ID·HF_API_KEY_SECRET이 필요합니다')
  })

  it('제출 → 완료 → 받기: MS 경로·2k·비율·프롬프트 향상 끔·참조 주소, 제출 키', async () => {
    const { client, calls } = fakeClient([done()])
    const ref = { base64: await pngOf(332, 296), mimeType: 'image/png' }
    const out = await generateHiggsfieldImage(input({ referenceImages: [ref] }), { env: KEYS, client })
    expect(calls.submits).toHaveLength(1)
    expect(calls.submits[0].path).toBe(MS2K_MODEL_PATH)
    expect(calls.submits[0].body).toMatchObject({ quality: 'high', resolution: '2k', aspect_ratio: '2:3', enhance_prompt: false, image_urls: ['https://cdn.higgsfield.test/ref-1.png'] })
    expect(calls.submits[0].key).toBe(higgsfieldIdempotencyKey(input({ referenceImages: [ref] }), calls.submits[0].body))
    expect(out).toMatchObject({
      mimeType: 'image/png',
      requestId: 'req-1',
      statusUrl: 'https://api.higgsfield.ai/requests/req-1/status',
      submittedAt: new Date(1_000).toISOString(),
      upscaledRefs: 1,
      resumed: false,
    })
    expect(out.base64).toBe(PNG_BYTES.toString('base64'))
  })

  it('같은 컷을 다시 제출하면(다음 run 재시도) 참조를 새로 올려 새 키 — 같은 키·다른 본문(HTTP 422)이 생기지 않는다(R08a)', async () => {
    const { client, calls } = fakeClient([done(), done()])
    const ref = { base64: await pngOf(800, 600), mimeType: 'image/png' }
    const same = input({ referenceImages: [ref], runContext: { userId: 'u1', runId: 'job-1', stage: 'images/k4_photo_0' } })
    await generateHiggsfieldImage(same, { env: KEYS, client })
    await generateHiggsfieldImage(same, { env: KEYS, client })
    expect(calls.submits).toHaveLength(2)
    expect(calls.submits[0].body.image_urls).not.toEqual(calls.submits[1].body.image_urls)
    expect(calls.submits[0].key).not.toBe(calls.submits[1].key)
    // 키는 늘 그 본문의 키다(같은 본문이면 같은 키 — 힉스필드가 같은 요청을 돌려준다)
    for (const s of calls.submits) expect(s.key).toBe(higgsfieldIdempotencyKey(same, s.body))
  })

  it('게이트·구도 재생성은 첫 생성과 다른 새 키다 — 같은 지시·참조여도 단계가 다르고, 같은 단계로 다시 해도 참조 주소가 새로 바뀐다(R08a)', async () => {
    const { client, calls } = fakeClient([done(), done(), done(), done()])
    const ref = { base64: await pngOf(800, 600), mimeType: 'image/png' }
    const at = (stage: string) => input({ referenceImages: [ref], runContext: { userId: 'u1', runId: 'job-1', stage } })
    for (const stage of ['images/k4_photo_0', 'images/k4_photo_0/regenerate', 'images/k4_photo_0/angle', 'images/k4_photo_0/regenerate']) {
      await generateHiggsfieldImage(at(stage), { env: KEYS, client })
    }
    const keys = calls.submits.map((s) => s.key)
    expect(new Set(keys).size).toBe(4)
  })

  it('기한 안에 안 끝나면 ImagePendingError — 요청 ID·상태 주소·제출 시각을 돌려준다', async () => {
    const { client } = fakeClient([null])
    const err = await generateHiggsfieldImage(input({ deadlineAt: 5_000 }), { env: KEYS, client, now: () => 2_000 }).catch((e) => e)
    expect(err).toBeInstanceOf(ImagePendingError)
    expect(err.pending).toEqual({
      provider: 'higgsfield',
      model: 'higgsfield-ms-2k',
      requestId: 'req-1',
      statusUrl: 'https://api.higgsfield.ai/requests/req-1/status',
      submittedAt: new Date(1_000).toISOString(),
    })
  })

  it('이어 받기(resume) — 올리기·제출 없이 같은 상태 주소만 폴링한다(중복 과금 없음)', async () => {
    const { client, calls } = fakeClient([done()])
    const resume = { provider: 'higgsfield' as const, model: 'higgsfield-ms-2k' as const, requestId: 'req-9', statusUrl: 'https://api.higgsfield.ai/requests/req-9/status', submittedAt: new Date(10_000).toISOString() }
    const out = await generateHiggsfieldImage(input({ resume, referenceImages: [{ base64: await pngOf(800, 600), mimeType: 'image/png' }] }), { env: KEYS, client, now: () => 70_000 })
    expect(calls.uploads).toHaveLength(0)
    expect(calls.submits).toHaveLength(0)
    expect(calls.polls[0]).toMatchObject({ requestId: 'req-9', statusUrl: resume.statusUrl })
    expect(out.resumed).toBe(true)
    // 받은 요청의 상태 주소·제출 시각은 이어 받은 요청 그대로(받은 뒤 저장에 실패하면 이것으로 다시 받는다)
    expect(out).toMatchObject({ statusUrl: resume.statusUrl, submittedAt: resume.submittedAt })
  })

  it('너무 오래된 요청은 이어 받지 않고 오류', async () => {
    const { client, calls } = fakeClient([done()])
    const resume = { provider: 'higgsfield' as const, model: 'higgsfield-ms-2k' as const, requestId: 'req-9', statusUrl: 'https://api.higgsfield.ai/requests/req-9/status', submittedAt: new Date(0).toISOString() }
    await expect(generateHiggsfieldImage(input({ resume }), { env: KEYS, client, now: () => IMAGE_PENDING_MAX_MS + 1 })).rejects.toThrow('이어 받지 않음')
    expect(calls.polls).toHaveLength(0)
  })

  it('failed·nsfw는 오류(받지 않는다)', async () => {
    for (const status of ['failed', 'nsfw'] as const) {
      const { client } = fakeClient([done(status)])
      await expect(generateHiggsfieldImage(input(), { env: KEYS, client })).rejects.toThrow(status)
    }
  })

  it('nsfw만 ImageContentRejectedError(J60) — 글은 같고, failed는 일반 오류', async () => {
    const nsfw = await generateHiggsfieldImage(input(), { env: KEYS, client: fakeClient([done('nsfw')]).client }).catch((e: unknown) => e)
    expect(nsfw).toBeInstanceOf(ImageContentRejectedError)
    expect((nsfw as ImageContentRejectedError).status).toBe('nsfw')
    expect((nsfw as Error).message).toContain('req-1 nsfw')
    const failed = await generateHiggsfieldImage(input(), { env: KEYS, client: fakeClient([done('failed')]).client }).catch((e: unknown) => e)
    expect(failed).not.toBeInstanceOf(ImageContentRejectedError)
  })

  it('끝난 실패는 공급자 사유(앞 300자, 주소 지움)를 오류 글에 붙인다 — 잔액 부족이 아니면 일반 오류(R12c)', async () => {
    const { client } = fakeClient([{ ...done('failed'), raw: { status: 'failed', error: `upstream timeout at https://x.test/a?b=1 ${'y'.repeat(400)}` } }])
    const err = await generateHiggsfieldImage(input(), { env: KEYS, client }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ImageProviderBalanceError)
    const message = (err as Error).message
    expect(message).toContain('req-1 failed — upstream timeout at <주소>')
    expect(message).not.toContain('https://x.test')
    expect(message.length).toBeLessThan(`힉스필드 요청 req-1 failed — `.length + HF_REASON_MAX + 1)
  })

  it('잔액 부족(상태 failed·제출 HTTP 오류 모두)은 ImageProviderBalanceError — 사유를 그대로 싣는다(R12c, 11-09 R11 9컷)', async () => {
    const reason = 'Your credit balance is too low to complete this request. Please top up your balance and try again.'
    const polled = fakeClient([{ ...done('failed'), raw: { status: 'failed', error: reason } }])
    const err = await generateHiggsfieldImage(input(), { env: KEYS, client: polled.client }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ImageProviderBalanceError)
    expect((err as Error).message).toBe(`${IMAGE_PROVIDER_BALANCE_LABEL}: 힉스필드 요청 req-1 failed — ${reason}`)

    const rejected = fakeClient([])
    vi.mocked(rejected.client.submit).mockRejectedValueOnce(new Error(`힉스필드 POST ${MS2K_MODEL_PATH} HTTP 402: Insufficient credits`))
    const err2 = await generateHiggsfieldImage(input(), { env: KEYS, client: rejected.client }).catch((e: unknown) => e)
    expect(err2).toBeInstanceOf(ImageProviderBalanceError)
    expect(rejected.calls.polls).toHaveLength(0)
  })

  it('사유 꺼내기·잔액 부족 판정', () => {
    expect(higgsfieldReasonOf({ error: 'a', detail: 'b' })).toBe('a')
    expect(higgsfieldReasonOf({ detail: { code: 7 } })).toBe('{"code":7}')
    expect(higgsfieldReasonOf({ status: 'failed' })).toBe('')
    expect(higgsfieldReasonOf(null)).toBe('')
    expect(isHiggsfieldBalanceReason('Your credit balance is too low to complete this request.')).toBe(true)
    expect(isHiggsfieldBalanceReason('HTTP 402: insufficient balance')).toBe(true)
    expect(isHiggsfieldBalanceReason('internal error')).toBe(false)
  })

  it('지시가 덜어도 넘으면 올리기·제출 전에 오류', async () => {
    const { client, calls } = fakeClient([done()])
    await expect(generateHiggsfieldImage(input({ prompt: `scene\n${'x'.repeat(HF_PROMPT_MAX + 1)}` }), { env: KEYS, client })).rejects.toThrow('보내지 않는다')
    expect(calls.submits).toHaveLength(0)
  })
})
