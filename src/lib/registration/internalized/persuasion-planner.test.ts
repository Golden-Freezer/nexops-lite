import { describe, expect, it } from 'vitest'
import { ProSectionType as S } from '@/lib/registration/editor/types/section'
import { getCorpusSnapshotV2, type Role16 } from '../corpus-v2'
import { getDesignVocab } from '../design-vocab'
import type { AnalysisResult, PdpSpecSheet, StrategyContract } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture, type FixtureKey } from '../__golden__/golden-harness'
import { planPersuasionSkeleton, selectGrammar, type PersuasionInput } from './persuasion-planner'
import { ROLE_TO_SECTIONS_ENRICHED } from './role-section-map'

const vocab = getDesignVocab()!

function input(overrides: { spec?: Partial<PdpSpecSheet>; analysis?: Partial<AnalysisResult>; sc?: StrategyContract; category?: string } = {}): PersuasionInput {
  const category = overrides.category ?? 'household'
  return {
    specSheet: { productName: '테스트 상품', keyFeatures: ['간편한 원터치 사용'], material: '플라스틱', ...overrides.spec },
    analysis: {
      objection_priority: ['세척은 어떻게 하나요?'],
      pain_clusters: [{ pain: '정리가 번거로움', urgency: 'medium' }],
      benefit_clusters: [{ name: '편리함', weight: 0.5 }, { name: '디자인', weight: 0.3 }, { name: '가성비', weight: 0.2 }],
      detected_category: category,
      ...overrides.analysis,
    },
    strategyContract: overrides.sc ?? { involvement_level: 'low', persuasion_axis: 'function', page_length_target: 'standard' },
    category,
    snapshotV2: getCorpusSnapshotV2(category),
    vocab,
  }
}

describe('문법 변형(G2 → G4 → G3 → G1)', () => {
  const analysis: AnalysisResult = { pain_clusters: [{ pain: 'x', urgency: 'medium' }] }
  it.each([
    ['G2', { proof_sensitivity: 'high', persuasion_axis: 'emotion', purchase_context: 'gift' }, { reviewsText: '좋아요', rating: 4.8 }],
    ['G4', { proof_sensitivity: 'high', persuasion_axis: 'emotion', purchase_context: 'gift' }, {}], // 강한 증거 없음 → G2 아님
    ['G4', { persuasion_axis: 'emotion' }, { targetPersona: '20대 직장인' }],
    ['G3', { involvement_level: 'low', page_length_target: 'quick' }, {}],
    ['G1', { involvement_level: 'high', page_length_target: 'standard' }, {}],
  ] as const)('%s', (expected, sc, spec) => {
    expect(selectGrammar(sc as StrategyContract, { productName: 'x', ...spec } as PdpSpecSheet, analysis).grammar).toBe(expected)
  })

  it('G3은 고통 긴급도 high가 있으면 아니다', () => {
    const sc: StrategyContract = { involvement_level: 'low', page_length_target: 'quick' }
    expect(selectGrammar(sc, { productName: 'x' }, { pain_clusters: [{ pain: 'x', urgency: 'high' }] }).grammar).toBe('G1')
  })
})

describe('포함 결정 — 근거 없는 섹션 금지', () => {
  it('리뷰·치수·인증·이벤트·옵션이 없으면 해당 섹션을 만들지 않고 사유를 남긴다', () => {
    const plan = planPersuasionSkeleton(input())
    for (const s of [S.PERFORMANCE_REVIEWS, S.PERFORMANCE_RATING, S.SPEC_TABLE, S.CERTIFICATION, S.EVENT_BANNER, S.PETIT_DIV]) {
      expect(plan.sectionOrder).not.toContain(s)
    }
    const reasons = Object.fromEntries(plan.excluded.map((e) => [e.role, e.reason]))
    expect(reasons.social_proof).toContain('리뷰')
    expect(reasons.size_spec).toContain('치수')
    expect(reasons.certification_evidence).toContain('certificationInfo')
    expect(reasons.faq).toContain('FAQ')
  })

  it('근거가 있으면 넣는다 — 리뷰(평점 있을 때만 perf_rating)·치수·인증·옵션 ≥ 4·이벤트', () => {
    const plan = planPersuasionSkeleton(input({
      spec: { reviewsText: '튼튼해요', rating: 4.7, size: '10x20cm', certificationInfo: 'KC 인증', colorOptions: ['a', 'b', 'c', 'd'], eventBannerInfo: '첫 구매 할인' },
      sc: { persuasion_axis: 'function', page_length_target: 'persuasive' },
    }))
    for (const s of [S.PERFORMANCE_REVIEWS, S.PERFORMANCE_RATING, S.SPEC_TABLE, S.CERTIFICATION, S.PETIT_DIV, S.EVENT_BANNER]) {
      expect(plan.sectionOrder).toContain(s)
    }
    const noRating = planPersuasionSkeleton(input({ spec: { reviewsText: '튼튼해요' }, sc: { page_length_target: 'persuasive' } }))
    expect(noRating.sectionOrder).toContain(S.PERFORMANCE_REVIEWS)
    expect(noRating.sectionOrder).not.toContain(S.PERFORMANCE_RATING)
  })

  it('안전·소재 고민은 근거가 없으면 응답 섹션 대신 주장 금지 사유를 남긴다', () => {
    const plan = planPersuasionSkeleton(input({ analysis: { objection_priority: ['안전성은 확보되어 있나?', 'PE 소재 환경 우려'] } }))
    const [safety, eco] = plan.persuasion.objectionCoverage
    expect(safety).toMatchObject({ type: 'safety_cert', answeredBy: null })
    expect(safety.note).toContain('인증')
    expect(eco).toMatchObject({ type: 'material_eco', answeredBy: null })
    expect(eco.note).toContain('친환경')
  })

  it('사용법 고민은 hidden_page로 답한다(정정 매핑)', () => {
    const plan = planPersuasionSkeleton(input())
    expect(plan.persuasion.objectionCoverage[0]).toMatchObject({ type: 'usage_care', answeredBy: S.HIDDEN_PAGE })
    expect(plan.sectionOrder).toContain(S.HIDDEN_PAGE)
    expect(plan.sectionOrder).not.toContain(S.PETIT_DIV)
  })

  it('공감 섹션이 있으면 solution_guide가 바로 뒤에 온다(R8)', () => {
    const plan = planPersuasionSkeleton(input())
    const last = Math.max(plan.sectionOrder.lastIndexOf(S.PROBLEM_RAISE), plan.sectionOrder.lastIndexOf(S.PROBLEM_EMPATHY))
    if (last !== -1) expect(plan.sectionOrder[last + 1]).toBe(S.SOLUTION_GUIDE)
  })
})

describe('결정론·매핑·길이', () => {
  it('같은 입력이면 같은 출력', () => {
    expect(planPersuasionSkeleton(input())).toEqual(planPersuasionSkeleton(input()))
  })

  it('모든 섹션이 정정 매핑의 해당 역할 섹션에 속한다', () => {
    const plan = planPersuasionSkeleton(input({ spec: { reviewsText: 'r', size: 's', certificationInfo: 'c', eventBannerInfo: 'e', colorOptions: ['a', 'b', 'c', 'd'] } }))
    for (const stage of plan.persuasion.stages) {
      if (stage.role === 'cta') {
        expect(stage.section).toBe(S.CTA)
        continue
      }
      expect(ROLE_TO_SECTIONS_ENRICHED[stage.role as Role16].sections.map(String), `${stage.role}→${stage.section}`).toContain(stage.section)
    }
  })

  it('섹션 수는 목표 범위 상한을 넘지 않는다(R6)', () => {
    const plan = planPersuasionSkeleton(input({ spec: { reviewsText: 'r', rating: 5, size: 's', certificationInfo: 'c', eventBannerInfo: 'e', colorOptions: ['a', 'b', 'c', 'd'] }, sc: { page_length_target: 'quick' } }))
    expect(plan.sectionOrder.length).toBeLessThanOrEqual(plan.persuasion.lengthTarget[1])
    expect(plan.sectionOrder).toContain(S.MAIN_CUT)
    expect(plan.sectionOrder).toContain(S.POINT_DIV)
    expect(plan.sectionOrder[plan.sectionOrder.length - 1]).toBe(S.CTA)
  })
})

describe('v2 없는 카테고리 — vocab pooled', () => {
  it('stationery는 pooled 사전값으로 계획하고 근거 출처를 남긴다', () => {
    const plan = planPersuasionSkeleton(input({ category: 'stationery' }))
    expect(plan.persuasion.priorSource).toBe('coupang:pooled')
    expect(plan.persuasion.vocabHash).toBe(vocab.contentHash)
    expect(plan.persuasion.rules.find((r) => r.id === 'R1')?.pass).toBe(true)
  })

  it('pooled hook 게이트는 v2와 같은 공식(problem 출현율 ≥ 0.15)을 vocab에 적용한다', () => {
    const problem = vocab.platforms.coupang.pooled.roles.problem!.prevalence
    expect(problem).toBeGreaterThanOrEqual(0.15)
    const plan = planPersuasionSkeleton(input({ category: 'pet' }))
    expect(plan.sectionOrder).toContain(S.HOOK_3STEP)
    expect(plan.roles.find((r) => r.role === 'hook')?.reason).toContain('problem 출현율')
  })
})

describe('검수 반영 — R1 보정·길이·응답 재계산·인접·G3', () => {
  const rich = { reviewsText: '튼튼해요', rating: 4.8, reviewCount: 120, size: '10x20cm', certificationInfo: '피부 자극 시험 완료' }

  it.each(['quick', 'standard', 'persuasive'] as const)('분량 %s — hook·공감 3섹션이 있어도 첫 가치가 5번째 이내(R1)', (len) => {
    for (const axis of ['emotion', 'function', 'balanced'] as const) {
      const plan = planPersuasionSkeleton(input({ sc: { persuasion_axis: axis, purchase_context: 'gift', page_length_target: len } }))
      expect(plan.persuasion.rules.find((r) => r.id === 'R1'), `${len}/${axis}`).toMatchObject({ pass: true })
      expect(plan.sectionOrder.indexOf(S.POINT_DIV)).toBeLessThanOrEqual(4)
    }
  })

  it('G2 증거 선행형에서 증거가 많아도 R1을 지킨다(넘치는 증거는 가치 단계 뒤로)', () => {
    const plan = planPersuasionSkeleton(input({ spec: rich, sc: { proof_sensitivity: 'high', page_length_target: 'persuasive' } }))
    expect(plan.persuasion.grammar).toBe('G2')
    expect(plan.persuasion.rules.find((r) => r.id === 'R1')?.pass).toBe(true)
  })

  it('길이가 부족하면 brand_story(concept_desc)를 먼저 뺀다', () => {
    const plan = planPersuasionSkeleton(input({ sc: { persuasion_axis: 'emotion', purchase_context: 'gift', page_length_target: 'quick' } }))
    expect(plan.sectionOrder).not.toContain(S.CONCEPT_DESC)
    expect(plan.excluded.find((e) => e.role === 'brand_story')?.reason).toContain('길이 상한')
  })

  it('응답 섹션이 빠지면 설계 표의 usp 대체로 바꾸거나 미응답으로 기록한다(빠진 섹션을 가리키지 않음)', () => {
    for (const len of ['quick', 'standard'] as const) {
      const plan = planPersuasionSkeleton(input({
        analysis: { objection_priority: ['다양한 상황에서 쓸 수 있나', '10개면 충분할까', '세척은 어떻게 하나요?'] },
        sc: { persuasion_axis: 'emotion', purchase_context: 'gift', page_length_target: len },
      }))
      for (const o of plan.persuasion.objectionCoverage) {
        if (o.answeredBy) expect(plan.sectionOrder, `${len}: ${o.answeredBy}`).toContain(o.answeredBy)
        else expect(o.note).toBeTruthy()
      }
    }
  })

  it('주장-증거 인접 — 인증이 가치 군집을 뒷받침하면 certification을 그 usp 섹션 바로 뒤에 둔다', () => {
    const plan = planPersuasionSkeleton(input({
      spec: { certificationInfo: '피부 자극 시험 완료' },
      analysis: { benefit_clusters: [{ name: '저자극 피부 케어', weight: 0.6 }, { name: '휴대성', weight: 0.4 }] },
      sc: { page_length_target: 'standard' },
    }))
    const at = plan.sectionOrder.indexOf(S.CERTIFICATION)
    expect(plan.sectionOrder[at - 1]).toBe(S.POINT_DIV)
  })

  it('G3 즉시 가치형 — 불안 해소 단계는 상위 고민 응답 섹션만 남긴다', () => {
    const plan = planPersuasionSkeleton(input({
      spec: { size: '10x20cm' },
      analysis: { objection_priority: ['세척은 어떻게 하나요?'], pain_clusters: [{ pain: 'x', urgency: 'low' }] },
      sc: { involvement_level: 'low', page_length_target: 'quick', persuasion_axis: 'function' },
    }))
    expect(plan.persuasion.grammar).toBe('G3')
    expect(plan.sectionOrder).toContain(S.HIDDEN_PAGE) // 1순위 고민 응답
    expect(plan.sectionOrder).not.toContain(S.SPEC_TABLE) // 고민에 답하지 않는 불안 해소 섹션
    expect(plan.excluded.find((e) => e.role === 'size_spec')?.reason).toContain('G3')
  })

  it('일부 섹션만 빠지면 역할 유지 표지를 단다, authenticity 사유는 근거 유무로 갈린다', () => {
    const plan = planPersuasionSkeleton(input({ sc: { persuasion_axis: 'emotion', purchase_context: 'gift', page_length_target: 'quick' } }))
    const partial = plan.excluded.filter((e) => plan.roles.some((r) => r.role === e.role))
    expect(partial.every((e) => e.reason.startsWith('[일부 섹션 — 역할 유지]'))).toBe(true)
    expect(plan.excluded.find((e) => e.role === 'authenticity')?.reason).toContain('certificationInfo 없음')
    const withCert = planPersuasionSkeleton(input({ spec: { certificationInfo: 'KC' } }))
    expect(withCert.excluded.find((e) => e.role === 'authenticity')?.reason).toContain('통합')
  })
})

describe('기준 상품 골격(사람 검토 후 고정)', () => {
  it.each(['A-track-i', 'B-track-i', 'C-track-i'] as FixtureKey[])('%s', (key) => {
    const job = fixtureToJob(loadEnrichmentFixture(key))
    const plan = planPersuasionSkeleton({
      specSheet: job.spec_sheet,
      analysis: job.analysis,
      strategyContract: mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, []),
      research: job.research_result,
      category: job.analysis.detected_category,
      snapshotV2: getCorpusSnapshotV2(job.analysis.detected_category),
      vocab,
    })
    expect({
      grammar: plan.persuasion.grammar,
      lengthTarget: plan.persuasion.lengthTarget,
      stages: plan.persuasion.stages.map((s) => `${s.stage}:${s.section}`),
      objectionCoverage: plan.persuasion.objectionCoverage.map((o) => `${o.type}→${o.answeredBy ?? `미응답(${o.note})`}`),
      excluded: plan.excluded.map((e) => e.role),
      priorSource: plan.persuasion.priorSource,
    }).toMatchSnapshot()
  })
})
