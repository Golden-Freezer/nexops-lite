import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PdpJobRow } from '@/lib/registration/pdp-state'
import { PdpPreview } from './PdpPreview'

// 편집기 미리보기는 Clerk 세션이 필요하다 — 이 테스트는 quality_report 경고 영역만 본다.
vi.mock('./PdpEditorPreview', () => ({ PdpEditorPreview: () => null }))

// 프로젝트 Vitest 변환은 classic JSX를 사용하고 Next 빌드는 React를 자동 주입한다.
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

function job(copySections: Record<string, unknown>): PdpJobRow {
  return {
    id: 'job-1', user_id: 'u', business_id: null, draft_id: null,
    spec_sheet: { productName: '상품' }, source_images: [], image_model: 'gpt-image-2', image_quality: 'medium',
    mode: 'pro', generation_track: 'internalized', analysis: {}, research_result: {}, design_prompts: {},
    section_plan: {}, copy_sections: copySections, section_images: [], final_html: '<html></html>',
    current_step: 'done', progress: 100, error: null, cost_usd: 0, created_at: null, updated_at: null,
  } as unknown as PdpJobRow
}

describe('PdpPreview — 사진 없이 끝난 컷 경고', () => {
  const withImages = (section_images: unknown[]) => ({ ...job({}), section_images }) as unknown as PdpJobRow

  it('빠진 컷을 이름·사유로 알린다', () => {
    const html = renderToStaticMarkup(
      createElement(PdpPreview, {
        job: withImages([
          { section: 'hero', url: 'https://x/h.png' },
          { section: 'usage', url: '', error: 'rejected by the safety system' },
          { section: 'howto:1', url: '', error: 'OpenAI 이미지 생성 시간 초과(100초, 1회 시도)' },
        ]),
      })
    )
    expect(html).toContain('사진을 만들지 못한 컷')
    expect(html).toContain('사용 장면(안전 심사 거부)')
    expect(html).toContain('사용법 2(시간 초과)')
  })

  it('빠진 컷이 없으면 경고가 없다', () => {
    const html = renderToStaticMarkup(createElement(PdpPreview, { job: withImages([{ section: 'hero', url: 'https://x/h.png' }]) }))
    expect(html).not.toContain('사진을 만들지 못한 컷')
  })
})

describe('PdpPreview — quality_report 방어 가드', () => {
  it('trust_gate가 없는 quality_report에서도 렌더가 깨지지 않는다', () => {
    expect(() => renderToStaticMarkup(createElement(PdpPreview, { job: job({ quality_report: { skeleton_excluded: [] } }) }))).not.toThrow()
    expect(() => renderToStaticMarkup(createElement(PdpPreview, { job: job({}) }))).not.toThrow()
  })

  it('필수 신뢰요소 누락은 기존처럼 경고·힌트로 보여 준다', () => {
    const html = renderToStaticMarkup(createElement(PdpPreview, {
      job: job({ quality_report: { trust_gate: { pass: false, missing_required: ['social_proof'], missing_recommended: [], user_action_hints: ['리뷰 데이터를 입력하면 리뷰·평점 섹션이 생성됩니다.'] }, skeleton_excluded: [] } }),
    }))
    expect(html).toContain('social_proof')
    expect(html).toContain('리뷰 데이터를 입력하면')
  })
})
