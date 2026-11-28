/**
 * Anthropic 공급자 — 기존 callAgent(_base.ts)를 그대로 감싼다. 예산 확인·사용량 기록·재시도·단가·모델별 thinking 끄기 형식은
 * callAgent 몫이다(공용 지점 — 다른 업무 에이전트가 쓴다. 설정하지 않은 필드는 요청에 싣지 않는다). 라우트를 AgentConfig로 옮길 뿐이다.
 */

import { callAgent } from '../../_base'
import type { AgentConfig, AgentOutput } from '../../types'
import { lookupLlmModel } from '../registry'
import type { LlmRequest, LlmRoute } from '../types'

/**
 * callAgent가 받는 Claude 모델 — AgentConfig 모델 유니언·_base.ts COST_MAP과 같은 목록(satisfies가 유니언을, 시험이
 * 레지스트리 anthropic 모델과 같은지를 확인한다). 여기 없는 모델을 callAgent로 보내면 응답을 받은 뒤 단가를 못 찾아
 * 유료 호출만 하고 실패하므로, 부르기 전에 막는다.
 */
export const ANTHROPIC_AGENT_MODELS = [
  'claude-sonnet-5',
  'claude-sonnet-5-5',
  'claude-haiku-4-5-20251001',
  'claude-haiku-5-5',
  'claude-opus-5-5',
] as const satisfies readonly AgentConfig['model'][]

/** _base.ts TIMEOUT_MS와 같은 값 — 시간 제한 배율의 기준(요청에 timeoutMs가 없을 때) */
const CALL_AGENT_DEFAULT_TIMEOUT_MS = 30_000

function isAgentModel(model: string): model is AgentConfig['model'] {
  return (ANTHROPIC_AGENT_MODELS as readonly string[]).includes(model)
}

export async function callAnthropic<T>(
  route: LlmRoute,
  request: LlmRequest,
  parser: (text: string) => T
): Promise<AgentOutput<T>> {
  if (!isAgentModel(route.model)) {
    return {
      success: false,
      error: {
        message: `callAgent가 받지 않는 Claude 모델 — ${route.model}(_base.ts COST_MAP)`,
        stage: 'api',
        attempts: 0,
      },
      usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
      duration: 0,
    }
  }
  const allowsTemperature = lookupLlmModel(route.model)?.temperature === true
  const config: AgentConfig = {
    model: route.model,
    maxTokens: route.maxTokens,
    ...(allowsTemperature && route.temperature !== undefined ? { temperature: route.temperature } : {}),
    ...(route.disableThinking ? { disableThinking: true } : {}),
    ...(route.effort ? { effort: route.effort } : {}),
  }
  // 갈래(M) 시간 제한 배율 — 없으면 요청 값 그대로(callAgent 기본값을 쓰는 요청은 timeoutMs를 보내지 않는다).
  // run 예산에서 계산한 제한(timeoutFixed — 이미지 단계 게이트·장식)은 곱하지 않는다: 곱하면 run이 잡 진행 잠금 기한을 넘는다(검수 지적)
  const timeoutMs =
    route.timeoutScale && !request.timeoutFixed
      ? Math.round((request.timeoutMs ?? CALL_AGENT_DEFAULT_TIMEOUT_MS) * route.timeoutScale)
      : request.timeoutMs
  return callAgent<T>(
    {
      config,
      system: request.system,
      messages: request.messages,
      agentName: request.agentName,
      ...(request.runContext ? { runContext: request.runContext } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(request.maxRetries !== undefined ? { maxRetries: request.maxRetries } : {}),
      ...(request.deadlineAt !== undefined ? { deadlineAt: request.deadlineAt } : {}),
      ...(route.failOnTruncation ? { failOnTruncation: true } : {}),
      ...(request.retryTruncated === false ? { retryTruncated: false } : {}),
    },
    parser
  )
}
