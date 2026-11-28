// /api/registration/editor/images — 편집기 '내 이미지' 보관함 목록(GET, 묶음 5 ②). DDL 없이 스토리지 목록만 읽는다.
//   ?scope=uploads            편집기에서 올린 이미지({userId}/registration/editor-uploads)
//   ?scope=job&jobId=<uuid>   그 잡의 생성 컷·썸네일({userId}/registration/{jobId}) — 잡 소유(user_id)를 먼저 확인한다
//   &offset=0&limit=40        최근 것부터. 다음 쪽 offset은 앞 응답의 nextOffset(건너뛴 폴더·비이미지 포함 위치)
// 폴더는 서버가 받은 userId로만 만든다 — 클라이언트는 경로를 넘기지 못한다.

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPdpJob } from '@/lib/registration/pdp-jobs'
import { libraryFolder, listLibraryImages, type LibraryScope } from '@/lib/registration/storage'

export const dynamic = 'force-dynamic'

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_LIMIT = 40
const MAX_LIMIT = 100

function intParam(value: string | null, fallback: number, min: number, max: number): number | null {
  if (value === null || value === '') return fallback
  if (!/^\d+$/.test(value)) return null
  const n = Number(value)
  return n < min || n > max ? null : n
}

export async function GET(req: NextRequest) {
  try {
    const userId = await requireOwner()
    const params = req.nextUrl.searchParams
    const scopeParam = params.get('scope') ?? 'uploads'
    if (scopeParam !== 'uploads' && scopeParam !== 'job') {
      return NextResponse.json({ error: 'scope는 uploads 또는 job입니다.' }, { status: 400 })
    }
    const scope: LibraryScope = scopeParam
    const offset = intParam(params.get('offset'), 0, 0, 10_000)
    const limit = intParam(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT)
    if (offset === null || limit === null) {
      return NextResponse.json({ error: `offset은 0 이상, limit은 1~${MAX_LIMIT}입니다.` }, { status: 400 })
    }

    const db = createAdminClient()
    let jobId: string | undefined
    if (scope === 'job') {
      jobId = params.get('jobId') ?? ''
      if (!JOB_ID.test(jobId)) return NextResponse.json({ error: 'jobId가 올바르지 않습니다.' }, { status: 400 })
      const job = await getPdpJob(db, userId, jobId)
      if (!job) return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 })
    }

    const result = await listLibraryImages(db, scope, libraryFolder(userId, scope, jobId), { offset, limit })
    return NextResponse.json(result)
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration editor images GET error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
