import { describe, expect, it, vi } from 'vitest'
import { INPUT_SLOT_SAMPLE } from '../__fixtures__/input-slots.sample'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import { inputSlotsOf } from '../input-slots-read'
import { optionChips } from '../internalized/designcut-inputs'
import { designcutEnabled } from '../internalized/designcut-plan'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import type { PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { replanJobForLength } from './replan-length'
import { withSampleInputJob } from './sample-inputs'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => { throw new Error('DB를 부르면 안 된다') } }))

const D = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut', 'designcut2', 'designlayout', 'shotdiv']

/** 디자인 컷 잡 — replan-length.test와 같은 꼴(설계 골격을 깔아 디자인 컷 계획이 다시 세워진다) */
function job(): PdpJobRow {
  const j = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  j.analysis = { ...j.analysis, enrichment: { version: 1, features: D } } as PdpJobRow['analysis']
  const strategy = mergeManualStrategy(j.analysis.recommended_strategy_contract ?? {}, j.spec_sheet, [])
  j.section_plan = applyDesignSkeleton(j.section_plan, resolveDesignSkeleton(j, strategy))
  j.section_images = [{ section: 'hero', url: 'https://x/hero.png', prompt: '' }, { section: 'cta', url: 'https://x/cta.png', prompt: '' }]
  return j
}

describe('withSampleInputJob — render-check 표본 값(args.sampleInputs)', () => {
  it('spec에 입력 칸 표본을 얹는다 — 입력 수치가 표본 값이 된다', () => {
    const out = withSampleInputJob(job())
    expect(inputSlotsOf(out.spec_sheet).metrics).toEqual(INPUT_SLOT_SAMPLE.productMetrics)
    expect(out.spec_sheet.layers).toEqual(INPUT_SLOT_SAMPLE.layers)
  })

  it('원본 잡을 바꾸지 않고 spec 밖은 같은 값이다', () => {
    const before = job()
    const snapshot = JSON.stringify(before)
    const out = withSampleInputJob(before)
    expect(JSON.stringify(before)).toBe(snapshot)
    expect(out.spec_sheet).not.toBe(before.spec_sheet)
    expect({ ...out, spec_sheet: null }).toEqual({ ...before, spec_sheet: null })
  })

  it('견본 표본은 잡 옵션이 둘 이상이면 이름만 앞 두 옵션 이름으로 바꾼다(색은 표본 그대로, C5 ③)', () => {
    const withOptions = job()
    withOptions.copy_sections = { ...withOptions.copy_sections, final: { ...withOptions.copy_sections.final, colorOptions: { options: ['데이지 화이트', '데이지 네이비', '데이지 핑크'] } } } as PdpJobRow['copy_sections']
    const labels = optionChips(withOptions, ['데이지 화이트', '데이지 네이비', '데이지 핑크'], true).map((chip) => chip.label)
    expect(labels.length).toBeGreaterThanOrEqual(2)
    expect(withSampleInputJob(withOptions).spec_sheet.swatches).toEqual(INPUT_SLOT_SAMPLE.swatches.slice(0, 2).map((s, i) => ({ ...s, name: labels[i] })))
    const noOptions = job()
    noOptions.copy_sections = { ...noOptions.copy_sections, final: { ...noOptions.copy_sections.final, colorOptions: { options: [] } } } as PdpJobRow['copy_sections']
    if (optionChips(noOptions, [], true).length < 2) expect(withSampleInputJob(noOptions).spec_sheet.swatches).toEqual(INPUT_SLOT_SAMPLE.swatches)
  })

  it('다시 세우면 표본이 계획에 들어오고, 끄면(기본) 표본 글이 없다', () => {
    expect(designcutEnabled(job())).toBe(true)
    const plain = JSON.stringify(replanJobForLength(job()).job.section_plan.designcut)
    const sampled = JSON.stringify(replanJobForLength(withSampleInputJob(job())).job.section_plan.designcut)
    expect(plain).not.toContain('표본')
    expect(sampled).toContain('표본')
  })
})
