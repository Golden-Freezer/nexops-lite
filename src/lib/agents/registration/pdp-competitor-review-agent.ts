/**
 * 경쟁사 리뷰 분석(pdp-review-input) — 분석 단계의 별도 1콜. 경쟁사 리뷰 원문은 이 콜에만 들어간다.
 * 본 분석(자사 리뷰·스펙)과 나눈 이유: 한 프롬프트에 섞으면 경쟁사 불만이 우리 상품의 cons·pros로 흘러간다.
 * 산출 검사(코드): 빈도는 모델이 고른 리뷰 번호 중 실제 있는 번호만 센다. 리뷰 문장을 15자 넘게 옮겼거나
 * 지운 판매자명·상품명이 들어간 항목은 버린다(재현 가드 ①). 실패해도 잡은 계속된다 — 파이프라인이 경고로 남긴다.
 */

import { billedUsageOf } from '../billed-usage'
import type { AgentOutput, RunContext } from '../types'
import { callLlm } from '../llm'
import { parseLlmJson } from '../json-parser'
import { pdpRoute } from '@/lib/registration/pdp-model-routes'
import { serializeCompetitorReviews } from '@/lib/registration/reviews/competitor-reviews'
import { buildEchoGuard, hasEcho } from '@/lib/registration/reviews/competitor-echo'
import { containsName } from '@/lib/registration/reviews/review-sanitize'
import type {
  CompetitorPainPoint,
  CompetitorPainSummary,
  CompetitorReviews,
} from '@/lib/registration/reviews/review-types'
import {
  buildCompetitorReviewPrompt,
  COMPETITOR_BENEFIT_MAX_CHARS,
  COMPETITOR_PAIN_MAX_TYPES,
  COMPETITOR_REVIEW_SYSTEM,
  COMPETITOR_TYPE_MAX_CHARS,
} from './prompts/pdp-competitor-review-prompts'

export interface CompetitorReviewInput {
  reviews: CompetitorReviews
  runContext?: RunContext
}

export interface CompetitorReviewOutput {
  summary: CompetitorPainSummary
  /** 검사에서 버린 항목 수(번호 없음·원문 재현·판매자명·상품명) */
  dropped: number
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function clip(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function parsePainPoints(raw: string): unknown[] {
  const parsed = parseLlmJson(raw)
  if (!parsed || !Array.isArray(parsed.pain_points)) throw new Error('pain_points 배열이 없습니다')
  return parsed.pain_points
}

/** 모델 산출 → 검사·집계한 요약(순수 함수) */
export function summarizeCompetitorPainPoints(rawItems: unknown[], reviews: CompetitorReviews): CompetitorReviewOutput {
  const validIds = new Set(reviews.items.map((it) => it.id))
  const guard = buildEchoGuard(reviews.items.flatMap((it) => [it.title, it.body]))
  const sampleSize = reviews.items.length
  const items: CompetitorPainPoint[] = []
  let dropped = 0
  for (const raw of rawItems) {
    if (!isObject(raw)) {
      dropped += 1
      continue
    }
    const type = clip(raw.type, COMPETITOR_TYPE_MAX_CHARS)
    const benefit = clip(raw.benefit_direction, COMPETITOR_BENEFIT_MAX_CHARS)
    const ids = new Set(
      (Array.isArray(raw.review_ids) ? raw.review_ids : []).map(Number).filter((id) => validIds.has(id))
    )
    const echoed = guard !== null && [type, benefit].some((t) => hasEcho(t, guard))
    const named = [type, benefit].some((t) => containsName(t, reviews.checkNames))
    if (!type || ids.size === 0 || echoed || named) {
      dropped += 1
      continue
    }
    items.push({
      type,
      count: ids.size,
      share: Math.round((ids.size / sampleSize) * 100) / 100,
      benefit_direction: benefit,
    })
  }
  items.sort((a, b) => b.count - a.count)
  return {
    summary: {
      version: 1,
      sample_size: sampleSize,
      total_rows: reviews.stats.total_rows,
      items: items.slice(0, COMPETITOR_PAIN_MAX_TYPES),
    },
    dropped,
  }
}

export async function runCompetitorReviewAnalysis(
  input: CompetitorReviewInput
): Promise<AgentOutput<CompetitorReviewOutput>> {
  const start = Date.now()
  const result = await callLlm<unknown[]>(
    pdpRoute('analysis/competitor-reviews'),
    {
      system: COMPETITOR_REVIEW_SYSTEM,
      messages: [{ role: 'user', content: buildCompetitorReviewPrompt(serializeCompetitorReviews(input.reviews)) }],
      timeoutMs: 60_000,
      agentName: 'registration/pdp-competitor-reviews',
      runContext: input.runContext,
    },
    parsePainPoints
  )
  if (!result.success) return result
  return {
    success: true,
    data: summarizeCompetitorPainPoints(result.data, input.reviews),
    usage: billedUsageOf(result),
    duration: Date.now() - start,
  }
}
