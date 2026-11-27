/**
 * 대표이미지 3컷 파이프라인 공용 타입 — NEXFIT 썸네일 생성기 이식 (Phase 1).
 * 원본 계약: NEXFIT server/thumbnail/{service,gate}.py · api/thumbnail.py
 */

import type { ImageModel, ImageQuality } from '@/lib/agents/image/types'

/** 카테고리 프로필 8종 키 — NEXFIT profiles.py CATEGORY_PROFILES와 1:1 */
export type ThumbnailCategory =
  | 'fashion'
  | 'food'
  | 'digital'
  | 'beauty'
  | 'stationery'
  | 'packaging'
  | 'household'
  | 'pet'

export const THUMBNAIL_CATEGORIES: ThumbnailCategory[] = [
  'fashion',
  'food',
  'digital',
  'beauty',
  'stationery',
  'packaging',
  'household',
  'pet',
]

/** UI 셀렉트 라벨 — NEXFIT frontend components/generate/constants.tsx:108-118과 동일 매핑 */
export const THUMBNAIL_CATEGORY_LABELS: Record<ThumbnailCategory, string> = {
  fashion: '패션',
  food: '식품',
  digital: '디지털·가전',
  beauty: '뷰티',
  stationery: '문구류',
  packaging: '포장재',
  household: '생활용품',
  pet: '반려동물용품',
}

export type ProductForm = 'single_item' | 'multi_item_set' | 'bulk_goods' | 'unknown'
export type PackageRole = 'none' | 'sellable_unit' | 'incidental' | 'unknown'

export const PRODUCT_FORMS: ProductForm[] = ['single_item', 'multi_item_set', 'bulk_goods', 'unknown']
export const PACKAGE_ROLES: PackageRole[] = ['none', 'sellable_unit', 'incidental', 'unknown']

/** Vision 분석 정규화 산출 — NEXFIT service.py:182-194 반환 형태 */
export interface ThumbnailAnalysis {
  category: ThumbnailCategory
  product_summary: string
  primary_colors: string[]
  has_label_or_logo: boolean
  is_wearable: boolean
  product_form: ProductForm
  package_role: PackageRole
  reference_index: number
  confidence: number
  /** 임팩트컷 창의 컨셉 (LLM 제안, 실패 시 null → 결정론 폴백) — service.py plan_impact_concept */
  impact_concept?: string | null
}

export type ThumbnailCut = 'cutout' | 'studio' | 'usage'
export const THUMBNAIL_CUTS: ThumbnailCut[] = ['cutout', 'studio', 'usage']

/** 컷 라벨 — NEXFIT 표기: 누끼컷(대표이미지용)/임팩트컷(추가이미지용)/실사용컷(추가이미지용) */
export const THUMBNAIL_CUT_LABELS: Record<ThumbnailCut, string> = {
  cutout: '누끼컷',
  studio: '임팩트컷',
  usage: '실사용컷',
}

/** 게이트 identity 축 판정 — NEXFIT gate.py _evaluate_cut 산출 */
export interface GateIdentityDetail {
  passed: boolean
  same_product: boolean
  consistency: number
  has_artifact: boolean
  message: string | null
}

/** 게이트 presentation 축 판정 */
export interface GatePresentationDetail {
  passed: boolean
  not_continuous_single_photo: boolean
  rectangular_boundary: boolean
  planar_source_remnant: boolean
  flat_margin_band: boolean
  tight_bbox_occupancy: number | null
  warning: string | null
  message: string | null
}

/** 컷 1개의 게이트 판정 상세 */
export interface CutGateDetail {
  passed: boolean
  message: string | null
  identity: GateIdentityDetail
  presentation: GatePresentationDetail
}

/** 잡 전체 게이트 산출 — gate.py compose_gate 형태 (usage 컷은 게이트 미대상) */
export interface GateResult {
  passed: boolean
  message: string | null
  cuts: { cutout: CutGateDetail; studio: CutGateDetail }
}

/** cuts JSONB의 컷별 엔트리 */
export interface CutEntry {
  url?: string
  error?: string
  /** 재생성을 소비했는지 — 생성 실패·게이트 미달 공용, 잡 전체 예산 2컷(NEXFIT retried_cuts 대응) */
  retried?: boolean
  /** 게이트 미달로 다음 run에서 재생성 대기 중 */
  regen?: boolean
  /** 해당 컷의 게이트 판정 (usage는 항상 없음) */
  gate?: CutGateDetail
}

export type CutsRecord = Partial<Record<ThumbnailCut, CutEntry>>

export type ThumbnailJobStatus = 'pending' | 'analyzing' | 'generating' | 'gating' | 'done' | 'failed'

/** registration_thumbnail_jobs 행 (camelCase 매핑) */
export interface ThumbnailJob {
  id: string
  userId: string
  businessId: string | null
  draftId: string | null
  sourceImages: string[]
  productName: string | null
  categoryHint: ThumbnailCategory | null
  imageModel: ImageModel
  imageQuality: ImageQuality
  visionAnalysis: ThumbnailAnalysis | null
  cuts: CutsRecord
  selectedCut: ThumbnailCut | null
  status: ThumbnailJobStatus
  progress: number
  error: string | null
  costUsd: number
  createdAt: string
  updatedAt: string
}
