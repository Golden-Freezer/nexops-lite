/**
 * registration_thumbnail_jobs CRUD — 대표이미지 생성 잡.
 *
 * database.ts 미포함 신규 테이블이라 untyped SupabaseClient로 접근한다(sourcing 관례).
 * 모든 UPDATE/DELETE는 user_id 필터를 강제한다(전역 규칙 — 명시적 소유 필터).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ImageModel, ImageQuality } from '@/lib/agents/image/types'
import type {
  CutsRecord,
  ThumbnailAnalysis,
  ThumbnailCategory,
  ThumbnailCut,
  ThumbnailJob,
  ThumbnailJobStatus,
} from './thumbnail-types'

const TABLE = 'registration_thumbnail_jobs'
// 한 줄 리터럴 유지 — 문자열 연결로 넓히면 Supabase 쿼리 타입 파서가 GenericStringError로 떨어진다
const SELECT =
  'id, user_id, business_id, draft_id, source_images, product_name, category_hint, image_model, image_quality, vision_analysis, cuts, selected_cut, status, progress, error, cost_usd, created_at, updated_at'

interface JobRow {
  id: string
  user_id: string
  business_id: string | null
  draft_id: string | null
  source_images: unknown
  product_name: string | null
  category_hint: string | null
  image_model: string
  image_quality: string
  vision_analysis: unknown
  cuts: unknown
  selected_cut: string | null
  status: string
  progress: number
  error: string | null
  cost_usd: number | string | null
  created_at: string
  updated_at: string
}

function toJob(row: JobRow): ThumbnailJob {
  const analysis = row.vision_analysis
  const hasAnalysis =
    analysis && typeof analysis === 'object' && Object.keys(analysis as object).length > 0
  return {
    id: row.id,
    userId: row.user_id,
    businessId: row.business_id,
    draftId: row.draft_id,
    sourceImages: Array.isArray(row.source_images) ? row.source_images.map(String) : [],
    productName: row.product_name,
    categoryHint: (row.category_hint as ThumbnailCategory | null) ?? null,
    imageModel: row.image_model as ImageModel,
    imageQuality: row.image_quality as ImageQuality,
    visionAnalysis: hasAnalysis ? (analysis as ThumbnailAnalysis) : null,
    cuts: (row.cuts && typeof row.cuts === 'object' ? row.cuts : {}) as CutsRecord,
    selectedCut: (row.selected_cut as ThumbnailCut | null) ?? null,
    status: row.status as ThumbnailJobStatus,
    progress: row.progress ?? 0,
    error: row.error,
    costUsd: Number(row.cost_usd ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface CreateThumbnailJobInput {
  businessId?: string | null
  draftId?: string | null
  sourceImages: string[]
  productName?: string | null
  categoryHint?: ThumbnailCategory | null
  imageModel: ImageModel
  imageQuality: ImageQuality
}

export async function createThumbnailJob(
  db: SupabaseClient,
  userId: string,
  input: CreateThumbnailJobInput
): Promise<ThumbnailJob> {
  const { data, error } = await db
    .from(TABLE)
    .insert({
      user_id: userId,
      business_id: input.businessId ?? null,
      draft_id: input.draftId ?? null,
      source_images: input.sourceImages,
      product_name: input.productName ?? null,
      category_hint: input.categoryHint ?? null,
      image_model: input.imageModel,
      image_quality: input.imageQuality,
    })
    .select(SELECT)
    .single()
  if (error || !data) throw new Error(`썸네일 잡 생성 실패: ${error?.message ?? '알 수 없음'}`)
  return toJob(data as JobRow)
}

export async function getThumbnailJob(
  db: SupabaseClient,
  userId: string,
  id: string
): Promise<ThumbnailJob | null> {
  const { data, error } = await db.from(TABLE).select(SELECT).eq('user_id', userId).eq('id', id).limit(1)
  if (error) throw new Error(`썸네일 잡 조회 실패: ${error.message}`)
  return data && data.length > 0 ? toJob(data[0] as JobRow) : null
}

/** 최근 생성순 목록. before(created_at ISO)를 주면 그보다 앞선 잡만 — 생성 히스토리 페이지 넘김 커서. */
export async function listThumbnailJobs(
  db: SupabaseClient,
  userId: string,
  limit = 30,
  before?: string | null
): Promise<ThumbnailJob[]> {
  let query = db.from(TABLE).select(SELECT).eq('user_id', userId)
  if (before) query = query.lt('created_at', before)
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`썸네일 잡 목록 조회 실패: ${error.message}`)
  return (data ?? []).map((r) => toJob(r as JobRow))
}

export interface ThumbnailJobPatch {
  visionAnalysis?: ThumbnailAnalysis
  cuts?: CutsRecord
  selectedCut?: ThumbnailCut | null
  status?: ThumbnailJobStatus
  progress?: number
  error?: string | null
  costUsd?: number
}

export async function updateThumbnailJob(
  db: SupabaseClient,
  userId: string,
  id: string,
  patch: ThumbnailJobPatch
): Promise<ThumbnailJob> {
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.visionAnalysis !== undefined) fields.vision_analysis = patch.visionAnalysis
  if (patch.cuts !== undefined) fields.cuts = patch.cuts
  if (patch.selectedCut !== undefined) fields.selected_cut = patch.selectedCut
  if (patch.status !== undefined) fields.status = patch.status
  if (patch.progress !== undefined) fields.progress = patch.progress
  if (patch.error !== undefined) fields.error = patch.error
  if (patch.costUsd !== undefined) fields.cost_usd = patch.costUsd

  const { data, error } = await db
    .from(TABLE)
    .update(fields)
    .eq('user_id', userId)
    .eq('id', id)
    .select(SELECT)
    .single()
  if (error || !data) throw new Error(`썸네일 잡 갱신 실패: ${error?.message ?? '알 수 없음'}`)
  return toJob(data as JobRow)
}

export async function deleteThumbnailJob(db: SupabaseClient, userId: string, id: string): Promise<void> {
  const { error } = await db.from(TABLE).delete().eq('user_id', userId).eq('id', id)
  if (error) throw new Error(`썸네일 잡 삭제 실패: ${error.message}`)
}
