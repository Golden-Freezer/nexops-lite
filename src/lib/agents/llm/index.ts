/**
 * 텍스트·비전 LLM 단일 진입점. 라우트의 공급자·backend·effort 값은 기존 단계 기록과
 * 호환을 위해 받지만, 라이트에서는 모든 요청을 이 PC의 Codex CLI로만 실행한다.
 */

import { callAgent } from '../_base'
import type { AgentConfig, AgentOutput } from '../types'
import type { MessageParam, TextBlockParam } from './message-types'
import type { LlmRequest, LlmRoute } from './types'

export type { LlmBackend, LlmEffort, LlmRequest, LlmRoute } from './types'
export { LLM_MODELS, llmCostPer1k, lookupLlmModel, type LlmModelInfo, type LlmProvider } from './registry'

const JSON_ONLY = '설명이나 코드 울타리를 붙이지 말고, 요청한 JSON만 출력하세요.'

/** 원본 메시지는 바꾸지 않고 마지막 사용자 요청 끝에 JSON 전용 지시를 붙인다. */
function withJsonOnly(messages: MessageParam[]): MessageParam[] {
  const next = messages.map((message) => ({
    ...message,
    content: Array.isArray(message.content) ? [...message.content] : message.content,
  }))
  for (let index = next.length - 1; index >= 0; index--) {
    const message = next[index]
    if (message.role !== 'user') continue
    if (typeof message.content === 'string') {
      message.content = `${message.content}\n\n${JSON_ONLY}`
    } else {
      message.content.push({ type: 'text', text: JSON_ONLY } satisfies TextBlockParam)
    }
    return next
  }
  return [...next, { role: 'user', content: JSON_ONLY }]
}

export function callLlm<T>(
  route: LlmRoute,
  request: LlmRequest,
  parser: (text: string) => T,
): Promise<AgentOutput<T>> {
  const config = {
    model: route.model,
    maxTokens: route.maxTokens,
    ...(route.temperature !== undefined ? { temperature: route.temperature } : {}),
    ...(route.disableThinking ? { disableThinking: true } : {}),
    ...(route.effort ? { effort: route.effort } : {}),
  } as AgentConfig

  return callAgent(
    {
      config,
      system: request.system,
      messages: route.json ? withJsonOnly(request.messages) : request.messages,
      agentName: request.agentName,
      ...(request.runContext ? { runContext: request.runContext } : {}),
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
      ...(request.maxRetries !== undefined ? { maxRetries: request.maxRetries } : {}),
      ...(request.deadlineAt !== undefined ? { deadlineAt: request.deadlineAt } : {}),
      ...(route.failOnTruncation ? { failOnTruncation: true } : {}),
      ...(request.retryTruncated === false ? { retryTruncated: false } : {}),
    },
    parser,
  )
}
