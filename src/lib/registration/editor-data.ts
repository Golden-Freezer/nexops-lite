/**
 * registration_editor_data CRUD — Canvas 에디터 문서(잡과 1:1, pdp_job_id UNIQUE).
 * 라우트가 getPdpJob(userId, jobId)로 잡 소유를 먼저 검증한 뒤에만 호출된다는 전제
 * (admin 클라이언트는 RLS를 우회하므로 user_id 필터를 여기서도 이중으로 건다).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveGenerationTrack, type PdpJobRow } from './pdp-state'
import type { EditorDataResponse } from './editor/services/editorApi'
import { toGeneratedImagesMap } from './pdp-image-tasks'
import { getCorpusSnapshotV2 } from './corpus-v2'
import { buildInternalizedTheme } from './internalized/internalized-theme'

export interface EditorDataRow {
  id: string
  user_id: string
  pdp_job_id: string
  sections_data: unknown[]
  layout_assignments: Record<string, string>
  updated_at: string
}

export async function getEditorData(
  db: SupabaseClient,
  userId: string,
  pdpJobId: string
): Promise<EditorDataRow | null> {
  const { data, error } = await db
    .from('registration_editor_data')
    .select('id, user_id, pdp_job_id, sections_data, layout_assignments, updated_at')
    .eq('user_id', userId)
    .eq('pdp_job_id', pdpJobId)
    .maybeSingle()
  if (error) throw new Error(`에디터 데이터 조회 실패: ${error.message}`)
  return (data as EditorDataRow | null) ?? null
}

/**
 * GET /editor 응답 조립 — NEXFIT EditorDataResponse 계약(editorApi.ts)에 맞춰
 * 잡 JSONB를 클라이언트(buildEditorDocument) 무변경으로 소비 가능한 형태로 변환한다.
 * 이미지 키 변환은 파이프라인 SSOT toGeneratedImagesMap 재사용(features:i → features[] 등).
 */
export function assembleEditorDataResponse(job: PdpJobRow, row: EditorDataRow | null): EditorDataResponse {
  const images = toGeneratedImagesMap(job.section_images ?? [])
  // conversion_cta는 파이프라인이 별도 생성하지 않고 cta를 재사용한다(원본 C-A3 동작 —
  // NEXFIT image_generation_agent·NexOps pdp-composer-sections 양쪽과 동일 규칙).
  // 누락 시 convert_div 섹션이 에디터에서만 이미지 없이 빌드된다(verifier 적발).
  if (images.cta && !images.conversion_cta) images.conversion_cta = images.cta
  // Track I(결정 T-5): 서버가 테마를 해석해 내려보낸다 — 클라이언트는 최초 빌드에서만 적용하고,
  // 이후 편집·저장본은 오너 재량(테마 미재적용). Track S·v2 미보유 카테고리는 null.
  const snapshotV2 =
    resolveGenerationTrack(job) === 'internalized' ? getCorpusSnapshotV2(job.analysis.detected_category) : null
  const internalizedTheme = snapshotV2
    ? buildInternalizedTheme(snapshotV2, job.copy_sections.final?.designPalette ?? null)
    : null

  return {
    is_new: !row || !(Array.isArray(row.sections_data) && row.sections_data.length > 0),
    sections_data: row?.sections_data ?? [],
    layout_assignments: row?.layout_assignments ?? {},
    // JSONB 파싱 타입(CopywritingResult 등)은 인덱스 시그니처가 없어 Record 계약으로 단언 —
    // 라우트가 JSON 직렬화해 보내는 값이라 구조적으로 동등하다
    copywriting_result: (job.copy_sections.final ?? null) as EditorDataResponse['copywriting_result'],
    generated_images: images as EditorDataResponse['generated_images'],
    spec_sheet: (job.spec_sheet ?? null) as unknown as EditorDataResponse['spec_sheet'],
    section_plan: (job.section_plan ?? null) as EditorDataResponse['section_plan'],
    internalized_theme: internalizedTheme,
  }
}

export async function upsertEditorData(
  db: SupabaseClient,
  userId: string,
  pdpJobId: string,
  payload: { sections_data: unknown[]; layout_assignments: Record<string, string> }
): Promise<{ updated_at: string }> {
  const updatedAt = new Date().toISOString()
  // UPSERT는 .eq() 필터를 못 거므로 소유 검증을 선행한다 — 타 유저 행이 이미 있으면
  // ON CONFLICT DO UPDATE가 그 행을 덮어쓰고 user_id까지 재할당하는 구멍(verifier 적발).
  const { data: existing, error: checkError } = await db
    .from('registration_editor_data')
    .select('user_id')
    .eq('pdp_job_id', pdpJobId)
    .maybeSingle()
  if (checkError) throw new Error(`에디터 데이터 소유 확인 실패: ${checkError.message}`)
  if (existing && existing.user_id !== userId) {
    throw new Error('다른 사용자의 에디터 데이터입니다.')
  }
  const { error } = await db
    .from('registration_editor_data')
    .upsert(
      {
        user_id: userId,
        pdp_job_id: pdpJobId,
        sections_data: payload.sections_data,
        layout_assignments: payload.layout_assignments,
        updated_at: updatedAt,
      },
      { onConflict: 'pdp_job_id' }
    )
  if (error) throw new Error(`에디터 데이터 저장 실패: ${error.message}`)
  return { updated_at: updatedAt }
}
