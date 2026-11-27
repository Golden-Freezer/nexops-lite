/**
 * PDP 파이프라인 1단계(데이터분석) 에이전트 — NEXFIT agents/data_analysis_agent.py 이식.
 * 카테고리 감지(선택) + 스펙표·리뷰 통합 분석(LLM) → decision_profile 보정 →
 * strategy_contract 자동 추천(규칙 기반, LLM 아님) → spec_sheet 수동 힌트 머지까지 한 번에 수행한다.
 * 어느 LLM 콜이 실패해도 잡을 실패시키지 않는다 — 원본 graceful degradation(§2 결정 B) 그대로,
 * 폴백 사유는 warnings로 표면화한다(조용히 삼키지 않음).
 */

import type { AgentConfig, AgentOutput, AgentUsage, RunContext } from '../types'
import { callAgent } from '../_base'
import { parseLlmJson } from '../json-parser'
import { buildCategoryDetectionPrompt, buildDataAnalysisPrompt } from './prompts/pdp-analysis-prompts'
import type { AnalysisResult, DecisionProfile, EssenceType, PdpSpecSheet, StrategyContract } from '@/lib/registration/pdp-state'
import {
  CATEGORY_TO_ESSENCE,
  deriveStrategyContract,
  mergeManualStrategy,
  normalizeDecisionProfile,
} from '@/lib/registration/pdp-strategy-contract'

// 원본 premium_analysis_model(Gemini) 대응 — 구조화 추출은 Haiku로 충분(설계문서 결정 C)
const CATEGORY_CONFIG: AgentConfig = {
  model: 'claude-haiku-4-5-20251001',
  maxTokens: 300,
  temperature: 0,
}
const ANALYSIS_CONFIG: AgentConfig = {
  model: 'claude-haiku-4-5-20251001',
  maxTokens: 2000,
  temperature: 0,
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : []
}

/** groundingBlock은 프롬프트 본문 뒤에 별도 섹션으로만 append — 본문 수정 금지(§7.5). 후속 태스크에서 실제 주입. */
function appendGroundingBlock(prompt: string, groundingBlock?: string): string {
  if (!groundingBlock) return prompt
  return `${prompt}\n\n## 참고 자료(코퍼스 그라운딩)\n${groundingBlock}`
}

/** reviewsText는 별도 슬롯(reviews_summary)으로 전달하므로 스펙표 JSON에서는 제외 */
function buildSpecSheetJson(specSheet: PdpSpecSheet): string {
  const specForPrompt: Record<string, unknown> = { ...specSheet }
  delete specForPrompt.reviewsText
  return JSON.stringify(specForPrompt)
}

function parseCategoryResponse(text: string): { category: string } {
  const parsed = parseLlmJson(text)
  const category = parsed?.category
  if (typeof category !== 'string' || !category.trim()) {
    throw new Error('카테고리 감지 응답 형식이 올바르지 않습니다.')
  }
  return { category: category.trim() }
}

function parseAnalysisResponse(text: string): Record<string, unknown> {
  const parsed = parseLlmJson(text)
  if (!parsed) throw new Error('데이터 분석 응답 JSON 파싱 실패')
  return parsed
}

// data_analysis_agent.py:255-278 _detect_category — 사용자 지정 카테고리가 있으면 콜 자체를 생략한다.
async function resolveCategory(
  specSheet: PdpSpecSheet,
  groundingBlock: string | undefined,
  runContext: RunContext | undefined,
): Promise<{ category: string; usage: AgentUsage; warning?: string }> {
  if (specSheet.category?.trim()) {
    return { category: specSheet.category.trim(), usage: { inputTokens: 0, outputTokens: 0, cost: 0 } }
  }

  const prompt = appendGroundingBlock(buildCategoryDetectionPrompt(buildSpecSheetJson(specSheet)), groundingBlock)
  const result = await callAgent<{ category: string }>(
    {
      config: CATEGORY_CONFIG,
      system: 'You are an e-commerce product category classifier. Respond only with the requested JSON.',
      messages: [{ role: 'user', content: prompt }],
      timeoutMs: 30_000,
      agentName: 'registration/pdp-category',
      runContext,
    },
    parseCategoryResponse,
  )

  if (result.success) return { category: result.data.category, usage: result.usage }

  // 트랙 E(P1-6): household 폴백은 essence_type→섹션순서→이미지 톤까지 연쇄되므로 표면화(원본 :272-278)
  const warning =
    "[DataAnalysis] 카테고리 자동 감지 실패 — 기본값 'household'로 진행 (섹션 구성·이미지 톤에 영향 가능): " +
    result.error.message
  console.warn('[registration/pdp-analysis]', warning)
  return { category: 'household', usage: result.usage, warning }
}

// data_analysis_agent.py:365-375 파싱 실패 폴백 그대로
const ANALYSIS_FALLBACK: Record<string, unknown> = {
  keywords: [],
  pros: [],
  cons: [],
  usp_candidates: [],
  raw_summary: '분석 결과 파싱 오류 발생',
}

async function resolveAnalysisData(
  specSheet: PdpSpecSheet,
  reviewsSummary: string,
  category: string,
  groundingBlock: string | undefined,
  runContext: RunContext | undefined,
): Promise<{ data: Record<string, unknown>; usage: AgentUsage; warning?: string }> {
  const prompt = appendGroundingBlock(
    buildDataAnalysisPrompt({ specSheet: buildSpecSheetJson(specSheet), reviewsSummary, category }),
    groundingBlock,
  )
  const result = await callAgent<Record<string, unknown>>(
    {
      config: ANALYSIS_CONFIG,
      system: 'You are an e-commerce product data analyst. Respond only with the requested JSON.',
      messages: [{ role: 'user', content: prompt }],
      timeoutMs: 60_000,
      agentName: 'registration/pdp-analysis',
      runContext,
    },
    parseAnalysisResponse,
  )

  if (result.success) return { data: result.data, usage: result.usage }

  const warning = `[DataAnalysis] 분석 결과 파싱 실패 — 최소 필드로 계속: ${result.error.message}`
  console.warn('[registration/pdp-analysis]', warning)
  return { data: ANALYSIS_FALLBACK, usage: result.usage, warning }
}

export interface PdpAnalysisInput {
  specSheet: PdpSpecSheet
  /** 리뷰 원문 요약/직렬화 텍스트. 없으면 '리뷰 데이터 없음' (엑셀 파싱 파이프라인은 이 포트 범위 밖). */
  reviewsSummary: string
  /** 프롬프트 말미에 별도 섹션으로 append — 본문 수정 금지(§7.5). 실제 주입은 후속 태스크. */
  groundingBlock?: string
  runContext?: RunContext
}

export interface PdpAnalysisOutput {
  analysis: AnalysisResult
  decisionProfile: DecisionProfile
  strategyContract: StrategyContract
  essenceType: EssenceType
  /** 비치명적 폴백 사유(카테고리 감지 실패 등) — 잡은 실패시키지 않되 조용히 삼키지 않는다. */
  warnings: string[]
}

/** 1단계: 카테고리 감지 + 데이터 분석 + strategy_contract 추천 — data_analysis_agent.py run() 이식 */
export async function runPdpAnalysis(input: PdpAnalysisInput): Promise<AgentOutput<PdpAnalysisOutput>> {
  const start = Date.now()
  const warnings: string[] = []

  const { category, usage: categoryUsage, warning: categoryWarning } = await resolveCategory(
    input.specSheet,
    input.groundingBlock,
    input.runContext,
  )
  if (categoryWarning) warnings.push(categoryWarning)

  const { data, usage: analysisUsage, warning: analysisWarning } = await resolveAnalysisData(
    input.specSheet,
    input.reviewsSummary,
    category,
    input.groundingBlock,
    input.runContext,
  )
  if (analysisWarning) warnings.push(analysisWarning)

  const essenceType = CATEGORY_TO_ESSENCE[category] ?? 'convenience'
  const decisionProfile = normalizeDecisionProfile(data.decision_profile)
  const objectionPriority = asStringArray(data.objection_priority)
  const recommendedContract = deriveStrategyContract(decisionProfile, objectionPriority)
  const strategyContract = mergeManualStrategy(recommendedContract, input.specSheet, warnings)

  const benefitClusters = Array.isArray(data.benefit_clusters)
    ? (data.benefit_clusters as unknown[]).filter(isPlainObject).map((c) => ({
        name: String(c.name ?? ''),
        weight: Number(c.weight) || 0,
      }))
    : []
  const painClusters = Array.isArray(data.pain_clusters)
    ? (data.pain_clusters as unknown[]).filter(isPlainObject).map((c) => ({
        pain: String(c.pain ?? ''),
        urgency: (['low', 'medium', 'high'] as const).includes(c.urgency as never) ? (c.urgency as 'low' | 'medium' | 'high') : 'medium',
      }))
    : []

  const analysis: AnalysisResult = {
    keywords: asStringArray(data.keywords),
    pros: asStringArray(data.pros),
    cons: asStringArray(data.cons),
    detected_category: category,
    usp_candidates: asStringArray(data.usp_candidates),
    raw_summary: typeof data.raw_summary === 'string' ? data.raw_summary : '',
    benefit_clusters: benefitClusters,
    pain_clusters: painClusters,
    objection_priority: objectionPriority,
    recommended_strategy_contract: recommendedContract,
  }

  return {
    success: true,
    data: { analysis, decisionProfile, strategyContract, essenceType, warnings },
    usage: {
      inputTokens: categoryUsage.inputTokens + analysisUsage.inputTokens,
      outputTokens: categoryUsage.outputTokens + analysisUsage.outputTokens,
      cost: categoryUsage.cost + analysisUsage.cost,
    },
    duration: Date.now() - start,
  }
}
