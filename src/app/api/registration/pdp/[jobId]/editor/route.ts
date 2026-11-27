// /api/registration/pdp/[jobId]/editor — Canvas 에디터 문서 GET(조립)/PUT(UPSERT).
// GET 응답은 NEXFIT EditorDataResponse 계약(editorApi.ts) — 클라이언트(buildEditorDocument)를
// 무변경으로 두기 위해 서버가 잡 JSONB(copy_sections.final·section_images·section_plan·spec_sheet)를
// 그 계약대로 조립한다. 이미지 키 변환은 파이프라인 SSOT toGeneratedImagesMap 재사용.

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPdpJob } from '@/lib/registration/pdp-jobs'
import { assembleEditorDataResponse, getEditorData, upsertEditorData } from '@/lib/registration/editor-data'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await requireOwner()
    const { jobId } = await params
    const db = createAdminClient()
    const job = await getPdpJob(db, userId, jobId)
    if (!job) return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 })
    if (job.current_step !== 'done' || !job.copy_sections?.final) {
      return NextResponse.json(
        { error: '생성이 완료된 잡만 에디터로 열 수 있습니다.' },
        { status: 409 }
      )
    }

    const row = await getEditorData(db, userId, jobId)
    return NextResponse.json(assembleEditorDataResponse(job, row))
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration pdp editor GET error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await requireOwner()
    const { jobId } = await params
    const db = createAdminClient()
    const job = await getPdpJob(db, userId, jobId)
    if (!job) return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 })

    const body = (await req.json().catch(() => null)) as {
      sections_data?: unknown
      layout_assignments?: unknown
    } | null
    if (!body || !Array.isArray(body.sections_data)) {
      return NextResponse.json({ error: 'sections_data 배열이 필요합니다.' }, { status: 400 })
    }
    // 자동저장(useAutoSave)이 빈 문서를 걸러 보내지만, 라우트에서도 방어한다 —
    // 빈 배열 저장은 기존 편집본을 통째로 지우는 파괴적 쓰기라 거부.
    if (body.sections_data.length === 0) {
      return NextResponse.json({ error: '빈 문서는 저장할 수 없습니다.' }, { status: 400 })
    }
    const layoutAssignments =
      body.layout_assignments && typeof body.layout_assignments === 'object' && !Array.isArray(body.layout_assignments)
        ? (body.layout_assignments as Record<string, string>)
        : {}

    const { updated_at } = await upsertEditorData(db, userId, jobId, {
      sections_data: body.sections_data,
      layout_assignments: layoutAssignments,
    })
    return NextResponse.json({ success: true, updated_at })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration pdp editor PUT error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
