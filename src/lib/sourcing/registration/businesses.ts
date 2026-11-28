/**
 * 오너 사업장 목록 — 소싱 전용 읽기 헬퍼 (WS-A 사업자 선택용).
 *
 * guard §4 진화(2026-07-23, 오너 승인): 명시적 등록 핸드오프(오너가 등록 대상 사업장을 고르는 행위)에
 * 한해 businesses 읽기를 허용한다. 이 헬퍼는 오직 오너 본인(user_id)의 사업장 id·표시명·쿠팡 벤더코드만
 * 읽는다. businesses 쓰기·purpose 자동승격은 계속 금지이며, 이 헬퍼는 어떤 쓰기도 하지 않는다.
 * 쓰기 시 검증은 requireOwnedBusinessId(src/lib/auth/business.ts)로 별도 수행한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface OwnedBusiness {
  id: string
  name: string
  /** 쿠팡 벤더코드 (WS-C 크레덴셜 매핑). 미설정이면 null */
  coupangVendorId: string | null
  isDefault: boolean
}

interface BusinessRow {
  id: string
  business_name: string | null
  coupang_vendor_id: string | null
  is_default: boolean | null
}

/**
 * 등록 대상 사업장의 쿠팡 벤더코드(coupang_vendor_id) 조회 — 오너 본인 사업장만.
 * 쿠팡 OpenAPI 호출 시 VENDOR_CREDENTIALS[vendorId]로 크레덴셜을 선택하는 키다. 미설정이면 null.
 * guard §4 예외(등록 핸드오프) 범위 내 읽기.
 */
export async function getVendorIdForBusiness(
  db: SupabaseClient,
  userId: string,
  businessId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('businesses')
    .select('coupang_vendor_id')
    .eq('id', businessId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`사업장 벤더코드 조회 실패: ${error.message}`)
  return (data?.coupang_vendor_id as string | null) ?? null
}

/** 오너 본인의 사업장 목록 — 기본 사업장 우선, 이름순. 읽기 전용. */
export async function listOwnedBusinesses(db: SupabaseClient, userId: string): Promise<OwnedBusiness[]> {
  const { data, error } = await db
    .from('businesses')
    .select('id, business_name, coupang_vendor_id, is_default')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('business_name', { ascending: true })
  if (error) throw new Error(`사업장 조회 실패: ${error.message}`)
  return (data ?? []).map((r) => {
    const row = r as BusinessRow
    return {
      id: row.id,
      name: row.business_name ?? '(이름 없음)',
      coupangVendorId: row.coupang_vendor_id,
      isDefault: row.is_default ?? false,
    }
  })
}
