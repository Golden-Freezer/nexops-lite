/**
 * 레퍼런스 분석 콜(라우트 analysis/reference) — 긴 캡처 띠는 8장씩 묶어 차례로 보내고 앞 묶음의 마지막 역할을 다음 묶음에 넘긴다.
 * PDF는 문서 입력(글 + 쪽 이미지)으로 한 번에 보낸다. 레퍼런스 원본은 이 콜에만 들어간다(카피·이미지 단계에는 없다).
 * 한 묶음이라도 실패하면 전체를 실패로 돌린다(앞 묶음 비용은 usage에 합친다 — 시도별 비용은 ai_usage_log).
 */

import { billedUsageOf } from '../billed-usage'
import type Anthropic from '@anthropic-ai/sdk'
import type { AgentOutput, AgentUsage, RunContext } from '../types'
import { callLlm } from '../llm'
import { parseLlmJson } from '../json-parser'
import { pdpRoute } from '@/lib/registration/pdp-model-routes'
import { readReferenceBatch, type ReferenceBatch } from '@/lib/registration/references/reference-insights'
import type { ReferenceStrip } from '@/lib/registration/references/reference-strips'
import { REFERENCE_LIMITS } from '@/lib/registration/references/reference-types'
import { buildReferencePdfPrompt, buildReferenceStripsPrompt, REFERENCE_SYSTEM } from './prompts/pdp-reference-prompts'

export const REFERENCE_AGENT = 'registration/pdp-reference-analysis'
/** 한 묶음 시간 제한 — 띠 8장·받아쓰기 출력 */
const CALL_TIMEOUT_MS = 90_000

const addUsage = (a: AgentUsage, b: AgentUsage): AgentUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cost: a.cost + b.cost,
})
const ZERO: AgentUsage = { inputTokens: 0, outputTokens: 0, cost: 0 }

function callOnce(content: Anthropic.ContentBlockParam[], runContext?: RunContext) {
  return callLlm<ReferenceBatch>(
    pdpRoute('analysis/reference'),
    {
      system: REFERENCE_SYSTEM,
      messages: [{ role: 'user', content }],
      agentName: REFERENCE_AGENT,
      runContext,
      timeoutMs: CALL_TIMEOUT_MS,
      maxRetries: 1,
    },
    (text) => readReferenceBatch(parseLlmJson(text))
  )
}

/** 긴 캡처 띠 → 묶음별 분석 */
export async function analyzeReferenceStrips(
  strips: readonly ReferenceStrip[],
  runContext?: RunContext
): Promise<AgentOutput<ReferenceBatch[]>> {
  const start = Date.now()
  const size = REFERENCE_LIMITS.stripsPerCall
  const groups = Array.from({ length: Math.ceil(strips.length / size) }, (_, i) => strips.slice(i * size, (i + 1) * size))
  const batches: ReferenceBatch[] = []
  let usage = ZERO
  for (const [index, group] of groups.entries()) {
    const content: Anthropic.ContentBlockParam[] = [
      ...group.map((s) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: s.mediaType, data: s.data } })),
      {
        type: 'text',
        text: buildReferenceStripsPrompt(group, {
          index,
          count: groups.length,
          previousRole: batches.at(-1)?.lastRole ?? null,
        }),
      },
    ]
    const result = await callOnce(content, runContext)
    usage = addUsage(usage, billedUsageOf(result))
    if (!result.success) return { success: false, error: result.error, usage, duration: Date.now() - start }
    batches.push(result.data)
  }
  return { success: true, data: batches, usage, duration: Date.now() - start }
}

/** PDF → 한 번에 분석(쪽 수 상한은 받는 쪽이 먼저 건다) */
export async function analyzeReferencePdf(
  pdfBase64: string,
  pages: number | null,
  runContext?: RunContext
): Promise<AgentOutput<ReferenceBatch[]>> {
  const result = await callOnce(
    [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
      { type: 'text', text: buildReferencePdfPrompt(pages) },
    ],
    runContext
  )
  return result.success ? { ...result, data: [result.data] } : result
}
