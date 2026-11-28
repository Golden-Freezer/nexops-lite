/** 기존 OpenAI Chat 계약을 유지하면서 실제 호출은 공통 로컬 Codex 경로로 실행한다. */

import { callAgent } from './_base'
import type { AgentConfig, AgentOutput, RunContext } from './types'

const DEFAULT_MODEL = 'gpt-5.6-luna'

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
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  maxRetries?: number
  timeoutMs?: number
  agentName: string
  runContext?: RunContext
  deadlineAt?: number
}

export function callOpenAiChat<T>(
  options: CallOptions,
  parser: (text: string) => T,
): Promise<AgentOutput<T>> {
  const {
    model = DEFAULT_MODEL,
    maxTokens = 8192,
    temperature,
    reasoningEffort,
    ...rest
  } = options
  const config = {
    model,
    maxTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(reasoningEffort ? { effort: reasoningEffort } : {}),
  } as AgentConfig
  return callAgent({ ...rest, config }, parser)
}
