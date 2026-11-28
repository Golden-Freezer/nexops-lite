/**
 * 후기 속 실제 질문 찾기(reviewfaq) — 설계 단계의 별도 1콜. 카피·설계 프롬프트를 건드리지 않게 나눴다.
 * 산출 검사는 review-faq.ts(순수)가 한다. 실패해도 잡은 계속되고 표는 고정 질문으로 짓는다 — 파이프라인이 경고를 남긴다.
 */

import { billedUsageOf } from '../billed-usage'
import type { AgentOutput, RunContext } from '../types'
import { callLlm } from '../llm'
import { parseLlmJson } from '../json-parser'
import { pdpRoute } from '@/lib/registration/pdp-model-routes'
import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import { validateReviewFaq, type ReviewFaqResult } from '@/lib/registration/reviews/review-faq'
import { buildReviewFaqPrompt, REVIEW_FAQ_SYSTEM } from './prompts/pdp-review-faq-prompts'

function parseItems(raw: string): unknown[] {
  const parsed = parseLlmJson(raw)
  if (!parsed || !Array.isArray(parsed.items)) throw new Error('items 배열이 없습니다')
  return parsed.items
}

export async function runReviewFaqAnalysis(input: {
  reviewsText: string
  spec: PdpSpecSheet
  runContext?: RunContext
}): Promise<AgentOutput<ReviewFaqResult>> {
  const start = Date.now()
  const result = await callLlm<unknown[]>(
    pdpRoute('design/review-faq'),
    {
      system: REVIEW_FAQ_SYSTEM,
      messages: [{ role: 'user', content: buildReviewFaqPrompt(input.reviewsText) }],
      timeoutMs: 60_000,
      agentName: 'registration/pdp-review-faq',
      runContext: input.runContext,
    },
    parseItems
  )
  if (!result.success) return result
  return {
    success: true,
    data: validateReviewFaq(result.data, input.reviewsText, input.spec),
    usage: billedUsageOf(result),
    duration: Date.now() - start,
  }
}
