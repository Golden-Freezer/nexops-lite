/**
 * 디자인 컷 D2 길이 목표(ENRICHMENT `designcut2` 기록 잡) — 플래너가 [14,18]·상한 18로 계획해 후기·추천 같은 낮은 점수 단위가
 * 길이 상한에서 빠지지 않는다(R10 P02: 기본 목표로 perf_reviews가 빠져 디자인 컷에 후기 막이 없었다). Track I·D1은 그대로이고,
 * 후기 근거가 없으면 D2여도 후기 섹션을 만들지 않는다. LLM·DB 없음.
 */
import { describe, expect, it } from 'vitest'
import { ProSectionType as S } from '@/lib/registration/editor/types/section'
import { getCorpusSnapshotV2 } from '../corpus-v2'
import { getDesignVocab } from '../design-vocab'
import { resolveDesignSkeleton } from '../pdp-enrichment-stage'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture, type FixtureKey } from '../__golden__/golden-harness'
import { planPersuasionSkeleton, type PersuasionInput } from './persuasion-planner'

const vocab = getDesignVocab()!
const TRACK_I = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options']

/**
 * 근거가 많은 입력 — 섹션 수 중앙값 7(R10 P02처럼 짧은 카테고리)이면 기본 목표의 상한이 min(14, 7×1.5) = 10이라
 * 후기 단위가 빠진다. D2는 중앙값을 보지 않고 상한 18이다
 */
function richInput(over: { spec?: Partial<PdpSpecSheet>; designcut2?: boolean } = {}): PersuasionInput {
  const snapshot = getCorpusSnapshotV2('household')!
  return {
    specSheet: {
      productName: '테스트 상품',
      keyFeatures: ['간편한 원터치 사용', '접어서 보관', '세척이 쉬운 소재', '사용법: 펼친 뒤 끼우고 닫는다'],
      material: '플라스틱',
      reviewsText: '아이가 좋아해요. 접어서 보관하기 편해요.',
      rating: 4.8,
      size: '30cm x 20cm',
      colorOptions: ['빨강', '파랑', '노랑', '초록'],
      targetPersona: '초등학생 자녀를 둔 부모',
      certificationInfo: 'KC',
      eventBannerInfo: '이벤트',
      brandVoiceGuide: '따뜻하게',
      ...over.spec,
    } as PdpSpecSheet,
    analysis: {
      objection_priority: ['세척은 어떻게 하나요?', '크기가 어느 정도인가요?', '선물로 괜찮나요?'],
      pain_clusters: [{ pain: '정리가 번거로움', urgency: 'medium' }],
      benefit_clusters: [
        { name: '편리함', weight: 0.5 },
        { name: '보관', weight: 0.3 },
        { name: '위생', weight: 0.2 },
      ],
      detected_category: 'household',
    },
    strategyContract: {
      involvement_level: 'low',
      persuasion_axis: 'emotion',
      page_length_target: 'standard',
      purchase_context: 'gift',
    },
    category: 'household',
    snapshotV2: { ...snapshot, profile: { ...snapshot.profile, sectionCountMedian: 7 } },
    vocab,
    ...(over.designcut2 ? { designcut2: true } : {}),
  }
}

function fixtureJob(key: FixtureKey, features: string[]): PdpJobRow {
  const j = fixtureToJob(loadEnrichmentFixture(key))
  j.analysis = { ...j.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  return j
}
const strategyOf = (j: PdpJobRow) => mergeManualStrategy(j.analysis.recommended_strategy_contract ?? {}, j.spec_sheet, [])
const orderOf = (j: PdpJobRow) => resolveDesignSkeleton(j, strategyOf(j)).skeleton?.sectionOrder
const directPlan = (j: PdpJobRow, designcut2?: boolean) =>
  planPersuasionSkeleton({
    specSheet: j.spec_sheet,
    analysis: j.analysis,
    strategyContract: strategyOf(j),
    research: j.research_result,
    category: j.analysis.detected_category,
    snapshotV2: getCorpusSnapshotV2(j.analysis.detected_category),
    vocab,
    ...(designcut2 ? { designcut2: true } : {}),
  })

describe('planPersuasionSkeleton — designcut2 길이 목표', () => {
  it('기본 목표가 후기를 빼는 입력에서 D2는 perf_reviews를 살린다(길이 목표 [18,22]·상한 22, 나누기 가중치 없음)', () => {
    const standard = planPersuasionSkeleton(richInput())
    // 전제: 기본 목표의 상한(중앙값×1.5)이 후기 단위를 뺀다 — R10 P02와 같은 경로
    expect(standard.sectionOrder).not.toContain(S.PERFORMANCE_REVIEWS)
    const capped = standard.excluded.filter((e) => e.role === 'social_proof' && e.reason.includes('길이 상한 10'))
    expect(capped.map((e) => e.reason).join(' ')).toContain(S.PERFORMANCE_REVIEWS)

    const d2 = planPersuasionSkeleton(richInput({ designcut2: true }))
    expect(d2.sectionOrder).toContain(S.PERFORMANCE_REVIEWS)
    expect(d2.persuasion.lengthTarget).toEqual([18, 22])
    expect(d2.sectionOrder.length).toBeGreaterThan(standard.sectionOrder.length)
    expect(d2.sectionOrder.length).toBeLessThanOrEqual(22)
    expect(d2.excluded.filter((e) => e.reason.includes('길이 상한'))).toEqual([])
    // 나누기(split)와 달리 sub_div를 강제로 계획하거나 섹션을 예상 개수로 세지 않는다
    expect(d2.persuasion.stages.find((st) => st.section === S.SUB_DIV)?.reason).not.toBe('나누기 — 특징 4~6')
    expect(d2.persuasion.rules.find((r) => r.id === 'R6')?.pass).toBe(d2.sectionOrder.length >= 18)
  })

  it('후기 근거가 없으면 D2여도 후기 섹션을 만들지 않는다(가상 후기 금지)', () => {
    const none = planPersuasionSkeleton(
      richInput({ designcut2: true, spec: { reviewsText: undefined, rating: undefined, reviewCount: 0 } })
    )
    expect(none.sectionOrder).not.toContain(S.PERFORMANCE_REVIEWS)
    expect(none.excluded.find((e) => e.role === 'social_proof')?.reason).toContain('근거 없는 후기 섹션 금지')

    const b = fixtureJob('B-track-i', [...TRACK_I, 'designcut', 'designcut2'])
    expect(orderOf(b)).not.toContain(S.PERFORMANCE_REVIEWS)
  })
})

describe('설계 단계 연결 — designcut2 기록 잡만', () => {
  it('designcut + designcut2 기록 잡은 길이 목표 [18,22]로 계획한다', () => {
    const j = fixtureJob('A-track-i', [...TRACK_I, 'designcut', 'designcut2'])
    const decision = resolveDesignSkeleton(j, strategyOf(j))
    expect(decision.persuasion?.lengthTarget).toEqual([18, 22])
    expect(decision.skeleton?.sectionOrder).toEqual(directPlan(j, true).sectionOrder)
  })

  it('Track I 골든(A·B·C)과 D1 잡의 section_order는 그대로다', () => {
    for (const key of ['A-track-i', 'B-track-i', 'C-track-i'] as const) {
      const trackI = fixtureJob(key, TRACK_I)
      expect(orderOf(trackI), key).toEqual(directPlan(trackI).sectionOrder)
      const d1 = fixtureJob(key, [...TRACK_I, 'designcut'])
      expect(orderOf(d1), `${key} D1`).toEqual(directPlan(d1).sectionOrder)
      // 기록 검사는 designcut2 단독(스위치가 만들지 않는 기록)으로는 켜지지 않는다
      const lone = fixtureJob(key, [...TRACK_I, 'designcut2'])
      expect(orderOf(lone), `${key} designcut2 단독`).toEqual(directPlan(lone).sectionOrder)
    }
  })
})
