/**
 * registration_pdp_jobs CRUD — 상세페이지 6단계 생성 잡. Phase 1 jobs.ts 패턴(untyped
 * SupabaseClient, user_id 격리 강제)을 그대로 따른다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ImageModel, ImageQuality } from '@/lib/agents/image/types'
import type { Database } from '@/types/database'
import type {
  AnalysisResult,
  CopySectionsPayload,
  DesignPrompts,
  GenerationTrack,
  PdpJobRow,
  PdpMode,
  PdpSpecSheet,
  PdpStep,
  ResearchResult,
  SectionImage,
  SectionPlan,
} from './pdp-state'

const TABLE = 'registration_pdp_jobs'
// 한 줄 리터럴 유지 — 문자열 연결로 넓히면 Supabase 쿼리 타입 파서가 GenericStringError로 떨어진다(Phase 1 함정 기록)
const SELECT =
  'id, user_id, business_id, draft_id, spec_sheet, source_images, image_model, image_quality, mode, generation_track, analysis, research_result, design_prompts, section_plan, copy_sections, section_images, final_html, current_step, progress, error, cost_usd, created_at, updated_at'

interface JobRow {
  id: string
  user_id: string
  business_id: string | null
  draft_id: string | null
  spec_sheet: unknown
  source_images: unknown
  image_model: string
  image_quality: string
  mode: string
  generation_track: string
  analysis: unknown
  research_result: unknown
  design_prompts: unknown
  section_plan: unknown
  copy_sections: unknown
  section_images: unknown
  final_html: string | null
  current_step: string
  progress: number
  error: string | null
  cost_usd: number | string | null
  created_at: string
  updated_at: string
}

function asObject<T>(v: unknown, fallback: T): T {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : fallback
}

function toJob(row: JobRow): PdpJobRow {
  return {
    id: row.id,
    user_id: row.user_id,
    business_id: row.business_id,
    draft_id: row.draft_id,
    spec_sheet: asObject<PdpSpecSheet>(row.spec_sheet, { productName: '' }),
    source_images: Array.isArray(row.source_images) ? row.source_images.map(String) : [],
    image_model: row.image_model as ImageModel,
    image_quality: row.image_quality as ImageQuality,
    mode: (row.mode as PdpMode) || 'pro',
    generation_track: row.generation_track === 'internalized' ? 'internalized' : 'standard',
    analysis: asObject<AnalysisResult>(row.analysis, {}),
    research_result: asObject<ResearchResult>(row.research_result, {}),
    design_prompts: asObject<DesignPrompts>(row.design_prompts, {}),
    section_plan: asObject<SectionPlan>(row.section_plan, {}),
    copy_sections: asObject<Partial<CopySectionsPayload>>(row.copy_sections, {}),
    section_images: Array.isArray(row.section_images) ? (row.section_images as SectionImage[]) : [],
    final_html: row.final_html,
    current_step: row.current_step as PdpStep,
    progress: row.progress ?? 0,
    error: row.error,
    cost_usd: Number(row.cost_usd ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export interface CreatePdpJobInput {
  businessId?: string | null
  draftId?: string | null
  specSheet: PdpSpecSheet
  sourceImages: string[]
  imageModel: ImageModel
  imageQuality: ImageQuality
  mode: PdpMode
  generationTrack: GenerationTrack
}

export async function createPdpJob(db: SupabaseClient, userId: string, input: CreatePdpJobInput): Promise<PdpJobRow> {
  const { data, error } = await db
    .from(TABLE)
    .insert({
      user_id: userId,
      business_id: input.businessId ?? null,
      draft_id: input.draftId ?? null,
      spec_sheet: input.specSheet,
      source_images: input.sourceImages,
      image_model: input.imageModel,
      image_quality: input.imageQuality,
      mode: input.mode,
      generation_track: input.generationTrack,
    })
    .select(SELECT)
    .single()
  if (error || !data) throw new Error(`PDP 잡 생성 실패: ${error?.message ?? '알 수 없음'}`)
  return toJob(data as JobRow)
}

export async function getPdpJob(db: SupabaseClient, userId: string, id: string): Promise<PdpJobRow | null> {
  const { data, error } = await db.from(TABLE).select(SELECT).eq('user_id', userId).eq('id', id).limit(1)
  if (error) throw new Error(`PDP 잡 조회 실패: ${error.message}`)
  return data && data.length > 0 ? toJob(data[0] as JobRow) : null
}

export async function listPdpJobs(db: SupabaseClient, userId: string, limit = 30): Promise<PdpJobRow[]> {
  const { data, error } = await db
    .from(TABLE)
    .select(SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`PDP 잡 목록 조회 실패: ${error.message}`)
  return (data ?? []).map((r) => toJob(r as JobRow))
}

export interface PdpJobPatch {
  analysis?: AnalysisResult
  researchResult?: ResearchResult
  designPrompts?: DesignPrompts
  sectionPlan?: SectionPlan
  copySections?: Partial<CopySectionsPayload>
  sectionImages?: SectionImage[]
  finalHtml?: string | null
  currentStep?: PdpStep
  progress?: number
  error?: string | null
  costUsd?: number
  corpusVersion?: string
}

export async function updatePdpJob(
  db: SupabaseClient,
  userId: string,
  id: string,
  patch: PdpJobPatch
): Promise<PdpJobRow> {
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.analysis !== undefined) fields.analysis = patch.analysis
  if (patch.researchResult !== undefined) fields.research_result = patch.researchResult
  if (patch.designPrompts !== undefined) fields.design_prompts = patch.designPrompts
  if (patch.sectionPlan !== undefined) fields.section_plan = patch.sectionPlan
  if (patch.copySections !== undefined) fields.copy_sections = patch.copySections
  if (patch.sectionImages !== undefined) fields.section_images = patch.sectionImages
  if (patch.finalHtml !== undefined) fields.final_html = patch.finalHtml
  if (patch.currentStep !== undefined) fields.current_step = patch.currentStep
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
  if (error || !data) throw new Error(`PDP 잡 갱신 실패: ${error?.message ?? '알 수 없음'}`)
  const updatedJob = toJob(data as JobRow)

  if (patch.corpusVersion !== undefined) {
    try {
      // 생성 DB Update 타입을 사용하되 버전 기록 실패는 본 잡 갱신과 분리한다.
      const { error: corpusVersionError } = await db
        .from(TABLE)
        .update({
          corpus_version: patch.corpusVersion,
        } satisfies Database['public']['Tables']['registration_pdp_jobs']['Update'])
        .eq('user_id', userId)
        .eq('id', id)
      if (corpusVersionError) throw new Error(corpusVersionError.message)
    } catch (error) {
      console.warn('[pdp-jobs] corpus_version 기록 실패 — 잡 결과는 유지합니다.', {
        jobId: id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return updatedJob
}

export async function deletePdpJob(db: SupabaseClient, userId: string, id: string): Promise<void> {
  const { error } = await db.from(TABLE).delete().eq('user_id', userId).eq('id', id)
  if (error) throw new Error(`PDP 잡 삭제 실패: ${error.message}`)
}
