// /api/registration/pdp/[jobId]/detail-images — 편집기에서 구운 상세 이미지(U1) 저장.
// POST { action: 'prepare', sections: number[], full: number[], fullTypes?: ('image/jpeg'|'image/webp')[] }  (파일별 바이트 수)
//   → 잡 폴더 서명 업로드 URL 발급. 브라우저가 스토리지로 직접 올린다(Vercel 본문 한도 4.5MB 회피).
//     fullTypes는 GIF 칸이 섞일 때만 온다(세션 B ③ P4) — 그 번호의 전체 이미지는 full-NN.webp(움직이는 WebP)다. 없으면 모두 JPEG(지금 그대로).
// POST { action: 'commit', runId, sections: string[], full: string[] }  (공개 URL, 순서대로)
//   → 이 사용자·이 잡·이 run 폴더의 정해진 URL만 받고(임의 URL 주입 차단) 실제로 올라갔는지 확인한 뒤,
//     잡에 드래프트가 있으면 content.detailPageSections·detailPageFull을 교체한다. 없으면 건너뛴 사실을 응답에 적는다.
//     전체 이미지는 번호마다 .jpg(JPEG) 또는 .webp(WebP)만 받고, 실제 올라간 파일의 형식이 확장자와 같아야 한다.

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPdpJob } from '@/lib/registration/pdp-jobs'
import {
  DETAIL_PAGE_BUCKET,
  createDetailPageUploadUrl,
  detailPageFileName,
  detailPageFolder,
  detailPagePublicUrl,
  listDetailPageFiles,
  type DetailPageExt,
  type DetailPageKind,
} from '@/lib/registration/storage'
import {
  DETAIL_IMAGE_EXT,
  FILE_MAX_BYTES,
  MOTION_MAX_FULL_FILES,
  type DetailImageMime,
} from '@/lib/registration/editor/utils/exportUtils/detailImageLimits'
import { setDraftDetailPageImages } from '@/lib/sourcing/registration/drafts'

export const dynamic = 'force-dynamic'

const MAX_SECTION_FILES = 120
const MAX_FULL_FILES = 12
const RUN_ID_RE = /^[0-9a-z]{6,32}$/
const MIME_OF_EXT: Record<DetailPageExt, DetailImageMime> = { jpg: 'image/jpeg', webp: 'image/webp' }

type Body =
  | { action: 'prepare'; sections?: unknown; full?: unknown; fullTypes?: unknown }
  | { action: 'commit'; runId?: unknown; sections?: unknown; full?: unknown }

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

function isSizeList(value: unknown, max: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((n) => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= FILE_MAX_BYTES)
  )
}

function isUrlList(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((u) => typeof u === 'string')
}

const webpCount = (exts: readonly DetailPageExt[]) => exts.filter((e) => e === 'webp').length

/** 전체 이미지 형식 목록(GIF 칸이 섞일 때만) → 번호별 확장자. 없으면 모두 jpg, 틀리면 null */
function fullExtsOf(types: unknown, count: number): DetailPageExt[] | null {
  if (types === undefined) return Array.from({ length: count }, () => 'jpg')
  if (!Array.isArray(types) || types.length !== count) return null
  if (!types.every((t): t is DetailImageMime => typeof t === 'string' && Object.hasOwn(DETAIL_IMAGE_EXT, t))) return null
  const exts = types.map((t) => DETAIL_IMAGE_EXT[t])
  return webpCount(exts) <= MOTION_MAX_FULL_FILES ? exts : null
}

function newRunId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await requireOwner()
    const { jobId } = await params
    const db = createAdminClient()
    const job = await getPdpJob(db, userId, jobId)
    if (!job) return bad('잡을 찾을 수 없습니다.', 404)
    // 한 번 완료된 잡(final_html)은 편집기 재생성으로 images 단계에 돌아가 있어도 굽는다 — 굽기는 편집기 문서 캡처라 잡 단계와
    // 무관하고, 저장은 스토리지·드래프트에만 쓴다(pdp-image-regen-api, B 합의)
    if (job.current_step !== 'done' && !job.final_html) return bad('생성이 완료된 잡만 상세 이미지를 저장할 수 있습니다.', 409)

    const body = (await req.json().catch(() => null)) as Body | null
    if (body?.action === 'prepare') {
      if (!isSizeList(body.sections, MAX_SECTION_FILES) || !isSizeList(body.full, MAX_FULL_FILES)) {
        return bad(
          `파일 목록이 올바르지 않습니다(파일당 ${Math.round(FILE_MAX_BYTES / 1024 / 1024)}MB 이하, 섹션 ${MAX_SECTION_FILES}·전체 ${MAX_FULL_FILES}장 이하).`
        )
      }
      if (body.sections.length === 0 || body.full.length === 0)
        return bad('섹션 이미지와 전체 이미지가 모두 필요합니다.')
      const fullExts = fullExtsOf(body.fullTypes, body.full.length)
      if (!fullExts) {
        return bad(
          `전체 이미지 형식 목록이 올바르지 않습니다(전체 이미지와 같은 길이, JPEG·WebP만, WebP ${MOTION_MAX_FULL_FILES}장 이하).`
        )
      }
      const runId = newRunId()
      const folder = detailPageFolder(userId, jobId, runId)
      const issue = (kind: DetailPageKind, exts: readonly DetailPageExt[]) =>
        Promise.all(exts.map((ext, i) => createDetailPageUploadUrl(db, `${folder}/${detailPageFileName(kind, i, ext)}`)))
      const [sections, full] = await Promise.all([
        issue('section', Array.from({ length: body.sections.length }, () => 'jpg' as const)),
        issue('full', fullExts),
      ])
      return NextResponse.json({ runId, bucket: DETAIL_PAGE_BUCKET, sections, full })
    }

    if (body?.action === 'commit') {
      const { runId } = body
      if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) return bad('runId가 올바르지 않습니다.')
      if (!isUrlList(body.sections, MAX_SECTION_FILES) || !isUrlList(body.full, MAX_FULL_FILES)) {
        return bad('URL 목록이 올바르지 않습니다.')
      }
      if (body.sections.length === 0 || body.full.length === 0)
        return bad('섹션 이미지와 전체 이미지가 모두 필요합니다.')
      const folder = detailPageFolder(userId, jobId, runId)
      // 순서까지 정해진 URL만 받는다 — 다른 사용자·잡·run 폴더나 외부 URL은 여기서 막힌다
      const expected = (kind: DetailPageKind, i: number, ext: DetailPageExt = 'jpg') =>
        detailPagePublicUrl(db, `${folder}/${detailPageFileName(kind, i, ext)}`)
      const sections = body.sections as string[]
      const full = body.full as string[]
      // 전체 이미지는 번호마다 .jpg 또는 GIF 칸의 .webp
      const fullExts = full.map((u, i) => (['jpg', 'webp'] as const).find((ext) => u === expected('full', i, ext)))
      if (sections.some((u, i) => u !== expected('section', i)) || fullExts.some((ext) => ext === undefined)) {
        return bad('이 잡 폴더의 상세 이미지 URL만 저장할 수 있습니다.')
      }
      const exts = fullExts as DetailPageExt[]
      if (webpCount(exts) > MOTION_MAX_FULL_FILES) return bad(`움직이는 WebP는 ${MOTION_MAX_FULL_FILES}장까지 저장할 수 있습니다.`)
      const uploaded = await listDetailPageFiles(db, folder)
      const files = [
        ...sections.map((_, i) => ({ name: detailPageFileName('section', i), mime: MIME_OF_EXT.jpg })),
        ...exts.map((ext, i) => ({ name: detailPageFileName('full', i, ext), mime: MIME_OF_EXT[ext] })),
      ]
      const missing = files.filter((f) => !uploaded.has(f.name)).map((f) => f.name)
      if (missing.length > 0) return bad(`업로드되지 않은 파일이 있습니다: ${missing.slice(0, 5).join(', ')}`, 409)
      // 서명 URL에는 크기 제한이 없어 prepare 때 신고한 크기만 믿을 수 없다 — 실제 올라간 파일의 크기·형식을 본다
      const invalid = files
        .filter((f) => {
          const file = uploaded.get(f.name)!
          return file.size === null || file.size > FILE_MAX_BYTES || file.mimetype !== f.mime
        })
        .map((f) => f.name)
      if (invalid.length > 0) {
        return bad(
          `크기(${Math.round(FILE_MAX_BYTES / 1024 / 1024)}MB 이하)·형식(JPEG${webpCount(exts) > 0 ? ', 움직임 칸은 WebP' : ''})이 맞지 않는 파일이 있습니다: ${invalid.slice(0, 5).join(', ')}`
        )
      }

      if (!job.draft_id) {
        return NextResponse.json({
          sections,
          full,
          draftUpdated: false,
          note: '이 잡에 연결된 등록 드래프트가 없어 드래프트 반영을 건너뛰었습니다(업로드·다운로드는 완료).',
        })
      }
      const updated = await setDraftDetailPageImages(db, userId, job.draft_id, { sections, full })
      return NextResponse.json({
        sections,
        full,
        draftUpdated: updated,
        note: updated ? null : '연결된 드래프트를 찾지 못해 드래프트 반영을 건너뛰었습니다.',
      })
    }

    return bad("action은 'prepare' 또는 'commit'이어야 합니다.")
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration pdp detail-images error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
