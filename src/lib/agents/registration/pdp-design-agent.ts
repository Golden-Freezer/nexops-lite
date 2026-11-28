/**
 * PDP 파이프라인 3단계(디자인프롬프트) 에이전트 — NEXFIT agents/design_prompt_agent.py 이식.
 * 2콜 구조(결정 C — 둘 다 Sonnet 5.5):
 *   ① planPdpSections — SECTION_PLANNING_PROMPT로 섹션 구성·순서·프레임·폰트 설계
 *   ② generatePdpDesignPrompts — DESIGN_PROMPT_ENGINEERING_PROMPT로 섹션별 이미지 프롬프트 작성
 * 함수를 분리 export한다 — 파이프라인(pdp-pipeline.ts stepDesign)이 한 run 안에서 ①·②를 함께(Promise.all) 부른다.
 * ②는 ①의 section_plan을 입력으로 받지 않는다(원본 run()은 ①→② 순차였고 ①의 section_plan을 ②에 넘겼다 — 속도 개선 1차에서 바꿈).
 *
 * 폴백 계약(원본 보존): 재시도(① callAgent 기본 2회, ② 상한 승격 1회 + API 재시도 2회 — token-steps.ts) 후에도
 * 실패하면 잡을 실패시키지 않는다 —
 * pdp-design-defaults.ts의 결정론 폴백을 채우고 usedFallback/error로 원인을 표면화한다
 * (thumbnail-vision-agent.ts의 planImpactConcept와 동일한 "graceful degradation" 패턴).
 *
 * content_length='short' 축은 이식하지 않는다(D-1 보류) — full 전용 빌더만 호출한다.
 */

import { billedCostOf } from '../billed-usage'
import type { RunContext } from '../types'
import { callLlm } from '../llm'
import { callLlmWithTokenSteps } from './token-steps'
import { PDP_MODEL_ROUTES, pdpRoute } from '@/lib/registration/pdp-model-routes'
import { parseRegistrationJson } from './llm-json'
import {
  buildSectionPlanningPrompt,
  buildDesignPromptEngineeringPrompt,
  selectFrameSystem,
  type SectionPlanningPromptInput,
  type DesignPromptEngineeringInput,
} from './prompts/pdp-design-prompts'
import {
  PRODUCT_CONSISTENCY_RULES,
  PRINTED_DESIGN_PRESERVE_INSTRUCTION,
  NO_TEXT_PHRASES,
  isTextBearingProduct,
} from './prompts/pdp-image-prompts'
import { getDefaultSectionPlan, getDefaultDesignPrompts, hasReviewsSignal } from './pdp-design-defaults'
import { optionSpecOf } from '@/lib/registration/internalized/persuasion-signals'
import {
  optionPhotoCoverage,
  optionPhotoDesignBlock,
  photographedNames,
  stripOptionMentions,
  type OptionPhotoCoverage,
} from '@/lib/registration/options/option-photo-guard'
import type {
  AnalysisResult,
  ResearchResult,
  StrategyContract,
  PdpSpecSheet,
  SectionPlan,
  DesignPrompts,
  EssenceType,
} from '@/lib/registration/pdp-state'

// 출력 상한 단계(토큰). 6000은 2026-08-10 이후 30회 모두 상한에서 잘려 결정론 폴백이었다. 잘리지 않은 실 응답은
// 8,948·9,192·9,181토큰이었다(2026-10-27 P03). 첫 값이 기본, 파싱 실패·시간 초과 때 다음 값으로 한 번 올린다
// (token-steps.ts, Vercel에서는 올리지 않음 — design 단계가 maxDuration 120초에 가깝다).
// 16000은 SDK가 스트리밍 없이 받는 한도(약 21,333) 안이다 — 32000은 SDK가 요청 전에 거부했다.
export const DESIGN_PROMPT_MAX_TOKENS_STEPS = PDP_MODEL_ROUTES['design/prompt'].maxTokensSteps

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
  /** 단계 기한(epoch ms) — 새 배치만 넘긴다(R03 설계·리서치 280초). 없으면 지금과 같다 */
  deadlineAt?: number
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
  const parsed = parseRegistrationJson(text)
  // 진단 가능성: 절단·비JSON 응답의 머리·꼬리를 로그로 남긴다(재발 시 원인 즉시 식별)
  if (!parsed) throw new Error(`섹션설계 응답 JSON 파싱 실패 (len=${text.length}, head=${text.slice(0, 80)}, tail=${text.slice(-80)})`)
  const activated = (parsed as { activated_sections?: unknown }).activated_sections
  if (!Array.isArray(activated) || activated.length === 0) {
    throw new Error('activated_sections 필드 없음')
  }
  return parsed as SectionPlan
}

/**
 * 콜 1을 건너뛴 섹션 계획(skipdesign1 잡·설계 ① 비교 재현, 결정 카드 c10·c24 J07) — 콜 없이 실패 폴백과 같은 결정론 기본 계획을 돌려준다.
 * 골격(applyDesignSkeleton)이 섹션·순서를 얹는 것은 콜을 부른 잡과 같다. 폴백이 아니라 의도한 생략이라 usedFallback·error는 비운다
 */
export function skippedSectionPlan(input: Pick<SectionPlanningInput, 'essenceType' | 'specSheet'>): SectionPlanResult {
  return { sectionPlan: getDefaultSectionPlan(input.essenceType ?? 'convenience', input.specSheet), usedFallback: false, error: null, costUsd: 0 }
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

  const route = pdpRoute('design/section-planning')
  const result = await callLlm<SectionPlan>(
    route,
    {
      system:
        'You are a persuasion-structure strategist for Korean e-commerce detail pages. Respond only with the requested JSON.',
      messages: [{ role: 'user', content: prompt }],
      // 새 배치 콜 시간·재시도(route, R03) — 없으면 지금 값
      timeoutMs: route.callTimeoutMs ?? 60_000,
      ...(route.callMaxRetries !== undefined ? { maxRetries: route.callMaxRetries } : {}),
      agentName: 'registration/pdp-section-planning',
      runContext: input.runContext,
      ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}),
    },
    parseSectionPlan
  )

  if (result.success) {
    const plan = removeUnfundedSections(enforceFixedOrder(result.data), input.specSheet)
    return { sectionPlan: plan, usedFallback: false, error: null, costUsd: billedCostOf(result) }
  }

  console.warn('[registration/pdp-design] 섹션설계 실패 — 결정론 폴백 사용:', result.error.message)
  return {
    sectionPlan: getDefaultSectionPlan(essenceType, input.specSheet),
    usedFallback: true,
    error: result.error.message,
    costUsd: billedCostOf(result),
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
  /** 텍스트 보유 상품(스티커·엽서·라벨) 여부 — 미전달 시 카테고리·상품명으로 판정한다
   *  (isTextBearingProduct, NEXFIT design_prompt_agent.py:1242-1244). 명시값이 판정을 이긴다. */
  textBearing?: boolean
  /** R1 빛·색온도 정본 — light 기록 잡(Track I)만 true. 설계 예시의 빛 문구를 바꾸고 헌장 우선 블록을 붙인다 */
  lightFromCharter?: boolean
  runContext?: RunContext
  /** 단계 기한(epoch ms) — 새 배치만 넘긴다(R03 설계·리서치 280초). 없으면 지금과 같다 */
  deadlineAt?: number
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

/**
 * 사진 없는 옵션 이름을 장면 재료(상품명·페르소나·문제·해결·포인트·사용법)에서 지운다(R2-1 원천, option-photo-guard.ts) —
 * USP 후보 "데이지/체리 컬러로 …"를 받은 LLM이 사진 없는 체리를 장면에 썼다. 옵션 기록이 없는 잡(Track S·대조군)은 그대로.
 */
function withoutUnphotographedOptions(
  input: DesignPromptEngineeringInput,
  coverage: OptionPhotoCoverage | null
): DesignPromptEngineeringInput {
  if (!coverage) return input
  const keep = photographedNames(coverage)
  const strip = (text: string) => stripOptionMentions(text, coverage.unphotographed, keep)
  return {
    ...input,
    productName: strip(input.productName),
    targetPersona: strip(input.targetPersona),
    problemQuestion: strip(input.problemQuestion),
    solutionDeclaration: strip(input.solutionDeclaration),
    detailPoints: strip(input.detailPoints),
    howTo: strip(input.howTo),
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

// ── A-3 텍스트 보유 상품 코드 강제 — NEXFIT design_prompt_agent.py:160-165, 211-256(b90f6c0) ──
const TEXT_BEARING_NEGATIVE_STRIPS: ReadonlySet<string> = new Set(['text', 'letters', 'typography', 'words', 'writing'])

/** 규칙을 정확히 한 번만 붙인다 — `_append_prompt_rule` */
function appendPromptRule(positive: string, rule: string): string {
  const normalized = rule.trim()
  if (positive.includes(normalized)) return positive
  return `${positive.trimEnd()}\n\n${normalized}`
}

/** negative에서 '텍스트 자체 금지' 토큰만 빼고 제품 밖 텍스트 금지는 남긴다 — `_strip_text_negatives` */
export function stripTextNegatives(negative: string): string {
  const kept = String(negative ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && !TEXT_BEARING_NEGATIVE_STRIPS.has(t.toLowerCase()))
  kept.push('text on background', 'caption', 'watermark')
  const seen = new Set<string>()
  return kept
    .filter((token) => {
      const key = token.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join(', ')
}

function applyTextPolicyToEntry<T extends Record<string, unknown>>(entry: T): T {
  const next: Record<string, unknown> = { ...entry }
  if (typeof next.positive === 'string' && next.positive.trim()) {
    let positive = next.positive
    for (const phrase of NO_TEXT_PHRASES) positive = positive.split(phrase).join('')
    next.positive = appendPromptRule(positive, PRINTED_DESIGN_PRESERVE_INSTRUCTION)
  }
  if (typeof next.negative === 'string') next.negative = stripTextNegatives(next.negative)
  return next as T
}

/**
 * 텍스트 보유 상품: 전 컷 프롬프트(section_image_prompts·feature_prompts·howto_prompts)에서 텍스트 금지를
 * 인쇄 보존 지시로 바꾼다 — `_apply_text_bearing_policy`. LLM이 스코프 지시를 무시해도 결과가 같다.
 */
export function applyTextBearingPolicy(prompts: DesignPrompts): DesignPrompts {
  const next: DesignPrompts = { ...prompts }
  const sections = prompts.section_image_prompts
  if (sections && typeof sections === 'object' && !Array.isArray(sections)) {
    next.section_image_prompts = Object.fromEntries(
      Object.entries(sections).map(([key, entry]) => [
        key,
        entry && typeof entry === 'object' && !Array.isArray(entry) ? applyTextPolicyToEntry(entry) : entry,
      ])
    )
  }
  for (const key of ['feature_prompts', 'howto_prompts'] as const) {
    const list = prompts[key]
    if (Array.isArray(list)) {
      next[key] = list.map((entry) =>
        entry && typeof entry === 'object' && !Array.isArray(entry) ? applyTextPolicyToEntry(entry) : entry
      )
    }
  }
  return next
}

function parseDesignPromptsRaw(text: string): Record<string, unknown> {
  if (!text.trim()) throw new Error('이미지 프롬프트 응답이 비어있습니다')
  // 응답이 템플릿의 여러 줄 블록을 문자열 값에 줄바꿈째 옮겨 적는다(실측) — 날 줄바꿈을 이스케이프해 다시 읽는다
  const parsed = parseRegistrationJson(text)
  if (!parsed) throw new Error('이미지 프롬프트 응답 JSON 파싱 실패')
  return parsed
}

/**
 * 콜 2: 섹션별 이미지 프롬프트 엔지니어링. 빈 응답·파싱 실패(parser의 throw)는 상한을 한 번 올려 다시 부르고,
 * API·시간 초과는 같은 상한으로 2회 다시 부른다(token-steps.ts, Vercel에서는 승격 없음). 그래도 실패하면
 * 결정론 폴백으로 계속한다 — 잡 실패 아님.
 * frame_system은 section_plan이 아니라 이 콜의 결과에 실린다(원본 run() 흐름과 동일 — Step3
 * hero_frame과는 별개 어휘, strategy_contract+category 기반 primary/secondary 프레임 팩).
 */
export async function generatePdpDesignPrompts(input: DesignPromptInput): Promise<DesignPromptsResult> {
  const optionCoverage = optionPhotoCoverage(optionSpecOf(input.specSheet, input.analysis))
  const promptInput = withoutUnphotographedOptions(
    buildDesignPromptEngineeringInput(input.analysis, input.research, input.specSheet),
    optionCoverage
  )
  // A-3(b90f6c0): 인쇄 문구가 상품인 상품군은 텍스트 금지 원칙을 보존 원칙으로 대체(프롬프트 스코프 + 코드 강제)
  const textBearing = input.textBearing ?? isTextBearingProduct(promptInput.category, input.specSheet.productName)
  const prompt =
    buildDesignPromptEngineeringPrompt(promptInput, PRODUCT_CONSISTENCY_RULES, {
      textBearing,
      ...(input.lightFromCharter ? { lightFromCharter: true } : {}),
    }) +
    optionPhotoDesignBlock(optionCoverage)

  const category = input.analysis.detected_category || 'general'
  const frameSystem = selectFrameSystem(input.strategyContract, category)
  const defaults = getDefaultDesignPrompts(
    promptInput.productName,
    promptInput.bgColor,
    promptInput.primaryColor,
    promptInput.secondaryColor
  )

  // 갈래(M)·백엔드는 호출 때 해석한다 — 상한 단계도 해석한 라우트 값(M은 thinking 몫만큼 늘어난다)
  const route = pdpRoute('design/prompt')
  const result = await callLlmWithTokenSteps<DesignPrompts>(
    route,
    {
      system:
        'You are an image-prompt engineer for Korean e-commerce product pages. Respond only with the requested JSON.',
      messages: [{ role: 'user', content: prompt }],
      // 새 배치 콜 시간(route.callTimeoutMs, R03) — 없으면 지금 값
      timeoutMs: route.callTimeoutMs ?? 90_000,
      agentName: 'registration/pdp-design-prompt',
      runContext: input.runContext,
      ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}),
    },
    (text) => mergeWithDefaults(parseDesignPromptsRaw(text), defaults),
    route.maxTokensSteps ?? DESIGN_PROMPT_MAX_TOKENS_STEPS,
  )

  // LLM이 예외 지시를 무시해도 코드 레벨에서 텍스트 보존을 강제한다(원본은 성공·폴백 모두 병합 뒤에 적용)
  const withTextPolicy = (prompts: DesignPrompts) => (textBearing ? applyTextBearingPolicy(prompts) : prompts)

  if (result.success) {
    return {
      designPrompts: { ...withTextPolicy(result.data), frame_system: frameSystem },
      usedFallback: false,
      error: null,
      costUsd: billedCostOf(result),
    }
  }

  console.warn('[registration/pdp-design] 이미지 프롬프트 생성 실패 — 결정론 폴백 사용:', result.error.message)
  return {
    designPrompts: { ...withTextPolicy(defaults), frame_system: frameSystem },
    usedFallback: true,
    error: result.error.message,
    costUsd: billedCostOf(result),
  }
}
