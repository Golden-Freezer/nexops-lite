import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
  updatePdpJob: vi.fn(),
}))

vi.mock('@/lib/agents/image/generate', () => ({ generateImage: mocks.generateImage }))
vi.mock('./pdp-jobs', () => ({
  getPdpJob: vi.fn(),
  updatePdpJob: mocks.updatePdpJob,
}))

import { runImagesStep } from './pdp-image-stage'
import { buildImageTasks } from './pdp-image-tasks'
import type { PdpJobRow } from './pdp-state'
import { RateLimitedError } from '@/lib/local-codex/image'

function makePdpJob(): PdpJobRow {
  return {
    id: 'job-1',
    user_id: 'user-1',
    business_id: null,
    draft_id: null,
    spec_sheet: { productName: '테스트 상품' },
    source_images: [],
    image_model: 'gpt-image-2',
    image_quality: 'high',
    mode: 'premium',
    generation_track: 'standard',
    analysis: {},
    research_result: {},
    design_prompts: {},
    section_plan: { activated_sections: ['hero'] },
    copy_sections: { final: {} },
    section_images: [],
    final_html: null,
    current_step: 'images',
    progress: 75,
    error: null,
    cost_usd: 0,
    created_at: '2026-11-27T00:00:00.000Z',
    updated_at: '2026-11-27T00:00:00.000Z',
  }
}

describe('runImagesStep 한도 대기', () => {
  beforeEach(() => vi.clearAllMocks())

  it('남은 섹션이 모두 retryAfter 대기 중이면 이미지를 만들지 않는다', async () => {
    const base = makePdpJob()
    const tasks = buildImageTasks(base)
    const sectionImages = tasks.map((task, index) => index === 0
      ? {
          section: task.section,
          url: '',
          error: 'Codex 이미지 사용 한도에 걸렸습니다. 잠시 뒤 다시 만듭니다.',
          pendingRegen: true,
          regenReason: 'rate_limit' as const,
          rateLimitCount: 1,
          retryAfter: new Date(Date.now() + 90_000).toISOString(),
        }
      : { section: task.section, url: `https://ok/${index}.png` })
    const job = { ...base, current_step: 'images' as const, progress: 79, section_images: sectionImages }
    mocks.updatePdpJob.mockImplementation(async (_db, _userId, _jobId, patch) => ({
      ...job,
      current_step: patch.currentStep ?? job.current_step,
      progress: patch.progress ?? job.progress,
    }))

    const updated = await runImagesStep({} as SupabaseClient, 'user-1', job)

    expect(updated.current_step).toBe('waiting_rate_limit')
    expect(mocks.generateImage).not.toHaveBeenCalled()
    expect(mocks.updatePdpJob).toHaveBeenCalledOnce()
  })

  it('이미지 한도 오류 섹션은 실패 확정 대신 retryAfter 대기열에 남긴다', async () => {
    const job = makePdpJob()
    const startedAt = Date.now()
    mocks.generateImage.mockRejectedValue(new RateLimitedError())
    mocks.updatePdpJob.mockImplementation(async (_db, _userId, _jobId, patch) => ({
      ...job,
      section_images: patch.sectionImages ?? job.section_images,
      design_prompts: patch.designPrompts ?? job.design_prompts,
      current_step: patch.currentStep ?? job.current_step,
      progress: patch.progress ?? job.progress,
      cost_usd: patch.costUsd ?? job.cost_usd,
    }))

    const updated = await runImagesStep({} as SupabaseClient, 'user-1', job)
    const limited = updated.section_images.find((image) => image.section === 'hero')

    expect(mocks.generateImage).toHaveBeenCalledOnce()
    expect(limited).toMatchObject({
      url: '',
      pendingRegen: true,
      regenReason: 'rate_limit',
      rateLimitCount: 1,
      error: 'Codex 이미지 사용 한도에 걸렸습니다. 잠시 뒤 다시 만듭니다.',
    })
    expect(Date.parse(limited!.retryAfter!)).toBeGreaterThanOrEqual(startedAt + 90_000)
    expect(updated.current_step).toBe('images')
  })
})
