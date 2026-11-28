/**
 * 적용 D3 P2 — 첫 근거 자리 띠(T1-35)와 쓰는 법 글 판정(USAGE 오탐).
 * - 채움 페이지에서 첫 근거(후기·인증)의 위치가 0.45보다 뒤이고 막1이 그 앞이면 근거를 막1 앞으로 당긴다. 같은 뼈대 이웃이 새로 붙으면 옮기지 않는다.
 * - 쓰는 법 글 판정은 K USAGE_WORDING_RE와 같다 — '바르게'·'편하면서도' 같은 조각에 걸리지 않는다.
 */
import { describe, expect, it } from 'vitest'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import type { DesigncutSection, PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { FIRST_PROOF_AT_MAX, proofBeforeFirstAct } from './designcut-fill'
import { buildDesigncutPlan } from './designcut-plan'
import { evidenceOf, hasUsageFeature } from './persuasion-signals'
import { planExtraShotsForLength, pointCutsOf } from './shot-diversity'

type Piece = Omit<DesigncutSection, 'bg' | 'plateKey' | 'plateAspect'>
const piece = (key: string, template: string, role = 'info', layoutVariant?: Piece['layoutVariant']): Piece =>
  ({ key, role, template, chapter: null, productImageKey: null, productAlpha: false, text: { eyebrow: null, headline: null, sub: null }, modules: [], layoutVariant }) as Piece

/** 칸 n개 — 채움 칸은 세 템플릿을 돌려(한 칸 건너 이웃끼리 뼈대가 다르다) 지정한 자리만 바꾼다 */
function page(n: number, at: Record<number, Piece>): { order: string[]; byKey: Map<string, Piece> } {
  const pieces = Array.from({ length: n }, (_, i) => at[i] ?? piece(`k${i}`, ['T5', 'T4', 'T6'][i % 3]))
  return { order: pieces.map((p) => p.key), byKey: new Map(pieces.map((p) => [p.key, p])) }
}
const act = piece('act1', 'T10')
const review = piece('review', 'T12', 'social_proof', 'card')

describe('첫 근거 당기기(T1-35)', () => {
  it('상한은 0.45다', () => {
    expect(FIRST_PROOF_AT_MAX).toBe(0.45)
  })

  it('20칸 9번째(0.474) 후기를 7번째 막1 바로 앞으로 옮긴다', () => {
    const { order, byKey } = page(20, { 7: act, 8: piece('m1', 'T3a', 'fill_message', 'scene'), 9: review })
    proofBeforeFirstAct(order, byKey, 'act1')
    expect(order.slice(6, 10)).toEqual(['k6', 'review', 'act1', 'm1'])
    expect(order).toHaveLength(20)
  })

  it('0.45 이하(21칸 9번째 = 0.45)면 그대로다', () => {
    const { order, byKey } = page(21, { 7: act, 8: piece('m1', 'T3a', 'fill_message', 'scene'), 9: review })
    const before = [...order]
    proofBeforeFirstAct(order, byKey, 'act1')
    expect(order).toEqual(before)
  })

  it('인증 근거도 근거고, 첫 근거만 옮긴다', () => {
    const cert = piece('cert', 'T9', 'certification_evidence')
    const { order, byKey } = page(20, { 7: act, 8: piece('m1', 'T3a', 'fill_message', 'scene'), 9: cert, 12: review })
    proofBeforeFirstAct(order, byKey, 'act1')
    expect(order.indexOf('cert')).toBe(7)
    expect(order.indexOf('review')).toBe(12)
  })

  it('막1이 없거나 근거 뒤면 그대로다', () => {
    const none = page(20, { 9: review })
    const before = [...none.order]
    proofBeforeFirstAct(none.order, none.byKey, undefined)
    expect(none.order).toEqual(before)
    const later = page(20, { 9: review, 11: act })
    const laterBefore = [...later.order]
    proofBeforeFirstAct(later.order, later.byKey, 'act1')
    expect(later.order).toEqual(laterBefore)
  })

  it('빼면 그 자리에 같은 뼈대가 붙으면 옮기지 않는다', () => {
    // 후기 앞뒤가 같은 변형 메시지 — 빼면 붙는다
    const { order, byKey } = page(20, { 7: act, 8: piece('m1', 'T3a', 'fill_message', 'scene'), 9: review, 10: piece('m2', 'T3a', 'fill_message', 'scene') })
    const before = [...order]
    proofBeforeFirstAct(order, byKey, 'act1')
    expect(order).toEqual(before)
  })

  it('넣는 자리 앞·뒤와 같은 뼈대면 옮기지 않는다', () => {
    const prevSame = page(20, { 6: piece('r0', 'T12', 'info', 'card'), 7: act, 8: piece('m1', 'T3a', 'fill_message', 'scene'), 9: review })
    const before = [...prevSame.order]
    proofBeforeFirstAct(prevSame.order, prevSame.byKey, 'act1')
    expect(prevSame.order).toEqual(before)
    const nextSame = page(20, { 7: piece('act1', 'T12', 'info', 'card'), 8: piece('m1', 'T3a', 'fill_message', 'scene'), 9: review })
    const nextBefore = [...nextSame.order]
    proofBeforeFirstAct(nextSame.order, nextSame.byKey, 'act1')
    expect(nextSame.order).toEqual(nextBefore)
  })
})

describe('채움 D2 계획 — 사진 막이 있는 잡(픽스처 A)', () => {
  const FILL = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut', 'designcut2', 'shotdiv', 'fillacts']
  function jobOf(): PdpJobRow {
    const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
    job.analysis = { ...job.analysis, enrichment: { version: 1, features: FILL } } as PdpJobRow['analysis']
    job.spec_sheet = { ...job.spec_sheet, material: 'PE' }
    job.copy_sections = { ...job.copy_sections, final: { ...job.copy_sections.final!, usageSceneTags: ['#아침 출근길', '#주말 나들이'] } as never }
    const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
    job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
    return { ...job, section_plan: { ...job.section_plan, extra_shots: planExtraShotsForLength(job, pointCutsOf(job))! } }
  }

  it('첫 근거가 막1 바로 앞이고 위치가 0.45 이하다', () => {
    const plan = buildDesigncutPlan(jobOf())!
    const roleOf = new Map(plan.sections.map((s) => [s.key, s.role]))
    const proofAt = plan.order.findIndex((key) => roleOf.get(key) === 'social_proof')
    const firstAct = plan.sections.find((s) => s.template === 'T10')!.key
    expect(plan.order[proofAt + 1]).toBe(firstAct)
    expect(proofAt / (plan.order.length - 1)).toBeLessThanOrEqual(FIRST_PROOF_AT_MAX)
  })
})

describe('쓰는 법 글 판정(USAGE 오탐)', () => {
  const spec = (keyFeatures: string[], material = ''): PdpSpecSheet => ({ keyFeatures, material }) as unknown as PdpSpecSheet

  it.each([
    ['바르게 세워지는 구조'],
    ['편하면서도 가벼운 무게'],
    ['바르셀로나 감성 디자인'],
    ['누르스름한 빛 없는 투명'],
  ])("'%s'는 쓰는 법 글이 아니다(옛 식은 걸렸다)", (feature) => {
    expect(hasUsageFeature(spec([feature]))).toBe(false)
    expect(evidenceOf(spec([feature])).usageBasis).toBe(false)
  })

  it.each([['얼굴에 바르면 끝'], ['물로 세척하면 깨끗'], ['사용법이 간단해요'], ['원터치로 열고 닫기'], ['벽에 붙여 쓰는 수납']])("'%s'는 쓰는 법 글이다", (feature) => {
    expect(hasUsageFeature(spec([feature]))).toBe(true)
    expect(evidenceOf(spec([feature])).usageBasis).toBe(true)
  })

  it('소재가 있으면 쓰는 법 근거다(지금 규칙 그대로)', () => {
    expect(evidenceOf(spec(['바르게 세워지는 구조'], '면 100%')).usageBasis).toBe(true)
    expect(hasUsageFeature(spec(['바르게 세워지는 구조'], '면 100%'))).toBe(false)
  })
})
