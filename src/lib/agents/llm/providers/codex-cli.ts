/**
 * 구독 CLI 공급자(pdp-llm-subscription-backend · R13) — 라우트 backend 'subscription'인 모델을 공급자의 로컬 LLM 백엔드로 부른다
 * (local-llm-backend.ts 레지스트리: OpenAI = 'codex-cli', Anthropic = 'claude-cli'). child_process는 없다(구현은
 * scripts/content-runner/codex-llm-backend.mjs·claude-llm-backend.mjs). 파일 이름은 코덱스만 있던 때 그대로다(import 경로 유지).
 *
 * - 사용량: 시도마다 ai_usage_log 1행 — cost 0(구독), 토큰은 CLI가 알려 준 값(없으면 0), stage 끝에 표지(코덱스 `#codex`,
 *   Claude `#claude-cli` — 무DDL, 구독 사용량 집계·model-trace 백엔드 표시용). agent·model은 실제 값이라 model-trace 대조는 그대로다.
 *   claude CLI JSON의 total_cost_usd(API 환산 추정)는 넣지 않는다 — API 환산은 보고서가 토큰 × 단가로 한다.
 * - 월 예산은 보지 않는다(0원 호출).
 * - 소프트 종료(한도 소진·시간 초과·로그인 만료·구독에서 못 쓰는 모델·백엔드 미등록, 또는 이미 남은 기록): 레지스트리에 백엔드별로
 *   남기고 LlmSoftStopError를 던진다 — 실패 결과로 돌려주면 호출부가 이전 단계 결과로 넘어가(카피 Stage 2 실패 → Stage 1 유지) 잡이
 *   멈추지 않기 때문이다. 여기서는 API로 넘어가지 않는다(하네스 결정 E). 작업자 잡의 API 잇기는 subscription-fallback.ts가 한다.
 * - 파싱 실패는 maxRetries만큼 다시 부른다. 프로세스 실패는 백엔드가 이미 한 번 다시 시도했으므로 여기서 또 부르지 않는다
 *   (CLI 실행이 최대 4회로 곱해지지 않게, 검수 지적). 둘 다 끝내 실패하면 실패 결과로 돌려준다(API 공급자와 같은 계약).
 * - 잘림 감지(failOnTruncation): claude-cli가 출력 상한에서 끊긴 답을 알려 주면(truncated) 파서에 넘기지 않고 파싱 실패로 센다
 *   (Anthropic API 경로와 같은 계약). codex-cli는 알 수 없어 callLlm이 부르기 전에 막는다.
 *   구독 전용 모드(하네스)에서는 잘림 감지가 없는 route도 답 없이 잘린 콜(빈 글, 또는 CLI의 출력 상한 안내 글)을 잘린 답으로 센다 —
 *   파서가 빈 글을 받아 형식 오류('items 배열이 없습니다' 등)로 보이던 일(J43). 부분 답은 지금처럼 파서가 받는다. 모드가 꺼져 있으면 그대로다.
 * - run 기한(request.deadlineAt, R11e — 구독 작업자의 단계 기한): API 경로(callAgent attemptTimeoutWithin)와 같은 규칙으로 시도마다
 *   시간 제한을 남은 시간 안으로 줄이고 백엔드에도 기한을 넘긴다(동시 실행 대기·빈 답 재시도도 기한 안). 15초 미만이면 부르지 않고
 *   stage 'timeout' 실패(deadlineExhaustedMessage)로 끝낸다 — 소프트 종료가 아니라 API로 잇지 않는다(잇기도 같은 기한이라 못 부른다).
 *   기한이 없으면(로컬·시험 하네스) 요청 바이트·동작 그대로다.
 */

import { logUsage } from '../../budget'
import { attemptTimeoutWithin, deadlineExhaustedMessage } from '../../deadline'
import type { AgentError, AgentOutput, RunContext } from '../../types'
import {
  getLocalLlmBackend,
  LLM_DEADLINE_EXHAUSTED_CODE,
  llmSoftStopReasonOf,
  LlmSoftStopError,
  noteLocalLlmSoftStop,
  peekLocalLlmSoftStop,
  subscriptionBackendOf,
  type LocalLlmBackendId,
  type LocalLlmSoftStop,
  type LocalLlmUsage,
} from '../local-llm-backend'
import { lookupLlmModel } from '../registry'
import { isSubscriptionOnly } from '../subscription-only'
import type { LlmRequest, LlmRoute } from '../types'

export const CODEX_STAGE_MARK = '#codex'
export const CLAUDE_CLI_STAGE_MARK = '#claude-cli'
const STAGE_MARKS: Readonly<Record<LocalLlmBackendId, string>> = {
  'codex-cli': CODEX_STAGE_MARK,
  'claude-cli': CLAUDE_CLI_STAGE_MARK,
}
const DEFAULT_PARSE_RETRIES = 1
/**
 * 백엔드 기본 시간 제한(scripts/content-runner *-llm-backend.mjs timeoutMs 기본값과 같다) — run 기한만 있고 timeoutMs가 없는 요청의
 * 상한(R11e). 기한이 없으면 쓰지 않는다(백엔드가 자기 기본값을 쓴다)
 */
export const SUBSCRIPTION_CLI_DEFAULT_TIMEOUT_MS = 5 * 60_000

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** claude CLI가 출력 상한 복구까지 다 쓰고 답 대신 남기는 안내 글(claude-llm-backend TRUNCATION_PATTERN과 같은 글) */
const CLI_OUTPUT_CAP_NOTICE = /exceeded the \d+ output token maximum/i

/** 잘렸는데 답이 없다 — 빈 글이거나 CLI 안내 글뿐 */
function cutWithoutAnswer(text: string): boolean {
  return !text.trim() || CLI_OUTPUT_CAP_NOTICE.test(text)
}

/**
 * 백엔드 오류가 run 기한 때문인가(R11e) — 백엔드가 남은 시간이 없어 부르지 않았거나(기한 오류), 기한에 맞춘 시간 제한이 다 돼 끝난
 * 뒤 남은 시간이 최소 시도 시간보다 적다(API로 이어도 부르지 못한다). 구독 문제가 아니라 소프트 종료로 남기지 않는다
 */
function stoppedByDeadline(error: unknown, softStopReason: string | null, deadlineAt: number | undefined): boolean {
  if ((error as { code?: unknown } | null)?.code === LLM_DEADLINE_EXHAUSTED_CODE) return true
  return softStopReason === 'timeout' && deadlineAt !== undefined && attemptTimeoutWithin(deadlineAt, 1) === null
}

/** 라우트 모델의 구독 백엔드 — 모르는 모델·백엔드 없는 공급자는 null */
export function subscriptionBackendForRoute(route: Pick<LlmRoute, 'model'>): LocalLlmBackendId | null {
  const provider = lookupLlmModel(route.model)?.provider
  return provider ? subscriptionBackendOf(provider) : null
}

/** 구독 콜 표지를 단 귀속 — 단계가 없으면 표지만 */
function markedContext(runContext: RunContext | undefined, backend: LocalLlmBackendId): RunContext {
  return { ...runContext, stage: `${runContext?.stage ?? ''}${STAGE_MARKS[backend]}` }
}

function softStop(backend: LocalLlmBackendId, reason: LocalLlmSoftStop['reason'], detail: string): LlmSoftStopError {
  const stop: LocalLlmSoftStop = { backend, reason, message: detail, at: new Date().toISOString() }
  noteLocalLlmSoftStop(stop)
  return new LlmSoftStopError(stop)
}

/**
 * 구독 라우트를 부를 수 있는가 — 아니면 지금 LlmSoftStopError를 던진다(그 백엔드의 남은 소프트 종료 기록·백엔드 미등록). 구독 단계
 * 앞에 유료 단계가 있는 흐름(카피 Stage 1 → Stage 2)이 유료 콜을 쓰기 전에 멈추게 한다(검수 지적). API 라우트, 그리고 API로 잇는
 * 작업자 라우트(subscriptionFallback 'api' — 멈추지 않고 API로 잇는다)면 아무것도 하지 않는다.
 */
export function assertSubscriptionReady(route: LlmRoute): void {
  if (route.backend !== 'subscription' || route.subscriptionFallback === 'api') return
  const backend = subscriptionBackendForRoute(route) ?? 'codex-cli'
  const stopped = peekLocalLlmSoftStop(backend)
  if (stopped) throw new LlmSoftStopError(stopped)
  if (!getLocalLlmBackend(backend)) {
    throw softStop(
      backend,
      'unavailable',
      `${backend} 백엔드가 등록돼 있지 않습니다 — 구독 백엔드는 로컬 실행기·구독 작업자에서만 돕니다(${route.model})`
    )
  }
}

function failed<T>(text: string): AgentOutput<T> {
  return {
    success: false,
    error: { message: text, stage: 'api', attempts: 0 },
    usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
    duration: 0,
  }
}

export async function callSubscriptionCli<T>(
  route: LlmRoute,
  request: LlmRequest,
  parser: (text: string) => T
): Promise<AgentOutput<T>> {
  const start = Date.now()
  const backendId = subscriptionBackendForRoute(route)
  if (!backendId) return failed(`구독 백엔드가 없는 모델입니다 — ${route.model}`)
  // 사전 점검은 작업자 라우트도 한다(남은 기록·미등록 → LlmSoftStopError, 잇기는 subscription-fallback이 받는다)
  assertSubscriptionReady({ ...route, backend: 'subscription', subscriptionFallback: undefined })
  const backend = getLocalLlmBackend(backendId)!
  if (backendId === 'codex-cli' && route.effort === 'max') return failed(`codex 구독은 effort max가 없습니다 — ${route.model}`)

  const runContext = markedContext(request.runContext, backendId)
  const record = async (success: boolean, usage: LocalLlmUsage | null, attempts: number) => {
    const logged = await logUsage({
      agent: request.agentName,
      model: route.model,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      costUsd: 0,
      runContext,
      success,
      durationMs: Date.now() - start,
      attempts,
    })
    if (!logged)
      console.error('구독 LLM 사용량 기록 실패 — 호출 결과에는 영향 없음.', {
        agent: request.agentName,
        model: route.model,
      })
  }

  const parseRetries = request.maxRetries ?? DEFAULT_PARSE_RETRIES
  let lastError: AgentError = { message: 'Unknown error', stage: 'api', attempts: 0 }
  let total = { inputTokens: 0, outputTokens: 0 }
  for (let attempt = 1; attempt <= parseRetries + 1; attempt++) {
    // run 기한(R11e, API 경로 callAgent와 같은 규칙) — 시도마다 시간 제한을 남은 시간 안으로, 15초 미만이면 부르지 않고 기한 소진
    // 실패로 끝낸다(stage timeout — 구독→API 잇기도 하지 않는다). 기한이 없으면(로컬·시험 하네스) 요청 그대로
    const attemptTimeout =
      request.deadlineAt === undefined
        ? undefined
        : attemptTimeoutWithin(request.deadlineAt, request.timeoutMs ?? SUBSCRIPTION_CLI_DEFAULT_TIMEOUT_MS)
    if (attemptTimeout === null) {
      lastError = { message: deadlineExhaustedMessage(attempt - 1, lastError.message), stage: 'timeout', attempts: attempt - 1 }
      break
    }
    let output
    try {
      output = await backend({
        model: route.model,
        ...(route.effort ? { effort: route.effort } : {}),
        system: request.system,
        messages: request.messages,
        agentName: request.agentName,
        runContext: request.runContext,
        ...(attemptTimeout !== undefined
          ? { timeoutMs: attemptTimeout, deadlineAt: request.deadlineAt }
          : request.timeoutMs !== undefined
            ? { timeoutMs: request.timeoutMs }
            : {}),
        // 코덱스 백엔드에는 보내지 않는다(하네스 요청 바이트 그대로)
        ...(backendId === 'claude-cli' ? { maxTokens: route.maxTokens } : {}),
      })
    } catch (error) {
      const reason = llmSoftStopReasonOf(error)
      await record(false, null, attempt)
      if (stoppedByDeadline(error, reason, request.deadlineAt)) {
        lastError = { message: deadlineExhaustedMessage(attempt, message(error)), stage: 'timeout', attempts: attempt }
        break
      }
      if (reason) throw softStop(backendId, reason, message(error))
      lastError = { message: message(error), stage: 'api', attempts: attempt }
      break
    }
    total = {
      inputTokens: total.inputTokens + (output.usage?.inputTokens ?? 0),
      outputTokens: total.outputTokens + (output.usage?.outputTokens ?? 0),
    }
    const emptyCut = Boolean(output.truncated) && !route.failOnTruncation && isSubscriptionOnly() && cutWithoutAnswer(output.text)
    if ((route.failOnTruncation && output.truncated) || emptyCut) {
      await record(false, output.usage, attempt)
      const what = emptyCut ? '답 없이 잘림' : '잘린 답'
      lastError = { message: `출력 상한(${route.maxTokens})에서 ${what} — ${route.model}`, stage: 'parse', attempts: attempt, stopReason: 'max_tokens' }
      // 같은 상한·같은 입력으로 다시 부르지 않는다(retryTruncated false, R11b)
      if (request.retryTruncated === false) break
      continue
    }
    try {
      const data = parser(output.text)
      await record(true, output.usage, attempt)
      return { success: true, data, usage: { ...total, cost: 0 }, duration: Date.now() - start }
    } catch (error) {
      await record(false, output.usage, attempt)
      lastError = { message: message(error), stage: 'parse', attempts: attempt }
    }
  }
  return { success: false, error: lastError, usage: { ...total, cost: 0 }, duration: Date.now() - start }
}

/** 코덱스만 있던 때의 이름 — 같은 함수(공급자로 백엔드를 고른다) */
export const callCodexCli = callSubscriptionCli
