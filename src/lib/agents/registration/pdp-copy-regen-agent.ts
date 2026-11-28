/**
 * 편집기 카피 재생성 1콜(pdp-copy-regen-api) — 라우트 'copy/editor-regen'(카피 단계와 같은 Sonnet 5.5, 폴백 없음, temperature 없음).
 * 응답 JSON {text, alt1, alt2}에서 문자열 후보만 꺼낸다. NEXFIT은 빠진 키를 현재 카피로 채웠지만 여기서는 후보에서 뺀다 —
 * 가드(pdp-copy-regen guardCopyCandidates)가 현재 카피와 같은 후보를 어차피 걸러 낸다.
 * costUsd는 공용 callAgent가 돌려준 값이다 — 모든 시도가 실패하면 0, 성공하면 마지막 시도 비용만(시도별 비용은 ai_usage_log).
 */

import { billedCostOf } from '../billed-usage'
import { callLlm } from '../llm'
import type { AgentError, RunContext } from '@/lib/agents/types'
import { parseRegistrationJson } from './llm-json'
import { pdpRoute } from '@/lib/registration/pdp-model-routes'

export const COPY_REGEN_AGENT = 'registration/pdp-copy-regen'
const CANDIDATE_KEYS = ['text', 'alt1', 'alt2'] as const

export type CopyRegenModelResult =
  | { ok: true; candidates: string[]; costUsd: number }
  | { ok: false; error: string; stage: AgentError['stage']; costUsd: number }

/** 모델 응답 → 후보 문자열(순서 text·alt1·alt2). 객체가 아니거나 문자열 후보가 하나도 없으면 null(파싱 실패) */
export function parseCopyRegenResponse(text: string): string[] | null {
  const parsed = parseRegistrationJson(text)
  const raw = Array.isArray(parsed) ? parsed[0] : parsed
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const candidates = CANDIDATE_KEYS.map((k) => r[k]).filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0
  )
  return candidates.length > 0 ? candidates : null
}

export async function callCopyRegenModel(
  prompts: { system: string; user: string },
  runContext?: RunContext
): Promise<CopyRegenModelResult> {
  const result = await callLlm(
    pdpRoute('copy/editor-regen'),
    {
      system: prompts.system,
      messages: [{ role: 'user', content: prompts.user }],
      agentName: COPY_REGEN_AGENT,
      runContext,
      timeoutMs: 30_000,
      maxRetries: 1,
    },
    (text) => {
      const candidates = parseCopyRegenResponse(text)
      if (!candidates) throw new Error('카피 재생성 응답을 JSON으로 읽지 못했습니다')
      return candidates
    }
  )
  if (!result.success) {
    return { ok: false, error: result.error.message, stage: result.error.stage, costUsd: billedCostOf(result) }
  }
  return { ok: true, candidates: result.data, costUsd: billedCostOf(result) }
}
