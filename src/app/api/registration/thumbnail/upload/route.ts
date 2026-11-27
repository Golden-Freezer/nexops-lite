// POST /api/registration/thumbnail/upload — 참조 이미지 수동 업로드
// FormData 'file' → sourcing-product-images(public) {userId}/registration/uploads/ 저장 → public URL.
// 잡 생성(POST /api/registration/thumbnail)의 sourceImages 입력으로 쓴다.

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'

const BUCKET = 'sourcing-product-images'
const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const userId = await requireOwner()
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '파일이 필요합니다.' }, { status: 400 })
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: '파일 크기 초과 (최대 5MB)' }, { status: 400 })
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'PNG/JPG/WEBP만 허용됩니다.' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png'
    const path = `${userId}/registration/uploads/${Date.now()}-${randomUUID()}.${ext}`
    const bytes = Buffer.from(await file.arrayBuffer())
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: file.type, upsert: false })
    if (error) throw new Error(`업로드 실패: ${error.message}`)

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
    return NextResponse.json({ data: { url: pub.publicUrl } })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration thumbnail upload POST error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
