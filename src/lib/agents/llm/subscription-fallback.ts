/**
 * 구독 → 같은 모델 API 잇기(R13, 오너 I2-3 "막히면 같은 모델 API로 잇고 청구액 표시") — route subscriptionFallback 'api'인
 * 구독 라우트만(구독 표지 잡의 새 배치 단계, registration/pdp-model-routes). 하네스 구독 갈래(표지 없음)는 지금처럼 멈춘다(결정 E).
 *
 * - 잇는 경우: 소프트 종료(한도 소진·시간 초과·로그인 만료·구독에서 못 쓰는 모델·백엔드 미등록)와 프로세스 실패(실패 결과 stage
 *   'api'). 파싱 실패(stage 'parse' — 모델이 답했지만 형식이 틀림)는 잇지 않는다(API 경로의 파싱 실패와 같이 호출부가 처리).
 * - 같은 route(모델·등급·상한·잘림 감지)를 API로 한 번 부른다. 사용량은 API 공급자가 보통 콜처럼 기록하고(stage 끝 `#sub→api`),
 *   비용은 결과 usage·spent로 돌아가 단계가 잡 cost_usd에 더한다(과금 합, R12d) → 잡당 상한(R04 job-cost-cap)이 그대로 막는다.
 * - 그 백엔드에 한도·로그인(quota·unavailable) 소프트 종료 기록이 남은 동안(15분)은 구독을 부르지 않고 바로 API로(한도·시간 낭비
 *   차단). 15분이 지나면 기록을 지우고 다시 구독을 시도한다. 시간 초과(timeout)는 그 콜만의 일이라 그 콜만 잇고 기록을 지운다 — 짧은
 *   콜 시간(GIF 검사 40초 등) 한 번이 구독 전체를 15분 멈추지 않게. 기록은 백엔드별이다(local-llm-backend).
 * - 잇기마다 기록 1건을 모은다(collectSubscriptionFallbacks) — 파이프라인이 잡 section_plan.subscription_fallback에 남긴다(청구액 표시).
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { billedCostOf } from '../billed-usage'
import type { AgentOutput } from '../types'
import { clearLocalLlmSoftStop, peekLocalLlmSoftStop, type LlmSoftStopError, type LocalLlmBackendId } from './local-llm-backend'
import type { LlmRequest, LlmRoute } from './types'

export const SUBSCRIPTION_FALLBACK_STAGE_MARK = '#sub→api'
/** 소프트 종료 기록을 믿는 시간 — 지나면 다시 구독을 시도한다(근거 없는 권장값, R12 기록으로 조정) */
export const SOFT_STOP_RETRY_AFTER_MS = 15 * 60_000

/** skipped = 남은 소프트 종료 기록으로 구독을 부르지 않았다 · process = 프로세스 실패(백엔드가 이미 한 번 다시 시도) */
export type SubscriptionFallbackReason = 'quota' | 'timeout' | 'unavailable' | 'process' | 'skipped'

export interface SubscriptionFallbackRecord {
  /** runContext.stage(표지 전) — 없으면 null */
  stage: string | null
  agent: string
  model: string
  backend: LocalLlmBackendId
  reason: SubscriptionFallbackReason
  /** 사유 글(앞 200자) — 비밀값은 없다(CLI 마지막 줄·소프트 종료 글) */
  detail: string
  apiSuccess: boolean
  /** API 잇기 콜의 청구액(USD) */
  costUsd: number
  at: string
}

const collector = new AsyncLocalStorage<SubscriptionFallbackRecord[]>()

/** fn 안의 잇기 기록을 records에 모은다 — fn이 던져도 그때까지 모은 기록은 records에 남는다 */
export function collectSubscriptionFallbacks<T>(records: SubscriptionFallbackRecord[], fn: () => Promise<T>): Promise<T> {
  return collector.run(records, fn)
}

export interface SubscriptionFallbackDeps<T> {
  subscription: (route: LlmRoute, request: LlmRequest) => Promise<AgentOutput<T>>
  api: (route: LlmRoute, request: LlmRequest) => Promise<AgentOutput<T>>
  now?: () => number
}

/** 같은 route의 API 판 — backend api, 잇기 표지 없음 */
export function apiRouteOf(route: LlmRoute): LlmRoute {
  const { subscriptionFallback: _fallback, ...rest } = route
  void _fallback
  return { ...rest, backend: 'api' }
}

function isSoftStop(error: unknown): error is LlmSoftStopError {
  return error instanceof Error && error.name === 'LlmSoftStopError'
}

export async function callWithSubscriptionFallback<T>(
  route: LlmRoute,
  request: LlmRequest,
  backend: LocalLlmBackendId,
  deps: SubscriptionFallbackDeps<T>
): Promise<AgentOutput<T>> {
  const now = deps.now ?? Date.now

  const viaApi = async (reason: SubscriptionFallbackReason, detail: string): Promise<AgentOutput<T>> => {
    const stage = request.runContext?.stage ?? null
    const apiRequest: LlmRequest = {
      ...request,
      runContext: { ...request.runContext, stage: `${stage ?? ''}${SUBSCRIPTION_FALLBACK_STAGE_MARK}` },
    }
    console.warn(`[agents/llm] 구독(${backend}) → API 잇기: ${request.agentName} ${route.model} — ${reason}`)
    const result = await deps.api(apiRouteOf(route), apiRequest)
    collector.getStore()?.push({
      stage,
      agent: request.agentName,
      model: route.model,
      backend,
      reason,
      detail: detail.slice(0, 200),
      apiSuccess: result.success,
      costUsd: billedCostOf(result),
      at: new Date(now()).toISOString(),
    })
    return result
  }

  const stop = peekLocalLlmSoftStop(backend)
  if (stop) {
    const age = now() - Date.parse(stop.at)
    if (stop.reason !== 'timeout' && !(age >= SOFT_STOP_RETRY_AFTER_MS)) {
      return viaApi('skipped', `${stop.reason}: ${stop.message}`)
    }
    clearLocalLlmSoftStop(backend)
  }

  let result: AgentOutput<T>
  try {
    result = await deps.subscription(route, request)
  } catch (error) {
    if (!isSoftStop(error)) throw error
    if (error.stop.reason === 'timeout') clearLocalLlmSoftStop(backend)
    return viaApi(error.stop.reason, error.stop.message)
  }
  if (result.success || result.error.stage !== 'api') return result
  return viaApi('process', result.error.message)
}
