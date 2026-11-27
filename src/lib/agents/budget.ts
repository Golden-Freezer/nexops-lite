/** ChatGPT 구독 기반 로컬 Codex 호출은 API 종량 비용이 없으므로 예산 게이트를 열어 둔다. */

import { createAdminClient } from '@/lib/supabase/admin'
import { agentLogger } from '@/lib/monitoring/logger'
import type { RunContext } from './types'

const KST_OFFSET_MS = 9 * 3_600_000

export function monthlyBudgetUsd(): number {
  return 0
}

export function currentMonthKey(now = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 7)
}

export function agentMonthlyBudgetUsd(agentName?: string): number | null {
  return agentName ? 0 : null
}

export interface BudgetStatus {
  allowed: boolean
  spentUsd: number
  budgetUsd: number
  agentName?: string
  agentSpentUsd?: number
  agentBudgetUsd?: number
  limitReason?: 'global' | 'agent'
  degraded?: boolean
  degradedReason?: string
}

export function isDegradedModelAllowed(): boolean {
  return true
}

export async function checkMonthlyBudget(agentName?: string, _model?: string): Promise<BudgetStatus> {
  return {
    allowed: true,
    spentUsd: 0,
    budgetUsd: 0,
    ...(agentName ? { agentName, agentSpentUsd: 0, agentBudgetUsd: 0 } : {}),
  }
}

export interface UsageEntry {
  agent: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  runContext?: RunContext
  success: boolean
  durationMs: number
  attempts: number
}

/** ai_usage_log가 없거나 연결되지 않아도 호출 결과에는 영향을 주지 않는다. */
export async function logUsage(entry: UsageEntry): Promise<boolean> {
  try {
    const db = createAdminClient()
    const { error } = await db.from('ai_usage_log').insert({
      agent: entry.agent,
      model: entry.model,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      cost_usd: 0,
      month_key: currentMonthKey(),
      run_id: entry.runContext?.runId ?? null,
      user_id: entry.runContext?.userId ?? null,
      business_id: entry.runContext?.businessId ?? null,
      stage: entry.runContext?.stage ?? null,
      success: entry.success,
      duration_ms: entry.durationMs,
      attempts: entry.attempts,
    })
    return !error
  } catch (error) {
    agentLogger.warn('AI 사용 기록을 남기지 못했지만 로컬 Codex 결과는 유지합니다.', {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
