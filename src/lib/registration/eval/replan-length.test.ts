import { describe, expect, it, vi } from 'vitest'
import { fixtureToJob, loadEnrichmentFixture, type FixtureKey } from '../__golden__/golden-harness'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import type { PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { replanJobForLength } from './replan-length'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => { throw new Error('DB를 부르면 안 된다') } }))

const R = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'split', 'lean']
const D = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut', 'designcut2', 'designlayout', 'shotdiv']

function job(features: string[], key: FixtureKey = 'A-track-i'): PdpJobRow {
  const j = fixtureToJob(loadEnrichmentFixture(key))
  j.analysis = { ...j.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  // 저장된 잡처럼 옛 길이 목표(좁은 값)로 세운 골격을 깔고 시작한다
  vi.stubEnv('NEXOPS_PDP_SECTION_TARGET', '1,18')
  const strategy = mergeManualStrategy(j.analysis.recommended_strategy_contract ?? {}, j.spec_sheet, [])
  j.section_plan = applyDesignSkeleton(j.section_plan, resolveDesignSkeleton(j, strategy))
  vi.unstubAllEnvs()
  j.section_images = [{ section: 'hero', url: 'https://x/hero.png', prompt: '' }, { section: 'cta', url: 'https://x/cta.png', prompt: '' }]
  return j
}

describe('replanJobForLength', () => {
  it('나누기 잡은 지금 플래너의 골격이 된다 — 길이 채움 섹션이 들어온다', () => {
    // A는 이미 하한에 닿아 채움이 필요 없다 — 근거가 적은 B로 본다
    const before = job(R, 'B-track-i')
    const { job: out } = replanJobForLength(before)
    expect(before.section_plan.section_order ?? []).not.toContain('key_message')
    expect(out.section_plan.section_order).toContain('key_message')
    expect(out.section_plan.section_order!.length).toBeGreaterThan(before.section_plan.section_order!.length)
  })

  it('디자인 컷 잡은 기록을 지우고 다시 세운다 — 추가 컷이 섹션이 되고 20개를 향해 채운다', () => {
    const before = job(D)
    const stale = { ...before, section_plan: { ...before.section_plan, designcut: { version: 1, sections: [], kept: [], omitted: [], order: [] } } } as unknown as PdpJobRow
    const { job: out } = replanJobForLength(stale)
    const plan = out.section_plan.designcut!
    expect(plan.sections.some((s) => s.key.startsWith('long:shot:'))).toBe(true)
    expect(plan.sections.length + plan.kept.length).toBeGreaterThanOrEqual(18)
  })

  it('새 계획이 그리는 컷에 저장된 컷을 빌려 준다 — 빌린 목록을 돌려주고 저장된 컷은 그대로', () => {
    const { job: out, borrowed } = replanJobForLength(job(D))
    expect(borrowed.length).toBeGreaterThan(0)
    for (const section of borrowed) expect(['https://x/hero.png', 'https://x/cta.png']).toContain(out.section_images.find((e) => e.section === section)?.url)
    expect(out.section_images.find((e) => e.section === 'hero')?.url).toBe('https://x/hero.png')
  })

  it('원본 잡을 바꾸지 않는다', () => {
    const before = job(D)
    const snapshot = JSON.stringify(before)
    replanJobForLength(before)
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
