// /api/registration/editor/upload — 에디터 내 사용자 이미지 업로드(POST multipart {file}).
// NEXFIT signed-url 2단계 흐름을 서버 직접 업로드로 대체(editorApi.ts 주석 참조).

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { uploadEditorImage } from '@/lib/registration/storage'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 8 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])

export async function POST(req: NextRequest) {
  try {
    const userId = await requireOwner()
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file 필드가 필요합니다.' }, { status: 400 })
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: `지원하지 않는 이미지 형식입니다: ${file.type}` }, { status: 415 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: '이미지는 8MB 이하만 업로드할 수 있습니다.' }, { status: 413 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const url = await uploadEditorImage(createAdminClient(), userId, buffer, file.type)
    return NextResponse.json({ url })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration editor upload error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
