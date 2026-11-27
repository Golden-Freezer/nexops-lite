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

import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkMonthlyBudget } from '@/lib/agents/budget'
import type { RunContext } from '@/lib/agents/types'
import { runPdpAnalysis } from '@/lib/agents/registration/pdp-analysis-agent'
import { runPdpResearch } from '@/lib/agents/registration/pdp-research-agent'
import { planPdpSections, generatePdpDesignPrompts } from '@/lib/agents/registration/pdp-design-agent'
import { runPdpCopywriting } from '@/lib/agents/registration/pdp-copy-agent'
import {
  buildCopyGroundingBlock,
  buildDesignGroundingBlock,
  getCorpusVersion as getCorpusVersionV1,
} from './corpus'
import {
  buildInternalizedCopyBlock,
  buildInternalizedMobileRulesBlock,
  getCorpusSnapshotV2,
  getCorpusVersion as getCorpusVersionV2,
} from './corpus-v2'
import {
  buildAgeBanDirective,
  buildAgeComplianceCopyBlock,
  checkAgeCompliance,
  isAgeRestricted,
  stripChildReviewHighlights,
} from './compliance-gate'
import { buildSkeleton, enforceSkeleton, type SkeletonResult } from './internalized/pdp-internalized-skeleton'
import { buildInternalizedTheme } from './internalized/internalized-theme'
import { attachQualityReport, buildQualityReport } from './internalized/trust-gate'
import { buildSkeletonLockBlock } from '@/lib/agents/registration/prompts/pdp-internalized-prompts'
import { checkCopySimilarity, loadCorpusCheck } from './similarity-gate'
import { CATEGORY_TO_ESSENCE, mergeManualStrategy } from './pdp-strategy-contract'
import { getPdpJob, updatePdpJob } from './pdp-jobs'
import { runImagesStep } from './pdp-image-stage'
import { buildImageTasks, toGeneratedImagesMap } from './pdp-image-tasks'
import { composePdp } from './pdp-composer'
import {
  encodeStepFailure,
  MAX_STEP_FAILURES,
  PDP_STEP_PROGRESS,
  resolveGenerationTrack,
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
  }
}

/** 산출물 존재 여부로 다음 실행 단계를 판정 — current_step 문자열보다 이 판정을 신뢰한다(재개의 SSOT). */
export function resolveStepToRun(job: PdpJobRow): PdpStep {
  if (Object.keys(job.analysis).length === 0) return 'analysis'
  if (Object.keys(job.research_result).length === 0) return 'research'
  if (!job.section_plan.activated_sections?.length) return 'design'
  if (!job.copy_sections.final) return 'copywriting'
  if (buildImageTasks(job).some((t) => !job.section_images.some((e) => e.section === t.section && (e.url || e.error)))) {
    return 'images'
  }
  // 게이트 미달로 이월된 재생성 대기 항목이 남아있으면 전 태스크가 이미 (url||error)를 가졌더라도
  // images 단계를 다시 골라야 한다 — 그렇지 않으면 이 큐에 영원히 도달하지 못한다(§6.3).
  if (job.section_images.some((e) => e.pendingRegen)) return 'images'
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

async function stepAnalysis(db: SupabaseClient, userId: string, job: PdpJobRow): Promise<PdpJobRow> {
  const result = await runPdpAnalysis({
    specSheet: job.spec_sheet,
    reviewsSummary: job.spec_sheet.reviewsText?.trim() || '리뷰 데이터 없음',
    runContext: buildRunContext(userId, job, 'analysis'),
  })
  const costUsd = job.cost_usd + result.usage.cost
  if (!result.success) {
    return recordStepFailure(db, userId, job.id, 'analysis', job.error, result.error.message, costUsd)
  }
  return updatePdpJob(db, userId, job.id, {
    analysis: result.data.analysis,
    error: result.data.warnings.length > 0 ? result.data.warnings.join(' | ') : null,
    currentStep: 'research',
    progress: PDP_STEP_PROGRESS.research,
    costUsd,
  })
}

async function stepResearch(db: SupabaseClient, userId: string, job: PdpJobRow): Promise<PdpJobRow> {
  const result = await runPdpResearch({
    specSheet: job.spec_sheet,
    analysis: job.analysis,
    strategyContract: resolveStrategyContract(job),
    runContext: buildRunContext(userId, job, 'research'),
  })
  const costUsd = job.cost_usd + result.usage.cost
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
 * 디자인 단계 — 콜 ①(섹션설계) → 콜 ②(이미지 프롬프트) 순차, 원본 run() 순서 그대로.
 * Track S: 콜 ①에 코퍼스 그라운딩(참고 자료) 주입. Track I(결정 T-3): 골격을 buildSkeleton(순수 함수)이
 * 먼저 확정하고, 콜 ①은 골격 잠금 블록을 받아 섹션별 세부만 설계 — 응답이 골격을 바꾸면 enforceSkeleton이
 * 코드 레벨에서 복원한다. v2 스냅샷이 없는 카테고리는 standard 경로로 우아하게 폴백.
 */
async function stepDesign(db: SupabaseClient, userId: string, job: PdpJobRow): Promise<PdpJobRow> {
  const strategyContract = resolveStrategyContract(job)
  const essenceType = resolveEssenceType(job)

  const track = resolveGenerationTrack(job)
  const snapshotV2 = track === 'internalized' ? getCorpusSnapshotV2(job.analysis.detected_category) : null
  let skeleton: SkeletonResult | null = null
  let groundingBlock: string
  if (snapshotV2) {
    skeleton = buildSkeleton({ snapshot: snapshotV2, specSheet: job.spec_sheet, strategyContract })
    groundingBlock = `${buildSkeletonLockBlock(skeleton.activatedSections, skeleton.sectionOrder)}\n\n${buildInternalizedMobileRulesBlock()}`
  } else {
    if (track === 'internalized') {
      console.warn(
        `[pdp-pipeline] internalized 잡 ${job.id} — v2 스냅샷 없는 카테고리(${job.analysis.detected_category ?? '미감지'}) → standard 설계 경로 폴백`
      )
    }
    groundingBlock = buildDesignGroundingBlock(job.analysis.detected_category)
  }

  const planResult = await planPdpSections({
    analysis: job.analysis,
    research: job.research_result,
    strategyContract,
    specSheet: job.spec_sheet,
    essenceType,
    groundingBlock,
    runContext: buildRunContext(userId, job, 'design'),
  })
  const promptsResult = await generatePdpDesignPrompts({
    analysis: job.analysis,
    research: job.research_result,
    strategyContract,
    specSheet: job.spec_sheet,
    runContext: buildRunContext(userId, job, 'design'),
  })

  let sectionPlan = planResult.sectionPlan
  if (skeleton) {
    sectionPlan = enforceSkeleton(sectionPlan, skeleton)
    sectionPlan.internalized_skeleton = { roles: skeleton.roles, excluded: skeleton.excluded }
  }

  const costUsd = job.cost_usd + planResult.costUsd + promptsResult.costUsd
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

/** 카피라이팅 단계 — 카피 생성(코퍼스 그라운딩은 Stage 1/premium에만) → 유사도 게이트(H-1) → 위반 시 재생성 1회.
 *  Track I(§5 copywriting 행): v2 블록(copyTone 지시 + 패턴 전량)으로 교체 — Stage1만 주입하는 구조 보존 원칙은 동일. */
async function stepCopywriting(db: SupabaseClient, userId: string, job: PdpJobRow): Promise<PdpJobRow> {
  const strategyContract = resolveStrategyContract(job)
  const essenceType = resolveEssenceType(job)
  const category = job.analysis.detected_category ?? ''
  const internalizedBlock = resolveGenerationTrack(job) === 'internalized' ? buildInternalizedCopyBlock(category) : null
  const corpusVersion = internalizedBlock ? getCorpusVersionV2(category) : getCorpusVersionV1(category)
  // 연령 컴플라이언스(만 14세 이상 상품): 금지·고지 블록을 양 트랙 공통으로 말미에 강제 append
  const ageBlock = buildAgeComplianceCopyBlock(job.spec_sheet)
  const baseBlock = internalizedBlock ?? buildCopyGroundingBlock(category)
  const groundingBlock = ageBlock ? `${baseBlock}\n\n${ageBlock}` : baseBlock

  const input = {
    specSheet: job.spec_sheet,
    mode: job.mode,
    analysis: job.analysis,
    research: job.research_result,
    sectionPlan: job.section_plan,
    strategyContract,
    essenceType,
    runContext: buildRunContext(userId, job, 'copywriting'),
  }

  const result = await runPdpCopywriting({ ...input, groundingBlock })
  let costUsd = job.cost_usd + result.usage.cost
  if (!result.success) {
    return recordStepFailure(db, userId, job.id, 'copywriting', job.error, result.error.message, costUsd)
  }

  let payload = result.data
  let finalCopy: CopywritingResult = payload.final
  let similarityWarnings: Array<{ section: string; score: number }> = []

  const corpusCheck = loadCorpusCheck(category)
  if (corpusCheck) {
    const findings = checkCopySimilarity(finalCopy, corpusCheck)
    if (findings.length > 0) {
      const regen = await runPdpCopywriting({
        ...input,
        groundingBlock: `${groundingBlock}\n\n${buildSimilarityBanDirective(findings)}`,
      })
      costUsd += regen.usage.cost
      if (regen.success) {
        payload = regen.data
        finalCopy = regen.data.final
        const recheck = checkCopySimilarity(finalCopy, corpusCheck)
        similarityWarnings = recheck.map((f) => ({ section: f.section, score: f.score }))
      } else {
        // 재생성 콜 자체가 실패 — finalCopy는 최초 산출 그대로이므로 그 findings가 여전히 유효한
        // 위반이다. 여기서 승격하지 않으면 재생성 실패 시 경고가 통째로 소실된다.
        similarityWarnings = findings.map((f) => ({ section: f.section, score: f.score }))
      }
    }
  }

  // 연령 컴플라이언스 게이트(만 14세 이상 상품) — ③ 산출 후 검수: 리뷰 원문 발췌는 제거(재작성 불가),
  // 작성 카피 위반은 재생성 1회 지시, 잔여 위반·고지 누락은 경고로 표면화(차단 없음 — 유사도 게이트 계약 동일).
  let ageCompliance: CopySectionsPayload['age_compliance']
  if (isAgeRestricted(job.spec_sheet)) {
    const minAge = job.spec_sheet.minAgeYears!
    let stripped = stripChildReviewHighlights(finalCopy)
    finalCopy = stripped.copy
    let removedTotal = stripped.removed
    let check = checkAgeCompliance(finalCopy, minAge)
    if (check.violations.length > 0) {
      const regen = await runPdpCopywriting({
        ...input,
        groundingBlock: `${groundingBlock}\n\n${buildAgeBanDirective(check.violations, minAge)}`,
      })
      costUsd += regen.usage.cost
      if (regen.success) {
        payload = regen.data
        finalCopy = regen.data.final
        stripped = stripChildReviewHighlights(finalCopy)
        finalCopy = stripped.copy
        removedTotal += stripped.removed
        check = checkAgeCompliance(finalCopy, minAge)
        // 재생성으로 카피가 통째로 바뀌었으므로 유사도 게이트도 재검한다(순수 함수 — 비용 없음)
        if (corpusCheck) {
          similarityWarnings = checkCopySimilarity(finalCopy, corpusCheck).map((f) => ({
            section: f.section,
            score: f.score,
          }))
        }
      }
    }
    ageCompliance = {
      min_age: minAge,
      removed_review_highlights: removedTotal,
      notice_present: check.noticePresent,
      violations: check.violations,
    }
  }

  const warnings = [...payload.warnings]
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

  return updatePdpJob(db, userId, job.id, {
    copySections: {
      final: finalCopy,
      ...(payload.stage1 ? { stage1: payload.stage1 } : {}),
      ...(payload.stage2 ? { stage2: payload.stage2 } : {}),
      ...(payload.stage3_changed_ratio !== undefined ? { stage3_changed_ratio: payload.stage3_changed_ratio } : {}),
      ...(similarityWarnings.length > 0 ? { similarity_warnings: similarityWarnings } : {}),
      ...(ageCompliance ? { age_compliance: ageCompliance } : {}),
    },
    error: warnings.length > 0 ? warnings.join(' | ') : null,
    currentStep: 'images',
    progress: PDP_STEP_PROGRESS.images,
    costUsd,
    ...(corpusVersion ? { corpusVersion } : {}),
  })
}

/** 합성 단계 — composePdp(순수 함수) → final_html 저장 → Track I는 trust gate 후처리(결정 T-6,
 *  경고만·차단 없음) → draft 연결 시 form 반영 → done. */
async function stepCompose(db: SupabaseClient, userId: string, job: PdpJobRow): Promise<PdpJobRow> {
  const copy = job.copy_sections.final
  if (!copy) {
    return recordStepFailure(db, userId, job.id, 'compose', job.error, '합성 단계 진입 — 카피 산출이 없습니다(잡 상태 불일치)')
  }
  const images = toGeneratedImagesMap(job.section_images)

  // Track I(결정 T-5): v2 스냅샷이 있으면 내재화 테마(실측 타이포·배경·패딩)를 합성에 주입.
  const snapshotV2 =
    resolveGenerationTrack(job) === 'internalized' ? getCorpusSnapshotV2(job.analysis.detected_category) : null
  const themeStyles = snapshotV2 ? buildInternalizedTheme(snapshotV2, copy.designPalette ?? null) : undefined

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
  let copySectionsPatch: Partial<CopySectionsPayload> | undefined
  if (snapshotV2) {
    copySectionsPatch = attachQualityReport(job.copy_sections, buildQualityReport(job.section_plan, snapshotV2))
  }


  return updatePdpJob(db, userId, job.id, {
    finalHtml,
    ...(copySectionsPatch ? { copySections: copySectionsPatch } : {}),
    currentStep: 'done',
    progress: PDP_STEP_PROGRESS.done,
    error: null,
  })
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

  const step = resolveStepToRun(job)

  const budget = await checkMonthlyBudget(
    'registration/pdp-pipeline',
    'claude-sonnet-5',
  )
  if (!budget.allowed) {
    return recordStepFailure(
      db,
      userId,
      jobId,
      step,
      job.error,
      `월 AI 예산($${budget.budgetUsd}) 소진 — 당월 지출 $${budget.spentUsd.toFixed(2)}. 잡 실행이 차단됩니다.`
    )
  }

  // 실행 시작 시점에 current_step을 활성 단계로 갱신 — 실행 중 폴링 GET이 직전 완료 단계가 아니라
  // 지금 실제로 도는 단계를 보게 한다(§6.4). progress는 각 stepX가 완료 시 다음 단계 값으로 전진시키므로
  // 여기서는 손대지 않는다. 이미 같은 값이면(images 단계 반복 run 등) 불필요한 쓰기를 건너뛴다.
  const activeJob = job.current_step === step ? job : await updatePdpJob(db, userId, jobId, { currentStep: step })

  try {
    switch (step) {
      case 'analysis':
        return await stepAnalysis(db, userId, activeJob)
      case 'research':
        return await stepResearch(db, userId, activeJob)
      case 'design':
        return await stepDesign(db, userId, activeJob)
      case 'copywriting':
        return await stepCopywriting(db, userId, activeJob)
      case 'images':
        return await runImagesStep(db, userId, activeJob)
      case 'compose':
        return await stepCompose(db, userId, activeJob)
      default:
        return activeJob
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return recordStepFailure(db, userId, jobId, step, activeJob.error, `[${step}] ${message}`)
  }
}
