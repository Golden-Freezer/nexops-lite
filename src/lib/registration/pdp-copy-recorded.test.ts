/**
 * 카피 기록 잡 입력(recordedCopyInputs, R4 pdp-r4-copy-flow) — 설득 플래너 기록 잡만 구매 결정 성향·후킹 진단·Stage 3 특징
 * 배정을 넘긴다. 후킹 진단은 리서치 원본 값(planning_skeleton.hook_score)에서 숫자인 항목만 — 순수 함수, 외부 호출 0.
 */

import { describe, expect, it } from 'vitest'
import type { PdpJobRow } from './pdp-state'
import { recordedCopyInputs } from './pdp-enrichment-stage'
import { fixtureToJob, loadEnrichmentFixture } from './__golden__/golden-harness'

const STAGES = ['hook_3step', 'main_cut', 'point_div', 'cta'].map((section) => ({
  section,
  role: '',
  stage: 'VALUE',
  reason: '',
}))

function recordJob(hookScore?: unknown): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  return {
    ...job,
    analysis: {
      ...job.analysis,
      decision_profile: { giftability: 'high' },
      enrichment: { version: 1, features: ['vocab', 'persuasion'] },
    },
    research_result: {
      ...job.research_result,
      planning_skeleton: { ...job.research_result.planning_skeleton, hook_score: hookScore },
    },
    section_plan: {
      ...job.section_plan,
      internalized_skeleton: { ...job.section_plan.internalized_skeleton, persuasion: { stages: STAGES } },
    },
  } as unknown as PdpJobRow
}

describe('recordedCopyInputs — 기록 잡만', () => {
  it('구매 결정 성향·후킹 진단(숫자 항목만)·사실형 표시·Stage 3 특징 배정을 넘긴다', () => {
    const inputs = recordedCopyInputs(recordJob({ clarity: 0.8, proof: 0.4, novelty: 'low', relevance: null }))!
    expect(inputs.decisionProfile).toEqual({ giftability: 'high' })
    expect(inputs.hookScore).toEqual({ clarity: 0.8, proof: 0.4 })
    expect(inputs.factOnlyStrategy).toBe(true)
    expect(inputs.stage3OwnershipBlock).toContain('[특징 배정 — 같은 특징을 같은 말로 되풀이하지 않는다]')
    expect(inputs.stage3OwnershipBlock).toContain('- point_div:')
    // 검수용 — Stage 3에 없는 지시를 들먹이지 않는다(R4 copy-bridge)
    expect(inputs.stage3OwnershipBlock).not.toContain('핵심 메시지 3회')
    // hook → (문제 없음) 가치 첫 제목·CTA 잇기 — Stage 2·3 보존 블록
    expect(inputs.stageBridgeBlock).toContain('## [섹션 잇기 보존]')
    expect(inputs.stageBridgeBlock).toContain(
      '- closingCta.headline ← mainIntro.hook의 핵심 낱말 하나를 한 번 다시 쓴다'
    )
  })

  it('후킹 진단은 0~1 숫자만 — 숫자 문자열은 받고(NEXFIT float), 범위 밖·배열은 버린다', () => {
    const inputs = recordedCopyInputs(recordJob({ clarity: '0.45', relevance: 85, novelty: -0.2, proof: 1 }))!
    expect(inputs.hookScore).toEqual({ clarity: 0.45, proof: 1 })
    expect(recordedCopyInputs(recordJob([0.4, 0.3]))).not.toHaveProperty('hookScore')
  })

  it('후킹 진단이 없으면 넘기지 않는다 — 기본값 0.5가 붙어 보강 지시가 모두 켜지지 않게', () => {
    expect(recordedCopyInputs(recordJob(undefined))).not.toHaveProperty('hookScore')
    expect(recordedCopyInputs(recordJob({ clarity: 'x' }))).not.toHaveProperty('hookScore')
  })

  it('설득 플래너 기록이 없는 잡(Track S·기능 기록 없음·플래너 미사용)은 null — 카피 프롬프트 그대로', () => {
    const job = recordJob({ proof: 0.4 })
    expect(recordedCopyInputs({ ...job, analysis: { ...job.analysis, enrichment: undefined } } as PdpJobRow)).toBeNull()
    expect(
      recordedCopyInputs({
        ...job,
        section_plan: { ...job.section_plan, internalized_skeleton: undefined },
      } as PdpJobRow)
    ).toBeNull()
    expect(recordedCopyInputs(fixtureToJob(loadEnrichmentFixture('A-track-s')))).toBeNull()
  })
})
