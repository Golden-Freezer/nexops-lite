/** Gemini 호환 공급자. 라이트에서는 API 키나 HTTP 호출 없이 공통 Codex CLI 경로를 쓴다. */

import { callAgent } from '../../_base'
import type { AgentConfig, AgentOutput } from '../../types'
import type { MessageParam } from '../message-types'
import type { LlmRequest, LlmRoute } from '../types'

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }

/** 기존 변환기 공개 계약은 시험·도구 호환용으로 유지한다. */
export function toGeminiContents(
  messages: MessageParam[],
): Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> | null {
  const contents: Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> = []
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'model' : 'user'
    if (typeof message.content === 'string') {
      contents.push({ role, parts: [{ text: message.content }] })
      continue
    }
    const parts: GeminiPart[] = []
    for (const block of message.content) {
      if (block.type === 'text') parts.push({ text: block.text })
      else if (block.type === 'image') {
        parts.push({ inlineData: { mimeType: block.source.media_type, data: block.source.data } })
      } else return null
    }
    contents.push({ role, parts })
  }
  return contents
}

function jsonMessages(request: LlmRequest): MessageParam[] {
  return [
    ...request.messages,
    { role: 'user', content: '설명이나 코드 울타리 없이 JSON만 출력하세요.' },
  ]
}

export function callGemini<T>(
  route: LlmRoute,
  request: LlmRequest,
  parser: (text: string) => T,
): Promise<AgentOutput<T>> {
  const config = {
    model: route.model,
    maxTokens: route.maxTokens,
    ...(route.temperature !== undefined ? { temperature: route.temperature } : {}),
    ...(route.effort ? { effort: route.effort } : {}),
  } as AgentConfig
  return callAgent(
    {
      config,
      system: request.system,
      messages: route.json ? jsonMessages(request) : request.messages,
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
