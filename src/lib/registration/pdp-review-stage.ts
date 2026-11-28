/**
 * 리뷰 입력(pdp-review-input) 파이프라인 연결 — 경쟁사 리뷰가 있는 잡만 동작한다. 없으면 모든 함수가 아무것도 하지 않아
 * 분석·리서치·카피 프롬프트와 저장 산출이 지금과 같다(골든 고정).
 * - 분석: 경쟁사 콜(본 분석과 병렬) → analysis.competitor_pain_points. 실패는 경고만 남기고 계속한다.
 * - 리서치: 불만 요약을 덧붙임 블록으로만 넘긴다(analysisForPrompt가 analysis JSON에서는 뺀다).
 * - 카피: 재현 가드 ②(겹친 섹션 이름만 지시해 1회 재생성)·③(모든 게이트 뒤 남은 문장 지우기).
 */

import { billedCostOf, billedUsageOf } from '@/lib/agents/billed-usage'
import type { AgentUsage, RunContext } from '@/lib/agents/types'
import { runCompetitorReviewAnalysis } from '@/lib/agents/registration/pdp-competitor-review-agent'
import { buildCompetitorPainBlock } from '@/lib/agents/registration/prompts/pdp-competitor-review-prompts'
import type { AnalysisResult, CopySectionsPayload, CopywritingResult, PdpJobRow, PdpSpecSheet } from './pdp-state'
import { readCompetitorReviews } from './reviews/competitor-reviews'
import { buildEchoGuard, stripCopyEchoes, type EchoGuard } from './reviews/competitor-echo'
import { referenceGuardTexts } from './references/reference-inputs'
import type { CompetitorPainSummary, CompetitorReviews } from './reviews/review-types'
import { runReviewFaqAnalysis } from '@/lib/agents/registration/pdp-review-faq-agent'
import { hasReviewFaqMaterial, type ReviewFaqItem, type ReviewFaqStats } from './reviews/review-faq'

export interface ReviewFaqStageResult {
  items: ReviewFaqItem[]
  stats: ReviewFaqStats
  costUsd: number
  warning?: string
}

/** 후기 속 실제 질문(reviewfaq 잡, 설계 단계) — 글 후기가 적으면 부르지 않는다. 실패는 경고만 남기고 고정 질문으로 계속한다 */
export async function runReviewFaqStage(spec: PdpSpecSheet, runContext: RunContext): Promise<ReviewFaqStageResult | null> {
  if (!hasReviewFaqMaterial(spec.reviewsText)) return null
  const result = await runReviewFaqAnalysis({ reviewsText: spec.reviewsText!.trim(), spec, runContext })
  if (!result.success) {
    return {
      items: [],
      stats: { kept: 0, dropped: 0, failed: true },
      costUsd: billedCostOf(result),
      warning: `[ReviewFaq] 후기 질문 찾기 실패 — 고정 질문으로 계속: ${result.error.message}`,
    }
  }
  const { items, dropped } = result.data
  return {
    items,
    stats: { kept: items.length, dropped },
    costUsd: billedCostOf(result),
    ...(items.length === 0 ? { warning: `[ReviewFaq] 쓸 수 있는 후기 질문이 없음(검사에서 ${dropped}건 버림)` } : {}),
  }
}

export interface CompetitorStageResult {
  summary?: CompetitorPainSummary
  usage: AgentUsage
  warning?: string
}

export async function runCompetitorReviewStage(
  reviews: CompetitorReviews,
  runContext: RunContext
): Promise<CompetitorStageResult> {
  const result = await runCompetitorReviewAnalysis({ reviews, runContext })
  if (!result.success) {
    return {
      usage: billedUsageOf(result),
      warning: `[CompetitorReviews] 경쟁사 리뷰 분석 실패 — 소구점 분석 없이 계속: ${result.error.message}`,
    }
  }
  const { summary, dropped } = result.data
  return {
    summary,
    usage: billedUsageOf(result),
    ...(summary.items.length === 0
      ? { warning: `[CompetitorReviews] 쓸 수 있는 불만 유형이 없음(검사에서 ${dropped}건 버림)` }
      : {}),
  }
}

/** 요약이 있을 때만 키를 더한다 — 없으면 같은 객체(구 잡·경쟁사 없는 잡의 저장 산출 불변) */
export function withCompetitorPainPoints(
  analysis: AnalysisResult,
  summary: CompetitorPainSummary | undefined
): AnalysisResult {
  return summary ? { ...analysis, competitor_pain_points: summary } : analysis
}

/** 리서치 덧붙임 블록 — 요약 항목이 없으면 undefined */
export function competitorResearchBlock(job: PdpJobRow): string | undefined {
  return buildCompetitorPainBlock(job.analysis.competitor_pain_points)
}

/**
 * 경쟁사 리뷰나 레퍼런스(자사 기존 페이지 own 제외) 원문이 있는 잡만 재현 가드를 만든다 — 자사 리뷰 텍스트와 own 레퍼런스 원문에도
 * 있는 표현은 뺀다(자사 인용·우리 기존 문구 오탐 방지). 레퍼런스가 없는 잡은 예전과 같다
 */
export function competitorEchoGuard(job: PdpJobRow): EchoGuard | null {
  const reviews = readCompetitorReviews(job.spec_sheet)
  const references = referenceGuardTexts(job.spec_sheet)
  const texts = [...(reviews ? reviews.items.flatMap((it) => [it.title, it.body]) : []), ...references.texts]
  if (texts.length === 0) return null
  return buildEchoGuard(texts, [job.spec_sheet.reviewsText ?? '', ...references.exclude])
}

export type CompetitorEchoRecord = NonNullable<CopySectionsPayload['competitor_echo']>

/** 가드 ③ — 모든 게이트 뒤 남은 겹침 문장을 지운다 */
export function finishCompetitorEcho(
  copy: CopywritingResult,
  guard: EchoGuard,
  record: Omit<CompetitorEchoRecord, 'removed'>
): { copy: CopywritingResult; record: CompetitorEchoRecord; warning?: string } {
  const stripped = stripCopyEchoes(copy, guard)
  const total = stripped.removed.reduce((a, r) => a + r.sentences, 0)
  return {
    copy: stripped.copy,
    record: { ...record, removed: stripped.removed },
    ...(total > 0
      ? {
          warning: `[CompetitorEcho] 경쟁 상품 리뷰와 겹친 문장 ${total}개를 지움 — copy_sections.competitor_echo 참조`,
        }
      : {}),
  }
}
