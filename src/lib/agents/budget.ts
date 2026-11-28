/** ChatGPT 구독 기반 로컬 Codex 호출은 API 종량 비용이 없으므로 예산 게이트를 열어 둔다. */

import { createAdminClient } from '@/lib/supabase/admin'
import { agentLogger } from '@/lib/monitoring/logger'
import type { CostPool, RunContext } from './types'

const KST_OFFSET_MS = 9 * 3_600_000
const UNLIMITED_BUDGET_USD = Number.MAX_SAFE_INTEGER
export const PDP_TEST_POOL: CostPool = 'pdp-test'

export function monthlyBudgetUsd(): number {
  return UNLIMITED_BUDGET_USD
}

export function pdpTestBudgetUsd(): number {
  return UNLIMITED_BUDGET_USD
}

export function currentMonthKey(now = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 7)
}

export function agentMonthlyBudgetUsd(agentName?: string): number | null {
  return agentName ? UNLIMITED_BUDGET_USD : null
}

export interface BudgetStatus {
  allowed: boolean
  spentUsd: number
  budgetUsd: number
  agentName?: string
  agentSpentUsd?: number
  agentBudgetUsd?: number
  limitReason?: 'global' | 'agent' | 'pool' | 'variable_cap' | 'variable_unreadable'
  costPool?: CostPool
  degraded?: boolean
  degradedReason?: string
}

export function isDegradedModelAllowed(_model?: string): boolean {
  return true
}

export interface MonthlyBudgetOptions {
  variableGuard?: boolean
}

export async function checkMonthlyBudget(
  agentName?: string,
  _model?: string,
  costPool?: CostPool,
  _options: MonthlyBudgetOptions = {},
): Promise<BudgetStatus> {
  return {
    allowed: true,
    spentUsd: 0,
    budgetUsd: UNLIMITED_BUDGET_USD,
    ...(agentName
      ? { agentName, agentSpentUsd: 0, agentBudgetUsd: UNLIMITED_BUDGET_USD }
      : {}),
    ...(costPool ? { costPool } : {}),
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
