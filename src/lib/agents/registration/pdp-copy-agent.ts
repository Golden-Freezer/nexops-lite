/**
 * PDP 파이프라인 4단계(카피라이팅) 에이전트 — NEXFIT agents/copywriting_agent.py 이식.
 * SSOT: docs/plans/registration-tab/PROMPT-INVENTORY.md §4.
 *
 * 모드 분기(run() :1213-1699 순서 보존):
 *   premium: PREMIUM_COPYWRITING_PROMPT 1콜(Sonnet 5.5) → 공통 후처리
 *   pro:     Stage 1(PREMIUM 프롬프트 재사용, Sonnet 5.5) → Stage 2(GPT, 모델 계층 copy/stage2, 실패 시 Stage 1
 *            유지) → Stage 3(Sonnet 5.5, 실패 시 Stage 2 유지) → 필드 무결성 강제 → 공통 후처리
 * 공통 후처리 = 정화 → 기본값 병합 → empathy 검증 → pointCards 검증(미달 시 LLM 1회 재생성 → 로컬
 * 폴백) → reviewHighlights 원문 대조 → (pro) 인증/이벤트 템플릿 카피 → V4.3 파생 필드.
 *
 * 전략 지시 블록(buildStrategyDirectionBlock)·groundingBlock은 premium/Stage 1에만 append —
 * Stage 2·3은 구조 보존 단계라 재해석을 허용하지 않는다(결정 H, copywriting_agent.py:1080-1081).
 * LLM이 끝까지 실패해도 잡은 실패시키지 않는다 — 정적 기본 카피로 폴백하고 warnings로 표면화한다.
 */

import { billedCostOf, billedUsageOf } from '../billed-usage'
import type { AgentOutput, AgentUsage, RunContext } from '../types'
import { callLlm } from '../llm'
import { assertSubscriptionReady } from '../llm/providers/codex-cli'
import { pdpRoute, type PdpModelRoute } from '@/lib/registration/pdp-model-routes'
import type { SlotCopyCallTrace } from './pdp-template-copy-agent'
import { parseLlmJson, parseLlmJsonArray } from '../json-parser'
import {
  buildPremiumCopywritingPrompt,
  buildStrategyDirectionBlock,
  buildRetryPointcardsPrompt,
  stripExampleHexColors,
} from './prompts/pdp-copy-prompts'
import { buildStage2StorytellingPrompt, buildStage3QualityGatePrompt } from './prompts/pdp-copy-pro-prompts'
import { applyFeatureOwnershipToStage3 } from './prompts/pdp-internalized-prompts'
import { buildRepeatFixBlock, findCrossSectionRepeats, repeatExclusionTerms } from '@/lib/registration/copy-repeats'
import { buildCopyRuleFixBlock, findCopyRuleViolations } from '@/lib/registration/copy-rule-check'
import { buildFlowFixBlock, findCopyFlowIssues } from '@/lib/registration/copy-flow-check'
import { buildHookShortFixBlock, findHookShortIssues, HOOK_SHORT_TARGETS, HOOK_SHORT_WRITE_BLOCK } from '@/lib/registration/copy-hook-short'
import { buildRhythmFixBlock, findCopyRhythmIssues, RHYTHM_WRITE_BLOCK } from '@/lib/registration/copy-rhythm-check'
import { DESIGN_ACCENT_WRITE_BLOCK, DESIGN_COPY_WRITE_BLOCK, DESIGN_HOOK_MODE_BLOCKS, keepStage2Accents } from '@/lib/registration/copy-design-rules'
import { stage3FixTargets } from '@/lib/registration/stage3-fix-targets'
import { DEFAULT_BRAND_VOICE_GUIDE } from './prompts/pdp-research-prompts'
import { CLAIM_GUARD_QUALITY_GATE_LEAD, CLAIM_GUARD_REWRITE_LEAD } from './prompts/pdp-claim-guard-prompts'
import {
  PRO_ONLY_OVERLAY_FIELDS,
  isPlainObject,
  ensureList,
  zeroUsage,
  addUsage,
  mergeWithDefaults,
  appendGroundingBlock,
  buildSpecSheetJson,
  buildReviewsAnalysisSection,
  buildBrandColorInstruction,
  enforceBrandPalette,
  FALLBACK_CLOSING_CTA,
  getDefaultCopyData,
  buildSectionGuide,
} from './pdp-copy-defaults'
import { sanitizeCopyData, validateEmpathyLines } from '@/lib/registration/pdp-copy-sanitize'
import { normalizeCompareItems } from '@/lib/registration/pdp-copy-labels'
import {
  validatePointCards,
  filterValidPointCards,
  generateFallbackPointcards,
  fallbackCopyTerm,
  enforceStage3FieldIntegrity,
  deriveV43Fields,
  type PointCard,
} from '@/lib/registration/pdp-copy-rules'
import { generateCertificationCopy, generateEventBannerCopy } from '@/lib/registration/pdp-pro-copy-templates'
import { validateReviewQuotes, pickQuoteFallbacks } from '@/lib/registration/review-scrubber'
import { quoteCardHighlights, reviewSummaryEnabled } from '@/lib/registration/reviews/review-quote-cards'
import { finishExcerptHighlights, pickSummaryFallbacks, withoutLowRatedExcerpts } from '@/lib/registration/reviews/review-excerpts'
import type {
  PdpSpecSheet,
  PdpMode,
  AnalysisResult,
  ResearchResult,
  SectionPlan,
  StrategyContract,
  DecisionProfile,
  HookScore,
  CopywritingResult,
  CopySectionsPayload,
  Stage3Record,
} from '@/lib/registration/pdp-state'

const COPY_SYSTEM_PROMPT =
  'You are a premium Korean e-commerce detail-page copywriter. Respond only with the requested JSON.'

function parseCopyResponse(text: string): Record<string, unknown> {
  if (!text.trim()) throw new Error('카피 응답이 비어있습니다')
  const parsed = parseLlmJson(text)
  if (!parsed) throw new Error('카피 응답 JSON 파싱 실패')
  return parsed
}

export interface RunPdpCopywritingInput {
  specSheet: PdpSpecSheet
  mode: PdpMode
  analysis: AnalysisResult
  research: ResearchResult
  sectionPlan: SectionPlan
  strategyContract: StrategyContract
  decisionProfile?: DecisionProfile
  hookScore?: Partial<HookScore>
  essenceType?: string
  /** 프롬프트 말미에 별도 섹션으로 append — premium/Stage 1에만(결정 H) */
  groundingBlock?: string
  /**
   * Stage 2·3 말미에도 붙는 금지 범위(주장 범위, pdp-enrichment R2) — 구조 재해석 지시가 아니라 금지 범위라 결정 H 예외.
   * Stage 1에는 groundingBlock에 이미 들어 있다. 기록 잡만 넘긴다(없으면 Stage 2·3 프롬프트 그대로).
   */
  stageGuardBlock?: string
  /**
   * Stage 3 검수에 붙는 특징 배정(R4) — Stage 1 특징 배정과 반대인 원문 키워드 분리 줄을 치환한다(applyFeatureOwnershipToStage3).
   * 기록 잡만 넘긴다(없으면 Stage 3 프롬프트 그대로).
   */
  stage3OwnershipBlock?: string
  /** 재현 비교 전용(운영은 켜지 않는다) — flow·rhythm이 꺼진 잡도 '고칠 곳'을 검수 기준 안(5-1절)에 넣는다. 끝자리와 같은 Stage 2로 비교한다 */
  stage3FixInCriteria?: boolean
  /** Stage 2·3 섹션 잇기 보존(R4 copy-bridge) — 이어받은 낱말을 지우지 않게. 기록 잡만(없으면 Stage 2·3 프롬프트 그대로) */
  stageBridgeBlock?: string
  /** 기록 잡만 — 전략 지시의 가격 환산·입력 밖 수치 지시를 사실형으로(buildStrategyDirectionBlock factOnly) */
  factOnlyStrategy?: boolean
  /** 디자인 컷 잡만 — 색 지시의 예시 hex를 뺀다(페이지 색은 원천 사진 측정이 정한다, stripExampleHexColors) */
  withoutExampleColors?: boolean
  /** 디자인 컷 잡만 — 후킹 기본값(장면·약속·수치)과 고민-POINT 짝(copy-design-rules). 없으면 프롬프트 그대로다(R 코드 동결) */
  designRules?: boolean
  /**
   * 사실 값 블록(pdp-copy-facts-r4, registration/copy-facts) — 옵션 개수·수량. 모든 콜(Stage 1·premium·2·3·pointCards) 말미에 붙인다.
   * 등록 옵션 구조가 있는 잡만 넘긴다(없으면 프롬프트 그대로)
   */
  factsBlock?: string
  /**
   * 섹션 사이 반복 검사(pdp-copy-facts-r4, registration/copy-repeats) — pro Stage 2 산출의 반복을 Stage 3 '고칠 곳'으로 넣는다.
   * 특징 배정과 같은 플래너 기록 잡만(없으면 Stage 3 프롬프트 그대로)
   */
  checkRepeats?: boolean
  /**
   * 카피 흐름 고치기(P1-1b, flow 스위치 잡, registration/copy-flow-check) — pro Stage 2 산출의 반복(문구·특징·수치·제목 되풀이·
   * 마지막 띠의 첫 화면 반복)과 답 없는 고민을 Stage 3 '고칠 곳' 한 블록으로 넘긴다. 켜지면 위 반복 블록 대신 이 블록이 그 자리에 간다
   */
  flowFix?: boolean
  /**
   * 카피 리듬(rhythm 스위치 잡, registration/copy-rhythm-check) — pro Stage 2에 짧은 문장·의미 단위 줄바꿈·섹션마다 한 가지 지시를 붙이고,
   * Stage 2 산출의 긴 제목·어색한 줄바꿈·긴 문장·많은 문장을 Stage 3 '고칠 곳'으로 넘긴다(카피 규칙 블록 뒤)
   */
  rhythm?: boolean
  /**
   * 첫 화면 글 줄이기(hookshort 스위치 잡, registration/copy-hook-short) — pro Stage 2에 첫 화면 상한 쓰기 지시를 붙이고,
   * Stage 2 산출에서 넘친 칸을 Stage 3 '고칠 곳'으로 넘긴다. 상품 종류 낱말은 제목이나 보조에 있어야 통과다(카피 콜 추가 없음)
   */
  hookShort?: boolean
  runContext?: RunContext
  /**
   * run 기한(epoch ms, pdp-cost-time-followup) — 모든 콜(Stage 1·2·3·pointCards)에 싣는다. 기한을 넘기면 뒤 콜은 지금의 실패 처리와
   * 같다(Stage 2 실패 → Stage 1 유지, Stage 3 실패 → Stage 2 유지). 없으면 지금 그대로다(Vercel run만 파이프라인이 넘긴다)
   */
  deadlineAt?: number
  /** 단계 재현만 쓰는 선택(J37 원문 카피 3사 후보) — CopyCallOptions. 운영 호출부는 주지 않는다 */
  call?: CopyCallOptions
}

/** 기한이 있을 때만 요청에 싣는다(없으면 요청 객체 불변) */
function withDeadline(deadlineAt: number | undefined): { deadlineAt?: number } {
  return deadlineAt !== undefined ? { deadlineAt } : {}
}

/** 원문 카피 콜 단계 — 단계 재현(J37)이 route를 바꾸거나 흔적을 받을 수 있는 콜 */
export type CopyCallStage = 'copy/structural' | 'copy/stage2' | 'copy/stage3' | 'copy/retry-pointcards'

/**
 * 단계 재현만 쓰는 선택(원문 카피 3사 후보, 하네스 J37 model-compare-repro) — routes는 단계 route를 다른 모델로 바꿀 때, onCall은 콜마다
 * 흔적을 받을 때(흔적 모양은 칸 카피 J30 SlotCopyCallTrace와 같다). 둘 다 없으면 단계 표(pdpRoute) 그대로이고 지금과 같다
 */
export interface CopyCallOptions {
  routes?: Partial<Record<CopyCallStage, PdpModelRoute>>
  onCall?: (stage: CopyCallStage, trace: SlotCopyCallTrace) => void
}

const copyRoute = (stage: CopyCallStage, call: CopyCallOptions | undefined): PdpModelRoute => call?.routes?.[stage] ?? pdpRoute(stage)

/** 콜 하나의 흔적을 넘긴다 — 토큰은 마지막 시도 값, 끝난 까닭은 실패한 콜에서 공급자가 준 값만(선택이 없으면 아무것도 하지 않는다) */
function traceCopyCall(stage: CopyCallStage, result: AgentOutput<unknown>, call: CopyCallOptions | undefined): void {
  call?.onCall?.(stage, {
    success: result.success,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd: billedCostOf(result),
    ...(!result.success && result.error.stopReason ? { stopReason: result.error.stopReason } : {}),
    ...(!result.success ? { error: result.error.message } : {}),
  })
}

/** premium 1-shot과 pro Stage 1이 공유하는 프롬프트 조립 — PREMIUM_COPYWRITING_PROMPT + 섹션 가이드 + 전략 블록 */
function buildStructuralPrompt(input: RunPdpCopywritingInput, essenceType: string): string {
  const specSheet = input.specSheet
  const prompt = buildPremiumCopywritingPrompt({
    planningSkeleton: JSON.stringify(input.research.planning_skeleton ?? {}),
    brandVoiceGuide: specSheet.brandVoiceGuide?.trim() || DEFAULT_BRAND_VOICE_GUIDE,
    painPoints: JSON.stringify(input.research.pain_points ?? []),
    reviewInsights: JSON.stringify(input.research.review_insights ?? {}),
    uspMapping: JSON.stringify(input.research.usp_mapping ?? {}),
    analysisResult: JSON.stringify(input.analysis),
    specSheet: buildSpecSheetJson(specSheet),
    essenceType,
    reviewsAnalysis: buildReviewsAnalysisSection(specSheet.reviewsText),
    brandColorInstruction: buildBrandColorInstruction(specSheet.brandHexColor),
  })
  const colorGuided = input.withoutExampleColors ? stripExampleHexColors(prompt) : prompt
  const withSectionGuide = colorGuided + buildSectionGuide(input.sectionPlan, specSheet.eventBannerInfo)
  // brand_voice는 PREMIUM 프롬프트가 이미 주입하므로 여기서는 target_persona만 전달(원본 :1017-1022, :1082-1087과 동일)
  return (
    withSectionGuide +
    buildStrategyDirectionBlock(
      input.strategyContract,
      input.decisionProfile,
      input.hookScore,
      specSheet.targetPersona?.trim() || '',
      '',
      { factOnly: input.factOnlyStrategy, ...(input.designRules ? { hookModes: DESIGN_HOOK_MODE_BLOCKS } : {}) }
    )
  )
}

/** pointCards 부족분 LLM 재생성 1회 — copywriting_agent.py:_retry_pointcards(:848-904) */
async function retryPointcards(
  specSheet: PdpSpecSheet,
  existingCards: PointCard[],
  needCount: number,
  warnings: string[],
  runContext: RunContext | undefined,
  guardBlock?: string,
  deadlineAt?: number,
  factsBlock?: string,
  call?: CopyCallOptions,
): Promise<{ cards: PointCard[]; usage: AgentUsage }> {
  const prompt = appendBlock(
    appendStageGuard(
      buildRetryPointcardsPrompt({
        productName: specSheet.productName || '제품',
        features: specSheet.keyFeatures ?? [],
        existingTitles: existingCards.map((c) => c.title),
        needCount,
      }),
      guardBlock,
    ),
    factsBlock,
  )
  const result = await callLlm<PointCard[]>(
    copyRoute('copy/retry-pointcards', call),
    {
      system: 'You are an e-commerce USP point-card copywriter. Respond only with the requested JSON array.',
      messages: [{ role: 'user', content: prompt }],
      timeoutMs: 30_000,
      agentName: 'registration/pdp-copy-retry-pointcards',
      runContext,
      ...withDeadline(deadlineAt),
    },
    (text) => {
      const parsed = parseLlmJsonArray(text)
      if (!parsed) throw new Error('pointCards 재생성 응답 JSON 파싱 실패')
      return filterValidPointCards(parsed, existingCards.map((c) => c.title))
    },
  )
  traceCopyCall('copy/retry-pointcards', result, call)
  if (result.success) return { cards: result.data, usage: billedUsageOf(result) }
  warnings.push(`[Copywriting] pointCards 재생성 실패 — 로컬 폴백만 사용: ${result.error.message}`)
  return { cards: [], usage: billedUsageOf(result) }
}

/** 블록 덧붙임 — 없으면 프롬프트 그대로 */
function appendBlock(prompt: string, block?: string): string {
  return block ? `${prompt}\n\n${block}` : prompt
}

/** Stage 2·3·pointCards 보충 금지 범위 덧붙임 — 없으면 프롬프트 그대로 */
function appendStageGuard(prompt: string, guardBlock?: string, lead: string = CLAIM_GUARD_REWRITE_LEAD): string {
  return guardBlock ? `${prompt}\n\n${lead}\n${guardBlock}` : prompt
}

/**
 * Stage 2 API 경로의 시간 제한·재시도(pdp-model-refresh) — gpt-6.1-sol(medium 추론)은 Stage 1과 비슷한 크기의 JSON 전체를 다시 쓰므로
 * openai-chat 기본 60초는 짧다 → Stage 1과 같은 120초. 같은 모델 재시도는 시간 초과를 되풀이하기 쉽고 시도마다 과금되므로 1회만
 * (최악 약 241초 — 이전 60초×3회 약 183초). 구독 경로(코덱스)는 백엔드 기본값(5분)·자체 재시도 그대로다. smoke 실측으로 조정한다.
 * 콜 시간은 route가 주면(callTimeoutMs — 새 배치 Gemini argon 2단·3단 150초, J34 통합 decide 18) 그 값이고, 없으면 이 값이다(지금 배치 그대로)
 */
const STAGE2_API_TIMEOUT_MS = 120_000
const STAGE2_API_MAX_RETRIES = 1
/** Stage 3 콜 시간 — route callTimeoutMs가 없을 때(지금 배치 그대로) */
const STAGE3_TIMEOUT_MS = 120_000

/** Pro Stage 2: 스토리텔링 강화(GPT 계열) — 실패 시 Stage 1 결과 유지 */
async function runStage2(
  stage1: Record<string, unknown>,
  specSheet: PdpSpecSheet,
  analysis: AnalysisResult,
  essenceType: string,
  warnings: string[],
  runContext: RunContext | undefined,
  guardBlock?: string,
  bridgeBlock?: string,
  deadlineAt?: number,
  factsBlock?: string,
  /** 카피 리듬 쓰기 지시(rhythm 스위치 잡만) — 섹션 잇기 블록 뒤, 주장 범위·사실 값 블록 앞 */
  rhythmBlock?: string,
  call?: CopyCallOptions,
): Promise<{ data: Record<string, unknown>; usage: AgentUsage }> {
  const prompt = appendBlock(
    appendStageGuard(
      appendBlock(
        appendBlock(
          buildStage2StorytellingPrompt({
            productName: specSheet.productName || '',
            category: analysis.detected_category ?? '',
            essenceType,
            draftJson: JSON.stringify(stage1),
          }),
          bridgeBlock,
        ),
        rhythmBlock,
      ),
      guardBlock,
    ),
    factsBlock,
  )
  const route = copyRoute('copy/stage2', call)
  const result = await callLlm<Record<string, unknown>>(
    route,
    {
      system: 'You are an e-commerce storytelling copy editor. Respond only with the requested JSON.',
      messages: [{ role: 'user', content: prompt }],
      agentName: 'registration/pdp-copy-stage2',
      runContext,
      // 하네스 구독 갈래는 코덱스 기본 시간(5분)·재시도 그대로. API로 잇는 작업자 라우트(R13)는 API 값을 둔다(잇기 콜도 같은 값)
      ...(route.backend === 'subscription' && route.subscriptionFallback !== 'api' && !route.subscriptionHalt
        ? {}
        : { timeoutMs: route.callTimeoutMs ?? STAGE2_API_TIMEOUT_MS, maxRetries: STAGE2_API_MAX_RETRIES }),
      ...withDeadline(deadlineAt),
    },
    parseCopyResponse,
  )
  traceCopyCall('copy/stage2', result, call)
  if (result.success) return { data: result.data, usage: billedUsageOf(result) }
  warnings.push(`[Copywriting] Stage 2 스토리텔링 강화 실패 — Stage 1 결과 유지: ${result.error.message}`)
  return { data: stage1, usage: billedUsageOf(result) }
}

/** '고칠 곳'을 검수 기준 안에 넣는 자리 — 기본 6절('위 검수 기준 위반이 없는 필드는 그대로·변경 추적') 바로 앞 */
const FIX_CRITERIA_MARK = '### 6. 미변경 필드 보존'
/** 검수 기준 5-1절 머리(flow·rhythm 잡) — 끝에 붙은 '고칠 곳'을 기준 밖으로 보고 그대로 돌려준 잡(R10-L-P02 비율 0) 대응 */
export const STAGE3_FIX_CRITERIA_HEAD =
  '### 5-1. 고칠 곳(필수 — 결정론 검사가 찾은 위반)\n' +
  '아래 항목은 모두 검수 기준 위반이다. 항목마다 고친다(고치는 방법은 각 항목의 지시를 따른다). 고친 칸의 경로는 빠짐없이 ' +
  '"_changed_fields"에 적는다 — 고치고도 적지 않으면 그 수정이 버려질 수 있다. 고칠 곳이 남았는데 "_changed_fields": []를 내면 검수 실패다.'

/** flow·rhythm 잡 — '고칠 곳' 블록을 검수 기준 5-1절로(6절 앞). 표지가 없는 프롬프트면 예전처럼 끝에 붙인다 */
export function withStage3FixCriteria(prompt: string, blocks: ReadonlyArray<string | undefined>): string {
  const body = blocks.filter((b): b is string => Boolean(b))
  if (body.length === 0) return prompt
  const section = [STAGE3_FIX_CRITERIA_HEAD, ...body].join('\n\n')
  const at = prompt.indexOf(FIX_CRITERIA_MARK)
  return at < 0 ? `${prompt}\n\n${section}` : `${prompt.slice(0, at)}${section}\n\n${prompt.slice(at)}`
}

const REPORTED_RECORD_MAX = 30

/** Pro Stage 3: 품질 관문(Sonnet) + 필드 무결성 강제 — 실패 시 Stage 2 결과 유지. stage3 = 결과 기록(모든 pro 잡) */
async function runStage3(
  stage2: Record<string, unknown>,
  specSheet: PdpSpecSheet,
  warnings: string[],
  runContext: RunContext | undefined,
  guardBlock?: string,
  ownershipBlock?: string,
  bridgeBlock?: string,
  deadlineAt?: number,
  extra: {
    factsBlock?: string
    repeatBlock?: string
    ruleBlock?: string
    rhythmBlock?: string
    /** flow·rhythm 잡 — '고칠 곳'을 검수 기준 안(5-1절)에 넣고, keep 칸은 신고 없이 바뀌어도 되돌리지 않는다 */
    fixInCriteria?: boolean
    keep?: ReadonlySet<string>
    call?: CopyCallOptions
  } = {},
): Promise<{ data: Record<string, unknown>; usage: AgentUsage; changedRatio?: number; stage3: Stage3Record }> {
  const base = buildStage3QualityGatePrompt({
    specSheet: buildSpecSheetJson(specSheet),
    enhancedJson: JSON.stringify(stage2),
  })
  const owned = ownershipBlock ? applyFeatureOwnershipToStage3(base, ownershipBlock) : base
  const fixBlocks = [extra.repeatBlock, extra.ruleBlock, extra.rhythmBlock]
  // 반복·카피 규칙·리듬 '고칠 곳'(있을 때만) → 주장 범위 → 사실 값 순 — 없는 블록은 붙이지 않는다(프롬프트 불변).
  // flow·rhythm 잡만 '고칠 곳'이 끝이 아니라 검수 기준 안(5-1절)에 들어간다
  const withFixes = extra.fixInCriteria
    ? appendBlock(withStage3FixCriteria(owned, fixBlocks), bridgeBlock)
    : fixBlocks.reduce<string>((p, b) => appendBlock(p, b), appendBlock(owned, bridgeBlock))
  const prompt = appendBlock(appendStageGuard(withFixes, guardBlock, CLAIM_GUARD_QUALITY_GATE_LEAD), extra.factsBlock)
  const route = copyRoute('copy/stage3', extra.call)
  const result = await callLlm<Record<string, unknown>>(
    route,
    {
      system: 'You are a Korean e-commerce detail-page copy quality gate. Respond only with the requested JSON.',
      messages: [{ role: 'user', content: prompt }],
      timeoutMs: route.callTimeoutMs ?? STAGE3_TIMEOUT_MS,
      agentName: 'registration/pdp-copy-stage3',
      runContext,
      ...withDeadline(deadlineAt),
    },
    parseCopyResponse,
  )
  traceCopyCall('copy/stage3', result, extra.call)
  const fixMark = extra.fixInCriteria ? { fixInCriteria: true as const } : {}
  if (!result.success) {
    warnings.push(`[Copywriting] Stage 3 품질검수 실패 — Stage 2 결과 유지: ${result.error.message}`)
    const stage3: Stage3Record = { version: 1, parsed: 'failed', reported: null, restored: [], kept: [], changedTopLevel: [], ...fixMark }
    return { data: stage2, usage: billedUsageOf(result), stage3 }
  }
  const integrity = enforceStage3FieldIntegrity(
    stage2 as unknown as CopywritingResult,
    result.data,
    extra.fixInCriteria && extra.keep ? { keep: extra.keep } : {},
  )
  if (integrity.driftRestoredFields.length > 0) {
    warnings.push(`[Copywriting] Stage 3 미신고 드리프트 복원: ${integrity.driftRestoredFields.join(', ')}`)
  }
  if (integrity.keptFields.length > 0) {
    warnings.push(`[Copywriting] Stage 3 미신고 변경을 고칠 곳 칸이라 남김: ${integrity.keptFields.join(', ')}`)
  }
  if (integrity.parsed === 'other') warnings.push('[Copywriting] Stage 3 응답이 객체가 아님 — Stage 2 결과 유지')
  else if (!integrity.reported) warnings.push('[Copywriting] Stage 3 _changed_fields 미신고 — 응답 그대로 사용(변경 비율 0으로 기록)')
  if (integrity.changedRatio > 0.6) {
    warnings.push(`[Copywriting] Stage 3 변경 신고 비율 과다(${Math.round(integrity.changedRatio * 100)}%) — 전면 재작성 의심`)
  }
  const stage3: Stage3Record = {
    version: 1,
    parsed: integrity.parsed,
    reported: integrity.reported ? integrity.reported.slice(0, REPORTED_RECORD_MAX) : null,
    restored: integrity.driftRestoredFields,
    kept: integrity.keptFields,
    changedTopLevel: integrity.changedTopLevel,
    ...fixMark,
  }
  return { data: integrity.result as unknown as Record<string, unknown>, usage: billedUsageOf(result), changedRatio: integrity.changedRatio, stage3 }
}

/**
 * 공통 후처리 파이프라인 — run()의 LLM 호출 없는 구간(:1243-1675) 1:1 순서.
 * pointCards 재생성만 LLM을 호출하므로(재사용량 반영 목적) 이 함수만 async다.
 */
async function finalizePostProcessing(
  rawCopyData: Record<string, unknown>,
  input: RunPdpCopywritingInput,
  warnings: string[],
): Promise<{ result: CopywritingResult; usage: AgentUsage }> {
  const specSheet = input.specSheet

  const clean = { ...rawCopyData }
  delete clean._changed_fields

  const [sanitized, bannedFound] = sanitizeCopyData(clean)
  if (bannedFound.length > 0) {
    warnings.push(`[Copywriting] 금지 표현 발견·정화: ${Array.from(new Set(bannedFound)).join(', ')}`)
  }

  const defaults = getDefaultCopyData(specSheet)
  const merged = mergeWithDefaults(sanitized as Record<string, unknown>, defaults)

  const productName = specSheet.productName || ''
  const fallbackTerm = fallbackCopyTerm(specSheet)

  const problemInput = isPlainObject(merged.problem) ? (merged.problem as NonNullable<CopywritingResult['problem']>) : {}
  merged.problem = validateEmpathyLines({ problem: problemInput } as CopywritingResult, productName, fallbackTerm)

  const targetCardCount = 4
  const { cards: validCards, deficit } = validatePointCards(merged.pointCards, targetCardCount)
  let finalCards = validCards
  let retryUsage = zeroUsage()
  if (deficit > 0) {
    const retried = await retryPointcards(
      specSheet,
      validCards,
      deficit,
      warnings,
      input.runContext,
      input.stageGuardBlock,
      input.deadlineAt,
      input.factsBlock,
      input.call,
    )
    retryUsage = retried.usage
    finalCards = validCards.concat(retried.cards)
    if (finalCards.length < targetCardCount) {
      finalCards = finalCards.concat(
        generateFallbackPointcards(productName || '제품', specSheet.keyFeatures ?? [], fallbackTerm, targetCardCount - finalCards.length),
      )
      warnings.push('[Copywriting] pointCards 재생성 후에도 부족 — 동적 로컬 폴백으로 보충')
    }
  }
  merged.pointCards = finalCards.slice(0, targetCardCount)

  if (input.mode === 'pro') {
    const certCopy = generateCertificationCopy(specSheet)
    if (certCopy) merged.certificationCopy = certCopy
    const eventCopy = generateEventBannerCopy(specSheet)
    if (eventCopy) merged.eventBannerCopy = eventCopy
  } else {
    for (const key of PRO_ONLY_OVERLAY_FIELDS) delete merged[key]
  }

  // 인용 카드(W2b) — 오너가 고른 자사 리뷰 카드가 있으면 후기 섹션은 그 글만(바꿔 쓰지 않는다). 없거나 모두 빠지면 기존 경로
  // 후기 요약 표시(P1-6, 기본 on) — 원문 문장 1~2개로, 쓸 수 있는 요약 문장이 없는 카드는 뺀다(문장을 자르지 않는다)
  const summaryOn = reviewSummaryEnabled()
  const quoteCards = quoteCardHighlights(specSheet.reviewQuotes, { summary: summaryOn })
  if (quoteCards && quoteCards.dropped > 0) {
    warnings.push(`[Copywriting] 인용 카드 ${quoteCards.dropped}장은 인용 금지 표현(인증·인허가·의학·기능성·최상급·대가성)이나 정화 표지가 있어 뺐습니다`)
  }
  if (quoteCards && quoteCards.unsummarized > 0) {
    warnings.push(`[Copywriting] 인용 카드 ${quoteCards.unsummarized}장은 70자 안에 들어오는 요약 문장(경험 문장·인용 안전)이 없어 뺐습니다`)
  }
  if (quoteCards && quoteCards.highlights.length > 0) {
    merged.reviewHighlights = quoteCards.highlights
  } else {
    const reviewsText = specSheet.reviewsText ?? ''
    const rawHighlights = ensureList<unknown>(merged.reviewHighlights, [])
    // Track S '실제 구매 후기' 발췌(P1-6 커밋 B) — 요약이 켜지면 자르지 않고 원문 문장 1~2개로, 출처 리뷰를 찾으면 원본 평점·작성 월·
    // 가린 작성자(늘). 출처를 못 찾으면 평점·이름 없이 '구매고객'
    // 별점 3점 이하 후기의 문장은 모델이 골라도 싣지 않는다
    const rated = withoutLowRatedExcerpts(rawHighlights, reviewsText)
    const verified = validateReviewQuotes(rated.kept, reviewsText, 3, { clip: !summaryOn })
    let excerpts = finishExcerptHighlights(verified, reviewsText, { summary: summaryOn })
    // 검증에서 모두 빠졌거나 요약에서 모두 빠지면 원문 결정적 폴백(같은 마무리)
    if (excerpts.highlights.length === 0 && reviewsText.trim()) {
      const fallback = summaryOn ? pickSummaryFallbacks(reviewsText) : pickQuoteFallbacks(reviewsText)
      if (fallback.length > 0) {
        warnings.push('[Copywriting] reviewHighlights LLM 후보 전멸 — 원문 결정적 폴백 발췌로 대체')
        const finished = finishExcerptHighlights(fallback, reviewsText, { summary: summaryOn })
        excerpts = {
          highlights: finished.highlights,
          dropped: excerpts.dropped + finished.dropped,
          lowRated: excerpts.lowRated + finished.lowRated,
        }
      }
    }
    if (excerpts.dropped > 0) {
      warnings.push(`[Copywriting] 후기 발췌 ${excerpts.dropped}건은 70자 안에 들어오는 요약 문장(경험 문장·인용 안전)이 없어 뺐습니다`)
    }
    const lowRatedExcerpts = rated.lowRated + excerpts.lowRated
    if (lowRatedExcerpts > 0) {
      warnings.push(`[Copywriting] 후기 발췌 ${lowRatedExcerpts}건은 별점 3점 이하 후기라 뺐습니다`)
    }
    merged.reviewHighlights = excerpts.highlights
  }

  const rawCta = merged.closingCta
  if (typeof rawCta === 'string' && rawCta) {
    merged.closingCta = { headline: rawCta, subtext: '' }
  } else if (!isPlainObject(rawCta)) {
    // 부제는 비운다 — 입력에 없는 배송·반품 약속을 기본값으로 쓰지 않는다(2026-10-30 오너 지시). 제목은 행동 이유(P1-1a)
    merged.closingCta = { headline: FALLBACK_CLOSING_CTA, subtext: '' }
  }

  merged.sizeComparisonObject =
    typeof merged.sizeComparisonObject === 'string' && merged.sizeComparisonObject ? merged.sizeComparisonObject : 'iphone'

  merged.compareItems = normalizeCompareItems(merged.compareItems)
  merged.compareSummary = typeof merged.compareSummary === 'string' ? merged.compareSummary : ''

  const rawKmv = merged.keyMessageVariations
  if (isPlainObject(rawKmv)) {
    merged.keyMessageVariations = {
      top: typeof rawKmv.top === 'string' ? rawKmv.top : String(merged.summary ?? ''),
      mid: typeof rawKmv.mid === 'string' ? rawKmv.mid : '',
      bottom: typeof rawKmv.bottom === 'string' ? rawKmv.bottom : '',
    }
  }

  const mainIntroRecord = isPlainObject(merged.mainIntro) ? merged.mainIntro : {}
  merged.title = String(mainIntroRecord.brandAndName ?? mainIntroRecord.title ?? '')

  const result = merged as unknown as CopywritingResult

  // V4.3 파생 필드 — LLM 재호출 없음(copywriting_agent.py:1576-1675)
  const derived = deriveV43Fields(result, input.strategyContract, input.analysis.objection_priority ?? [])
  result.sections = derived.sections
  result.hero_copy = derived.hero_copy
  result.review_strategy = derived.review_strategy
  result.section_copy_blocks = derived.section_copy_blocks
  result.objection_handlers = derived.objection_handlers
  result.cta_variants = derived.cta_variants

  // 브랜드색 안전망(NEXFIT 18dcaa1) — 지정 색을 LLM이 무시했으면 팔레트를 강제로 바꾼다. 이미지 단계의 팔레트 토큰도
  // 이 팔레트로 치환되므로 합성이 아니라 카피 후처리 끝에서 바꾼다.
  const branded = enforceBrandPalette(result.designPalette, specSheet.brandHexColor)
  if (branded.replaced) {
    console.warn(
      `[registration/pdp-copy] 브랜드 컬러 불일치 — LLM ${result.designPalette?.primary ?? '(없음)'}, 사용자 ${specSheet.brandHexColor?.trim()}. 강제 교체.`,
    )
    result.designPalette = branded.palette
  }

  return { result, usage: retryUsage }
}

/** CopySectionsPayload에 폴백 사유를 얹어 반환 — DDL 저장 계약(final/stage1/stage2/stage3_changed_ratio)은 그대로 보존 */
export type PdpCopywritingResult = CopySectionsPayload & {
  warnings: string[]
  /**
   * 카피 생성(pro Stage 1·premium 1콜)이 실패해 기본 카피로 폴백했다 — 파이프라인 재생성이 이 결과로 원래 카피를 덮지 않게 본다
   * (pdp-cost-time-followup). 저장 필드가 아니다(stepCopywriting은 저장 칸을 골라 쓴다)
   */
  stage1FellBack?: true
}

/** '고칠 곳' 블록 하나와 그 블록이 고치라고 할 수 있는 최상위 칸(stage3-fix-targets) */
type FixSlot = { block: string; targets: Set<string> }
const NO_FIX: FixSlot = { block: '', targets: new Set() }

/** 리듬 '고칠 곳'(rhythm 잡) — 검사가 예상 밖 카피 모양으로 던지면 경고만 남기고 블록 없이 간다(카피 단계를 멈추지 않는다) */
function rhythmFixSlot(stage2: CopywritingResult, warnings: string[], hookShort = false): FixSlot {
  try {
    const rhythm = findCopyRhythmIssues(stage2, { hookShort })
    return { block: buildRhythmFixBlock(rhythm), targets: stage3FixTargets({ rhythm }) }
  } catch (e) {
    warnings.push(`[CopyRhythm] 리듬 검사를 하지 못해 리듬 고칠 곳 없이 진행: ${e instanceof Error ? e.message : String(e)}`)
    return NO_FIX
  }
}

/** 첫 화면 '고칠 곳'(hookshort 잡) — 검사가 예상 밖 카피 모양으로 던지면 경고만 남기고 블록 없이 간다 */
function hookShortFixSlot(stage2: CopywritingResult, warnings: string[]): FixSlot {
  try {
    const block = buildHookShortFixBlock(findHookShortIssues(stage2))
    return { block, targets: new Set(block ? HOOK_SHORT_TARGETS : []) }
  } catch (e) {
    warnings.push(`[CopyHookShort] 첫 화면 검사를 하지 못해 고칠 곳 없이 진행: ${e instanceof Error ? e.message : String(e)}`)
    return NO_FIX
  }
}

/**
 * Stage 3 '고칠 곳'의 반복 자리 — flow 잡은 흐름 블록, 기록 잡은 섹션 사이 반복 블록. 흐름 검사가 예상 밖 카피 모양(배열이 아닌 목록
 * 칸 등)으로 던지면 경고를 남기고 기존 반복 블록으로 되돌아간다 — 카피 단계를 멈추지 않는다
 */
function repeatSlot(input: RunPdpCopywritingInput, stage2: CopywritingResult, warnings: string[]): FixSlot {
  if (input.flowFix) {
    try {
      const flow = findCopyFlowIssues(stage2, input.specSheet)
      return { block: buildFlowFixBlock(flow), targets: stage3FixTargets({ flow }) }
    } catch (e) {
      warnings.push(`[CopyFlow] 흐름 검사를 하지 못해 기존 반복 블록으로 대신함: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (!input.checkRepeats) return NO_FIX
  const repeats = findCrossSectionRepeats(stage2, { excludeTerms: repeatExclusionTerms(input.specSheet) })
  return { block: buildRepeatFixBlock(repeats), targets: stage3FixTargets({ repeats }) }
}

/**
 * Stage 2 산출에서 Stage 3까지 — '고칠 곳' 블록을 결정론으로 만들고 품질 관문을 부른다. runPdpCopywriting과 Stage 3 재현 하네스
 * (__e2e__/pdp-stage3-repro)가 같은 길을 쓴다. flow·rhythm 잡은 '고칠 곳'을 검수 기준 안(5-1절)에 넣고, 블록이 가리킨 칸은 신고
 * 없이 바뀌어도 되돌리지 않는다(pdp-stage3-fix-effective). 그 밖의 잡은 예전 프롬프트·무결성 그대로
 */
export async function runPdpCopyStage3(
  input: RunPdpCopywritingInput,
  stage2: Record<string, unknown>,
  warnings: string[],
): Promise<{ data: Record<string, unknown>; usage: AgentUsage; changedRatio?: number; stage3: Stage3Record }> {
  const stage2Copy = stage2 as unknown as CopywritingResult
  // 섹션 사이 반복(플래너 기록 잡) — Stage 2 산출에서 결정론으로 찾아 Stage 3 '고칠 곳'으로 넘긴다(추가 콜 없음).
  // flow 스위치 잡은 흐름 블록(반복 + 답 없는 고민, 첫 화면↔마지막 띠 한 쌍은 예외)이 그 자리에 간다 — 두 블록을 함께 넣지 않는다
  const repeat = repeatSlot(input, stage2Copy, warnings)
  // 카피 규칙(P1-1a, 모든 잡) — 제목·CTA의 안내형 끝말과 첫 화면에 없는 상품 종류 낱말도 같은 '고칠 곳'으로(추가 콜 없음)
  const hookShortOpts = { hookShort: Boolean(input.hookShort) }
  const rules = findCopyRuleViolations(stage2Copy, input.specSheet, hookShortOpts)
  const ruleBlock = buildCopyRuleFixBlock(rules, hookShortOpts)
  // 카피 리듬(rhythm 스위치 잡) — 긴 제목·어색한 줄바꿈·긴 문장·많은 문장도 같은 '고칠 곳'으로(추가 콜 없음)
  const rhythm = input.rhythm ? rhythmFixSlot(stage2Copy, warnings, Boolean(input.hookShort)) : NO_FIX
  const hookShort = input.hookShort ? hookShortFixSlot(stage2Copy, warnings) : NO_FIX
  const lengthBlock = [rhythm.block, hookShort.block].filter(Boolean).join('\n\n')
  const fixInCriteria = Boolean(input.flowFix || input.rhythm || input.hookShort || input.stage3FixInCriteria)
  const keep = fixInCriteria
    ? new Set([...repeat.targets, ...(ruleBlock ? stage3FixTargets({ rules }) : []), ...rhythm.targets, ...hookShort.targets])
    : undefined
  return runStage3(
    stage2,
    input.specSheet,
    warnings,
    input.runContext,
    input.stageGuardBlock,
    input.stage3OwnershipBlock,
    input.stageBridgeBlock,
    input.deadlineAt,
    {
      ...(repeat.block ? { repeatBlock: repeat.block } : {}),
      ...(ruleBlock ? { ruleBlock } : {}),
      ...(lengthBlock ? { rhythmBlock: lengthBlock } : {}),
      ...(input.factsBlock ? { factsBlock: input.factsBlock } : {}),
      ...(fixInCriteria ? { fixInCriteria: true, ...(keep ? { keep } : {}) } : {}),
      ...(input.call ? { call: input.call } : {}),
    },
  )
}

/** 4단계: 카피라이팅 — copywriting_agent.py run() 이식(premium 1-shot / pro 3-Stage 분기) */
export async function runPdpCopywriting(input: RunPdpCopywritingInput): Promise<AgentOutput<PdpCopywritingResult>> {
  const start = Date.now()
  const warnings: string[] = []
  const essenceType = input.essenceType || 'convenience'
  let usage = zeroUsage()

  // Stage 2가 구독 백엔드인데 부를 수 없으면(미등록·소프트 종료 기록) 유료 Stage 1 전에 멈춘다 — 멈춘 뒤 재개 때 Stage 1을 두 번
  // 사지 않게(pdp-llm-subscription-backend, 검수 지적). API 라우트면 아무것도 하지 않는다
  if (input.mode === 'pro') assertSubscriptionReady(copyRoute('copy/stage2', input.call))

  const structuralPrompt = appendBlock(
    appendGroundingBlock(buildStructuralPrompt(input, essenceType), input.groundingBlock),
    input.factsBlock,
  )
  const structuralAgentName = input.mode === 'pro' ? 'registration/pdp-copy-stage1' : 'registration/pdp-copy-premium'

  const structuralRoute = copyRoute('copy/structural', input.call)
  const structural = await callLlm<Record<string, unknown>>(
    structuralRoute,
    {
      system: COPY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: structuralPrompt }],
      // 새 배치 콜 시간·재시도(카피 1단 180초 + 재시도 1, 오너 ③ — route, R03). 없으면 지금 값
      timeoutMs: structuralRoute.callTimeoutMs ?? 120_000,
      ...(structuralRoute.callMaxRetries !== undefined ? { maxRetries: structuralRoute.callMaxRetries } : {}),
      agentName: structuralAgentName,
      runContext: input.runContext,
      ...withDeadline(input.deadlineAt),
    },
    parseCopyResponse,
  )
  traceCopyCall('copy/structural', structural, input.call)
  usage = addUsage(usage, billedUsageOf(structural))

  let stage1Raw: Record<string, unknown>
  if (structural.success) {
    stage1Raw = structural.data
  } else {
    const label = input.mode === 'pro' ? 'Stage 1 설득 골격' : 'Premium'
    warnings.push(`[Copywriting] ${label} 카피 생성 실패 — 기본 카피로 폴백: ${structural.error.message}`)
    stage1Raw = getDefaultCopyData(input.specSheet) as unknown as Record<string, unknown>
  }
  const stage1Snapshot = stage1Raw as unknown as CopywritingResult

  let preFinalRaw = stage1Raw
  let stage2Snapshot: CopywritingResult | undefined
  let stage3ChangedRatio: number | undefined
  let stage3Record: Stage3Record | undefined

  if (input.mode === 'pro') {
    const stage2 = await runStage2(
      stage1Raw,
      input.specSheet,
      input.analysis,
      essenceType,
      warnings,
      input.runContext,
      input.stageGuardBlock,
      input.stageBridgeBlock,
      input.deadlineAt,
      input.factsBlock,
      [input.rhythm ? RHYTHM_WRITE_BLOCK : '', input.hookShort ? HOOK_SHORT_WRITE_BLOCK : '', input.designRules ? `${DESIGN_COPY_WRITE_BLOCK}\n\n${DESIGN_ACCENT_WRITE_BLOCK}` : ''].filter(Boolean).join('\n\n') || undefined,
      input.call,
    )
    usage = addUsage(usage, stage2.usage)
    stage2Snapshot = stage2.data as unknown as CopywritingResult

    const stage3 = await runPdpCopyStage3(input, stage2.data, warnings)
    usage = addUsage(usage, stage3.usage)
    // 디자인 컷 잡: Stage 3가 강조 구절 칸(T1-17)을 빼고 답하면 Stage 2 값을 잇는다. R 잡은 칸을 쓰지 않아 그대로다
    preFinalRaw = input.designRules ? keepStage2Accents(stage3.data, stage2.data) : stage3.data
    stage3ChangedRatio = stage3.changedRatio
    stage3Record = stage3.stage3
  }

  const { result: finalResult, usage: postUsage } = await finalizePostProcessing(preFinalRaw, input, warnings)
  usage = addUsage(usage, postUsage)

  const payload: PdpCopywritingResult = {
    final: finalResult,
    warnings,
    ...(input.mode === 'pro' ? { stage1: stage1Snapshot, stage2: stage2Snapshot } : {}),
    ...(stage3ChangedRatio !== undefined ? { stage3_changed_ratio: stage3ChangedRatio } : {}),
    ...(stage3Record ? { stage3: stage3Record } : {}),
    ...(structural.success ? {} : { stage1FellBack: true as const }),
  }

  return { success: true, data: payload, usage, duration: Date.now() - start }
}
