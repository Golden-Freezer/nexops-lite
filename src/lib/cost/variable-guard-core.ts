/**
 * 월 변동비 300달러 가드 — 상수·층 판정·막힘 글(AX-PL-17 PR ②, 설계 3-1·3-2·11-5). 순수 함수만 둔다(DB·시계·스위치 의존 없음).
 *
 * 값은 코드 상수다(env 없음 — 규칙 [16] 값은 오너 결정 + PR 로만 바꾼다). 합계는 DB 함수(ax_variable_cost_total)가 한 곳에서 낸다 — 여기서는 더하지 않는다.
 * 층 차례(3-2 안 A): 시험·평가 잡 층을 먼저 보고, 그다음 상세페이지 API 이미지 층을 본다. 두 층은 같은 300 선이고 차례는 확인 순서·멈춤 기록으로만 남는다.
 */

/** 월 변동비 상한(USD) — 규칙 [16] */
export const VARIABLE_COST_CAP_USD = 300
/** 80% 알림선(USD) — 300 × 0.8 */
export const VARIABLE_COST_ALERT_USD = 240
/** 이 달(KST 'YYYY-MM')부터 판정한다 — 11월은 스위치가 켜져 있어도 판정하지 않는다 */
export const VARIABLE_COST_GUARD_FROM = '2026-12'
/** 등록 표(src/lib/switches/registry.ts)의 스위치 이름 */
export const VARIABLE_COST_GUARD_SWITCH = 'platform.variable_cost_guard'
/** 상세페이지 운영 이미지 호출의 사용량 기록 agent 값(pdp-image-stage.ts 와 같은 글자) */
export const PDP_IMAGE_GUARD_AGENT = 'registration/pdp-image'

export type VariableGuardLayer = 'test' | 'pdp_image'

/** 확인 차례 — 시험·평가 층이 먼저다(설계 11-5). 한 호출은 이 차례에서 처음 맞는 층 하나로 본다 */
export const VARIABLE_GUARD_LAYER_ORDER: readonly VariableGuardLayer[] = ['test', 'pdp_image']

function inLayer(layer: VariableGuardLayer, agentName: string | undefined, costPool: string | undefined): boolean {
  if (layer === 'test') return Boolean(costPool)
  return agentName === PDP_IMAGE_GUARD_AGENT
}

/** 이 호출이 가드 층인가 — 시험 풀(costPool)이 있으면 test, 상세페이지 운영 이미지 agent 면 pdp_image, 그 밖(넥시·AI 직원·소싱 판정 등)은 판정 없음(null) */
export function variableGuardLayerOf(agentName?: string, costPool?: string): VariableGuardLayer | null {
  for (const layer of VARIABLE_GUARD_LAYER_ORDER) if (inLayer(layer, agentName, costPool)) return layer
  return null
}

export type SwitchStateKind = 'enabled' | 'disabled' | 'unreadable'

/** 표 상태 글자 — env 아님, NON_ENV_ON_SITES 대신 지도(switchStateKind).
 * 스위치 읽기 상태 글자(on·off·table_missing·read_failed·unregistered)를 세 갈래로 가른다 — 켜짐·꺼짐 말고는 모두 '읽지 못함'(꺼짐과 다르게 다룬다, 설계 11-4). 모르는 글자도 읽지 못함 */
const SWITCH_STATE_KIND: Readonly<Record<string, SwitchStateKind>> = {
  on: 'enabled',
  off: 'disabled',
  table_missing: 'unreadable',
  read_failed: 'unreadable',
  unregistered: 'unreadable',
}

export function switchStateKind(state: string): SwitchStateKind {
  return Object.prototype.hasOwnProperty.call(SWITCH_STATE_KIND, state) ? SWITCH_STATE_KIND[state] : 'unreadable'
}

/** 판정 달인가 — 'YYYY-MM' 글자 비교(같은 길이·0 채움이라 사전순이 시간순이다) */
export function isVariableGuardMonth(monthKey: string): boolean {
  return monthKey >= VARIABLE_COST_GUARD_FROM
}

/** 바로 앞 달 'YYYY-MM' — 월 키가 꼴에 안 맞으면 null */
export function previousMonthKey(monthKey: string): string | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(monthKey)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  return month === 1 ? `${year - 1}-12` : `${match[1]}-${String(month - 1).padStart(2, '0')}`
}

/** KST 월 키 'YYYY-MM' — src/lib/agents/budget.ts currentMonthKey 와 같은 뜻(월 경계는 한국 시간 월초) */
export function kstMonthKeyOf(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 7)
}

/** KST 날짜 'YYYY-MM-DD' — 멈춤 기록의 하루 한 번 기준 */
export function kstDateOf(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
}

const LAYER_STOP_TEXT: Record<VariableGuardLayer, string> = {
  test: '시험·평가 잡 호출을 멈춥니다.',
  pdp_image: '상세페이지 API 이미지 생성을 멈춥니다.',
}

/** 가드가 만든 막힘의 글 — 가드 밖 막힘이면 null(호출처는 지금 글 그대로 쓴다) */
export function variableBlockMessage(status: {
  limitReason?: string
  spentUsd: number
  variableLayer?: VariableGuardLayer
  degradedReason?: string
}): string | null {
  if (status.limitReason === 'variable_cap') {
    return `월 변동비 상한 $${VARIABLE_COST_CAP_USD} 도달 — 이달 $${status.spentUsd.toFixed(2)}. ${LAYER_STOP_TEXT[status.variableLayer ?? 'test']}`
  }
  if (status.limitReason === 'variable_unreadable') {
    return `월 변동비 합계를 읽지 못해 시험·평가 호출을 멈춥니다(읽기가 돌아오면 다시 진행). 원인: ${(status.degradedReason ?? '알 수 없음').slice(0, 120)}`
  }
  return null
}
