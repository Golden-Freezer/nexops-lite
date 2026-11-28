/**
 * PDP 6단계 파이프라인 상태기계 — NEXFIT AutoPDP service run() 이식(run 분할 실행판, §6.3).
 *
 * run 1회 = 1단계: analysis → research → design(2콜) → copywriting(+유사도 게이트) → images(§9.1 ③
 * 별도 서브분할, pdp-image-stage.ts 소관) → compose → done. 각 단계는 산출을 JSONB에 저장하고
 * current_step·progress를 전진시킨 뒤 반환한다.
 *
 * 재개 규칙: current_step 컬럼을 신뢰하지 않고 **JSONB 산출물의 존재 여부**로 다음 실행 단계를
 * 판정한다(resolveStepToRun) — 실패 잡이 current_step='failed'로 멈춰도 "어느 단계까지 완료됐는지"는
 * 산출물 자체가 증언하므로 별도 "실패 시점" 컬럼 없이 그 단계부터 정확히 재개된다.
 */

import { billedCostOf } from '@/lib/agents/billed-usage'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import { collectSubscriptionFallbacks, type SubscriptionFallbackRecord } from '@/lib/agents/llm/subscription-fallback'
import { checkMonthlyBudget } from '@/lib/agents/budget'
import type { RunContext } from '@/lib/agents/types'
import { runPdpAnalysis } from '@/lib/agents/registration/pdp-analysis-agent'
import { specWithDetectedExempt } from './product-info-rows'
import { runPdpResearch } from '@/lib/agents/registration/pdp-research-agent'
import { planPdpSections, generatePdpDesignPrompts, skippedSectionPlan } from '@/lib/agents/registration/pdp-design-agent'
import { runPdpCopywriting } from '@/lib/agents/registration/pdp-copy-agent'
import { regenerateCopySections } from '@/lib/agents/registration/pdp-copy-section-regen'
import { buildCopyGroundingBlock, getCorpusVersion as getCorpusVersionV1 } from './corpus'
import { getCorpusVersion as getCorpusVersionV2 } from './corpus-v2'
import {
  buildAgeBanDirective,
  buildAgeComplianceCopyBlock,
  checkAgeCompliance,
  isAgeRestricted,
  stripChildReviewHighlights,
} from './compliance-gate'
import { attachQualityReport } from './internalized/trust-gate'
import { designcutEnabled } from './internalized/designcut-plan'
import { analysisForPrompt, hasEnrichmentFeature, isHostedPdpEnv } from './enrichment-switch'
import {
  analysisWithEnrichment,
  applyDesignSkeleton,
  audienceOf,
  resolveComposeTrackI,
  resolveDesignSkeleton,
  recordedCopyInputs,
  resolveClaimGuardBlock,
  resolveInternalizedCopyBlock,
  usesEnrichedMapping,
  withAudienceStageSpec,
  withReviewFaq,
} from './pdp-enrichment-stage'
import { buildParentProxyCopyBlock, buildParentProxyRewriteDirective, findChildUseLines } from './parent-proxy-copy'
import { measureEditorBuild } from './quality-render-stats'
import {
  competitorEchoGuard,
  competitorResearchBlock,
  finishCompetitorEcho,
  runCompetitorReviewStage,
  runReviewFaqStage,
  withCompetitorPainPoints,
  type CompetitorEchoRecord,
} from './pdp-review-stage'
import { readCompetitorReviews } from './reviews/competitor-reviews'
import { buildEchoRewriteDirective, findCopyEchoes } from './reviews/competitor-echo'
import { findCopyReviewClaims, reviewClaimBlockFor } from './reviews/review-claims'
import { checkCopySimilarity, loadCorpusCheck, mergeCorpusChecks } from './similarity-gate'
import { referenceCorpusCheck } from './references/reference-inputs'
import { referenceResearchBlock } from './references/reference-research'
import { buildCopyFacts, buildCopyFactsBlock, correctCopyFacts, type FactCorrection } from './copy-facts'
import { buildNumberRewriteDirective, buildNumberSources, findUnsupportedNumbers } from './copy-numbers'
import { buildSpecFactsBlock, hasNewSpecFacts, stripDeflections, type DeflectionRemoval } from './spec-facts'
import { buildSpecOptionCountBlock } from './templatelib/spec-fixed'
import { buildUsageStepsFactsBlock, usageStepsForCopy, usageStepsWarning } from './usage-steps-facts'
import { findCrossSectionRepeats, repeatExclusionTerms } from './copy-repeats'
import { copyFlowRecord, findCopyFlowIssues } from './copy-flow-check'
import { copyRhythmRecord, findCopyRhythmIssues } from './copy-rhythm-check'
import { findCopyRuleViolations } from './copy-rule-check'
import { CATEGORY_TO_ESSENCE, mergeManualStrategy } from './pdp-strategy-contract'
import { jobUsageContext, usageCostPoolOf } from './pdp-cost-pool'
import { claimPdpJobRun, getPdpJob, isPdpJobLeased, updatePdpJob } from './pdp-jobs'
import { specSheetForSave, type PdpModelBatch } from './pdp-model-batch'
import { runWithPdpBatch } from './pdp-model-batch-context'
import { clearLocalLlmSoftStop, type LocalLlmBackendId } from '@/lib/agents/llm/local-llm-backend'
import { haltStopJobAfterSoftStop, recordSubscriptionFallbacks, softStopOf } from './pdp-subscription'
import {
  diffRouteSnapshot,
  PDP_NEW_BATCH_STAGE_DEADLINE_MS,
  snapshotPdpRoutes,
  type PdpRouteSnapshot,
} from './pdp-model-routes'
import { jobCostCapStop } from './job-cost-cap'
import {
  logNewStage,
  needsCopyFactAudit,
  needsPagePlan,
  recordCost,
  runComposeReviewStages,
  runCopyFactAuditStage,
  runPagePlanStage,
} from './pdp-new-stages-stage'
import { RUN_TIME_BUDGET_MS, runImagesStep } from './pdp-image-stage'
import {
  buildImageTasks,
  buildKnownImageTasks,
  isGatePending,
  isPlateTask,
  isSectionSettled,
  toGeneratedImagesMap,
} from './pdp-image-tasks'
import { isEditorRegenPending } from './pdp-image-regen'
import { pendingAnnotationTargets } from './pdp-annotation-stage'
import { appendDraftDetailAssets } from '@/lib/sourcing/registration/drafts'
import { composePdp } from './pdp-composer'
import {
  encodeStepFailure,
  MAX_STEP_FAILURES,
  PDP_STEP_PROGRESS,
  type CopySectionsPayload,
  type CopywritingResult,
  type PdpJobRow,
  type PdpStep,
  type StrategyContract,
} from './pdp-state'

/** 잡 상태에서 strategy_contract를 재구성 — DDL에 별도 컬럼이 없어 analysis.recommended_strategy_contract
 *  + spec_sheet 수동 힌트를 매 run 순수 재계산한다(결정론이라 재계산 비용은 무시할 수준). */
function resolveStrategyContract(job: PdpJobRow): StrategyContract {
  return mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
}

function resolveEssenceType(job: PdpJobRow) {
  return CATEGORY_TO_ESSENCE[job.analysis.detected_category ?? ''] ?? 'convenience'
}

function buildRunContext(
  userId: string,
  job: PdpJobRow,
  stage: string,
): RunContext {
  return {
    userId,
    ...(job.business_id ? { businessId: job.business_id } : {}),
    stage,
    ...jobUsageContext(job),
  }
}

/** 산출물 존재 여부로 다음 실행 단계를 판정 — current_step 문자열보다 이 판정을 신뢰한다(재개의 SSOT). */
export function resolveStepToRun(job: PdpJobRow): PdpStep {
  if (Object.keys(job.analysis).length === 0) return 'analysis'
  if (Object.keys(job.research_result).length === 0) return 'research'
  // 새 단계 기획(R10) — 새 배치 + newstages 잡만 리서치 뒤 한 번 더(기획만). 꺼진 잡은 false라 판정이 그대로다
  if (needsPagePlan(job)) return 'research'
  if (!job.section_plan.activated_sections?.length) return 'design'
  if (!job.copy_sections.final) return 'copywriting'
  // 새 단계 카피 뒤 사실 감사(R10) — 같은 잡만 카피 뒤 한 번 더(감사만)
  if (needsCopyFactAudit(job)) return 'copywriting'
  // 첫 생성 실패(retryPending)는 아직 끝나지 않은 섹션 — images가 한 번 더 시도한다(isSectionSettled)
  const imageTasks = buildImageTasks(job)
  if (imageTasks.some((t) => !isSectionSettled(job.section_images.find((e) => e.section === t.section)))) {
    return 'images'
  }
  // 게이트 미달로 이월된 재생성 대기 항목이 남아있으면 전 태스크가 이미 (url||error)를 가졌더라도
  // images 단계를 다시 골라야 한다 — 그렇지 않으면 이 큐에 영원히 도달하지 못한다(§6.3). 시간이 모자라 판정하지 못한
  // 게이트 대기(gatePending)도 같다 — 판정 전 컷으로 합성하지 않는다.
  // 지금 태스크에 있는 섹션만 — 생성 범위가 줄어든 디자인 컷 잡의 예전 대기가 images를 영원히 부르지 않게
  const taskSections = new Set(imageTasks.map((t) => t.section))
  if (job.section_images.some((e) => (e.pendingRegen || isGatePending(e)) && taskSections.has(e.section))) return 'images'
  // 편집기 사후 재생성(W5b) — 골격 밖이어도 아는 섹션 키의 편집기 대기는 images로 보낸다
  const outside = job.section_images.filter((e) => isEditorRegenPending(e) && !taskSections.has(e.section))
  if (outside.length > 0) {
    const known = new Set(buildKnownImageTasks(job).map((t) => t.section))
    if (outside.some((e) => known.has(e.section))) return 'images'
  }
  // 강조 장식(T4): 대상 컷에 annotationStatus가 없으면 images 단계의 장식 하위 단계로 — 대상 판정만으로 고른다
  // (Track S·구 Track I 잡은 대상 0이라 영향 없음)
  if (pendingAnnotationTargets(job).length > 0) return 'images'
  if (!job.final_html) return 'compose'
  return 'done'
}

/**
 * 같은 단계에서 연속 실패 시 error 컬럼에 재시도 카운트를 인코딩하고, MAX_STEP_FAILURES회째에는
 * current_step='failed'로 전이한다(§6.4). runPdpStep의 모든 실패 경로(단계 내부 소프트 실패·예산
 * 차단·외부 catch)가 이 헬퍼를 공유한다 — resolveStepToRun은 JSONB 산출물만 보므로 failed 잡도
 * 실패 단계부터 그대로 재개된다(재시도 시 이 헬퍼가 새 카운트를 처음부터 다시 센다).
 */
async function recordStepFailure(
  db: SupabaseClient,
  userId: string,
  jobId: string,
  step: PdpStep,
  priorError: string | null,
  message: string,
  costUsd?: number
): Promise<PdpJobRow> {
  const { error, count } = encodeStepFailure(step, priorError, message)
  if (count >= MAX_STEP_FAILURES) {
    return updatePdpJob(db, userId, jobId, {
      currentStep: 'failed',
      error: `${step} 단계 ${count}회 연속 실패: ${message}`,
      ...(costUsd !== undefined ? { costUsd } : {}),
    })
  }
  return updatePdpJob(db, userId, jobId, { error, ...(costUsd !== undefined ? { costUsd } : {}) })
}

/** 분석 단계 입력 — 실행과 단계 재현(__e2e__/stage-repro)이 같은 함수를 쓴다 */
export function analysisStepInput(job: PdpJobRow, userId: string) {
  return {
    specSheet: job.spec_sheet,
    reviewsSummary: job.spec_sheet.reviewsText?.trim() || '리뷰 데이터 없음',
    runContext: buildRunContext(userId, job, 'analysis'),
  }
}

async function stepAnalysis(db: SupabaseClient, userId: string, job: PdpJobRow): Promise<PdpJobRow> {
  // 경쟁사 리뷰가 있는 잡만 경쟁사 콜을 본 분석과 함께 부른다(pdp-review-input) — 없으면 호출·저장 그대로
  const competitorReviews = readCompetitorReviews(job.spec_sheet)
  const [result, competitor] = await Promise.all([
    runPdpAnalysis(analysisStepInput(job, userId)),
    competitorReviews ? runCompetitorReviewStage(competitorReviews, buildRunContext(userId, job, 'analysis')) : null,
  ])
  const costUsd = job.cost_usd + billedCostOf(result) + (competitor?.usage.cost ?? 0)
  if (!result.success) {
    return recordStepFailure(db, userId, job.id, 'analysis', job.error, result.error.message, costUsd)
  }
  const warnings = competitor?.warning ? [...result.data.warnings, competitor.warning] : result.data.warnings
  const specSheet = specWithDetectedExempt(job.spec_sheet, result.data.analysis.detected_category)
  return updatePdpJob(db, userId, job.id, {
    // 모델 배치 예약 키를 잃지 않게 다시 붙인다(toJob이 spec_sheet에서 지운 값, pdp-model-batch)
    ...(specSheet ? { specSheet: specSheetForSave(job, specSheet) } : {}),
    // Track I + ENRICHMENT만 잡 단위 기록·decision_profile 보존(설계 §4.7) — Track S는 학부모 판정이 켜진 잡만 audience 기록
    analysis: withCompetitorPainPoints(
      analysisWithEnrichment(job, result.data.analysis, result.data.decisionProfile),
      competitor?.summary,
    ),
    error: warnings.length > 0 ? warnings.join(' | ') : null,
    currentStep: 'research',
    progress: PDP_STEP_PROGRESS.research,
    costUsd,
  })
}

async function stepResearch(db: SupabaseClient, userId: string, job: PdpJobRow): Promise<PdpJobRow> {
  if (needsPagePlan(job)) return stepPagePlan(db, userId, job)
  // 경쟁사 불만 요약은 analysis JSON이 아니라 덧붙임 블록으로만(usp_mapping·planning_skeleton 전용 지시 포함)
  const competitorBlock = competitorResearchBlock(job)
  // 레퍼런스 구조 분석(13_REFERENCE_INPUT) — 스위치 references 켜진 잡이고 레퍼런스가 있을 때만, 경쟁사 블록 뒤에 덧붙인다
  const referenceBlock = referenceResearchBlock(job)
  const result = await runPdpResearch({
    specSheet: job.spec_sheet,
    analysis: analysisForPrompt(job.analysis),
    strategyContract: resolveStrategyContract(job),
    runContext: buildRunContext(userId, job, 'research'),
    ...(competitorBlock ? { competitorBlock } : {}),
    ...(referenceBlock ? { referenceBlock } : {}),
    ...newBatchStageDeadline(job),
  })
  const costUsd = job.cost_usd + billedCostOf(result)
  if (!result.success) {
    return recordStepFailure(db, userId, job.id, 'research', job.error, result.error.message, costUsd)
  }
  return updatePdpJob(db, userId, job.id, {
    researchResult: result.data.research,
    error: result.data.warnings.length > 0 ? result.data.warnings.join(' | ') : null,
    currentStep: 'design',
    progress: PDP_STEP_PROGRESS.design,
    costUsd,
  })
}

/**
 * 새 단계 기획(R10) — 리서치가 끝난 run 다음 run 하나에서 기획만 부르고 research_result.page_plan에 키만 더한다. 실패도 기록하고
 * 설계로 넘어간다(기획은 단계를 막지 않는다). 설계·카피 프롬프트는 리서치에서 고른 칸만 읽어 이 키를 보지 않는다(기록만)
 */
async function stepPagePlan(db: SupabaseClient, userId: string, job: PdpJobRow): Promise<PdpJobRow> {
  const record = await runPagePlanStage(job, buildRunContext(userId, job, 'research'), Date.now() + PDP_NEW_BATCH_STAGE_DEADLINE_MS)
  logNewStage(job.id, record)
  return updatePdpJob(db, userId, job.id, {
    researchResult: { ...job.research_result, page_plan: record },
    currentStep: 'design',
    progress: PDP_STEP_PROGRESS.design,
    costUsd: job.cost_usd + recordCost(record),
  })
}

/** 디자인 단계 입력 — 실행과 단계 재현(__e2e__/stage-repro)이 같은 함수를 쓴다 */
/** 새 배치 잡의 단계 기한(설계 ①②·리서치 280초 — run 300초 안, R03). 지금 배치는 빈 객체(요청 그대로) */
function newBatchStageDeadline(job: PdpJobRow): { deadlineAt?: number } {
  return job.model_batch === 'new' ? { deadlineAt: Date.now() + PDP_NEW_BATCH_STAGE_DEADLINE_MS } : {}
}

export function designStepInputs(job: PdpJobRow, userId: string) {
  const strategyContract = resolveStrategyContract(job)
  const decision = resolveDesignSkeleton(job, strategyContract)
  const common = {
    analysis: analysisForPrompt(job.analysis),
    research: job.research_result,
    strategyContract,
    specSheet: job.spec_sheet,
  }
  return {
    decision,
    planInput: { ...common, essenceType: resolveEssenceType(job), groundingBlock: decision.groundingBlock, runContext: buildRunContext(userId, job, 'design') },
    promptsInput: {
      ...common,
      runContext: buildRunContext(userId, job, 'design'),
      // R1 빛·색온도 정본 — light 기록 잡만(기본 off, Track I 기록)
      ...(hasEnrichmentFeature(job.analysis, 'light') ? { lightFromCharter: true } : {}),
    },
  }
}

/**
 * 디자인 단계 — 콜 ①(섹션설계)·콜 ②(이미지 프롬프트)를 함께 부른다(서로의 산출을 쓰지 않음 — 원본 run()의 ①→② 순차에서 속도 개선 1차로 바꿈).
 * Track S: 콜 ①에 코퍼스 그라운딩(참고 자료) 주입. Track I(결정 T-3): 골격을 buildSkeleton(순수 함수)이
 * 먼저 확정하고, 콜 ①은 골격 잠금 블록을 받아 섹션별 세부만 설계 — 응답이 골격을 바꾸면 enforceSkeleton이
 * 코드 레벨에서 복원한다. v2 스냅샷이 없는 카테고리는 standard 경로로 우아하게 폴백.
 * ENRICHMENT persuasion이 기록된 잡은 설득 플래너가 골격을 정한다(v2 없는 카테고리도 vocab pooled) — pdp-enrichment-stage.
 */
async function stepDesign(db: SupabaseClient, userId: string, job: PdpJobRow): Promise<PdpJobRow> {
  const { decision, planInput, promptsInput } = designStepInputs(job, userId)
  const designDeadline = newBatchStageDeadline(job)

  // 콜 ①(섹션 계획)·②(디자인 프롬프트)는 서로의 산출을 쓰지 않는다 — 함께 부른다(속도 개선 1차)
  const [planResult, promptsResult, reviewFaq] = await Promise.all([
    // 새 배치는 ①② 같은 280초 기한(R03) — 지금 배치는 기한 없이 지금 그대로. skipdesign1 잡(기본 off, J07)은 ①을 부르지 않고 기본 계획
    hasEnrichmentFeature(job.analysis, 'skipdesign1') ? skippedSectionPlan(planInput) : planPdpSections({ ...planInput, ...designDeadline }),
    generatePdpDesignPrompts({ ...promptsInput, ...designDeadline }),
    // 후기 속 실제 질문 — reviewfaq 기록 잡만(기본 off). 실패해도 고정 질문으로 계속한다
    hasEnrichmentFeature(job.analysis, 'reviewfaq')
      ? runReviewFaqStage(job.spec_sheet, buildRunContext(userId, job, 'design'))
      : null,
  ])
  if (reviewFaq?.warning) console.warn(`[pdp-pipeline] 잡 ${job.id} ${reviewFaq.warning}`)

  const sectionPlan = applyDesignSkeleton(planResult.sectionPlan, withReviewFaq(job, decision, reviewFaq))

  const costUsd = job.cost_usd + planResult.costUsd + promptsResult.costUsd + (reviewFaq?.costUsd ?? 0)
  const errors = [planResult.error, promptsResult.error].filter((e): e is string => !!e)

  return updatePdpJob(db, userId, job.id, {
    sectionPlan,
    designPrompts: promptsResult.designPrompts,
    error: errors.length > 0 ? errors.join(' | ') : null,
    currentStep: 'copywriting',
    progress: PDP_STEP_PROGRESS.copywriting,
    costUsd,
  })
}

function buildSimilarityBanDirective(findings: Array<{ sentence: string }>): string {
  const lines = findings.slice(0, 15).map((f) => `- "${f.sentence}"`).join('\n')
  return (
    '[유사도 게이트 재작성 지시] 아래 문장들은 시장 원문 코퍼스와 과도하게 유사합니다(H-1). ' +
    '같은 의미를 다른 표현·문장 구조로 다시 쓰세요. 절대 그대로 재사용하지 마세요:\n' +
    lines
  )
}

/**
 * 카피 재생성 한 벌을 시작할 최소 남은 시간(pdp-cost-time-followup) — 새 모델 한 벌 실측 63초·이전 모델 최대 81초의 약 1.5배.
 * 모자라면 시작하지 않는다(재생성 실패와 같은 처리 + 경고) — 300초 강제 종료로 단계 저장·실패 기록을 잃지 않게
 */
export const COPY_REGEN_MIN_MS = 120_000

/** 최종 반복 기록 수 상한(pdp-copy-facts-r4) — 섹션 수가 많은 순 */
const REPEAT_RECORD_MAX = 10
/** 떠넘기는 문장 제거 기록 상한(W2b) */
const DEFLECTION_RECORD_MAX = 20
/** 입력에 없는 숫자·단위 잔여 기록 상한(P0-2) */
const NUMBER_RECORD_MAX = 15
/** 안내형 끝말 잔여 기록 상한(P1-1a) */
const GUIDE_ENDING_RECORD_MAX = 15

type CopyRun = Awaited<ReturnType<typeof runPdpCopywriting>>

/**
 * 재생성 결과를 쓸 수 있는지(pdp-cost-time-followup, 통합 결정 — 이전 예정 pdp-copy-regen-fallback-fix를 합침). 콜 실패는 지금처럼
 * 버린다. 카피 생성(Stage 1·premium 1콜)이 기본 카피로 폴백한 결과도 버린다 — 위반을 고치려던 재생성이 좋은 원래 카피를 기본
 * 카피로 바꿔치우지 않게. Stage 2·3만 실패한 결과는 위반을 고친 카피라 지금처럼 받는다(그 단계 실패 경고가 남는다)
 */
function usableRegen(regen: CopyRun, kind: string, warnings: string[]): regen is Extract<CopyRun, { success: true }> {
  if (!regen.success) return false
  if (!regen.data.stage1FellBack) return true
  warnings.push(`[Copywriting] ${kind} 재생성의 카피 생성이 기본 카피로 폴백 — 재생성 결과를 버리고 이전 카피 유지`)
  return false
}

/** 재생성을 시작해도 되는지 — 기한이 없으면(로컬 실행기) 늘 된다. 모자라면 사유를 경고에 남긴다 */
function copyRegenFits(deadlineAt: number | undefined, kind: string, warnings: string[]): boolean {
  if (deadlineAt === undefined) return true
  const left = deadlineAt - Date.now()
  if (left >= COPY_REGEN_MIN_MS) return true
  warnings.push(`[Copywriting] run 시간 예산 부족 — ${kind} 재생성 건너뜀(남은 ${Math.max(0, Math.round(left / 1000))}초)`)
  return false
}

/**
 * 카피 단계 입력 — stepCopywriting과 Stage 3 재현 하네스(__e2e__/pdp-stage3-repro)가 같은 입력을 쓴다. 잡 기록·스펙만 읽는다(순수).
 * deadlineAt = run 기한(Vercel run만, 로컬은 없음)
 */
export function copyStepInputs(job: PdpJobRow, userId: string, deadlineAt: number | undefined) {
  const strategyContract = resolveStrategyContract(job)
  const essenceType = resolveEssenceType(job)
  const category = job.analysis.detected_category ?? ''
  // ENRICHMENT 플래너 잡은 Track I 블록(v2 없으면 pooled) + 설득 흐름 요약 — 그 밖은 기존 판정
  const internalizedBlock = resolveInternalizedCopyBlock(job, category)
  const corpusVersion = internalizedBlock ? getCorpusVersionV2(category) : getCorpusVersionV1(category)
  // 연령 컴플라이언스(만 14세 이상 상품): 금지·고지 블록을 양 트랙 공통으로 말미에 강제 append
  const ageBlock = buildAgeComplianceCopyBlock(job.spec_sheet)
  // 주장 범위(R2) — 기록 잡만. Stage 1 그라운딩(연령 블록 앞)과 Stage 2·3 말미에 같은 블록. 그 밖의 잡은 기존 문자열 그대로
  const claimGuard = resolveClaimGuardBlock(job)
  // 후기 사용 범위(R6) — 자사 리뷰가 있는 모든 잡(트랙·기록 무관): 주장 범위 뒤, Stage 2·3·보충 말미에도 같은 블록. 리뷰 없는 잡은 그대로
  const reviewClaimBlock = reviewClaimBlockFor(job.spec_sheet)
  // 학부모 대리 구매형(audience 기록 잡만) — 화자·장면 블록. Stage 1은 연령 블록 앞(게이트가 마지막에 우선), Stage 2·3 말미에도 같은 블록
  const audience = audienceOf(job)
  const parentBlock = buildParentProxyCopyBlock(audience)
  // 연령 블록도 Stage 2·3 말미에(결정 카드 c03) — 다듬기·검수 단계가 어린이 장면을 다시 넣지 않게. Stage 1과 같은 차례(마지막 — 우선)
  const stageGuardBlock = [claimGuard, reviewClaimBlock, parentBlock, ageBlock].filter(Boolean).join('\n\n')
  const baseBlock = internalizedBlock ?? buildCopyGroundingBlock(category)
  const groundingBlock = [baseBlock, claimGuard, reviewClaimBlock, parentBlock, ageBlock].filter(Boolean).join('\n\n')
  // 사실 값(pdp-copy-facts-r4) — 등록 옵션 구조가 있는 모든 잡: 옵션 개수·수량을 모든 카피 콜에 주고, 최종 카피의 개수 오기를 고친다
  const copyFacts = buildCopyFacts(job.spec_sheet)
  const recorded = recordedCopyInputs(job)
  const flowFix = hasEnrichmentFeature(job.analysis, 'flow')
  const rhythmOn = hasEnrichmentFeature(job.analysis, 'rhythm')
  const hookShortOn = hasEnrichmentFeature(job.analysis, 'hookshort')
  // 상품 사실(W2b) — 새 입력 필드(무게·원산지·추가 스펙)가 있는 잡·기록 잡만 옵션 사실 값 블록 뒤에 붙인다. 그 밖의 잡은 지금 그대로
  const specFactsOn = Boolean(recorded) || hasNewSpecFacts(job.spec_sheet)
  // 사용 순서(적용 G-U1) — 디자인 컷 잡이고 입력 사용 순서가 정리 뒤 2~5단계일 때만 셋째 블록. 그 밖의 잡은 지금 그대로(R 동결)
  const usageSteps = usageStepsForCopy(job.spec_sheet, designcutEnabled(job))
  const factsBlock = [
    // spec 정본 고정(specfixed 잡만, J23 — 기본 off): 등록 옵션 구조가 없어 사실 값 블록이 없는 잡은 판매자 입력 옵션 수 한 줄. 꺼진 잡은 지금 그대로
    copyFacts || !hasEnrichmentFeature(job.analysis, 'specfixed') ? buildCopyFactsBlock(copyFacts) : buildSpecOptionCountBlock(job.spec_sheet),
    buildSpecFactsBlock(job.spec_sheet, { recorded: Boolean(recorded) }),
    buildUsageStepsFactsBlock(usageSteps),
  ]
    .filter(Boolean)
    .join('\n\n')

  const input = {
    specSheet: job.spec_sheet,
    mode: job.mode,
    analysis: analysisForPrompt(job.analysis),
    research: job.research_result,
    sectionPlan: job.section_plan,
    strategyContract,
    essenceType,
    runContext: buildRunContext(userId, job, 'copywriting'),
    ...(stageGuardBlock ? { stageGuardBlock } : {}),
    // 기록 잡만 — 구매 결정 성향·후킹 진단(사실형 전략 지시)과 Stage 3 특징 배정(R4). 그 밖의 잡은 기존 프롬프트 그대로
    // 섹션 사이 반복 검사(pdp-copy-facts-r4)는 특징 배정과 같은 기록 잡만
    ...(recorded ? { ...recorded, checkRepeats: true } : {}),
    // 카피 흐름 고치기(P1-1b) — flow 기록 잡만. 그 밖의 잡은 기존 프롬프트 그대로(흐름 수 기록은 아래에서 모든 잡에 남긴다)
    ...(flowFix ? { flowFix: true } : {}),
    // 카피 리듬(rhythm 기록 잡만) — Stage 2 쓰기 지시·Stage 3 고칠 곳. 그 밖의 잡은 기존 프롬프트 그대로(리듬 수 기록은 모든 잡)
    ...(rhythmOn ? { rhythm: true } : {}),
    // 첫 화면 글 줄이기(hookshort 기록 잡만) — Stage 2 쓰기 지시·Stage 3 고칠 곳·상품 종류 낱말 자리
    ...(hookShortOn ? { hookShort: true } : {}),
    // 디자인 컷 잡만 — 예시 색 없이(페이지 색은 원천 사진 측정, designcut-photo), 후킹 기본값·고민-POINT 짝(copy-design-rules). 그 밖의 잡은 기존 프롬프트 그대로
    ...(designcutEnabled(job) ? { withoutExampleColors: true, designRules: true } : {}),
    ...(deadlineAt !== undefined ? { deadlineAt } : {}),
    ...(factsBlock ? { factsBlock } : {}),
  }
  return {
    input,
    groundingBlock,
    category,
    corpusVersion,
    reviewClaimBlock,
    audience,
    stageGuardBlock,
    copyFacts,
    recorded,
    flowFix,
    rhythmOn,
    specFactsOn,
    usageSteps,
  }
}

/** 카피라이팅 단계 — 카피 생성(코퍼스 그라운딩은 Stage 1/premium에만) → 유사도 게이트(H-1) → 위반 시 재생성 1회.
 *  Track I(§5 copywriting 행): v2 블록(copyTone 지시 + 패턴 전량)으로 교체 — Stage1만 주입하는 구조 보존 원칙은 동일. */
async function stepCopywriting(db: SupabaseClient, userId: string, job: PdpJobRow): Promise<PdpJobRow> {
  if (needsCopyFactAudit(job)) return stepCopyFactAudit(db, userId, job)
  // run 기한(pdp-cost-time-followup) — 운영 실행(강제 종료 maxDuration 300초가 있는 Vercel run, 같은 값을 쓰는 Railway 구독 작업자 R13 —
  // 잡 잠금 340초 안)만. 이미지 단계와 같은 실질 예산 280초. 로컬 실행기는 종료되지 않고 M 갈래(느린 모델·시간 제한 3배) 비교가 잘리면
  // 안 되므로 지금 그대로다
  const deadlineAt = isHostedPdpEnv() ? Date.now() + RUN_TIME_BUDGET_MS : undefined
  const regenWarnings: string[] = []
  const {
    input,
    groundingBlock,
    category,
    corpusVersion,
    reviewClaimBlock,
    audience,
    stageGuardBlock,
    copyFacts,
    recorded,
    flowFix,
    rhythmOn,
    specFactsOn,
    usageSteps,
  } = copyStepInputs(job, userId, deadlineAt)

  const result = await runPdpCopywriting({ ...input, groundingBlock })
  let costUsd = job.cost_usd + billedCostOf(result)
  if (!result.success) {
    return recordStepFailure(db, userId, job.id, 'copywriting', job.error, result.error.message, costUsd)
  }

  let payload = result.data
  let finalCopy: CopywritingResult = payload.final
  let similarityWarnings: Array<{ section: string; score: number }> = []

  // 연령 컴플라이언스 게이트(만 14세 이상 상품) — 재생성 3종 중 맨 앞(규정 준수라 run 시간이 모자라도 먼저 — 통합 결정,
  // pdp-cost-time-followup). 리뷰 원문 발췌는 제거(재작성 불가), 작성 카피 위반은 재생성 1회 지시. 뒤의 품질 재생성(에코·유사도)이
  // 어린이 표현을 늘리면 그 결과는 받지 않고, 모든 재생성 뒤 최종 카피를 다시 검수해 잔여 위반·고지 누락을 경고로 표면화한다
  // (차단 없음 — 유사도 게이트 계약 동일). 연령 제한이 없는 잡은 이 게이트가 없어 순서와 무관하다
  const minAge = isAgeRestricted(job.spec_sheet) ? job.spec_sheet.minAgeYears! : null
  let removedChildHighlights = 0
  const stripChildHighlights = (copy: CopywritingResult): CopywritingResult => {
    const stripped = stripChildReviewHighlights(copy)
    removedChildHighlights += stripped.removed
    return stripped.copy
  }
  /** 연령 위반 수 — 리뷰 발췌는 어차피 지우므로 지운 뒤 카피로 센다(순수 함수) */
  const ageViolationCount = (copy: CopywritingResult): number =>
    minAge === null ? 0 : checkAgeCompliance(stripChildReviewHighlights(copy).copy, minAge).violations.length
  // D 카피 재생성 걸린 섹션 1콜(regenslot 잡만, 결정 카드 c14 L·J27 — 기본 off). 꺼진 잡은 아래 5곳이 지금처럼 카피 전체(Stage 1~3)를 다시 돈다
  const regenSlot = hasEnrichmentFeature(job.analysis, 'regenslot')
  /**
   * 걸린 최상위 섹션만 1콜로 다시 쓰고 섹션마다 받는다 — accept(그 섹션만 바꾼 카피, 섹션)가 참인 섹션만 최종 카피에 넣는다(차례대로, 앞에서 받은
   * 카피로 다음 섹션을 판정). 연령 제한 잡은 받은 카피의 어린이 리뷰 발췌를 지운다(카피 전체 재생성과 같다). 걸리지 않은 섹션은 바이트 그대로다.
   * 받은 섹션 목록, 콜이 실패하면 null(경고를 남기고 이전 카피 유지). 답에 없거나 모양이 다른 섹션은 버리고 경고를 남긴다
   */
  const regenSections = async (
    kind: string,
    sections: readonly string[],
    directive: string,
    accept: (candidate: CopywritingResult, section: string) => boolean
  ): Promise<string[] | null> => {
    const out = await regenerateCopySections({
      final: finalCopy,
      sections: [...new Set(sections)],
      directive,
      ...(stageGuardBlock ? { stageGuardBlock } : {}),
      ...(input.factsBlock ? { factsBlock: input.factsBlock } : {}),
      runContext: input.runContext,
      ...(deadlineAt !== undefined ? { deadlineAt } : {}),
    })
    costUsd += billedCostOf(out)
    if (!out.success) {
      regenWarnings.push(`[Copywriting] ${kind} 섹션 재생성 실패 — 이전 카피 유지: ${out.error.message}`)
      return null
    }
    if (out.data.dropped.length > 0) {
      regenWarnings.push(`[Copywriting] ${kind} 섹션 재생성 답에 없거나 모양이 다른 섹션(${out.data.dropped.join(', ')}) — 그 섹션은 이전 카피 유지`)
    }
    const accepted: string[] = []
    for (const [section, value] of Object.entries(out.data.sections)) {
      const candidate = { ...finalCopy, [section]: value } as CopywritingResult
      if (!accept(candidate, section)) continue
      finalCopy = minAge === null ? candidate : stripChildHighlights(candidate)
      accepted.push(section)
    }
    return accepted
  }
  /** 검사 결과 가운데 한 최상위 섹션의 것만 센다 */
  const countIn = <T,>(found: readonly T[], sectionOf: (finding: T) => string, section: string): number => found.filter((f) => sectionOf(f) === section).length
  if (minAge !== null) {
    finalCopy = stripChildHighlights(finalCopy)
    const check = checkAgeCompliance(finalCopy, minAge)
    if (check.violations.length > 0 && copyRegenFits(deadlineAt, '연령 표현', regenWarnings)) {
      if (regenSlot) {
        // 걸린 섹션만 — 그 섹션의 연령 위반이 줄 때만 받는다(어린이 리뷰 발췌는 지운 뒤 센다)
        const bySection = (f: { section: string }) => f.section
        await regenSections('연령 표현', check.violations.map(bySection), buildAgeBanDirective(check.violations, minAge), (candidate, section) =>
          countIn(checkAgeCompliance(stripChildReviewHighlights(candidate).copy, minAge).violations, bySection, section) < countIn(check.violations, bySection, section)
        )
      } else {
        const regen = await runPdpCopywriting({
          ...input,
          groundingBlock: `${groundingBlock}\n\n${buildAgeBanDirective(check.violations, minAge)}`,
        })
        costUsd += billedCostOf(regen)
        if (usableRegen(regen, '연령 표현', regenWarnings)) {
          payload = regen.data
          finalCopy = stripChildHighlights(regen.data.final)
        }
      }
    }
  }
  /** 받은 품질 재생성 카피 — 연령 제한 잡은 어린이 리뷰 발췌를 바로 지운다(뒤의 유사도 판정이 지워질 문장을 보지 않게, 검수 지적) */
  const acceptRegenCopy = (copy: CopywritingResult): CopywritingResult =>
    minAge === null ? copy : stripChildHighlights(copy)
  /** 품질 재생성 결과가 연령 위반을 늘리지 않는지 — 늘리면 받지 않는다(연령 제한 잡만, 규정 우선) */
  const keepsAgeCompliance = (candidate: CopywritingResult, kind: string): boolean => {
    if (minAge === null || ageViolationCount(candidate) <= ageViolationCount(finalCopy)) return true
    regenWarnings.push(`[Copywriting] ${kind} 재생성 결과가 어린이 표현을 늘림 — 재생성 결과를 버리고 이전 카피 유지`)
    return false
  }

  // 학부모 시점 검사(audience 기록 잡, 연령 게이트가 꺼진 잡만 — 게이트 잡은 게이트가 어린이 표현 전체를 막는다). 아이가 쓰거나 반응하는
  // 문장·아이가 나오는 이미지 지시를 찾아 재작성 1회. 뒤의 품질 재생성이 이런 문장을 늘리면 그 결과는 받지 않는다
  const parentCheck = Boolean(audience && !audience.ageGate)
  const childUseCount = (copy: CopywritingResult): number => (parentCheck ? findChildUseLines(copy).length : 0)
  let parentFound = 0
  let parentRegenerated = false
  if (parentCheck) {
    const found = findChildUseLines(finalCopy)
    parentFound = found.length
    if (regenSlot && found.length > 0 && copyRegenFits(deadlineAt, '학부모 시점', regenWarnings)) {
      // 걸린 섹션만 — 그 섹션의 아이 사용·반응 문장이 줄 때만 받는다
      const bySection = (f: { section: string }) => f.section
      const accepted = await regenSections('학부모 시점', found.map(bySection), buildParentProxyRewriteDirective(found), (candidate, section) =>
        countIn(findChildUseLines(candidate), bySection, section) < countIn(found, bySection, section)
      )
      parentRegenerated = Boolean(accepted?.length)
      if (accepted?.length === 0) regenWarnings.push('[Copywriting] 학부모 시점 재생성이 아이 사용·반응 문장을 줄이지 못함 — 이전 카피 유지')
    } else if (!regenSlot && found.length > 0 && copyRegenFits(deadlineAt, '학부모 시점', regenWarnings)) {
      const regen = await runPdpCopywriting({
        ...input,
        groundingBlock: `${groundingBlock}\n\n${buildParentProxyRewriteDirective(found)}`,
      })
      costUsd += billedCostOf(regen)
      if (usableRegen(regen, '학부모 시점', regenWarnings) && childUseCount(regen.data.final) < found.length) {
        payload = regen.data
        finalCopy = acceptRegenCopy(regen.data.final)
        parentRegenerated = true
      } else if (regen.success && !regen.data.stage1FellBack) {
        regenWarnings.push('[Copywriting] 학부모 시점 재생성이 아이 사용·반응 문장을 줄이지 못함 — 이전 카피 유지')
      }
    }
  }
  /** 품질 재생성 결과가 아이 사용·반응 문장을 늘리지 않는지 — 늘리면 받지 않는다(학부모 시점 검사 잡만) */
  const keepsParentView = (candidate: CopywritingResult, kind: string): boolean => {
    if (!parentCheck || childUseCount(candidate) <= childUseCount(finalCopy)) return true
    regenWarnings.push(`[Copywriting] ${kind} 재생성 결과가 아이 사용·반응 문장을 늘림 — 재생성 결과를 버리고 이전 카피 유지`)
    return false
  }

  // 숫자·단위 대조(P0-2, 모든 잡) — 최종 카피에 숫자로 쓴 값+단위가 입력(상품 정보·리뷰 원문·인증·이벤트·옵션)에 없으면 재작성 1회.
  // 숫자 없는 체감 표현은 보지 않는다(오너 기준). 뒤의 품질 재생성이 이런 숫자를 늘리면 그 결과는 받지 않고, 남은 것은 마지막에 경고·기록한다
  const numberSources = buildNumberSources(job.spec_sheet)
  const unsupportedCount = (copy: CopywritingResult): number => findUnsupportedNumbers(copy, numberSources).length
  const numbersFound = findUnsupportedNumbers(finalCopy, numberSources)
  let numbersRegenerated = false
  if (regenSlot && numbersFound.length > 0 && copyRegenFits(deadlineAt, '숫자·단위', regenWarnings)) {
    // 걸린 섹션만 — 그 섹션의 입력에 없는 숫자가 줄고, 연령·아이 사용 가드가 늘지 않을 때만 받는다
    const byPath = (f: { path: string }) => f.path.split(/[.[]/)[0]
    const accepted = await regenSections('숫자·단위', numbersFound.map(byPath), buildNumberRewriteDirective(numbersFound), (candidate, section) =>
      countIn(findUnsupportedNumbers(candidate, numberSources), byPath, section) < countIn(numbersFound, byPath, section) &&
      keepsAgeCompliance(candidate, '숫자·단위') &&
      keepsParentView(candidate, '숫자·단위')
    )
    numbersRegenerated = Boolean(accepted?.length)
    if (accepted?.length === 0) regenWarnings.push('[Copywriting] 숫자·단위 재생성이 입력에 없는 숫자를 줄이지 못함 — 이전 카피 유지')
  } else if (!regenSlot && numbersFound.length > 0 && copyRegenFits(deadlineAt, '숫자·단위', regenWarnings)) {
    // 지시는 Stage 2·3(다듬기·검수) 말미에도 — 그라운딩 블록은 Stage 1에만 들어가 뒤 단계가 숫자를 다시 넣을 수 있다
    const directive = buildNumberRewriteDirective(numbersFound)
    const regen = await runPdpCopywriting({
      ...input,
      groundingBlock: `${groundingBlock}\n\n${directive}`,
      stageGuardBlock: [stageGuardBlock, directive].filter(Boolean).join('\n\n'),
    })
    costUsd += billedCostOf(regen)
    if (usableRegen(regen, '숫자·단위', regenWarnings)) {
      if (unsupportedCount(regen.data.final) >= numbersFound.length) {
        regenWarnings.push('[Copywriting] 숫자·단위 재생성이 입력에 없는 숫자를 줄이지 못함 — 이전 카피 유지')
      } else if (keepsAgeCompliance(regen.data.final, '숫자·단위') && keepsParentView(regen.data.final, '숫자·단위')) {
        payload = regen.data
        finalCopy = acceptRegenCopy(regen.data.final)
        numbersRegenerated = true
      }
    }
  }
  /** 품질 재생성 결과가 입력에 없는 숫자를 늘리지 않는지 — 늘리면 받지 않는다 */
  const keepsNumbers = (candidate: CopywritingResult, kind: string): boolean => {
    if (unsupportedCount(candidate) <= unsupportedCount(finalCopy)) return true
    regenWarnings.push(`[Copywriting] ${kind} 재생성 결과가 입력에 없는 숫자를 늘림 — 재생성 결과를 버리고 이전 카피 유지`)
    return false
  }

  // 경쟁사 리뷰 재현 가드 ②(pdp-review-input, 경쟁사 리뷰가 있는 잡만) — 겹친 섹션 이름만 지시해 재생성 1회.
  // 카피 프롬프트에는 경쟁사 원문이 없으므로 다중 방어다. 남은 겹침은 모든 게이트 뒤 ③에서 지운다
  const echoGuard = competitorEchoGuard(job)
  let echoRecord: Omit<CompetitorEchoRecord, 'removed'> | null = null
  if (echoGuard) {
    const sections = findCopyEchoes(finalCopy, echoGuard)
    echoRecord = { rewritten_sections: sections, regenerated: false }
    if (regenSlot && sections.length > 0 && copyRegenFits(deadlineAt, '경쟁사 리뷰 재현', regenWarnings)) {
      // 걸린 섹션만 — 그 섹션의 겹침이 사라지고 연령·아이 사용·숫자 가드가 늘지 않을 때만 받는다
      const accepted = await regenSections('경쟁사 리뷰 재현', sections, buildEchoRewriteDirective(sections), (candidate, section) =>
        !findCopyEchoes(candidate, echoGuard).includes(section) &&
        keepsAgeCompliance(candidate, '경쟁사 리뷰 재현') &&
        keepsParentView(candidate, '경쟁사 리뷰 재현') &&
        keepsNumbers(candidate, '경쟁사 리뷰 재현')
      )
      echoRecord.regenerated = Boolean(accepted?.length)
    } else if (!regenSlot && sections.length > 0 && copyRegenFits(deadlineAt, '경쟁사 리뷰 재현', regenWarnings)) {
      const regen = await runPdpCopywriting({
        ...input,
        groundingBlock: `${groundingBlock}\n\n${buildEchoRewriteDirective(sections)}`,
      })
      costUsd += billedCostOf(regen)
      if (
        usableRegen(regen, '경쟁사 리뷰 재현', regenWarnings) &&
        keepsAgeCompliance(regen.data.final, '경쟁사 리뷰 재현') &&
        keepsParentView(regen.data.final, '경쟁사 리뷰 재현') &&
        keepsNumbers(regen.data.final, '경쟁사 리뷰 재현')
      ) {
        payload = regen.data
        finalCopy = acceptRegenCopy(regen.data.final)
        echoRecord.regenerated = true
      }
    }
  }

  // 레퍼런스(own 제외) 원문이 있으면 잡 단위 임시 코퍼스를 더한다 — 없으면 카테고리 코퍼스 그대로
  const corpusCheck = mergeCorpusChecks(loadCorpusCheck(category), referenceCorpusCheck(job.spec_sheet))
  if (corpusCheck) {
    const findings = checkCopySimilarity(finalCopy, corpusCheck)
    if (findings.length > 0 && !copyRegenFits(deadlineAt, '코퍼스 유사도', regenWarnings)) {
      // 재생성을 시작하지 못했다 — 재생성 실패와 같이 처음 findings를 경고로 남긴다
      similarityWarnings = findings.map((f) => ({ section: f.section, score: f.score }))
    } else if (findings.length > 0 && regenSlot) {
      // 걸린 섹션만 — 그 섹션이 유사 판정에서 빠지고 연령·아이 사용·숫자 가드가 늘지 않을 때만 받는다
      const accepted = await regenSections('코퍼스 유사도', findings.map((f) => f.section), buildSimilarityBanDirective(findings), (candidate, section) =>
        !checkCopySimilarity(candidate, corpusCheck).some((f) => f.section === section) &&
        keepsAgeCompliance(candidate, '코퍼스 유사도') &&
        keepsParentView(candidate, '코퍼스 유사도') &&
        keepsNumbers(candidate, '코퍼스 유사도')
      )
      // 받은 섹션이 있으면 다시 잰 결과, 없으면 처음 findings(카피가 그대로라 여전히 유효한 위반 — 카피 전체 재생성의 실패 처리와 같다)
      similarityWarnings = (accepted?.length ? checkCopySimilarity(finalCopy, corpusCheck) : findings).map((f) => ({ section: f.section, score: f.score }))
    } else if (findings.length > 0) {
      const regen = await runPdpCopywriting({
        ...input,
        groundingBlock: `${groundingBlock}\n\n${buildSimilarityBanDirective(findings)}`,
      })
      costUsd += billedCostOf(regen)
      if (
        usableRegen(regen, '코퍼스 유사도', regenWarnings) &&
        keepsAgeCompliance(regen.data.final, '코퍼스 유사도') &&
        keepsParentView(regen.data.final, '코퍼스 유사도') &&
        keepsNumbers(regen.data.final, '코퍼스 유사도')
      ) {
        payload = regen.data
        finalCopy = acceptRegenCopy(regen.data.final)
        const recheck = checkCopySimilarity(finalCopy, corpusCheck)
        similarityWarnings = recheck.map((f) => ({ section: f.section, score: f.score }))
      } else {
        // 재생성 결과를 쓰지 못했다(콜 실패·Stage 1 폴백·연령·아이 사용·숫자 가드) — finalCopy는 이전 산출 그대로이므로 그 findings가
        // 여전히 유효한 위반이다. 여기서 승격하지 않으면 재생성 실패 시 경고가 통째로 소실된다.
        similarityWarnings = findings.map((f) => ({ section: f.section, score: f.score }))
      }
    }
  }

  // 사실 값 대조(pdp-copy-facts-r4) — 모든 재생성 뒤 최종 카피의 축 개수 오기('7가지 디자인' → 6)를 고친다. 일반 낱말·수량·빠진
  // 조합을 모든 조합처럼 쓴 문장은 경고만. 숫자만 바꾸므로 어린이 표현·조사에 영향이 없다
  let factCorrections: FactCorrection[] = []
  const factWarnings: string[] = []
  if (copyFacts) {
    const checked = correctCopyFacts(finalCopy, copyFacts)
    finalCopy = checked.copy
    factCorrections = checked.corrections
    factWarnings.push(...checked.warnings)
  }

  // 떠넘기는 문장(W2b, R5 P07 '소재·규격은 상세 정보 확인') — 상품 사실 블록을 받은 잡만. 프롬프트를 어긴 문장을 뺀다
  let deflections: DeflectionRemoval[] = []
  let deflectionDropped: string[] = []
  let deflectionKept: string[] = []
  if (specFactsOn) {
    const stripped = stripDeflections(finalCopy)
    finalCopy = stripped.copy
    deflections = stripped.removed
    deflectionDropped = stripped.dropped
    deflectionKept = stripped.kept
  }

  // 연령 최종 검수 — 모든 재생성 뒤 카피로 리뷰 발췌 제거·위반·고지를 기록한다
  let ageCompliance: CopySectionsPayload['age_compliance']
  if (minAge !== null) {
    finalCopy = stripChildHighlights(finalCopy)
    const check = checkAgeCompliance(finalCopy, minAge)
    ageCompliance = {
      min_age: minAge,
      removed_review_highlights: removedChildHighlights,
      notice_present: check.noticePresent,
      violations: check.violations,
    }
  }

  // 학부모 시점 최종 기록 — 모든 재생성 뒤 남은 문장(측정용, 지우지 않는다)
  const parentProxy: CopySectionsPayload['parent_proxy'] = parentCheck
    ? { found: parentFound, regenerated: parentRegenerated, remaining: findChildUseLines(finalCopy).slice(0, 15) }
    : undefined

  // 경쟁사 리뷰 재현 가드 ③ — 모든 게이트(재생성 포함) 뒤 남은 겹침 문장을 지운다
  let competitorEcho: CompetitorEchoRecord | undefined
  let echoWarning: string | undefined
  if (echoGuard && echoRecord) {
    const finished = finishCompetitorEcho(finalCopy, echoGuard, echoRecord)
    finalCopy = finished.copy
    competitorEcho = finished.record
    echoWarning = finished.warning
  }

  // 숫자·단위 최종 기록 — 모든 재생성·정정 뒤 남은 숫자(측정용, 지우지 않는다). 걸린 것이 있었던 잡만
  const numberRemaining = findUnsupportedNumbers(finalCopy, numberSources)
  const numberCheck: CopySectionsPayload['number_check'] =
    numbersFound.length > 0 || numberRemaining.length > 0
      ? { found: numbersFound.length, regenerated: numbersRegenerated, remaining: numberRemaining.slice(0, NUMBER_RECORD_MAX) }
      : undefined

  // 섹션 사이 반복 최종 기록(기록 잡, 측정용 — 재생성은 하지 않는다)
  const repeatFindings = recorded
    ? findCrossSectionRepeats(finalCopy, { excludeTerms: repeatExclusionTerms(job.spec_sheet) }).slice(0, REPEAT_RECORD_MAX)
    : []

  // 카피 흐름 수(P1-1b, 모든 잡, 측정용 — 스위치와 무관한 기준값): 최종 카피와 pro Stage 2 산출(고치기 전). fix는 flow 잡이 Stage 3에
  // 고칠 곳을 넘겼을 때(pro). 측정용이라 예상 밖 카피 모양(배열이 아닌 목록 칸 등)으로 던져도 카피 단계를 멈추지 않는다 — 기록 없이
  // 경고 한 줄만 남긴다(운영 Track S 포함 모든 잡이 이 길을 지난다)
  let copyFlow: CopySectionsPayload['copy_flow']
  let copyFlowWarning: string | undefined
  try {
    copyFlow = copyFlowRecord(
      findCopyFlowIssues(finalCopy, job.spec_sheet),
      payload.stage2 ? findCopyFlowIssues(payload.stage2, job.spec_sheet) : undefined,
      flowFix && job.mode === 'pro'
    )
  } catch (e) {
    copyFlowWarning = `[CopyFlow] 카피 흐름 수를 세지 못해 copy_flow 없이 진행: ${e instanceof Error ? e.message : String(e)}`
  }
  // 카피 리듬 수(rhythm, 모든 잡, 측정용 — 같은 기준값·같은 가드): 최종 카피와 pro Stage 2 산출, fix는 rhythm 잡이 고칠 곳을 넘겼을 때
  let copyRhythm: CopySectionsPayload['copy_rhythm']
  let copyRhythmWarning: string | undefined
  try {
    copyRhythm = copyRhythmRecord(
      findCopyRhythmIssues(finalCopy),
      payload.stage2 ? findCopyRhythmIssues(payload.stage2) : undefined,
      rhythmOn && job.mode === 'pro'
    )
  } catch (e) {
    copyRhythmWarning = `[CopyRhythm] 카피 리듬 수를 세지 못해 copy_rhythm 없이 진행: ${e instanceof Error ? e.message : String(e)}`
  }

  // 카피 규칙 최종 기록(P1-1a, 모든 잡, 측정용) — Stage 3이 고칠 곳으로 받고도 남은 안내형 끝말·첫 화면 상품 종류 낱말 누락
  const ruleFindings = findCopyRuleViolations(finalCopy, job.spec_sheet)
  const hookTypeMissing = ruleFindings.hookType?.present === false ? ruleFindings.hookType.words : null
  const copyRuleCheck: CopySectionsPayload['copy_rule_check'] =
    ruleFindings.guideEndings.length > 0 || hookTypeMissing
      ? { guide_endings: ruleFindings.guideEndings.slice(0, GUIDE_ENDING_RECORD_MAX), hook_type_missing: hookTypeMissing }
      : undefined

  // 후기 유래 규제 표현 검출(R6 — 자사 리뷰가 있는 모든 잡, 측정용). 인용 후보 차단과 같은 규제 사전(인증·인허가·의학·기능성)으로 찾아
  // 기록만 한다(지우기는 다음 단계).
  // 상품명·옵션 값에 든 표현은 용도 이름이라 세지 않는다
  const reviewClaims =
    reviewClaimBlock
      ? findCopyReviewClaims(finalCopy, [job.spec_sheet.productName ?? '', ...repeatExclusionTerms(job.spec_sheet)].join(' '))
      : []

  const warnings = [...payload.warnings, ...regenWarnings, ...factWarnings]
  const usageWarning = usageStepsWarning(finalCopy, usageSteps)
  if (usageWarning) warnings.push(usageWarning)
  if (copyFlowWarning) warnings.push(copyFlowWarning)
  if (copyRhythmWarning) warnings.push(copyRhythmWarning)
  if (repeatFindings.length > 0) {
    warnings.push(`[CopyRepeats] 섹션 사이 반복 ${repeatFindings.length}건 — copy_sections.repeat_findings 참조`)
  }
  if (copyRuleCheck) {
    const parts = [
      ...(copyRuleCheck.guide_endings.length > 0 ? [`제목·CTA 안내형 끝말 ${ruleFindings.guideEndings.length}건`] : []),
      ...(hookTypeMissing ? [`첫 화면에 상품 종류 낱말(${hookTypeMissing.join('·')}) 없음`] : []),
    ]
    warnings.push(`[CopyRules] ${parts.join(', ')} — copy_sections.copy_rule_check 참조`)
  }
  if (reviewClaims.length > 0) {
    warnings.push(`[ReviewClaims] 자사 리뷰가 있는 잡 — 최종 카피의 인증·의학 표현 ${reviewClaims.length}건(검출만) — copy_sections.review_claims 참조`)
  }
  if (deflections.length > 0 || deflectionKept.length > 0) {
    warnings.push(
      `[SpecFacts] 떠넘기는 문장 ${deflections.length}곳 제거` +
        (deflectionDropped.length > 0 ? `(빈 항목 ${deflectionDropped.length}개 뺌)` : '') +
        (deflectionKept.length > 0 ? ` · 비우면 섹션이 사라지는 칸 ${deflectionKept.length}곳은 남김` : '') +
        ' — copy_sections.deflection_removed 참조'
    )
  }
  if (echoWarning) warnings.push(echoWarning)
  if (parentProxy && parentProxy.remaining.length > 0) {
    warnings.push(`[ParentProxy] 아이 사용·반응 문장 잔여 ${parentProxy.remaining.length}건 — copy_sections.parent_proxy 참조`)
  }
  if (numberRemaining.length > 0) {
    warnings.push(`[CopyNumbers] 입력에 없는 숫자·단위 ${numberRemaining.length}건 — copy_sections.number_check 참조`)
  }
  if (similarityWarnings.length > 0) {
    warnings.push(`[SimilarityGate] 재생성 후에도 임계 초과 ${similarityWarnings.length}건 — copy_sections.similarity_warnings 참조`)
  }
  if (ageCompliance && (ageCompliance.violations.length > 0 || !ageCompliance.notice_present)) {
    warnings.push(
      `[AgeGate] 만 ${ageCompliance.min_age}세 이상 상품 — ` +
        (ageCompliance.violations.length > 0 ? `어린이 표현 잔여 ${ageCompliance.violations.length}건` : '') +
        (ageCompliance.violations.length > 0 && !ageCompliance.notice_present ? ' · ' : '') +
        (!ageCompliance.notice_present ? '연령 고지 문구 누락' : '') +
        ' — copy_sections.age_compliance 참조'
    )
  }

  // 카피 경고는 이 단계의 error 칸에만 남고 합성·완료가 지운다 — 실행 로그에도 한 줄 남긴다(Stage 3 되돌림·미신고가 보이게)
  if (warnings.length > 0) console.warn(`[registration/pdp-copy] 카피 단계 경고 ${warnings.length}건 — ${warnings.join(' | ')}`)
  return updatePdpJob(db, userId, job.id, {
    copySections: {
      final: finalCopy,
      ...(payload.stage1 ? { stage1: payload.stage1 } : {}),
      ...(payload.stage2 ? { stage2: payload.stage2 } : {}),
      ...(payload.stage3_changed_ratio !== undefined ? { stage3_changed_ratio: payload.stage3_changed_ratio } : {}),
      ...(payload.stage3 ? { stage3: payload.stage3 } : {}),
      ...(similarityWarnings.length > 0 ? { similarity_warnings: similarityWarnings } : {}),
      ...(ageCompliance ? { age_compliance: ageCompliance } : {}),
      ...(parentProxy ? { parent_proxy: parentProxy } : {}),
      ...(numberCheck ? { number_check: numberCheck } : {}),
      ...(competitorEcho ? { competitor_echo: competitorEcho } : {}),
      ...(factCorrections.length > 0 ? { fact_corrections: factCorrections } : {}),
      ...(repeatFindings.length > 0 ? { repeat_findings: repeatFindings } : {}),
      ...(copyFlow ? { copy_flow: copyFlow } : {}),
      ...(copyRhythm ? { copy_rhythm: copyRhythm } : {}),
      ...(copyRuleCheck ? { copy_rule_check: copyRuleCheck } : {}),
      ...(deflections.length > 0 ? { deflection_removed: deflections.slice(0, DEFLECTION_RECORD_MAX) } : {}),
      ...(deflectionDropped.length > 0 ? { deflection_dropped_items: deflectionDropped.slice(0, DEFLECTION_RECORD_MAX) } : {}),
      ...(deflectionKept.length > 0 ? { deflection_kept: deflectionKept.slice(0, DEFLECTION_RECORD_MAX) } : {}),
      ...(reviewClaims.length > 0 ? { review_claims: reviewClaims } : {}),
    },
    error: warnings.length > 0 ? warnings.join(' | ') : null,
    currentStep: 'images',
    progress: PDP_STEP_PROGRESS.images,
    costUsd,
    ...(corpusVersion ? { corpusVersion } : {}),
  })
}

/**
 * 새 단계 카피 뒤 사실 감사(R10) — 카피가 끝난 run 다음 run 하나에서 감사만 부르고 copy_sections.fact_audit에 키만 더한다.
 * 기록+경고만(카피를 고치지 않는다). 실패도 기록하고 이미지로 넘어간다
 */
async function stepCopyFactAudit(db: SupabaseClient, userId: string, job: PdpJobRow): Promise<PdpJobRow> {
  const record = await runCopyFactAuditStage(job, buildRunContext(userId, job, 'copywriting'), Date.now() + PDP_NEW_BATCH_STAGE_DEADLINE_MS)
  logNewStage(job.id, record)
  return updatePdpJob(db, userId, job.id, {
    copySections: { ...job.copy_sections, fact_audit: record },
    currentStep: 'images',
    progress: PDP_STEP_PROGRESS.images,
    costUsd: job.cost_usd + recordCost(record),
  })
}

/** 합성 단계 — composePdp(순수 함수) → final_html 저장 → Track I는 trust gate 후처리(결정 T-6,
 *  경고만·차단 없음) → draft 연결 시 form 반영 → done. */
async function stepCompose(db: SupabaseClient, userId: string, job: PdpJobRow): Promise<PdpJobRow> {
  const runStart = Date.now()
  const copy = job.copy_sections.final
  if (!copy) {
    return recordStepFailure(db, userId, job.id, 'compose', job.error, '합성 단계 진입 — 카피 산출이 없습니다(잡 상태 불일치)')
  }
  const images = toGeneratedImagesMap(job.section_images)

  // Track I(결정 T-5): v2 스냅샷이 있으면 내재화 테마(실측 타이포·배경·패딩)를 합성에 주입 + trust gate 보고서.
  // ENRICHMENT 기록 잡은 정정 매핑 테마와 확장 보고서(v2 없는 카테고리도 pooled로 항상 생성) — pdp-enrichment-stage.
  // 기록 잡 품질 보고서(설계 §4.6, T4b) — 편집기 최초 빌드를 한 번 만들어 런타임 가드 탈락·장식 렌더 결과를 센다.
  // 측정이 실패하면 그 수치만 빠지고 합성은 계속된다.
  const render = usesEnrichedMapping(job) ? await measureEditorBuild(job).catch(() => null) : null
  const { themeStyles, qualityReport } = resolveComposeTrackI(job, copy.designPalette ?? null, render?.stats ?? null)

  const { finalHtml } = composePdp({
    mode: job.mode,
    copy,
    images,
    sectionPlan: job.section_plan,
    strategyContract: resolveStrategyContract(job),
    specSheet: job.spec_sheet,
    ...(themeStyles ? { themeStyles } : {}),
  })

  // Track I 후처리 — trust gate(순수 함수) 결과 + 골격 제외 근거를 quality_report로 기록(부록 F-2).
  const copySectionsPatch: Partial<CopySectionsPayload> | undefined = qualityReport
    ? attachQualityReport(job.copy_sections, qualityReport)
    : undefined

  // 새 단계 첫 화면 심사·최종 검수(R10) — 합성 뒤 done 전, 새 배치 + newstages 잡만(꺼진 잡은 null — 저장 그대로). 기록+경고만
  const reviews = await runComposeReviewStages(job, buildRunContext(userId, job, 'compose'), runStart + RUN_TIME_BUDGET_MS)
  if (reviews) {
    logNewStage(job.id, reviews.first_screen)
    logNewStage(job.id, reviews.final_review)
  }

  if (job.draft_id) {
    // 디자인 컷 배경 플레이트(D1)는 제품이 없는 무대라 드래프트 상세 이미지에 넣지 않는다
    const imageUrls = job.section_images.filter((s) => s.url && !isPlateTask(s)).map((s) => s.url)
    await appendDraftDetailAssets(db, userId, job.draft_id, finalHtml, imageUrls)
  }

  return updatePdpJob(db, userId, job.id, {
    finalHtml,
    ...(copySectionsPatch ? { copySections: copySectionsPatch } : {}),
    ...(reviews
      ? {
          sectionPlan: { ...job.section_plan, first_screen: reviews.first_screen, final_review: reviews.final_review },
          costUsd: job.cost_usd + reviews.costUsd,
        }
      : {}),
    currentStep: 'done',
    progress: PDP_STEP_PROGRESS.done,
    error: null,
  })
}

/**
 * 잡 스냅숏(생성 때 단계 모델)과 지금 표가 다르면 경고 줄 — 잡 도중 배포로 단계 모델이 섞였는지 대조한다(R03). 동작은 바꾸지 않는다
 */
function warnRouteSnapshotDrift(job: PdpJobRow, batch: PdpModelBatch): void {
  if (!job.model_route_snapshot) return
  const drift = diffRouteSnapshot(job.model_route_snapshot as PdpRouteSnapshot, snapshotPdpRoutes(batch))
  if (drift.length > 0) {
    console.warn(`[registration/pdp-pipeline] 잡 ${job.id} 단계 모델이 생성 때 스냅숏과 다릅니다(${batch} 배치): ${drift.join(', ')}`)
  }
}

/**
 * run 1스텝 실행 — 잡을 조회해 산출물 기준으로 다음 단계를 판정하고 그 단계만 수행한다.
 * 월 $50 예산 소진·단계 내부 실패·예기치 못한 예외는 전부 recordStepFailure를 거친다 — 같은 단계에서
 * MAX_STEP_FAILURES회 연속 실패하면 current_step='failed'로 전이하고, 그 전까지는 error에 재시도
 * 카운트만 인코딩한 채 current_step은 실패 단계에 머무른다(resolveStepToRun이 JSONB 기준으로 같은
 * 단계를 다음 run에 다시 고른다 — failed 전이 이후에도 동일한 재개 규칙이 그대로 적용된다).
 */
export async function runPdpStep(jobId: string, userId: string): Promise<PdpJobRow> {
  const db = createAdminClient()
  const job = await getPdpJob(db, userId, jobId)
  if (!job) throw new Error(`PDP 잡을 찾을 수 없습니다: ${jobId}`)
  if (job.current_step === 'done') return job
  // 멈춘 구독 멈춤 표지 잡(AX-CT-29)은 '이어 하기'(resume)가 멈춤 기록을 지울 때까지 진행하지 않는다 — 작업자가 틱 처음에 읽어 둔
  // 큐로 나중에 멈춘 잡에 와도 한 단계를 더 돌려 멈춤 기록을 덮지 않게(덮이면 사건이 열린 채 남고 resume이 409). 표지 없는 잡은 그대로
  if (job.subscription_stop && job.section_plan.subscription_halt) return job
  // 다른 곳이 진행 중이면 예산 조회도 하지 않고 돌려준다(화면이 잠시 뒤 다시 부른다 — run 라우트 busy)
  if (isPdpJobLeased(job)) return job

  const step = resolveStepToRun(job)

  // 잡당 비용 상한(점검 고침 5·R04) — 첫 생성의 실제 청구액이 상한을 넘었으면 이미지 앞 단계는 다시 해도 몫이 없으니 재시도 없이 멈춘다.
  // images는 남은 몫 예약이 막힌 컷을 실패 컷으로 정리하고, compose는 돈을 쓰지 않아 여기서 막지 않는다(job-cost-cap)
  const capStop = jobCostCapStop(job, step)
  if (capStop) {
    console.warn(`[registration/pdp] ${capStop} (${jobId.slice(0, 8)}·${step})`)
    return updatePdpJob(db, userId, jobId, { currentStep: 'failed', error: capStop })
  }

  // 시험 잡은 시험 풀 상한으로 판정한다(운영 월 한도와 따로)
  const budget = await checkMonthlyBudget(
    'registration/pdp-pipeline',
    'claude-sonnet-5-5',
    usageCostPoolOf(job),
  )
  if (!budget.allowed) {
    // 조회 실패(degraded)는 '소진'이 아니다 — 지출 $0.00으로 잘못 알리지 않는다(점검 고침 5). 일시 장애라 재시도 규칙은 같다
    const message = budget.degraded
      ? `AI 예산 조회 실패 — 잡을 멈춥니다(조회가 돌아오면 다시 진행). 원인: ${(budget.degradedReason ?? '알 수 없음').slice(0, 120)}`
      : `${budget.costPool ? '상세페이지 시험 예산' : '월 AI 예산'}($${budget.budgetUsd}) 소진 — 당월 지출 $${budget.spentUsd.toFixed(2)}. 잡 실행이 차단됩니다.`
    return recordStepFailure(db, userId, jobId, step, job.error, message)
  }

  // 잡 진행 잠금 — 다른 곳(탭 두 개·작업자)이 이 잡을 진행 중이면 아무것도 하지 않고 지금 상태를 돌려준다(지출 두 배 방지).
  // 잠금은 각 단계의 마지막 저장이 푼다(images 단계 중간 저장만 기한을 유지 — pdp-jobs claimPdpJobRun)
  const claimed = await claimPdpJobRun(db, userId, job)
  // 쥐지 못했다 — 그사이 다른 곳이 쥐었거나 저장했다. 다시 읽은 지금 상태를 돌려준다(읽어 둔 값을 돌려주면 잠금이 안 보여
  // 화면이 busy 대신 정체로 보고 멈춘다)
  if (!claimed) return (await getPdpJob(db, userId, jobId)) ?? job
  const lease = claimed.leaseUntil ? { leaseUntil: claimed.leaseUntil } : {}

  // 실행 시작 시점에 current_step을 활성 단계로 갱신 — 실행 중 폴링 GET이 직전 완료 단계가 아니라
  // 지금 실제로 도는 단계를 보게 한다(§6.4). progress는 각 stepX가 완료 시 다음 단계 값으로 전진시키므로
  // 여기서는 손대지 않는다. 이미 같은 값이면(images 단계 반복 run 등) 불필요한 쓰기를 건너뛴다.
  // 'done'(산출이 이미 다 있다)은 이 기록이 마지막 저장이라 잠금을 싣지 않는다 — 쥔 채 돌려주면 화면이 잠금 기한까지 기다린다.
  // 진행률·오류도 끝으로 맞춘다(편집기 재생성 뒤 images → done은 compose를 거치지 않는다 — 그사이 단계 실패 기록이 남지 않게).
  // 이 기록도 try 안 — 실패하면 실패 기록이 잠금을 푼다
  let activeJob = claimed.job
  // 구독 → API 잇기 기록(R13 구독 표지 잡만 — agents/llm/subscription-fallback) — 단계가 실패해도 모은 만큼 잡에 남긴다
  const fallbacks: SubscriptionFallbackRecord[] = []
  let finished: PdpJobRow
  try {
    if (claimed.job.current_step !== step) {
      activeJob = await updatePdpJob(db, userId, jobId, {
        currentStep: step,
        ...(step === 'done' ? { progress: PDP_STEP_PROGRESS.done, error: null } : lease),
      })
    }
    // 잡 모델 배치(R03)·LLM 백엔드(R13) — 단계 안의 pdpRoute가 이 배치·백엔드로 단계 route를 고른다(지금 배치·API = 지금과 같다,
    // pdp-model-batch-context). 구독 표지 잡은 새 배치 Claude·GPT 단계를 구독으로 부르고 막히면 API로 잇는다
    const batch = activeJob.model_batch ?? 'now'
    const backend = activeJob.model_backend ?? 'api'
    warnRouteSnapshotDrift(activeJob, batch)
    finished = await runWithPdpBatch(batch, () => collectSubscriptionFallbacks(fallbacks, async () => {
      switch (step) {
        case 'analysis':
          return await stepAnalysis(db, userId, activeJob)
        // 학부모 대리 구매형 기록 잡은 빈 targetPersona에 기본 학부모 페르소나를 채운 입력으로(저장하지 않는다) — 아니면 같은 잡
        case 'research':
          return await stepResearch(db, userId, withAudienceStageSpec(activeJob))
        case 'design':
          return await stepDesign(db, userId, withAudienceStageSpec(activeJob))
        case 'copywriting':
          return await stepCopywriting(db, userId, withAudienceStageSpec(activeJob))
        case 'images':
          // 첫 화면 실패로 멈춘 잡의 '이 단계부터 재시도'는 첫 화면 컷을 처음부터 다시 만든다(pdp-image-stage heroLost)
          return await runImagesStep(db, userId, activeJob, { ...lease, ...(job.current_step === 'failed' ? { retryLostHero: true } : {}) })
        case 'compose':
          return await stepCompose(db, userId, activeJob)
        default:
          return activeJob
      }
    }), backend, activeJob.subscription_stop === true)
  } catch (e) {
    // 잠금을 잃었다(기한이 지나 다른 곳이 쥐었다, pdp-jobs PdpLeaseLostError) — 실패로 기록하면 지금 쥔 쪽의 잠금을 푼다.
    // 지금 상태만 돌려준다(잇기 기록도 쓰지 않는다). 이름으로 판별한다(잡 모듈을 모의하는 시험에서도 같은 경로)
    if (e instanceof Error && e.name === 'PdpLeaseLostError') return (await getPdpJob(db, userId, jobId)) ?? activeJob
    // 구독 백엔드 소프트 종료(한도 소진·시간 초과·미등록, agents/llm LlmSoftStopError) — 실패로 세지 않는다(재개 가능, API로
    // 넘어가지 않는다 — 결정 E). 사유만 남기고 이 저장으로 잠금을 푼다. 하네스가 run 사이에 보고 멈추고, 재개는 오너가 정한다
    // (구독 표지 잡은 API로 이으므로 여기 오지 않는다)
    const softStop = softStopOf(e)
    if (softStop && activeJob.subscription_stop) {
      // 구독 멈춤 표지 잡(AX-CT-29) — 멈춤 기록(section_plan.subscription_halt)·error 한 줄·사건 줄을 남기고 멈춘다(API로 잇지 않는다).
      // 소프트 종료 기록은 이 프로세스에 남기지 않는다 — 멈춤은 잡에 저장돼 있고, 이어 하기 뒤 구독을 다시 부를 수 있어야 한다
      finished = await haltStopJobAfterSoftStop(db, userId, activeJob, softStop, step)
      if (softStop.backend) clearLocalLlmSoftStop(softStop.backend as LocalLlmBackendId)
    } else if (softStop) {
      finished = await updatePdpJob(db, userId, jobId, { error: `[${step}] ${(e as Error).message}` })
    } else {
      const message = e instanceof Error ? e.message : String(e)
      finished = await recordStepFailure(db, userId, jobId, step, activeJob.error, `[${step}] ${message}`)
    }
  }
  return recordSubscriptionFallbacks(db, userId, finished, fallbacks)
}
