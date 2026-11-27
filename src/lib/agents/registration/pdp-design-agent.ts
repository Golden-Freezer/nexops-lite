/**
 * PDP 파이프라인 3단계(디자인프롬프트) 에이전트 — NEXFIT agents/design_prompt_agent.py 이식.
 * 2콜 구조(결정 C — 둘 다 Sonnet 5):
 *   ① planPdpSections — SECTION_PLANNING_PROMPT로 섹션 구성·순서·프레임·폰트 설계
 *   ② generatePdpDesignPrompts — DESIGN_PROMPT_ENGINEERING_PROMPT로 섹션별 이미지 프롬프트 작성
 * 함수를 분리 export한다 — 파이프라인이 한 run 안에서 ①→② 순차 호출한다(원본 run()과 동일 순서,
 * ①의 section_plan이 ②의 카피 방향·frame_system 입력에 쓰인다).
 *
 * 폴백 계약(원본 보존): 재시도(callAgent 기본 2회) 후에도 실패하면 잡을 실패시키지 않는다 —
 * pdp-design-defaults.ts의 결정론 폴백을 채우고 usedFallback/error로 원인을 표면화한다
 * (thumbnail-vision-agent.ts의 planImpactConcept와 동일한 "graceful degradation" 패턴).
 *
 * content_length='short' 축은 이식하지 않는다(D-1 보류) — full 전용 빌더만 호출한다.
 */

import type { AgentConfig, RunContext } from '../types'
import { callAgent } from '../_base'
import { parseLlmJson } from '../json-parser'
import {
  buildSectionPlanningPrompt,
  buildDesignPromptEngineeringPrompt,
  selectFrameSystem,
  type SectionPlanningPromptInput,
  type DesignPromptEngineeringInput,
} from './prompts/pdp-design-prompts'
import { PRODUCT_CONSISTENCY_RULES } from './prompts/pdp-image-prompts'
import { getDefaultSectionPlan, getDefaultDesignPrompts, hasReviewsSignal } from './pdp-design-defaults'
import type {
  AnalysisResult,
  ResearchResult,
  StrategyContract,
  PdpSpecSheet,
  SectionPlan,
  DesignPrompts,
  EssenceType,
} from '@/lib/registration/pdp-state'

// 판정/설계 정확도가 이 단계의 존재 이유(결정 C). Sonnet 5는 temperature를 400으로 거부 — 미설정,
// adaptive thinking이 JSON 출력 예산을 잠식하지 않도록 disableThinking으로 끈다.
// maxTokens 8000: 섹션 20개 스펙+폰트 스킴 JSON이 3000 토큰을 초과해 절단→파싱 실패가
// 100% 재현되던 실측(E2E 2026-08-10 — 두 잡 모두 조용히 폴백) 수리.
const SECTION_PLANNING_CONFIG: AgentConfig = {
  model: 'claude-sonnet-5',
  maxTokens: 8000,
  disableThinking: true,
}

const DESIGN_PROMPT_ENGINEERING_CONFIG: AgentConfig = {
  model: 'claude-sonnet-5',
  maxTokens: 6000,
  disableThinking: true,
}

// ─────────────────────────────────────────────────────────────────
// ① 섹션 설계
// ─────────────────────────────────────────────────────────────────

export interface SectionPlanningInput {
  analysis: AnalysisResult
  research: ResearchResult
  strategyContract: StrategyContract
  specSheet: PdpSpecSheet
  /** PdpState.essenceType(사용자 확정/분석 감지) — spec_sheet.essenceType과 별개(원본 state.essence_type) */
  essenceType?: EssenceType
  /** 그라운딩(외부 조사 등) 주입 — 콜 1 프롬프트 말미에 별도 섹션으로 append(결정 H 주입 지점 ①) */
  groundingBlock?: string
  runContext?: RunContext
}

export interface SectionPlanResult {
  sectionPlan: SectionPlan
  usedFallback: boolean
  error: string | null
  costUsd: number
}

function buildSectionPlanningInput(
  input: SectionPlanningInput,
  essenceType: string
): SectionPlanningPromptInput {
  return {
    soldOutCount: input.specSheet.soldOutCount ?? 0,
    hasReviews: hasReviewsSignal(input.specSheet),
    category: input.analysis.detected_category ?? '',
    essenceType,
    painPoints: input.research.pain_points ?? [],
    uspCandidates: input.analysis.usp_candidates ?? [],
    involvementLevel: input.strategyContract.involvement_level ?? 'low',
    persuasionAxis: input.strategyContract.persuasion_axis ?? 'balanced',
    reviewPositionStrategy: input.strategyContract.review_position_strategy ?? 'dynamic',
    hookMode: input.strategyContract.hook_mode ?? 'empathy',
    specSummary: input.analysis.raw_summary ?? '',
    hasColorOptions: Boolean(input.specSheet.colorOptions?.length),
  }
}

const SOCIAL_PROOF_SECTIONS = ['perf_sales', 'perf_rating', 'perf_reviews']
const SOCIAL_PROOF_ANCHOR_PRIORITY = ['perf_reviews', 'perf_rating', 'perf_sales']

/**
 * 섹션 순서 강제 보정 — design_prompt_agent.py:1016-1049 `_enforce_fixed_order` 1:1.
 * (1) hook_3step → main_cut 상대 순서(히어로 오프닝, 사이에 다른 섹션 끼우지 않음)
 * (2) 사회적 증거 블록(perf_sales·perf_rating·perf_reviews)을 리뷰 앵커 위치로 인접 재배치.
 * section_order·activated_sections 양쪽에 적용(원본과 동일).
 */
function enforceFixedOrder(plan: SectionPlan): SectionPlan {
  const next: SectionPlan = { ...plan }
  for (const key of ['section_order', 'activated_sections'] as const) {
    const original = next[key]
    if (!Array.isArray(original)) continue
    const order = [...original]

    const hookIdx = order.indexOf('hook_3step')
    const mainIdx = order.indexOf('main_cut')
    if (hookIdx !== -1 && mainIdx !== -1 && hookIdx > mainIdx) {
      order.splice(hookIdx, 1)
      order.splice(order.indexOf('main_cut'), 0, 'hook_3step')
    }

    const present = SOCIAL_PROOF_SECTIONS.filter((s) => order.includes(s))
    if (present.length >= 2) {
      const anchor = SOCIAL_PROOF_ANCHOR_PRIORITY.find((s) => order.includes(s)) ?? present[0]
      const anchorIdx = order.indexOf(anchor)
      const insertAt = order.slice(0, anchorIdx).filter((s) => !SOCIAL_PROOF_SECTIONS.includes(s)).length
      const rest = order.filter((s) => !SOCIAL_PROOF_SECTIONS.includes(s))
      const block = SOCIAL_PROOF_SECTIONS.filter((s) => present.includes(s))
      rest.splice(insertAt, 0, ...block)
      order.length = 0
      order.push(...rest)
    }

    next[key] = order
  }
  return next
}

/** LLM이 예외 지시를 무시해도 코드 레벨에서 제거 — design_prompt_agent.py:992-1002 하드 가드. */
function removeUnfundedSections(plan: SectionPlan, specSheet: PdpSpecSheet): SectionPlan {
  const remove: string[] = []
  if (!specSheet.certificationInfo) remove.push('certification')
  if (!specSheet.eventBannerInfo) remove.push('event_banner')
  if (remove.length === 0) return plan
  const next: SectionPlan = { ...plan }
  for (const key of ['activated_sections', 'section_order'] as const) {
    const arr = next[key]
    if (Array.isArray(arr)) next[key] = arr.filter((s) => !remove.includes(s))
  }
  return next
}

function parseSectionPlan(text: string): SectionPlan {
  if (!text.trim()) throw new Error('섹션설계 응답이 비어있습니다')
  const parsed = parseLlmJson(text)
  // 진단 가능성: 절단·비JSON 응답의 머리·꼬리를 로그로 남긴다(재발 시 원인 즉시 식별)
  if (!parsed) throw new Error(`섹션설계 응답 JSON 파싱 실패 (len=${text.length}, head=${text.slice(0, 80)}, tail=${text.slice(-80)})`)
  const activated = (parsed as { activated_sections?: unknown }).activated_sections
  if (!Array.isArray(activated) || activated.length === 0) {
    throw new Error('activated_sections 필드 없음')
  }
  return parsed as SectionPlan
}

/**
 * 콜 1: 섹션 구조 설계. callAgent 기본 재시도(2회, 파싱 실패·activated_sections 부재 모두
 * parser의 throw로 트리거)까지 실패하면 결정론 폴백으로 계속한다 — 잡 실패 아님.
 */
export async function planPdpSections(input: SectionPlanningInput): Promise<SectionPlanResult> {
  const essenceType = input.essenceType ?? 'convenience'
  let prompt = buildSectionPlanningPrompt(buildSectionPlanningInput(input, essenceType))
  if (input.groundingBlock?.trim()) {
    prompt += `\n\n## 참고 그라운딩 자료\n${input.groundingBlock.trim()}\n`
  }

  const result = await callAgent<SectionPlan>(
    {
      config: SECTION_PLANNING_CONFIG,
      system:
        'You are a persuasion-structure strategist for Korean e-commerce detail pages. Respond only with the requested JSON.',
      messages: [{ role: 'user', content: prompt }],
      timeoutMs: 60_000,
      agentName: 'registration/pdp-section-planning',
      runContext: input.runContext,
    },
    parseSectionPlan
  )

  if (result.success) {
    const plan = removeUnfundedSections(enforceFixedOrder(result.data), input.specSheet)
    return { sectionPlan: plan, usedFallback: false, error: null, costUsd: result.usage.cost }
  }

  console.warn('[registration/pdp-design] 섹션설계 실패 — 결정론 폴백 사용:', result.error.message)
  return {
    sectionPlan: getDefaultSectionPlan(essenceType, input.specSheet),
    usedFallback: true,
    error: result.error.message,
    costUsd: result.usage.cost,
  }
}

// ─────────────────────────────────────────────────────────────────
// ② 이미지 프롬프트 엔지니어링
// ─────────────────────────────────────────────────────────────────

export interface DesignPromptInput {
  analysis: AnalysisResult
  research: ResearchResult
  strategyContract: StrategyContract
  specSheet: PdpSpecSheet
  /** 텍스트 보유 상품(스티커·엽서·라벨) 여부 — 감지기(is_text_bearing_product)는 images 단계 이식
   *  예정이라 아직 배선되지 않음. 미전달 시 false(일반 NO_TEXT 경로). */
  textBearing?: boolean
  runContext?: RunContext
}

export interface DesignPromptsResult {
  designPrompts: DesignPrompts
  usedFallback: boolean
  error: string | null
  costUsd: number
}

const COMPARISON_OBJECT_NAMES = {
  paper_cup: 'a standard Korean paper cup (180ml)',
  iphone: 'an iPhone 16 (height 147.6mm)',
  hand: 'an adult Korean male hand (palm open, fingers spread)',
} as const

/** 사이즈 문자열 기반 비교 대상 추정 — design_prompt_agent.py:849-862 1:1. */
function inferComparisonObject(sizeText: string | undefined): string {
  const nums = (sizeText ?? '').match(/\d+(?:\.\d+)?/g)
  if (!nums) return COMPARISON_OBJECT_NAMES.iphone
  const maxDim = Math.max(...nums.map(Number))
  if (maxDim <= 15) return COMPARISON_OBJECT_NAMES.paper_cup
  if (maxDim <= 25) return COMPARISON_OBJECT_NAMES.iphone
  return COMPARISON_OBJECT_NAMES.hand
}

/** 콜 2 입력 조립 — design_prompt_agent.py:801-887 `_extract_prompt_data` 대응. */
function buildDesignPromptEngineeringInput(
  analysis: AnalysisResult,
  research: ResearchResult,
  specSheet: PdpSpecSheet
): DesignPromptEngineeringInput {
  const painPoints = research.pain_points ?? []
  const firstPain = painPoints[0]
  let problemQuestion = '이런 불편함 겪고 계신가요?'
  if (firstPain && typeof firstPain === 'object') {
    const insight = (firstPain as Record<string, unknown>).insight
    if (typeof insight === 'string' && insight) problemQuestion = insight
  }

  const uspCandidates = analysis.usp_candidates ?? []
  const solutionDeclaration = uspCandidates[0] ?? '이 제품으로 문제를 해결하세요'
  const detailPoints = uspCandidates.slice(0, 6).map((usp) => ({ title: String(usp), description: '' }))

  const usageInfo = specSheet.usageLocation ?? ''
  const howTo = usageInfo ? [{ step: '사용 방법', description: usageInfo.slice(0, 60) }] : []

  return {
    productName: specSheet.productName || '제품',
    category: analysis.detected_category ?? '',
    targetPersona: specSheet.targetPersona || '일반 소비자',
    // 팔레트 토큰 계약(원본 :839-847) — 실제 HEX가 아니라 리터럴 토큰을 그대로 프롬프트에 넣는다.
    // 확정 팔레트는 카피라이팅 단계 이후 images 단계에서 늦게 치환된다(_bind_palette_placeholders 대응).
    primaryColor: '{palette.primary}',
    secondaryColor: '{palette.secondary}',
    bgColor: '{palette.bgMain}',
    problemQuestion,
    solutionDeclaration: String(solutionDeclaration),
    detailPoints: JSON.stringify(detailPoints),
    howTo: JSON.stringify(howTo),
    comparisonObject: inferComparisonObject(specSheet.size),
  }
}

const DESIGN_PROMPT_DEFAULT_KEYS = [
  'section_image_prompts',
  'feature_prompts',
  'howto_prompts',
  'lighting_params',
  'color_params',
  'composition_notes',
] as const

/** Python의 falsy 판정(빈 리스트/딕셔너리도 falsy)을 재현 — JS는 `[]`/`{}` 모두 truthy라 별도 판정 필요. */
function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null || v === '' || v === 0 || v === false) return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v).length === 0
  return false
}

/** 성공 응답이라도 누락 키는 기본값으로 병합 — design_prompt_agent.py:1300-1304 1:1. */
function mergeWithDefaults(raw: Record<string, unknown>, defaults: DesignPrompts): DesignPrompts {
  const merged: Record<string, unknown> = { ...raw }
  for (const key of DESIGN_PROMPT_DEFAULT_KEYS) {
    if (isEmptyValue(merged[key])) merged[key] = defaults[key]
  }
  return merged as DesignPrompts
}

function parseDesignPromptsRaw(text: string): Record<string, unknown> {
  if (!text.trim()) throw new Error('이미지 프롬프트 응답이 비어있습니다')
  const parsed = parseLlmJson(text)
  if (!parsed) throw new Error('이미지 프롬프트 응답 JSON 파싱 실패')
  return parsed
}

/**
 * 콜 2: 섹션별 이미지 프롬프트 엔지니어링. callAgent 기본 재시도(2회, 빈 응답·파싱 실패 모두
 * parser의 throw로 트리거)까지 실패하면 결정론 폴백으로 계속한다 — 잡 실패 아님.
 * frame_system은 section_plan이 아니라 이 콜의 결과에 실린다(원본 run() 흐름과 동일 — Step3
 * hero_frame과는 별개 어휘, strategy_contract+category 기반 primary/secondary 프레임 팩).
 */
export async function generatePdpDesignPrompts(input: DesignPromptInput): Promise<DesignPromptsResult> {
  const promptInput = buildDesignPromptEngineeringInput(input.analysis, input.research, input.specSheet)
  const prompt = buildDesignPromptEngineeringPrompt(promptInput, PRODUCT_CONSISTENCY_RULES, {
    textBearing: input.textBearing,
  })

  const category = input.analysis.detected_category || 'general'
  const frameSystem = selectFrameSystem(input.strategyContract, category)
  const defaults = getDefaultDesignPrompts(
    promptInput.productName,
    promptInput.bgColor,
    promptInput.primaryColor,
    promptInput.secondaryColor
  )

  const result = await callAgent<DesignPrompts>(
    {
      config: DESIGN_PROMPT_ENGINEERING_CONFIG,
      system:
        'You are an image-prompt engineer for Korean e-commerce product pages. Respond only with the requested JSON.',
      messages: [{ role: 'user', content: prompt }],
      timeoutMs: 90_000,
      agentName: 'registration/pdp-design-prompt',
      runContext: input.runContext,
    },
    (text) => mergeWithDefaults(parseDesignPromptsRaw(text), defaults)
  )

  if (result.success) {
    return {
      designPrompts: { ...result.data, frame_system: frameSystem },
      usedFallback: false,
      error: null,
      costUsd: result.usage.cost,
    }
  }

  console.warn('[registration/pdp-design] 이미지 프롬프트 생성 실패 — 결정론 폴백 사용:', result.error.message)
  return {
    designPrompts: { ...defaults, frame_system: frameSystem },
    usedFallback: true,
    error: result.error.message,
    costUsd: result.usage.cost,
  }
}
