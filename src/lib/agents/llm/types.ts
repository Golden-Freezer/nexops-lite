/**
 * 모델 계층 공통 형식 — 단계 라우트(어떤 모델·상한으로)와 요청(무엇을 보낼지)을 나눈다.
 * 메시지는 Anthropic 형식(문자열 또는 text·image 블록)을 공통 형식으로 쓴다 — 기존 에이전트가 이미 이 꼴로 조립하고,
 * 공급자가 자기 형식으로 바꾼다.
 */

import type { RunContext } from '../types'
import type { MessageParam } from './message-types'

/**
 * 추론 수준 — Anthropic API는 output_config.effort, OpenAI API는 reasoning_effort, codex 구독은 model_reasoning_effort로
 * 보낸다(codex는 max 없음)
 */
export type LlmEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * api = 공급자 API(과금), subscription = 그 기계의 구독 CLI(OpenAI codex exec · Anthropic claude -p — 로컬 실행기·Railway 구독
 * 작업자에서만 등록, agents/llm/local-llm-backend.ts)
 */
export type LlmBackend = 'api' | 'subscription'

export interface LlmRoute {
  /** registry.ts LLM_MODELS의 모델 이름 */
  model: string
  maxTokens: number
  /** 허용하는 모델에만 보낸다(registry temperature) */
  temperature?: number
  /**
   * Anthropic 전용 — adaptive thinking 끄기(JSON 산출에 상한을 전량 배정). Sonnet 5.5는 between_tools로 간다(_base.ts).
   * 끌 수 없는 모델(Opus 5.5)엔 두지 않고, effort xhigh·max와 같이 두지 않는다
   */
  disableThinking?: boolean
  /** 공급자 JSON 강제 기능을 쓴다(registry json='native'인 공급자만 — 지금은 Gemini responseMimeType) */
  json?: boolean
  /** 없으면 보내지 않는다(요청 불변 — 공급자 기본값) */
  effort?: LlmEffort
  /** 없으면 api */
  backend?: LlmBackend
  /**
   * 구독 라우트가 한도·로그아웃·오류(소프트 종료·프로세스 실패)면 같은 라우트(모델·등급·상한)를 API로 한 번 잇는다(R13 작업자 잡만,
   * 오너 I2-3 — subscription-fallback.ts). 없으면 지금처럼 멈춘다(하네스 결정 E)
   */
  subscriptionFallback?: 'api'
  /**
   * 구독 멈춤 표지 잡(AX-CT-29)의 구독 라우트 — API로 잇지 않는다. 소프트 종료는 LlmSoftStopError로, 프로세스 실패(구독 콜이 두 번 시도해
   * 둘 다 실패, stage 'api')도 reason 'process'인 LlmSoftStopError로 던져 파이프라인이 멈춤으로 기록한다(callLlm). subscriptionFallback과
   * 함께 두지 않는다. 없으면 지금과 같다
   */
  subscriptionHalt?: true
  /** Anthropic 시간 제한 배율(요청 timeoutMs, 없으면 callAgent 기본 30초에 곱한다) — thinking이 켜진 모델 갈래(M)용 */
  timeoutScale?: number
  /**
   * 잘림 감지(R02) — 출력 상한에서 끊긴 답(Anthropic stop_reason max_tokens · Gemini finishReason MAX_TOKENS)이나 빈 답을 파서에
   * 넘기지 않고 파싱 실패(stage 'parse')로 세어 요청 maxRetries 안에서 다시 부른다. Anthropic·Gemini API 경로만 — OpenAI API·구독
   * 경로에 두면 callLlm이 부르기 전에 막는다(조용히 통과하지 않게). 없으면 지금과 같다(잘린 글도 파서가 받는다)
   */
  failOnTruncation?: boolean
}

export interface LlmRequest {
  system: string
  messages: MessageParam[]
  /** 사용량 로그·월 예산(에이전트 한도)의 호출 주체 — 필수 */
  agentName: string
  runContext?: RunContext
  timeoutMs?: number
  maxRetries?: number
  /** 시간 제한을 run 예산에서 계산했다 — 라우트 timeoutScale을 곱하지 않는다(잡 진행 잠금 기한을 넘지 않게) */
  timeoutFixed?: boolean
  /**
   * run 기한(epoch ms, agents/deadline.ts) — Anthropic·OpenAI API 공급자가 그대로 넘긴다(시도 시간 제한·재시도를 남은 시간 안으로).
   * Gemini 공급자도 시도 시간 제한을 남은 시간 안으로 줄인다(J54d). 코덱스 구독(로컬 실행기 — 강제 종료 없음)은 쓰지 않는다
   */
  deadlineAt?: number
  /**
   * false면 출력 상한에서 잘린 답을 같은 상한·같은 입력으로 다시 부르지 않는다(하네스 R11b, 새 단계). Anthropic API(callAgent)·
   * 구독 CLI(잘림 감지 경로)가 본다. 그 밖의 재시도는 그대로다. 없으면 지금과 같다
   */
  retryTruncated?: boolean
}
