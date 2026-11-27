/**
 * PDP 파이프라인 4단계(카피라이팅) 에이전트 — NEXFIT agents/copywriting_agent.py 이식.
 * SSOT: docs/plans/registration-tab/PROMPT-INVENTORY.md §4.
 *
 * 모드 분기(run() :1213-1699 순서 보존):
 *   premium: PREMIUM_COPYWRITING_PROMPT 1콜(Sonnet 5) → 공통 후처리
 *   pro:     Stage 1(PREMIUM 프롬프트 재사용, Sonnet 5) → Stage 2(GPT, callOpenAiChat, 실패 시 Stage 1
 *            유지) → Stage 3(Sonnet 5, 실패 시 Stage 2 유지) → 필드 무결성 강제 → 공통 후처리
 * 공통 후처리 = 정화 → 기본값 병합 → empathy 검증 → pointCards 검증(미달 시 LLM 1회 재생성 → 로컬
 * 폴백) → reviewHighlights 원문 대조 → (pro) 인증/이벤트 템플릿 카피 → V4.3 파생 필드.
 *
 * 전략 지시 블록(buildStrategyDirectionBlock)·groundingBlock은 premium/Stage 1에만 append —
 * Stage 2·3은 구조 보존 단계라 재해석을 허용하지 않는다(결정 H, copywriting_agent.py:1080-1081).
 * LLM이 끝까지 실패해도 잡은 실패시키지 않는다 — 정적 기본 카피로 폴백하고 warnings로 표면화한다.
 */

import type { AgentConfig, AgentOutput, AgentUsage, RunContext } from '../types'
import { callAgent } from '../_base'
import { callOpenAiChat } from '../openai-chat'
import { parseLlmJson, parseLlmJsonArray } from '../json-parser'
import { buildPremiumCopywritingPrompt, buildStrategyDirectionBlock, buildRetryPointcardsPrompt } from './prompts/pdp-copy-prompts'
import { buildStage2StorytellingPrompt, buildStage3QualityGatePrompt } from './prompts/pdp-copy-pro-prompts'
import { DEFAULT_BRAND_VOICE_GUIDE } from './prompts/pdp-research-prompts'
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
  getDefaultCopyData,
  buildSectionGuide,
} from './pdp-copy-defaults'
import { sanitizeCopyData, validateEmpathyLines } from '@/lib/registration/pdp-copy-sanitize'
import {
  validatePointCards,
  filterValidPointCards,
  generateFallbackPointcards,
  enforceStage3FieldIntegrity,
  deriveV43Fields,
  type PointCard,
} from '@/lib/registration/pdp-copy-rules'
import { generateCertificationCopy, generateEventBannerCopy } from '@/lib/registration/pdp-pro-copy-templates'
import { validateReviewQuotes, pickQuoteFallbacks } from '@/lib/registration/review-scrubber'
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
} from '@/lib/registration/pdp-state'

// Sonnet 5는 temperature 미전달(400 거부) — thinking은 JSON 산출 예산을 지키기 위해 명시적으로 끈다.
const STRUCTURAL_COPY_CONFIG: AgentConfig = { model: 'claude-sonnet-5', maxTokens: 8000, disableThinking: true }
const STAGE3_CONFIG: AgentConfig = { model: 'claude-sonnet-5', maxTokens: 8000, disableThinking: true }
const RETRY_POINTCARDS_CONFIG: AgentConfig = { model: 'claude-sonnet-5', maxTokens: 1000, disableThinking: true }

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
  hookScore?: HookScore
  essenceType?: string
  /** 프롬프트 말미에 별도 섹션으로 append — premium/Stage 1에만(결정 H) */
  groundingBlock?: string
  runContext?: RunContext
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
  const withSectionGuide = prompt + buildSectionGuide(input.sectionPlan, specSheet.eventBannerInfo)
  // brand_voice는 PREMIUM 프롬프트가 이미 주입하므로 여기서는 target_persona만 전달(원본 :1017-1022, :1082-1087과 동일)
  return (
    withSectionGuide +
    buildStrategyDirectionBlock(input.strategyContract, input.decisionProfile, input.hookScore, specSheet.targetPersona?.trim() || '', '')
  )
}

/** pointCards 부족분 LLM 재생성 1회 — copywriting_agent.py:_retry_pointcards(:848-904) */
async function retryPointcards(
  specSheet: PdpSpecSheet,
  existingCards: PointCard[],
  needCount: number,
  warnings: string[],
  runContext: RunContext | undefined,
): Promise<{ cards: PointCard[]; usage: AgentUsage }> {
  const prompt = buildRetryPointcardsPrompt({
    productName: specSheet.productName || '제품',
    features: specSheet.keyFeatures ?? [],
    existingTitles: existingCards.map((c) => c.title),
    needCount,
  })
  const result = await callAgent<PointCard[]>(
    {
      config: RETRY_POINTCARDS_CONFIG,
      system: 'You are an e-commerce USP point-card copywriter. Respond only with the requested JSON array.',
      messages: [{ role: 'user', content: prompt }],
      timeoutMs: 30_000,
      agentName: 'registration/pdp-copy-retry-pointcards',
      runContext,
    },
    (text) => {
      const parsed = parseLlmJsonArray(text)
      if (!parsed) throw new Error('pointCards 재생성 응답 JSON 파싱 실패')
      return filterValidPointCards(parsed, existingCards.map((c) => c.title))
    },
  )
  if (result.success) return { cards: result.data, usage: result.usage }
  warnings.push(`[Copywriting] pointCards 재생성 실패 — 로컬 폴백만 사용: ${result.error.message}`)
  return { cards: [], usage: result.usage }
}

/** Pro Stage 2: 스토리텔링 강화(GPT 계열) — 실패 시 Stage 1 결과 유지 */
async function runStage2(
  stage1: Record<string, unknown>,
  specSheet: PdpSpecSheet,
  analysis: AnalysisResult,
  essenceType: string,
  warnings: string[],
  runContext: RunContext | undefined,
): Promise<{ data: Record<string, unknown>; usage: AgentUsage }> {
  const prompt = buildStage2StorytellingPrompt({
    productName: specSheet.productName || '',
    category: analysis.detected_category ?? '',
    essenceType,
    draftJson: JSON.stringify(stage1),
  })
  const result = await callOpenAiChat<Record<string, unknown>>(
    {
      system: 'You are an e-commerce storytelling copy editor. Respond only with the requested JSON.',
      messages: [{ role: 'user', content: prompt }],
      agentName: 'registration/pdp-copy-stage2',
      runContext,
    },
    parseCopyResponse,
  )
  if (result.success) return { data: result.data, usage: result.usage }
  warnings.push(`[Copywriting] Stage 2 스토리텔링 강화 실패 — Stage 1 결과 유지: ${result.error.message}`)
  return { data: stage1, usage: result.usage }
}

/** Pro Stage 3: 품질 관문(Sonnet) + 필드 무결성 강제 — 실패 시 Stage 2 결과 유지 */
async function runStage3(
  stage2: Record<string, unknown>,
  specSheet: PdpSpecSheet,
  warnings: string[],
  runContext: RunContext | undefined,
): Promise<{ data: Record<string, unknown>; usage: AgentUsage; changedRatio?: number }> {
  const prompt = buildStage3QualityGatePrompt({ specSheet: buildSpecSheetJson(specSheet), enhancedJson: JSON.stringify(stage2) })
  const result = await callAgent<Record<string, unknown>>(
    {
      config: STAGE3_CONFIG,
      system: 'You are a Korean e-commerce detail-page copy quality gate. Respond only with the requested JSON.',
      messages: [{ role: 'user', content: prompt }],
      timeoutMs: 120_000,
      agentName: 'registration/pdp-copy-stage3',
      runContext,
    },
    parseCopyResponse,
  )
  if (!result.success) {
    warnings.push(`[Copywriting] Stage 3 품질검수 실패 — Stage 2 결과 유지: ${result.error.message}`)
    return { data: stage2, usage: result.usage }
  }
  const integrity = enforceStage3FieldIntegrity(stage2 as unknown as CopywritingResult, result.data)
  if (integrity.driftRestoredFields.length > 0) {
    warnings.push(`[Copywriting] Stage 3 미신고 드리프트 복원: ${integrity.driftRestoredFields.join(', ')}`)
  }
  if (integrity.changedRatio > 0.6) {
    warnings.push(`[Copywriting] Stage 3 변경 신고 비율 과다(${Math.round(integrity.changedRatio * 100)}%) — 전면 재작성 의심`)
  }
  return { data: integrity.result as unknown as Record<string, unknown>, usage: result.usage, changedRatio: integrity.changedRatio }
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
  const category = specSheet.material || specSheet.category || ''

  const problemInput = isPlainObject(merged.problem) ? (merged.problem as NonNullable<CopywritingResult['problem']>) : {}
  merged.problem = validateEmpathyLines({ problem: problemInput } as CopywritingResult, productName, category)

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
    )
    retryUsage = retried.usage
    finalCards = validCards.concat(retried.cards)
    if (finalCards.length < targetCardCount) {
      finalCards = finalCards.concat(
        generateFallbackPointcards(productName || '제품', specSheet.keyFeatures ?? [], category, targetCardCount - finalCards.length),
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

  const reviewsText = specSheet.reviewsText ?? ''
  const rawHighlights = ensureList<unknown>(merged.reviewHighlights, [])
  let safeHighlights = validateReviewQuotes(rawHighlights, reviewsText)
  if (safeHighlights.length === 0 && reviewsText.trim()) {
    safeHighlights = pickQuoteFallbacks(reviewsText)
    if (safeHighlights.length > 0) {
      warnings.push('[Copywriting] reviewHighlights LLM 후보 전멸 — 원문 결정적 폴백 발췌로 대체')
    }
  }
  merged.reviewHighlights = safeHighlights

  const rawCta = merged.closingCta
  if (typeof rawCta === 'string' && rawCta) {
    merged.closingCta = { headline: rawCta, subtext: '' }
  } else if (!isPlainObject(rawCta)) {
    merged.closingCta = { headline: '차이를 직접 확인해 보세요', subtext: '빠른 배송 · 30일 무료 반품' }
  }

  merged.sizeComparisonObject =
    typeof merged.sizeComparisonObject === 'string' && merged.sizeComparisonObject ? merged.sizeComparisonObject : 'iphone'

  const rawCompare = merged.compareItems
  merged.compareItems = Array.isArray(rawCompare)
    ? (rawCompare as unknown[])
        .slice(0, 3)
        .filter(isPlainObject)
        .map((item) => ({ name: String(item.name ?? ''), pros: String(item.pros ?? ''), cons: String(item.cons ?? '') }))
    : []
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

  return { result, usage: retryUsage }
}

/** CopySectionsPayload에 폴백 사유를 얹어 반환 — DDL 저장 계약(final/stage1/stage2/stage3_changed_ratio)은 그대로 보존 */
export type PdpCopywritingResult = CopySectionsPayload & { warnings: string[] }

/** 4단계: 카피라이팅 — copywriting_agent.py run() 이식(premium 1-shot / pro 3-Stage 분기) */
export async function runPdpCopywriting(input: RunPdpCopywritingInput): Promise<AgentOutput<PdpCopywritingResult>> {
  const start = Date.now()
  const warnings: string[] = []
  const essenceType = input.essenceType || 'convenience'
  let usage = zeroUsage()

  const structuralPrompt = appendGroundingBlock(buildStructuralPrompt(input, essenceType), input.groundingBlock)
  const structuralAgentName = input.mode === 'pro' ? 'registration/pdp-copy-stage1' : 'registration/pdp-copy-premium'

  const structural = await callAgent<Record<string, unknown>>(
    {
      config: STRUCTURAL_COPY_CONFIG,
      system: COPY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: structuralPrompt }],
      timeoutMs: 120_000,
      agentName: structuralAgentName,
      runContext: input.runContext,
    },
    parseCopyResponse,
  )
  usage = addUsage(usage, structural.usage)

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

  if (input.mode === 'pro') {
    const stage2 = await runStage2(
      stage1Raw,
      input.specSheet,
      input.analysis,
      essenceType,
      warnings,
      input.runContext,
    )
    usage = addUsage(usage, stage2.usage)
    stage2Snapshot = stage2.data as unknown as CopywritingResult

    const stage3 = await runStage3(
      stage2.data,
      input.specSheet,
      warnings,
      input.runContext,
    )
    usage = addUsage(usage, stage3.usage)
    preFinalRaw = stage3.data
    stage3ChangedRatio = stage3.changedRatio
  }

  const { result: finalResult, usage: postUsage } = await finalizePostProcessing(preFinalRaw, input, warnings)
  usage = addUsage(usage, postUsage)

  const payload: PdpCopywritingResult = {
    final: finalResult,
    warnings,
    ...(input.mode === 'pro' ? { stage1: stage1Snapshot, stage2: stage2Snapshot } : {}),
    ...(stage3ChangedRatio !== undefined ? { stage3_changed_ratio: stage3ChangedRatio } : {}),
  }

  return { success: true, data: payload, usage, duration: Date.now() - start }
}
