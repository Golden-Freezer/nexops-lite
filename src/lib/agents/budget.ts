/**
 * 월 AI 예산 킬스위치 — 비용 방어 3겹 (docs/plans/ai-staff/DESIGN.md §1).
 *
 * ai_usage_log(월 키 DB 집계)가 예산을 넘으면 callAgent가 호출 전에 차단한다.
 * 예산 확인 자체가 실패하면 degraded 모드로 전환해 Haiku 계열 저가 모델만 허용한다.
 * 기록 실패는 호출을 재시도하지 않도록 불리언으로 알리고 경고를 남긴다.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { agentLogger } from '@/lib/monitoring/logger'
import type { RunContext } from './types'

/** 기본 월 예산(USD) — 오너 결정 2026-07-15: $50, 부족 시 env로 상향 */
const DEFAULT_BUDGET_USD = 50
const DEFAULT_AGENT_BUDGETS_USD = {
  'assistant-router': 10,
} as const
const AGENT_BUDGET_ENV_NAMES: Record<
  keyof typeof DEFAULT_AGENT_BUDGETS_USD,
  string
> = {
  'assistant-router': 'NEXOPS_AI_BUDGET_ASSISTANT_ROUTER_USD',
}
const KST_OFFSET_MS = 9 * 3_600_000

export function monthlyBudgetUsd(): number {
  const raw = Number(process.env.NEXOPS_AI_BUDGET_USD)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BUDGET_USD
}

/** KST 기준 'YYYY-MM' — 월 예산 리셋 경계는 한국 시간 월초 */
export function currentMonthKey(now = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 7)
}

export function agentMonthlyBudgetUsd(agentName?: string): number | null {
  if (!agentName || !(agentName in DEFAULT_AGENT_BUDGETS_USD)) return null
  const name = agentName as keyof typeof DEFAULT_AGENT_BUDGETS_USD
  const raw = Number(process.env[AGENT_BUDGET_ENV_NAMES[name]])
  return Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_AGENT_BUDGETS_USD[name]
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

/** degraded 모드에서 허용할 저가 모델. 현재 AgentConfig의 Haiku 4.5 계열만 해당한다. */
export function isDegradedModelAllowed(model?: string): boolean {
  return Boolean(model?.startsWith('claude-haiku-4-5-'))
}

async function readMonthlySpend(
  db: ReturnType<typeof createAdminClient>,
  agentName?: string,
): Promise<number> {
  // 생성 DB 타입에 등록된 RPC로 월 사용량을 DB에서 직접 집계한다.
  // p_agent 미지정 시 인자를 생략하면 SQL DEFAULT NULL이 적용된다(전체 집계).
  const rpcArgs = {
    p_month_key: currentMonthKey(),
    ...(agentName !== undefined ? { p_agent: agentName } : {}),
  }
  const result = await db.rpc('ai_usage_month_total', rpcArgs)
  if (result.error) throw new Error(result.error.message)
  if (result.data == null || String(result.data).trim() === '') {
    throw new Error('월 AI 사용량 집계 결과가 올바른 숫자가 아닙니다.')
  }
  const sum = Number(result.data)
  if (!Number.isFinite(sum)) {
    throw new Error('월 AI 사용량 집계 결과가 올바른 숫자가 아닙니다.')
  }
  return sum
}

/** 당월 전체·agent 지출 합산 → 예산 판정. 조회 실패는 저가 모델만 허용하는 degraded 모드다. */
export async function checkMonthlyBudget(
  agentName?: string,
  model?: string,
): Promise<BudgetStatus> {
  const budgetUsd = monthlyBudgetUsd()
  const agentBudgetUsd = agentMonthlyBudgetUsd(agentName)
  try {
    const db = createAdminClient()
    const spentUsd = await readMonthlySpend(db)

    if (agentBudgetUsd == null || !agentName) {
      return {
        allowed: spentUsd < budgetUsd,
        spentUsd,
        budgetUsd,
        ...(spentUsd >= budgetUsd ? { limitReason: 'global' as const } : {}),
      }
    }

    const agentSpentUsd = await readMonthlySpend(db, agentName)
    const globalAllowed = spentUsd < budgetUsd
    const agentAllowed = agentSpentUsd < agentBudgetUsd

    return {
      allowed: globalAllowed && agentAllowed,
      spentUsd,
      budgetUsd,
      agentName,
      agentSpentUsd,
      agentBudgetUsd,
      ...(!globalAllowed
        ? { limitReason: 'global' as const }
        : !agentAllowed
          ? { limitReason: 'agent' as const }
          : {}),
    }
  } catch (e) {
    const degradedReason = e instanceof Error ? e.message : String(e)
    const allowed = isDegradedModelAllowed(model)
    console.warn('월 예산 확인 실패 — degraded 모드 적용', {
      error: degradedReason,
      agentName,
      model,
      allowed,
    })
    return {
      allowed,
      spentUsd: 0,
      budgetUsd,
      ...(agentName ? { agentName } : {}),
      ...(agentBudgetUsd == null ? {} : { agentSpentUsd: 0, agentBudgetUsd }),
      degraded: true,
      degradedReason,
    }
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

/** 호출 1건 기록 (append-only). 실패해도 throw하지 않고 false와 경고를 반환한다. */
export async function logUsage(entry: UsageEntry): Promise<boolean> {
  try {
    const db = createAdminClient()
    // 생성 DB Insert 타입으로 귀속·결과 컬럼을 함께 기록한다.
    const { error } = await db.from('ai_usage_log').insert({
      agent: entry.agent,
      model: entry.model,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      cost_usd: entry.costUsd,
      month_key: currentMonthKey(),
      run_id: entry.runContext?.runId ?? null,
      user_id: entry.runContext?.userId ?? null,
      business_id: entry.runContext?.businessId ?? null,
      stage: entry.runContext?.stage ?? null,
      success: entry.success,
      duration_ms: entry.durationMs,
      attempts: entry.attempts,
    })
    if (error) throw new Error(error.message)
    return true
  } catch (e) {
    agentLogger.warn('사용량 기록 실패 (호출 자체는 정상 처리됨)', {
      error: e instanceof Error ? e.message : String(e),
    })
    return false
  }
}
