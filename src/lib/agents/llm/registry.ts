/**
 * 텍스트·비전 LLM 모델 표(묶음 1 모델 계층, docs: 통합 port-plan §2·§3) — 모델 이름 하나에 공급자·단가·기능을 둔다.
 * 단계별로 어떤 모델을 쓸지는 여기서 정하지 않는다(상세페이지는 registration/pdp-model-routes.ts 한 곳).
 * 이미지 생성 모델은 agents/image/types.ts가 따로 둔다(잡 단위 선택, 결정 E).
 *
 * 단가: USD / 1K 토큰. 출처는 NEXFIT agents/cost_tracking.py PRICING_USD_PER_1M(보수적 추정, 청구액 아님)과
 * 기존 공급자 래퍼(_base.ts COST_MAP·openai-chat.ts COST_MAP) — 같은 모델은 같은 값이다.
 * 2026-10-29(pdp-model-refresh): Claude는 claude-api 참조 단가표(2026-10-06 기준), GPT는 OpenAI 공식 가격 페이지
 * (developers.openai.com/api/docs/pricing, 2026-10-29 확인)로 맞췄다 — claude-sonnet-5는 $3/$15 → $2/$10 정정.
 */

import type { LlmEffort } from './types'

export type LlmProvider = 'anthropic' | 'openai' | 'gemini'

export interface LlmModelInfo {
  provider: LlmProvider
  /** USD / 1K 토큰. 출력에는 추론(thinking) 토큰도 포함해 계산한다 */
  costPer1k: { input: number; output: number }
  /** 이미지 입력 */
  vision: boolean
  /** temperature 허용 — Claude 5·gpt-5.x 추론형은 거부한다 */
  temperature: boolean
  /** 공급자 JSON 강제 기능(native) 유무 — 없으면 텍스트를 관용 파서로 읽는다 */
  json: 'native' | 'text'
  /** thinking을 끌 수 없다(Opus 5.5 — {type:'disabled'}는 400). 라우트의 disableThinking을 받지 않는다 */
  thinkingRequired?: true
  /** effort(output_config.effort)를 받지 않는다(Haiku 4.5 — 400). 라우트의 effort를 받지 않는다 */
  noEffort?: true
  /** OpenAI API 경로가 reasoning_effort로 보내는 값 — 없으면 API 경로 effort를 부르기 전에 막는다(확인한 모델만, 400 방지) */
  apiEfforts?: readonly LlmEffort[]
  /** Gemini thinkingConfig.thinkingLevel(low·medium·high)을 받는다 — 라우트 effort를 그대로 보낸다 */
  geminiThinkingLevel?: true
}

export const LLM_MODELS: Readonly<Record<string, LlmModelInfo>> = {
  'claude-sonnet-5': {
    provider: 'anthropic',
    costPer1k: { input: 0.002, output: 0.01 },
    vision: true,
    temperature: false,
    json: 'text',
  },
  // PDP 기본(pdp-model-refresh) — $2/$10 per MTok. thinking 끄기는 {type:'between_tools'}로 보낸다(disabled는 400, _base.ts)
  'claude-sonnet-5-5': {
    provider: 'anthropic',
    costPer1k: { input: 0.002, output: 0.01 },
    vision: true,
    temperature: false,
    json: 'text',
  },
  'claude-haiku-4-5-20251001': {
    provider: 'anthropic',
    costPer1k: { input: 0.001, output: 0.005 },
    vision: true,
    temperature: true,
    json: 'text',
    noEffort: true,
  },
  // PDP 구조화 추출(pdp-model-refresh) — $0.10/$0.50 per MTok(프롬프트 100K 이하, 넘으면 $0.50/$2.50 — PDP 분석 입력은 그 아래).
  // adaptive thinking 기본, {type:'disabled'}는 effort high 이하에서만 받는다. temperature는 기본값이 아니면 400
  'claude-haiku-5-5': {
    provider: 'anthropic',
    costPer1k: { input: 0.0001, output: 0.0005 },
    vision: true,
    temperature: false,
    json: 'text',
  },
  // M 갈래(모델 상향 비교, pdp-llm-subscription-backend) — claude-api 참조 단가표(2026-10-06 기준) $4/$20 per MTok.
  // thinking은 끌 수 없고 effort로만 조절한다(기본 medium)
  'claude-opus-5-5': {
    provider: 'anthropic',
    costPer1k: { input: 0.004, output: 0.02 },
    vision: true,
    temperature: false,
    json: 'text',
    thinkingRequired: true,
  },
  // OpenAI 공급자는 지금 텍스트 전용(openai-chat.ts 위) — 이미지 입력은 막는다
  'gpt-5.6-luna': {
    provider: 'openai',
    costPer1k: { input: 0.001, output: 0.006 },
    vision: false,
    temperature: false,
    json: 'text',
  },
  'gpt-5.4-mini': {
    provider: 'openai',
    costPer1k: { input: 0.00075, output: 0.0045 },
    vision: false,
    temperature: false,
    json: 'text',
  },
  // PDP copy/stage2 기본(pdp-model-refresh)·M 갈래 GPT — $2/$10 per MTok(OpenAI 공식 가격, 2026-10-29). 프롬프트가 272K 토큰을
  // 넘으면 입력 2배·출력 1.5배(PDP 카피 프롬프트는 그 아래). 구독 콜은 이 단가와 관계없이 0원으로 기록한다(codex-cli).
  // API 공급자(openai-chat)가 텍스트 전용이라 이미지 입력은 막는다
  'gpt-6.1-sol': {
    provider: 'openai',
    costPer1k: { input: 0.002, output: 0.01 },
    vision: false,
    temperature: false,
    json: 'text',
    // 모델 페이지(2026-10-29): low·medium(기본)·high·xhigh·max
    apiEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  'gemini-3.1-flash-lite': {
    provider: 'gemini',
    costPer1k: { input: 0.00025, output: 0.0015 },
    vision: true,
    temperature: true,
    json: 'native',
  },
  // J54d 같은 상품 판정(2026-11-08) — j54-core.ts PRICE_PER_MTOK와 같은 값: 2026-12-01 00:00 KST 전 $2/$10, 그 뒤 $4/$20 - llmCostPer1k가 호출 시각으로 고른다(표의 값은 인상 전 단가)
  'gemini-4-argon': {
    provider: 'gemini',
    costPer1k: { input: 0.002, output: 0.01 },
    vision: true,
    temperature: false,
    json: 'native',
    geminiThinkingLevel: true,
  },
  'gemini-3.5-flash': {
    provider: 'gemini',
    costPer1k: { input: 0.0015, output: 0.009 },
    vision: true,
    temperature: true,
    json: 'native',
  },
  'gemini-3-flash-preview': {
    provider: 'gemini',
    costPer1k: { input: 0.0005, output: 0.003 },
    vision: true,
    temperature: true,
    json: 'native',
  },
}

export function lookupLlmModel(model: string): LlmModelInfo | null {
  return Object.prototype.hasOwnProperty.call(LLM_MODELS, model) ? LLM_MODELS[model] : null
}

/** 단가 — 미등록 모델은 표의 최고 단가로 계상한다(이미지 estimateImageCostUsd와 같은 관례, 과소 계상 방지) */
/** gemini-4-argon 단가 인상 시각 - 2026-12-01 00:00 KST. 그 전 $2/$10, 그 뒤 $4/$20 per MTok */
export const GEMINI_4_ARGON_PRICE_CHANGE_AT = Date.parse('2026-11-30T15:00:00Z')
export const GEMINI_4_ARGON_PRICE_AFTER = { input: 0.004, output: 0.02 }

/** at = 호출 시각(기본 지금). 날짜별 단가는 gemini-4-argon에만 적용 - 다른 모델은 at을 보지 않는다 */
export function llmCostPer1k(model: string, at: Date = new Date()): { input: number; output: number } {
  if (model === 'gemini-4-argon' && at.getTime() >= GEMINI_4_ARGON_PRICE_CHANGE_AT) return GEMINI_4_ARGON_PRICE_AFTER
  const info = lookupLlmModel(model)
  if (info) return info.costPer1k
  const all = Object.values(LLM_MODELS).map((m) => m.costPer1k)
  return { input: Math.max(...all.map((c) => c.input)), output: Math.max(...all.map((c) => c.output)) }
}
