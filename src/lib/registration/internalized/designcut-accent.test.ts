/**
 * D 강조 구절(적용 T1-17 D) — 최종 카피 headlineAccents(제목 → 구절)를 디자인 컷 계획이 제목마다 다시 검사해 text.accent로 싣는다.
 * 칸이 없는 카피(옛 잡·R 잡)는 계획이 지금과 같다. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import type { CopywritingResult, DesigncutPlan, PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import { buildDesigncutPlan } from './designcut-plan'

const ON = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut']

function designedJob(accents?: Record<string, unknown>): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  job.analysis = { ...job.analysis, enrichment: { version: 1, features: ON } } as PdpJobRow['analysis']
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  if (accents) job.copy_sections = { ...job.copy_sections, final: { ...(job.copy_sections.final as CopywritingResult), headlineAccents: accents as Record<string, string> } }
  return job
}
const headlines = (plan: DesigncutPlan) => plan.sections.map((s) => s.text.headline).filter((h): h is string => !!h && [...h.replace(/\s/g, '')].length >= 4)

describe('계획 — headlineAccents → text.accent', () => {
  const base = buildDesigncutPlan(designedJob())!
  const [first, second] = headlines(base)
  /** 제목 안의 공백 없는 2~3자 — 제목 전체가 아니다(제목은 공백 뺀 4자 이상) */
  const phrase = (h: string) => h.match(/\S{2,3}/)![0]

  it('표본에 강조 칸을 시험할 제목이 둘 이상 있다', () => {
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
  })

  it('칸이 없는 카피는 어느 섹션에도 accent가 없다(옛 잡·R 잡)', () => {
    expect(base.sections.some((s) => 'accent' in s.text)).toBe(false)
  })

  it('제목 글로 찾은 구절만 싣고, 다른 제목·없는 제목은 그대로다', () => {
    const plan = buildDesigncutPlan(designedJob({ [first]: phrase(first), '없는 제목입니다': '없는' }))!
    const marked = plan.sections.filter((s) => s.text.accent)
    expect(marked.length).toBeGreaterThan(0)
    expect(marked.every((s) => s.text.headline === first && s.text.accent === phrase(first))).toBe(true)
    // accent 칸 말고는 계획이 같다
    const strip = (p: DesigncutPlan) => p.sections.map((s) => ({ ...s, text: { ...s.text, accent: undefined } }))
    expect(JSON.stringify(strip(plan))).toBe(JSON.stringify(strip(base)))
  })

  it('키의 공백은 맞추지 않아도 찾는다', () => {
    const plan = buildDesigncutPlan(designedJob({ [` ${first.replace(/\s+/g, '  ')} `]: phrase(first) }))!
    expect(plan.sections.some((s) => s.text.headline === first && s.text.accent === phrase(first))).toBe(true)
  })

  it('검사를 못 넘은 구절(제목에 없음·9자 이상·제목 전체·글이 아님)은 싣지 않는다', () => {
    for (const bad of ['제목에 없는 말', '가'.repeat(9), first, 3, null]) {
      const plan = buildDesigncutPlan(designedJob({ [first]: bad }))!
      expect(plan.sections.some((s) => 'accent' in s.text)).toBe(false)
    }
  })

  it('칸이 객체가 아니면 무시한다', () => {
    for (const bad of [['x'], 'x', 3]) {
      const job = designedJob()
      job.copy_sections = { ...job.copy_sections, final: { ...(job.copy_sections.final as CopywritingResult), headlineAccents: bad as never } }
      expect(buildDesigncutPlan(job)!.sections.some((s) => 'accent' in s.text)).toBe(false)
    }
  })
})
