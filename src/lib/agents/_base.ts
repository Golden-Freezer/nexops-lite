/**
 * AI 에이전트 공통 래퍼
 * 재시도 2회, 타임아웃 30s(SDK 레벨 요청 중단), 토큰 로깅
 */

import Anthropic from '@anthropic-ai/sdk'
import type { AgentConfig, AgentOutput, AgentError, RunContext } from './types'
import { agentLogger } from '@/lib/monitoring/logger'
import { checkMonthlyBudget, logUsage } from './budget'

// 모듈 스코프에서 즉시 생성하면 ANTHROPIC_API_KEY 미설정 환경에서 import만으로 throw한다(audit §4-6).
// lazy 초기화로 실제 호출 시점까지 생성을 미룬다.
let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) {
    // maxRetries:0 — 재시도는 callAgent의 루프가 전담(SDK 자체 재시도와 곱해지는 과금 증폭 방지, audit §4-3)
    client = new Anthropic({ maxRetries: 0 })
  }
  return client
}

// 모델별 토큰 비용 (USD per 1K tokens)
const COST_MAP = {
  'claude-sonnet-5': { input: 0.003, output: 0.015 },
  'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005 },
} as const

const MAX_RETRIES = 2
const TIMEOUT_MS = 30_000

export interface CallOptions {
  config: AgentConfig
  system: string
  messages: Anthropic.MessageParam[]
  /** 호출별 재시도/타임아웃 오버라이드 — 지연에 민감한 라우트(예: 코칭)가 함수 타임아웃 안에
   *  들어오도록 기본값(2회 재시도·30초)보다 짧게 줄일 때 사용 (audit §3-3) */
  maxRetries?: number
  timeoutMs?: number
  /** 사용량 로그의 호출 주체 표기 (예: 'naming/ocr') — 월 비용 감사에서 작업별 분해용 */
  agentName: string
  /** 업무 실행 원장·사용자·사업장·단계 귀속. runId는 Agent Run Ledger 배선 후 채운다. */
  runContext?: RunContext
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Anthropic.APIConnectionTimeoutError ||
    (error as { name?: string } | undefined)?.name === 'APIConnectionTimeoutError'
  )
}

/** 에이전트 API 호출 래퍼 */
export async function callAgent<T>(
  options: CallOptions,
  parser: (text: string) => T
): Promise<AgentOutput<T>> {
  const {
    config,
    system,
    messages,
    maxRetries = MAX_RETRIES,
    timeoutMs = TIMEOUT_MS,
    agentName,
    runContext,
  } = options
  const start = Date.now()
  let lastError: AgentError = { message: 'Unknown error', stage: 'api', attempts: 0 }

  // 월 예산 킬스위치 — 조회 실패 시 Haiku 계열만 허용하는 degraded 모드로 축소한다.
  const budget = await checkMonthlyBudget(agentName, config.model)
  if (!budget.allowed) {
    const degraded = budget.degraded === true
    const agentLimit = budget.limitReason === 'agent'
    const spentUsd = agentLimit
      ? (budget.agentSpentUsd ?? 0)
      : budget.spentUsd
    const budgetUsd = agentLimit
      ? (budget.agentBudgetUsd ?? budget.budgetUsd)
      : budget.budgetUsd
    agentLogger.warn(
      degraded
        ? '월 AI 예산 조회 실패 — degraded 모드에서 고비용 에이전트 호출 차단'
        : '월 AI 예산 소진 — 에이전트 호출 차단',
      {
      spentUsd,
      budgetUsd,
      agentName,
      limitReason: budget.limitReason,
      model: config.model,
      degradedReason: budget.degradedReason,
      },
    )
    return {
      success: false,
      error: {
        message: degraded
          ? `월 AI 예산 조회 실패로 degraded 모드가 적용되어 ${config.model} 호출이 차단됩니다. 저가 Haiku 계열만 허용됩니다.`
          : agentLimit
            ? `${agentName} 월 AI 예산($${budgetUsd}) 소진 — 당월 지출 $${spentUsd.toFixed(2)}. NEXOPS_AI_BUDGET_ASSISTANT_ROUTER_USD 상향 전까지 호출이 차단됩니다.`
            : `월 AI 예산($${budgetUsd}) 소진 — 당월 지출 $${spentUsd.toFixed(2)}. NEXOPS_AI_BUDGET_USD 상향 전까지 호출이 차단됩니다.`,
        stage: 'budget',
        attempts: 0,
      },
      usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
      duration: Date.now() - start,
    }
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attempts = attempt + 1
    try {
      // SDK 레벨 timeout — 로컬 Promise만 reject하던 기존 Promise.race와 달리 HTTP 요청 자체를 중단한다(audit §4-3).
      const response = await getClient().messages.create(
        {
          model: config.model,
          max_tokens: config.maxTokens,
          ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
          ...(config.disableThinking ? { thinking: { type: 'disabled' as const } } : {}),
          system,
          messages,
        },
        { timeout: timeoutMs }
      )

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')

      const costs = COST_MAP[config.model]
      const usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cost:
          (response.usage.input_tokens / 1000) * costs.input +
          (response.usage.output_tokens / 1000) * costs.output,
      }

      let parseResult: { ok: true; data: T } | { ok: false; message: string }
      try {
        parseResult = { ok: true, data: parser(text) }
      } catch (parseError) {
        parseResult = {
          ok: false,
          message: parseError instanceof Error ? parseError.message : String(parseError),
        }
      }

      // API 응답 직후 파싱 결과까지 확정해 기록한다. 파싱 실패 재시도도 과금된 별도 호출이다.
      const durationMs = Date.now() - start
      const usageLogged = await logUsage({
        agent: agentName,
        model: config.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: usage.cost,
        runContext,
        success: parseResult.ok,
        durationMs,
        attempts,
      })
      if (!usageLogged) {
        console.error('AI 사용량 기록 실패 — API 호출은 재시도하지 않습니다.', {
          agentName,
          model: config.model,
          attempts,
        })
      }

      if (!parseResult.ok) {
        const message = parseResult.message
        lastError = { message, stage: 'parse', attempts }
        agentLogger.warn(`Agent parse failed (attempt ${attempts})`, { error: message })
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
          continue
        }
        break
      }

      agentLogger.info('Agent call completed', {
        model: config.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cost: usage.cost,
        duration: durationMs,
      })

      return {
        success: true,
        data: parseResult.data,
        usage,
        duration: durationMs,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stage: AgentError['stage'] = isTimeoutError(error) ? 'timeout' : 'api'
      lastError = { message, stage, attempts }
      agentLogger.warn(`Agent attempt ${attempts} failed`, { error: message, stage })

      // 응답 사용량을 알 수 없는 API/타임아웃 실패도 호출 시도 원장에는 남긴다.
      const usageLogged = await logUsage({
        agent: agentName,
        model: config.model,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        runContext,
        success: false,
        durationMs: Date.now() - start,
        attempts,
      })
      if (!usageLogged) {
        console.error('AI 사용량 기록 실패 — API 호출은 재시도하지 않습니다.', {
          agentName,
          model: config.model,
          attempts,
        })
      }

      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
  }

  return {
    success: false,
    error: lastError,
    usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
    duration: Date.now() - start,
  }
}
