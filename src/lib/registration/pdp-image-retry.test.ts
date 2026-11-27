import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { buildImageTasks, toGeneratedImagesMap } from './pdp-image-tasks'
import { composePdp } from './pdp-composer'
import type { PdpJobPatch } from './pdp-jobs'
import {
  RATE_LIMIT_MAX_DELAY_MS,
  buildMissingImageSummary,
  calculateRateLimitRetry,
  regenerateMissingPdpImages,
} from './pdp-image-retry'
import type { PdpJobRow, SectionImage } from './pdp-state'

function makePdpJob(sectionImages: SectionImage[] = []): PdpJobRow {
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
    section_images: sectionImages,
    final_html: '<html>old</html>',
    current_step: 'done',
    progress: 100,
    error: '기존 오류',
    cost_usd: 0,
    created_at: '2026-11-27T00:00:00.000Z',
    updated_at: '2026-11-27T00:00:00.000Z',
  }
}

describe('PDP 이미지 재시도 상태', () => {
  it('같은 섹션의 한도 오류를 90초부터 두 배씩 늘리고 10분으로 제한한다', () => {
    const first = calculateRateLimitRetry(0, 0)
    const second = calculateRateLimitRetry(1, 0)
    const capped = calculateRateLimitRetry(20, 0)

    expect(first).toEqual({ rateLimitCount: 1, retryAfter: new Date(90_000).toISOString() })
    expect(second.retryAfter).toBe(new Date(180_000).toISOString())
    expect(Date.parse(capped.retryAfter)).toBe(RATE_LIMIT_MAX_DELAY_MS)
  })

  it('실패 섹션 수를 완료 경고 문구로 요약하고 빈 URL은 합성 맵에서 제외한다', () => {
    const job = makePdpJob()
    const tasks = buildImageTasks(job)
    const images = tasks.map((task, index) => ({
      section: task.section,
      url: index < 3 ? `https://ok/${index}.png` : '',
      ...(index >= 3 ? { error: '생성 실패' } : {}),
    }))

    expect(buildMissingImageSummary(tasks, images)).toBe(
      "이미지 2장을 만들지 못했습니다 — 만든 기록에서 '빠진 이미지 다시 만들기'를 누르세요",
    )
    expect(Object.values(toGeneratedImagesMap(images)).flat()).not.toContain('')

    const ordered = toGeneratedImagesMap([
      { section: 'howto:0', url: '', error: '생성 실패' },
      { section: 'howto:1', url: 'https://ok/howto-1.png' },
    ])
    expect(ordered.howToImages?.[0]).toBeUndefined()
    expect(ordered.howToImages?.[1]).toBe('https://ok/howto-1.png')

    const { finalHtml } = composePdp({
      mode: 'premium',
      copy: {
        howTo: [
          { step: '첫 단계', description: '이미지 없음' },
          { step: '둘째 단계', description: '이미지 있음' },
        ],
      },
      images: ordered,
      sectionPlan: { section_order: ['how_to'] },
      strategyContract: {},
      specSheet: { productName: '테스트 상품' },
    })
    expect(finalHtml).not.toContain('<img src=""')
    expect(finalHtml).toContain('https://ok/howto-1.png')
  })

  it('재생성 API 서비스는 URL 없는 섹션만 큐로 되돌리고 기존 HTML을 비운다', async () => {
    const base = makePdpJob()
    const tasks = buildImageTasks(base)
    const images = tasks.map((task, index) => ({
      section: task.section,
      url: index < 3 ? `https://ok/${index}.png` : '',
      ...(index >= 3 ? { error: '생성 실패', retried: true } : {}),
    }))
    const job = makePdpJob(images)
    const updateJob = vi.fn(async (
      _db: SupabaseClient,
      _userId: string,
      _jobId: string,
      patch: PdpJobPatch,
    ) => ({
      ...job,
      section_images: patch.sectionImages as SectionImage[],
      final_html: patch.finalHtml as string | null,
      current_step: patch.currentStep as PdpJobRow['current_step'],
      progress: patch.progress as number,
      error: patch.error as string | null,
    }))

    const updated = await regenerateMissingPdpImages({} as SupabaseClient, 'user-1', 'job-1', {
      getJob: vi.fn(async () => job),
      updateJob: updateJob as never,
    })

    expect(updated.final_html).toBeNull()
    expect(updated.current_step).toBe('images')
    expect(updated.section_images.slice(0, 3)).toEqual(images.slice(0, 3))
    expect(updated.section_images.slice(3)).toEqual(
      images.slice(3).map((image) => ({
        section: image.section,
        url: '',
        prompt: tasks.find((task) => task.section === image.section)?.prompt,
        pendingRegen: true,
        regenReason: 'missing',
        retried: false,
      })),
    )
  })
})
