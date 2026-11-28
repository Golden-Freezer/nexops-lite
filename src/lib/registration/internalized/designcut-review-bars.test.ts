/**
 * D 후기 별점 분포 막대(적용 D6 P1 T1-69·T2-19) — 계획이 자사 리뷰 파일 rating_counts 원본만 M12 bars로 기록하고(합계 5건 미만·파일 없음은
 * 칸 없음), 계약이 형식 밖 값을 통째로 버리고, T12가 5점→1점 막대 다섯 줄을 그린다. 옛 계획(bars 없음)은 지금 그리기 그대로다.
 * LLM·DB 없음.
 */
import { describe, expect, it } from 'vitest'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import { buildDesigncutPlan } from './designcut-plan'
import { REVIEW_BARS_MIN_TOTAL, reviewBarsOf } from './designcut-structure'
import { readDesignCut } from '../editor/utils/sectionConverter/designCut/contract'
import { composeDesignCut } from '../editor/utils/sectionConverter/designCut/compose'

const D2 = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut', 'designcut2', 'designlayout']
const own = (counts: Record<string, unknown>) => ({ reviewFiles: { own: { stats: { rating_counts: counts } } } }) as unknown as Partial<PdpSpecSheet>

function job(spec: Partial<PdpSpecSheet> = {}): PdpJobRow {
  const j = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  j.analysis = { ...j.analysis, enrichment: { version: 1, features: D2 } } as PdpJobRow['analysis']
  j.spec_sheet = { ...j.spec_sheet, rating: 4.8, reviewCount: 1234, ...spec }
  const strategy = mergeManualStrategy(j.analysis.recommended_strategy_contract ?? {}, j.spec_sheet, [])
  j.section_plan = applyDesignSkeleton(j.section_plan, resolveDesignSkeleton(j, strategy))
  return j
}
const reviewOf = (j: PdpJobRow) => buildDesigncutPlan(j)!.sections.find((s) => s.template === 'T12')!
const images = { hero: 'https://img.test/hero.png', features: Array.from({ length: 6 }, (_, i) => `https://img.test/f${i}.png`) }
const compose = (j: PdpJobRow, plan = buildDesigncutPlan(j)!) =>
  composeDesignCut([], readDesignCut({ ...j.section_plan, designcut: plan })!, { images, sectionOrder: j.section_plan.section_order ?? [] })
const reviewSection = (sections: ReturnType<typeof compose>) => sections.find((s) => s.elements.some((e) => e.name === 'designcut-review-card-0'))!

describe('reviewBarsOf — 자사 리뷰 파일 rating_counts 원본만, 합계 5건 이상', () => {
  it('5점→1점 개수 그대로(R17-L P01 263/14/4/3/4 꼴)', () => {
    expect(reviewBarsOf(own({ 5: 263, 4: 14, 3: 4, 2: 3, 1: 4 }))).toEqual([
      { star: 5, count: 263 },
      { star: 4, count: 14 },
      { star: 3, count: 4 },
      { star: 2, count: 3 },
      { star: 1, count: 4 },
    ])
  })

  it(`합계 ${REVIEW_BARS_MIN_TOTAL - 1}건이면 없고 ${REVIEW_BARS_MIN_TOTAL}건이면 있다 — 파일이 없거나 비면 없다`, () => {
    expect(REVIEW_BARS_MIN_TOTAL).toBe(5)
    expect(reviewBarsOf(own({ 5: 3, 4: 1 }))).toBeNull()
    expect(reviewBarsOf(own({ 5: 4, 3: 1 }))?.map((b) => b.count)).toEqual([4, 0, 1, 0, 0])
    expect(reviewBarsOf({})).toBeNull()
    expect(reviewBarsOf(own({}))).toBeNull()
    // 정수 아닌 값·음수는 0으로 센다(C1 ratingBarsOf)
    expect(reviewBarsOf(own({ 5: 4.5, 4: -2, 3: 5 }))?.map((b) => b.count)).toEqual([0, 0, 5, 0, 0])
  })
})

describe('계획 — 후기(T12) M12 bars', () => {
  it('분포가 있으면 bars를 싣고, 없으면 칸이 없어 예전 모듈 꼴 그대로다', () => {
    const withBars = reviewOf(job(own({ 5: 70, 4: 20, 3: 6, 2: 3, 1: 1 }))).modules[0]
    expect(withBars).toMatchObject({ type: 'M12', data: { rating: 4.8, count: 1234, bars: [{ star: 5, count: 70 }, { star: 4, count: 20 }, { star: 3, count: 6 }, { star: 2, count: 3 }, { star: 1, count: 1 }] } })
    for (const spec of [{}, own({ 5: 4 })]) {
      const m = reviewOf(job(spec)).modules[0]
      expect(m.type).toBe('M12')
      if (m.type === 'M12') expect(Object.keys(m.data).sort()).toEqual(['cards', 'count', 'rating'])
    }
  })

  it('계약 왕복 — 맞는 bars는 그대로, 순서·개수·합계·정수가 하나라도 틀리면 bars만 통째로 버린다', () => {
    const j = job(own({ 5: 70, 4: 20, 3: 6, 2: 3, 1: 1 }))
    const plan = buildDesigncutPlan(j)!
    expect(readDesignCut({ ...j.section_plan, designcut: plan })!.sections).toEqual(plan.sections)
    const broken = [
      (bars: Array<{ star: number; count: number }>) => bars.reverse(),
      (bars: Array<{ star: number; count: number }>) => bars.slice(0, 4),
      (bars: Array<{ star: number; count: number }>) => bars.map((b) => ({ ...b, count: b.star === 5 ? 1.5 : b.count })),
      (bars: Array<{ star: number; count: number }>) => bars.map((b) => ({ ...b, count: b.star === 1 ? -1 : b.count })),
      (bars: Array<{ star: number; count: number }>) => bars.map((b) => ({ ...b, count: b.star === 5 ? 4 : 0 })),
      () => 'many',
    ]
    for (const breakIt of broken) {
      const raw = JSON.parse(JSON.stringify(plan))
      const data = raw.sections.find((s: { template: string }) => s.template === 'T12').modules[0].data
      data.bars = breakIt(data.bars)
      const m = readDesignCut({ designcut: raw })!.sections.find((s) => s.template === 'T12')!.modules[0]
      expect(m.type).toBe('M12')
      if (m.type !== 'M12') continue
      expect(m.data).not.toHaveProperty('bars')
      expect(m.data).toMatchObject({ rating: 4.8, count: 1234 })
    }
  })
})

describe('조립 — T12 막대 다섯 줄', () => {
  it('5점→1점 라벨·개수·막대를 그리고, 막대 길이는 개수 몫이다. 0개 줄은 막대 없이 바탕 길만', () => {
    const out = reviewSection(compose(job(own({ 5: 70, 4: 20, 3: 6, 2: 0, 1: 4 })))).elements
    const el = (name: string) => out.find((e) => e.name === name)
    for (const star of [5, 4, 3, 2, 1]) {
      expect(el(`designcut-review-bar-label-${star}`)?.textProps?.content).toBe(`${star}점`)
      expect(el(`designcut-review-bar-track-${star}`)).toBeTruthy()
    }
    expect(el('designcut-review-bar-count-5')?.textProps?.content).toBe('70')
    expect(el('designcut-review-bar-fill-2')).toBeUndefined()
    const track = el('designcut-review-bar-track-5')!.transform.width
    expect(el('designcut-review-bar-fill-5')!.transform.width).toBe(Math.round((track * 70) / 100))
    expect(el('designcut-review-bar-fill-4')!.transform.width).toBe(Math.round((track * 20) / 100))
    // 위에서 아래로 5 → 1, 막대는 큰 평점·리뷰 수 아래, 첫 카드 위
    const ys = [5, 4, 3, 2, 1].map((star) => el(`designcut-review-bar-label-${star}`)!.transform.y)
    expect([...ys].sort((a, b) => a - b)).toEqual(ys)
    expect(ys[0]).toBeGreaterThan(el('designcut-review-count')!.transform.y)
    expect(ys[4]).toBeLessThan(el('designcut-review-card-0')!.transform.y)
  })

  it('bars가 없는 계획(옛 계획·분포 없음)은 막대 요소가 없고 후기 섹션이 예전과 같다', () => {
    const j = job(own({ 5: 70, 4: 20, 3: 6, 2: 3, 1: 1 }))
    const plan = buildDesigncutPlan(j)!
    const old = JSON.parse(JSON.stringify(plan))
    delete old.sections.find((s: { template: string }) => s.template === 'T12').modules[0].data.bars
    const before = reviewSection(compose(job(), old))
    const plain = reviewSection(compose(job()))
    expect(before.elements.some((e) => e.name?.startsWith('designcut-review-bar-'))).toBe(false)
    expect(before.elements.map((e) => [e.name, e.transform])).toEqual(plain.elements.map((e) => [e.name, e.transform]))
    // 막대가 있으면 그만큼 높다
    expect(reviewSection(compose(j, plan)).canvas.height).toBeGreaterThan(plain.canvas.height)
  })
})
