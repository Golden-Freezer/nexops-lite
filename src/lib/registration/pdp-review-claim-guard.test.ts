/**
 * 후기 사용 범위(R6, 2026-10-30 오너 지시) — 자사 리뷰(reviewsText)가 있는 모든 잡(Track S·I, 플래너 기록과 무관)에 '후기 속
 * 인증·인허가·의학적 효능 표현은 옮기지 않고, 사용 경험·체감 효익은 살려 구체적으로 쓴다' 블록이 붙는다. 카피 Stage 1 그라운딩·
 * Stage 2·3·보충 말미(파이프라인 — pdp-review-claims-pipeline.test)와 편집기 카피 재생성, 리뷰 분석 섹션(REVIEWS_ANALYSIS_PROMPT)에
 * 같은 줄이 실린다. 리뷰가 없는 잡은 지금 그대로다. 주장 범위 블록의 신체 접촉 줄도 같은 기준(인증·의학·기능성만 금지, 사용 감각은 사실과 함께)
 */

import { describe, expect, it } from 'vitest'
import p03 from './__fixtures__/r1/p03-f2d72bd0.json'
import { buildReviewsAnalysisSection } from '@/lib/agents/registration/pdp-copy-defaults'
import { REVIEW_CLAIM_BLOCK, REVIEW_CLAIM_LINE } from '@/lib/agents/registration/prompts/pdp-claim-guard-prompts'
import { fixtureToJob, loadEnrichmentFixture } from './__golden__/golden-harness'
import { parseCopyRegenRequest } from './pdp-copy-regen'
import { buildCopyRegenContext } from './pdp-copy-regen-request'
import { resolveClaimGuardBlock } from './pdp-enrichment-stage'
import type { PdpJobRow } from './pdp-state'
import { reviewClaimBlockFor } from './reviews/review-claims'

const REVIEWS = '[리뷰1] 평점 5/5 · 도움 0\n내용: 손잡이가 편해서 매일 들고 다녀요'

/** 설득 플래너 기록 잡(R1 P03) */
function plannerJob(reviewsText?: string): PdpJobRow {
  return {
    id: 'r1-job',
    generation_track: p03.generation_track,
    mode: p03.mode,
    spec_sheet: { ...p03.spec_sheet, ...(reviewsText !== undefined ? { reviewsText } : {}) },
    analysis: { ...p03.analysis, enrichment: { version: 1, features: p03.section_plan.enrichment.features } },
    research_result: p03.research_result,
    section_plan: p03.section_plan,
  } as unknown as PdpJobRow
}

/** 기록 없는 골든 잡(A-track-s — 운영 기본 생성 Track S, 픽스처에 자사 리뷰가 있다) */
function standardJob(reviewsText?: string): PdpJobRow {
  const base = fixtureToJob(loadEnrichmentFixture('A-track-s'))
  return reviewsText === undefined ? base : { ...base, spec_sheet: { ...base.spec_sheet, reviewsText } }
}

function regenSystem(job: PdpJobRow): string {
  const parsed = parseCopyRegenRequest({ sectionType: 'hook_3step', currentText: '두피 구석까지 개운해져요' })
  if (!parsed.ok) throw new Error(parsed.error)
  return buildCopyRegenContext(job, parsed.value).prompts.system
}

describe('후기 사용 범위(R6) — 자사 리뷰가 있는 모든 잡', () => {
  it('블록은 머리말 + 후기 줄 — 리뷰가 있으면 블록, 비었거나 없으면 null', () => {
    expect(REVIEW_CLAIM_BLOCK).toBe(
      `## [후기 사용 범위 — 인증·의학 표현은 옮기지 않고, 사용 경험은 살린다]\n${REVIEW_CLAIM_LINE}`
    )
    expect(REVIEW_CLAIM_LINE).toContain('의학적 효능 표현(질병명·치료·처방·질병 예방')
    expect(REVIEW_CLAIM_LINE).toContain('은 옮기지 않는다. 사용 경험과 체감 효익은 살려 구체적으로 쓴다')
    expect(reviewClaimBlockFor({ reviewsText: REVIEWS })).toBe(REVIEW_CLAIM_BLOCK)
    expect(reviewClaimBlockFor({ reviewsText: '   ' })).toBeNull()
    expect(reviewClaimBlockFor({})).toBeNull()
  })

  it('주장 범위 블록(플래너 기록 잡)에 후기 줄은 없다 — 별도 블록으로 붙는다', () => {
    expect(resolveClaimGuardBlock(plannerJob(REVIEWS))).toBe(resolveClaimGuardBlock(plannerJob()))
    expect(resolveClaimGuardBlock(plannerJob(REVIEWS))).not.toContain(REVIEW_CLAIM_LINE)
  })

  it('주장 범위 블록의 신체 접촉 줄(P03 두피 브러시)도 같은 기준 — 인증·의학·기능성만 금지, 사용 감각은 사실과 함께 쓴다', () => {
    const block = resolveClaimGuardBlock(plannerJob())!
    expect(block).toContain('모든 필드에서 인증·인허가·의학·기능성 효능은 주장하지 않는다')
    expect(block).toContain('시원함·개운함·편안함 같은 사용 감각과 노폐물·각질 제거·피부결 같은 체감 효능은 상품 사실(소재·구조·사용법)과 함께 구체적으로 쓴다')
    expect(block).toContain('체감 효능(노폐물·각질 제거, 피부결, 개운함·시원함·편안함 등)은 상품 사실(소재·구조·사용법)과 함께 쓴다')
    expect(block).not.toContain('감각 효과(개운함·시원함')
    expect(block).not.toContain('오감 트리거')
  })

  it('리뷰 분석 섹션(Stage 1·premium)에도 같은 줄 — 리뷰가 없으면 섹션 자체가 없다', () => {
    expect(buildReviewsAnalysisSection(REVIEWS)).toContain(REVIEW_CLAIM_LINE)
    expect(buildReviewsAnalysisSection('')).toBe('')
  })

  it('편집기 카피 재생성: 기록 없는 Track S 잡도 리뷰가 있으면 블록을 받고, 리뷰가 없으면 그대로', () => {
    const withReviews = regenSystem(standardJob())
    expect(standardJob().spec_sheet.reviewsText?.trim()).toBeTruthy()
    expect(withReviews).toContain(REVIEW_CLAIM_BLOCK)
    expect(withReviews).not.toContain('[주장 범위 — 의학·인증 효능은 쓰지 않고, 체감 효능은 사실과 함께 쓴다]')
    expect(regenSystem(standardJob(''))).not.toContain(REVIEW_CLAIM_LINE)
    // 플래너 기록 잡은 주장 범위 블록 뒤에 후기 블록
    const planner = regenSystem(plannerJob(REVIEWS))
    expect(planner.indexOf(REVIEW_CLAIM_BLOCK)).toBeGreaterThan(planner.indexOf('[주장 범위 — 의학·인증 효능은 쓰지 않고, 체감 효능은 사실과 함께 쓴다]'))
  })
})
