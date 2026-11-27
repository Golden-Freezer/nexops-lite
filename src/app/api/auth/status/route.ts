import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/** 첫 가입 여부만 알려 준다. 대표님 1명이 가입하면 그 뒤로는 가입 화면을 닫는다. */
export async function GET() {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 })
    if (error) throw error
    return NextResponse.json({ hasUser: (data.users?.length ?? 0) > 0, configured: true })
  } catch {
    return NextResponse.json({ hasUser: false, configured: false })
  }
}
