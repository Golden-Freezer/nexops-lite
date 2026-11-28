/**
 * run 기한 안의 호출 시도(pdp-cost-time-followup, 통합 승인 공용 변경) — callAgent·callOpenAiChat이 `deadlineAt`을 받았을 때만 쓴다.
 * 시도 전마다 남은 시간을 보고 최소 시도 시간보다 적으면 더 부르지 않는다(null). 시도마다 시간 제한은 min(지정값, 남은 시간)이고,
 * 재시도 대기도 기한을 넘기지 않는다. 기한이 없으면 지정값 그대로다(동작 불변).
 * 쓰는 곳: 상세페이지 카피 단계 — run 상한(300초) 강제 종료 대신 '단계 생략 + 경고'로 끝나게(이미지 단계의 run 시간 예산과 같은 생각).
 */

/**
 * 이보다 적게 남으면 시도하지 않는다 — 응답을 받기 전에 끊길 시도로 과금만 하지 않게. 카피 콜은 수십 초(Stage 3 p50 13초·
 * Stage 1 21~31초)라 15초 미만 시도는 거의 시간 초과로 끝난다(검수 지적)
 */
export const DEADLINE_MIN_ATTEMPT_MS = 15_000
/** 로컬 Codex 한 단계가 여러 긴 호출을 끝낼 수 있게 보장하는 최소 run 창. */
export const LOCAL_CODEX_MIN_RUN_MS = 30 * 60_000

export const DEADLINE_EXHAUSTED_MESSAGE = 'run 시간 예산 소진 — 더 부르지 않습니다'

/** 짧은 공급자용 기한을 로컬 Codex 최소 창까지 늘린다. 기한이 없으면 그대로 둔다. */
export function localCodexDeadlineAt(
  deadlineAt: number | undefined,
  now = Date.now(),
): number | undefined {
  return deadlineAt === undefined ? undefined : Math.max(deadlineAt, now + LOCAL_CODEX_MIN_RUN_MS)
}

/** 이번 시도의 시간 제한 — 기한이 없으면 지정값, 남은 시간이 최소보다 적으면 null(부르지 않음) */
export function attemptTimeoutWithin(
  deadlineAt: number | undefined,
  timeoutMs: number,
  now = Date.now()
): number | null {
  if (deadlineAt === undefined) return timeoutMs
  const left = deadlineAt - now
  return left < DEADLINE_MIN_ATTEMPT_MS ? null : Math.min(timeoutMs, left)
}

/** 재시도 대기 — 기한이 없으면 지정값, 있으면 기한을 넘기지 않게 줄인다 */
export function backoffWithin(deadlineAt: number | undefined, waitMs: number, now = Date.now()): number {
  if (deadlineAt === undefined) return waitMs
  return Math.max(0, Math.min(waitMs, deadlineAt - now))
}

/** 기한으로 멈췄을 때의 실패 사유 — 앞선 시도가 있었으면 그 사유를 덧붙인다(원인을 잃지 않게) */
export function deadlineExhaustedMessage(attemptsMade: number, previous: string): string {
  return attemptsMade > 0 ? `${DEADLINE_EXHAUSTED_MESSAGE}(직전 시도: ${previous})` : DEADLINE_EXHAUSTED_MESSAGE
}
