/**
 * W4-S 섹션 나누기 플래너(ENRICHMENT `split`) — 길이 목표 [14,18]·상한 18, 특징 4~6을 담을 sub_div를 늘 계획하고,
 * 펼쳐질 섹션(point_div·sub_div·hidden_page)은 예상 개수 3으로 센다(R6·길이 상한). split이 없으면 지금 그대로다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProSectionType as S } from '@/lib/registration/editor/types/section'
import { getCorpusSnapshotV2 } from '../corpus-v2'
import { getDesignVocab } from '../design-vocab'
import type { AnalysisResult, PdpSpecSheet, StrategyContract } from '../pdp-state'
import { planPersuasionSkeleton, splitLengthTarget, type PersuasionInput } from './persuasion-planner'

const vocab = getDesignVocab()!

function input(
  over: {
    spec?: Partial<PdpSpecSheet>
    analysis?: Partial<AnalysisResult>
    sc?: StrategyContract
    split?: boolean
  } = {}
): PersuasionInput {
  return {
    specSheet: { productName: '테스트 상품', keyFeatures: ['간편한 원터치 사용'], material: '플라스틱', ...over.spec },
    analysis: {
      objection_priority: ['세척은 어떻게 하나요?'],
      pain_clusters: [{ pain: '정리가 번거로움', urgency: 'medium' }],
      // 가치 군집 1개 — 지금은 sub_div가 계획되지 않는 입력
      benefit_clusters: [{ name: '편리함', weight: 0.5 }],
      detected_category: 'household',
      ...over.analysis,
    },
    strategyContract: over.sc ?? {
      involvement_level: 'low',
      persuasion_axis: 'function',
      page_length_target: 'standard',
    },
    category: 'household',
    snapshotV2: getCorpusSnapshotV2('household'),
    vocab,
    ...(over.split ? { split: true } : {}),
  }
}

const WEIGHT: Record<string, number> = { [S.POINT_DIV]: 3, [S.SUB_DIV]: 3, [S.HIDDEN_PAGE]: 3 }

describe('planPersuasionSkeleton — split', () => {
  it('split이 없으면 지금 그대로 — 가치 군집 1개면 sub_div 없음, 길이 목표는 전략 기준', () => {
    const plan = planPersuasionSkeleton(input())
    expect(plan.sectionOrder).not.toContain(S.SUB_DIV)
    expect(plan.persuasion.lengthTarget).not.toEqual([20, 24])
    expect(plan.sectionOrder).not.toContain(S.KEY_MESSAGE)
  })

  it('split이면 길이 목표 [20,24]·상한 24, sub_div를 늘 계획한다(특징 4~6)', () => {
    const plan = planPersuasionSkeleton(input({ split: true }))
    expect(plan.persuasion.lengthTarget).toEqual([20, 24])
    expect(plan.sectionOrder).toContain(S.POINT_DIV)
    expect(plan.sectionOrder).toContain(S.SUB_DIV)
    expect(plan.persuasion.stages.find((s) => s.section === S.SUB_DIV)?.reason).toBe('나누기 — 특징 4~6')
  })

  it('R6는 펼쳐질 섹션을 예상 개수 3으로 센다', () => {
    const plan = planPersuasionSkeleton(input({ split: true }))
    const count = plan.sectionOrder.reduce((n, s) => n + (WEIGHT[s] ?? 1), 0)
    const r6 = plan.persuasion.rules.find((r) => r.id === 'R6')!
    expect(r6.pass).toBe(count >= 20 && count <= 24)
    if (!r6.pass) expect(r6.detail).toContain(`섹션 ${count}개, 목표 20~24`)
    expect(count).toBeLessThanOrEqual(24)
  })

  it('길이 채움 — 사실 요구 없는 섹션만 가치 단계 끝에 더한다. 근거 게이트 섹션은 만들지 않고 첫 가치 위치(R1)를 밀지 않는다', () => {
    const plan = planPersuasionSkeleton(input({ split: true }))
    const order = plan.sectionOrder
    for (const section of [S.KEY_MESSAGE, S.DIRECTION_SUGGEST, S.CONCEPT_DESC, S.POINT_LIST_DIV]) expect(order, section).toContain(section)
    // 마무리와 같은 글·같은 컷을 그리는 섹션은 채움에 넣지 않는다
    expect(order).not.toContain(S.CONVERT_DIV)
    for (const section of [S.CERTIFICATION, S.EVENT_BANNER, S.PERFORMANCE_REVIEWS, S.SPEC_TABLE]) expect(order, section).not.toContain(section)
    expect(order.indexOf(S.KEY_MESSAGE)).toBeGreaterThan(order.indexOf(S.POINT_DIV))
    expect(plan.persuasion.rules.find((r) => r.id === 'R1')?.pass).toBe(true)
    expect(plan.excluded.find((e) => e.role === 'brand_story')).toBeUndefined()
    expect(plan.persuasion.stages.find((s) => s.section === S.KEY_MESSAGE)?.reason).toBe('길이 채움 — 사실 요구 없음')
  })

  it('길이 채움은 하한을 넘기면 멈춘다 — 상한으로 뺀 섹션을 되살리지 않는다', () => {
    const narrow = { NEXOPS_PDP_SECTION_TARGET: '14,18' }
    vi.stubEnv('NEXOPS_PDP_SECTION_TARGET', narrow.NEXOPS_PDP_SECTION_TARGET)
    const plan = planPersuasionSkeleton(input({ split: true }))
    const count = plan.sectionOrder.reduce((n, s) => n + (WEIGHT[s] ?? 1), 0)
    expect(count).toBeLessThanOrEqual(18)
    expect(plan.persuasion.lengthTarget).toEqual([14, 18])
    vi.unstubAllEnvs()
  })

  it('길이 상한 24 — 펼친 개수로 세어 넘으면 낮은 점수 역할부터 뺀다(근거 게이트는 그대로)', () => {
    const rich = input({
      split: true,
      spec: {
        reviewsText: '좋아요',
        rating: 4.8,
        size: '30cm',
        certificationInfo: 'KC',
        eventBannerInfo: '이벤트',
        colorOptions: ['a', 'b', 'c', 'd'],
      },
      sc: { involvement_level: 'high', persuasion_axis: 'function', page_length_target: 'persuasive' },
    })
    const plan = planPersuasionSkeleton(rich)
    const count = plan.sectionOrder.reduce((n, s) => n + (WEIGHT[s] ?? 1), 0)
    expect(count).toBeLessThanOrEqual(24)
  })
})

describe('splitLengthTarget — 로컬 env로 길이 목표 조정(통합 확정 계약)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('없거나 형식이 틀리거나 Vercel이면 [20,24]', () => {
    expect(splitLengthTarget({})).toEqual([20, 24])
    for (const bad of ['20,10', 'a', '0,5', '12,41', '12', '12,16,20']) {
      expect(splitLengthTarget({ NEXOPS_PDP_SECTION_TARGET: bad }), bad).toEqual([20, 24])
    }
    expect(splitLengthTarget({ NEXOPS_PDP_SECTION_TARGET: '12,16', VERCEL: '1' })).toEqual([20, 24])
  })

  it("'최소,최대'면 그 값 — 플래너 길이 목표·상한과 설득 기록에 그대로 남는다", () => {
    expect(splitLengthTarget({ NEXOPS_PDP_SECTION_TARGET: ' 12 , 16 ' })).toEqual([12, 16])
    vi.stubEnv('NEXOPS_PDP_SECTION_TARGET', '12,16')
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('VERCEL_ENV', '')
    expect(planPersuasionSkeleton(input({ split: true })).persuasion.lengthTarget).toEqual([12, 16])
    // split이 아닌 잡은 env를 보지 않는다
    expect(planPersuasionSkeleton(input()).persuasion.lengthTarget).not.toEqual([12, 16])
  })
})
