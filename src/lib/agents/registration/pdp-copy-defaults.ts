/**
 * PDP 카피라이팅 결정론 헬퍼(기본 카피·팔레트·프롬프트 조립 보조) — pdp-copy-agent.ts에서 분리
 * (500줄 초과 방지, CLAUDE.md 모듈화 규칙). pdp-design-defaults.ts와 동일한 역할: LLM 콜이 재시도
 * 후에도 실패했을 때만 쓰이는 폴백 데이터 + 양쪽 호출부(premium/Stage 1)가 공유하는 프롬프트 조립
 * 조각. NEXFIT agents/copywriting_agent.py :720-750(브랜드 컬러·팔레트), :752-805(기본 카피 데이터),
 * :328-334(리뷰 분석 섹션), :980-1011(섹션 가이드) 1:1 이식.
 */

import type { AgentUsage } from '../types'
import { buildReviewsAnalysisPrompt } from './prompts/pdp-copy-prompts'
import { ensureUntrustedFooter } from '@/lib/registration/review-scrubber'
import type { PdpSpecSheet, SectionPlan, CopywritingResult } from '@/lib/registration/pdp-state'

/** Pro 전용 오버레이 카피 — Premium 모드에서는 LLM이 같은 프롬프트로 생성해도 버린다(원본 plan_tier 게이트) */
export const PRO_ONLY_OVERLAY_FIELDS = [
  'productExposure', 'directionHint', 'conceptCopy', 'mainCutCopy', 'keyMessageCopy', 'convertDivCopy', 'eventBundleCopy',
] as const

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function ensureList<T>(v: unknown, fallback: T[]): T[] {
  return Array.isArray(v) ? (v as T[]) : fallback
}

export function zeroUsage(): AgentUsage {
  return { inputTokens: 0, outputTokens: 0, cost: 0 }
}

export function addUsage(a: AgentUsage, b: AgentUsage): AgentUsage {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, cost: a.cost + b.cost }
}

/** Python falsy 판정 재현(빈 문자열/배열/객체도 falsy) — pdp-design-defaults.ts isEmptyValue 관례와 동일 */
function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true
  if (Array.isArray(v)) return v.length === 0
  if (isPlainObject(v)) return Object.keys(v).length === 0
  return false
}

/** 성공 응답이라도 누락/공백 필드는 기본값으로 병합 — copywriting_agent.py:1253-1257 1:1 */
export function mergeWithDefaults(raw: Record<string, unknown>, defaults: CopywritingResult): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...raw }
  for (const [key, value] of Object.entries(defaults)) {
    if (isEmptyValue(merged[key])) merged[key] = value
  }
  return merged
}

/** groundingBlock은 프롬프트 본문 뒤에 별도 섹션으로만 append — 본문 수정 금지(§7.5, 결정 H) */
export function appendGroundingBlock(prompt: string, groundingBlock?: string): string {
  if (!groundingBlock) return prompt
  return `${prompt}\n\n## 참고 자료(코퍼스 그라운딩)\n${groundingBlock}`
}

/** reviewsText는 별도 슬롯으로 전달하므로 스펙표 JSON에서는 제외 — pdp-analysis-agent.ts 관례와 동일 */
export function buildSpecSheetJson(specSheet: PdpSpecSheet): string {
  const specForPrompt: Record<string, unknown> = { ...specSheet }
  delete specForPrompt.reviewsText
  return JSON.stringify(specForPrompt)
}

/** _build_reviews_analysis(copywriting_agent.py:328-334) — 10자 미만 리뷰는 섹션 자체를 생략 */
export function buildReviewsAnalysisSection(reviewsText: string | undefined): string {
  const text = (reviewsText ?? '').trim()
  if (text.length < 10) return ''
  const truncated = text.length > 8000 ? text.slice(0, 8000) : text
  return buildReviewsAnalysisPrompt(ensureUntrustedFooter(truncated))
}

/** _build_brand_color_instruction(copywriting_agent.py:720-734) 1:1 */
export function buildBrandColorInstruction(brandHexColor: string | undefined): string {
  const hex = (brandHexColor ?? '').trim()
  if (!(hex.length === 7 && hex.startsWith('#'))) return ''
  return `
**[필수] 사용자 지정 브랜드 컬러: ${hex}**
- designPalette.primary는 반드시 ${hex}를 사용하세요.
- designPalette.secondary는 ${hex}보다 밝은 톤(tint)을 사용하세요.
- designPalette.textHighlight도 ${hex} 또는 대비 충분한 변형을 사용하세요.
- 위의 "소재별 팔레트 가이드"보다 이 지정 컬러가 우선합니다.
`
}

/** _build_fallback_palette(copywriting_agent.py:736-750) 1:1 */
function buildFallbackPalette(brandHexColor: string | undefined): NonNullable<CopywritingResult['designPalette']> {
  const hex = (brandHexColor ?? '').trim()
  const primary = hex.length === 7 && hex.startsWith('#') ? hex : '#4f46e5'
  return { primary, secondary: '#818cf8', bgMain: '#ffffff', bgSub: '#f8fafc', textMain: '#1e293b', textHighlight: primary }
}

/** _get_default_copy_data(copywriting_agent.py:752-805) 축약 이식 — 정화·검증 파이프라인은 이 폴백에도 그대로 적용된다 */
export function getDefaultCopyData(specSheet: PdpSpecSheet): CopywritingResult {
  const productName = specSheet.productName || '상품'
  const brandName = specSheet.brandName || '브랜드'
  return {
    mainIntro: {
      category: specSheet.material || '일상용품',
      benefitHeadline: '매일이 더 편해지는 경험',
      hook: '지금 바로 경험하세요',
      subBenefit: '실용적인 기능 · 검증된 품질',
      brandAndName: `${brandName} · ${productName}`,
    },
    designPalette: buildFallbackPalette(specSheet.brandHexColor),
    problem: { question: '이런 불편함 겪고 계신가요?', empathy: '많은 분들이 같은 고민을 하십니다.' },
    solution: { declaration: '이제 걱정 없습니다', summary: '이 제품 하나면 모든 문제가 해결돼요' },
    pointCards: [
      { title: '포인트 1', description: '주요 특징을 확인하세요' },
      { title: '포인트 2', description: '놀라운 기능을 경험하세요' },
      { title: '포인트 3', description: '최고의 선택이 될 거예요' },
      { title: '포인트 4', description: '더 편리한 일상을 만나보세요' },
    ],
    summary: '고객님께 딱 맞는 제품입니다',
    colorOptions: { title: '컬러 옵션', options: ['기본 컬러'], description: '원하는 컬러를 선택하세요' },
    usageSceneTags: ['#일상', '#실용적', '#필수품'],
    detailPoints: [
      {
        claim: '매일 쓰고 싶어지는 편리함',
        proof: '인체공학 설계 + 내구성 검증 소재',
        benefit: '번거로움 없는 하루를 누리세요',
        imageHint: '제품을 편하게 사용하는 일상 장면',
      },
    ],
    howTo: [{ step: '일상에서', description: '언제든지 편하게 사용하세요' }],
    recommendedTargets: ['모든 분들께 추천드립니다'],
    closingCta: { headline: '차이를 직접 확인해 보세요', subtext: '빠른 배송 · 30일 무료 반품' },
  }
}

/** activated_sections 기반 섹션 설계 가이드 append — _run_premium/_stage1_structural_draft 공용(양쪽 문구가 거의 동일해 통합) */
export function buildSectionGuide(sectionPlan: SectionPlan, eventBannerInfo: string | undefined): string {
  const activatedSections = sectionPlan.activated_sections
  if (!activatedSections || activatedSections.length === 0) return ''
  const eventContext = eventBannerInfo
    ? `\n- event_banner 섹션이 활성화되어 있으면, soldOutBanner 카피에 실제 이벤트 정보를 반영하세요: ${eventBannerInfo}`
    : ''
  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
섹션 설계 가이드 (DesignPrompt에서 전달)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

활성화된 섹션: ${JSON.stringify(activatedSections)}
디자인 방향: ${sectionPlan.design_direction ?? ''}
섹션별 글자 수 제한: ${JSON.stringify(sectionPlan.section_specs ?? {})}

중요:
- activated_sections에 포함된 섹션의 카피만 생성하세요.
- 각 섹션의 max_chars를 반드시 지켜주세요.
- CTA는 closingCta 1개만 생성하세요 (중복 금지).
- section_specs가 비어있으면 기존 기본 글자 수를 사용하세요.${eventContext}
`
}
