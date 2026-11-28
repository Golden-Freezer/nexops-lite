/**
 * Nano Banana 2.1(블라인드 시험, 오너 2026-11-05 22:47) — 등록 범위·요청 본문·usage 실비용·키 가리기.
 * 운영 생성 폼 선택지에는 넣지 않는다(10-29 오너 방침, 통합 23:5x). 다른 Gemini 모델 요청은 지금 그대로다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkMonthlyBudget, logUsage } from '@/lib/agents/budget'
import { geminiRequestBody, generateImage, redactGeminiError, registerImageCostListener, type ImageCostEvent } from './generate'
import {
  ALL_IMAGE_MODELS,
  estimateImageCostUsd,
  geminiAspectOf,
  honorsImageSize,
  IMAGE_MODELS,
  imageCostFromUsage,
  isImageModel,
  isPdpImageModel,
  maxReferencesOf,
  parseGeminiUsage,
  PDP_IMAGE_MODELS,
} from './types'

vi.mock('@/lib/agents/budget', () => ({
  checkMonthlyBudget: vi.fn(),
  logUsage: vi.fn(),
}))

const NB = 'gemini-nano-banana-2.1' as const
const KEY = 'AIzaTESTKEY0000000000000000000000'
const USAGE = {
  promptTokenCount: 7000,
  candidatesTokenCount: 1700,
  thoughtsTokenCount: 1500,
  promptTokensDetails: [
    { modality: 'TEXT', tokenCount: 2000 },
    { modality: 'IMAGE', tokenCount: 5000 },
  ],
  candidatesTokensDetails: [
    { modality: 'IMAGE', tokenCount: 1680 },
    { modality: 'TEXT', tokenCount: 20 },
  ],
}

beforeEach(() => {
  vi.mocked(checkMonthlyBudget).mockResolvedValue({ allowed: true, budgetUsd: 50, spentUsd: 1 } as never)
  vi.mocked(logUsage).mockResolvedValue(true)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('등록 범위', () => {
  it('전체 목록에만 있고 생성 폼·썸네일 선택지에는 없다', () => {
    expect(ALL_IMAGE_MODELS.find((m) => m.id === NB)).toMatchObject({ provider: 'gemini' })
    expect(IMAGE_MODELS.some((m) => m.id === NB)).toBe(false)
    expect(PDP_IMAGE_MODELS.some((m) => m.id === NB)).toBe(false)
    expect(isPdpImageModel(NB)).toBe(false)
    expect(isImageModel(NB)).toBe(false)
  })

  it('참조 상한은 물체 10장, 예약 단가는 medium $0.07·high $0.09', () => {
    expect(maxReferencesOf(NB)).toBe(10)
    expect(estimateImageCostUsd(NB, 'medium')).toBe(0.07)
    expect(estimateImageCostUsd(NB, 'high')).toBe(0.09)
  })

  it('비율을 요청에 싣는 Gemini 모델은 Nano Banana 2.1뿐이다 — 상세페이지 단계 비율 줄 판정', () => {
    expect(honorsImageSize(NB)).toBe(true)
    expect(honorsImageSize('gemini-3-pro-image')).toBe(false)
    expect(honorsImageSize('gemini-3.1-flash-image')).toBe(false)
    expect(honorsImageSize('gpt-image-2.6-sunburst')).toBe(true)
    expect(honorsImageSize('codex-image')).toBe(true)
  })
})

describe('요청 본문', () => {
  it('크기 글을 가장 가까운 지원 비율로 바꾼다', () => {
    expect(geminiAspectOf('1024x1536')).toBe('2:3')
    expect(geminiAspectOf('1536x1024')).toBe('3:2')
    expect(geminiAspectOf('1024x1024')).toBe('1:1')
    expect(geminiAspectOf('768x1024')).toBe('3:4')
    expect(geminiAspectOf('1024x1820')).toBe('9:16')
    for (const bad of [undefined, '', 'auto', '0x100']) expect(geminiAspectOf(bad), String(bad)).toBeNull()
  })

  it('Nano Banana 2.1은 비율과 해상도(high 2K·medium 1K)를 싣고 생각 수준은 보내지 않는다(기본 medium)', () => {
    const high = JSON.parse(geminiRequestBody({ model: NB, prompt: 'p', size: '1024x1536', quality: 'high' }))
    expect(high.generationConfig).toEqual({ responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '2:3', imageSize: '2K' } })
    const medium = JSON.parse(geminiRequestBody({ model: NB, prompt: 'p', size: '1024x1024', quality: 'medium' }))
    expect(medium.generationConfig.imageConfig).toEqual({ aspectRatio: '1:1', imageSize: '1K' })
    expect(JSON.stringify(high)).not.toContain('thinking')
  })

  it('다른 Gemini 모델 본문은 글자까지 지금과 같다', () => {
    const ref = { base64: 'cmVm', mimeType: 'image/jpeg' }
    expect(geminiRequestBody({ model: 'gemini-3-pro-image', prompt: 'p', referenceImages: [ref], size: '1024x1536', quality: 'high' })).toBe(
      '{"contents":[{"parts":[{"inlineData":{"mimeType":"image/jpeg","data":"cmVm"}},{"text":"p"}]}],"generationConfig":{"responseModalities":["IMAGE"]}}'
    )
  })
})

describe('usage 실비용', () => {
  it('입력은 한 단가, 출력 이미지와 출력 글·생각은 따로 센다', () => {
    const usage = parseGeminiUsage(USAGE)!
    expect(usage).toEqual({ inputTokens: 7000, outputTokens: 1680, textInputTokens: 2000, imageInputTokens: 5000, textOutputTokens: 1520 })
    // 7000×1.5 + 1680×30 + 1520×7.5 = 10,500 + 50,400 + 11,400 (per 1M)
    expect(imageCostFromUsage(usage, NB)).toBe(0.0723)
  })

  it('출력 세부가 없으면 출력 전부를 이미지로 본다, 모양이 틀리면 null', () => {
    expect(parseGeminiUsage({ promptTokenCount: 100, candidatesTokenCount: 1000 })).toMatchObject({ outputTokens: 1000, textOutputTokens: 0, imageInputTokens: 0 })
    expect(parseGeminiUsage({ promptTokenCount: 'x' })).toBeNull()
    expect(parseGeminiUsage(null)).toBeNull()
  })

  it('OpenAI 모델 계상은 모델을 줘도 지금과 같다', () => {
    const openai = { inputTokens: 1000, outputTokens: 2000, textInputTokens: 600, imageInputTokens: 400 }
    expect(imageCostFromUsage(openai, 'gpt-image-2.6-sunburst')).toBe(imageCostFromUsage(openai))
  })
})

describe('generateImage — Nano Banana 2.1', () => {
  it('usage로 계상해 사용량 기록·비용 알림에 싣는다', async () => {
    vi.stubEnv('GEMINI_API_KEY', KEY)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: 'Z2Vt', mimeType: 'image/png' } }] } }], usageMetadata: USAGE }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: ImageCostEvent[] = []
    const off = registerImageCostListener((e) => events.push(e))
    const result = await generateImage({ prompt: 'p', model: NB, size: '1024x1536', quality: 'high', agentName: 'registration/pdp-image' })
    off()
    expect(result).toMatchObject({ model: NB, costUsd: 0.0723 })
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/models/${NB}:generateContent`)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig.imageConfig).toEqual({ aspectRatio: '2:3', imageSize: '2K' })
    expect(vi.mocked(logUsage).mock.calls[0][0]).toMatchObject({ model: NB, costUsd: 0.0723, inputTokens: 7000, outputTokens: 1680 })
    expect(events).toEqual([expect.objectContaining({ model: NB, quality: 'high', costUsd: 0.0723 })])
  })

  it('실패 응답·네트워크 오류 글에 키가 남지 않고 길이가 잘린다', async () => {
    vi.stubEnv('GEMINI_API_KEY', KEY)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: `bad key ${KEY} ${'x'.repeat(500)}` } }) })
    )
    const err = await generateImage({ prompt: 'p', model: NB }).catch((e: Error) => e)
    expect(String(err)).not.toContain(KEY)
    expect(String(err)).toContain('[key]')
    expect(String(err).length).toBeLessThan(400)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(`fetch failed https://x/models/${NB}:generateContent?key=${KEY}`)))
    const net = await generateImage({ prompt: 'p', model: NB }).catch((e: Error) => e)
    expect(String(net)).not.toContain(KEY)
    expect(redactGeminiError(`u?key=${KEY}&a=1`, undefined)).toBe('u?key=[key]&a=1')
  })

  it('이미지가 없는 응답은 끝난 사유를 붙여 실패로 남긴다', async () => {
    vi.stubEnv('GEMINI_API_KEY', KEY)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'IMAGE_SAFETY' }] }) }))
    await expect(generateImage({ prompt: 'p', model: NB })).rejects.toThrow('Gemini 응답에 이미지가 없습니다. (IMAGE_SAFETY)')
  })
})
