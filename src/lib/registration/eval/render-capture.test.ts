import { describe, expect, it } from 'vitest'
import type { PdpJobRow } from '@/lib/registration/pdp-state'
import { PHONE_SCREEN_CANVAS_PX, renderJobHtml } from './render-capture'

function fakeJob(overrides: Partial<PdpJobRow> = {}): PdpJobRow {
  return {
    id: 'job-render-1',
    user_id: 'user-1',
    business_id: null,
    draft_id: null,
    spec_sheet: { productName: '테스트 상품' },
    source_images: [],
    image_model: 'gpt-image-2',
    image_quality: 'high',
    mode: 'pro',
    generation_track: 'standard',
    analysis: {},
    research_result: {},
    design_prompts: {},
    section_plan: { activated_sections: ['main_intro'] },
    copy_sections: { final: { mainIntro: { title: '한 번에 정리되는 수납', subtitle: '작은 공간에 맞춘 크기' } } },
    section_images: [
      { section: 'hero', url: 'https://img.example/hero.png' },
      { section: 'cta', url: 'https://img.example/cta.png' },
    ],
    final_html: null,
    current_step: 'done',
    progress: 100,
    error: null,
    cost_usd: 0,
    created_at: '2026-10-27T00:00:00Z',
    updated_at: '2026-10-27T00:00:00Z',
    ...overrides,
  } as PdpJobRow
}

describe('renderJobHtml', () => {
  it('파이프라인 산출로 편집기 문서를 만들고 860px 렌더 HTML을 돌려준다', async () => {
    const out = await renderJobHtml(fakeJob())

    expect(out.doc.pdpId).toBe('job-render-1')
    expect(out.doc.sections.length).toBeGreaterThan(0)
    expect(out.html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(out.html).toContain('width=860')
    expect(out.html).toContain('https://img.example/hero.png')
    expect(out.canvasHeight).toBeGreaterThan(0)
    expect(out.phoneScreens).toBeCloseTo(out.canvasHeight / PHONE_SCREEN_CANVAS_PX, 1)
    expect(out.sectionTypes.length).toBeGreaterThan(0)
  })

  it('같은 잡이면 같은 HTML(결정론)', async () => {
    const a = await renderJobHtml(fakeJob())
    const b = await renderJobHtml(fakeJob())
    expect(a.html).toBe(b.html)
  })

  it('기본은 저장본을 무시하고 파이프라인 산출로 새로 빌드한다', async () => {
    const savedRow = {
      id: 'row-1',
      user_id: 'user-1',
      pdp_job_id: 'job-render-1',
      sections_data: [{ id: 'saved-only', sectionType: 'main_intro', isVisible: true, order: 0, canvas: { height: 10 }, elements: [] }],
      layout_assignments: {},
      updated_at: '2026-10-27T00:00:00Z',
    }
    const fresh = await renderJobHtml(fakeJob(), savedRow)
    expect(fresh.doc.sections.some((s) => s.id === 'saved-only')).toBe(false)
  })

  it('파이프라인 산출이 없으면 명시 오류', async () => {
    await expect(renderJobHtml(fakeJob({ copy_sections: {} }))).rejects.toThrow(/파이프라인 결과/)
  })
})
