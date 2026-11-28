/**
 * OpenAI 공급자 — 기존 callOpenAiChat(openai-chat.ts, Chat Completions 텍스트) 위에 둔다. 예산 확인·사용량 기록·재시도·단가는
 * callOpenAiChat 몫이다. 지금은 텍스트만 — 이미지 블록이 든 요청은 보내지 않고 실패로 돌려준다(registry vision false).
 * 라우트 effort는 설정했을 때만 reasoning_effort로 간다(pdp-model-refresh — 미설정이면 요청이 이전과 같다).
 */

import { callAgent } from '../../_base'
import type { AgentConfig, AgentOutput } from '../../types'
import type { LlmRequest, LlmRoute } from '../types'

export async function callOpenAi<T>(
  route: LlmRoute,
  request: LlmRequest,
  parser: (text: string) => T
): Promise<AgentOutput<T>> {
  return callAgent<T>(
    {
      config: {
        model: route.model,
        maxTokens: route.maxTokens,
        ...(route.temperature !== undefined ? { temperature: route.temperature } : {}),
        ...(route.effort ? { effort: route.effort } : {}),
      } as AgentConfig,
      system: request.system,
      messages: request.messages,
      agentName: request.agentName,
      ...(request.runContext ? { runContext: request.runContext } : {}),
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
      ...(request.maxRetries !== undefined ? { maxRetries: request.maxRetries } : {}),
      ...(request.deadlineAt !== undefined ? { deadlineAt: request.deadlineAt } : {}),
    },
    parser
  )
}
