/**
 * generateImage — 힉스필드 MS 2k 경로(R05). 공급자 모듈은 모의, 예산·사용량 기록도 모의(유료 호출 0).
 * 비용은 완료 때 한 번(단가표), 기한을 넘긴 요청은 기록 없이 그대로 돌려주고, 이어 받기는 예산 검사를 건너뛴다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ hf: vi.fn() }))
vi.mock('@/lib/agents/budget', () => ({ checkMonthlyBudget: vi.fn(), logUsage: vi.fn() }))
vi.mock('./higgsfield-image', () => ({ generateHiggsfieldImage: (...args: unknown[]) => h.hf(...args) }))

import { checkMonthlyBudget, logUsage } from '@/lib/agents/budget'
import { generateImage } from './generate'
import { estimateImageCostUsd, ImagePendingError, isAsyncImageModel, IMAGE_MODELS, PDP_IMAGE_MODELS, type ImagePendingRequest } from './types'

const pending: ImagePendingRequest = {
  provider: 'higgsfield',
  model: 'higgsfield-ms-2k',
  requestId: 'req-1',
  statusUrl: 'https://api.higgsfield.ai/requests/req-1/status',
  submittedAt: '2026-11-08T01:00:00.000Z',
}

beforeEach(() => {
  vi.mocked(checkMonthlyBudget).mockReset().mockResolvedValue({ allowed: true, budgetUsd: 300, spentUsd: 1 } as never)
  vi.mocked(logUsage).mockReset().mockResolvedValue(true)
  h.hf.mockReset()
})

describe('MS 2k 레지스트리', () => {
  it('비동기 공급자이고, 생성 폼·썸네일 선택지에는 없다(새 배치 표가 정한다)', () => {
    expect(isAsyncImageModel('higgsfield-ms-2k')).toBe(true)
    expect(isAsyncImageModel('gpt-image-2.6-sunburst')).toBe(false)
    expect(PDP_IMAGE_MODELS.some((m) => m.id === 'higgsfield-ms-2k')).toBe(false)
    expect(IMAGE_MODELS.some((m) => m.id === 'higgsfield-ms-2k')).toBe(false)
    expect(estimateImageCostUsd('higgsfield-ms-2k', 'high')).toBe(0.11)
    expect(estimateImageCostUsd('higgsfield-ms-2k', 'medium')).toBe(0.11)
  })
})

describe('generateImage — higgsfield-ms-2k', () => {
  it('완료되면 단가표 비용을 한 번 기록하고, 덜어 낸 지시를 sentPrompt로 돌려준다', async () => {
    h.hf.mockResolvedValue({ base64: 'aW1n', mimeType: 'image/png', requestId: 'req-1', statusUrl: pending.statusUrl, submittedAt: pending.submittedAt, fit: { prompt: 'short', dropped: ['GLOBAL STYLE CHARTER'], originalLength: 9000 }, upscaledRefs: 1, resumed: false })
    const r = await generateImage({ prompt: 'long prompt', model: 'higgsfield-ms-2k', size: '1024x1536', quality: 'high', agentName: 'registration/pdp-image', deadlineAt: 123 })
    expect(checkMonthlyBudget).toHaveBeenCalledWith('registration/pdp-image', 'higgsfield-ms-2k', undefined)
    expect(h.hf).toHaveBeenCalledWith(expect.objectContaining({ model: 'higgsfield-ms-2k', deadlineAt: 123 }))
    expect(logUsage).toHaveBeenCalledTimes(1)
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({ model: 'higgsfield-ms-2k', costUsd: 0.11, success: true }))
    expect(r).toMatchObject({ base64: 'aW1n', costUsd: 0.11, providerRequestId: 'req-1', sentPrompt: 'short', promptFit: { dropped: ['GLOBAL STYLE CHARTER'], originalLength: 9000 }, upscaledRefs: 1 })
    // 받은 요청(R08a) — 받은 뒤 저장에 실패하면 이미지 단계가 이것으로 다음 run에 다시 받는다. 과금 표지는 새 제출이라 없다
    expect(r.asyncRequest).toEqual(pending)
  })

  it('이미 받아 사용량을 적은 요청(billed)을 다시 받으면 사용량·비용을 다시 적지 않는다(R08a — 받은 뒤 저장 실패의 다음 run)', async () => {
    vi.mocked(checkMonthlyBudget).mockResolvedValue({ allowed: false, budgetUsd: 300, spentUsd: 301 } as never)
    h.hf.mockResolvedValue({ base64: 'aW1n', mimeType: 'image/png', requestId: 'req-1', statusUrl: pending.statusUrl, submittedAt: pending.submittedAt, fit: null, upscaledRefs: 0, resumed: true })
    const r = await generateImage({ prompt: 'p', model: 'higgsfield-ms-2k', resume: { ...pending, billed: true } })
    expect(checkMonthlyBudget).not.toHaveBeenCalled()
    expect(logUsage).not.toHaveBeenCalled()
    expect(r.costUsd).toBe(0)
    expect(r.asyncRequest).toEqual({ ...pending, billed: true })
  })

  it('기한 안에 받지 못하면 ImagePendingError를 그대로 — 사용량 기록 없음(실패로 세지 않는다)', async () => {
    h.hf.mockRejectedValue(new ImagePendingError(pending))
    await expect(generateImage({ prompt: 'p', model: 'higgsfield-ms-2k' })).rejects.toBeInstanceOf(ImagePendingError)
    expect(logUsage).not.toHaveBeenCalled()
  })

  it('이어 받기는 예산 검사를 건너뛰고(제출 때 셈), 받으면 그때 한 번 기록한다', async () => {
    vi.mocked(checkMonthlyBudget).mockResolvedValue({ allowed: false, budgetUsd: 300, spentUsd: 301 } as never)
    h.hf.mockResolvedValue({ base64: 'aW1n', mimeType: 'image/png', requestId: 'req-1', statusUrl: pending.statusUrl, submittedAt: pending.submittedAt, fit: null, upscaledRefs: 0, resumed: true })
    const r = await generateImage({ prompt: 'p', model: 'higgsfield-ms-2k', resume: pending })
    expect(checkMonthlyBudget).not.toHaveBeenCalled()
    expect(logUsage).toHaveBeenCalledTimes(1)
    expect(r.costUsd).toBe(0.11)
    expect(r.sentPrompt).toBeUndefined()
  })

  it('새 제출은 지금처럼 월 예산에 막힌다', async () => {
    vi.mocked(checkMonthlyBudget).mockResolvedValue({ allowed: false, budgetUsd: 300, spentUsd: 301 } as never)
    await expect(generateImage({ prompt: 'p', model: 'higgsfield-ms-2k' })).rejects.toThrow('소진')
    expect(h.hf).not.toHaveBeenCalled()
  })

  it('공급자 오류(키 없음·실패 상태)는 지금처럼 실패 기록(비용 0) 뒤 오류', async () => {
    h.hf.mockRejectedValue(new Error('higgsfield-ms-2k(힉스필드) 생성에는 HF_API_KEY_ID·HF_API_KEY_SECRET이 필요합니다'))
    await expect(generateImage({ prompt: 'p', model: 'higgsfield-ms-2k' })).rejects.toThrow('HF_API_KEY_ID')
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({ costUsd: 0, success: false }))
  })
})
