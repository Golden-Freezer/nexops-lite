import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * 첫 1명만 가입시킨다. 확인 메일 없이 바로 로그인할 수 있게 admin API로 만든다.
 * 이미 사용자가 있으면 403.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string }
  const email = String(body.email ?? '').trim()
  const password = String(body.password ?? '')
  if (!email.includes('@') || password.length < 8) {
    return NextResponse.json({ error: '이메일과 8자 이상 비밀번호를 넣어 주세요.' }, { status: 400 })
  }
  const admin = createAdminClient()
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 })
  if (listError) return NextResponse.json({ error: `확인 실패: ${listError.message}` }, { status: 500 })
  if ((list.users?.length ?? 0) > 0) {
    return NextResponse.json({ error: '이미 가입한 대표님이 있습니다. 로그인해 주세요.' }, { status: 403 })
  }
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) return NextResponse.json({ error: `가입 실패: ${error.message}` }, { status: 500 })
  return NextResponse.json({ ok: true })
}
