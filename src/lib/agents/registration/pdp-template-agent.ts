/**
 * K 라인 선택 에이전트(M5) — 가이드라인·섹션 구성·템플릿 선택 3콜. 콜이 실패하면 코드가 정한 후보로 계속한다(잡 실패 아님, 사유를 돌려준다).
 * 조합은 templatelib/select-line.ts가 한다. 기본 off(`templatelib`)라 스위치를 켠 잡만 부른다.
 */

import { billedCostOf } from '../billed-usage'
import { pdpRoute, type PdpModelStage } from '@/lib/registration/pdp-model-routes'
import type { Concept } from '@/lib/registration/templatelib/concepts'
import { callLlm } from '../llm'
import type { RunContext } from '../types'
import {
  COMPOSE_SYSTEM,
  GUIDELINE_SYSTEM,
  SELECT_SYSTEM,
  buildComposePrompt,
  buildGuidelinePrompt,
  buildSelectPrompt,
  parseComposition,
  parseGuideline,
  parseSelection,
  type ComposeInput,
  type Guideline,
  type SelectSlot,
  type TemplatePick,
  type TemplateProductBrief,
} from './prompts/pdp-template-prompts'

/** 고르기만 하는 콜이라 짧다 */
const TIMEOUT_MS = 60_000
/** 새 배치 콜 시간(route.callTimeoutMs, R03 — K 계획 Opus medium 90초) — 없으면 지금 값 */
const timeoutOf = (stage: PdpModelStage): number => pdpRoute(stage).callTimeoutMs ?? TIMEOUT_MS

export interface StepOutcome<T> {
  value: T
  usedFallback: boolean
  error: string | null
  costUsd: number
}

/** 가이드라인 — 실패하면 후보 앞줄(카테고리에 맞는 컨셉을 상품 씨앗으로 섞은 순서)을 쓴다 */
export async function generateTemplateGuideline(
  input: { product: TemplateProductBrief; concepts: readonly Concept[] },
  runContext?: RunContext
): Promise<StepOutcome<Guideline>> {
  const allowed = new Set(input.concepts.map((c) => c.id))
  const result = await callLlm(
    pdpRoute('design/template-guideline'),
    {
      system: GUIDELINE_SYSTEM,
      messages: [{ role: 'user', content: buildGuidelinePrompt(input.product, input.concepts) }],
      timeoutMs: timeoutOf('design/template-guideline'),
      agentName: 'registration/pdp-template-guideline',
      runContext,
    },
    (text) => parseGuideline(text, allowed)
  )
  if (result.success) return { value: result.data, usedFallback: false, error: null, costUsd: billedCostOf(result) }
  console.warn('[registration/pdp-template] 가이드라인 실패 — 후보 앞줄 사용:', result.error.message)
  const [first, ...rest] = input.concepts
  return {
    value: {
      persona: input.product.persona ?? '',
      tone: '',
      concept: { id: first.id, reason: '' },
      alternatives: rest.slice(0, 2).map((c) => c.id),
    },
    usedFallback: true,
    error: result.error.message,
    costUsd: billedCostOf(result),
  }
}

/** 섹션 구성 — 실패하면 빈 목록을 돌려주고 호출자가 기본 구성을 쓴다 */
export async function composeTemplateSections(input: ComposeInput, runContext?: RunContext): Promise<StepOutcome<string[]>> {
  const allowed = new Set(input.open)
  const result = await callLlm(
    pdpRoute('design/template-compose'),
    {
      system: COMPOSE_SYSTEM,
      messages: [{ role: 'user', content: buildComposePrompt(input) }],
      timeoutMs: timeoutOf('design/template-compose'),
      agentName: 'registration/pdp-template-compose',
      runContext,
    },
    (text) => parseComposition(text, allowed)
  )
  if (result.success) return { value: result.data, usedFallback: false, error: null, costUsd: billedCostOf(result) }
  console.warn('[registration/pdp-template] 섹션 구성 실패 — 기본 구성 사용:', result.error.message)
  return { value: [], usedFallback: true, error: result.error.message, costUsd: billedCostOf(result) }
}

/** 템플릿 선택 — 실패하면 빈 목록을 돌려주고 자리마다 코드가 정한 첫 후보를 쓴다 */
export async function selectTemplatePicks(
  input: { product: TemplateProductBrief; guideline: Guideline; conceptName: string; slots: readonly SelectSlot[] },
  runContext?: RunContext
): Promise<StepOutcome<TemplatePick[]>> {
  const result = await callLlm(
    pdpRoute('design/template-select'),
    {
      system: SELECT_SYSTEM,
      messages: [{ role: 'user', content: buildSelectPrompt(input) }],
      timeoutMs: timeoutOf('design/template-select'),
      agentName: 'registration/pdp-template-select',
      runContext,
    },
    (text) => parseSelection(text, input.slots)
  )
  if (result.success) return { value: result.data, usedFallback: false, error: null, costUsd: billedCostOf(result) }
  console.warn('[registration/pdp-template] 템플릿 선택 실패 — 첫 후보 사용:', result.error.message)
  return { value: [], usedFallback: true, error: result.error.message, costUsd: billedCostOf(result) }
}
