/**
 * 원본 합성(묶음 4, 12_ORIGINAL_COMPOSITE.md) — 기준값·기록 형태. 값의 근거는 NEXFIT agents/photo_cutout.py·photo_composite.py와
 * B 누끼 실험(10_CUTOUT_TRIAL.md §4)이다. 고르기 문턱은 같은 20장으로 정한 가설이라 하네스가 켠 실험 갈래 전용이다(§4 스위치).
 */

/** 합성 자격 최소 해상도(긴 변) — NEXFIT COMPOSITE_MIN_LONG_SIDE */
export const COMPOSITE_MIN_LONG_SIDE = 800
/** 누끼 처리 크기 상한(긴 변, 확대 없음) — B 실험 MAX_SIDE와 같게(문턱을 이 크기에서 정했다) */
export const CUTOUT_MAX_SIDE = 1500
/** 알파 커버리지 허용 범위 — 불투명(알파 128 이상) 비율. 전부 투명·전부 불투명이면 세그먼테이션 실패(NEXFIT ALPHA_COVERAGE_*) */
export const ALPHA_COVERAGE_MIN = 0.05
export const ALPHA_COVERAGE_MAX = 0.9
export const ALPHA_OPAQUE_CUTOFF = 128

/** 고르기 규칙(B 보고서 §4-4 가설) — 기록에 함께 남겨 문턱을 고칠 때 갈래를 구분한다 */
export const CUTOUT_SELECT_RULE = { version: 1, isnetSoftMax: 0.15, keyOpaqueRatioMin: 2 } as const

/** 합성 대상 컷 — 제품 단독 노출 컷만(NEXFIT COMPOSITE_TARGET_TYPES). 사람·상황 연출 컷은 합성으로 만들 수 없다 */
export const COMPOSITE_TARGET_SECTIONS = ['hero', 'premium_hero', 'product_exposure'] as const
export type CompositeTargetSection = (typeof COMPOSITE_TARGET_SECTIONS)[number]

export function isCompositeTarget(section: string): section is CompositeTargetSection {
  return (COMPOSITE_TARGET_SECTIONS as readonly string[]).includes(section)
}

/**
 * K 라인 합성 칸 역할(결정 카드 c18·하네스 J29, 오너 I2-4 'K 칸에 맞춰 다시 정의') — 옛 섹션 이름은 K 칸(k*_photo_*)에 걸리지 않는다.
 * 사람·손·움직임·치수가 없는 K 칸 가운데 목적이 상품 단독(hero)·디테일(texture)·포장 라벨(package)인 칸만(k-composite.ts가 고른다).
 * K8 재생성 19회 중 17회가 포장·라벨 글자 깨짐이라 글자 있는 상품에서 효과가 가장 크다(원본 화소는 글자를 다시 그리지 않는다)
 */
export const K_COMPOSITE_ROLES = ['k_solo', 'k_detail', 'k_label'] as const
export type KCompositeRole = (typeof K_COMPOSITE_ROLES)[number]

/** 합성 모양 이름 — 옛 섹션 셋 + K 칸 역할 셋 */
export type CompositeStyleKey = CompositeTargetSection | KCompositeRole

export interface CompositeCutStyle {
  heightRatio: number
  anchor: number
  backdrop: 'gradient' | 'deep' | 'flat'
  fit: number
  crop: number
  /** 누끼 제품 폭 상한(프레임 폭 대비) — 없으면 렌더 기본값. 디테일 칸은 1을 넘겨 제품 가운데를 크게 잘라 보인다 */
  widthRatio?: number
}

/** 컷별 변형 — 원본이 하나여도 세 컷이 같은 그림이 되면 안 된다(옛 섹션 셋은 NEXFIT COMPOSITE_CUT_STYLES 값 그대로) */
export const COMPOSITE_CUT_STYLES: Record<CompositeStyleKey, CompositeCutStyle> = {
  hero: { heightRatio: 0.58, anchor: 0.46, backdrop: 'gradient', fit: 0.86, crop: 1.0 },
  premium_hero: { heightRatio: 0.66, anchor: 0.4, backdrop: 'deep', fit: 0.96, crop: 1.0 },
  product_exposure: { heightRatio: 0.5, anchor: 0.52, backdrop: 'flat', fit: 0.82, crop: 0.82 },
  // K 칸(J29) — 상품 단독은 단색 바탕 가운데, 디테일은 제품 가운데를 크게(원본 처리 크기 1500 안에서 약 1.6배), 포장 라벨은 글자가 읽히게 크게
  k_solo: { heightRatio: 0.62, anchor: 0.5, backdrop: 'flat', fit: 0.86, crop: 1.0 },
  k_detail: { heightRatio: 1.6, anchor: 0.5, backdrop: 'flat', fit: 1.0, crop: 0.55, widthRatio: 1.6 },
  k_label: { heightRatio: 0.74, anchor: 0.48, backdrop: 'flat', fit: 0.94, crop: 1.0 },
}

export type CompositeMode = 'cutout' | 'direct' | 'skip'

/** 생성 경로로 넘긴 사유 */
export type CompositeSkipReason =
  | 'no_backend'
  | 'no_photo'
  | 'low_res'
  | 'marks'
  | 'collage'
  | 'cutout_error'
  | 'alpha_gate'

/** 자격 판정 비전 1콜 결과(NEXFIT has_person·flat_print + 덧붙임 supplier_marks·collage). 호출 실패면 error만 */
export interface CompositeEligibility {
  has_person?: boolean
  flat_print?: boolean
  supplier_marks?: boolean
  collage?: boolean
  reason?: string
  error?: string
}

export interface CutoutMetrics {
  /** 처리 크기(긴 변) 전의 원본 긴 변 */
  longSide: number
  /** 고른 결과의 불투명(알파 128 이상) 비율 — 알파 게이트 */
  coverage?: number
  /** isnet 반투명(알파 6~249) 비율 */
  isnetSoft?: number
  isnetOpaque?: number
  keyOpaque?: number
  keyApplicable?: boolean
}

/** section_plan.composite_source — 잡당 1회 판정 기록(DDL 없음). 있으면 다시 판정하지 않는다 */
export interface CompositeSourceRecord {
  version: 1
  decidedAt: string
  /** 고른 원천 사진(생성 참조 첫 장) */
  photoUrl?: string
  mode: CompositeMode
  /** skip 사유 또는 direct 근거(has_person·flat_print) */
  reason?: CompositeSkipReason | 'has_person' | 'flat_print'
  eligibility?: CompositeEligibility
  method?: 'isnet' | 'key'
  metrics?: CutoutMetrics
  /** 누끼 알파 PNG(원천 처리 크기) — 디자인 컷 productAlpha 레이어(B) */
  cutoutUrl?: string
  /** 불투명 영역 0~1(cutoutUrl 기준) */
  bbox?: { x: number; y: number; w: number; h: number }
  rule: typeof CUTOUT_SELECT_RULE
  /** 합성하다 실패해 생성 경로로 넘긴 컷(compose_error) */
  failedCuts?: string[]
}
