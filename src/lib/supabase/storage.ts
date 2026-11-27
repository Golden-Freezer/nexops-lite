/**
 * Supabase Storage 헬퍼 (naming-screenshots 버킷)
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'naming-screenshots'
const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export class StorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageError'
  }
}

/** 파일 유효성 검증 */
function validateFile(file: File) {
  if (file.size > MAX_SIZE) {
    throw new StorageError(`파일 크기 초과: ${(file.size / 1024 / 1024).toFixed(1)}MB (최대 5MB)`)
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new StorageError(`허용되지 않는 파일 형식: ${file.type} (PNG/JPG/WEBP만 허용)`)
  }
}

/** 스크린샷 업로드 */
export async function uploadScreenshot(
  supabase: SupabaseClient,
  userId: string,
  file: File,
  slot: 'A' | 'B' | 'C' | 'D'
): Promise<string> {
  validateFile(file)

  const ext = file.name.split('.').pop() ?? 'png'
  const path = `${userId}/${Date.now()}_${slot}.${ext}`

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })

  if (error) throw new StorageError(`업로드 실패: ${error.message}`)
  return path
}

/** Signed URL 조회 (bucket이 private이므로 signed URL 사용) */
export async function getSignedUrl(supabase: SupabaseClient, path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn)
  if (error || !data) throw new StorageError(`URL 생성 실패: ${error?.message}`)
  return data.signedUrl
}

/** @deprecated bucket이 private으로 변경됨. getSignedUrl() 사용 권장 */
export function getPublicUrl(supabase: SupabaseClient, path: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/** 스크린샷 삭제 */
export async function deleteScreenshot(supabase: SupabaseClient, path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw new StorageError(`삭제 실패: ${error.message}`)
}

// ─── 지출 증빙 (expense-receipts 버킷, private) ───

/** 지출 증빙 버킷명 — receipt_path만 DB에 저장하고 조회 시점마다 signed URL을 새로 발급한다 (audit §5-3) */
export const EXPENSE_BUCKET = 'expense-receipts'

/** 지출 증빙 signed URL 조회 */
export async function getExpenseReceiptUrl(supabase: SupabaseClient, path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(EXPENSE_BUCKET).createSignedUrl(path, expiresIn)
  if (error || !data) throw new StorageError(`증빙 URL 생성 실패: ${error?.message}`)
  return data.signedUrl
}

/** 지출 증빙 삭제 */
export async function removeExpenseReceipt(supabase: SupabaseClient, path: string): Promise<void> {
  const { error } = await supabase.storage.from(EXPENSE_BUCKET).remove([path])
  if (error) throw new StorageError(`증빙 삭제 실패: ${error.message}`)
}
