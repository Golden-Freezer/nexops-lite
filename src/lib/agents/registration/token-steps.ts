/**
 * 출력 상한 단계 호출 — 파싱 실패(대개 출력 상한 절단)를 같은 상한으로 되풀이하지 않는다.
 *
 * callAgent 기본 재시도는 같은 설정으로 3회까지 다시 부른다. 출력이 상한에서 잘린 응답은 세 번 모두 잘려
 * 비용만 세 배가 된다(2026-10-27 T5 실측: research 4000토큰 ×3, design-prompt 6000토큰 ×3 → 폴백).
 * 여기서는 파싱 실패 때 다음 단계 상한으로 한 번 올려 부른다. 마지막 단계가 아닐 때의 시간 초과도 승격으로 다룬다 —
 * 상한 가까이 쓰는 긴 응답은 잘리기 전에 시간 제한에 먼저 걸리기 때문이다(design-prompt 12000토큰 ≈ 90초 = timeoutMs).
 * 그 밖의 API·시간 초과 실패는 같은 상한으로 다시 부른다(callAgent 기본과 같은 2회). 예산 차단은 다시 부르지 않는다.
 *
 * 실행 시간: 상한을 올리면 출력이 길어질 수 있어 시간 제한도 같은 비율로 늘리고 25% 여유를 더한다. Vercel(run 라우트 maxDuration 120초)
 * 에서는 승격하지 않는다 — design 단계는 section-planning 약 28초 + design-prompt 약 69초(9,181토큰)로 이미 약 97초라
 * 승격 한 번이면 120초를 넘는다(2026-10-27 실측). 승격은 로컬 실행(하네스·실행기)에서만 한다.
 *
 * 비용: 실패·잘린 시도도 과금되고 ai_usage_log에 시도마다 남는다. 돌려주는 값의 spent에 모든 시도의 과금 합을 싣는다(R12d — usage는
 * 마지막 시도 그대로, 한 번에 끝나면 칸 없음). 부르는 쪽은 billedUsageOf로 잡 cost_usd에 더한다.
 * 시도마다 maxRetries 0으로 부르므로 ai_usage_log.attempts·error.attempts는 늘 1이다(시도 순서는 created_at으로 본다).
 */

import { callAgent, type CallOptions } from '../_base'
import { addAgentUsage, billedUsageOf, ZERO_USAGE } from '../billed-usage'
import { callLlm, type LlmRequest, type LlmRoute } from '../llm'
import type { AgentOutput, AgentUsage } from '../types'
import { isHostedPdpEnv } from '@/lib/registration/enrichment-switch'

const sameUsage = (a: AgentUsage, b: AgentUsage) => a.inputTokens === b.inputTokens && a.outputTokens === b.outputTokens && a.cost === b.cost

/** 단계 호출 결과 — 시간은 처음부터, spent는 모든 시도의 과금 합(마지막 시도 usage와 같으면 칸을 싣지 않는다) */
function settle<T>(result: AgentOutput<T>, billed: AgentUsage, start: number): AgentOutput<T> {
  const { spent: _attempt, ...rest } = result
  void _attempt
  const out = { ...rest, duration: Date.now() - start } as AgentOutput<T>
  return sameUsage(billed, result.usage) ? out : { ...out, spent: billed }
}

export const API_RETRIES = 2
/** 승격한 단계의 시간 제한 여유(상한 비율에 곱한다) */
export const ESCALATED_TIMEOUT_MARGIN = 1.25

export interface TokenStepsOptions {
  retryDelayMs?: number
  env?: Record<string, string | undefined>
}

/**
 * 단계 호출 본체 — 공급자와 무관하다. call(maxTokens, timeoutMs)은 그 상한·시간 제한으로 한 번(공급자 자체 재시도 없이) 부른다.
 */
async function callWithTokenSteps<T>(
  call: (maxTokens: number, timeoutMs: number | undefined) => Promise<AgentOutput<T>>,
  baseTimeoutMs: number | undefined,
  maxTokensSteps: readonly number[],
  { retryDelayMs = 1000, env = process.env }: TokenStepsOptions,
): Promise<AgentOutput<T>> {
  if (maxTokensSteps.length === 0) throw new Error('상한 단계 호출: 출력 상한 단계가 필요합니다')
  const steps = isHostedPdpEnv(env) ? maxTokensSteps.slice(0, 1) : maxTokensSteps
  const start = Date.now()
  let step = 0
  let apiFailures = 0
  let billed: AgentUsage = ZERO_USAGE
  for (;;) {
    const maxTokens = steps[step]
    const scale = (maxTokens / steps[0]) * (step > 0 ? ESCALATED_TIMEOUT_MARGIN : 1)
    const timeoutMs = baseTimeoutMs === undefined ? undefined : Math.round(baseTimeoutMs * scale)
    const result = await call(maxTokens, timeoutMs)
    billed = addAgentUsage(billed, billedUsageOf(result))
    if (result.success) return settle(result, billed, start)
    const { stage } = result.error
    if ((stage === 'parse' || stage === 'timeout') && step < steps.length - 1) {
      step++
      continue
    }
    if ((stage === 'api' || stage === 'timeout') && apiFailures < API_RETRIES) {
      apiFailures++
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * apiFailures))
      continue
    }
    return settle(result, billed, start)
  }
}

/** callAgent(Anthropic) 단계 호출 — 기존 호출부·시험용 */
export function callAgentWithTokenSteps<T>(
  options: Omit<CallOptions, 'maxRetries'>,
  parser: (text: string) => T,
  maxTokensSteps: readonly number[],
  stepOptions: TokenStepsOptions = {},
): Promise<AgentOutput<T>> {
  return callWithTokenSteps(
    (maxTokens, timeoutMs) =>
      callAgent<T>(
        { ...options, config: { ...options.config, maxTokens }, maxRetries: 0, ...(timeoutMs ? { timeoutMs } : {}) },
        parser,
      ),
    options.timeoutMs,
    maxTokensSteps,
    stepOptions,
  )
}

/** 모델 계층(callLlm) 단계 호출 — 라우트의 모델·공급자로 부른다(묶음 1). 공급자와 무관하게 같은 승격 규칙 */
export function callLlmWithTokenSteps<T>(
  route: LlmRoute,
  request: Omit<LlmRequest, 'maxRetries'>,
  parser: (text: string) => T,
  maxTokensSteps: readonly number[],
  stepOptions: TokenStepsOptions = {},
): Promise<AgentOutput<T>> {
  return callWithTokenSteps(
    (maxTokens, timeoutMs) =>
      callLlm<T>({ ...route, maxTokens }, { ...request, maxRetries: 0, ...(timeoutMs ? { timeoutMs } : {}) }, parser),
    request.timeoutMs,
    maxTokensSteps,
    stepOptions,
  )
}
