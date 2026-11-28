/**
 * 생성 잡(대표이미지·상세페이지)의 등록 초안 연결과 사업장 결정 — 두 POST 라우트가 함께 쓴다.
 *
 * - draftId가 있으면 오너 본인 초안인지 확인하고, 사업장을 따로 주지 않았으면 초안 사업장을 물려받는다.
 * - 요청 사업장이 초안 사업장과 다르면 400(사업장 격리 구멍).
 * - 요청에 사업장을 직접 실었으면 오너 본인 사업장인지 businesses로 확인한다(헤더·본문 위조 차단).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type JobDraftLink =
  | { ok: true; draftId: string | null; businessId: string | null }
  | { ok: false; status: number; error: string }

export async function resolveJobDraftLink(
  db: SupabaseClient,
  userId: string,
  input: { draftId?: string | null; businessId?: string | null }
): Promise<JobDraftLink> {
  const requested = input.businessId?.trim() || null
  let draftId: string | null = null
  let businessId: string | null = requested

  const rawDraftId = input.draftId?.trim()
  if (rawDraftId) {
    const { data: drafts, error } = await db
      .from('sourcing_registration_drafts')
      .select('id, business_id')
      .eq('user_id', userId)
      .eq('id', rawDraftId)
      .limit(1)
    if (error) throw new Error(`드래프트 조회 실패: ${error.message}`)
    const draft = drafts?.[0] as { id: string; business_id: string | null } | undefined
    if (!draft) return { ok: false, status: 404, error: '연결할 드래프트를 찾을 수 없습니다.' }
    if (requested && draft.business_id && requested !== draft.business_id) {
      return { ok: false, status: 400, error: '요청 business_id가 드래프트의 사업장과 일치하지 않습니다.' }
    }
    draftId = draft.id
    businessId = requested ?? draft.business_id
  }

  if (requested) {
    const { data, error } = await db
      .from('businesses')
      .select('id')
      .eq('id', requested)
      .eq('user_id', userId)
      .limit(1)
    if (error) throw new Error(`사업장 소유 확인 실패: ${error.message}`)
    if (!data || data.length === 0) {
      return { ok: false, status: 403, error: '해당 사업장에 대한 접근 권한이 없습니다.' }
    }
  }

  return { ok: true, draftId, businessId }
}
