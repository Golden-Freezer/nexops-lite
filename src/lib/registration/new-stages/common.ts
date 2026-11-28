/**
 * 새 단계 5개(하네스 R10a — 기획·사실 감사·연출 감독·첫 화면 심사·최종 검수) 공통: route 이름·결과 키·기록 모양·엄격 파서·호출기.
 * 파이프라인·route 표·화면 어디서도 아직 부르지 않는다 — 새 배치 연결(스위치·자리·run 기한·잡 비용 상한)은 R10이 한다.
 * 모델·등급은 여기 두지 않는다. 부르는 쪽이 route 이름으로 자기 표에서 route를 풀어 넘긴다(값은 R03 새 배치 표·R06 확정).
 * 파서는 빈 답·잘림·형식 오류를 실패로 돌려준다(조용한 통과 없음). 사실 감사·최종 검수는 기록+경고만 — 글을 고치는 함수는 없다.
 */

import { escapeRawControlsInStrings } from '@/lib/agents/registration/llm-json'
import type { LlmRequest, LlmRoute } from '@/lib/agents/llm/types'
import type { AgentError, AgentOutput, RunContext } from '@/lib/agents/types'

/** route 이름 — 부르는 쪽 표(R03 새 배치 표)의 키가 된다. 지금 표(PDP_MODEL_ROUTES)에는 없다 */
export const NEW_STAGE_ROUTE_NAMES = {
  plan: 'research/page-plan',
  factAudit: 'copy/fact-audit',
  director: 'images/director',
  firstScreen: 'compose/first-screen',
  finalReview: 'compose/final-review',
} as const

export type NewStage = keyof typeof NEW_STAGE_ROUTE_NAMES
export type NewStageRouteName = (typeof NEW_STAGE_ROUTE_NAMES)[NewStage]

/** 사용량 기록(ai_usage_log)·월 예산의 호출 주체 */
export const NEW_STAGE_AGENT_NAMES: Readonly<Record<NewStage, string>> = {
  plan: 'registration/pdp-page-plan',
  factAudit: 'registration/pdp-fact-audit',
  director: 'registration/pdp-director',
  firstScreen: 'registration/pdp-first-screen',
  finalReview: 'registration/pdp-final-review',
}

/**
 * 결과 키 — 기존 pdp_jobs JSONB 컬럼 안의 새 키(DDL 없음). 사실 감사는 자리가 둘이다(카피 뒤 = 카피 최종본, K 칸 카피 뒤 = 칸 글).
 * 쓰는 쪽(R10)은 컬럼을 통째로 바꾸지 말고 이 키만 합친다 — 단계가 컬럼을 다시 쓰면 앞 기록이 사라진다
 */
export const NEW_STAGE_RESULT_KEYS = {
  plan: { column: 'research_result', key: 'page_plan' },
  factAudit: { column: 'copy_sections', key: 'fact_audit' },
  factAuditSlots: { column: 'section_plan', key: 'kslot_fact_audit' },
  director: { column: 'design_prompts', key: 'director' },
  firstScreen: { column: 'section_plan', key: 'first_screen' },
  finalReview: { column: 'section_plan', key: 'final_review' },
} as const

export type NewStageFailureKind = 'empty' | 'truncated' | 'format' | 'api' | 'timeout' | 'budget'

/**
 * 생략 사유 — web_no_renderer: 웹 잡은 운영 렌더러가 없어 첫 화면을 찍지 못한다(I4-4) · cost_cap: 잡 비용 상한(R04 계약) ·
 * not_first_generation: 편집기 재생성(첫 생성에서만 돈다) · no_input: 감사·검수할 글이나 컷이 없다
 */
export type NewStageSkipReason = 'web_no_renderer' | 'cost_cap' | 'not_first_generation' | 'no_input'

/** 어떤 route로 돌았는가 — 표에서 풀린 값을 그대로 적는다(코드에 박은 값이 아니다) */
export interface NewStageRouteTrace {
  name: NewStageRouteName
  model: string
  effort: string | null
  maxTokens: number
  backend: string
}

export type NewStageRecord<T> =
  | {
      version: 1
      stage: NewStage
      status: 'done'
      route: NewStageRouteTrace
      result: T
      /** 형식은 맞지만 규칙에 어긋난 곳·감사가 찾은 것 — 기록만 하고 고치지 않는다 */
      warnings: string[]
      /** 과금된 모든 시도의 합(실패·잘린 시도 포함, R11b) */
      costUsd: number
      durationMs: number
      /** 나눠 부른 콜 수 — 둘 이상일 때만(사실 감사 나눠 부르기, R11b). 없으면 콜 하나 */
      calls?: number
    }
  | {
      version: 1
      stage: NewStage
      status: 'failed'
      route: NewStageRouteTrace
      failure: { kind: NewStageFailureKind; message: string }
      /** 실패·잘린 시도도 과금된 값을 남긴다(R11b — 전에는 0) */
      costUsd: number
      durationMs: number
      calls?: number
    }
  | { version: 1; stage: NewStage; status: 'skipped'; reason: NewStageSkipReason }

export function skippedRecord<T>(stage: NewStage, reason: NewStageSkipReason): NewStageRecord<T> {
  return { version: 1, stage, status: 'skipped', reason }
}

// ─── 엄격 파서 ───

type ParseKind = 'empty' | 'truncated' | 'format'

/** 파서 실패 표지 — callAgent가 오류를 글로만 넘기므로(stage 'parse') 앞머리 글로 종류를 되찾는다 */
const PARSE_TAGS: Readonly<Record<ParseKind, string>> = { empty: '[빈 답]', truncated: '[잘림]', format: '[형식 오류]' }

export function newStageParseError(kind: ParseKind, message: string): Error {
  return new Error(`${PARSE_TAGS[kind]} ${message}`)
}

/** 코드 울타리(```json … ```)만 벗긴다. 닫는 울타리가 없으면 여는 것만 벗긴다(잘린 답은 괄호 검사가 잡는다) */
function stripFence(text: string): string {
  const t = text.trim()
  if (!t.startsWith('```')) return t
  const open = t.replace(/^```[a-zA-Z]*\s*/, '')
  return open.endsWith('```') ? open.slice(0, -3).trim() : open.trim()
}

/** 문자열 밖 괄호 깊이 — 끝에서 문자열이 열려 있거나 괄호가 남으면 잘린 답이다 */
function unclosed(body: string): boolean {
  let depth = 0
  let inString = false
  let escape = false
  for (const c of body) {
    if (escape) escape = false
    else if (inString && c === '\\') escape = true
    else if (c === '"') inString = !inString
    else if (!inString && (c === '{' || c === '[')) depth++
    else if (!inString && (c === '}' || c === ']')) depth--
  }
  return inString || depth > 0
}

/**
 * JSON 객체 하나만 받는다 — 빈 답·잘린 답(괄호가 닫히지 않음)·앞뒤 다른 글·객체가 아닌 값은 모두 던진다.
 * 관대한 parseLlmJson(첫 { 부터 찾아 읽기)과 달리 앞이나 뒤에 붙은 글을 버리지 않는다. 문자열 안 날 줄바꿈만 한 번 고쳐 읽는다
 */
export function parseStrictJsonObject(text: string): Record<string, unknown> {
  const body = stripFence(String(text ?? ''))
  if (!body) throw newStageParseError('empty', '빈 답입니다')
  if (!body.startsWith('{')) throw newStageParseError('format', 'JSON 객체로 시작하지 않습니다')
  if (unclosed(body)) throw newStageParseError('truncated', '괄호가 닫히지 않았습니다(출력 상한에서 잘린 답)')
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    try {
      value = JSON.parse(escapeRawControlsInStrings(body))
    } catch (error) {
      throw newStageParseError('format', `JSON이 아닙니다 — ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!isRecord(value)) throw newStageParseError('format', 'JSON 객체가 아닙니다')
  return value
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ─── 칸 읽기 — 없거나 틀린 모양이면 형식 오류로 던진다 ───

export const formatError = (path: string, want: string) => newStageParseError('format', `${path}: ${want}이어야 합니다`)

export function reqObject(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw formatError(path, '객체')
  return value
}

export function reqString(o: Record<string, unknown>, key: string, path: string, opts: { nonEmpty?: boolean } = {}): string {
  const v = o[key]
  if (typeof v !== 'string') throw formatError(`${path}.${key}`, '문자열')
  if (opts.nonEmpty && !v.trim()) throw formatError(`${path}.${key}`, '빈 글이 아닌 문자열')
  return v
}

export function reqBoolean(o: Record<string, unknown>, key: string, path: string): boolean {
  const v = o[key]
  if (typeof v !== 'boolean') throw formatError(`${path}.${key}`, 'true/false')
  return v
}

export function reqNumber(o: Record<string, unknown>, key: string, path: string): number {
  const v = o[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) throw formatError(`${path}.${key}`, '숫자')
  return v
}

export function reqEnum<T extends string>(o: Record<string, unknown>, key: string, values: readonly T[], path: string): T {
  const v = o[key]
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) throw formatError(`${path}.${key}`, values.join('|'))
  return v as T
}

export function reqArray(o: Record<string, unknown>, key: string, path: string): unknown[] {
  const v = o[key]
  if (!Array.isArray(v)) throw formatError(`${path}.${key}`, '배열')
  return v
}

export function reqStringArray(o: Record<string, unknown>, key: string, path: string): string[] {
  return reqArray(o, key, path).map((v, i) => {
    if (typeof v !== 'string') throw formatError(`${path}.${key}[${i}]`, '문자열')
    return v
  })
}

// ─── 호출 ───

/** callLlm과 같은 서명 — 이 모듈은 공급자를 끌어오지 않고 부르는 쪽이 넘긴다 */
export type CallLlmFn = <T>(route: LlmRoute, request: LlmRequest, parser: (text: string) => T) => Promise<AgentOutput<T>>

export interface NewStageDeps {
  /** route 이름 → route(부르는 쪽 표). 표에 없는 이름이면 부르는 쪽이 던진다(설정 오류를 조용히 넘기지 않는다) */
  routeOf: (name: NewStageRouteName) => LlmRoute
  callLlm: CallLlmFn
}

/** 콜 시간·재시도·run 기한은 부르는 쪽이 정한다(R10: run 300초 안) */
export interface NewStageCallOptions {
  timeoutMs: number
  maxRetries: number
  deadlineAt?: number
  runContext?: RunContext
}

export function failureOf(error: AgentError): { kind: NewStageFailureKind; message: string } {
  const { message } = error
  if (error.stage !== 'parse') return { kind: error.stage, message }
  if (error.stopReason === 'max_tokens' || message.startsWith(PARSE_TAGS.truncated)) return { kind: 'truncated', message }
  if (message.startsWith(PARSE_TAGS.empty) || message.startsWith('빈 응답입니다')) return { kind: 'empty', message }
  return { kind: 'format', message }
}

function traceOf(name: NewStageRouteName, route: LlmRoute): NewStageRouteTrace {
  return { name, model: route.model, effort: route.effort ?? null, maxTokens: route.maxTokens, backend: route.backend ?? 'api' }
}

/** 과금된 값 — 앞선 실패·잘린 시도까지 합친 spent가 있으면 그것, 없으면 usage(첫 시도에 끝났거나 과금 전에 막힘) */
export const spentCostOf = (output: { usage: { cost: number }; spent?: { cost: number } }): number => output.spent?.cost ?? output.usage.cost

/**
 * 단계 콜 하나 — route를 이름으로 풀고, 파서가 받은 결과에 규칙 검사(check)를 돌려 경고로 붙인다.
 * 잘린 답은 같은 상한·같은 입력으로 다시 부르지 않는다(retryTruncated false, R11b — 새 단계 route는 모두 잘림 감지). 비용은 실패·잘린 시도를 포함한다
 */
export async function runNewStageCall<T>(
  spec: {
    stage: NewStage
    system: string
    content: LlmRequest['messages'][number]['content']
    parse: (text: string) => T
    check: (result: T) => string[]
  },
  deps: NewStageDeps,
  options: NewStageCallOptions,
): Promise<NewStageRecord<T>> {
  const name = NEW_STAGE_ROUTE_NAMES[spec.stage]
  const route = deps.routeOf(name)
  const result = await deps.callLlm(
    route,
    {
      system: spec.system,
      messages: [{ role: 'user', content: spec.content }],
      agentName: NEW_STAGE_AGENT_NAMES[spec.stage],
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      retryTruncated: false,
      ...(options.deadlineAt !== undefined ? { deadlineAt: options.deadlineAt } : {}),
      ...(options.runContext ? { runContext: options.runContext } : {}),
    },
    spec.parse,
  )
  const base = { version: 1 as const, stage: spec.stage, route: traceOf(name, route), costUsd: spentCostOf(result), durationMs: result.duration }
  if (!result.success) return { ...base, status: 'failed', failure: failureOf(result.error) }
  return { ...base, status: 'done', result: result.data, warnings: spec.check(result.data) }
}
