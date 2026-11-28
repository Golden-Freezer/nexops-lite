/**
 * 새 단계 5개 연결(하네스 R10) — 새 배치(model_batch 'new') + newstages 기록 잡의 첫 생성에서만 돈다. 꺼진 잡은 여기 함수가 모두
 * false·null을 돌려 단계·프롬프트·기록이 바이트까지 같다. 단계 모듈(입력·프롬프트·파서·기록 모양)은 new-stages/(R10a).
 * 자리(pdp-pipeline·pdp-image-stage가 부른다):
 * - 기획: 리서치 뒤·설계 앞 — 리서치 결과가 있고 기획 기록이 없으면 research 단계를 한 번 더(기획만, run 하나)
 * - 사실 감사: 카피 뒤(카피 최종본, copywriting 단계를 한 번 더) · K 칸 카피 뒤(이미지 단계 첫 run들, K 계획 기록 뒤)
 * - 연출 감독: 헌장·식별 카드 뒤 첫 생성 전(이미지 단계) — 컷 지시 뒤에 한 줄을 덧붙인다(directorLineFor)
 * - 첫 화면 심사·최종 검수: compose 안, 합성 뒤 done 전. 첫 화면 심사는 파이프라인에 렌더러가 없어 늘 '생략'(web_no_renderer)
 * 결과는 기존 JSONB 새 키(new-stages NEW_STAGE_RESULT_KEYS)이고 컬럼을 통째로 바꾸지 않게 지금 값에 키만 더한다.
 * 실패는 단계를 막지 않는다(failed 기록 + 다음 단계로) — 사실 감사·최종 검수는 기록+경고만, 고치지 않는다.
 * 합성 뒤 단계는 잡 비용 상한(R04)에 닿았으면 cost_cap 생략으로 기록한다. 편집기 재생성 잡(isFirstGeneration 아님)에서는 돌리지 않는다.
 */

import { callLlm } from '@/lib/agents/llm'
import type { RunContext } from '@/lib/agents/types'
import { hasEnrichmentFeature } from './enrichment-switch'
import { isFirstGeneration, jobCostCapReached } from './job-cost-cap'
import { NEW_STAGE_ROUTE_NAMES, skippedRecord, type NewStage, type NewStageCallOptions, type NewStageDeps, type NewStageRecord } from './new-stages/common'
import { directorInputOf, directorLineOf, directorShotsOf, runDirector, type DirectorPlan } from './new-stages/director'
import { factAuditInputOf, runFactAudit, type FactAudit } from './new-stages/fact-audit'
import { finalReviewInputOf, runFinalReview, type FinalReview } from './new-stages/final-review'
import { firstScreenSkippedForWeb, type FirstScreenVerdict } from './new-stages/first-screen'
import { pagePlanInputOf, runPagePlan, type PagePlan } from './new-stages/plan'
import { copyScreenLines, designcutScreenLines, slotFactAuditLines, type ScreenLine } from './new-stages/screen-lines'
import { PDP_NEW_STAGE_ROUTES, pdpNewStageRoute } from './pdp-model-routes'
import type { DesignPrompts, PdpJobRow } from './pdp-state'

/** 운영 단계 deps — route는 새 단계 표(새 배치만), 호출은 모델 계층 */
export const PIPELINE_NEW_STAGE_DEPS: NewStageDeps = { routeOf: (name) => pdpNewStageRoute(name), callLlm }

type Job = Pick<PdpJobRow, 'analysis' | 'model_batch' | 'section_images'>

/** 이 잡에서 새 단계를 돌리는가 — newstages 기록 + 새 배치 + 첫 생성(편집기 재생성 기록 없음) */
export function newStagesActive(job: Job): boolean {
  return job.model_batch === 'new' && hasEnrichmentFeature(job.analysis, 'newstages') && isFirstGeneration(job)
}

/** 기획이 남았나 — 리서치가 끝났고 기획 기록이 없다 */
export function needsPagePlan(job: Job & Pick<PdpJobRow, 'research_result'>): boolean {
  const research = job.research_result ?? {}
  return Object.keys(research).length > 0 && research.page_plan === undefined && newStagesActive(job)
}

/** 카피 뒤 사실 감사가 남았나 — 카피 최종본이 있고 감사 기록이 없다 */
export function needsCopyFactAudit(job: Job & Pick<PdpJobRow, 'copy_sections'>): boolean {
  return Boolean(job.copy_sections?.final) && job.copy_sections.fact_audit === undefined && newStagesActive(job)
}

/**
 * 콜 시간·재시도는 새 단계 표 값, 기한은 run 시작 기준(부르는 쪽). 표 값만 읽는다 — 실제 호출의 route는 routeOf가 잡 배치를 확인하고
 * 푼다(새 배치가 아닌 문맥이면 던진다)
 */
function callOptionsOf(stage: NewStage, runContext: RunContext, deadlineAt: number): NewStageCallOptions {
  const route = PDP_NEW_STAGE_ROUTES[NEW_STAGE_ROUTE_NAMES[stage]]
  return { timeoutMs: route.callTimeoutMs, maxRetries: route.callMaxRetries, deadlineAt, runContext }
}

/** 이 단계 콜을 이 run 안에 끝낼 수 있나 — 콜 시간 + 저장 여유 20초가 남은 시간 안 */
export function newStageFits(stage: NewStage, deadlineAt: number, now = Date.now()): boolean {
  return deadlineAt - now >= PDP_NEW_STAGE_ROUTES[NEW_STAGE_ROUTE_NAMES[stage]].callTimeoutMs + 20_000
}

export function recordCost(record: NewStageRecord<unknown>): number {
  return record.status === 'skipped' ? 0 : record.costUsd
}

/** 경고·실패를 로그로 — 기록은 잡 JSONB에 남는다 */
export function logNewStage(jobId: string, record: NewStageRecord<unknown>): void {
  const head = `[pdp/new-stages] 잡 ${jobId.slice(0, 8)} ${record.stage}`
  if (record.status === 'failed') console.warn(`${head} 실패(${record.failure.kind}): ${record.failure.message.slice(0, 200)}`)
  else if (record.status === 'done' && record.warnings.length > 0) console.warn(`${head} 경고: ${record.warnings.join(' | ').slice(0, 500)}`)
}

export async function runPagePlanStage(job: PdpJobRow, runContext: RunContext, deadlineAt: number): Promise<NewStageRecord<PagePlan>> {
  return runPagePlan(pagePlanInputOf(job), PIPELINE_NEW_STAGE_DEPS, callOptionsOf('plan', runContext, deadlineAt))
}

async function factAuditOf(job: PdpJobRow, lines: readonly ScreenLine[], runContext: RunContext, deadlineAt: number) {
  return runFactAudit(factAuditInputOf(job, lines), PIPELINE_NEW_STAGE_DEPS, callOptionsOf('factAudit', runContext, deadlineAt))
}

/** 카피 뒤 사실 감사 — 카피 최종본의 화면 글 */
export function runCopyFactAuditStage(job: PdpJobRow, runContext: RunContext, deadlineAt: number): Promise<NewStageRecord<FactAudit>> {
  return factAuditOf(job, copyScreenLines(job.copy_sections.final), runContext, deadlineAt)
}

/** K 칸 카피 뒤 사실 감사가 남았나 — K 계획(디자인 컷 계획)이 기록됐고 감사 기록이 없다 */
export function needsSlotFactAudit(job: PdpJobRow): boolean {
  return Boolean(job.section_plan?.designcut) && job.section_plan.kslot_fact_audit === undefined && newStagesActive(job)
}

/**
 * K 칸 카피 뒤 사실 감사 — 디자인 컷 계획의 칸 글(K 라인)에서 입력 칸(판매자 입력을 그대로 옮긴 칸)을 뺀 것(J47). 칸 글이 없으면(옛 디자인 컷·
 * 입력 칸뿐) no_input 생략
 */
export function runSlotFactAuditStage(job: PdpJobRow, runContext: RunContext, deadlineAt: number): Promise<NewStageRecord<FactAudit>> {
  return factAuditOf(job, slotFactAuditLines(job.section_plan.designcut), runContext, deadlineAt)
}

/** 연출 감독이 남았나 — 감독 기록이 없다(헌장·식별 카드는 부르는 쪽이 먼저 정한다) */
export function needsDirector(job: PdpJobRow, designPrompts: DesignPrompts): boolean {
  return designPrompts.director === undefined && newStagesActive(job)
}

/** 연출 감독 — K 계획 컷(대표 컷 말고), 헌장·식별 카드는 이 run이 정한 값 */
export function runDirectorStage(
  job: PdpJobRow,
  designPrompts: DesignPrompts,
  runContext: RunContext,
  deadlineAt: number,
): Promise<NewStageRecord<DirectorPlan>> {
  const input = directorInputOf({ spec_sheet: job.spec_sheet, design_prompts: designPrompts }, directorShotsOf(job.section_plan.templatelib))
  return runDirector(input, PIPELINE_NEW_STAGE_DEPS, callOptionsOf('director', runContext, deadlineAt))
}

/**
 * 컷 지시 뒤에 덧붙일 감독 한 줄 — 감독이 끝난(done) 잡의 지시가 있는 컷만. 그 밖(꺼진 잡 포함)은 null = 지시 그대로.
 * lightSetOnly는 상품 없는 컷(J49) — 컷별 지시 문장 없이 빛·세트만(directorLineOf)
 */
export function directorLineFor(designPrompts: DesignPrompts | null | undefined, key: string, options: { lightSetOnly?: boolean } = {}): string | null {
  const record = designPrompts?.director
  return record?.status === 'done' ? directorLineOf(record.result, key, options) : null
}

/** 나가는 화면 글 — K 라인은 디자인 컷 칸 글, 그 밖은 카피 최종본 */
export function finalScreenLinesOf(job: PdpJobRow): ScreenLine[] {
  const slots = designcutScreenLines(job.section_plan?.designcut)
  return slots.length > 0 ? slots : copyScreenLines(job.copy_sections?.final)
}

export interface ComposeReviewRecords {
  first_screen: NewStageRecord<FirstScreenVerdict>
  final_review: NewStageRecord<FinalReview>
  costUsd: number
}

/**
 * 합성 뒤 done 전 — 켠 잡만(아니면 null). 이미 기록이 있으면 그대로 둔다(다시 부르지 않는다). 첫 화면 심사는 렌더러가 없어 늘 생략,
 * 잡 비용 상한에 닿았으면 둘 다 cost_cap 생략
 */
export async function runComposeReviewStages(job: PdpJobRow, runContext: RunContext, deadlineAt: number): Promise<ComposeReviewRecords | null> {
  if (job.model_batch !== 'new' || !hasEnrichmentFeature(job.analysis, 'newstages')) return null
  const plan = job.section_plan ?? {}
  if (plan.first_screen && plan.final_review) return null
  const skipReason = !isFirstGeneration(job) ? 'not_first_generation' : jobCostCapReached(job) ? 'cost_cap' : null
  const first_screen = plan.first_screen ?? (skipReason ? skippedRecord<FirstScreenVerdict>('firstScreen', skipReason) : firstScreenSkippedForWeb())
  const final_review =
    plan.final_review ??
    (skipReason
      ? skippedRecord<FinalReview>('finalReview', skipReason)
      : await runFinalReview(finalReviewInputOf(job, finalScreenLinesOf(job)), PIPELINE_NEW_STAGE_DEPS, callOptionsOf('finalReview', runContext, deadlineAt)))
  return { first_screen, final_review, costUsd: plan.final_review ? 0 : recordCost(final_review) }
}
