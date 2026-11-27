/**
 * PDP strategy_contract 순수 규칙 로직 — NEXFIT agents/data_analysis_agent.py 이식.
 * LLM 호출 없음(decision_profile 보정 → strategy_contract 자동 추천 → 수동 힌트 머지).
 * AI 호출은 lib/agents/registration/pdp-analysis-agent.ts가 담당, 이 파일은 그 결과를 소비만 한다
 * (CLAUDE.md "AI 호출 로직과 순수 비즈니스 로직 분리" 원칙).
 */

import type { DecisionProfile, EssenceType, PdpSpecSheet, StrategyContract } from './pdp-state'

// data_analysis_agent.py:93-102 — 카테고리 → 본질 유형 매핑
export const CATEGORY_TO_ESSENCE: Record<string, EssenceType> = {
  fashion: 'emotional',
  food: 'sensory',
  digital: 'result',
  beauty: 'sensory',
  stationery: 'convenience',
  packaging: 'convenience',
  household: 'convenience',
  pet: 'emotional',
}

// StrategyContract(pdp-state.ts:50-67) Literal 필드 화이트리스트 — 원본은 Python get_type_hints/get_args로
// 런타임 반영하지만(data_analysis_agent.py:107-119) TS는 유니언을 리플렉션할 수 없어 수동 유지한다.
// StrategyContract 타입이 바뀌면 이 표도 같이 갱신할 것.
const STRATEGY_CONTRACT_WHITELIST: Record<string, readonly string[]> = {
  involvement_level: ['high', 'low'],
  persuasion_axis: ['emotion', 'function', 'balanced'],
  purchase_context: ['self_use', 'gift', 'family', 'urgent_problem', 'seasonal'],
  comparison_intensity: ['low', 'medium', 'high'],
  proof_sensitivity: ['low', 'medium', 'high'],
  page_goal: ['test', 'standard', 'conversion_max'],
  page_length_target: ['quick', 'standard', 'persuasive'],
  review_position_strategy: ['front', 'middle', 'back', 'dynamic'],
  soldout_position_strategy: ['front', 'none', 'dynamic'],
  visual_style_pack: ['clean_proof', 'warm_story', 'premium_editorial', 'cute_soft'],
  frame_style_pack: ['rounded_rect', 'editorial_mix', 'pebble_soft', 'circle_focus', 'droplet_fresh'],
  hook_mode: ['shock', 'curiosity', 'proof', 'empathy', 'authority'],
}

// 원본 _hint_fields(data_analysis_agent.py:416-421)에서 background_tone/lighting_mood 제외 —
// 이 두 필드는 StrategyContract 이식판에 없다(설계문서 범위 밖).
const MANUAL_HINT_FIELDS = [
  'involvement_level',
  'persuasion_axis',
  'page_goal',
  'review_position_strategy',
  'soldout_position_strategy',
  'visual_style_pack',
  'frame_style_pack',
] as const

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// data_analysis_agent.py:382-396 — 유효 범위 밖 값은 기본값으로 보정
export function normalizeDecisionProfile(raw: unknown): DecisionProfile {
  const dp = isPlainObject(raw) ? raw : {}
  function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return (allowed as readonly string[]).includes(value as string) ? (value as T) : fallback
  }

  return {
    involvement_level: pick<'high' | 'low'>(dp.involvement_level, ['high', 'low'], 'low'),
    comparison_intensity: pick<'low' | 'medium' | 'high'>(dp.comparison_intensity, ['low', 'medium', 'high'], 'low'),
    proof_sensitivity: pick<'low' | 'medium' | 'high'>(dp.proof_sensitivity, ['low', 'medium', 'high'], 'medium'),
    visual_hook_need: pick<'low' | 'medium' | 'high'>(dp.visual_hook_need, ['low', 'medium', 'high'], 'medium'),
    explanation_depth: pick<'quick' | 'standard' | 'deep'>(dp.explanation_depth, ['quick', 'standard', 'deep'], 'standard'),
    price_resistance: pick<'low' | 'medium' | 'high'>(dp.price_resistance, ['low', 'medium', 'high'], 'medium'),
    repeatability: pick<'one_off' | 'repeat'>(dp.repeatability, ['one_off', 'repeat'], 'one_off'),
    giftability: pick<'low' | 'medium' | 'high'>(dp.giftability, ['low', 'medium', 'high'], 'low'),
    urgency_level: pick<'low' | 'medium' | 'high'>(dp.urgency_level, ['low', 'medium', 'high'], 'medium'),
  }
}

/**
 * decision_profile 9개 축 → strategy_contract 자동 추천. 규칙 기반, LLM 호출 없음.
 * data_analysis_agent.py:124-197 derive_strategy_contract 1:1 이식.
 */
export function deriveStrategyContract(dp: DecisionProfile, objectionPriority: string[]): StrategyContract {
  const sc: StrategyContract = {}

  sc.involvement_level = dp.involvement_level ?? 'low'

  if (dp.giftability === 'high') {
    sc.persuasion_axis = 'emotion'
    sc.purchase_context = 'gift'
  } else if (
    sc.involvement_level === 'high' &&
    (dp.comparison_intensity === 'medium' || dp.comparison_intensity === 'high')
  ) {
    sc.persuasion_axis = 'function'
    sc.purchase_context = 'self_use'
  } else {
    sc.persuasion_axis = 'balanced'
    sc.purchase_context = 'self_use'
  }

  if (sc.involvement_level === 'high' && dp.comparison_intensity === 'high') {
    sc.hook_mode = 'proof'
  } else if (sc.involvement_level === 'low' && dp.proof_sensitivity === 'medium') {
    sc.hook_mode = 'empathy'
  } else if (dp.urgency_level === 'high') {
    sc.hook_mode = 'shock'
  } else if (dp.visual_hook_need === 'high') {
    sc.hook_mode = 'curiosity'
  } else {
    sc.hook_mode = 'empathy'
  }

  sc.comparison_intensity = dp.comparison_intensity ?? 'low'
  sc.proof_sensitivity = dp.proof_sensitivity ?? 'medium'

  const depth = dp.explanation_depth ?? 'standard'
  sc.page_length_target = depth === 'deep' ? 'persuasive' : depth === 'quick' ? 'quick' : 'standard'
  sc.page_goal = sc.involvement_level === 'high' ? 'conversion_max' : 'standard'

  if (sc.persuasion_axis === 'emotion' && dp.visual_hook_need === 'high') {
    sc.visual_style_pack = 'warm_story'
  } else {
    sc.visual_style_pack = 'clean_proof'
  }

  if (dp.giftability === 'high') {
    sc.frame_style_pack = 'pebble_soft'
  } else if (dp.visual_hook_need === 'high') {
    sc.frame_style_pack = 'editorial_mix'
  } else {
    sc.frame_style_pack = 'rounded_rect'
  }

  sc.review_position_strategy = dp.proof_sensitivity === 'high' ? 'front' : 'dynamic'
  sc.soldout_position_strategy = dp.urgency_level === 'high' ? 'front' : 'dynamic'

  sc.objection_priority = objectionPriority

  return sc
}

/**
 * data_analysis_agent.py:400-441 — 자유 텍스트(target_persona/brand_voice) + 수동 힌트(화이트리스트 검증) 머지.
 * 무효 힌트값은 무시하고 AI 추천값을 유지하며, 그 사유를 warnings에 밀어 넣는다(조용히 삼키지 않음).
 */
export function mergeManualStrategy(
  recommended: StrategyContract,
  specSheet: PdpSpecSheet,
  warnings: string[],
): StrategyContract {
  const merged: StrategyContract = { ...recommended }

  if (specSheet.targetPersona?.trim()) merged.target_persona = specSheet.targetPersona.trim()
  if (specSheet.brandVoiceGuide?.trim()) merged.brand_voice = specSheet.brandVoiceGuide.trim()

  const hints = specSheet.extra?.strategyHints
  if (!isPlainObject(hints)) return merged

  const applied: string[] = []
  const rejected: string[] = []
  for (const field of MANUAL_HINT_FIELDS) {
    const raw = hints[field]
    if (typeof raw !== 'string' || !raw.trim()) continue
    const value = raw.trim()
    const allowed = STRATEGY_CONTRACT_WHITELIST[field]
    if (!allowed.includes(value)) {
      rejected.push(`${field}=${value}`)
      continue
    }
    ;(merged as Record<string, unknown>)[field] = value
    applied.push(field)
  }
  if (rejected.length > 0) {
    warnings.push(`[DataAnalysis] strategy_hints 무효값 무시(AI 추천 유지): ${rejected.join(', ')}`)
  }
  return merged
}
