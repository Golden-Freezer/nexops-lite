/**
 * 로컬 LLM 백엔드 레지스트리(pdp-llm-subscription-backend) — 등록·조회·소프트 종료 기록만 담당하고 child_process를 쓰지 않는다.
 *
 * 구독 CLI(코덱스 codex exec · Claude claude -p)처럼 그 기계의 로그인으로만 도는 텍스트·비전 백엔드는 실행기가 시작할 때 등록한다 —
 * 로컬 실 테스트 하네스(codex만) 또는 Railway 구독 작업자(R13, scripts/pdp-worker/worker.mts — 둘 다). 구현은 Next 번들 밖
 * `scripts/content-runner/codex-llm-backend.mjs`·`claude-llm-backend.mjs`. Vercel 번들에는 등록 코드가 없다.
 * 공급자 → 백엔드: OpenAI = codex-cli, Anthropic = claude-cli, Gemini = 없음(API만 — 오너 I4-1).
 *
 * 소프트 종료: 구독 한도 소진·시간 초과·백엔드 미등록은 잡을 실패로 만들 사유가 아니다. 공급자(providers/codex-cli.ts)가 여기에
 * 백엔드별로 기록하고 LlmSoftStopError를 던진다.
 * - 하네스(구독 env 갈래): 파이프라인 단계는 실패로 세지 않고(pdp-pipeline runPdpStep) 하네스가 run 사이에 peekLocalLlmSoftStop()을
 *   보고 멈춘다(API로 넘어가지 않는다 — 결정 E). 기록이 남아 있는 동안은 백엔드를 부르지 않는다(한도·시간 낭비 차단).
 * - 작업자(구독 표지 잡, route subscriptionFallback 'api'): 같은 route를 API로 한 번 잇는다(오너 I2-3, agents/llm/subscription-fallback.ts).
 *   기록은 백엔드별이라 코덱스 한도가 Claude 구독을 멈추지 않는다.
 */

import type { RunContext } from '@/lib/agents/types'
import type { LlmProvider } from './registry'
import type { LlmEffort } from './types'
import type { MessageParam } from './message-types'

export type LocalLlmBackendId = 'codex-cli' | 'claude-cli'

/** 공급자의 구독 백엔드 — 없으면 null(Gemini는 API만) */
export function subscriptionBackendOf(provider: LlmProvider): LocalLlmBackendId | null {
  if (provider === 'openai') return 'codex-cli'
  if (provider === 'anthropic') return 'claude-cli'
  return null
}

export interface LocalLlmRequest {
  model: string
  effort?: LlmEffort
  system: string
  messages: MessageParam[]
  agentName: string
  runContext?: RunContext
  timeoutMs?: number
  /**
   * run 기한(epoch ms, R11e) — 구독 작업자 단계가 넘긴다. 백엔드는 실행마다(동시 실행 대기·빈 답 재시도 뒤에도) 시간 제한을 남은 시간
   * 안으로 줄이고, 15초 미만이면 부르지 않고 기한 오류(code LLM_DEADLINE_EXHAUSTED)를 던진다. 없으면 보내지 않는다(하네스 그대로)
   */
  deadlineAt?: number
  /** 출력 상한 — claude-cli는 CLAUDE_CODE_MAX_OUTPUT_TOKENS로 보낸다. codex-cli는 보내지 않는다(하네스 바이트 그대로) */
  maxTokens?: number
}

/** CLI가 알려 준 토큰(없으면 null — 기록은 0으로) */
export interface LocalLlmUsage {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
}

export interface LocalLlmOutput {
  text: string
  usage: LocalLlmUsage | null
  /** 출력 상한에서 끊긴 답(claude-cli만 안다) — route failOnTruncation이면 공급자가 파싱 실패로 센다 */
  truncated?: boolean
}

export type LocalLlmBackend = (request: LocalLlmRequest) => Promise<LocalLlmOutput>

/** codex-llm-backend.mjs와 같은 값(그쪽 시험이 대조) */
export const LOCAL_LLM_SOFT_STOP_MARKER = '[local-llm:soft-stop]'
/** 백엔드가 run 기한으로 부르지 않았다(R11e) — codex-llm-backend.mjs LLM_DEADLINE_EXHAUSTED_CODE와 같은 값(그쪽 시험이 대조) */
export const LLM_DEADLINE_EXHAUSTED_CODE = 'LLM_DEADLINE_EXHAUSTED'

export type LocalLlmSoftStopReason = 'quota' | 'timeout' | 'unavailable'

export interface LocalLlmSoftStop {
  backend: LocalLlmBackendId
  /** 'process' = 구독 콜의 프로세스 실패(구독 멈춤 표지 잡 — callLlm이 던진다, AX-CT-29). 백엔드가 던지는 사유는 앞의 셋뿐이다 */
  reason: LocalLlmSoftStopReason | 'process'
  message: string
  at: string
}

/** 이름으로 판별한다(파이프라인은 import 없이 e.name을 본다 — PdpLeaseLostError와 같은 방식) */
export class LlmSoftStopError extends Error {
  readonly stop: LocalLlmSoftStop

  constructor(stop: LocalLlmSoftStop) {
    super(`${LOCAL_LLM_SOFT_STOP_MARKER} ${stop.reason}: ${stop.message}`)
    this.name = 'LlmSoftStopError'
    this.stop = stop
  }
}

interface RegistryState {
  backends: Map<LocalLlmBackendId, LocalLlmBackend>
  softStops: Map<LocalLlmBackendId, LocalLlmSoftStop>
}

// 하네스가 다른 경로로 같은 모듈을 다시 불러와도 등록이 하나로 유지되게 전역 심볼에 둔다
const REGISTRY_KEY = Symbol.for('nexops.agents.llm.localBackends')

function registry(): RegistryState {
  const store = globalThis as unknown as Record<symbol, RegistryState | undefined>
  let state = store[REGISTRY_KEY]
  if (!state || !(state.softStops instanceof Map)) {
    state = { backends: state?.backends ?? new Map(), softStops: new Map() }
    store[REGISTRY_KEY] = state
  }
  return state
}

/** 백엔드를 등록하고 해제 함수를 돌려준다. 다른 백엔드가 이미 있으면 덮어쓰지 않고 throw한다. */
export function registerLocalLlmBackend(id: LocalLlmBackendId, backend: LocalLlmBackend): () => void {
  const { backends } = registry()
  const existing = backends.get(id)
  if (existing && existing !== backend)
    throw new Error(`${id} 로컬 LLM 백엔드가 이미 등록돼 있습니다 — 먼저 해제하세요.`)
  backends.set(id, backend)
  return () => {
    if (backends.get(id) === backend) backends.delete(id)
  }
}

export function getLocalLlmBackend(id: LocalLlmBackendId): LocalLlmBackend | undefined {
  return registry().backends.get(id)
}

/** 시험·실행기 종료용 — 등록과 소프트 종료 기록을 모두 지운다 */
export function clearLocalLlmBackends(): void {
  const state = registry()
  state.backends.clear()
  state.softStops.clear()
}

/**
 * 백엔드 오류가 소프트 종료 대상이면 사유를, 아니면 null — 오류 객체의 softStop·softStopReason 표지만 본다.
 * unavailable = 로그인 만료·구독에서 쓸 수 없는 모델(검수 지적 — 일반 실패로 두면 Stage 2가 빠진 결과가 정상처럼 섞인다)
 */
export function llmSoftStopReasonOf(error: unknown): LocalLlmSoftStopReason | null {
  if (!error || typeof error !== 'object') return null
  const marked = error as { softStop?: unknown; softStopReason?: unknown }
  if (marked.softStop !== true) return null
  if (marked.softStopReason === 'timeout' || marked.softStopReason === 'unavailable') return marked.softStopReason
  return 'quota'
}

export function noteLocalLlmSoftStop(entry: LocalLlmSoftStop): void {
  registry().softStops.set(entry.backend, entry)
}

/** backend를 주면 그 백엔드 기록만, 없으면 아무 백엔드의 기록(가장 최근 — 하네스는 하나라도 남으면 멈춘다) */
export function peekLocalLlmSoftStop(backend?: LocalLlmBackendId): LocalLlmSoftStop | null {
  const { softStops } = registry()
  if (backend) return softStops.get(backend) ?? null
  let latest: LocalLlmSoftStop | null = null
  for (const entry of softStops.values()) if (!latest || entry.at > latest.at) latest = entry
  return latest
}

/** backend를 주면 그 백엔드 기록만, 없으면 모두 지운다 */
export function clearLocalLlmSoftStop(backend?: LocalLlmBackendId): void {
  const { softStops } = registry()
  if (backend) softStops.delete(backend)
  else softStops.clear()
}
