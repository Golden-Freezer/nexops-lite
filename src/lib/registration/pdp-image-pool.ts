/**
 * images 단계 동시 실행 도구(속도 개선 1차, 2026-10-28) — 상한 N의 작업 풀과 run 안 지출 예약.
 * 실행기와 무관하다(Vercel run 라우트·Railway 작업자 공용) — 요청 객체나 플랫폼 시간 상한을 모른다.
 */

import { checkMonthlyBudget } from '@/lib/agents/budget'
import type { CostPool } from '@/lib/agents/types'
import { ALL_IMAGE_MODELS, estimateImageCostUsd, type ImageModel, type ImageQuality } from '@/lib/agents/image/types'
import { GATE_RESERVE_USD } from './job-cost-cap'

/** 제공자(OpenAI·Gemini) 동시 생성 상한 — NEXFIT은 12, 처음은 4(429 한도 미확인, planner 1차 권장) */
export const IMAGE_CONCURRENCY = 4
/** 로컬 백엔드(codex-image) — 실행기의 동시 2 상한(codex-image-backend.mjs)과 같게. 더 보내면 실행기 안에서 기다린다 */
export const LOCAL_IMAGE_CONCURRENCY = 2

export function imageConcurrencyOf(model: string): number {
  const info = ALL_IMAGE_MODELS.find((m) => m.id === model)
  return info?.provider === 'local' ? LOCAL_IMAGE_CONCURRENCY : IMAGE_CONCURRENCY
}

/**
 * 상한 limit으로 items를 돌린다. 끝나는 대로 다음 일을 꺼낸다(묶음 단위가 아니라 — 느린 한 건이 다른 칸을 붙잡지 않는다).
 * - ready(item): 지금 시작할 수 있는가(선행 일이 끝나야 하는 일은 false — 진행 중인 일이 끝나길 기다린다)
 * - canStart(item): 시간·지출이 남았는가. false면 더 시작하지 않는다(진행 중인 일은 끝까지 기다린다)
 * 시작하지 못한 일은 skipped로 돌려준다(다음 run 몫). items 순서가 시작 우선순위다.
 * run이 던지면 새 일을 더 시작하지 않고, 진행 중인 일이 모두 끝난 뒤 첫 오류를 던진다(끝난 일의 저장은 남는다).
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  options: { ready: (item: T) => boolean; canStart: (item: T) => boolean; run: (item: T) => Promise<void> }
): Promise<{ started: T[]; skipped: T[] }> {
  const queue = [...items]
  const started: T[] = []
  const active = new Set<Promise<void>>()
  let failure: { error: unknown } | null = null
  while (queue.length > 0 && !failure) {
    const index = active.size < limit ? queue.findIndex(options.ready) : -1
    if (index !== -1) {
      const item = queue[index]
      if (!options.canStart(item)) break
      queue.splice(index, 1)
      started.push(item)
      const task: Promise<void> = options
        .run(item)
        .catch((error: unknown) => {
          failure ??= { error }
        })
        .finally(() => active.delete(task))
      active.add(task)
      continue
    }
    // 상한이 찼거나 선행 일을 기다리는 중 — 하나가 끝나면 다시 고른다. 진행 중인 일이 없으면 더 기다릴 것이 없다
    if (active.size === 0) break
    await Promise.race(active)
  }
  await Promise.all(active)
  if (failure) throw (failure as { error: unknown }).error
  return { started, skipped: queue }
}

/** run 안 지출 예약 — 동시 호출이 한꺼번에 월 예산 검사를 통과하지 않게, 시작할 때마다 장당 단가를 미리 뺀다 */
export interface SpendGate {
  tryReserve(model: string, quality: ImageQuality): boolean
  /** 마지막으로 막힌 tryReserve의 까닭 — month = 월 한도(또는 예산 조회 실패), job = 잡당 비용 상한(점검 고침 5). 막힌 적 없으면 null */
  readonly lastBlock: 'month' | 'job' | null
  /** 월 예산을 읽지 못해 닫혔다(degraded·예외) — 막힌 까닭 글을 '한도 소진'과 가른다 */
  readonly degraded: boolean
}

/**
 * run 시작 때 월 예산을 한 번 읽어 남은 한도를 정한다(전역·에이전트 한도 중 작은 쪽). 생성 호출(generate.ts)의 호출마다
 * 검사는 그대로 남고, 이 예약은 그 검사가 같은 시점의 지출을 보고 함께 통과하는 경합만 막는다. 로컬 백엔드 모델은 구독
 * 한도라 예약하지 않는다. 한도가 소진됐으면 0(제공자 생성을 시작하지 않는다). 지출을 읽지 못하면(degraded·예외) 닫는다 —
 * 한도 0(점검 고침 5: 호출마다 실패 컷이 쌓여 대표 컷 실패로 잡이 죽지 않게, 시작하지 않은 일은 다음 run 몫으로 남는다).
 * 실패한 생성의 예약은 되돌리지 않는다(보수적).
 * jobHeadroomUsd(첫 생성 잡의 남은 몫, job-cost-cap)를 주면 컷마다 이미지 단가 + 게이트 몫(GATE_RESERVE_USD)을 그 몫에서도 뺀다.
 */
export async function createSpendGate(agentName: string, costPool?: CostPool, jobHeadroomUsd?: number): Promise<SpendGate> {
  let headroom = 0
  let degraded = false
  try {
    // 시험 잡은 시험 풀의 남은 한도로 예약한다
    const budget = await checkMonthlyBudget(agentName, undefined, costPool)
    if (budget.degraded) {
      degraded = true
      console.warn('[registration/pdp-image] 월 예산 조회 실패 — 이번 run은 제공자 이미지 생성을 시작하지 않음', { reason: budget.degradedReason })
    } else if (budget.allowed) {
      const global = budget.budgetUsd - budget.spentUsd
      const agent =
        budget.agentBudgetUsd != null && budget.agentSpentUsd != null
          ? budget.agentBudgetUsd - budget.agentSpentUsd
          : Number.POSITIVE_INFINITY
      headroom = Math.max(0, Math.min(global, agent))
    }
  } catch (e) {
    // 예산 모듈 자체가 실패 — 조회 실패와 같이 닫는다
    degraded = true
    console.warn('[registration/pdp-image] 월 예산 확인 예외 — 이번 run은 제공자 이미지 생성을 시작하지 않음', { error: e instanceof Error ? e.message : String(e) })
  }
  let jobLeft = jobHeadroomUsd ?? Number.POSITIVE_INFINITY
  let lastBlock: 'month' | 'job' | null = null
  return {
    degraded,
    get lastBlock() {
      return lastBlock
    },
    tryReserve(model, quality) {
      const info = ALL_IMAGE_MODELS.find((m) => m.id === model)
      if (info?.provider === 'local') return true
      const unit = estimateImageCostUsd(model as ImageModel, quality)
      if (unit > headroom) {
        lastBlock = 'month'
        return false
      }
      if (unit + GATE_RESERVE_USD > jobLeft) {
        lastBlock = 'job'
        return false
      }
      headroom -= unit
      jobLeft -= unit + GATE_RESERVE_USD
      return true
    },
  }
}
