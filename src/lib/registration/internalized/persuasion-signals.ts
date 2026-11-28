/**
 * 설득 플래너 입력 신호 — docs/plans/pdp-enrichment/00_DESIGN.md §4.2의 문법 변형·포함 결정·고민 → 응답 표.
 * 순수 함수·결정론. 근거(spec_sheet) 없는 섹션은 만들지 않고, 사실 주장 금지 유형은 근거가 없으면 미응답으로 둔다.
 */

import { ProSectionType as S } from '@/lib/registration/editor/types/section'
import type { CorpusSnapshotV2, Role16, SequenceRoleStatV2 } from '../corpus-v2'
import { lookupRoleVocab, type DesignVocabSnapshot } from '../design-vocab'
import { hasEnrichmentFeature } from '../enrichment-switch'
import { isOptionSpec, type OptionSpec } from '../options/option-spec'

export { OPTION_SPEC_CATALOG_REASON } from '../options/option-spec'
import type { AnalysisResult, PdpSpecSheet, ResearchResult, StrategyContract } from '../pdp-state'
import type { ObjectionType } from './objection-types'
// 쓰는 법 글 판정(적용 D3 P2) — K와 같은 식. selection-facts는 input-values를 거쳐 이 파일을 다시 끌어오므로(고리) 함수 안에서만 읽는다
import { USAGE_WORDING_RE } from '../templatelib/selection-facts'
import { expectedPosition } from './pdp-internalized-skeleton'
import type { PersuasionGrammar } from './persuasion-rules'

export interface PersuasionInput {
  specSheet: PdpSpecSheet
  analysis: AnalysisResult
  strategyContract: StrategyContract
  research?: ResearchResult
  category: string | null | undefined
  snapshotV2: CorpusSnapshotV2 | null
  vocab: DesignVocabSnapshot
  /** W4-S 섹션 나누기(ENRICHMENT 'split' 기록 잡만) — 길이 목표 [14,18]·상한 18, 특징·사용 단계를 하나씩 센다 */
  split?: boolean
  /**
   * 디자인 컷 D2(ENRICHMENT 'designcut2' 기록 잡만) — 길이 목표 [14,18]·상한 18. 기본 목표(standard, 중앙값×1.5)로는 후기·추천 같은
   * 낮은 점수 단위가 상한에서 빠져 디자인 컷 계획이 그릴 재료가 없었다(R10 P02). 섹션은 하나 = 1로 센다(나누기 가중치 없음)
   */
  designcut2?: boolean
}

export interface Evidence {
  reviews: boolean
  rating: boolean
  dims: boolean
  cert: boolean
  event: boolean
  options: boolean
  /** 옵션 카탈로그가 등록 옵션 구조(optionSpec, variants ≥ 2)에서 나왔는지 — 위치·고민 응답이 달라진다 */
  optionSpec: boolean
  usageBasis: boolean
}

export interface ObjectionAnswer {
  answeredBy: string | null
  note?: string
}

/**
 * 특징 글이 쓰는 법을 말하는가 — K USAGE_WORDING_RE(사용 동사는 끝맺음까지 붙은 꼴, '하면'류는 앞에 사용 동작 낱말이 있을 때만). 옛 D 식은 '바르'·'하면' 조각이라
 * '바르게 세워지는'·'편하면서도'에도 걸려 근거 없는 사용법 섹션이 열렸다(적용 D3 P2, K #629와 같은 판정)
 */
const isUsageWording = (feature: string) => USAGE_WORDING_RE.test(feature)
/** v2 hookDefault와 같은 공식 — problem 출현율 ≥ 0.15(build-corpus-v2.mjs deriveHookDefault, WORK_SPEC A-1 고정 임계). */
const HOOK_DEFAULT_PROBLEM_MIN = 0.15

/** 옵션 카탈로그 근거로 쓸 등록 옵션 구조 — ENRICHMENT options가 기록된 잡이고 variants ≥ 2일 때만(05_OPTIONS.md §4). 아니면 null */
export function optionSpecOf(spec: PdpSpecSheet, analysis: unknown): OptionSpec | null {
  if (!hasEnrichmentFeature(analysis, 'options') || !isOptionSpec(spec.optionSpec)) return null
  return spec.optionSpec.variants.length >= 2 ? spec.optionSpec : null
}

/** analysis가 없으면(또는 options 기록이 없으면) 옵션 근거는 기존 규칙(colorOptions ≥ 4)이다. */
export function evidenceOf(spec: PdpSpecSheet, analysis?: unknown): Evidence {
  const rating = typeof spec.rating === 'number' && spec.rating > 0
  const optionSpec = optionSpecOf(spec, analysis) !== null
  return {
    reviews: Boolean(spec.reviewsText?.trim()) || rating || (spec.reviewCount ?? 0) > 0,
    rating,
    dims: Boolean(spec.size?.trim()),
    cert: Boolean(spec.certificationInfo?.trim()),
    event: Boolean(spec.eventBannerInfo?.trim()),
    options: optionSpec || (spec.colorOptions?.length ?? 0) >= 4,
    optionSpec,
    usageBasis: (spec.keyFeatures ?? []).some(isUsageWording) || Boolean(spec.material?.trim()),
  }
}

export function hasUsageFeature(spec: PdpSpecSheet): boolean {
  return (spec.keyFeatures ?? []).some(isUsageWording)
}

/** 문법 변형 선택 — 판정 순서 G2 → G4 → G3 → G1. */
export function selectGrammar(
  sc: StrategyContract,
  spec: PdpSpecSheet,
  analysis: AnalysisResult
): { grammar: PersuasionGrammar; reason: string } {
  const ev = evidenceOf(spec)
  const strongEvidence = (Boolean(spec.reviewsText?.trim()) && (ev.rating || (spec.reviewCount ?? 0) > 0)) || ev.cert
  if (sc.proof_sensitivity === 'high' && strongEvidence)
    return { grammar: 'G2', reason: '증거 민감도 high + 실제 강한 증거' }
  const giftOrFamily = sc.purchase_context === 'gift' || sc.purchase_context === 'family'
  if (sc.persuasion_axis === 'emotion' && (giftOrFamily || spec.targetPersona?.trim())) {
    return { grammar: 'G4', reason: '감성 축 + 선물·가족 맥락 또는 대상 정의' }
  }
  const highPain = (analysis.pain_clusters ?? []).some((p) => p.urgency === 'high')
  if (sc.involvement_level === 'low' && sc.page_length_target === 'quick' && !highPain) {
    return { grammar: 'G3', reason: '저관여·짧은 분량·고긴급 고통 없음' }
  }
  return { grammar: 'G1', reason: '기본' }
}

/** 역할 사전값 — v2 sequenceFull이 있으면 그것, 없으면 vocab(조회 순서대로). 없으면 출현율 0.1·위치 middle. */
export function priorFor(role: Role16, input: PersuasionInput): { prevalence: number; expected: number } {
  const stat = input.snapshotV2?.sequenceFull.find((s) => s.role === role)
  if (stat) return { prevalence: stat.prevalence, expected: expectedPosition(stat) }
  const vocabRole = lookupRoleVocab(input.category, role, input.vocab)?.role
  if (!vocabRole) return { prevalence: 0.1, expected: expectedPosition(undefined) }
  const asStat = { positionDist: vocabRole.positionDist } as unknown as SequenceRoleStatV2
  return { prevalence: vocabRole.prevalence, expected: expectedPosition(asStat) }
}

/**
 * hook 게이트 — 사용자 명시(extra.hookMode) > 카테고리 실측. v2가 있으면 v2 hookDefault, 없으면(pooled) v2와 같은 공식
 * (problem 출현율 ≥ 0.15)을 vocab 출현율에 적용한다.
 */
export function hookGate(input: PersuasionInput): { ok: boolean; reason: string } {
  const explicit = typeof input.specSheet.extra?.hookMode === 'string' && input.specSheet.extra.hookMode.trim() !== ''
  if (explicit) return { ok: true, reason: '사용자 명시(extra.hookMode)' }
  if (input.snapshotV2) {
    return input.snapshotV2.profile.hookDefault
      ? { ok: true, reason: 'v2 hookDefault' }
      : { ok: false, reason: 'hookDefault=false(카테고리 실측) — 사용자 명시 없음' }
  }
  const problem = lookupRoleVocab(input.category, 'problem', input.vocab)?.role.prevalence ?? 0
  return problem >= HOOK_DEFAULT_PROBLEM_MIN
    ? { ok: true, reason: `pooled hookDefault — problem 출현율 ${problem} ≥ ${HOOK_DEFAULT_PROBLEM_MIN}` }
    : { ok: false, reason: `pooled hookDefault=false — problem 출현율 ${problem} < ${HOOK_DEFAULT_PROBLEM_MIN}` }
}

/** 고민 1건 → 응답 섹션(포함된 역할 기준). 사실 주장 금지 유형은 근거가 없으면 미응답 기록. */
export function answerFor(type: ObjectionType, included: ReadonlySet<Role16>, ev: Evidence): ObjectionAnswer {
  switch (type) {
    case 'usage_care':
      return included.has('how_to_guide')
        ? { answeredBy: S.HIDDEN_PAGE }
        : { answeredBy: null, note: '사용 순서 근거(keyFeatures·material) 없음 — 미응답' }
    case 'environment_versatility':
      return included.has('target_recommendation')
        ? { answeredBy: S.POINT_LIST_DIV, note: '사용 환경·대상 — 단정 표현 금지' }
        : { answeredBy: S.POINT_DIV, note: '사용컷으로 응답 — 단정 표현 금지' }
    case 'quality_durability':
      return { answeredBy: S.SUB_DIV, note: '클로즈업 증거 컷 — 수치 주장 금지' }
    case 'quantity_size':
      if (included.has('size_spec')) return { answeredBy: S.SPEC_TABLE }
      return ev.optionSpec && included.has('option_catalog')
        ? { answeredBy: S.PETIT_DIV, note: '등록 옵션 구성 — 옵션명 그대로, 치수 생성 금지' }
        : { answeredBy: S.POINT_DIV, note: '구성 컷 — 치수 생성 금지' }
    case 'safety_cert':
      return ev.cert && included.has('certification_evidence')
        ? { answeredBy: S.CERTIFICATION }
        : { answeredBy: null, note: '인증 근거 없음 — 인증·안전 주장 금지(연령 게이트 유지)' }
    case 'material_eco':
      return { answeredBy: null, note: '응답 렌더러 없음 — 친환경·무해 주장 금지(소재 사실만)' }
    case 'price_value':
      if (included.has('promotion_offer')) return { answeredBy: S.EVENT_BANNER }
      return ev.optionSpec && included.has('option_catalog')
        ? { answeredBy: S.PETIT_DIV, note: '등록 옵션 구성으로 응답 — 가격·할인 표기 금지' }
        : { answeredBy: S.POINT_DIV, note: '구성·가치 컷 — 가격 비교 수치 금지' }
    default:
      return { answeredBy: null, note: '유형 미분류 — 미응답 기록' }
  }
}

/**
 * 응답 섹션이 골격에서 빠졌을 때의 대체 — 설계 표가 허용한 usp 대체(사용컷·구성 컷·클로즈업)만 있다.
 * hidden_page·certification은 대체가 없다(사용 순서·인증 주장을 다른 섹션에서 만들지 않는다).
 */
export const ANSWER_FALLBACK: Partial<Record<string, { section: string; note: string }>> = {
  [S.SUB_DIV]: { section: S.POINT_DIV, note: '클로즈업 증거 컷 — 수치 주장 금지' },
  [S.POINT_LIST_DIV]: { section: S.POINT_DIV, note: '사용컷으로 응답 — 단정 표현 금지' },
  [S.SPEC_TABLE]: { section: S.POINT_DIV, note: '구성 컷 — 치수 생성 금지' },
  [S.EVENT_BANNER]: { section: S.POINT_DIV, note: '구성·가치 컷 — 가격 비교 수치 금지' },
  [S.PETIT_DIV]: { section: S.POINT_DIV, note: '구성 컷 — 치수·가격 생성 금지' },
}

/** 인증 정보가 특정 가치 군집을 뒷받침하는지(2자 이상 낱말 겹침) — 주장-증거 인접 배치용. 겹치는 군집 순위 또는 -1. */
export function certificationClaimIndex(spec: PdpSpecSheet, analysis: AnalysisResult): number {
  const words = (text: string) => new Set(text.split(/[^0-9A-Za-z가-힣]+/).filter((w) => w.length >= 2))
  const cert = words(spec.certificationInfo ?? '')
  if (cert.size === 0) return -1
  return (analysis.benefit_clusters ?? []).findIndex((b) => [...words(String(b?.name ?? ''))].some((w) => cert.has(w)))
}
