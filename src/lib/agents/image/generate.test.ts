import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkMonthlyBudget, logUsage } from '@/lib/agents/budget'
import { maxReferencesOf } from './types'
import { fetchProviderJson, generateImage, GIF_CALL_POLICY, GIF_TOTAL_MAX_MS, gifCallPolicyOf, imageMimeOfBase64, PROVIDER_CALL_POLICY, registerImageCostListener, type ImageCostEvent } from './generate'
import {
  clearLocalBackendSoftStop,
  clearLocalImageBackends,
  LOCAL_BACKEND_SOFT_STOP_MARKER,
  peekLocalBackendSoftStop,
  registerLocalImageBackend,
} from './local-backend'
import {
  ALL_IMAGE_MODELS,
  animationRequestError,
  GIF_SHEET_MAX_PIXELS,
  gifSheetOf,
  IMAGE_MODELS,
  estimateImageCostUsd,
  imageCostFromUsage,
  isImageModel,
  isPdpImageModel,
  parseImageUsage,
} from './types'

vi.mock('@/lib/agents/budget', () => ({
  checkMonthlyBudget: vi.fn(),
  logUsage: vi.fn(),
}))

const REF = { base64: 'cmVm', mimeType: 'image/jpeg' }

beforeEach(() => {
  vi.mocked(checkMonthlyBudget).mockResolvedValue({ allowed: true, budgetUsd: 50, spentUsd: 1 } as never)
  vi.mocked(logUsage).mockResolvedValue(true)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  clearLocalImageBackends()
})

describe('codex-image 레지스트리 노출 범위', () => {
  it('내부 레지스트리에만 있고 사용자 선택지·검증은 거부한다', () => {
    expect(ALL_IMAGE_MODELS.some((m) => m.id === 'codex-image' && m.provider === 'local')).toBe(true)
    expect(IMAGE_MODELS.some((m) => (m.id as string) === 'codex-image')).toBe(false)
    expect(isImageModel('codex-image')).toBe(false)
    expect(estimateImageCostUsd('codex-image', 'high')).toBe(0)
  })
})

describe('generateImage — 참조 상한', () => {
  it('코덱스 6장은 백엔드를 부르지 않고 실패한다, 5장은 부른다', async () => {
    const backend = vi.fn().mockResolvedValue({ base64: 'AA', mimeType: 'image/png' })
    registerLocalImageBackend('codex-image', backend)
    const refs = (n: number) => Array.from({ length: n }, () => ({ base64: 'AA', mimeType: 'image/png' }))
    await expect(generateImage({ prompt: 'p', model: 'codex-image', referenceImages: refs(6) })).rejects.toThrow('상한 5장')
    expect(backend).not.toHaveBeenCalled()
    await generateImage({ prompt: 'p', model: 'codex-image', referenceImages: refs(5) })
    expect(backend).toHaveBeenCalledTimes(1)
  })

  it('GPT 이미지 17장은 API를 부르기 전에 실패한다 — 공식 상한 16', async () => {
    const refs = Array.from({ length: 17 }, () => ({ base64: 'AA', mimeType: 'image/png' }))
    await expect(generateImage({ prompt: 'p', model: 'gpt-image-2.5-sunburst', referenceImages: refs })).rejects.toThrow('상한 16장')
    expect(maxReferencesOf('gpt-image-2')).toBe(16)
    expect(maxReferencesOf('gemini-3-pro-image')).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('generateImage — codex-image', () => {
  it('미등록이면 예산 조회·기록 없이 명시 오류', async () => {
    await expect(generateImage({ prompt: 'p', model: 'codex-image' })).rejects.toThrow(/로컬 백엔드가 등록돼 있지 않습니다/)
    expect(checkMonthlyBudget).not.toHaveBeenCalled()
    expect(logUsage).not.toHaveBeenCalled()
  })

  it('등록된 백엔드를 부르고 예산 검사 없이 비용 0으로 기록한다', async () => {
    const backend = vi.fn().mockResolvedValue({ base64: 'aW1n', mimeType: 'image/png' })
    registerLocalImageBackend('codex-image', backend)
    const runContext = { runId: 'r1', userId: 'u1' }

    const result = await generateImage({
      prompt: 'p',
      model: 'codex-image',
      size: '1024x1536',
      quality: 'high',
      referenceImages: [REF],
      agentName: 'registration/pdp-image',
      runContext: runContext as never,
    })

    expect(result).toEqual({ base64: 'aW1n', mimeType: 'image/png', model: 'codex-image' })
    expect(backend).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'p', size: '1024x1536', referenceImages: [REF], agentName: 'registration/pdp-image' }),
    )
    expect(checkMonthlyBudget).not.toHaveBeenCalled()
    expect(logUsage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'codex-image', costUsd: 0, success: true, agent: 'registration/pdp-image', runContext }),
    )
  })

  it('size가 없으면 1024x1024를 넘긴다', async () => {
    const backend = vi.fn().mockResolvedValue({ base64: 'aW1n', mimeType: 'image/png' })
    registerLocalImageBackend('codex-image', backend)
    await generateImage({ prompt: 'p', model: 'codex-image' })
    expect(backend).toHaveBeenCalledWith(expect.objectContaining({ size: '1024x1024', referenceImages: [] }))
  })

  it('일반 실패는 비용 0 실패로 기록하고 그대로 던진다(소프트 종료 아님)', async () => {
    registerLocalImageBackend('codex-image', vi.fn().mockRejectedValue(new Error('codex-image 생성 실패(2회 시도): 산출 파일 없음')))
    await expect(generateImage({ prompt: 'p', model: 'codex-image' })).rejects.toThrow('산출 파일 없음')
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({ costUsd: 0, success: false }))
    expect(peekLocalBackendSoftStop()).toBeNull()
  })

  it('표지 없는 소프트 종료 오류도 표지를 붙여 던지고 기록한다', async () => {
    const error = Object.assign(new Error('한도'), { softStop: true, softStopReason: 'quota' })
    registerLocalImageBackend('codex-image', vi.fn().mockRejectedValue(error))
    await expect(generateImage({ prompt: 'p', model: 'codex-image' })).rejects.toThrow(`${LOCAL_BACKEND_SOFT_STOP_MARKER} quota: 한도`)
    expect(peekLocalBackendSoftStop()).toMatchObject({ model: 'codex-image', reason: 'quota' })
  })

  it('소프트 종료 기록이 있으면 지울 때까지 백엔드를 부르지 않는다', async () => {
    const backend = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { softStop: true, softStopReason: 'timeout' }))
      .mockResolvedValue({ base64: 'aW1n', mimeType: 'image/png' })
    registerLocalImageBackend('codex-image', backend)

    await expect(generateImage({ prompt: 'p', model: 'codex-image' })).rejects.toThrow(LOCAL_BACKEND_SOFT_STOP_MARKER)
    await expect(generateImage({ prompt: 'p', model: 'codex-image' })).rejects.toThrow(/소프트 종료 대기 중/)
    expect(backend).toHaveBeenCalledTimes(1)

    clearLocalBackendSoftStop()
    await expect(generateImage({ prompt: 'p', model: 'codex-image' })).resolves.toMatchObject({ model: 'codex-image' })
    expect(backend).toHaveBeenCalledTimes(2)
  })

  it('codex 소프트 종료 기록은 다른 모델 호출을 막지 않는다', async () => {
    registerLocalImageBackend(
      'codex-image',
      vi.fn().mockRejectedValue(Object.assign(new Error('한도'), { softStop: true, softStopReason: 'quota' })),
    )
    await expect(generateImage({ prompt: 'p', model: 'codex-image' })).rejects.toThrow(LOCAL_BACKEND_SOFT_STOP_MARKER)
    vi.stubEnv('GEMINI_API_KEY', 'g-test')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: 'Z2Vt', mimeType: 'image/png' } }] } }] }),
      }),
    )
    await expect(generateImage({ prompt: 'p', model: 'gemini-3.1-flash-image' })).resolves.toMatchObject({
      model: 'gemini-3.1-flash-image',
    })
    vi.unstubAllEnvs()
  })

  it('로컬 백엔드의 재작성 기록(trace)은 결과의 codexTrace로 넘긴다(E1)', async () => {
    const trace = { agentPrompt: 'p', agentPromptChars: 1, refs: 1, genSec: 30, calls: 1 }
    registerLocalImageBackend('codex-image', vi.fn().mockResolvedValue({ base64: 'aW1n', mimeType: 'image/png', trace }))
    await expect(generateImage({ prompt: 'p', model: 'codex-image' })).resolves.toMatchObject({ model: 'codex-image', codexTrace: trace })
  })

  it('빈 결과는 실패로 본다', async () => {
    registerLocalImageBackend('codex-image', vi.fn().mockResolvedValue({ base64: '', mimeType: 'image/png' }))
    await expect(generateImage({ prompt: 'p', model: 'codex-image' })).rejects.toThrow(/이미지 없이/)
  })
})

describe('generateImage — 다른 모델 경로 불변', () => {
  it('gpt-image-2는 예산 검사 후 단가로 기록하고 로컬 백엔드를 부르지 않는다', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const backend = vi.fn()
    registerLocalImageBackend('codex-image', backend)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ b64_json: 'b3V0' }] }) }),
    )

    const result = await generateImage({ prompt: 'p', model: 'gpt-image-2', quality: 'high' })

    // 계상 비용을 결과에도 싣는다(값은 지금과 같은 단가표 — 운영 계상 불변)
    expect(result).toEqual({ base64: 'b3V0', mimeType: 'image/png', model: 'gpt-image-2', costUsd: 0.211 })
    // 셋째 인자는 예산 풀 — runContext.costPool이 없으면 운영(undefined)
    expect(checkMonthlyBudget).toHaveBeenCalledWith('image/generate', 'gpt-image-2', undefined)
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-image-2', costUsd: 0.211, success: true }))
    expect(backend).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it('예산 소진이면 gemini 모델은 호출 전에 차단된다', async () => {
    vi.mocked(checkMonthlyBudget).mockResolvedValue({ allowed: false, budgetUsd: 50, spentUsd: 51 } as never)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateImage({ prompt: 'p', model: 'gemini-3.1-flash-image' })).rejects.toThrow(/소진/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('GPT Image 2.5 — 상세페이지 기본(sunburst)·실험(flare), usage 실비용', () => {
  const USAGE = { input_tokens: 1500, output_tokens: 6000, input_tokens_details: { text_tokens: 300, image_tokens: 1200 } }

  it('썸네일·소싱 선택지(isImageModel)에는 없고, PDP 새 잡은 sunburst만 받는다(flare는 하네스 전용)', () => {
    for (const id of ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']) {
      expect(ALL_IMAGE_MODELS.map((m) => m.id)).toContain(id)
      expect(IMAGE_MODELS.map((m) => m.id)).not.toContain(id)
      expect(isImageModel(id)).toBe(false)
    }
    expect(isPdpImageModel('gpt-image-2.5-sunburst')).toBe(true)
    expect(isPdpImageModel('gpt-image-2.6-sunburst')).toBe(true)
    expect(isPdpImageModel('gpt-image-2.5-flare')).toBe(false)
  })

  it('usage 해석과 실비용 — 텍스트 $5·이미지 입력 $8·이미지 출력 $30 per 1M, 세부가 없으면 입력을 텍스트로', () => {
    const usage = parseImageUsage(USAGE)!
    expect(usage).toEqual({ inputTokens: 1500, outputTokens: 6000, textInputTokens: 300, imageInputTokens: 1200 })
    expect(imageCostFromUsage(usage)).toBeCloseTo((300 * 5 + 1200 * 8 + 6000 * 30) / 1e6, 6)
    expect(parseImageUsage({ input_tokens: 100, output_tokens: 10 })).toEqual({ inputTokens: 100, outputTokens: 10, textInputTokens: 100, imageInputTokens: 0 })
    expect(parseImageUsage({ output_tokens: 10 })).toBeNull()
    expect(parseImageUsage(null)).toBeNull()
  })

  it.each(['gpt-image-2.5-sunburst', 'gpt-image-2.6-sunburst'] as const)('요청에 모델 id·품질을 그대로 넘기고, usage 실비용으로 기록·반환하며 비용 리스너에 알린다(%s — 2.6은 상세페이지 기본)', async (model) => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ b64_json: 'b3V0' }], usage: USAGE }) })
    vi.stubGlobal('fetch', fetchMock)
    const events: ImageCostEvent[] = []
    const off = registerImageCostListener((e) => events.push(e))

    const result = await generateImage({ prompt: 'p', model, quality: 'xhigh', size: '1024x1536', agentName: 'registration/pdp-image' })
    off()

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toMatchObject({ model, quality: 'xhigh', size: '1024x1536' })
    const cost = imageCostFromUsage(parseImageUsage(USAGE)!)
    expect(result).toMatchObject({ model, costUsd: cost, usage: { outputTokens: 6000 } })
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({ model, costUsd: cost, inputTokens: 1500, outputTokens: 6000 }))
    expect(events).toEqual([expect.objectContaining({ model, quality: 'xhigh', costUsd: cost, agentName: 'registration/pdp-image' })])
    vi.unstubAllEnvs()
  })

  it('참조가 있으면 edits(multipart)에도 모델 id를 넘기고, usage가 없으면 단가표(보수적 임시값)로 계상한다', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ b64_json: 'b3V0' }] }) })
    vi.stubGlobal('fetch', fetchMock)
    const result = await generateImage({ prompt: 'p', model: 'gpt-image-2.5-flare', quality: 'max', referenceImages: [REF] })
    const form = fetchMock.mock.calls[0][1].body as FormData
    expect(form.get('model')).toBe('gpt-image-2.5-flare')
    expect(form.get('quality')).toBe('max')
    expect(result.costUsd).toBe(estimateImageCostUsd('gpt-image-2.5-flare', 'max'))
    vi.unstubAllEnvs()
  })
})

// ─── 제공자 호출 시간 상한·일시 오류 재시도(NEXFIT 676209e·9ba3435) — 가짜 fetch, 유료 호출 0 ───

/** 신호가 끊길 때까지 응답하지 않는 제공자 — 끊기면 fetch처럼 TimeoutError로 거부한다 */
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new DOMException('aborted', 'TimeoutError')))
    })
  })
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

const FAST_POLICY = { totalMs: 2_000, backoffMs: [1, 1], minAttemptMs: 0 }

describe('fetchProviderJson — 시간 상한·재시도', () => {
  it('응답이 없으면 상한에서 끊고 시간 초과로 던진다', async () => {
    const fetchMock = hangingFetch()
    vi.stubGlobal('fetch', fetchMock)
    const started = Date.now()
    await expect(
      fetchProviderJson('테스트 생성', 'https://x.test', () => ({ method: 'POST' }), { totalMs: 50, backoffMs: [], minAttemptMs: 0 }),
    ).rejects.toThrow(/테스트 생성 시간 초과/)
    expect(Date.now() - started).toBeLessThan(1_500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('503·429는 백오프 뒤 다시 부르고, 성공하면 시도 수를 돌려준다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: { message: 'busy' } }))
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: 'rate' } }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ b64_json: 'b2s=' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const call = await fetchProviderJson<{ data: unknown[] }>('t', 'https://x.test', () => ({ method: 'POST' }), FAST_POLICY)
    expect(call).toMatchObject({ ok: true, status: 200, attempts: 3 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('재시도는 정책 횟수까지만 — 마지막 5xx 응답을 그대로 돌려준다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { error: { message: 'down' } }))
    vi.stubGlobal('fetch', fetchMock)
    const call = await fetchProviderJson('t', 'https://x.test', () => ({ method: 'POST' }), FAST_POLICY)
    expect(call).toMatchObject({ ok: false, status: 500, attempts: 3 })
  })

  it('400·401은 재시도하지 않는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: 'bad' } }))
    vi.stubGlobal('fetch', fetchMock)
    const call = await fetchProviderJson('t', 'https://x.test', () => ({ method: 'POST' }), FAST_POLICY)
    expect(call.attempts).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('남은 시간이 한 번 더 시도할 만큼 없으면 다시 부르지 않는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503, {}))
    vi.stubGlobal('fetch', fetchMock)
    const call = await fetchProviderJson('t', 'https://x.test', () => ({ method: 'POST' }), {
      totalMs: 1_000,
      backoffMs: [1],
      minAttemptMs: 5_000,
    })
    expect(call.attempts).toBe(1)
  })

  it('JSON이 아닌 오류 본문(게이트웨이 HTML)도 상태 코드로 판단한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => JSON.parse('<html>') } as unknown as Response)
      .mockResolvedValueOnce(jsonResponse(200, { ok: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    const call = await fetchProviderJson('t', 'https://x.test', () => ({ method: 'POST' }), FAST_POLICY)
    expect(call).toMatchObject({ ok: true, attempts: 2 })
  })

  it('기본 정책은 run 120초 안쪽 100초 상한·2회 재시도다', () => {
    expect(PROVIDER_CALL_POLICY.totalMs).toBe(100_000)
    expect(PROVIDER_CALL_POLICY.backoffMs).toHaveLength(2)
    expect(PROVIDER_CALL_POLICY.totalMs).toBeLessThan(120_000)
  })
})

describe('generateImage — 제공자 일시 오류 재시도', () => {
  it('gpt-image-2 503 → 성공이면 한 번만 과금 기록하고 시도 수를 남긴다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      vi.stubEnv('OPENAI_API_KEY', 'sk-test')
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(503, { error: { message: 'busy' } }))
        .mockResolvedValueOnce(jsonResponse(200, { data: [{ b64_json: 'b3V0' }] }))
      vi.stubGlobal('fetch', fetchMock)
      const pending = generateImage({ prompt: 'p', model: 'gpt-image-2', quality: 'high' })
      await vi.advanceTimersByTimeAsync(PROVIDER_CALL_POLICY.backoffMs[0])
      await expect(pending).resolves.toMatchObject({ base64: 'b3V0', model: 'gpt-image-2' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(logUsage).toHaveBeenCalledTimes(1)
      expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({ success: true, attempts: 2, costUsd: 0.211 }))
    } finally {
      vi.useRealTimers()
      vi.unstubAllEnvs()
    }
  })

  it('참조 첨부(edits)는 재시도마다 multipart 본문을 새로 만든다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      vi.stubEnv('OPENAI_API_KEY', 'sk-test')
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(500, {}))
        .mockResolvedValueOnce(jsonResponse(200, { data: [{ b64_json: 'b3V0' }] }))
      vi.stubGlobal('fetch', fetchMock)
      const pending = generateImage({ prompt: 'p', model: 'gpt-image-2', referenceImages: [REF] })
      await vi.advanceTimersByTimeAsync(PROVIDER_CALL_POLICY.backoffMs[0])
      await pending
      const [first, second] = fetchMock.mock.calls.map((c) => (c[1] as RequestInit).body)
      expect(first).toBeInstanceOf(FormData)
      expect(second).toBeInstanceOf(FormData)
      expect(first).not.toBe(second)
    } finally {
      vi.useRealTimers()
      vi.unstubAllEnvs()
    }
  })

  it('400은 재시도 없이 실패로 기록한다', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'g-test')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: 'invalid' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateImage({ prompt: 'p', model: 'gemini-3.1-flash-image' })).rejects.toThrow(/Gemini 이미지 생성 실패\(400\)/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({ success: false, costUsd: 0 }))
    vi.unstubAllEnvs()
  })
})

// ─── 움직이는 출력(GIF) — 상세페이지 GIF 칸(오너 2026-11-05 22:45), 가짜 fetch, 유료 호출 0 ───
const GIF_B64 = Buffer.from('GIF89a  ', 'latin1').toString('base64')
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')

describe('generateImage — 움직이는 출력(GIF)', () => {
  it('참조 사진(편집 multipart)에 output_format gif·frame_count·frame_duration_ms(10ms 반올림)를 글자로 넣고, 결과는 image/gif', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: GIF_B64 }] }) })
    vi.stubGlobal('fetch', fetchMock)
    const result = await generateImage({ prompt: 'p', model: 'gpt-image-2.6-sunburst', size: '768x768', quality: 'high', referenceImages: [REF], animation: { frameCount: 9, frameDurationMs: 204 } })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/images/edits')
    const form = fetchMock.mock.calls[0][1].body as FormData
    expect([form.get('output_format'), form.get('frame_count'), form.get('frame_duration_ms'), form.get('size'), form.get('quality')]).toEqual(['gif', '9', '200', '768x768', 'high'])
    expect(result.mimeType).toBe('image/gif')
    vi.unstubAllEnvs()
  })

  it('참조가 없으면 생성 JSON에 숫자로 넣는다', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: GIF_B64 }] }) })
    vi.stubGlobal('fetch', fetchMock)
    // 16프레임은 4×4 시트라 512²(시트 2,048²)여야 시트 한도 안이다
    await generateImage({ prompt: 'p', model: 'gpt-image-2.6-sunburst', size: '512x512', animation: { frameCount: 16, frameDurationMs: 2000 } })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/images/generations')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({ output_format: 'gif', frame_count: 16, frame_duration_ms: 2000, size: '512x512' })
    vi.unstubAllEnvs()
  })

  it('GIF를 달라고 했는데 정지 그림이 오면 실패로 기록하고 던진다(호출부가 대체 칸으로)', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG_B64 }] }) }))
    await expect(generateImage({ prompt: 'p', model: 'gpt-image-2.6-sunburst', size: '768x768', referenceImages: [REF], animation: { frameCount: 9, frameDurationMs: 200 } })).rejects.toThrow('GIF가 아닌 image/png')
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({ success: false, costUsd: 0 }))
    vi.unstubAllEnvs()
  })

  it.each([
    [{ model: 'gpt-image-2.5-sunburst', frameCount: 9, frameDurationMs: 200 }, 'GPT-Image 2.6만'],
    [{ model: 'codex-image', frameCount: 9, frameDurationMs: 200 }, 'GPT-Image 2.6만'],
    [{ model: 'gpt-image-2.6-sunburst', frameCount: 17, frameDurationMs: 200 }, '2~16만'],
    [{ model: 'gpt-image-2.6-sunburst', frameCount: 1, frameDurationMs: 200 }, '2~16만'],
    [{ model: 'gpt-image-2.6-sunburst', frameCount: 9, frameDurationMs: 10 }, '20~2000ms만'],
  ] as const)('범위 밖 요청은 예산 조회·호출 전에 막는다 %#', async (c, message) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateImage({ prompt: 'p', model: c.model, size: '768x768', animation: { frameCount: c.frameCount, frameDurationMs: c.frameDurationMs } })).rejects.toThrow(message)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(checkMonthlyBudget).not.toHaveBeenCalled()
  })

  // 세션 B ③ P6 — K5 P04 400("No supported sheet fits 9 GIF frames at size '1024x1024'. Invalid size '3072x3072'") 재발 막기
  it.each([
    [undefined, 9, "GIF 시트 3072x3072(프레임 1024x1024 × 9장)"],
    ['1024x1024', 9, 'GIF 시트 3072x3072'],
    ['768x768', 16, 'GIF 시트 3072x3072(프레임 768x768 × 16장)'],
    ['768x768', 10, 'GIF 시트 3072x3072'],
    ['auto', 9, "'WxH'로 정해야"],
  ] as const)('시트(올림(√프레임)칸 × 프레임 크기)가 실측으로 된 2,304²를 넘으면 예산 조회·호출 전에 막는다 — 크기 %s × %i프레임', async (size, frameCount, message) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateImage({ prompt: 'p', model: 'gpt-image-2.6-sunburst', ...(size ? { size } : {}), animation: { frameCount, frameDurationMs: 200 } })).rejects.toThrow(message)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(checkMonthlyBudget).not.toHaveBeenCalled()
  })

  it('시트 크기는 정사각 격자 — 9프레임 3×3, 16프레임 4×4, 10프레임도 4×4. 한도 2,304²는 768²×9(실측 성공)까지', () => {
    expect(gifSheetOf('768x768', 9)).toEqual({ width: 2304, height: 2304 })
    expect(gifSheetOf('768x768', 16)).toEqual({ width: 3072, height: 3072 })
    expect(gifSheetOf('512x768', 10)).toEqual({ width: 2048, height: 3072 })
    expect(gifSheetOf('auto', 9)).toBeNull()
    expect(GIF_SHEET_MAX_PIXELS).toBe(2304 * 2304)
    const ok = (size: string, frameCount: number) => animationRequestError('gpt-image-2.6-sunburst', { frameCount, frameDurationMs: 200 }, size)
    expect([ok('768x768', 9), ok('512x512', 9), ok('512x512', 16), ok('768x768', 4)]).toEqual([null, null, null, null])
    expect([ok('1024x1024', 9), ok('768x768', 16), ok('800x800', 9)].every((r) => r?.startsWith('GIF 시트'))).toBe(true)
  })

  it('정지 컷 요청에는 GIF 칸을 넣지 않는다(기존 본문 그대로)', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG_B64 }] }) })
    vi.stubGlobal('fetch', fetchMock)
    const result = await generateImage({ prompt: 'p', model: 'gpt-image-2.6-sunburst', referenceImages: [REF] })
    const form = fetchMock.mock.calls[0][1].body as FormData
    expect([form.get('output_format'), form.get('frame_count'), form.get('frame_duration_ms')]).toEqual([null, null, null])
    expect(result.mimeType).toBe('image/png')
    vi.unstubAllEnvs()
  })

  it('형식은 바이트로 판별한다(GIF·JPEG·WebP·그 밖은 PNG), GIF 정책은 150초·한 번 재시도', () => {
    expect(imageMimeOfBase64(GIF_B64)).toBe('image/gif')
    expect(imageMimeOfBase64(Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64'))).toBe('image/jpeg')
    expect(imageMimeOfBase64(Buffer.from('RIFF    WEBPVP8 ', 'latin1').toString('base64'))).toBe('image/webp')
    expect(imageMimeOfBase64(PNG_B64)).toBe('image/png')
    expect(imageMimeOfBase64('b3V0')).toBe('image/png')
    expect(GIF_CALL_POLICY).toEqual({ totalMs: 150_000, backoffMs: [5_000], minAttemptMs: 60_000 })
  })

  it('부르는 쪽 상한(totalMs)이 있으면 그 값으로 — 하네스 GIF 정책 300초를 넘기지 않고, 없거나 0이면 기본 150초', () => {
    expect(gifCallPolicyOf({})).toBe(GIF_CALL_POLICY)
    expect(gifCallPolicyOf({ totalMs: 0 })).toBe(GIF_CALL_POLICY)
    expect(gifCallPolicyOf({ totalMs: 200_000 })).toEqual({ totalMs: 200_000, backoffMs: [5_000], minAttemptMs: 60_000 })
    expect(gifCallPolicyOf({ totalMs: 900_000 }).totalMs).toBe(GIF_TOTAL_MAX_MS)
    expect(GIF_TOTAL_MAX_MS).toBe(300_000)
  })
})
