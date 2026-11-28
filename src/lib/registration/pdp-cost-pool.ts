// 상세페이지 잡의 예산 풀 — 시험 잡(cost_pool='test')의 호출은 시험 풀(pdp-test)로 기록·판정한다(오너 지시 10-31).
// pdp-jobs.ts와 따로 둔다: 잡 저장소를 모의하는 시험들이 이 도우미까지 대신 만들 필요가 없게.

import type { CostPool, RunContext } from '@/lib/agents/types'
import type { PdpJobRow } from './pdp-state'

/** 잡의 호출 사용량 풀 — 시험 잡은 ai_usage_log.cost_pool='pdp-test'로 남고 시험 풀 상한으로 판정한다 */
export function usageCostPoolOf(job: Pick<PdpJobRow, 'cost_pool'>): CostPool | undefined {
  return job.cost_pool === 'test' ? 'pdp-test' : undefined
}

/** runContext에 펼쳐 넣는 풀 조각 — 운영 잡은 빈 객체(지금과 같은 runContext) */
export function costPoolContext(job: Pick<PdpJobRow, 'cost_pool'>): Pick<RunContext, 'costPool'> {
  const costPool = usageCostPoolOf(job)
  return costPool ? { costPool } : {}
}

/**
 * 파이프라인 runContext 조각 — 시험 잡은 풀 + run_id=잡 ID(ai_usage_log.run_id, 외래 키 없음·색인 있음, 새 DDL 없음). 병렬 실행에서 시간 창이
 * 겹쳐도 콜을 잡별로 나눈다(K 라인 M2). 구독 표지 잡(R13)은 운영 잡이어도 run_id=잡 ID — 구독 콜(stage 끝 #claude-cli·#codex)과 API 잇기 콜
 * (#sub→api)을 잡과 묶는다(R12 기록). 그 밖의 운영 잡은 지금과 같은 빈 객체다
 */
export function jobUsageContext(
  job: Pick<PdpJobRow, 'id' | 'cost_pool' | 'model_backend'>
): Pick<RunContext, 'costPool' | 'runId'> {
  const costPool = usageCostPoolOf(job)
  if (costPool) return { costPool, runId: job.id }
  return job.model_backend === 'subscription' ? { runId: job.id } : {}
}
