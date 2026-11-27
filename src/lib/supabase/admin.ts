import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * 서버 전용 Supabase Admin 클라이언트 (service_role key)
 * RLS를 우회하여 INSERT/UPDATE/DELETE 수행
 * API 라우트에서만 사용 — 절대 클라이언트에 노출 금지
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다. .env.local에 추가하세요.'
    )
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
