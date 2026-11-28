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

/** PDP 이미지 파일 확장자 — mime대로. GIF 칸 원본(image/gif)은 gif(전에는 png로 붙었다, 세션 B ③). 모르는 mime은 지금처럼 png */
export function pdpImageExtOf(mimeType: string): 'jpg' | 'webp' | 'gif' | 'png' {
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : mimeType === 'image/gif' ? 'gif' : 'png'
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
  const ext = pdpImageExtOf(mimeType)
  const safeSection = section.replace(/[^a-zA-Z0-9_-]/g, '-')
  const path = `${userId}/registration/${jobId}/pdp-${safeSection}-${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, Buffer.from(base64, 'base64'), { contentType: mimeType, upsert: false })
  if (error) throw new Error(`PDP 이미지 업로드 실패(${section}): ${error.message}`)
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/**
 * 상세 이미지 굽기(U1) — 잡 폴더 `{userId}/registration/{jobId}/detail-page/{runId}/{kind}-{NN}.jpg`.
 * 전체 이미지의 GIF 칸은 움직이는 WebP `full-{NN}.webp`다(세션 B ③ P4 — 번호는 JPEG 조각과 한 줄로 이어진다).
 * 전체 이미지가 Vercel 함수 본문 한도(4.5MB)를 넘을 수 있어, 서버는 서명 업로드 URL만 발급하고 브라우저가 스토리지로 직접 올린다.
 */
export const DETAIL_PAGE_BUCKET = BUCKET
export type DetailPageKind = 'section' | 'full'
export type DetailPageExt = 'jpg' | 'webp'

export function detailPageFolder(userId: string, jobId: string, runId: string): string {
  return `${userId}/registration/${jobId}/detail-page/${runId}`
}

export function detailPageFileName(kind: DetailPageKind, index: number, ext: DetailPageExt = 'jpg'): string {
  return `${kind}-${String(index + 1).padStart(2, '0')}.${ext}`
}

export function detailPagePublicUrl(supabase: SupabaseClient, path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

/** 서명 업로드 URL(2시간 유효, 덮어쓰기 없음) */
export async function createDetailPageUploadUrl(
  supabase: SupabaseClient,
  path: string
): Promise<{ path: string; token: string; publicUrl: string }> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) throw new Error(`상세 이미지 업로드 URL 발급 실패: ${error?.message ?? '알 수 없음'}`)
  return { path, token: data.token, publicUrl: detailPagePublicUrl(supabase, path) }
}

/** 폴더 안 파일(이름 → 실제 크기·형식) — 확정 단계에서 실제로 올라갔는지, 상한을 지켰는지 확인한다 */
export async function listDetailPageFiles(
  supabase: SupabaseClient,
  folder: string
): Promise<Map<string, { size: number | null; mimetype: string | null }>> {
  const { data, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 1000 })
  if (error) throw new Error(`상세 이미지 목록 조회 실패: ${error.message}`)
  return new Map(
    (data ?? []).map((f) => {
      const meta = (f.metadata ?? {}) as { size?: unknown; mimetype?: unknown }
      return [
        f.name,
        {
          size: typeof meta.size === 'number' ? meta.size : null,
          mimetype: typeof meta.mimetype === 'string' ? meta.mimetype : null,
        },
      ]
    })
  )
}

/**
 * 편집기 '내 이미지' 보관함(묶음 5 ②) — DDL 없이 스토리지 목록으로 만든다. 폴더는 서버가 받은 userId로만 만든다
 * (호출부가 잡 소유를 먼저 확인한다). uploads = 편집기 업로드, job = 그 잡의 생성 컷·썸네일(재생성 전 판도 남아 있다).
 * 하위 폴더(detail-page 굽기 결과 등)와 이미지가 아닌 파일은 뺀다. 지우기는 두지 않는다(되돌릴 수 없는 삭제).
 */
export type LibraryScope = 'uploads' | 'job'
export type LibraryImageKind = 'upload' | 'section' | 'thumbnail' | 'other'

export interface LibraryImage {
  name: string
  url: string
  createdAt: string | null
  size: number | null
  kind: LibraryImageKind
}

const LIBRARY_IMAGE_FILE = /\.(png|jpe?g|webp|svg)$/i

export function libraryFolder(userId: string, scope: LibraryScope, jobId?: string): string {
  if (scope === 'uploads') return `${userId}/registration/editor-uploads`
  if (!jobId) throw new Error('잡 보관함에는 jobId가 필요합니다')
  return `${userId}/registration/${jobId}`
}

function libraryKind(scope: LibraryScope, name: string): LibraryImageKind {
  if (scope === 'uploads') return 'upload'
  if (name.startsWith('pdp-')) return 'section'
  if (name.startsWith('thumb-')) return 'thumbnail'
  return 'other'
}

/** 한 쪽을 채우려고 스토리지 목록을 더 읽는 상한 — 하위 폴더·이미지 아닌 파일이 많아도 요청이 끝나게 한다 */
const LIBRARY_MAX_READS = 5

/**
 * 최근 것부터 이미지 limit개. 하위 폴더·이미지 아닌 파일은 건너뛰며 더 읽고, 그다음 이미지가 실제로 있을 때만 hasMore다
 * (빈 다음 쪽 없음). nextOffset은 다음 쪽을 시작할 스토리지 목록 위치(건너뛴 항목 포함) — 클라이언트는 이 값을 offset으로 넘긴다.
 * 상한까지 읽고도 끝을 못 보면 hasMore=true로 남은 목록을 다음 쪽에 넘긴다.
 */
export async function listLibraryImages(
  supabase: SupabaseClient,
  scope: LibraryScope,
  folder: string,
  { offset, limit }: { offset: number; limit: number }
): Promise<{ items: LibraryImage[]; hasMore: boolean; nextOffset: number }> {
  const items: LibraryImage[] = []
  const batch = limit + 1
  let position = offset
  for (let read = 0; read < LIBRARY_MAX_READS; read++) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(folder, { limit: batch, offset: position, sortBy: { column: 'created_at', order: 'desc' } })
    if (error) throw new Error(`내 이미지 목록 조회 실패: ${error.message}`)
    const rows = data ?? []
    for (const [i, f] of rows.entries()) {
      if (f.id === null || !LIBRARY_IMAGE_FILE.test(f.name)) continue
      if (items.length === limit) return { items, hasMore: true, nextOffset: position + i }
      const meta = (f.metadata ?? {}) as { size?: unknown }
      items.push({
        name: f.name,
        url: supabase.storage.from(BUCKET).getPublicUrl(`${folder}/${f.name}`).data.publicUrl,
        createdAt: f.created_at ?? null,
        size: typeof meta.size === 'number' ? meta.size : null,
        kind: libraryKind(scope, f.name),
      })
    }
    position += rows.length
    if (rows.length < batch) return { items, hasMore: false, nextOffset: position }
  }
  return { items, hasMore: true, nextOffset: position }
}
