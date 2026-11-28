/**
 * 잡당 비용 상한(점검 고침 5 · 하네스 R04, 오너 I4-2 2026-11-08) — 상세페이지 잡 하나가 첫 생성에서 쓸 수 있는 돈의 위쪽.
 * - 값: env PDP_JOB_COST_CAP_USD, 기본 $10. 12-01부터 Gemini Argon 단가가 2배여도 전부 API 평균 잡 약 $7.26(12-01 뒤 단가,
 *   11-30까지 약 $6.78 — R06 5차 교체 뒤는 $7.05·$6.57)이 걸리지 않게 둔 값이다(약 38% 여유). 처음 적은 $8.22는 Gemini 몫을 두 번
 *   더한 값이었다(하네스 결정 D2, 11-08). 운영·시험 잡 모두 같다.
 * - 기준: 실제 청구액 = job.cost_usd. 잡의 각 호출이 ai_usage_log에 남긴 cost_usd를 그대로 더한 값이고, 구독 호출(코덱스 구독 LLM·
 *   codex-image 로컬 백엔드)은 0원으로 기록된다. 구독 호출의 API 환산 비용(표기용)은 cost_usd에 더하지 않는다 — 더하면 상한이
 *   실제로 내지 않은 돈으로 막는다.
 * - 범위: 첫 생성 전체 — 잡이 처음 끝나기 전 모든 단계(합성 뒤에 붙을 첫 화면 심사·최종 검수 포함). 편집기 재생성(생성이 한 번 끝난
 *   잡에서 사용자가 누름 — section_images[].editorRegen 기록이 남는다)은 상한 밖이고 월 예산·호출마다 검사에 맡긴다.
 * - 넘으면: 이미지 앞 단계(분석~카피)는 바로 failed(페이지 재료가 없다). images는 남은 몫(상한 − run 시작 지출)으로 컷마다 이미지
 *   단가 + 게이트 몫을 예약하고, 막힌 컷을 실패 컷으로 정리한 뒤 페이지를 만든다(pdp-image-stage, section_plan.job_cost_cap 경고).
 *   compose는 돈을 쓰지 않는다. 합성 뒤 단계는 jobCostCapReached가 참이면 그 단계를 생략으로 기록하고 잡을 끝낸다(새 단계가 따른다).
 */

import type { PdpJobRow, PdpStep } from './pdp-state'

export const DEFAULT_JOB_COST_CAP_USD = 10
/**
 * 컷 한 장을 예약할 때 이미지 단가에 더하는 게이트 몫 — 게이트 호출은 예약에 따로 잡히지 않는다. 게이트 Argon high 1콜이
 * 지금 약 $0.020, 12-01 단가 2배 뒤 약 $0.041(5차 실측 입력 약 4.1k·출력 약 1.2k)이라 그 위로 둔다.
 */
export const GATE_RESERVE_USD = 0.05
/** 실패 컷 error 머리말 — cut-failures가 사유를 고른다 */
export const JOB_CAP_ERROR_PREFIX = '잡 비용 상한'
/** 상한에 닿으면 바로 멈추는 단계 — 이미지 앞(페이지 재료를 만드는 중이라 남은 몫으로 할 수 있는 일이 없다) */
const STOP_BEFORE_IMAGES: ReadonlySet<PdpStep> = new Set(['pending', 'analysis', 'research', 'design', 'copywriting'])

/** env 값(달러) — 비었거나 숫자가 아니거나 0 이하이면 기본값 */
export function jobCostCapUsd(env: Record<string, string | undefined> = process.env): number {
  const raw = env.PDP_JOB_COST_CAP_USD?.trim()
  const value = raw ? Number(raw) : NaN
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_JOB_COST_CAP_USD
}

/**
 * 첫 생성 중인가 — 편집기 재생성 기록이 하나도 없는 잡. 편집기 재생성은 생성이 한 번 끝난 잡(카피 최종본·최종 HTML 있음)에서만
 * 열리고(pdp-image-regen-request) 그 컷에 editorRegen을 남기므로, 최종 HTML이 생긴 뒤 이어지는 단계(첫 화면 심사·최종 검수)도
 * 첫 생성으로 센다.
 */
export function isFirstGeneration(job: Pick<PdpJobRow, 'section_images'>): boolean {
  return !(job.section_images ?? []).some((e) => e.editorRegen)
}

/** 첫 생성 잡의 실제 청구액이 상한에 닿았나 — 닿았으면 상한·지출, 아니면(또는 첫 생성이 아니면) null */
export function jobCostCapReached(
  job: Pick<PdpJobRow, 'section_images' | 'cost_usd'>,
  capUsd = jobCostCapUsd()
): { capUsd: number; spentUsd: number } | null {
  if (!isFirstGeneration(job)) return null
  const spentUsd = Number(job.cost_usd ?? 0)
  return spentUsd >= capUsd ? { capUsd, spentUsd } : null
}

/** 이미지 단계에 줄 잡 남은 몫 — 첫 생성이 아니면 상한 없음(undefined) */
export function jobCostHeadroomUsd(job: Pick<PdpJobRow, 'section_images' | 'cost_usd'>, capUsd = jobCostCapUsd()): number | undefined {
  if (!isFirstGeneration(job)) return undefined
  return Math.max(0, capUsd - Number(job.cost_usd ?? 0))
}

/** 단계 시작에서 바로 멈출 잡인가 — 이미지 앞 단계만. images는 남은 몫 예약으로, compose는 돈을 쓰지 않아 여기서 막지 않는다 */
export function jobCostCapStop(
  job: Pick<PdpJobRow, 'section_images' | 'cost_usd'>,
  step: PdpStep,
  capUsd = jobCostCapUsd()
): string | null {
  if (!STOP_BEFORE_IMAGES.has(step)) return null
  const reached = jobCostCapReached(job, capUsd)
  if (!reached) return null
  return `${JOB_CAP_ERROR_PREFIX} $${capUsd} 도달 — 이 잡 지출 $${reached.spentUsd.toFixed(2)}. 잡을 멈춥니다.`
}

/** 이미지 단계에서 남은 몫이 모자라 만들지 않은 컷의 error 글 */
export function jobCapCutError(capUsd = jobCostCapUsd()): string {
  return `${JOB_CAP_ERROR_PREFIX}($${capUsd})으로 만들지 않음`
}

/** 잡 기록(section_plan.job_cost_cap, 무DDL JSONB 새 키) — 상한에 닿아 이미지 단계가 컷을 정리했을 때의 경고 */
export interface JobCostCapRecord {
  capUsd: number
  /** 그 run 시작 때 이 잡의 실제 청구액 */
  spentUsd: number
  /** 만들지 않은(정리한) 컷 섹션 */
  sections: string[]
  at: string
}
