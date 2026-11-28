/**
 * 편집기 카피 재생성 검사·흐름(pdp-copy-regen-api) — 라우트의 GET(사전 조회)·POST(즉시 처리)가 같이 쓴다. DB·LLM은 deps로 받는다.
 * 막히는 사유는 세 가지다: 진행 잠금(busy — 이미지 생성 중이면 busyKind 'images')·완료 전 잡(not_ready)·월 예산(budget).
 *
 * POST 흐름: 진행 잠금을 쥔다(claimPdpJobRun — 중복 클릭·동시 요청의 이중 과금을 막고, 그사이 run이 잡을 쥐지 못하게) → 1콜 →
 * 가드 → 잠금 시각 조건(updatePdpJobIfUnchanged)으로 비용·기록을 저장하며 푼다. 그 저장이 어긋나면(호출이 잠금 기한을 넘겨
 * 다른 곳이 쓴 경우) 다시 읽어 잠기지 않았을 때만 그 행에 다시 쓴다 — 다른 run이 쥔 잠금은 풀지 않는다. 그래도 못 쓰면
 * recorded false로 돌려준다(호출 비용은 시도마다 ai_usage_log에 이미 남았다).
 * 잡 cost_usd에 더하는 값은 공급자가 알려 준 비용이다 — 공용 callAgent는 모든 시도가 실패하면 0, 성공하면 마지막 시도 비용만
 * 돌려준다(파싱 실패 시도의 비용은 ai_usage_log에만 있다). 다른 단계와 같은 공용 한계라 여기서 따로 셈하지 않는다(검수 지적).
 */

import type { BudgetStatus } from '@/lib/agents/budget'
import { llmCostPer1k } from '@/lib/agents/llm'
import type { CopyRegenModelResult } from '@/lib/agents/registration/pdp-copy-regen-agent'
import {
  buildCopyRegenSystemPrompt,
  buildCopyRegenUserPrompt,
  type CopyRegenPromptInput,
} from '@/lib/agents/registration/prompts/pdp-copy-regen-prompts'
import { isAgeRestricted } from './compliance-gate'
import { guardCopyCandidates, type CopyGuardContext } from './pdp-copy-regen-guard'
import {
  appendCopyRegenRecord,
  type CopyRegenBlock,
  type CopyRegenEstimate,
  type CopyRegenRequestBody,
  type CopyRegenResponse,
  type CopyRegenTone,
  type EditorCopyRegenRecord,
} from './pdp-copy-regen'
import { persuasionOf, resolveClaimGuardBlock } from './pdp-enrichment-stage'
import { reviewClaimBlockFor } from './reviews/review-claims'
import { isPdpJobLeased } from './pdp-jobs'
import { pdpRoute } from './pdp-model-routes'
import { competitorEchoGuard } from './pdp-review-stage'
import { buildCopyFacts, buildCopyFactsBlock } from './copy-facts'
import { buildSpecFactsBlock } from './spec-facts'
import { buildUsageStepsFactsBlock, usageStepsForCopy } from './usage-steps-facts'
import { designcutEnabled } from './internalized/designcut-plan'
import type { PdpJobRow, SectionPlan } from './pdp-state'
import { mergeManualStrategy } from './pdp-strategy-contract'
import { loadCorpusCheck, mergeCorpusChecks } from './similarity-gate'
import { referenceCorpusCheck } from './references/reference-inputs'

const STAGE = 'copy/editor-regen' as const
/** callCopyRegenModel maxRetries 1 — 최악 두 번 과금 */
const MAX_ATTEMPTS = 2
/** 잠금 시각 저장이 어긋난 뒤 다시 읽어 쓰는 횟수 */
const SETTLE_RETRIES = 2

/** NEXFIT은 tone 없으면 persuasion_axis를 그대로 키로 썼다(emotion·function은 키가 없어 balanced) — 같은 뜻의 키로 잇는다 */
const AXIS_TONE: Record<string, CopyRegenTone> = { emotion: 'emotional', function: 'functional', balanced: 'balanced' }

export interface CopyRegenContext {
  prompts: { system: string; user: string }
  estimate: CopyRegenEstimate
  guard: CopyGuardContext
}

/** 입력 토큰은 글자 수 × 2로 넉넉히 잡는다(드문 한글 음절은 1자가 토큰 여럿이 된다). 출력은 상한 전부 */
const TOKENS_PER_CHAR = 2

export function estimateCopyRegen(prompts: { system: string; user: string }): CopyRegenEstimate {
  const route = pdpRoute(STAGE)
  const cost = llmCostPer1k(route.model)
  const inputTokens = (prompts.system.length + prompts.user.length) * TOKENS_PER_CHAR
  const perAttempt = (inputTokens / 1000) * cost.input + (route.maxTokens / 1000) * cost.output
  return { model: route.model, billed: true, maxUsd: Math.round(perAttempt * MAX_ATTEMPTS * 10_000) / 10_000 }
}

/**
 * 코퍼스가 깨졌으면(loadCorpusCheck fail-closed 예외) 판정 불가로 넘긴다 — 후보는 모두 unjudged.
 * 레퍼런스(own 제외) 원문이 있으면 잡 단위 임시 코퍼스를 더한다(카피 단계와 같은 비교 대상)
 */
function loadCorpus(category: string, spec: PdpJobRow['spec_sheet']): CopyGuardContext['corpus'] {
  try {
    return mergeCorpusChecks(loadCorpusCheck(category), referenceCorpusCheck(spec))
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** 프롬프트·추정·가드 문맥 — 카피 단계와 같은 잡 기록(전략·주장 범위·연령·코퍼스 카테고리·경쟁사 리뷰)에서 만든다 */
export function buildCopyRegenContext(job: PdpJobRow, body: CopyRegenRequestBody): CopyRegenContext {
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  const minAge = isAgeRestricted(job.spec_sheet) ? (job.spec_sheet.minAgeYears ?? null) : null
  // 사실 값(pdp-copy-facts-r4) — 한 칸 재생성도 옵션 개수를 지어낼 수 있어 카피 단계와 같은 블록·가드를 쓴다
  const facts = buildCopyFacts(job.spec_sheet)
  // 상품 사실(W2b) — 카피 단계와 같은 조건(새 입력 필드·기록 잡)과 같은 블록. 사용 순서(G-U1)도 카피 단계와 같은 조건·블록
  const factsBlock = [
    buildCopyFactsBlock(facts),
    buildSpecFactsBlock(job.spec_sheet, { recorded: persuasionOf(job) !== null }),
    buildUsageStepsFactsBlock(usageStepsForCopy(job.spec_sheet, designcutEnabled(job))),
  ]
    .filter(Boolean)
    .join('\n\n')
  const input: CopyRegenPromptInput = {
    sectionType: body.sectionType,
    ...(body.elementName ? { elementName: body.elementName } : {}),
    currentText: body.currentText,
    ...(body.note ? { note: body.note } : {}),
    tone: body.tone ?? AXIS_TONE[strategy.persuasion_axis ?? ''] ?? 'balanced',
    brandVoice: strategy.brand_voice,
    targetPersona: strategy.target_persona,
    claimGuardBlock: resolveClaimGuardBlock(job),
    // 후기 사용 범위(R6) — 카피 단계와 같은 조건(자사 리뷰가 있는 모든 잡)과 같은 블록
    reviewClaimBlock: reviewClaimBlockFor(job.spec_sheet),
    minAge,
    ...(factsBlock ? { factsBlock } : {}),
  }
  const prompts = { system: buildCopyRegenSystemPrompt(input), user: buildCopyRegenUserPrompt(input) }
  return {
    prompts,
    estimate: estimateCopyRegen(prompts),
    guard: {
      currentText: body.currentText,
      corpus: loadCorpus(job.analysis.detected_category ?? '', job.spec_sheet),
      echoGuard: competitorEchoGuard(job),
      minAge,
      ...(facts ? { facts } : {}),
    },
  }
}

/** 이미지 생성 중(images 단계 — 로컬 실행기 포함)이면 그렇게 알린다(편집기가 구분해 보여 준다) */
export function copyRegenBusyBlock(job: Pick<PdpJobRow, 'current_step'>): CopyRegenBlock {
  if (job.current_step === 'images') {
    return { code: 'busy', busyKind: 'images', error: '이미지 생성 중이라 잠시 뒤 다시 시도해 주세요.' }
  }
  return { code: 'busy', busyKind: 'job', error: '이 잡을 다른 곳이 진행 중입니다. 잠시 뒤 다시 시도해 주세요.' }
}

/** 잠금 판단은 이미지 재생성과 같다 — 기한이 미래이기만 해도 막는다(pdp-image-regen-request isBusy) */
function isBusy(job: PdpJobRow, now: number): boolean {
  if (isPdpJobLeased(job, now)) return true
  const at = Date.parse(job.updated_at)
  return Number.isFinite(at) && at > now
}

export function planCopyRegen(job: PdpJobRow, now = Date.now()): CopyRegenBlock | null {
  if (!job.copy_sections.final || !job.final_html) {
    return { code: 'not_ready', error: '생성이 한 번 끝난 잡만 카피를 다시 만들 수 있습니다.' }
  }
  if (isBusy(job, now)) return copyRegenBusyBlock(job)
  return null
}

/** 월 예산 — 이미지 재생성(regenBudgetBlock)과 같은 규칙: 지출을 못 읽었거나 한도가 찼거나 남은 한도가 상한 추정보다 작으면 막는다 */
export function copyRegenBudgetBlock(estimate: CopyRegenEstimate, budget: BudgetStatus): CopyRegenBlock | null {
  if (budget.degraded) {
    return {
      code: 'budget',
      error: '월 AI 예산 지출을 읽지 못해 지금은 다시 만들 수 없습니다. 잠시 뒤 다시 시도해 주세요.',
    }
  }
  if (!budget.allowed) {
    return {
      code: 'budget',
      error: `월 AI 예산 한도 — 당월 지출 $${budget.spentUsd.toFixed(2)} / $${budget.budgetUsd}`,
    }
  }
  const agentLeft =
    budget.agentBudgetUsd != null && budget.agentSpentUsd != null
      ? budget.agentBudgetUsd - budget.agentSpentUsd
      : Number.POSITIVE_INFINITY
  const headroom = Math.min(budget.budgetUsd - budget.spentUsd, agentLeft)
  if (estimate.maxUsd <= headroom) return null
  return {
    code: 'budget',
    error: `월 AI 예산 남은 한도($${Math.max(0, headroom).toFixed(2)})가 이 재생성 최대 비용($${estimate.maxUsd.toFixed(2)})보다 작습니다.`,
  }
}

export interface CopyRegenFlowDeps {
  claim: (job: PdpJobRow) => Promise<{ job: PdpJobRow; leaseUntil: string | null } | null>
  callModel: (prompts: { system: string; user: string }) => Promise<CopyRegenModelResult>
  saveIfUnchanged: (job: PdpJobRow, patch: { sectionPlan: SectionPlan; costUsd: number }) => Promise<PdpJobRow | null>
  reload: () => Promise<PdpJobRow | null>
  now?: () => number
}

export type CopyRegenFlowResult =
  | { kind: 'blocked'; block: CopyRegenBlock; costUsd: number; recorded: boolean }
  | { kind: 'done'; response: CopyRegenResponse }

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** 이미 그 기록이 들어간 행인가 — 저장 응답만 잃은 경우(쓰기는 됐다) 비용·기록을 두 번 더하지 않게 */
function hasRecord(job: PdpJobRow, record: EditorCopyRegenRecord): boolean {
  return (job.section_plan.editor_copy_regen ?? []).some(
    (r) => r.at === record.at && r.sectionType === record.sectionType
  )
}

/**
 * 비용·기록 저장 — 잠금을 쥔 행에 먼저 쓴다. 어긋나거나(0행) 저장이 예외면 다시 읽어, 이미 들어갔으면 끝내고, 잠기지 않았을 때만
 * 그 최신 행에 다시 쓴다(다른 run이 쥔 잠금은 풀지 않는다). 예외로 잠금이 기한까지 남지 않게 한 번 더 시도하는 것이다(검수 지적)
 */
async function settle(claimed: PdpJobRow, record: EditorCopyRegenRecord, deps: CopyRegenFlowDeps): Promise<boolean> {
  const now = deps.now ?? Date.now
  const save = async (j: PdpJobRow): Promise<boolean> => {
    try {
      const patch = { sectionPlan: appendCopyRegenRecord(j.section_plan, record), costUsd: j.cost_usd + record.costUsd }
      return (await deps.saveIfUnchanged(j, patch)) !== null
    } catch (error) {
      console.warn('[pdp-copy-regen] 비용·기록 저장 실패', errorText(error))
      return false
    }
  }
  if (await save(claimed)) return true
  for (let i = 0; i < SETTLE_RETRIES; i++) {
    const fresh = await deps.reload().catch(() => null)
    if (!fresh) break
    if (hasRecord(fresh, record)) return true
    // 아직 우리 잠금 그대로면(쓰기 전 예외) 다시 쓴다 — 조건부 갱신이라 그사이 다른 곳이 쥐었으면 0행이다(검수 지적)
    const ours = Date.parse(fresh.updated_at) === Date.parse(claimed.updated_at)
    if (!ours && isBusy(fresh, now())) break
    if (await save(fresh)) return true
  }
  console.warn('[pdp-copy-regen] 잡 비용·기록을 남기지 못했습니다(ai_usage_log에는 있음)', {
    jobId: claimed.id,
    costUsd: record.costUsd,
  })
  return false
}

const REJECTED_MESSAGE = '후보가 모두 가드에 걸려 이전 카피를 유지합니다.'

type Outcome = Pick<CopyRegenResponse, 'status' | 'candidates' | 'rejected' | 'message'> & { budgetError?: string }

/** 1콜 → 가드. 호출 실패는 failed(예산 차단은 budgetError), 그 밖의 예외는 호출부가 failed로 바꾼다 */
async function produce(ctx: CopyRegenContext, deps: CopyRegenFlowDeps): Promise<{ outcome: Outcome; costUsd: number }> {
  let model: CopyRegenModelResult
  try {
    model = await deps.callModel(ctx.prompts)
  } catch (error) {
    model = { ok: false, error: errorText(error), stage: 'api', costUsd: 0 }
  }
  if (!model.ok) {
    const fail = { status: 'failed' as const, candidates: [], rejected: [] }
    if (model.stage === 'budget')
      return { outcome: { ...fail, message: model.error, budgetError: model.error }, costUsd: model.costUsd }
    return {
      outcome: { ...fail, message: `카피 재생성 호출 실패 — 이전 카피를 유지합니다: ${model.error}` },
      costUsd: model.costUsd,
    }
  }
  try {
    const { passed, rejected } = guardCopyCandidates(model.candidates, ctx.guard)
    const outcome: Outcome =
      passed.length > 0
        ? { status: 'ok', candidates: passed, rejected }
        : { status: 'rejected', candidates: [], rejected, message: REJECTED_MESSAGE }
    return { outcome, costUsd: model.costUsd }
  } catch (error) {
    return { outcome: failedOutcome(error), costUsd: model.costUsd }
  }
}

/** 잠금을 쥔 뒤의 예외(가드 등) — failed로 기록하며 잠금을 푼다(잠금이 기한까지 남아 잡이 막히지 않게, 검수 지적) */
function failedOutcome(error: unknown): Outcome {
  return {
    status: 'failed',
    candidates: [],
    rejected: [],
    message: `카피 재생성 처리 실패 — 이전 카피를 유지합니다: ${errorText(error)}`,
  }
}

export async function runCopyRegenFlow(
  job: PdpJobRow,
  body: CopyRegenRequestBody,
  ctx: CopyRegenContext,
  deps: CopyRegenFlowDeps
): Promise<CopyRegenFlowResult> {
  const now = deps.now ?? Date.now
  const claimed = await deps.claim(job)
  if (!claimed) {
    // 잠금을 쥐기 전에 읽은 단계가 아니라 지금 쥔 쪽으로 판단한다(그사이 images run이 쥐었을 수 있다 — 검수 지적)
    const fresh = await deps.reload().catch(() => null)
    return { kind: 'blocked', block: copyRegenBusyBlock(fresh ?? job), costUsd: 0, recorded: true }
  }

  const { outcome, costUsd } = await produce(ctx, deps).catch((error: unknown) => ({
    outcome: failedOutcome(error),
    costUsd: 0,
  }))
  const record: EditorCopyRegenRecord = {
    at: new Date(now()).toISOString(),
    sectionType: body.sectionType,
    ...(body.elementName ? { elementName: body.elementName } : {}),
    status: outcome.status,
    passed: outcome.candidates.length,
    reasons: [...new Set(outcome.rejected.map((r) => r.reason))],
    costUsd,
    ...(outcome.message ? { message: outcome.message } : {}),
  }
  const recorded = await settle(claimed.job, record, deps)
  if (outcome.budgetError)
    return { kind: 'blocked', block: { code: 'budget', error: outcome.budgetError }, costUsd, recorded }
  return {
    kind: 'done',
    response: {
      status: outcome.status,
      candidates: outcome.candidates,
      rejected: outcome.rejected,
      ...(outcome.message ? { message: outcome.message } : {}),
      costUsd,
      recorded,
      estimate: ctx.estimate,
    },
  }
}
