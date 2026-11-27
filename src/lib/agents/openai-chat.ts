/** 기존 OpenAI Chat 계약을 유지하면서 실제 호출은 로컬 Codex CLI로 실행한다. */

import type { AgentOutput, AgentError, RunContext } from './types'
import { agentLogger } from '@/lib/monitoring/logger'
import { logUsage } from './budget'
import { codexText, DEFAULT_CODEX_TIMEOUT_MS } from '@/lib/local-codex/llm'

const DEFAULT_MODEL = 'gpt-5.6-luna'
const MAX_RETRIES = 1

export interface OpenAiChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface CallOptions {
  system: string
  messages: OpenAiChatMessage[]
  model?: string
  maxTokens?: number
  temperature?: number
  maxRetries?: number
  timeoutMs?: number
  agentName: string
  runContext?: RunContext
}

function formatMessages(messages: OpenAiChatMessage[]): string {
  return messages
    .map((message) => `[${message.role === 'assistant' ? '이전 응답' : '사용자'}]\n${message.content}`)
    .join('\n\n')
}

export async function callOpenAiChat<T>(
  options: CallOptions,
  parser: (text: string) => T,
): Promise<AgentOutput<T>> {
  const {
    system,
    messages,
    model = DEFAULT_MODEL,
    maxRetries = MAX_RETRIES,
    timeoutMs: requestedTimeoutMs = DEFAULT_CODEX_TIMEOUT_MS,
    agentName,
    runContext,
  } = options
  const timeoutMs = Math.max(requestedTimeoutMs, DEFAULT_CODEX_TIMEOUT_MS)
  const start = Date.now()
  const zeroUsage = { inputTokens: 0, outputTokens: 0, cost: 0 }
  let lastError: AgentError = { message: 'Unknown error', stage: 'api', attempts: 0 }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attempts = attempt + 1
    try {
      const text = await codexText({ system, user: formatMessages(messages), timeoutMs })
      let data: T
      try {
        data = parser(text)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        lastError = { message, stage: 'parse', attempts }
        await logUsage({ agent: agentName, model, inputTokens: 0, outputTokens: 0, costUsd: 0, runContext, success: false, durationMs: Date.now() - start, attempts })
        agentLogger.warn(`Local Codex chat parse failed (attempt ${attempts})`, { error: message, agentName })
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempts))
          continue
        }
        break
      }

      const duration = Date.now() - start
      await logUsage({ agent: agentName, model, inputTokens: 0, outputTokens: 0, costUsd: 0, runContext, success: true, durationMs: duration, attempts })
      return { success: true, data, usage: zeroUsage, duration }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stage: AgentError['stage'] = /timeout|시간 안에 끝나지/i.test(message) ? 'timeout' : 'api'
      lastError = { message, stage, attempts }
      await logUsage({ agent: agentName, model, inputTokens: 0, outputTokens: 0, costUsd: 0, runContext, success: false, durationMs: Date.now() - start, attempts })
      agentLogger.warn(`Local Codex chat attempt ${attempts} failed`, { error: message, stage, agentName })
      if (attempt < maxRetries) await new Promise((resolve) => setTimeout(resolve, 1000 * attempts))
    }
  }

  return { success: false, error: lastError, usage: zeroUsage, duration: Date.now() - start }
}
