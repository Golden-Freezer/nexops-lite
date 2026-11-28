import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenImageInput, ImageModel, ReferenceImage } from './types'

const h = vi.hoisted(() => ({
  codexImage: vi.fn(),
  logUsage: vi.fn(async (..._args: unknown[]) => true),
}))

vi.mock('@/lib/local-codex/image', async (orig) => {
  const real = await orig<typeof import('@/lib/local-codex/image')>()
  return { ...real, codexImage: (...args: unknown[]) => (h.codexImage as (...a: unknown[]) => unknown)(...args) }
})
vi.mock('@/lib/agents/budget', () => ({
  logUsage: (...args: unknown[]) => h.logUsage(...args),
}))

import { RateLimitedError } from '@/lib/local-codex/image'
import { generateImage } from './generate'

const refs: ReferenceImage[] = Array.from({ length: 7 }, (_, index) => ({
  base64: `ref-${index}`,
  mimeType: 'image/png',
}))
const input = (model: ImageModel): GenImageInput => ({
  prompt: '원목 도마를 정사각형 상품 사진으로',
  model,
  size: '1024x1024',
  quality: 'high',
  referenceImages: refs,
  agentName: 'test/generate-codex',
  runContext: { userId: 'user-1', stage: 'images/hero' },
})

beforeEach(() => {
  h.codexImage.mockReset().mockResolvedValue({ base64: 'generated', mimeType: 'image/png' })
  h.logUsage.mockClear()
})

describe('generateImage — 라이트 codexImage 단일 경로', () => {
  it.each(['codex-image', 'gpt-image-2', 'gemini-3-pro-image', 'higgsfield-ms-2k'] as const)(
    '모델 %s와 무관하게 codexImage를 부르고 참조를 앞 5장으로 자른다',
    async (model) => {
      const result = await generateImage(input(model))

      expect(h.codexImage).toHaveBeenCalledTimes(1)
      expect(h.codexImage).toHaveBeenCalledWith({
        prompt: '원목 도마를 정사각형 상품 사진으로',
        size: '1024x1024',
        referenceImages: refs.slice(0, 5),
        timeoutMs: 30 * 60_000,
      })
      expect(result).toEqual({ base64: 'generated', mimeType: 'image/png', model, costUsd: 0 })
      expect(h.logUsage).toHaveBeenCalledWith(expect.objectContaining({
        agent: 'test/generate-codex',
        model,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        success: true,
        attempts: 1,
      }))
    },
  )

  it('429 RateLimitedError를 같은 인스턴스로 다시 던지고 실패 사용량을 0토큰·0원으로 기록한다', async () => {
    const error = new RateLimitedError()
    h.codexImage.mockRejectedValue(error)

    await expect(generateImage(input('gpt-image-2'))).rejects.toBe(error)
    expect(h.codexImage).toHaveBeenCalledTimes(1)
    expect(h.logUsage).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-image-2',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      success: false,
      attempts: 1,
    }))
  })
})
