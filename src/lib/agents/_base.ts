/** AI 에이전트 공통 계약을 Codex CLI(ChatGPT 구독 로그인)로 실행한다. */

import type { AgentConfig, AgentOutput, AgentError, RunContext } from './types'
import { agentLogger } from '@/lib/monitoring/logger'
import { logUsage } from './budget'
import { codexText, DEFAULT_CODEX_TIMEOUT_MS, type CodexTextImage } from '@/lib/local-codex/llm'
import {
  attemptTimeoutWithin,
  backoffWithin,
  deadlineExhaustedMessage,
  localCodexDeadlineAt,
} from './deadline'
import type { MessageParam } from './llm/message-types'

export type { ContentBlockParam, ImageBlockParam, MessageParam, TextBlockParam } from './llm/message-types'

/** 원본 SDK 비스트리밍 요청 상한. 단계 표·시험의 호환 기준으로 유지한다. */
export const SDK_NON_STREAMING_MAX_TOKENS = 21_333

const MAX_RETRIES = 1
const LOCAL_CODEX_CALL_TIMEOUT_MS = 30 * 60_000

export interface CallOptions {
  config: AgentConfig
  system: string
  messages: MessageParam[]
  maxRetries?: number
  timeoutMs?: number
  agentName: string
  runContext?: RunContext
  deadlineAt?: number
  failOnTruncation?: boolean
  retryTruncated?: boolean
}

function formatMessages(messages: MessageParam[]): { user: string; images: CodexTextImage[] } {
  const images: CodexTextImage[] = []
  const sections = messages.map((message) => {
    const blocks = typeof message.content === 'string'
      ? [{ type: 'text' as const, text: message.content }]
      : message.content
    const text = blocks.map((block) => {
      if (block.type === 'text') return block.text
      if (block.type === 'image') {
        images.push({ base64: block.source.data, mediaType: block.source.media_type })
        return `(첨부 이미지 ${images.length})`
      }
      return `(첨부 문서 ${block.source.media_type} — 로컬 Codex 이미지 첨부 형식이 아니므로 본문 메타데이터만 전달)`
    }).join('\n')
    return `[${message.role === 'assistant' ? '이전 응답' : '사용자'}]\n${text}`
  })
  return { user: sections.join('\n\n'), images }
}

function isTimeoutError(error: unknown): boolean {
  return /timeout|시간 안에 끝나지/i.test(error instanceof Error ? error.message : String(error))
}

async function recordUsage(input: {
  agentName: string
  model: string
  runContext?: RunContext
  success: boolean
  durationMs: number
  attempts: number
}): Promise<void> {
  await logUsage({
    agent: input.agentName,
    model: input.model,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    runContext: input.runContext,
    success: input.success,
    durationMs: input.durationMs,
    attempts: input.attempts,
  })
}

export async function callAgent<T>(
  options: CallOptions,
  parser: (text: string) => T,
): Promise<AgentOutput<T>> {
  const {
    config,
    system,
    messages,
    maxRetries = MAX_RETRIES,
    timeoutMs: requestedTimeoutMs = DEFAULT_CODEX_TIMEOUT_MS,
    agentName,
    runContext,
    deadlineAt: requestedDeadlineAt,
  } = options
  const timeoutMs = Math.max(requestedTimeoutMs, LOCAL_CODEX_CALL_TIMEOUT_MS)
  const start = Date.now()
  const deadlineAt = localCodexDeadlineAt(requestedDeadlineAt, start)
  const zeroUsage = { inputTokens: 0, outputTokens: 0, cost: 0 }
  const prompt = formatMessages(messages)
  let lastError: AgentError = { message: 'Unknown error', stage: 'api', attempts: 0 }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attempts = attempt + 1
    const attemptTimeout = attemptTimeoutWithin(deadlineAt, timeoutMs)
    if (attemptTimeout === null) {
      lastError = {
        message: deadlineExhaustedMessage(attempt, lastError.message),
        stage: 'timeout',
        attempts: attempt,
      }
      break
    }
    try {
      const text = await codexText({ system, user: prompt.user, images: prompt.images, timeoutMs: attemptTimeout })
      let data: T
      try {
        data = parser(text)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        lastError = { message, stage: 'parse', attempts }
        await recordUsage({ agentName, model: config.model, runContext, success: false, durationMs: Date.now() - start, attempts })
        agentLogger.warn(`Agent parse failed (attempt ${attempts})`, { error: message, agentName })
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, backoffWithin(deadlineAt, 1000 * attempts)))
          continue
        }
        break
      }

      const duration = Date.now() - start
      await recordUsage({ agentName, model: config.model, runContext, success: true, durationMs: duration, attempts })
      agentLogger.info('Local Codex agent call completed', { model: config.model, agentName, cost: 0, duration })
      return { success: true, data, usage: zeroUsage, duration }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stage: AgentError['stage'] = isTimeoutError(error) ? 'timeout' : 'api'
      lastError = { message, stage, attempts }
      await recordUsage({ agentName, model: config.model, runContext, success: false, durationMs: Date.now() - start, attempts })
      agentLogger.warn(`Local Codex agent attempt ${attempts} failed`, { error: message, stage, agentName })
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, backoffWithin(deadlineAt, 1000 * attempts)))
      }
    }
  }

  return { success: false, error: lastError, usage: zeroUsage, duration: Date.now() - start }
}
