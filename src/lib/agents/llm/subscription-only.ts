/**
 * 구독 전용 모드(하네스 J42 — 오너 2026-11-10 "PDP는 구독을 써야하는데 왜 API를 쓰는가. 리눅스 PC에 로그인된 구독 계정을 사용하도록 해라.")
 * — 이 프로세스의 Claude·GPT 텍스트·비전 콜을 모두 구독 CLI 백엔드(claude-cli·codex-cli)로 보내고, 구독이 막히면 API로 잇지 않고 멈춘다
 * (LlmSoftStopError — 하네스가 run 사이에 보고 멈춘다). Gemini와 이미지 생성은 API 그대로다(오너 I4-1).
 *
 * 켜는 곳은 로컬 시험 하네스뿐이다(__e2e__/subscription-bridge — 리눅스 PC SSH 다리 백엔드 등록과 함께). Vercel·Railway 작업자는 켜지 않는다
 * → 운영 동작은 그대로다. 잡 DB 표지(spec_sheet modelBackend)는 쓰지 않는다 — 작업자 큐가 그 표지로 잡을 집어 API로 잇기 때문이다.
 *
 * 막는 곳은 API 진입점이다 — 단계 route 표가 아니라서 하드코딩된 route·켬 기능의 콜까지 모두 덮는다:
 * - callLlm(agents/llm): Anthropic·OpenAI 모델 route를 subscriptionOnlyCall로 바꿔 구독 CLI로 보낸다.
 * - callAgent(agents/_base — Anthropic API를 직접 부르는 에이전트, 예 썸네일 게이트·비전): 같은 규칙으로 구독 CLI로 보낸다.
 * - callOpenAiChat(agents/openai-chat): OpenAI 모델이면 API를 부르지 않고 멈춘다(callLlm이 먼저 바꾸므로 안전망이다. Gemini는 그대로).
 *
 * CLI가 같은 설정을 지킬 수 없는 칸은 API로 보내지 않고 CLI로 보내되 조정을 기록한다(오너에게 보일 표 — subscriptionOnlyAdjustments):
 * - thinking 끄기(disableThinking) → CLI는 끌 수 없다(C 4차 "CLI off≠끔"). effort를 받는 모델은 effort low, 안 받는 모델(Haiku 4.5)은 그대로.
 *   Claude는 생각이 출력 상한을 나눠 쓰므로 상한에 생각 몫(SUBSCRIPTION_ONLY_THINKING_HEADROOM_TOKENS)을 더한다 — route 상한은 생각 없는
 *   API 답 크기로 맞춘 값이라서다(J43). 코덱스는 상한을 받지 않아 그대로다.
 * - 공급자 JSON 강제(json) → CLI에 없다. 뺀다(파서가 답 글에서 JSON을 읽는다).
 * - GPT 잘림 감지(failOnTruncation) → 코덱스는 잘림을 모른다. 뺀다(Claude는 CLI가 알려 주므로 그대로).
 * - temperature → CLI가 받지 않는다. 뺀다.
 * - 구독 → API 잇기(subscriptionFallback 'api') → 뺀다(시험 잡은 멈춘다).
 * 시간 제한: CLI는 시작·SSH 몫이 더 들어 짧은 시간 제한(GIF 검사 40초 등)이면 정상 콜도 시간 초과로 멈춘다 — 요청 시간 제한을
 * SUBSCRIPTION_ONLY_MIN_TIMEOUT_MS 아래로 두지 않는다(구독이라 비용은 늘지 않는다). run 기한(deadlineAt)은 그대로 넘긴다.
 */

import type { AgentConfig } from '../types'
import { LlmSoftStopError, noteLocalLlmSoftStop, subscriptionBackendOf } from './local-llm-backend'
import { lookupLlmModel, type LlmModelInfo } from './registry'
import type { LlmRequest, LlmRoute } from './types'

/** 구독 전용 모드의 요청 시간 제한 하한 — CLI 시작(약 5~10초)·SSH·첨부 이미지 읽기 몫(근거 없는 권장값, 첫 실측으로 조정) */
export const SUBSCRIPTION_ONLY_MIN_TIMEOUT_MS = 180_000

/**
 * thinking 끄기 route(Claude)의 출력 상한에 더하는 생각 몫 — J43 실측: design/review-faq(Haiku 5.5, 상한 1,500, CLI effort low)가
 * 콜마다 같은 상한으로 요청 4번(처음 + CLI 출력 상한 복구 3번 — Claude Code CLI 상수, 로컬 2.1.321 코드)이 모두 잘려 답 없이 끝났다
 * (콜당 출력 합 6,000·입력 합 약 19.8k, 2콜). 구독이라 비용은 늘지 않고 쓴 토큰만 센다. 값은 근거 없는 권장값이고 다리 실측으로 조정한다
 */
export const SUBSCRIPTION_ONLY_THINKING_HEADROOM_TOKENS = 8_000

export const SUBSCRIPTION_ONLY_ADJUSTMENTS = ['thinking-off', 'json', 'gpt-truncation', 'temperature', 'api-fallback'] as const
export type SubscriptionOnlyAdjustment = (typeof SUBSCRIPTION_ONLY_ADJUSTMENTS)[number]

export interface SubscriptionOnlyAdjustmentCount {
  agent: string
  model: string
  adjustment: SubscriptionOnlyAdjustment
  count: number
}

interface ModeState {
  enabled: boolean
  /** `${agent}\u0000${model}\u0000${adjustment}` → 횟수 */
  adjustments: Map<string, number>
}

// 하네스가 다른 경로로 같은 모듈을 다시 불러와도 상태가 하나로 유지되게 전역 심볼에 둔다(local-llm-backend와 같은 방식)
const MODE_KEY = Symbol.for('nexops.agents.llm.subscriptionOnly')

function state(): ModeState {
  const store = globalThis as unknown as Record<symbol, ModeState | undefined>
  let current = store[MODE_KEY]
  if (!current) {
    current = { enabled: false, adjustments: new Map() }
    store[MODE_KEY] = current
  }
  return current
}

/** 구독 전용 모드를 켜고 끄는 함수를 돌려준다 — 켤 때 조정 기록을 비운다 */
export function enableSubscriptionOnly(): () => void {
  const current = state()
  current.enabled = true
  current.adjustments.clear()
  return () => {
    current.enabled = false
  }
}

export function isSubscriptionOnly(): boolean {
  return state().enabled
}

/** 구독 전용 모드가 맡는 공급자인가 — Claude·GPT만(Gemini는 구독이 없다) */
export function isSubscriptionOnlyProvider(info: Pick<LlmModelInfo, 'provider'> | null): boolean {
  return Boolean(info && subscriptionBackendOf(info.provider))
}

/** route를 구독 전용으로 — 같은 모델·등급·상한(Claude thinking 끄기 칸만 생각 몫을 더함), CLI가 지킬 수 없는 칸은 빼고 조정 목록에 남긴다(순수) */
export function subscriptionOnlyRoute(
  route: LlmRoute,
  info: Pick<LlmModelInfo, 'provider' | 'noEffort'>
): { route: LlmRoute; adjustments: SubscriptionOnlyAdjustment[] } {
  const adjustments: SubscriptionOnlyAdjustment[] = []
  const {
    disableThinking,
    json,
    temperature,
    subscriptionFallback,
    failOnTruncation,
    backend: _backend,
    ...rest
  } = route
  void _backend
  const next: LlmRoute = { ...rest, backend: 'subscription' }
  if (disableThinking) {
    adjustments.push('thinking-off')
    if (!next.effort && !info.noEffort) next.effort = 'low'
    if (info.provider === 'anthropic') next.maxTokens = route.maxTokens + SUBSCRIPTION_ONLY_THINKING_HEADROOM_TOKENS
  }
  if (json) adjustments.push('json')
  if (temperature !== undefined) adjustments.push('temperature')
  if (subscriptionFallback) adjustments.push('api-fallback')
  if (failOnTruncation) {
    if (info.provider === 'openai') adjustments.push('gpt-truncation')
    else next.failOnTruncation = true
  }
  return { route: next, adjustments }
}

/** 요청 시간 제한 하한 — 지정값이 하한보다 짧을 때만 올린다(없으면 백엔드 기본 5분 그대로) */
export function subscriptionOnlyRequest(request: LlmRequest): LlmRequest {
  if (request.timeoutMs === undefined || request.timeoutMs >= SUBSCRIPTION_ONLY_MIN_TIMEOUT_MS) return request
  return { ...request, timeoutMs: SUBSCRIPTION_ONLY_MIN_TIMEOUT_MS }
}

function noteAdjustments(agent: string, model: string, adjustments: readonly SubscriptionOnlyAdjustment[]): void {
  const { adjustments: counts } = state()
  for (const adjustment of adjustments) {
    const key = `${agent}\u0000${model}\u0000${adjustment}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
}

/** callLlm 진입 — 구독 전용 route·요청으로 바꾸고 조정을 기록한다 */
export function subscriptionOnlyCall(
  route: LlmRoute,
  request: LlmRequest,
  info: Pick<LlmModelInfo, 'provider' | 'noEffort'>
): { route: LlmRoute; request: LlmRequest } {
  const converted = subscriptionOnlyRoute(route, info)
  noteAdjustments(request.agentName, route.model, converted.adjustments)
  return { route: converted.route, request: subscriptionOnlyRequest(request) }
}

/** callAgent(Anthropic API 직접) 설정 → 같은 값의 route — 잘림 감지는 호출 옵션 값 */
export function agentConfigRoute(config: AgentConfig, failOnTruncation?: boolean): LlmRoute {
  return {
    model: config.model,
    maxTokens: config.maxTokens,
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    ...(config.disableThinking ? { disableThinking: true } : {}),
    ...(config.effort ? { effort: config.effort } : {}),
    ...(failOnTruncation ? { failOnTruncation: true } : {}),
  }
}

/** 조정 기록(에이전트·모델·조정별 횟수) — 하네스가 원장에 남긴다 */
export function subscriptionOnlyAdjustments(): SubscriptionOnlyAdjustmentCount[] {
  return [...state().adjustments.entries()]
    .map(([key, count]) => {
      const [agent, model, adjustment] = key.split('\u0000')
      return { agent, model, adjustment: adjustment as SubscriptionOnlyAdjustment, count }
    })
    .sort((a, b) => a.agent.localeCompare(b.agent) || a.model.localeCompare(b.model) || a.adjustment.localeCompare(b.adjustment))
}

/**
 * OpenAI API 직접 호출 안전망 — 구독 전용 모드에서 OpenAI 모델이면 API를 부르지 않고 소프트 종료(codex-cli unavailable)를 던진다.
 * callLlm이 먼저 구독으로 바꾸므로 정상 경로에서는 닿지 않는다. 모드가 꺼졌거나 OpenAI 모델이 아니면(Gemini 등) 아무것도 하지 않는다
 */
export function assertNoOpenAiApiInSubscriptionOnly(model: string, agentName: string): void {
  if (!isSubscriptionOnly() || lookupLlmModel(model)?.provider !== 'openai') return
  const stop = {
    backend: 'codex-cli' as const,
    reason: 'unavailable' as const,
    message: `구독 전용 모드에서 OpenAI API를 직접 부르려 했습니다 — 부르지 않고 멈춥니다(${agentName} ${model})`,
    at: new Date().toISOString(),
  }
  noteLocalLlmSoftStop(stop)
  throw new LlmSoftStopError(stop)
}
