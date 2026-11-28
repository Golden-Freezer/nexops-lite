/**
 * 상세페이지(PDP) 파이프라인 상태·계약 타입 — NEXFIT agents/state.py(403줄) 번역.
 *
 * 이식 결정 반영(설계문서 DESIGN-NEXFIT-GENERATORS-20260809):
 * - plan_tier(standard|premium|pro) → mode('premium'|'pro') — Standard 미이식(결정 F), 과금 게이트 아님
 * - cost_tracking → 잡 레코드 cost_usd + ai_usage_log로 갈음(플랜/결제 필드 제거)
 * - content_length short 축은 보류(개정 4/D-1) — 'full' 고정 예약 필드만 유지
 * - hero_image_mode의 'original'(Pillow 합성 의존)은 선택지 제외(개정 4/D-2)
 * - LLM JSON 산출 키는 원본 프롬프트와 바이트 동일해야 하므로 원본 케이싱(snake_case·camelCase 혼재)을
 *   그대로 보존한다 — 정규화 금지(파서가 이 키로 검증).
 */

import { INPUT_SLOT_KEYS, type InputSlotFields } from './input-slots'
import type { CodexTrace, ImageModel, ImagePendingRequest, ImageQuality } from '@/lib/agents/image/types'
import type { SubscriptionFallbackRecord } from '@/lib/agents/llm/subscription-fallback'
import type { PdpModelBackend, PdpModelBatch } from './pdp-model-batch'
import type { EnrichmentRecord } from './enrichment-switch'
import type { PersuasionRecord } from './internalized/persuasion-planner'
import type { OptionSpec } from './options/option-spec'
import type { CompetitorPainSummary, CompetitorReviews, OwnReviewFileMeta, ReviewQuote } from './reviews/review-types'
import type { ReviewSourceSnapshot } from './reviews/review-source'
import type { BundleQty, OwnSalesLine, OwnSalesSnapshot } from './own-sales'
import type { CompositeSourceRecord, KCompositeRole } from './composite/composite-types'
import type { Colors } from './editor/utils/sectionConverter/designCut/tokens'
import type { NewStageRecord } from './new-stages/common'
import type { DirectorPlan } from './new-stages/director'
import type { CutTone } from './cut-tone'
import type { FactAudit } from './new-stages/fact-audit'
import type { FinalReview } from './new-stages/final-review'
import type { FirstScreenVerdict } from './new-stages/first-screen'
import type { PagePlan } from './new-stages/plan'
import type { RegulatedClaim } from './eval/claim-lexicon'
import type { ReferenceInput } from './references/reference-types'
import type { FullImageRecord } from './fullimage/fullimage-types'
import type { SourcePhotoRole } from './source-photo-roles'
import type { HeroCopyZoneRecord } from './internalized/hero-copy-zone'
import type { SceneSet } from './scene-set'
import type { LongRecord } from './long-sections'
import type { TemplateLibRecord } from './templatelib/selection'
import type { JobCostCapRecord } from './job-cost-cap'
import type { TemplateRef } from './templatelib/template-types'

// ─── 모드·단계 ───

/** NEXFIT PlanTier 대응 — 과금 아닌 생성 모드 선택지 (state.py:14-19, Standard 제외) */
export type PdpMode = 'premium' | 'pro'

/**
 * 생성 트랙 (DESIGN-INTERNALIZED-TRACK-20260811 결정 T-1) — 잡 단위 오너 선택, 기본 standard.
 * standard = 현행 경로(코드 무변경 보존), internalized = 옵시디언 내재화(실측 골격·테마·trust gate).
 * 저장은 DDL(generation_track 컬럼) 오너 승인 전까지 spec_sheet JSONB(generationTrack)가 임시 캐리어다 —
 * 컬럼 전환 시 spec_sheet 선행분을 백필한다(부록 F-1).
 */
export type GenerationTrack = 'standard' | 'internalized'

export const GENERATION_TRACKS: readonly GenerationTrack[] = ['standard', 'internalized']

export function isGenerationTrack(v: unknown): v is GenerationTrack {
  return v === 'standard' || v === 'internalized'
}

/**
 * 잡의 생성 트랙 판정 — SSOT는 generation_track 컬럼(DDL 20260811210000). 컬럼 전환 전 JSONB
 * 캐리어(spec_sheet.generationTrack)로 생성된 구 행은 폴백으로 읽는다. 무기록·비정상 값은 standard.
 */
export function resolveGenerationTrack(job: {
  generation_track?: string | null
  spec_sheet: PdpSpecSheet
}): GenerationTrack {
  if (isGenerationTrack(job.generation_track)) return job.generation_track
  const legacy = job.spec_sheet.generationTrack
  return isGenerationTrack(legacy) ? legacy : 'standard'
}

/**
 * POST 라우트의 spec_sheet 정리 — 컬럼 전환 후 트랙은 generation_track 컬럼이 SSOT이므로
 * spec_sheet는 어느 트랙에서도 키를 갖지 않는다. spec_sheet는 buildSpecSheetJson이 통째로
 * 직렬화해 분석·카피 프롬프트에 주입되므로, 키를 남기면 LLM 입력이 오염된다(결정 T-7 —
 * 2026-08-11 verifier 적발). 클라가 specSheet에 미리 실어 보낸 값도 여기서 제거된다.
 */
export function stripGenerationTrackKey(specSheet: PdpSpecSheet): PdpSpecSheet {
  if (!('generationTrack' in specSheet)) return specSheet
  const { generationTrack: _omit, ...rest } = specSheet
  void _omit
  return rest
}

/** DB current_step 상태기계 (DDL 20260810180000 주석과 동일) */
export type PdpStep =
  | 'pending'
  | 'analysis'
  | 'research'
  | 'design'
  | 'copywriting'
  | 'images'
  | 'compose'
  | 'done'
  | 'failed'

/** 제품 본질 유형 (state.py:94-99) */
export type EssenceType = 'sensory' | 'result' | 'convenience' | 'emotional'

// ─── 전략 계약 (state.py:24-61 — V4.3 Master 장 7-1) ───

/** 모든 단계가 참조하는 단일 전략 계약. 자동 추천(분석 단계) + 수동 수정 패턴 지원 */
export interface StrategyContract {
  involvement_level?: 'high' | 'low'
  persuasion_axis?: 'emotion' | 'function' | 'balanced'
  purchase_context?: 'self_use' | 'gift' | 'family' | 'urgent_problem' | 'seasonal'
  comparison_intensity?: 'low' | 'medium' | 'high'
  proof_sensitivity?: 'low' | 'medium' | 'high'
  page_goal?: 'test' | 'standard' | 'conversion_max'
  page_length_target?: 'quick' | 'standard' | 'persuasive'
  review_position_strategy?: 'front' | 'middle' | 'back' | 'dynamic'
  soldout_position_strategy?: 'front' | 'none' | 'dynamic'
  visual_style_pack?: 'clean_proof' | 'warm_story' | 'premium_editorial' | 'cute_soft'
  frame_style_pack?: 'rounded_rect' | 'editorial_mix' | 'pebble_soft' | 'circle_focus' | 'droplet_fresh'
  hook_mode?: 'shock' | 'curiosity' | 'proof' | 'empathy' | 'authority'
  objection_priority?: string[]
  // 자유 텍스트(화이트리스트 검증 미대상) — 카피 방향 블록이 소비
  target_persona?: string
  brand_voice?: string
}

/** 의사결정 프로파일 — 분석 단계 출력, StrategyContract 추천 근거 (state.py:66-80) */
export interface DecisionProfile {
  involvement_level?: 'high' | 'low'
  comparison_intensity?: 'low' | 'medium' | 'high'
  proof_sensitivity?: 'low' | 'medium' | 'high'
  visual_hook_need?: 'low' | 'medium' | 'high'
  explanation_depth?: 'quick' | 'standard' | 'deep'
  price_resistance?: 'low' | 'medium' | 'high'
  repeatability?: 'one_off' | 'repeat'
  giftability?: 'low' | 'medium' | 'high'
  urgency_level?: 'low' | 'medium' | 'high'
}

/** 후킹 점수 — 리서치 단계 출력 (state.py:85-91, 가중치 0.30/0.25/0.15/0.15/0.15) */
export interface HookScore {
  clarity: number
  relevance: number
  novelty: number
  proof: number
  visual_stop_power: number
}

// ─── 입력: spec_sheet (NEXFIT UserInput 축약판 — state.py:115-129) ───

/** Pro 전용 히어로 컷 모드 — 'original'은 Pillow 합성 의존으로 제외(개정 4/D-2) */
/** original = 원천 사진 합성(묶음 4, 결정 A·개정 4 번복) — 합성하지 못하면 studio 프롬프트로 생성한다(NEXFIT과 같다) */
export type HeroImageMode = 'studio' | 'lifestyle' | 'premium' | 'original'

/** Pro 전용 섹션 이미지 스타일 (image_generation_agent.py:1993-1998 _style_directives 키) */
export type ImagePhotoStyle = 'studio' | 'lifestyle' | 'minimal' | 'warm_tone'

/** 참조 이미지 장수 상한 SSOT — PdpForm(업로드 UI)과 POST /api/registration/pdp(검증)가 공유한다. */
export const PDP_MAX_SOURCE_IMAGES = 6

/** POST 라우트·폼이 공유하는 순수 검증 — 최소 1장, 상한은 PDP_MAX_SOURCE_IMAGES. */
export function isValidSourceImageCount(count: number): boolean {
  return count >= 1 && count <= PDP_MAX_SOURCE_IMAGES
}

/**
 * 잡 생성 입력 spec_sheet (JSONB). NEXFIT spec_sheet dict + UserInput 필드 축약.
 * brand_voice_guide는 선택 — 미입력 시 기본 톤 가이드(쿠팡 로켓그로스 문맥) 주입(결정 F).
 */
export interface PdpSpecSheet extends InputSlotFields {
  productName: string
  brandName?: string
  /** 미지정 시 분석 단계가 자동 감지 (CATEGORY_DETECTION_PROMPT) */
  category?: string
  /**
   * 세부 카테고리(선택) — 판정 8종(category)에 없는 사용 대상 구분. 상품 정보 표의 사용연령 판정(product-info-rows)에만 쓴다.
   * 근거·어휘 조회는 category 그대로이고 프롬프트에도 들어가지 않는다
   */
  categoryDetail?: string
  /**
   * 분석 단계가 자동 감지해 남긴 사용연령 면제 표시(반려동물·식품, specWithDetectedExempt) — 상품 정보 표의 사용연령 판정에만 쓴다. 프롬프트에 들어가지 않는다.
   * category에 쓰지 않는다 — 프롬프트 스펙 JSON에 들어가고 재실행 때 감지 콜을 건너뛰게 된다
   */
  detectedCategory?: string
  /** 식별 카드에 덧붙일 확정 특징(선택, 영어 한 줄) — 사진 한 장에만 보여 판독이 확정하지 못하는 실물 부품(P07 다리 끝 캡). 사진 생성에만 쓴다 */
  identityNote?: string
  /** 제품군(선택, product-family.ts) — K 템플릿 고르기에만 쓴다. 프롬프트에 들어가지 않는다 */
  productFamily?: string
  essenceType?: EssenceType
  keyFeatures?: string[]
  material?: string
  usageLocation?: string
  size?: string
  colorOptions?: string[]
  /** 다옵션 구조(05_OPTIONS.md §3) — Track I이고 ENRICHMENT options가 기록된 잡만 읽는다. colorOptions는 variant label 목록 그대로 둔다 */
  optionSpec?: OptionSpec
  soldOutCount?: number
  rating?: number
  reviewCount?: number
  /** 리뷰 원문 텍스트 (붙여넣기, 또는 자사 리뷰 파일의 정화·표집 직렬화 텍스트. 8,000자 절단은 카피 단계 규칙) */
  reviewsText?: string
  /** 자사 리뷰 파일 메타(pdp-review-input) — 화면 표시용. 프롬프트 직렬화에서 뺀다(buildSpecSheetJson) */
  reviewFiles?: { own?: OwnReviewFileMeta }
  /** 경쟁사 리뷰(pdp-review-input, 오너가 올린 파일만) — 분석 단계 경쟁사 콜과 재현 가드만 읽는다.
   *  프롬프트 직렬화에서 뺀다(buildSpecSheetJson) — 카피·리서치·설계 프롬프트에 원문이 들어가지 않는다 */
  competitorReviews?: CompetitorReviews
  /** 리뷰 받을 쿠팡 상품 번호(같은·경쟁 상품 1~3개, 오너 2026-11-05 승인) — 폼이 수집을 요청하고, 잡 생성 때 서버가 그때까지 받은
   *  competitor_reviews로 competitorReviews를 채운다(엑셀 경쟁사 파일이 있으면 엑셀만). 프롬프트 직렬화에서 뺀다 */
  reviewSourceProductIds?: string[]
  /** 잡 생성 때 쓴 수집 리뷰 기록(상품 번호·행 수·collected_at) — 서버만 쓴다(입력값은 버린다). 프롬프트 직렬화에서 뺀다 */
  reviewSourceSnapshot?: ReviewSourceSnapshot
  /** 우리 판매량(J51) — 생성 화면에서 고른 같은 사업장 등록상품ID(5개 이하). 잡 생성 때 서버가 판매장부를 읽는다(own-sales-load). 프롬프트 직렬화에서 뺀다 */
  ownSalesProductIds?: string[]
  /** 우리 판매량 — 화면에서 옵션(products.id)마다 넣은 1묶음 수량. 옵션명보다 이긴다. 프롬프트 직렬화에서 뺀다 */
  ownSalesBundleQty?: Record<string, BundleQty>
  /** 우리 판매량 — 잡 생성 때 서버가 남긴 옵션별 판매·묶음 수량·판정(서버만 쓴다, 입력값은 버린다). 프롬프트 직렬화에서 뺀다 */
  ownSalesSnapshot?: OwnSalesSnapshot
  /** 우리 판매량 — 판매 수 × 묶음 수량 합과 기간 문구(서버만 쓴다, 판정 ok일 때만). 프롬프트에 그대로 들어간다(통합 decide 30) */
  ownSales?: OwnSalesLine
  /** 레퍼런스(기존 상세 캡처·PDF, 분석 전용 — 업로드 때 분석한 결과만, 3개 이하) — 분석 산출은 리서치 덧붙임 블록으로만,
   *  원문 transcript는 재현 가드·유사도 검사만 읽는다. 프롬프트 직렬화에서 뺀다(SPEC_PROMPT_EXCLUDED_KEYS) */
  referenceInputs?: ReferenceInput[]
  targetPersona?: string
  brandVoiceGuide?: string
  brandHexColor?: string
  /** 인증/특허/수상 근거 텍스트 — 없으면 certification 섹션 스킵(결정 H 격차 4종 규칙) */
  certificationInfo?: string
  eventBannerInfo?: string
  /** 사용 연령 하한(만 나이). ≥14면 컴플라이언스 게이트 발동 — 어린이(만 14세 미만) 사용 묘사를
   *  카피·이미지에서 금지하고 고지 문구를 강제한다(compliance-gate.ts, 어린이 KC 미인증 상품 보호). */
  minAgeYears?: number
  // ── Pro 전용 생성 옵션 4종 (결정 F, generate/page.tsx:546-549 실측) ──
  heroImageMode?: HeroImageMode
  imagePhotoStyle?: ImagePhotoStyle
  photographyNote?: string
  // (4종 중 image_quality는 잡 컬럼 image_quality로 흡수 — Phase 1 관례)
  /** short 축 보류(D-1) — 'full' 고정 예약 */
  contentLength?: 'full'
  /** (레거시) 컬럼 전환(DDL 20260811210000) 전 JSONB 캐리어 — 신규 행은 기록하지 않는다
   *  (stripGenerationTrackKey가 제거). resolveGenerationTrack의 구 행 폴백만 읽는다. */
  generationTrack?: GenerationTrack
  /** 원본 spec_sheet 자유 필드 (프롬프트에 JSON 직렬화로 주입) */
  extra?: Record<string, unknown>
  // ── W2a 입력 배선(PDP-W2W3 계약 v1 §1, DDL 없음 — 정리 규칙은 spec-inputs.ts normalizeSpecInputs) ──
  /** 무게(40자 이하, 예 "120g") — 사실표로 들어간다 */
  weight?: string
  /** 원산지 표기 그대로(40자 이하, 예 "중국") — 사실표로 들어간다 */
  origin?: string
  /**
   * 추가 스펙(12행 이하, key 20자·value 60자 이하, key가 겹치면 마지막 값) — 카피 상품 사실 블록(spec-facts)과 긴 상세페이지 확장 표
   * (long-sections)에 쓴다. 기본 스펙 표(dedupe specRowsFromInput)는 읽지 않는다
   */
  extraSpecs?: Array<{ key: string; value: string }>
  /** 후기 섹션 인용 카드(6장 이하) — 후기 섹션 전용 블록으로만 넣고 스펙 JSON 일반 직렬화에서는 뺀다(SPEC_PROMPT_EXCLUDED_KEYS) */
  reviewQuotes?: ReviewQuote[]
  /** 초안에서 채운 필드 이름(화면 표시 전용, 오너가 고치면 뺀다) — 프롬프트에 넣지 않는다 */
  draftPrefill?: string[]
  /** 등록 검색 태그(초안에서 옮김, 20개 이하·한 개 30자 이하) — 학부모 대리 구매형 판정(parent-proxy)만 읽고 프롬프트에 넣지 않는다 */
  searchTags?: string[]
  /**
   * 원천 사진 역할(결정 카드 c12, source-photo-roles.ts) — 폼이 고른 원본이 아닌 사진만 {url, role: option|explain}. 잡 생성 라우트가
   * source_images에 있는 주소만 남긴다. photoroles 기록 잡의 이미지 단계만 읽고 프롬프트 스펙 JSON에는 넣지 않는다
   */
  sourcePhotoRoles?: SourcePhotoRole[]
}

/**
 * 프롬프트 스펙 JSON에서 빼는 키 — 별도 칸으로 넣는 것(리뷰 원문 reviewsText·옵션 구조 optionSpec·인용 카드 reviewQuotes)과
 * 넣지 않는 것(파일 메타 reviewFiles·경쟁사 원문 competitorReviews·레퍼런스 분석·원문 referenceInputs·화면 표시용 draftPrefill·
 * 판정 입력 searchTags).
 * 카피·분석 직렬화가 함께 쓴다
 */
export const SPEC_PROMPT_EXCLUDED_KEYS = [
  'reviewsText',
  'optionSpec',
  'reviewFiles',
  'competitorReviews',
  'reviewSourceProductIds',
  'reviewSourceSnapshot',
  'ownSalesProductIds',
  'ownSalesBundleQty',
  'ownSalesSnapshot',
  'referenceInputs',
  'reviewQuotes',
  'draftPrefill',
  'searchTags',
  'sourcePhotoRoles',
  'categoryDetail',
  'detectedCategory',
  'productFamily',
  'identityNote',
  // 입력 칸(input-slots.ts) — 부품이 값을 그대로 그린다. 값이 있어도 앞 단계·R 라인이 바뀌지 않게 프롬프트에서 뺀다
  ...INPUT_SLOT_KEYS,
] as const satisfies readonly (keyof PdpSpecSheet)[]

/** 입력으로 확정한 특징을 카드 끝에 붙인다 — 판독이 실패해 카드가 비면 그 특징만 카드가 된다 */
export function withIdentityNote(card: string, note: string | undefined): string {
  const confirmed = note?.trim()
  if (!confirmed) return card
  return card ? `${card}, ${confirmed}` : `PRODUCT IDENTITY (confirmed by the seller — the generated product must match): ${confirmed}`
}

/** 프롬프트용 스펙 JSON — 제외 키를 뺀 나머지를 등록 순서 그대로(없는 키는 바이트가 그대로다) */
export function specSheetPromptJson(specSheet: PdpSpecSheet): string {
  const specForPrompt: Record<string, unknown> = { ...specSheet }
  for (const key of SPEC_PROMPT_EXCLUDED_KEYS) delete specForPrompt[key]
  return JSON.stringify(specForPrompt)
}

// ─── 1단계: 데이터분석 출력 (state.py:132-144) ───

export interface AnalysisResult {
  keywords?: string[]
  pros?: string[]
  cons?: string[]
  detected_category?: string
  usp_candidates?: string[]
  raw_summary?: string
  /** [{name, weight}] weight 합계 1.0, 최대 5개 */
  benefit_clusters?: Array<{ name: string; weight: number }>
  pain_clusters?: Array<{ pain: string; urgency: 'low' | 'medium' | 'high' }>
  objection_priority?: string[]
  recommended_strategy_contract?: StrategyContract
  /** Track I + ENRICHMENT 잡만 — 분석 단계 decision_profile 보존(설계 §4.2 분석 보존). Track S·구 잡에는 없음 */
  decision_profile?: DecisionProfile
  /** Track I + ENRICHMENT 잡만 — 잡 단위 기능 기록(설계 §4.7). 프롬프트 직렬화에서는 뺀다(analysisForPrompt) */
  enrichment?: EnrichmentRecord
  /** 경쟁사 리뷰 파일이 있는 잡만 — 불만 유형·빈도(pdp-review-input). analysisForPrompt가 빼고 리서치 덧붙임 블록으로만 넘긴다 */
  competitor_pain_points?: CompetitorPainSummary
  /** 카테고리 판정 기록(결정 카드 c11, 하네스 J22 — 이 칸 전 잡에는 없다). 기록만 한다: analysisForPrompt가 빼고, 목록 밖이어도 다시 판정하지 않는다 */
  category_check?: CategoryCheck
}

/**
 * 카테고리 판정 기록 — 어디서 왔는지(감지 콜·판매자 지정·감지 실패 기본값), 모델이 준 확신값·근거, 정해 둔 카테고리 목록
 * (CATEGORY_TO_ESSENCE 키) 안인지. 목록 밖이면 성격(essence)은 기존대로 convenience로 간다 — 이 기록은 그 사실을 남길 뿐이다(가정 C3)
 */
export interface CategoryCheck {
  source: 'llm' | 'spec' | 'fallback'
  category: string
  /** 감지 콜이 준 0~1 값 — 콜이 없었거나 값이 없거나 범위 밖이면 null(값을 고쳐 넣지 않는다) */
  confidence: number | null
  /** 감지 콜이 준 분류 근거(500자까지) — 콜이 없었거나 비었으면 null */
  reasoning: string | null
  inList: boolean
}

// ─── 2단계: 리서치플래닝 출력 (state.py:147-159) ───

export interface ResearchResult {
  /** [{insight, support_count, evidence}] — 리뷰 원문 인용 금지 규칙 */
  pain_points?: Array<Record<string, unknown>>
  review_insights?: Record<string, unknown>
  usp_mapping?: Record<string, string>
  planning_skeleton?: {
    hook_theme?: string
    story_flow?: unknown[]
    sections?: unknown[]
    cta_strategy?: string
    [key: string]: unknown
  }
  target_insights?: string
  hook_candidates?: Array<{ mode: string; headline: string }>
  section_purpose_map?: Array<{ section: string; purpose: string }>
  proof_plan?: { required_proof_types?: string[]; minimum_proof_count?: number }
  length_plan?: Record<string, unknown>
  /** 새 단계 기획 1장(R10, 새 배치 + newstages 잡만) — 설계·카피 프롬프트는 리서치 칸을 골라 읽어 이 키를 보지 않는다 */
  page_plan?: NewStageRecord<PagePlan>
}

// ─── 3단계: 섹션 설계 + 이미지 프롬프트 (state.py:278-305) ───

export interface SectionPlan {
  hook_strategy?: Record<string, unknown>
  activated_sections?: string[]
  section_order?: string[]
  section_specs?: Record<string, unknown>
  design_direction?: string
  reasoning?: string
  /** Pro 전용: {proSectionType: layoutCategory} — Phase 3 에디터가 소비 */
  layout_selections?: Record<string, string>
  font_scheme?: Record<string, Record<string, string>>
  /** Track I 전용 — 골격 결정 감사 추적(buildSkeleton 산출의 roles·excluded). Track S 잡에는 없음 */
  internalized_skeleton?: {
    roles: Array<{ role: string; reason: string }>
    excluded: Array<{ role: string; reason: string }>
    /** ENRICHMENT persuasion 잡만 — 설득 플래너 근거(문법·단계·고민 응답·규칙) */
    persuasion?: PersuasionRecord
  }
  /** ENRICHMENT 잡만 — 설계 단계 기록(설계 §4.7) */
  enrichment?: { version: 1; features: string[]; vocabHash: string | null }
  /** designcut 기록 잡만(D1) — 디자인 컷 비교군 계획. 편집기(D2)가 읽는다. images 단계 첫 run이 기록한다 */
  designcut?: DesigncutPlan
  /** K 라인 선택 기록(templatelib 잡만, 15_TEMPLATE_LINE §10) — 컨셉·색·섹션별 템플릿·만들 컷·카피 문제 수. 원장이 읽는다(template-ledger) */
  templatelib?: TemplateLibRecord
  /** designcut 기록 잡만 — 원천 사진 색 측정(08 §4.1). images 단계 첫 run이 계획보다 먼저 기록하고 계획이 읽는다 */
  designcut_photo?: DesigncutPhotoRecord
  /** partsbands K 잡만(J54) — 옵션 실물 사진마다 잰 대표색. images 단계 첫 run이 K 계획보다 먼저 기록하고 옵션 색 띠(option.bands)가 읽는다 */
  option_colors?: OptionColorsRecord
  /** composite 기록 잡만(묶음 4, 12_ORIGINAL_COMPOSITE.md) — 원본 합성 판정. images 단계 첫 run이 맨 앞에서 한 번 기록한다 */
  composite_source?: CompositeSourceRecord
  /** 편집기 카피 재생성 기록(pdp-copy-regen-api) — 최근 20건. 카피 자체는 편집기 저장본이 가진다 */
  editor_copy_regen?: EditorCopyRegenRecord[]
  /** long 기록 잡만(긴 상세페이지 L-1) — 설계 단계 근거 판정(확장 섹션·뺀 사유·길이 목표). 편집기 변환이 읽는다(long-sections.ts) */
  long?: LongRecord
  /** 사진 없이 끝난 컷(cut-failures) — images 단계가 compose로 넘어갈 때 지금 태스크 기준으로 다시 쓴다. count 0이면 빠진 컷이 없고, 칸이 없으면 이 칸 전의 잡이다 */
  cuts_failed?: { count: number; sections: string[] }
  /** 첫 생성이 잡당 비용 상한(job-cost-cap, 점검 고침 5)에 닿아 이미지 단계가 컷을 정리한 기록 — 경고용. 칸이 없으면 닿지 않았다 */
  job_cost_cap?: JobCostCapRecord
  /** shotdiv 기록 디자인 컷 잡만 — 컷 목적 계획(internalized/shot-diversity.ts). images 단계 첫 run이 디자인 컷 계획 직전에 기록한다 */
  extra_shots?: ExtraShotPlan
  /**
   * 디자인 컷 잡만(K 라인 제외) — 컷 키별 무대 이름(적용 D4 ⓐ, 기록만). 디자인 컷 계획과 함께 기록한다(pdp-image-tasks designcutStagesOf).
   * 프롬프트는 이 칸을 읽지 않는다. 장치 지표 최다 무대(plan-metrics topStageShare)가 읽는다. 칸이 없으면 이 칸 전의 잡이다
   */
  designcut_stages?: Record<string, DesigncutStage>
  /** 새 단계 K 칸 카피 뒤 사실 감사(R10, 새 배치 + newstages 잡만) — 기록+경고, 글을 고치지 않는다 */
  kslot_fact_audit?: NewStageRecord<FactAudit>
  /** 새 단계 첫 화면 심사(R10) — 파이프라인에 렌더러가 없어 웹 잡은 생략 기록 */
  first_screen?: NewStageRecord<FirstScreenVerdict>
  /** 새 단계 최종 검수(R10) — 기록+경고, 글을 고치지 않는다 */
  final_review?: NewStageRecord<FinalReview>
  /**
   * 구독 → API 잇기 기록(R13, 구독 표지 잡만 — agents/llm/subscription-fallback) — 잇기마다 단계·사유·청구액. 프롬프트·편집기는
   * 읽지 않는다. 칸이 없으면 잇기가 없었다(또는 구독 표지가 없는 잡이다)
   */
  subscription_fallback?: SubscriptionFallbackRecord[]
  /**
   * 구독 멈춤 기록(AX-CT-29, 구독 멈춤 표지 잡만) — 있으면 작업자 큐가 집지 않고 웹 run도 진행하지 않는다. '이어 하기'(resume)가 지운다
   */
  subscription_halt?: SubscriptionHaltRecord
}

/** 구독 멈춤 사유 — worker_stale = 작업자 5분 무응답, 나머지는 구독 콜의 소프트 종료·프로세스 실패 */
export type SubscriptionHaltReason = 'worker_stale' | 'quota' | 'unavailable' | 'timeout' | 'process'

export interface SubscriptionHaltRecord {
  at: string
  /** 멈춘 단계(current_step) */
  stage: string
  reason: SubscriptionHaltReason
  /** 사유 글(앞 200자) — 비밀값은 없다 */
  detail: string
}

/** 디자인 컷 컷의 무대 — K 무대 이름과 같은 자(세트 안 life, 세트 아닌 다른 장소 place, 세트가 흐린 바탕으로만 남는 근접 macro, 헌장 단색 바탕 solid) */
export type DesigncutStage = 'life' | 'place' | 'macro' | 'solid'

/** 사진 안 제품 경계(비율 0~1)와 사진 가로/세로 — 사이즈 단독 컷(size-cut.ts) */
export interface ProductBox {
  left: number
  top: number
  width: number
  height: number
  aspect: number
  /** 사진 바탕색(네 귀퉁이 평균) — T6 무대를 이 색으로 칠해 사진과 이어지게 한다. 옛 잡에는 없다 */
  background?: string
  /** 경계를 믿기 어렵다(바탕과 비슷한 제품 일부가 빠졌다) — 선을 긋지 않는다 */
  uncertain?: true
}

/** 추가 컷 목적 — 밑면·안쪽·단면 / 크기 비교 / 다른 장소의 사용 / 근접 질감. 디자인 컷 계획(T10 '자세히 보기')은 이 넷만 받는다 */
/** 첫 화면 사진 유형(hero-kind.ts) */
export type HeroKind = 'in_use' | 'worn' | 'studio'

export type ExtraShotPurpose = 'underside' | 'scale' | 'scene' | 'texture' | 'angle'
/** POINT 특징 컷 목적 — 증명 셋 + 손 동작, 맞는 목적이 없으면 서로 다른 앵글(angle) */
export type PointShotPurpose = ExtraShotPurpose | 'action'

/** 컷 목적 계획(shotdiv) — 같은 목적은 페이지에 한 번. 디자인 컷 계획은 shots만 읽는다 */
export interface ExtraShotPlan {
  version: 1
  /**
   * 추가 컷(기록 순서 = 막 안 순서 — 실사용 → 디테일 → 남은 증명, 늘 2장 이상). key = features:N(N ≥ 4, POINT·자세히 보기 컷 다음
   * 번호)·long_scene:0. proves = 근거 위치(근거 없는 질감 디테일은 'detail', 태그 없는 실사용은 'everyday'), caption = 그 컷 캡션,
   * show = 근거가 카피 주장이면 그 주장 글(목적 블록이 그 대상을 화면에 남기게)
   */
  shots: Array<{
    key: string
    purpose: ExtraShotPurpose | 'action'
    proves?: string
    caption?: string
    show?: string
    angle?: number
    /** fillacts — 이 컷이 붙는 큰 POINT(features:i의 i). 없으면 막 컷 */
    point?: number
    /** fillacts — 이 컷이 붙는 메시지 섹션 키(designcut-fill). 글은 show에 있다 */
    message?: string
  }>
  /** fillacts — 사진 막. keys는 shots의 key이고 title은 막 제목이다. 사진 아래 캡션은 없다 */
  acts?: Array<{ title: string; keys: string[] }>
  /** POINT 특징 컷(features:i)의 목적. angle = 앵글 번호(shot-diversity SHOT_ANGLES), show = 그 컷 주제 글(제목 — 설명, 80자) */
  points: Array<{ key: string; purpose: PointShotPurpose; angle?: number; show?: string }>
  /** 캡션 검사(기록만) — 본 캡션 수, 붙어쓰기 의심('위치:덩어리'), 목적 낱말이 안 맞는 캡션 위치(종류마다 5개까지) */
  captions: { checked: number; unspaced: string[]; mismatched: string[] }
}

// ─── 디자인 컷 비교군(D1) — docs/plans/pdp-enrichment/08_DESIGN_CUTS.md, 02 D1 절 데이터 계약 ───

/**
 * T9 사실 표·T10 사용 장면 연속 컷은 디자인 컷 긴 페이지(designlong, internalized/designcut-long.ts)와 D2 상품 정보 표가 쓴다.
 * T11 자세히 보기(큰 POINT 3개 밖 특징 묶음)·T12 후기 카드는 D2(designcut2) 계획만 쓴다(internalized/designcut-structure.ts)
 */
export type DesigncutTemplate =
  | 'T1'
  | 'T2'
  | 'T3a'
  | 'T3b'
  | 'T3c'
  | 'T4'
  | 'T4Q'
  | 'T5'
  | 'T6'
  | 'T7'
  | 'T8'
  | 'T9'
  | 'T10'
  | 'T11'
  | 'T12'
/** 템플릿 형태 변형(D2 — 계획이 정하고 편집기가 그 이름으로 그린다). 칸이 없으면 scene(지금 형태) */
export type DesigncutLayoutVariant = 'scene' | 'zigzag' | 'list' | 'grid' | 'card' | 'half' | 'cards'
/** 채움 메시지 머리 변형(D6 P3) — band 강조색 띠 안 제목(T2-40), rule 짧은 선 + 가운데 제목(T2-53) */
export type DesigncutHeadVariant = 'band' | 'rule'
/** 바탕 유형(08 §4.3) — W 흰 · T 파스텔 · N 회색 · D 짙은 면 · P 사진 */
export type DesigncutBg = 'W' | 'T' | 'N' | 'D' | 'P'

/** 원천 사진 색 측정(08 §4.1) — 촬영 배경(가장자리 링 중앙값)과 제품색(배경 밖 픽셀 Lab k-means 최대 유채 군집) */
export interface DesigncutPhoto {
  version: 1
  background: string
  backgroundTransparent: boolean
  /** 면적·채도 하한을 넘는 군집이 없으면 null(흰·회·검정 제품 — 중립 모드) */
  product: string | null
  /** 불투명 픽셀 중 배경 밖 비율 */
  productShare: number
  /** 제품 픽셀 L* 중앙값 */
  productLightness: number
  /** 제품색 군집 C*(없으면 0) */
  productChroma: number
  /** 면적순 군집(진단용) */
  clusters: Array<{ color: string; share: number }>
}
/** 측정 실패(사진 없음·디코딩 실패·배경뿐)는 사유만 — 계획은 카피 팔레트 파생으로 폴백한다 */
export type DesigncutPhotoRecord = DesigncutPhoto | { version: 1; failed: string }
/** 옵션 사진 색(J54) — 옵션 이름·사진 주소·잰 색. 잴 사진이 없거나 하나라도 못 재면 failed(옵션 색 띠를 그리지 않는다) */
export type OptionColorsRecord = { version: 1; colors: Array<{ label: string; image: string; hex: string }> } | { version: 1; failed: string }

/** 인포그래픽 모듈 데이터(08 §6) — 카피·스펙 값을 그대로 옮긴다(새 문구 없음) */
export type DesigncutModule =
  | { type: 'M6'; data: { chapter: number } }
  | { type: 'M2b'; data: { imageKey: string } }
  | { type: 'M2a'; data: { lines: string[] } }
  | { type: 'M1'; data: { items: string[] } }
  | { type: 'M7'; data: { steps: Array<{ title: string; description: string | null }> } }
  | { type: 'M4'; data: { dims: Array<{ axis: 'w' | 'h' | 'd'; value: number; unit: string }>; raw: string } }
  /** image: 옵션 섹션(T7)만 — 등록 옵션의 실물 사진(variants.sourceImage). 없으면 null(사진 없는 변형은 이름만) */
  | { type: 'M8'; data: { chips: Array<{ label: string; color: string | null; image?: string | null }> } }
  /** 긴 페이지 사실 표 행(T9 — 사이즈·구성·관리·질문, long-sections longTables 값 그대로) */
  /** matrix: D2 사이즈 행렬 표(long:matrix)만 — C1 입력 행렬 그대로(편집기가 값이 짧으면 격자로 그린다). rows는 같은 값을 '치수 값 · …' 줄로 담는다 */
  | { type: 'M9'; data: { rows: Array<{ label: string; value: string }>; matrix?: { columns: string[]; rows: Array<{ label: string; values: string[] }> } } }
  /** 긴 페이지 구석구석 보면(T10) — 이미지 쪽 기록(section_plan.extra_shots)의 컷 키(features:N·long_scene:i)와 캡션(없으면 '') */
  | { type: 'M10'; data: { scenes: Array<{ imageKey: string; caption: string }> } }
  /** D2 자세히 보기(T11) — 큰 POINT 밖 특징(카피 제목·설명 그대로)과 그 특징의 피처 컷(features:i, 없으면 null) */
  /** icon은 선택 칸 — K 아이콘 사전(templatelib/icons.ts) 이름만(적용 T1-60 D, 읽을 때 사전 밖 이름은 버린다). 지금 카피는 채우지 않는다 */
  | { type: 'M11'; data: { items: Array<{ title: string; description: string | null; imageKey: string | null; icon?: string }> } }
  /**
   * D2 후기(T12) — 카피 reviewHighlights(#330 규칙: 가린 작성자·요약 본문·인용 금지 표현 제외) 최대 5장, 평점은 원본만(없으면 null),
   * rating·count는 입력 평점·리뷰 수(없으면 null). bars는 자사 리뷰 파일 rating_counts 원본 5점→1점 개수(적용 D6 P1 T1-69·T2-19,
   * 합계 5건 이상일 때만 — 없으면 칸이 없다. 옛 계획은 이 칸이 없다)
   */
  | {
      type: 'M12'
      data: {
        cards: Array<{ text: string; author: string; rating: number | null; month?: string; summary?: true }>
        rating: number | null
        count: number | null
        bars?: Array<{ star: 1 | 2 | 3 | 4 | 5; count: number }>
      }
    }

export interface DesigncutSection {
  /** section_order 키. usp 분할은 `point_div:<i>`·`sub_div:<i>` */
  key: string
  role: string
  template: DesigncutTemplate
  bg: DesigncutBg
  /** POINT 번호(usp만, 페이지 연속) */
  chapter: number | null
  /** usp 분할 조각의 카피 인덱스(pointCards[i]·detailPoints[i]) */
  pointIndex?: number
  /** 배경 플레이트 section_images 키 `plate:<key>` — 플레이트 없는 템플릿은 null */
  plateKey: string | null
  plateAspect: '1:1' | '2:3' | '3:2' | null
  /** 제품·연출 컷 section_images 키 */
  productImageKey: string | null
  /** 제품 컷 누끼(알파) 여부 — 배경 제거 단계가 없어 항상 false(편집기는 액자 대체안) */
  productAlpha: boolean
  /**
   * copy_sections.final 값 그대로(빈 값은 null — 편집기는 그 줄을 그리지 않는다). hook은 D2 첫 화면(T1)만 — mainIntro.hook, 없으면
   * 칸 없음(편집기가 제목 위에 그린다)
   */
  text: {
    eyebrow: string | null
    headline: string | null
    sub: string | null
    hook?: string
    /** 모델이 고른 제목 강조 구절(적용 T1-17, 카피 headlineAccents에서 이 제목의 부분 문자열로 검사한 값). 없으면 지금 규칙(USP 낱말·수량) */
    accent?: string
  }
  modules: DesigncutModule[]
  /** D2 형태 변형 — 칸이 없으면 scene */
  layoutVariant?: DesigncutLayoutVariant
  /** D2 채움 메시지(장 번호 없는 T3a) 머리 변형(적용 D6 P3 T2-40·T2-53) — 칸이 없으면 지금 머리. 큰 POINT에는 두지 않는다 */
  headVariant?: DesigncutHeadVariant
  /**
   * D2 구역 연결 표식(적용 D6 P5 R-W9·T2-13) — 고민(T2) 칸 아래 여백에 세로 점선 + 원 화살표. 바로 다음 칸이 해결 안내(기존 빌더 포함)
   * 또는 첫 큰 POINT일 때만, 페이지당 1개(통합 11-03 21:4x). 칸이 없으면 표식 없음
   */
  linkBelow?: true
  /**
   * D2 상품 정보 표 모양(적용 D6 P6 T1-64·T2-26) — 'rows'면 이름(왼쪽 240)·값(오른쪽 480)을 좌우 줄로 그린다. 상품 정보 표(long:info)의 행이
   * 모두 이름 한 줄·12자·240 폭, 값 40자 이하일 때만(통합 11-03 22:1x). 칸이 없으면 지금 쌓기(이름 위·값 아래)
   */
  tableShape?: 'rows'
  /** 짙은 머리 띠(적용 D6 P6 T2-27) — 좌우 줄 상품 정보 표가 페이지의 두 번째 사실 표(앞에 질문·주의 보관 표)일 때만. tableShape가 있을 때만 */
  tableBand?: true
  /**
   * D2 사이즈 칸 수치 줄(적용 D6 P7 T1-63·T2-22) — 입력 칸 제품 수치(productMetrics)만, 입력 순서대로 앞 3개(값은 숫자+단위 한 칸). 사이즈 칸(T6)에만,
   * 줄마다 이름 한 줄·12자·240 폭, 값이 480에 장면 H2 한 줄로 들 때만(통합 11-03 23:42). 칸이 없으면 지금 사이즈 칸(캡션까지)
   */
  metricRows?: Array<{ name: string; value: string }>
  /**
   * D2 사용 방법 칸 주기 줄(적용 C5 ④ R-D3) — 입력 칸 사용·교체·배송 주기(schedule)만, 효과 시간표·규제 표현 줄을 뺀 값(inputSlotsOf.schedule = scheduleOf).
   * 사용 방법 칸(T5)에만, 2~6줄이고 줄마다 이름 한 줄·12자·240 폭, 기간이 480에 장면 BODY_BOLD 두 줄 안으로 들 때만. 칸이 없으면 지금 사용 방법 칸
   */
  scheduleRows?: Array<{ label: string; period: string }>
  /**
   * D2 옵션 칸 색 점(적용 C5 ③ T1-99) — 입력 견본(swatches)을 옵션 칩 이름과 짝지은 값(pairedSwatches)만, 옵션 칸(T7)에만, 모든 옵션이 짝일 때만(2개 이상, 일부만 짝이면 없음).
   * option = 칩 이름 그대로, hex = 입력 #RRGGBB. 옵션 이름에서 지은 색(colorByName)은 쓰지 않는다. 칸이 없으면 지금 옵션 칸(색 점 없음)
   */
  swatches?: Array<{ option: string; hex: string }>
  /**
   * D2 원형 배지(적용 D6 R-D1, 통합 11-04 00:4x) — 마무리(T8)에만. 입력 인증 첫 이름 또는 입력 평점(리뷰 수 입력이 있을 때) 그대로, 원 안에 들 때만.
   * 칸이 없으면 지금 마무리 사진 그대로
   */
  badge?: { input: 'badge.certification' | 'badge.rating'; value: string }
  /** D2 층 띠(적용 D6 T1-85) — 자세히 보기(T11)에만. 입력 층 2~5개(이름·설명 그대로)가 모두 칸에 들 때만. 칸이 없으면 지금 그대로 */
  layers?: Array<{ name: string; note?: string }>
  /**
   * D2 구성품 펼침(적용 D6 T1-83) — 사이즈 칸(T6)에만. 입력 부속 이름(추가 스펙 '구성품·부속' 칸) 2~6개가 모두 한 줄에 들 때만, 순서·글 그대로.
   * 칸이 없으면 지금 사이즈 칸 그대로
   */
  parts?: string[]
  /**
   * D2 기존 제품과 비교 줄(적용 C5 ② R-D2) — 상품 정보 표(T9 long:info)에만. 입력 비교 근거(깎아내리기·타사 표식·규제 표현을 거른 행) 1~5행 그대로,
   * 기존이 비면 그리는 쪽이 줄표. 출처 입력이 있으면 함께. 칸이 없으면 지금 상품 정보 표 그대로
   */
  compare?: { rows: Array<{ label: string; ours: string; other?: string }>; source?: string }
  /** 템플릿 조합 라인 선택 기록(templatelib 잡만, 15_TEMPLATE_LINE §10) — 칸이 없으면 template대로 그린다 */
  templateRef?: TemplateRef
}

/**
 * fontpair(디자인 폰트 계획 ①, internalized/art-fonts.ts) — fontpair를 기록한 D2 잡만. 디자인 컷 섹션의 제목 수준(display·h1·h2) 글자에
 * 제목 글꼴·굵기를 입히고 본문·표·캡션은 Pretendard 그대로다. 자체 보관 22종 안에서만 고른다
 */
export interface DesigncutFontPair {
  tone: 'playful' | 'premium' | 'handwritten' | 'everyday'
  /** 판정 근거 — playful은 palette2와 같은 판정(parent_proxy·target_terms), premium은 카테고리·낱말, handwritten은 식품 + 손맛 낱말, 그 밖은 default */
  basis: 'parent_proxy' | 'target_terms' | 'category' | 'premium_terms' | 'hand_terms' | 'default'
  heading: string
  weight: number
  body: 'Pretendard'
}

/**
 * palette2(D2 아트 디렉션 v2, docs/plans/pdp-enrichment/PALETTE2.md) — palette2를 기록한 D2 잡만. 편집기 그래픽(띠·배지·카드·강조)과
 * 첫 화면 타이포만 바꾼다 — 사진·제품 컷 바탕(palette)은 그대로다. calm이면 색은 지금 그대로, 첫 화면 타이포만 키운다
 */
export interface DesigncutPalette2 {
  tone: 'playful' | 'calm'
  /** 톤 근거 — 학부모 대리 구매형 판정(analysis.enrichment.audience, 연령 게이트 아님)·대상 줄·카테고리의 아동·어린이집·선물 낱말·기본 */
  basis: 'parent_proxy' | 'target_terms' | 'default'
  /** playful만 — 주색(띠·배지·강조 채움)·보조색 2(스티커 배지)·스튜디오 면·강조 글자(흰 바탕 4.5:1)·제목 글자·짙은 색(스크림) */
  colors?: { primary: string; secondary: [string, string]; studio: string; accentText: string; heading: string; deep: string }
}

/**
 * D2 잡 단위 아트 디렉션(C1, PDP-DR-PLAN §2 — designcut2 잡만) — 상품·장면 컷 프롬프트와 편집기 토큰이 이것을 읽는다. 결정론(계획과
 * 같이 다시 계산해도 같다)
 */
export interface DesigncutArtDirection {
  /** 세트(scene-set — R2와 같은 생성기, 벽 톤 입력은 컷 바탕색) */
  set: SceneSet
  /** 바탕 체계 — 흰 기본, 밝은 뉴트럴 스튜디오(L*≥94·C*≤6), 강조(palette.accent) */
  background: { base: string; studio: string; accent: string }
  /** 정렬 축 2개 — 첫 화면·마무리 가운데, 본문 왼쪽 */
  alignment: { hero: 'center'; closing: 'center'; body: 'left' }
  /** 모서리 문법 — motif 그대로(SHARP 직각, SOFT 둥근) */
  corners: 'sharp' | 'soft'
  /** palette2를 기록한 잡만 */
  palette2?: DesigncutPalette2
  /** fontpair를 기록한 잡만 */
  fontPair?: DesigncutFontPair
}

export interface DesigncutPlan {
  version: 1
  palette: {
    accent: string
    accentText: string
    deep: string
    tint: string
    ink: string
    mode: 'color' | 'neutral'
    /** 'photo'면 원천 사진 측정에서 파생(08 §4.1 개정) — 없으면 카피 primary 파생(기존 기록) */
    source?: 'photo'
    /** 밝거나 저채도 상품 — 짙은 바탕 상한 20%, deep L* 40 */
    highKey?: boolean
    /** 원천 사진 촬영 배경(가장자리 링 중앙값, 투명이면 흰색) — 플레이트 벽·컷 이음 색 */
    photoBackground?: string
  }
  motif: { badge: 'SOFT' | 'SHARP' }
  /** 템플릿을 받은 섹션(페이지 순서) */
  sections: DesigncutSection[]
  /** 기존 빌더 섹션을 그대로 쓰는 키(인증·프로모션 등 08 §7.1 범위 밖) */
  kept: string[]
  /** 데이터 규칙으로 뺀 섹션 — 그리지 않는다 */
  omitted: Array<{ key: string; reason: string }>
  /** 페이지 순서(sections·kept 키를 section_order 순으로 섞은 것) */
  order: string[]
  /** D2 아트 디렉션(designcut2 잡만) */
  artDirection?: DesigncutArtDirection
  /**
   * 렌더 v2(designlayout 기록 잡, PDP-DR-PLAN §1) — 막 단위 바탕(흰 + 뉴트럴 스튜디오, 짙은 면은 전환점 2곳)·강조 구절·캡슐은 POINT만·
   * 상자 한 문법. 없으면 지금 렌더 그대로. sections[].bg는 v1 배정으로 남고 v2 조립은 바탕을 다시 정한다
   */
  layout?: 2
  /** 사이즈·상품 정보 표가 마무리 뒤 페이지 맨 끝(오너 지시 2026-11-01, designcut-fill) */
  factsLast?: true
  /** 템플릿 조합 라인이 고른 색(templatelib 잡만) — templateRef 섹션을 이 색으로 그린다. 칸이 없으면 계획 색이다 */
  templateColors?: Colors
  /**
   * 템플릿 조합 라인 컨셉의 모서리(templatelib 잡만, 적용 T1-28) — templateRef 섹션의 카드·사진·캡슐 반경. 칸이 없으면 계획 모서리 그대로다.
   * capsule이 없으면 캡슐은 계획 모서리다(원문 무값). 말풍선·칩은 늘 계획 모서리다
   */
  templateRadius?: { card: number; photo: number; capsule?: number }
  /** 템플릿 조합 라인이 고른 글꼴 짝의 제목 글꼴(templatelib 잡만) — 칸이 없으면 artDirection.fontPair, 그것도 없으면 Pretendard 그대로다 */
  templateFontPair?: { heading: string; weight: number }
}

export interface DesignPrompts {
  /** 섹션별 이미지 프롬프트 — 색 슬롯은 팔레트 토큰({palette.primary} 등) 리터럴 유지, images 단계에서 치환 */
  section_image_prompts?: Record<string, { positive?: string; negative?: string; style?: string; [key: string]: unknown }>
  lighting_params?: Record<string, unknown>
  color_params?: Record<string, string>
  composition_notes?: string
  visual_plan?: Record<string, unknown>
  frame_system?: { primary?: string; secondary?: string }
  feature_prompts?: Array<Record<string, unknown>>
  howto_prompts?: Array<Record<string, unknown>>
  /** images 단계 첫 run에서 파이프라인당 1회 확정·캐시 — 재현성 보장(§9.1 ③) */
  style_charter?: string
  /** images 단계 첫 run에서 Vision 1콜로 확정·캐시 — 제품 등장 컷 프롬프트 말미에 부착 */
  identity_card?: string
  /** idcardall — 한 장에만 있거나 사진끼리 어긋나는 특징. 카드에 넣지 않고 생성에도 보내지 않는다(기록만) */
  identity_uncertain?: string
  /**
   * 쓰는 법 USE 줄(usefacts 잡만, 결정 카드 c02) — 식별 카드와 같은 콜에서 따로 받은 쥐는 곳·작동면·착용 위치(영어 한 줄). 카드에 넣지 않고
   * 손·착용·사용 컷의 Use 줄 재료로만 쓴다. 'none'이거나 못 받으면 칸이 없다
   */
  identity_use?: string
  /** 새 단계 연출 감독(R10, 새 배치 + newstages 잡만) — 끝난 잡은 컷 지시 뒤에 한 줄을 덧붙인다(pdp-new-stages-stage directorLineFor) */
  director?: NewStageRecord<DirectorPlan>
}

// ─── 4단계: 카피라이팅 출력 (state.py:162-275) ───

export interface DesignPalette {
  primary?: string
  secondary?: string
  bgMain?: string
  bgSub?: string
  textMain?: string
  textHighlight?: string
}

export interface DetailSection {
  section_type?: string
  headline?: string
  sub_copy?: string
  image_direction?: string
  detail_items?: Array<{ icon?: string; text?: string }>
}

/**
 * 카피 산출 — 키 이름은 LLM JSON 산출과 1:1(원본 프롬프트 스키마 보존, camelCase 혼재 그대로).
 * Pro 전용 필드(certificationCopy 등)는 LLM이 아니라 템플릿 규칙 엔진 산출.
 */
export interface CopywritingResult {
  /** benefitHeadline·subBenefit·brandAndName은 PREMIUM_COPYWRITING_PROMPT 실제 JSON 스키마(pdp-copy-prompts.ts) 대응 —
   *  subtitle/title/hook은 구버전 초안 필드로 하위호환 유지 */
  mainIntro?: {
    category?: string
    subtitle?: string
    title?: string
    hook?: string
    benefitHeadline?: string
    subBenefit?: string
    brandAndName?: string
    /** 상품 종류 낱말(P1-1a) — 카피가 상품명에서 고른 낱말. 첫 화면(hook·benefitHeadline·subBenefit) 검사에만 쓰고 화면에 그리지 않는다 */
    productType?: string
  }
  designPalette?: DesignPalette
  problem?: { question?: string; empathy?: string; empathyLines?: string[]; empathyDeepLines?: string[] }
  solution?: { declaration?: string; summary?: string }
  pointCards?: Array<{ title?: string; description?: string }>
  summary?: string
  colorOptions?: { title?: string; options?: string[]; description?: string }
  usageSceneTags?: string[]
  /** claim/proof/benefit/imageHint — PREMIUM_COPYWRITING_PROMPT 실제 스키마(원본 FAB 구조) 대응 */
  /** icon은 K 아이콘 사전 이름(선택) — 지금 카피 프롬프트는 고르지 않는다(V2 과제) */
  detailPoints?: Array<{ claim?: string; proof?: string; benefit?: string; imageHint?: string; icon?: string }>
  howTo?: Array<{ step?: string; description?: string }>
  recommendedTargets?: string[]
  /** 원본은 dict(v2)/str(구버전) 양쪽을 허용하지만(copywriting_agent.py run()), 이식판은 항상 정규화된 객체로 저장한다 */
  closingCta?: { headline?: string; subtext?: string }
  soldOutBanner?: { headline?: string; subtitle?: string }
  title?: string
  seo_keywords?: string[]
  sections?: DetailSection[]
  sizeComparisonObject?: string
  /** 실제 리뷰 원문 발췌 전용 — 창작 금지, 원문 대조 검증 통과분만 (review_scrubber 규칙) */
  /** 인용 카드 잡(W2b)은 평점·옵션·강조 조각이 함께 온다 */
  /**
   * 후기 카드 — author는 가린 꼴('김**') 또는 '구매고객'(이름을 지어내지 않는다), rating은 원본 평점만, month는 작성 월('YYYY.MM'),
   * summary·original은 후기 요약(원문 문장 1~2개)과 그 원문(대조용, 화면에 그리지 않는다 — P1-6)
   */
  reviewHighlights?: Array<{
    text?: string
    author?: string
    rating?: number
    highlights?: string[]
    month?: string
    summary?: boolean
    original?: string
  }>
  compareItems?: Array<{ name?: string; pros?: string; cons?: string }>
  compareSummary?: string
  keyMessageVariations?: { top?: string; mid?: string; bottom?: string }
  // Pro 전용 (템플릿 규칙 엔진 산출 — LLM 콜 없음)
  certificationCopy?: Record<string, unknown>
  eventBannerCopy?: Record<string, unknown>
  productExposure?: { headline?: string; subCopy?: string }
  directionHint?: { headline?: string; subCopy?: string }
  conceptCopy?: { headline?: string; subCopy?: string }
  mainCutCopy?: { headline?: string; subCopy?: string }
  keyMessageCopy?: { headline?: string; subCopy?: string }
  convertDivCopy?: { headline?: string; subCopy?: string }
  eventBundleCopy?: { headline?: string; subCopy?: string }
  // V4.3 파생 필드 (규칙 기반 도출 — LLM 재호출 없음)
  hero_copy?: { benefit_headline?: string; hook?: string; subline?: string }
  review_strategy?: { position?: string; why_here?: string }
  section_copy_blocks?: Array<Record<string, unknown>>
  objection_handlers?: Array<{ objection?: string; answer?: string }>
  cta_variants?: Array<{ type?: string; copy?: string }>
  /** 제목 글 → 그 제목에서 강조할 구절(적용 T1-17, 디자인 컷 잡의 Stage 2만 쓴다). 디자인 컷 계획이 제목마다 다시 검사한다 */
  headlineAccents?: Record<string, string>
  [key: string]: unknown
}

/**
 * Track I 품질 리포트(결정 T-6·부록 F-2) — trust gate 결과 + 골격 제외 근거. compose 후처리가 기록.
 * 전용 컬럼 DDL 없이 copy_sections JSONB 내부 필드로 저장한다(DDL 게이트는 generation_track 1건만 유지).
 */
export interface PdpQualityReport {
  trust_gate: {
    pass: boolean
    missing_required: string[]
    missing_recommended: string[]
    user_action_hints: string[]
  }
  skeleton_excluded: Array<{ role: string; reason: string }>
  /** ENRICHMENT persuasion 잡만 — 문법·R1~R8·미응답 고민(경고·근거만, 차단 없음) */
  persuasion?: {
    grammar: string
    rules: Array<{ id: string; pass: boolean; detail?: string }>
    unanswered: Array<{ objection: string; type: string; note?: string }>
  }
  /** ENRICHMENT 잡만 — 근거 수준: v2(카테고리 실측 레시피) · category(vocab 카테고리 셀) · pooled(범용 근거) */
  evidenceLevel?: { level: 'v2' | 'category' | 'pooled'; priorSource: string; note: string }
  /**
   * ENRICHMENT annotations 잡만(T4b) — 대상·성공·생략·실패는 잡 기록, placed 이하는 편집기 최초 빌드 측정
   * (측정 실패면 빠진다). 영역 밖 제외 = outOfView
   */
  annotations?: {
    targets: number
    done: number
    skipped: number
    failed: number
    recorded: number
    placed?: number
    outOfView?: number
    noRoom?: number
    screenCap?: number
    notShown?: number
  }
  /**
   * ENRICHMENT layouts 잡만(T4b) — 배정·LLM 교체·충돌 해소는 배정 기록, tried 이하는 편집기 최초 빌드 측정.
   * 런타임 가드 탈락 = guardDropped(유실 가드) + mobileReverted(모바일 위반 증가). sections·assigned는 배정 기록(설계 섹션 키),
   * tried 이하는 편집기 캔버스 섹션 단위이고 프리셋 제외 섹션·기본 레이아웃(_layout_01)으로 매핑된 배정은 세지 않아 assigned와 다를 수 있다
   */
  layouts?: {
    /** E-2가 배정한 섹션 수(minimal 포함) */
    sections: number
    /** 그중 프리셋 카테고리(minimal 아님)를 받은 섹션 */
    assigned: number
    llmKept: number
    llmReplaced: number
    conflictResolved: number
    tried?: number
    applied?: number
    guardDropped?: number
    mobileReverted?: number
  }
  /**
   * ENRICHMENT persuasion 잡만(R4 섹션 잇기, 09_SECTION_BRIDGES §2.4) — 받는 필드가 보내는 필드의 낱말을 하나라도 이어받았는지(카피 기준).
   * pairs는 양쪽 글이 모두 있는 잇기 수, unlinked는 잇지 못한 받는 섹션
   */
  bridges?: { pairs: number; linked: number; unlinked: string[] }
}

/** Stage 3 결과 기록(pdp-stage3-fix-effective) — 무결성 검사 결과 그대로 */
export interface Stage3Record {
  version: 1
  /** object = 객체 응답, other = 객체가 아니라 Stage 2를 그대로 씀, failed = 콜·파싱 실패라 Stage 2를 그대로 씀(비율 없음) */
  parsed: 'object' | 'other' | 'failed'
  /** 모델이 신고한 `_changed_fields`(앞 30개). null = 미신고(응답 그대로 쓰고 비율 0) */
  reported: string[] | null
  /** 신고 없이 바뀌어 Stage 2 값으로 되돌린 최상위 칸 */
  restored: string[]
  /** 신고 없이 바뀌었지만 '고칠 곳'이 가리킨 칸이라 남긴 최상위 칸(flow·rhythm 잡) */
  kept: string[]
  /** 무결성 뒤 Stage 2와 실제로 다른 최상위 칸 */
  changedTopLevel: string[]
  /** flow·rhythm 잡 — '고칠 곳'을 검수 기준 안 필수 항목(검수할 JSON 앞)으로 넣었다 */
  fixInCriteria?: true
}

/** copy_sections JSONB — Pro는 스테이지 중간본 보관 (DDL COMMENT 계약) */
export interface CopySectionsPayload {
  final: CopywritingResult
  stage1?: CopywritingResult
  stage2?: CopywritingResult
  /** Stage 3 변경 신고율 (>0.6이면 전면 재작성 의심 경고 — copywriting_agent.py:1183-1187) */
  stage3_changed_ratio?: number
  /** Stage 3 결과 기록(pro 잡 모두) — 비율 0이 콜 실패·객체 아님·미신고·빈 신고(되돌림) 가운데 무엇인지 바로 보이게 */
  stage3?: Stage3Record
  /** 유사도 게이트(결정 H-1) 경고 플래그 — 재생성 후에도 임계 초과 섹션 존재 시 */
  similarity_warnings?: Array<{ section: string; score: number }>
  /** Track I 전용(결정 T-6) — Track S 잡에는 없음 */
  quality_report?: PdpQualityReport
  /** 연령 컴플라이언스 게이트 결과(minAgeYears ≥ 14 잡만 기록) — 잔여 위반·고지 누락은 UI 경고로 표면화 */
  age_compliance?: {
    min_age: number
    removed_review_highlights: number
    notice_present: boolean
    violations: Array<{ section: string; term: string; sentence: string }>
  }
  /**
   * 학부모 대리 구매형(parent_proxy, audience 기록 잡 중 연령 게이트가 꺼진 잡만) — 카피 직후 찾은 아이 사용·반응·이미지 지시 문장 수,
   * 재작성 여부, 모든 재생성 뒤 남은 문장(15건까지)
   */
  parent_proxy?: {
    found: number
    regenerated: boolean
    remaining: Array<{ section: string; kind: string; sentence: string }>
  }
  /**
   * 숫자·단위 대조(P0-2, 모든 잡) — 카피 직후 입력(상품 정보·리뷰 원문·인증·이벤트·옵션)에 없는 숫자+단위 수, 재작성 여부, 모든
   * 재생성·정정 뒤 남은 것(15건까지). 걸린 것이 있었던 잡만 기록
   */
  number_check?: {
    found: number
    regenerated: boolean
    remaining: Array<{ path: string; token: string; text: string }>
  }
  /** 경쟁사 리뷰 재현 가드(pdp-review-input) — 경쟁사 리뷰가 있는 잡만. 카피 직후 겹친 섹션(재생성 1회)과 마지막에 지운 문장 */
  competitor_echo?: {
    rewritten_sections: string[]
    regenerated: boolean
    removed: Array<{ section: string; sentences: number }>
  }
  /** 사실 값 대조(pdp-copy-facts-r4) — 등록 옵션 구조가 있는 잡에서 축 개수 오기를 고친 칸(고친 것이 있을 때만) */
  fact_corrections?: Array<{ path: string; from: string; to: string }>
  /**
   * 카피 규칙(P1-1a, 모든 잡) — 모든 재생성·정정 뒤 제목·CTA에 남은 안내형 끝말과, 첫 화면에 없는 상품 종류 낱말(있을 때만).
   * Stage 3이 고칠 곳으로 받아 고친 것은 남지 않는다
   */
  copy_rule_check?: {
    guide_endings: Array<{ path: string; text: string }>
    hook_type_missing: string[] | null
  }
  /** 섹션 사이 반복 최종 기록(pdp-copy-facts-r4, 플래너 기록 잡, 측정용) — 어절 2-그램과 나온 섹션(있을 때만) */
  repeat_findings?: Array<{ phrase: string; sections: string[] }>
  /** 카피 흐름 수(P1-1b, 모든 잡, 측정용 — copy-flow-check). 화면·합성은 읽지 않는다 */
  copy_flow?: CopyFlowRecord
  /** 카피 리듬 수(rhythm, 모든 잡, 측정용 — copy-rhythm-check). 화면·합성은 읽지 않는다 */
  copy_rhythm?: CopyRhythmRecord
  /** 떠넘기는 문장 제거(W2b, 상품 사실 블록을 받은 잡) — 바뀐 칸과 앞뒤 글(뺀 것이 있을 때만, 20곳까지) */
  deflection_removed?: Array<{ path: string; before: string; after: string }>
  /** 제거로 글 칸이 비어 뺀 배열 항목(정보 없는 카드 등, 경로) */
  deflection_dropped_items?: string[]
  /** 통째로 걸렸지만 비우면 섹션이 사라져 남긴 칸(마무리 CTA 머리말 등, 경로) */
  deflection_kept?: string[]
  /**
   * 후기 유래 규제 표현 검출(R6, 자사 리뷰가 있는 모든 잡, 측정용) — 인용 후보 차단과 같은 규제 사전으로 찾은 최종 카피의
   * 인증·인허가·의학·기능성 표현과 나온 칸(있을 때만, 30건까지). 지우지 않는다(reviews/review-claims)
   */
  review_claims?: RegulatedClaim[]
  /** 새 단계 카피 뒤 사실 감사(R10, 새 배치 + newstages 잡만) — 기록+경고, 글을 고치지 않는다 */
  fact_audit?: NewStageRecord<FactAudit>
}

/**
 * 카피 흐름 수(P1-1b) — 되풀이 문구·특징·수치·제목 되풀이·마지막 띠의 첫 화면 반복·판정한 고민·그중 답 없는 고민·주장과 근거가 같은
 * 낱말을 쓰지 않는 포인트(후보 — 다른 말로 받치는 정상 짝도 걸린다)
 */
export interface CopyFlowCounts {
  phrases: number
  features: number
  numbers: number
  restated: number
  closing_echo: number
  concerns: number
  unanswered: number
  mismatched: number
}

/** copy_sections.copy_flow — counts는 최종 카피, before는 pro Stage 2 산출(고치기 전), fix는 flow 스위치로 Stage 3에 고칠 곳을 넘긴 잡 */
export interface CopyFlowRecord {
  version: 1
  counts: CopyFlowCounts
  before?: CopyFlowCounts
  fix?: true
  /** 남은 것 예시(종류마다 5개까지) — 문구·특징 제목·수치·제목 되풀이 위치·첫 화면과 같은 낱말 묶음·답 없는 고민·어긋난 포인트 위치 */
  examples: {
    phrases: string[]
    features: string[]
    numbers: string[]
    restated: string[]
    closing_echo: string[]
    unanswered: string[]
    mismatched: string[]
  }
}

/**
 * 카피 리듬 수(rhythm) — 본 제목 칸·본문 칸 수, 한 줄이 긴 제목, 조사·어미(또는 한두 글자)만 다음 줄로 넘어간 줄바꿈, 긴 본문 문장,
 * 문장이 많은 본문 칸
 */
export interface CopyRhythmCounts {
  head_fields: number
  body_fields: number
  head_long: number
  bad_breaks: number
  long_sentences: number
  crowded: number
}

/** copy_sections.copy_rhythm — counts는 최종 카피, before는 pro Stage 2 산출(고치기 전), fix는 rhythm 스위치로 Stage 3에 고칠 곳을 넘긴 잡 */
export interface CopyRhythmRecord {
  version: 1
  counts: CopyRhythmCounts
  before?: CopyRhythmCounts
  fix?: true
  /** 남은 것 예시(종류마다 5개까지, 카피 안 위치) */
  examples: { head_long: string[]; bad_breaks: string[]; long_sentences: string[]; crowded: string[] }
}

// ─── 5단계: 이미지 생성 산출 ───

/** GIF 칸 기록(SectionImage.motion) — 세션 B DESIGN.md 0-1절·IMPL-PLAN P3. 값은 motion/encode.ts가 만든다 */
export interface SectionMotion {
  /** gpt26-ref = 2.6 참조 GIF, stills-slide = 오너 옵션 사진 밀기 */
  path: 'gpt26-ref' | 'stills-slide'
  /** ok = 움직이는 WebP 있음, poster = 예산·검사를 못 맞춰 포스터 한 장 */
  status: 'ok' | 'poster'
  /** 움직이는 WebP(780 폭) — status ok일 때만 */
  webpUrl?: string
  /** 2.6 원본 GIF(256색, 기록용) — gpt26-ref일 때만 */
  gifUrl?: string
  width: number
  height: number
  frames: number
  durationMs: number
  bytes: number
  quality: number | null
  loop: 'pingpong' | 'hold' | 'plain'
  /** 포스터로 내린 이유(예산·글자 반전·상품 불일치 등) */
  reason?: string
}

/** section_images JSONB 원소 (DDL 계약: [{section, url, prompt}]) */
export interface SectionImage {
  section: string
  url: string
  prompt?: string
  /** 생성 실패 시 placeholder 마킹 (§6.4 — 해당 섹션만 실패, 파이프라인 계속) */
  error?: string
  /** Vision 게이트 미달 — 다음 생성 슬롯(같은 run 또는 이월된 run)에서 재생성 1회 예정 */
  pendingRegen?: boolean
  /**
   * 게이트 대기 — 생성 뒤 run 시간이 모자라 게이트를 판정하지 못했다(통과로 치지 않는다). 다음 run 맨 앞에서 판정하고,
   * 미달이면 게이트 재생성 규칙을 따른다. 판정하면 지운다
   */
  gatePending?: boolean
  /** 모델 참조 상한에 맞추느라 이 컷에서 뺀 원천 사진 수(fitSourceRefs) — 없으면 다 붙었다 */
  refsDropped?: number
  /** 게이트 재생성 예산을 이미 소비함(재재생성 금지 — thumbnail-pipeline retried 관례와 동일) */
  retried?: boolean
  /** 첫 생성 실패 — 다음 run이 한 번 더 시도한다(섹션당 1회). 이 표지가 없는 error는 끝난 실패다(이 표지 이전 잡 포함) */
  retryPending?: boolean
  /**
   * 비동기 공급자(힉스필드 MS 2k, R05)에 제출했지만 run 기한 안에 받지 못한 요청 — retryPending과 함께 남아 다음 run의 재시도가 다시
   * 제출하지 않고 이 요청을 이어 받는다(중복 과금 없음). 받으면 항목째 바뀌어 사라진다
   */
  imagePending?: ImagePendingRequest
  /**
   * 이미지 공급자 잔액 부족으로 보류한 컷(R12c) — retryPending과 함께 남고, 이 시도는 재시도 1번으로 세지 않는다. 다음 run·충전 뒤
   * '다시 시도'가 첫 시도로 잇는다(실패하면 지금 규칙대로 재시도 1번이 남는다). 새로 만들면 항목째 바뀌어 사라진다
   */
  providerBlocked?: 'balance'
  /**
   * 공급자 내용 검사 거절로 끝난 시도(J60, 힉스필드 nsfw) — 첫 시도면 retryPending과 함께 남고, 다음 run의 재시도 1번이 안전 장면 지시로
   * 부른다(scene-safety). 새로 만들면 항목째 바뀌어 사라진다
   */
  contentRejected?: 'nsfw'
  /**
   * 장면 안전 지시를 붙여 만든 컷(J60, MS 2k만) — bath: 샤워·목욕 장면 사람 컷에 옷 입은 가슴 위 구도 줄(예방), nsfw-retry: nsfw 뒤 재시도의
   * 욕실 밖 손 구도 지시. 실제로 보낸 글은 sentPrompt·prompt 기록 그대로다
   */
  sceneSafety?: 'bath' | 'nsfw-retry'
  /**
   * 보여 줄 동작·설계 문장을 받은 컷(showbeat 잡, J63) — shown: Purpose 끝 문장을 실어 보냄, too-long: MS 2k 5,000자 맞추기가 그 문장 때문에
   * 블록을 더 덜거나 넘쳐 문장만 빼고 보냄(Person 단계 '쓰는 중'은 남는다). 체감 결과 문장과 함께 넘치면 체감 문장을 먼저 뺀다. 받지 않은 컷은 값이 없다
   */
  showBeat?: 'shown' | 'too-long'
  /** 그 문장의 사실 출처(J63 2단계) — spec: spec 칸, card: 식별 카드 USE 줄(사진 판독), howto: 카피 사용 순서(copy_sections.final.howTo). showBeat와 함께만 있다 */
  showBeatSource?: 'spec' | 'card' | 'howto'
  /**
   * 체감 결과 문장 가드(J65, MS 2k 컷 중 문장이 붙은 기능·사용 컷만) — shown: 문장을 실어 보냄, too-long: 문장 때문에 MS 맞추기가 블록을 더
   * 덜거나 상한을 넘어 문장만 빼고 보냄. 지금 배치·문장 없는 컷은 없다
   */
  effectShot?: 'shown' | 'too-long'
  /**
   * 저장 상한(버킷 5,000,000바이트)을 넘어 형식을 바꿔 올렸다(R08a, MS 2k 컷만) — 원래 형식·바이트, 바꾼 형식(WebP)·바이트·품질.
   * 상한 안이면 없다(받은 바이트 그대로 올림)
   */
  uploadFit?: { from: string; originalBytes: number; to: 'image/webp'; bytes: number; quality: 'lossless' | number }
  /** 공급자 지시 상한(MS 5000자)에 맞춰 덜어 낸 블록 머리·원래 길이 — 덜어 냈을 때만(sentPrompt가 실제로 보낸 글) */
  promptFit?: {
    dropped: string[]
    originalLength: number
    /**
     * MS 2단 맞추기(R07b)에서 짧은 MS 문구로 바꾼 것 — ms-prompt-fit MS_SHORT_FORMS 이름, ③ 앞 세 단계(J46)는 dup(겹친 블록 빼기)·
     * printed(인쇄 규칙 짧은 한 블록)·parent(학부모 장면 짧은 판)
     */
    compacted?: string[]
  }
  /** 강조 장식(E-3, T4) — 원본 이미지 기준 좌표. 대상 컷만 기록하고, 재생성으로 url이 바뀌면 항목째 사라진다 */
  annotations?: ImageAnnotation[]
  /** 장식 하위 단계 결과 — 대상 컷에 이 값이 없으면 images 단계가 다시 골라진다(resolveStepToRun) */
  annotationStatus?: 'done' | 'skipped' | 'failed'
  /** 장식 투영용 원본 가로/세로 — 장식 단계가 받은 이미지 헤더에서 읽는다(생성 비율 힌트와 실제 크기가 다를 수 있다) */
  imageAspect?: number
  /** 편집기 재생성 요청과 결과(pdp-image-regen-api) — pending이면 pendingRegen과 함께 남고 images 단계 재생성 큐가 처리한다 */
  editorRegen?: EditorRegenRecord
  /** 원본 합성 컷(묶음 4) — 생성 대신 원천 사진으로 만들었다(게이트 생략). sourceUrl = 누끼 PNG 또는 원천 사진 */
  composite?: { mode: 'cutout' | 'direct'; sourceUrl?: string; kRole?: KCompositeRole }
  /** 코덱스 구독 이미지 재작성 기록(E1) — 전용 홈 실행만. 에이전트가 다시 쓴 프롬프트·참조 수·도구 시간(브리프 정리 E4·A/B E3 근거) */
  codexTrace?: CodexTrace
  /** herotype 잡의 첫 화면만 — 실제로 쓴 유형과 내려간 단계(1 손·손목만, 2 스튜디오) */
  heroKind?: HeroKind
  heroFallback?: number
  /** sizecut 잡의 사이즈 단독 컷 — 재서 나온 제품 경계. 못 재면 없음(치수선 없이 글자만) */
  productBox?: ProductBox
  /** 통이미지(편집 가능) 실험 — fullimage 기록 잡의 대상 섹션만. url은 표시 바탕이고 원본 통이미지는 비교용(fullimage/fullimage-types) */
  fullimage?: FullImageRecord
  /**
   * GIF 칸(움직이는 띠 motion_band, motionband 스위치) — section 키는 `motion:<칸 번호>`이고 url은 포스터 JPEG다
   * (정지 소비자·편집기 화면은 포스터를 본다). 움직이는 WebP는 상세 이미지 굽기가 전체 이미지 목록의 그 포스터 자리에 그대로 끼운다
   * (편집기 응답 motion_clips, 세션 B ③ P4 — 쿠팡 IMAGE_NO_SPACE가 움직이는 WebP를 그대로 보여 준다).
   * 다른 모델로 정지 컷만 다시 만드는 교체 판은 이 칸이 있으면 항목을 그대로 복사한다.
   */
  motion?: SectionMotion
  /** D2-3 첫 화면 글자 자리(designcut2 잡 hero만, 계획 밖 기록) — 위쪽 띠 측정·재생성 결과. 통과가 아니면 편집기는 지금 T1을 쓴다 */
  copyZone?: HeroCopyZoneRecord
  /** shotdiv 잡의 상품 컷 구도 지문(dHash 64비트 16진, shot-composition.ts) — 같은 페이지 컷끼리 거의 같은 구도인지 잰다 */
  dhash?: string
  /** 컷 평균 밝기·채도(0~1, cut-tone.ts, 결정 카드 c29) — 사진 컷만, 기록만. 페이지 편차·경고는 원장 pageToneSpread */
  tone?: CutTone
  /** 구도 중복 판정(shotdiv) — 거의 같은 구도였던 컷과 거리. 다른 각도 재생성 뒤에도 남는다(측정용) */
  compositionTwin?: {
    of: string
    distance: number
    /** 다른 각도로 다시 만든 컷을 받지 않고 앞 컷을 둔 사유(게이트 미달·판정 못 함·생성 실패) — 없으면 새 컷을 받았거나 다시 만들지 않았다 */
    keptFirst?: string
  }
  /** K 컷 구도 중복 기록(shotvary 잡만, 세션 B variety F5) — 거의 같은 구도인 대표 컷·다른 K 컷과 거리. 기록만 하고 다시 만들지 않는다 */
  lineTwin?: { of: string; distance: number }
  /** 이 컷의 게이트 판정(gate-record) — 통과 점수까지 남긴다. 칸이 없으면 예전 잡이거나 판정하지 못한 컷 */
  gate?: GateRecord
  /**
   * 새 배치 게이트가 판정하지 못했다 — 재시도 뒤에도 잘리거나 빈 답(R03), 또는 채점 호출 실패가 다시 판정 상한까지 이어짐(R12e).
   * 이미지는 그대로, 통과로 치지 않은 표시
   */
  gateUnjudged?: string
  /** 새 배치 일반 생성에서 이 컷의 게이트 채점 호출이 실패한 횟수(R12e) — 상한까지는 다음 run 맨 앞에서 다시 판정한다(gatePending) */
  gateCallFailures?: number
  /** 재생성된 컷만 — 앞 컷이 미달한 판정(재생성 사유). 새 컷은 다시 판정하지 않으므로 gate가 없을 수 있다 */
  gateBefore?: GateRecord
  /** K 라인 컷만 — 게이트 미달로 다시 만든 뒤 재판정하지 않았다(재판정은 비용, K5 P01 11-06). D·운영 기본 컷은 칸이 없다 */
  regenNotRejudged?: true
  /**
   * 이미지 모델에 실제로 보낸 전체 프롬프트(점검 고침 0, sent-prompt.ts) — prompt는 바탕 글뿐이다. 정지 컷은 generateImage에, GIF 칸은
   * 움직임 엔진에 넘긴 글. 실패한 호출도 남긴다. 이 칸 이전 잡은 없다
   */
  sentPrompt?: string
  /** sentPrompt 글자 수·sha256 앞 16자 — 기록 대조용 */
  sentPromptMeta?: { length: number; sha256: string }
  /**
   * 대표 컷·착용 컷 재판정(점검 고침 1) — 재생성 뒤 한 번 더 판정했고, 다시 미달이면 앞 컷(first)과 새 컷(regen) 중 나은 쪽을 남겼다
   * (betterCutOf: 같은 상품 > 부품 > 일관성). after가 통과면 kept는 regen
   */
  gateRejudge?: { before: GateRecord | null; after: GateRecord | null; kept: 'first' | 'regen' }
  /**
   * 끝까지 상품 불일치(same_product false)라 페이지에서 뺀 컷(점검 고침 1, K 컷만) — url은 비우고 뺀 사진 주소·까닭을 남긴다.
   * 그 컷을 쓰는 섹션은 그리지 않는다(빠진 컷과 같은 길)
   */
  droppedForProduct?: { url: string; reason: string }
  /**
   * 끝까지 사용 미달(use_correct false)이라 페이지에서 뺀 컷(usegate 잡, 결정 카드 c08·J19 — 사용 판정 컷만, 대표 컷은 빼지 않고 경고).
   * url은 비우고 뺀 사진 주소·까닭을 남긴다(droppedForProduct와 같은 길)
   */
  droppedForUse?: { url: string; reason: string }
  /**
   * 대표 컷이 끝까지 상품 불일치인데 첫 화면이라 빼지 않고 나은 쪽을 쓴 경우(통합 Q1) — 잡 결과 화면이 경고로 보인다(cut-failures gateWarningNotes)
   */
  gateWarning?: string
  /** 손·착용·사용 컷인데 쓰는 법 재료(판매자 메모·식별 카드)가 없어 Use 줄을 빼고 만들었다(점검 고침 3) — 그 밖에는 칸이 없다 */
  useFacts?: 'none'
}

/** 게이트 판정 기록 — 동작에는 쓰지 않는다(문턱 분포·재생성 사유 측정용) */
export interface GateRecord {
  verdict: 'pass' | 'fail'
  consistency: number | null
  same_product: boolean | null
  has_artifact: boolean
  reason?: string
  artifact_reason?: string
  /** K 라인 컷에 치수를 실은 판정만(실물 크기 11-05) — 칸이 없으면 크기를 묻지 않은 판정 */
  size_plausible?: boolean
  size_reason?: string
  /** 크기만 미달이라 재생성하지 않고 통과시킨 까닭(gate-record SCALE_KEPT_NOTE, K5 P01 11-06) — K 라인 크기 판정에만 있다 */
  note?: string
  /** K 컷 부품 판정(점검 고침 1) — 칸이 없으면 묻지 않은 판정 */
  parts_match?: boolean
  parts_reason?: string
  /** K 사람·손 컷 사용 판정(점검 고침 3) — 칸이 없으면 묻지 않은 판정 */
  use_correct?: boolean
  use_reason?: string
}

/** 편집기 재생성 스타일 — NEXFIT server/api/regenerate.py _STYLE_HINTS 키(힌트 원문이 있는 6종) */
export type RegenStyle = 'premium_studio' | 'lifestyle' | 'macro' | 'empathy' | 'product_photo' | 'infographic'

/**
 * 편집기 재생성 기록. url은 정체성 게이트를 통과한 새 이미지일 때만 바뀐다(done).
 * rejected = 게이트 재생성 1회 뒤에도 미달, failed = 생성 오류 — 둘 다 이전 이미지를 그대로 둔다.
 */
export interface EditorRegenRecord {
  style?: RegenStyle
  note?: string
  /** 유지할 것(P1-4) — 지시문에 '그대로 둘 것'으로 붙는다 */
  keep?: string
  /** 지금 컷을 참조 맨 끝에 붙여 그 컷을 고친다(P1-4) — 이전 이미지가 있을 때만 */
  useCurrent?: true
  /** done일 때 바뀌기 전 항목의 장식·비율(P1-4 되돌리기가 url과 함께 되돌린다) */
  previous?: Pick<SectionImage, 'annotations' | 'annotationStatus' | 'imageAspect' | 'copyZone' | 'productBox'>
  /** 직전 컷으로 되돌린 시각 — 되돌리면 url과 previousUrl을 맞바꾼다(다시 누르면 되돌림 취소) */
  revertedAt?: string
  requestedAt: string
  status: 'pending' | 'done' | 'rejected' | 'failed'
  finishedAt?: string
  message?: string
  /** done일 때 바뀌기 전 이미지 — 편집기 되돌리기용(이전 이미지가 없던 새 컷은 없다) */
  previousUrl?: string
  /**
   * 사후 재생성(W5b) — 잡 생성이 만들지 않은 섹션(골격 밖, lean 잡)의 컷을 편집기에서 새로 만든 항목. 이미지 태스크 밖이라
   * 완료 판정·사용률(잡 태스크 키 기준)에 섞이지 않는다
   */
  added?: true
}

/** 편집기 카피 재생성 후보 탈락 사유(pdp-copy-regen-api) — unjudged = 가드가 판정하지 못함(통과로 보지 않는다) */
export type CopyRegenRejectReason =
  | 'banned'
  | 'length'
  | 'duplicate'
  | 'empty'
  | 'similarity'
  | 'age'
  | 'competitor_echo'
  | 'unjudged'

/** 편집기 카피 재생성 1건 기록(section_plan.editor_copy_regen) — 후보 원문·요청 메모는 남기지 않는다 */
export interface EditorCopyRegenRecord {
  at: string
  sectionType: string
  elementName?: string
  status: 'ok' | 'rejected' | 'failed'
  /** 가드를 통과한 후보 수 */
  passed: number
  /** 탈락 사유(중복 없이) */
  reasons: CopyRegenRejectReason[]
  costUsd: number
  message?: string
}

/** 강조 장식 1개(00_DESIGN.md §4.5) — 좌표는 원본 이미지 기준 0~1, 문구는 허용 목록 문자열 그대로 */
export interface ImageAnnotation {
  kind: 'label' | 'leader' | 'zoom' | 'number'
  anchor: { x: number; y: number }
  /** 원본 기준 0~1 — 렌더 시 cropRect = ×100 퍼센트 */
  zoomRect?: { x: number; y: number; w: number; h: number }
  /** 허용 목록 문자열 그대로(≤ 12자, 한 줄) — number는 단계 번호 */
  text?: string
  /** 'pointCards[1].title' | 'detailPoints[0].claim' | 'spec.size' | 'howto[2]' */
  source: string
}

/**
 * 파이프라인 내부 이미지 맵 (state.py:307-343 GeneratedImages 축약 —
 * 미투입 컷 options/detail/review_avatar/scene_ids/webp 제거, DB 저장은 SectionImage[]로 직렬화)
 */
export interface GeneratedImagesMap {
  hero?: string
  problem?: string
  solution?: string
  usage?: string
  cta?: string
  features?: string[]
  howToImages?: string[]
  size_comparison?: string
  usp_icons?: string[]
  sold_out_banner?: string
  // Pro 전용 (conversion_cta는 cta 재사용 — 원본 C-A3 동작 보존)
  certification_badge?: string
  event_banner?: string
  product_exposure?: string
  empathy_scene?: string
  direction_hint?: string
  key_benefit_visual?: string
  premium_hero?: string
  concept_mood?: string
  comparison_scene?: string
  rating_bg?: string
  [key: string]: string | string[] | undefined
}

// ─── 잡 레코드 · 파이프라인 상태 ───

/** registration_pdp_jobs 행 (JSONB 컬럼은 위 타입으로 파싱) */
export interface PdpJobRow {
  id: string
  user_id: string
  business_id: string | null
  draft_id: string | null
  spec_sheet: PdpSpecSheet
  source_images: string[]
  image_model: ImageModel
  image_quality: ImageQuality
  mode: PdpMode
  /** 생성 트랙(결정 T-1) — 컬럼 SSOT(DDL 20260811210000), 판정은 resolveGenerationTrack 경유 */
  generation_track: GenerationTrack
  analysis: AnalysisResult
  research_result: ResearchResult
  design_prompts: DesignPrompts
  section_plan: SectionPlan
  copy_sections: Partial<CopySectionsPayload>
  section_images: SectionImage[]
  final_html: string | null
  current_step: PdpStep
  progress: number
  error: string | null
  cost_usd: number
  /** 예산 풀 — 'test'=시험 잡(호출 사용량이 시험 풀 pdp-test로 남고 시험 풀 상한으로 판정), 없음·null=운영 */
  cost_pool?: PdpCostPool | null
  /**
   * 모델 배치(R03) — spec_sheet 예약 키에서 꺼낸 값(pdp-model-batch, DDL 없음). 없음 = 'now'(지금 배치 — 이 기능 전 잡 포함)
   */
  model_batch?: PdpModelBatch
  /** 잡 생성 때의 단계 모델 스냅숏(노드·모델·등급·상한) — 배포 중 모델 섞임 대조. 이 기능 전 잡은 없음 */
  model_route_snapshot?: Record<string, unknown> | null
  /**
   * LLM 백엔드(R13) — 'subscription' = Railway 구독 작업자가 진행하는 잡(spec_sheet 예약 키 modelBackend, DDL 없음). 없음 = API(웹)
   */
  model_backend?: PdpModelBackend
  /**
   * 구독 멈춤 표지(AX-CT-29) — true면 구독이 막혀도 API로 잇지 않고 멈추는 구독 표지 잡(spec_sheet 예약 키 subscriptionStop). 없음 = false
   */
  subscription_stop?: boolean
  created_at: string
  updated_at: string
}

export type PdpCostPool = 'test'

/**
 * 단계 함수가 주고받는 인메모리 상태 (NEXFIT AgentState 대응 — state.py:367-403).
 * run 분할 실행에서 매 호출마다 잡 레코드에서 복원된다.
 */
export interface PdpState {
  job: PdpJobRow
  /** 분석이 확정한 전략 계약 (analysis.recommended_strategy_contract + spec_sheet 수동값 머지) */
  strategyContract: StrategyContract
  decisionProfile?: DecisionProfile
  hookScore?: HookScore
  essenceType?: EssenceType
}

/** 단계별 진행률 매핑 (0~100, 폴링 표시용) */
export const PDP_STEP_PROGRESS: Record<PdpStep, number> = {
  pending: 0,
  analysis: 10,
  research: 25,
  design: 40,
  copywriting: 55,
  images: 75,
  compose: 95,
  done: 100,
  failed: 0,
}

// ─── 단계별 연속 실패 카운트 (§6.4 — 3회 연속 실패 시 current_step='failed') ───
// error 컬럼에 `[retry:<step>:<count>]` 접두사로 카운트를 인코딩한다 — 별도 DB 컬럼 없이
// 재개 규칙(JSONB 산출물 기준)과 동일하게 error 컬럼 자체를 단일 진실 원천으로 쓴다.
// 성공 시(각 stepX가 error를 warnings/null로 덮어씀) 접두사가 자연히 사라져 카운트가 리셋된다.

export const MAX_STEP_FAILURES = 3

const STEP_FAILURE_PREFIX = /^\[retry:([a-z]+):(\d+)\]\s*/

/** 직전 error에서 (실패 단계, 누적 횟수)를 복원한다. 접두사가 없으면(성공 이후 등) null. */
export function decodeStepFailure(error: string | null | undefined): { step: string; count: number } | null {
  if (!error) return null
  const m = error.match(STEP_FAILURE_PREFIX)
  if (!m) return null
  return { step: m[1], count: Number(m[2]) }
}

/** 같은 단계에서 재실패 시 카운트를 1 증가, 다른 단계거나 최초 실패면 1로 시작. */
export function encodeStepFailure(step: PdpStep, priorError: string | null, message: string): { error: string; count: number } {
  const prior = decodeStepFailure(priorError)
  const count = prior && prior.step === step ? prior.count + 1 : 1
  return { error: `[retry:${step}:${count}] ${message}`, count }
}

/** UI 표시용 — 재시도 카운트 접두사를 제거한 사람이 읽는 오류 메시지만 남긴다. */
export function stripStepFailurePrefix(error: string | null): string | null {
  if (!error) return error
  return error.replace(STEP_FAILURE_PREFIX, '')
}
