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

import type { ImageModel, ImageQuality } from '@/lib/agents/image/types'

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
export type HeroImageMode = 'studio' | 'lifestyle' | 'premium'

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
export interface PdpSpecSheet {
  productName: string
  brandName?: string
  /** 미지정 시 분석 단계가 자동 감지 (CATEGORY_DETECTION_PROMPT) */
  category?: string
  essenceType?: EssenceType
  keyFeatures?: string[]
  material?: string
  usageLocation?: string
  size?: string
  colorOptions?: string[]
  soldOutCount?: number
  rating?: number
  reviewCount?: number
  /** 리뷰 원문 텍스트 (NEXFIT 엑셀 업로드 대체 — 붙여넣기. 8,000자 절단은 카피 단계 규칙) */
  reviewsText?: string
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
  }
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
  }
  designPalette?: DesignPalette
  problem?: { question?: string; empathy?: string; empathyLines?: string[]; empathyDeepLines?: string[] }
  solution?: { declaration?: string; summary?: string }
  pointCards?: Array<{ title?: string; description?: string }>
  summary?: string
  colorOptions?: { title?: string; options?: string[]; description?: string }
  usageSceneTags?: string[]
  /** claim/proof/benefit/imageHint — PREMIUM_COPYWRITING_PROMPT 실제 스키마(원본 FAB 구조) 대응 */
  detailPoints?: Array<{ claim?: string; proof?: string; benefit?: string; imageHint?: string }>
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
  reviewHighlights?: Array<{ text?: string; author?: string }>
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
}

/** copy_sections JSONB — Pro는 스테이지 중간본 보관 (DDL COMMENT 계약) */
export interface CopySectionsPayload {
  final: CopywritingResult
  stage1?: CopywritingResult
  stage2?: CopywritingResult
  /** Stage 3 변경 신고율 (>0.6이면 전면 재작성 의심 경고 — copywriting_agent.py:1183-1187) */
  stage3_changed_ratio?: number
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
}

// ─── 5단계: 이미지 생성 산출 ───

/** section_images JSONB 원소 (DDL 계약: [{section, url, prompt}]) */
export interface SectionImage {
  section: string
  url: string
  prompt?: string
  /** 생성 실패 시 placeholder 마킹 (§6.4 — 해당 섹션만 실패, 파이프라인 계속) */
  error?: string
  /** Vision 게이트 미달 — 다음 생성 슬롯(같은 run 또는 이월된 run)에서 재생성 1회 예정 */
  pendingRegen?: boolean
  /** 게이트 재생성 예산을 이미 소비함(재재생성 금지 — thumbnail-pipeline retried 관례와 동일) */
  retried?: boolean
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
  created_at: string
  updated_at: string
}

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
