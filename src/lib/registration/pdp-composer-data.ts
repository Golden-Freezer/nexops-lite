/**
 * PDP 합성(compose) 6단계 순서·템플릿 규칙 데이터 — NEXFIT agents/template_composer_agent.py 이식.
 * LLM 호출 없는 순수 데이터·함수(PROMPT-INVENTORY §6 — 프롬프트 0건 확정). 섹션 조립 본체는
 * pdp-composer.ts·pdp-composer-sections.ts 소관.
 */

import type { StrategyContract } from './pdp-state'

/** template_composer_agent.py:71-101 — Pro 플랜 24섹션 고정 순서(section_plan·전략 템플릿 모두 없을 때 폴백) */
export const PRO_DEFAULT_ORDER: readonly string[] = [
  // Hero 오프닝
  'main_intro', 'main_cut', 'certification', 'event_banner',
  // Problem → Solution
  'problem', 'problem_empathy', 'direction_suggest', 'solution', 'product_exposure',
  // 사회적 증거 블록: 완판 → 평점 → 리뷰 인접
  'sold_out_banner', 'perf_rating', 'reviews',
  // USP 전달
  'key_message', 'concept_desc', 'point_cards', 'detail_points', 'sub2_div_page', 'how_to',
  // 마무리
  'convert_div', 'compare_div', 'recommended_targets', 'color_options', 'spec_table', 'cta',
]

/** template_composer_agent.py:686-699 — 섹션 키 이명 정규화 (설계 LLM·PRODUCT_TEMPLATES flow 별칭 → 내부 표준 키) */
export const FLOW_ALIAS: Record<string, string> = {
  perf_sales: 'sold_out_banner',
  point_div: 'point_cards',
  sub_div: 'detail_points',
  point_list_div: 'recommended_targets',
  perf_reviews: 'reviews',
  solution_guide: 'solution',
  hidden_page: 'how_to',
  hook_3step: 'main_intro',
  problem_raise: 'problem',
  petit_div: 'color_options',
}

export interface PdpTemplateFlow {
  label: string
  match: (sc: StrategyContract) => boolean
  flow: readonly string[]
  coreMessage: string
}

/**
 * template_composer_agent.py:107-149 PRODUCT_TEMPLATES 4종 — strategy_contract 기반 섹션 flow 선택표.
 * sensory_beauty_food의 visual_hook_need 체크는 원본부터 StrategyContract에 존재하지 않는 필드
 * (DecisionProfile 소속)를 잘못 참조해 항상 false로 평가되는 죽은 분기다 — 포팅 충실성을 위해 그대로
 * 보존한다(수정은 별도 결정 사항, builder 보고에 명기).
 */
export const PRODUCT_TEMPLATES: Record<string, PdpTemplateFlow> = {
  low_involvement_functional: {
    label: '저관여·기능형 생활용품',
    match: (sc) =>
      sc.involvement_level === 'low' && (sc.persuasion_axis === 'function' || sc.persuasion_axis === 'balanced'),
    flow: [
      'sold_out_banner', 'problem_empathy', 'direction_suggest', 'main_cut',
      'solution_guide', 'point_div', 'sub_div', 'point_list_div',
      'perf_reviews', 'spec_table', 'cta',
    ],
    coreMessage: '문제 해결 속도와 즉시성',
  },
  high_involvement_comparison: {
    label: '고관여·비교형 디지털/가전',
    match: (sc) =>
      sc.involvement_level === 'high' && (sc.comparison_intensity === 'medium' || sc.comparison_intensity === 'high'),
    flow: [
      'sold_out_banner', 'main_cut', 'perf_rating', 'point_div',
      'concept_desc', 'sub_div', 'direction_suggest', 'solution_guide',
      'compare_div', 'how_to', 'perf_reviews', 'spec_table', 'cta',
    ],
    coreMessage: '스펙/성능/불안 제거',
  },
  emotional_gift: {
    label: '감성형 선물/반려/아기용품',
    match: (sc) => sc.persuasion_axis === 'emotion' || sc.purchase_context === 'gift',
    flow: [
      'main_cut', 'perf_reviews', 'problem_empathy', 'direction_suggest',
      'solution_guide', 'point_div', 'key_message', 'color_options',
      'sub2_div_page', 'spec_table', 'cta',
    ],
    coreMessage: '정서적 연결 선행',
  },
  sensory_beauty_food: {
    label: '감각형 뷰티/식품',
    match: (sc) =>
      (sc.persuasion_axis === 'emotion' || sc.persuasion_axis === 'balanced') &&
      // 원본 버그 보존 — 항상 false (위 주석 참조)
      (sc as unknown as Record<string, unknown>).visual_hook_need === 'high',
    flow: [
      'sold_out_banner', 'main_cut', 'product_exposure', 'point_div',
      'concept_desc', 'sub_div', 'perf_reviews', 'direction_suggest',
      'spec_table', 'cta',
    ],
    coreMessage: '질감과 결과 중심',
  },
}

/** template_composer_agent.py:152-162 — strategy_contract 매칭 템플릿 선택, 미매칭 시 저관여 기능형 폴백 */
export function selectTemplate(strategyContract: StrategyContract): PdpTemplateFlow {
  for (const tmpl of Object.values(PRODUCT_TEMPLATES)) {
    try {
      if (tmpl.match(strategyContract)) return tmpl
    } catch {
      continue
    }
  }
  return PRODUCT_TEMPLATES.low_involvement_functional
}

/** template_composer_agent.py:165-169 */
export function ensureCtaLast(sections: readonly string[]): string[] {
  const result = sections.filter((s) => s !== 'cta')
  result.push('cta')
  return result
}

/** template_composer_agent.py:172-180 */
export function ensureSoldoutIfNeeded(sections: readonly string[], soldOutCount: number | undefined): string[] {
  const count = soldOutCount ?? 0
  if (count <= 0 || sections.includes('sold_out_banner')) return [...sections]
  return ['sold_out_banner', ...sections]
}
