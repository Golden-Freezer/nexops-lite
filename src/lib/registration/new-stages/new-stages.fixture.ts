/**
 * 새 단계 시험 공용 — 가짜 callLlm(callAgent처럼 파서를 부르고, 던지면 stage 'parse' 실패로 돌려준다)과 가짜 route 표.
 * 모델 이름은 시험용 자리표시다(운영 표 값이 아니다).
 */

import type { LlmRequest, LlmRoute } from '@/lib/agents/llm/types'
import type { AgentError, AgentOutput } from '@/lib/agents/types'
import type { CallLlmFn, NewStageCallOptions, NewStageDeps, NewStageRouteName } from './common'

export const TEST_OPTIONS: NewStageCallOptions = { timeoutMs: 60_000, maxRetries: 1 }

export interface FakeCall {
  route: LlmRoute
  request: LlmRequest
}

export function fakeDeps(reply: { text?: string; error?: AgentError; stopReason?: string; cost?: number } = {}): {
  deps: NewStageDeps
  calls: FakeCall[]
  routeNames: NewStageRouteName[]
} {
  const calls: FakeCall[] = []
  const routeNames: NewStageRouteName[] = []
  const callLlm: CallLlmFn = async <T,>(route: LlmRoute, request: LlmRequest, parser: (text: string) => T): Promise<AgentOutput<T>> => {
    calls.push({ route, request })
    const usage = { inputTokens: 100, outputTokens: 50, cost: reply.cost ?? 0.02 }
    if (reply.error) return { success: false, error: reply.error, usage, duration: 7 }
    try {
      return { success: true, data: parser(reply.text ?? ''), usage, duration: 7 }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: { message, stage: 'parse', attempts: 1, ...(reply.stopReason ? { stopReason: reply.stopReason } : {}) }, usage, duration: 7 }
    }
  }
  const routeOf = (name: NewStageRouteName): LlmRoute => {
    routeNames.push(name)
    return { model: `test-model-for-${name}`, maxTokens: 1234, effort: 'high' }
  }
  return { deps: { routeOf, callLlm }, calls, routeNames }
}

/** 요청의 사용자 글 — 문자열이면 그대로, 블록이면 text 블록만 */
export function userText(call: FakeCall): string {
  const content = call.request.messages[0]?.content
  if (typeof content === 'string') return content
  return (content ?? []).map((block) => (block.type === 'text' ? block.text : `[${block.type}]`)).join('\n')
}
