/**
 * OpenAI Chat Completions 소형 래퍼 — Pro Stage 2(카피라이팅 스토리텔링) 전용 (설계문서 §6.1 결정 C).
 *
 * callAgent(_base.ts)와 동일 계약을 따른다: AgentOutput 판별 유니언, 재시도 기본 2회(파서 실패 포함),
 * 호출 전 월 예산 게이트(checkMonthlyBudget)·성공 시 ai_usage_log 기록(logUsage)을 그대로 재사용한다.
 * package.json에 openai SDK가 없어 image/generate.ts와 동일하게 fetch 직접 호출로 신규 의존성을 피한다.
 *
 * _base.ts와의 차이:
 * - 프로바이더가 Anthropic이 아닌 OpenAI Chat Completions REST(`/v1/chat/completions`)이므로
 *   SDK 레벨 timeout이 없다 — AbortController로 직접 구현한다.
 * - 타임아웃 기본값 60s(_base.ts는 30s) — 스토리텔링 장문 산출이 더 오래 걸린다.
 * - agentName이 옵션이 아닌 필수 파라미터다(Phase 1 함정 기록: 이미지 호출 경로 agentName 누락 사고 재발 방지).
 */

import type { AgentOutput, AgentError, RunContext } from './types'
import { agentLogger } from '@/lib/monitoring/logger'
import { checkMonthlyBudget, logUsage } from './budget'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'

/** gpt-5.x 계열은 추론형 — 비기본 temperature 전달 시 400 (NEXFIT copywriting_agent.py:_get_gpt41_llm 가드 이식) */
function isReasoningModel(model: string): boolean {
  return model.startsWith('gpt-5')
}

/** USD / 1K 토큰 — NEXFIT agents/cost_tracking.py PRICING_USD_PER_1M 실측 단가를 1K 단위로 환산. */
const COST_MAP: Record<string, { input: number; output: number }> = {
  'gpt-5.6-luna': { input: 0.001, output: 0.006 }, // D3 — Copy Stage2 ($1.00/$6.00 per 1M, 2026-08-10 실측)
}
// 미등록 모델 폴백 단가 — TODO 단가 실측 확인 전 보수적 추정(gpt-4.1 공식가 상회분 반영)
const FALLBACK_COST = { input: 0.002, output: 0.008 }

/** NEXFIT config.py pro_gpt41_model 실측값(2026-08-10) — 심볼명은 하위호환 위해 유지됐지만 실제 모델은 gpt-5.6-luna */
const DEFAULT_MODEL = 'gpt-5.6-luna'
const MAX_RETRIES = 2
const TIMEOUT_MS = 60_000

export interface OpenAiChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface CallOptions {
  system: string
  messages: OpenAiChatMessage[]
  model?: string
  maxTokens?: number
  /** gpt-5.x(추론형)에는 전송하지 않는다 — isReasoningModel 가드 */
  temperature?: number
  maxRetries?: number
  timeoutMs?: number
  /** 사용량 로그의 호출 주체 표기 — 월 비용 감사·예산 게이트 분해의 키이므로 필수 */
  agentName: string
  /** 업무 실행 원장·사용자·사업장·단계 귀속 */
  runContext?: RunContext
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

/** Pro Stage 2 전용 OpenAI chat 호출 래퍼 */
export async function callOpenAiChat<T>(
  options: CallOptions,
  parser: (text: string) => T
): Promise<AgentOutput<T>> {
  const {
    system,
    messages,
    model = DEFAULT_MODEL,
    maxTokens = 8192,
    temperature,
    maxRetries = MAX_RETRIES,
    timeoutMs = TIMEOUT_MS,
    agentName,
    runContext,
  } = options
  const start = Date.now()
  const zeroUsage = { inputTokens: 0, outputTokens: 0, cost: 0 }
  let lastError: AgentError = { message: 'Unknown error', stage: 'api', attempts: 0 }

  const budget = await checkMonthlyBudget(agentName, model)
  if (!budget.allowed) {
    const degraded = budget.degraded === true
    const agentLimit = budget.limitReason === 'agent'
    const spentUsd = agentLimit ? (budget.agentSpentUsd ?? 0) : budget.spentUsd
    const budgetUsd = agentLimit ? (budget.agentBudgetUsd ?? budget.budgetUsd) : budget.budgetUsd
    agentLogger.warn(
      degraded
        ? '월 AI 예산 조회 실패 — degraded 모드에서 OpenAI chat 호출 차단'
        : '월 AI 예산 소진 — OpenAI chat 호출 차단',
      { spentUsd, budgetUsd, agentName, model, degradedReason: budget.degradedReason },
    )
    return {
      success: false,
      error: {
        message: degraded
          ? `월 AI 예산 조회 실패로 degraded 모드가 적용되어 OpenAI 모델 ${model} 호출이 차단됩니다.`
          : `월 AI 예산($${budgetUsd}) 소진 — 당월 지출 $${spentUsd.toFixed(2)}. ${agentName} 호출이 차단됩니다.`,
        stage: 'budget',
        attempts: 0,
      },
      usage: zeroUsage,
      duration: Date.now() - start,
    }
  }

  const key = process.env.OPENAI_API_KEY
  if (!key) {
    return {
      success: false,
      error: { message: 'OPENAI_API_KEY가 설정돼 있지 않습니다.', stage: 'api', attempts: 0 },
      usage: zeroUsage,
      duration: Date.now() - start,
    }
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attempts = attempt + 1
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(OPENAI_CHAT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          max_completion_tokens: maxTokens,
          ...(temperature !== undefined && !isReasoningModel(model) ? { temperature } : {}),
          messages: [{ role: 'system', content: system }, ...messages],
        }),
        signal: controller.signal,
      })
      const json = (await res.json()) as OpenAiChatResponse
      if (!res.ok) {
        throw new Error(`OpenAI 호출 실패(${res.status}): ${json.error?.message ?? 'unknown'}`)
      }

      const text = json.choices?.[0]?.message?.content ?? ''
      const costs = COST_MAP[model] ?? FALLBACK_COST
      const usage = {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        cost:
          ((json.usage?.prompt_tokens ?? 0) / 1000) * costs.input +
          ((json.usage?.completion_tokens ?? 0) / 1000) * costs.output,
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

      const durationMs = Date.now() - start
      const usageLogged = await logUsage({
        agent: agentName,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: usage.cost,
        runContext,
        success: parseResult.ok,
        durationMs,
        attempts,
      })
      if (!usageLogged) {
        console.error('OpenAI 사용량 기록 실패 — API 호출은 재시도하지 않습니다.', {
          agentName,
          model,
          attempts,
        })
      }

      if (!parseResult.ok) {
        const message = parseResult.message
        lastError = { message, stage: 'parse', attempts }
        agentLogger.warn(`OpenAI chat parse failed (attempt ${attempts})`, { error: message, agentName })
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
          continue
        }
        break
      }

      agentLogger.info('OpenAI chat call completed', {
        model,
        agentName,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cost: usage.cost,
        duration: durationMs,
      })

      return { success: true, data: parseResult.data, usage, duration: durationMs }
    } catch (error) {
      const isAbort = (error as { name?: string } | undefined)?.name === 'AbortError'
      const message = isAbort ? `타임아웃(${timeoutMs}ms)` : error instanceof Error ? error.message : String(error)
      const stage: AgentError['stage'] = isAbort ? 'timeout' : 'api'
      lastError = { message, stage, attempts }
      agentLogger.warn(`OpenAI chat attempt ${attempts} failed`, { error: message, stage, agentName })

      const usageLogged = await logUsage({
        agent: agentName,
        model,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        runContext,
        success: false,
        durationMs: Date.now() - start,
        attempts,
      })
      if (!usageLogged) {
        console.error('OpenAI 사용량 기록 실패 — API 호출은 재시도하지 않습니다.', {
          agentName,
          model,
          attempts,
        })
      }

      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      }
    } finally {
      clearTimeout(timer)
    }
  }

  return { success: false, error: lastError, usage: zeroUsage, duration: Date.now() - start }
}
