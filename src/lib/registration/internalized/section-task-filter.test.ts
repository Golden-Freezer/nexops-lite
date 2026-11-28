/**
 * 안 쓰는 컷 생성 전 빼기(W5, ENRICHMENT `lean`) — 골격이 쓸 키·hero·여분 풀만 만들고, 모르는 섹션 키가 있으면 거르지 않는다.
 * lean 기록이 없는 잡(골든 픽스처 기본)은 태스크가 지금 그대로다.
 */

import { describe, expect, it } from 'vitest'
import { buildImageTasks } from '../pdp-image-tasks'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import type { PdpJobRow } from '../pdp-state'
import { sectionTaskFilter } from './section-task-filter'

const keep = (order: string[], keys: string[]) => {
  const filter = sectionTaskFilter(order)!
  return keys.filter((k) => filter(k))
}
const ALL = [
  'hero',
  'problem',
  'solution',
  'usage',
  'cta',
  'features:0',
  'features:3',
  'howto:0',
  'howto:2',
  'usp_icons:1',
  'size_comparison',
  'product_exposure',
  'empathy_scene',
  'direction_hint',
  'key_benefit_visual',
  'premium_hero',
  'concept_mood',
  'comparison_scene',
  'rating_bg',
]

describe('sectionTaskFilter', () => {
  it('골격이 비었거나 모르는 섹션 키가 있으면 거르지 않는다(null)', () => {
    expect(sectionTaskFilter([])).toBeNull()
    expect(sectionTaskFilter(['main_cut', 'unknown_section'])).toBeNull()
  })

  it('hero는 골격이 쓰지 않아도 남긴다(다른 컷의 스타일 참조)', () => {
    expect(keep(['cta'], ['hero', 'problem', 'cta'])).toEqual(['hero', 'cta'])
  })

  it('골격이 쓰는 키와 hero만 — 특징·사용 단계는 섹션이 있을 때 접두어 전체(W4-S 펼침 포함)', () => {
    // main_cut은 대표 컷(premium_hero·hero)과 아이콘을 쓴다
    expect(keep(['main_cut', 'point_div', 'hidden_page', 'cta'], ALL)).toEqual([
      'hero',
      'cta',
      'features:0',
      'features:3',
      'howto:0',
      'howto:2',
      'usp_icons:1',
      'premium_hero',
    ])
  })

  it('sub_div·point_list_div가 있으면 남는 컷 풀(여분)을 모두 남긴다 — 사진이 글 카드로 바뀌지 않게', () => {
    const kept = keep(['main_cut', 'point_div', 'sub_div', 'cta'], ALL)
    for (const key of ['features:0', 'howto:0', 'key_benefit_visual', 'usage', 'concept_mood', 'direction_hint']) {
      expect(kept).toContain(key)
    }
    expect(kept).not.toContain('comparison_scene')
    expect(keep(['point_list_div'], ['usage', 'concept_mood'])).toEqual(['usage', 'concept_mood'])
  })

  it('비교·평점 섹션이 있으면 그 컷을 남긴다', () => {
    expect(keep(['compare_div', 'perf_rating'], ['size_comparison', 'rating_bg', 'concept_mood'])).toEqual([
      'size_comparison',
      'rating_bg',
    ])
  })
})

describe('buildImageTasks — lean 기록 잡만 거른다', () => {
  const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  const withLean = (j: PdpJobRow): PdpJobRow => ({
    ...j,
    analysis: { ...j.analysis, enrichment: { version: 1, features: ['vocab', 'persuasion', 'lean'] } },
  })
  const sections = (j: PdpJobRow) => buildImageTasks(j).map((t) => t.section)

  it('lean 기록이 없으면 지금 그대로', () => {
    expect(sections(job)).toEqual(sections({ ...job }))
    expect(sections(job)).toContain('comparison_scene')
  })

  it('lean이면 골격이 안 쓰는 컷만 뺀다 — 남은 태스크는 순서·내용 그대로', () => {
    const base = buildImageTasks(job)
    const lean = buildImageTasks(withLean(job))
    // A-track-i 골격에는 비교 섹션(compare_div·compare2_div)이 없다
    expect(base.map((t) => t.section).filter((s) => !lean.some((t) => t.section === s))).toEqual([
      'size_comparison',
      'comparison_scene',
    ])
    expect(lean).toEqual(base.filter((t) => lean.some((l) => l.section === t.section)))
  })

  it('골격은 section_order와 activated_sections 합집합 — 편집기가 렌더하는 섹션의 컷은 남는다', () => {
    const activated = withLean({
      ...job,
      section_plan: {
        ...job.section_plan,
        activated_sections: [...(job.section_plan.activated_sections ?? []), 'compare_div'],
      },
    })
    expect(sections(activated)).toContain('size_comparison')
  })

  it('골격에 모르는 섹션 키가 있으면 거르지 않는다', () => {
    const odd = withLean({ ...job, section_plan: { ...job.section_plan, section_order: ['main_cut', 'mystery'] } })
    expect(sections(odd)).toEqual(sections(job))
  })
})
