/**
 * 모델 계층 진입점(묶음 1) — 라우트의 모델 이름으로 공급자를 골라 부른다. 폴백은 없다(오너 결정: 단계별 고정 모델만, 결정 E).
 * 공급자마다 같은 계약: AgentOutput, 호출 전 월 예산 확인, 시도마다 ai_usage_log(logUsage) 기록(통합 조건 ①).
 * 등록되지 않은 모델은 부르지 않고 실패로 돌려준다.
 *
 * 구독 백엔드(라우트 backend 'subscription', pdp-llm-subscription-backend · R13): OpenAI 모델은 코덱스 구독, Anthropic 모델은
 * Claude 구독(providers/codex-cli — 공급자로 백엔드를 고른다)으로 보낸다. Gemini는 구독이 없다. 소프트 종료(한도 소진·시간 초과·
 * 백엔드 미등록)는 실패 결과가 아니라 LlmSoftStopError를 던진다 — 호출부가 이전 단계 결과로 넘어가지 않고 단계가 멈추게(파이프라인은
 * 실패로 세지 않는다). route subscriptionFallback 'api'(구독 작업자 잡)면 멈추지 않고 같은 route를 API로 한 번 잇는다
 * (subscription-fallback.ts). route subscriptionHalt(구독 멈춤 표지 잡, AX-CT-29)면 잇지 않고 프로세스 실패(stage 'api')도 reason 'process'인
 * LlmSoftStopError로 던진다 — 파이프라인이 멈춤으로 기록한다. API 백엔드 경로의 계약은 그대로다.
 * 부르기 전에 막는 설정(400 방지): thinking을 끌 수 없는 모델의 disableThinking, thinking 끄기와 effort xhigh·max(Sonnet 5.5·
 * Haiku 5.5는 high 이하에서만 끌 수 있다), 구독 백엔드가 없는 공급자, Claude 구독의 thinking 끄기(CLI는 생각을 끄지 못한다 — C 4차
 * "CLI off≠끔"), effort를 받지 않는 모델의 effort, OpenAI API 경로에서 확인하지 않은 모델·값의 effort(registry apiEfforts),
 * Gemini thinkingLevel 밖의 effort(xhigh·max), 잘림 감지를 보지 못하는 경로(OpenAI API·코덱스 구독)의 failOnTruncation,
 * API로 잇는 라우트의 API 판이 막히는 설정. Anthropic effort xhigh는 SDK 0.90부터 받는다(R02 — 0.81 때는 막았다).
 * 구독 전용 모드(subscription-only.ts — 로컬 시험 하네스만 켠다, J42): Anthropic·OpenAI 모델 route를 구독 route로 바꿔 부른다(API로 잇지
 * 않는다). 모드가 꺼져 있으면(운영·웹·작업자) 이 분기는 없다.
 */

import type { AgentOutput } from '../types'
import { callAnthropic } from './providers/anthropic'
import { LlmSoftStopError, subscriptionBackendOf } from './local-llm-backend'
import { callSubscriptionCli } from './providers/codex-cli'
import { callGemini } from './providers/gemini'
import { callOpenAi } from './providers/openai'
import { lookupLlmModel, type LlmModelInfo } from './registry'
import { apiRouteOf, callWithSubscriptionFallback } from './subscription-fallback'
import { isSubscriptionOnly, isSubscriptionOnlyProvider, subscriptionOnlyCall } from './subscription-only'
import type { LlmEffort, LlmRequest, LlmRoute } from './types'

export type { LlmBackend, LlmEffort, LlmRequest, LlmRoute } from './types'
export { LLM_MODELS, llmCostPer1k, lookupLlmModel, type LlmModelInfo, type LlmProvider } from './registry'

function refused<T>(message: string): AgentOutput<T> {
  return {
    success: false,
    error: { message, stage: 'api', attempts: 0 },
    usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
    duration: 0,
  }
}

/** Gemini thinkingConfig.thinkingLevel이 받는 값 — 라우트 effort를 그대로 보낸다(providers/gemini.ts) */
const GEMINI_THINKING_LEVELS: readonly LlmEffort[] = ['low', 'medium', 'high']

/** 부르면 400일 설정 — 사유 또는 null */
function routeProblem(route: LlmRoute, info: LlmModelInfo): string | null {
  const subscription = route.backend === 'subscription'
  if (info.thinkingRequired && route.disableThinking) {
    return `${route.model}은 thinking을 끌 수 없습니다 — disableThinking 대신 effort로 조절합니다`
  }
  if (info.provider === 'anthropic' && route.disableThinking && (route.effort === 'xhigh' || route.effort === 'max')) {
    return `thinking 끄기는 effort high 이하에서만 받습니다 — ${route.model}(effort ${route.effort})`
  }
  if (subscription && !subscriptionBackendOf(info.provider)) return `${info.provider} 구독 백엔드는 없습니다 — ${route.model}`
  if (subscription && info.provider === 'anthropic' && route.disableThinking) {
    return `Claude 구독(CLI)은 thinking을 끌 수 없습니다 — ${route.model}은 API로 부릅니다`
  }
  if (info.noEffort && route.effort) return `${route.model}은 effort를 받지 않습니다`
  if (info.geminiThinkingLevel && route.effort && !GEMINI_THINKING_LEVELS.includes(route.effort)) {
    return `Gemini thinkingLevel은 low·medium·high만 받습니다 — ${route.model}(effort ${route.effort})`
  }
  if (route.failOnTruncation && info.provider === 'openai') {
    return `잘림 감지(failOnTruncation)는 Anthropic·Gemini API 경로와 Claude 구독 경로만 봅니다 — ${route.model}`
  }
  if (!subscription && info.provider === 'openai' && route.effort && !info.apiEfforts?.includes(route.effort)) {
    return `OpenAI API 경로에서 확인하지 않은 effort입니다 — ${route.model}(effort ${route.effort})`
  }
  // API로 잇는 구독 라우트 — 구독을 쓴 뒤 API 판이 막혀 멈추지 않게 미리 본다
  if (subscription && route.subscriptionFallback === 'api') {
    const apiProblem = routeProblem(apiRouteOf(route), info)
    if (apiProblem) return `API 잇기 라우트가 막힙니다 — ${apiProblem}`
  }
  return null
}

export async function callLlm<T>(
  givenRoute: LlmRoute,
  givenRequest: LlmRequest,
  parser: (text: string) => T
): Promise<AgentOutput<T>> {
  const info = lookupLlmModel(givenRoute.model)
  if (!info) return refused(`등록되지 않은 모델 — ${givenRoute.model}(agents/llm/registry.ts)`)
  // 구독 전용 모드(로컬 시험 하네스만) — Claude·GPT는 모두 구독으로, 막히면 멈춘다. 모드가 꺼져 있으면 받은 route·요청 그대로다
  const { route, request } =
    isSubscriptionOnly() && isSubscriptionOnlyProvider(info)
      ? subscriptionOnlyCall(givenRoute, givenRequest, info)
      : { route: givenRoute, request: givenRequest }
  const problem = routeProblem(route, info)
  if (problem) return refused(problem)
  if (route.backend === 'subscription') {
    const backend = subscriptionBackendOf(info.provider)
    if (backend && route.subscriptionFallback === 'api') {
      return callWithSubscriptionFallback(route, request, backend, {
        subscription: (r, req) => callSubscriptionCli(r, req, parser),
        api: (r, req) => callLlm(r, req, parser),
      })
    }
    const result = await callSubscriptionCli(route, request, parser)
    // 구독 멈춤 표지 잡 — 프로세스 실패(백엔드가 이미 한 번 다시 시도한 뒤의 stage 'api')는 단계 실패로 세지 않고 멈춤으로 던진다.
    // 한도·로그인 같은 소프트 종료 기록은 남기지 않는다(그 콜만의 일 — 이어 하기 뒤 다시 구독을 부른다)
    if (route.subscriptionHalt && backend && !result.success && result.error.stage === 'api') {
      throw new LlmSoftStopError({ backend, reason: 'process', message: result.error.message, at: new Date().toISOString() })
    }
    return result
  }
  switch (info.provider) {
    case 'anthropic':
      return callAnthropic(route, request, parser)
    case 'openai':
      return callOpenAi(route, request, parser)
    case 'gemini':
      return callGemini(route, request, parser)
  }
}
