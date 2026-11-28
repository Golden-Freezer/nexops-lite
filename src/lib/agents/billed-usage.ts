/**
 * 과금된 사용량(하네스 R12d) — 한 호출이 여러 번 시도하면(잘린 답·형식 실패 다시 부르기, 상한 단계 승격·API 재시도) 앞선 시도도 과금되고
 * 사용 기록(ai_usage_log)에 시도마다 한 줄씩 남는다. 공급자는 그 합을 AgentOutput.spent로 돌려준다(R11b callAgent, R12d Gemini·OpenAI·
 * 상한 단계 호출). usage는 지금 그대로다(성공은 마지막 시도, 실패는 0) — 다른 업무 호출부의 값은 바뀌지 않는다.
 * 상세페이지 잡 비용(cost_usd)·잡당 상한·구독 잇기 청구액은 이 값으로 센다 → 같은 잡의 사용 기록 합과 잡 비용이 맞는다.
 */
import type { AgentUsage } from './types'

export const ZERO_USAGE: AgentUsage = Object.freeze({ inputTokens: 0, outputTokens: 0, cost: 0 })

export function addAgentUsage(a: AgentUsage, b: AgentUsage): AgentUsage {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, cost: a.cost + b.cost }
}

/** 과금이 있었나 — 토큰이나 비용이 하나라도 있으면 */
export function isBilled(usage: AgentUsage): boolean {
  return usage.inputTokens > 0 || usage.outputTokens > 0 || usage.cost > 0
}

/** 과금된 사용량 — spent(모든 시도의 합)가 있으면 그것, 없으면 usage(첫 시도에 끝났거나 과금 전에 막힘) */
export function billedUsageOf(output: { usage: AgentUsage; spent?: AgentUsage }): AgentUsage {
  return output.spent ?? output.usage
}

export function billedCostOf(output: { usage: AgentUsage; spent?: AgentUsage }): number {
  return billedUsageOf(output).cost
}

/**
 * 돌려줄 spent 칸 — 앞선 실패 시도 합(failed)이 과금됐으면 failed + 마지막 결과 usage, 아니면 칸 없음(AgentOutput 계약: usage와 다를 때만 싣는다).
 * 실패로 끝난 호출은 last가 0이라 spent = failed다
 */
export function spentField(failed: AgentUsage, last: AgentUsage = ZERO_USAGE): { spent?: AgentUsage } {
  return isBilled(failed) ? { spent: addAgentUsage(failed, last) } : {}
}
