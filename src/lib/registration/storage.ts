/**
 * 상품등록 에셋 스토리지 헬퍼 — sourcing-product-images(public) 버킷에 경로 접두사로 격리.
 * 경로 규칙(설계문서 §3.3): {userId}/registration/{jobId}/thumb-{cut}.png
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'sourcing-product-images'

/** base64 이미지를 업로드하고 public URL을 반환한다. 실패는 throw(조용히 삼키지 않음). */
export async function uploadThumbnailCut(
  supabase: SupabaseClient,
  userId: string,
  jobId: string,
  cut: string,
  base64: string,
  mimeType: string
): Promise<string> {
  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png'
  const path = `${userId}/registration/${jobId}/thumb-${cut}-${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, Buffer.from(base64, 'base64'), { contentType: mimeType, upsert: false })
  if (error) throw new Error(`썸네일 업로드 실패(${cut}): ${error.message}`)
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/** 에디터 사용자 업로드 이미지 — {userId}/registration/editor-uploads/{timestamp}.{ext}
 *  (에디터 업로드 6곳 중 잡 ID를 안 넘기는 호출부가 다수라 잡 폴더 대신 공용 접두사) */
export async function uploadEditorImage(
  supabase: SupabaseClient,
  userId: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : mimeType === 'image/svg+xml' ? 'svg' : 'png'
  const path = `${userId}/registration/editor-uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: false })
  if (error) throw new Error(`에디터 이미지 업로드 실패: ${error.message}`)
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/**
 * PDP 섹션 이미지 업로드 — 경로 규칙(설계문서 §6.1 pdp-image-stage): {userId}/registration/{jobId}/pdp-{section}.png
 * section에는 리스트형 키(예: features:0)가 그대로 들어올 수 있어 파일명 안전 문자만 남긴다.
 */
export async function uploadPdpImage(
  supabase: SupabaseClient,
  userId: string,
  jobId: string,
  section: string,
  base64: string,
  mimeType: string
): Promise<string> {
  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png'
  const safeSection = section.replace(/[^a-zA-Z0-9_-]/g, '-')
  const path = `${userId}/registration/${jobId}/pdp-${safeSection}-${Date.now()}.${ext}`
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(path, Buffer.from(base64, 'base64'), { contentType: mimeType, upsert: false })
  if (error || !data?.path) {
    throw new Error(`PDP 이미지 업로드 실패(${section}): ${error?.message ?? '저장 경로를 확인하지 못했습니다.'}`)
  }
  const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(data.path)
  return publicData.publicUrl
}

/** 카탈로그 URL을 기록하기 전에 실제 스토리지 객체가 있는지 확인한다. */
export async function pdpStorageObjectExists(supabase: SupabaseClient, storagePath: string): Promise<boolean> {
  const slash = storagePath.lastIndexOf('/')
  const folder = slash >= 0 ? storagePath.slice(0, slash) : ''
  const name = slash >= 0 ? storagePath.slice(slash + 1) : storagePath
  const { data, error } = await supabase.storage.from(BUCKET).list(folder, { search: name, limit: 10 })
  if (error) return false
  return (data ?? []).some((entry) => entry.name === name)
}
