/**
 * OpenAI 공급자 — 기존 callOpenAiChat(openai-chat.ts, Chat Completions 텍스트) 위에 둔다. 예산 확인·사용량 기록·재시도·단가는
 * callOpenAiChat 몫이다. 지금은 텍스트만 — 이미지 블록이 든 요청은 보내지 않고 실패로 돌려준다(registry vision false).
 * 라우트 effort는 설정했을 때만 reasoning_effort로 간다(pdp-model-refresh — 미설정이면 요청이 이전과 같다).
 */

import type Anthropic from '@anthropic-ai/sdk'
import { callOpenAiChat, type OpenAiChatMessage } from '../../openai-chat'
import type { AgentOutput } from '../../types'
import { lookupLlmModel } from '../registry'
import type { LlmRequest, LlmRoute } from '../types'

/** Anthropic 메시지 → OpenAI 텍스트 메시지. 텍스트가 아닌 블록이 있으면 null */
function toOpenAiMessages(messages: Anthropic.MessageParam[]): OpenAiChatMessage[] | null {
  const out: OpenAiChatMessage[] = []
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content })
      continue
    }
    if (!m.content.every((b) => b.type === 'text')) return null
    out.push({ role: m.role, content: m.content.map((b) => (b as Anthropic.TextBlockParam).text).join('') })
  }
  return out
}

export async function callOpenAi<T>(
  route: LlmRoute,
  request: LlmRequest,
  parser: (text: string) => T
): Promise<AgentOutput<T>> {
  const messages = toOpenAiMessages(request.messages)
  if (!messages) {
    return {
      success: false,
      error: {
        message: `OpenAI 공급자는 아직 텍스트만 보낸다 — ${route.model}에 이미지 입력 불가`,
        stage: 'api',
        attempts: 0,
      },
      usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
      duration: 0,
    }
  }
  const allowsTemperature = lookupLlmModel(route.model)?.temperature === true
  return callOpenAiChat<T>(
    {
      system: request.system,
      messages,
      model: route.model,
      maxTokens: route.maxTokens,
      ...(allowsTemperature && route.temperature !== undefined ? { temperature: route.temperature } : {}),
      ...(route.effort ? { reasoningEffort: route.effort } : {}),
      agentName: request.agentName,
      ...(request.runContext ? { runContext: request.runContext } : {}),
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
      ...(request.maxRetries !== undefined ? { maxRetries: request.maxRetries } : {}),
      ...(request.deadlineAt !== undefined ? { deadlineAt: request.deadlineAt } : {}),
    },
    parser
  )
}
