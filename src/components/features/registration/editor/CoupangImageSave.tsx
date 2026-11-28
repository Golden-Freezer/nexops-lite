'use client'

/**
 * 상세 이미지 굽기·저장(U1, docs/plans/pdp-enrichment/02_TASK_CONTRACTS.md U1) — 편집기 렌더를 JPEG로 구워
 * 잡 폴더 스토리지에 올리고(서명 URL 직접 업로드), 드래프트가 있으면 새 필드에 반영한다. 다운로드(수동 경로)는 업로드와 무관하게 쓸 수 있다.
 * 진행·결과 상태는 컴포넌트 밖(모듈)에 둔다 — 내보내기 메뉴가 닫혀 컴포넌트가 사라져도 굽기·업로드는 이어지고, 다시 열면 결과를 보여준다.
 * GIF 칸(세션 B ③ P4)이 있는 잡은 전체 이미지 목록에 움직이는 WebP가 섞인다 — 파일마다 형식(contentType·확장자)을 따로 쓴다.
 */

import { useState, useSyncExternalStore } from 'react'
import { Download, ImageDown, Loader2 } from 'lucide-react'
import {
  useEditorStore,
  selectSections,
  selectDocument,
  selectDerivativePreview,
} from '@/lib/registration/editor/stores/editorStore'
import {
  bakeDetailImages,
  detailFileName,
  extOfPart,
  safeProductName,
  type BakeResult,
} from '@/lib/registration/editor/utils/exportUtils/bakeDetailImages'
import {
  buildWingDetailHtml,
  visibleWingHtmlNote,
  type WingHtmlNote,
} from '@/lib/registration/editor/utils/exportUtils/wingDetailHtml'
import { buildUploadPack, requestOpaqueWebp } from '@/lib/registration/editor/utils/exportUtils/uploadPack'
import { WingHtmlActions } from './WingHtmlActions'
import { pdpApi } from '@/lib/registration/pdp-client'
import { createClient } from '@/lib/supabase/client'

interface UploadTicket {
  path: string
  token: string
  publicUrl: string
}

interface PrepareResponse {
  runId: string
  bucket: string
  sections: UploadTicket[]
  full: UploadTicket[]
}

interface CommitResponse {
  draftUpdated: boolean
  note: string | null
}

type Phase = 'idle' | 'baking' | 'uploading' | 'done' | 'error'

interface SaveState {
  jobId: string | null
  phase: Phase
  progress: number
  result: BakeResult | null
  message: string | null
  /**
   * 저장(commit)까지 끝난 전체 이미지 공개 주소 — Wing 용 HTML 의 재료. 저장 전·실패면 null.
   * done 때 한 번만 넣는다 — 안내 글(visibleWingHtmlNote)이 이 배열의 참조로 같은 결과인지 가리므로,
   * 다른 setSaveState 패치가 fullUrls 배열을 다시 만들면(같은 주소라도) 복사 안내 글이 사라진다.
   */
  fullUrls: string[] | null
}

const IDLE: SaveState = { jobId: null, phase: 'idle', progress: 0, result: null, message: null, fullUrls: null }
let saveState: SaveState = IDLE
const listeners = new Set<() => void>()

function setSaveState(patch: Partial<SaveState>) {
  saveState = { ...saveState, ...patch }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSaveState = () => saveState

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function zipOf(files: Array<{ name: string; blob: Blob }>): Promise<Blob> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  for (const f of files) zip.file(f.name, f.blob)
  return zip.generateAsync({ type: 'blob' })
}

export default function CoupangImageSave() {
  const sections = useEditorStore(selectSections)
  const doc = useEditorStore(selectDocument)
  const derivativePreview = useEditorStore(selectDerivativePreview)
  const stored = useSyncExternalStore(subscribe, getSaveState, getSaveState)
  // 다른 잡의 편집기에서 열면 이전 결과를 보이지 않는다(진행 중인 것은 그 잡 것이라 버튼만 막는다)
  const { phase, progress, result, message } = stored.jobId === doc?.pdpId ? stored : IDLE
  const busy = saveState.phase === 'baking' || saveState.phase === 'uploading'
  const masterOnly = derivativePreview !== 'master'

  const product = safeProductName(doc?.meta.productName)

  async function upload(baked: BakeResult, jobId: string): Promise<CommitResponse & { fullUrls: string[] }> {
    const motionMixed = baked.full.some((p) => p.mime !== 'image/jpeg')
    const prepared = await pdpApi<PrepareResponse>(`/api/registration/pdp/${jobId}/detail-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'prepare',
        sections: baked.sections.map((s) => s.blob.size),
        full: baked.full.map((s) => s.blob.size),
        // GIF 칸이 섞일 때만 형식 목록을 보낸다 — 없으면 요청이 지금과 같다(모두 JPEG)
        ...(motionMixed ? { fullTypes: baked.full.map((p) => p.mime) } : {}),
      }),
    })
    const storage = createClient().storage.from(prepared.bucket)
    const jobs = [
      ...baked.sections.map((s, i) => ({ blob: s.blob, contentType: 'image/jpeg', ticket: prepared.sections[i] })),
      ...baked.full.map((s, i) => ({ blob: s.blob, contentType: s.mime, ticket: prepared.full[i] })),
    ]
    for (let i = 0; i < jobs.length; i++) {
      const { blob, contentType, ticket } = jobs[i]
      const { error } = await storage.uploadToSignedUrl(ticket.path, ticket.token, blob, { contentType })
      if (error) throw new Error(`업로드 실패(${ticket.path.split('/').pop()}): ${error.message}`)
      setSaveState({ progress: Math.round(((i + 1) / jobs.length) * 100) })
    }
    const fullUrls = prepared.full.map((t) => t.publicUrl)
    const committed = await pdpApi<CommitResponse>(`/api/registration/pdp/${jobId}/detail-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'commit',
        runId: prepared.runId,
        sections: prepared.sections.map((t) => t.publicUrl),
        full: fullUrls,
      }),
    })
    return { ...committed, fullUrls }
  }

  async function handleBake() {
    if (busy || !doc || masterOnly) return
    const jobId = doc.pdpId
    const canvasEl = document.querySelector<HTMLElement>('[data-canvas-content]')
    if (!canvasEl) {
      setSaveState({ ...IDLE, jobId, phase: 'error', message: '캔버스 요소를 찾을 수 없습니다.' })
      return
    }
    setSaveState({ ...IDLE, jobId, phase: 'baking' })
    try {
      const baked = await bakeDetailImages(canvasEl, sections, (pct) => setSaveState({ progress: pct }), {
        motionClips: doc.sourceData.motionClips,
        // 사진 위 글로 막힌 움직이는 칸은 서버가 글을 구운 WebP로(첫 칸 글 굽기) — 못 구우면 지금처럼 포스터 JPEG
        motionBakeJobId: jobId,
      })
      setSaveState({ result: baked, phase: 'uploading', progress: 0 })
      const committed = await upload(baked, jobId)
      setSaveState({
        phase: 'done',
        fullUrls: committed.fullUrls,
        message: committed.draftUpdated
          ? '저장하고 등록 드래프트에 반영했습니다.'
          : (committed.note ?? '저장했습니다.'),
      })
    } catch (err) {
      console.error('[CoupangImageSave] 굽기·저장 오류:', err)
      setSaveState({
        phase: 'error',
        message: `${err instanceof Error ? err.message : '굽기·저장에 실패했습니다.'} 다운로드는 구운 이미지가 있으면 쓸 수 있습니다.`,
      })
    }
  }

  async function downloadFull() {
    if (!result) return
    if (result.full.length === 1)
      return download(result.full[0].blob, detailFileName(product, 'full', 0, 1, extOfPart(result.full[0])))
    const files = result.full.map((f, i) => ({
      name: detailFileName(product, 'full', i, result.full.length, extOfPart(f)),
      blob: f.blob,
    }))
    if (result.preview) files.push({ name: detailFileName(product, 'full-preview', 0, 1), blob: result.preview })
    download(await zipOf(files), `${product}-detail-full.zip`)
  }

  // 업로드 준비 묶음(AX-CT-37) — 01.jpg·02.webp… 이름, 투명도 없는 움직이는 WebP, '올리는 법.txt'. 미리보기는 넣지 않는다
  const [pack, setPack] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null })

  async function downloadUploadPack() {
    const jobId = doc?.pdpId
    if (!result || !jobId) return
    setPack({ busy: true, note: null })
    try {
      const built = await buildUploadPack(result.full, doc?.meta.productName?.trim() || product, {
        opaque: (blob) => requestOpaqueWebp(jobId, blob),
        zip: zipOf,
      })
      download(built.zip, `${product}-wing-upload.zip`)
      const done = `업로드 준비 묶음 ${built.files.length}장(${built.files.join(' → ')}) + 올리는 법.txt — 이 순서대로 '이미지 업로드'로 올리세요.`
      setPack({ busy: false, note: built.notes.length > 0 ? `${done} 알림: ${built.notes.join(' · ')}` : done })
    } catch (err) {
      setPack({ busy: false, note: err instanceof Error ? err.message : '묶음을 만들지 못했습니다.' })
    }
  }

  async function downloadSections() {
    if (!result) return
    const files = result.sections.map((s, i) => ({
      name: detailFileName(product, 'section', i, result.sections.length),
      blob: s.blob,
    }))
    download(await zipOf(files), `${product}-sections.zip`)
  }

  // Wing 용 HTML — 저장까지 끝난 공개 주소로만 만든다(구운 Blob 은 쿠팡이 받아 갈 주소가 없다)
  const fullUrls = phase === 'done' ? stored.fullUrls : null
  // 안내 글은 만든 저장 결과(주소 목록)와 함께 든다 — 다시 굽기로 run 이 바뀌면 옛 글은 안 보인다(검수 S1)
  const [htmlNote, setHtmlNote] = useState<WingHtmlNote | null>(null)
  const visibleNote = visibleWingHtmlNote(htmlNote, fullUrls)

  function wingHtml(urls: string[]): string | null {
    try {
      return buildWingDetailHtml(urls, doc?.meta.productName)
    } catch (err) {
      setHtmlNote({ forUrls: urls, text: err instanceof Error ? err.message : 'HTML 을 만들지 못했습니다.' })
      return null
    }
  }

  async function copyWingHtml() {
    const urls = fullUrls
    const html = urls && wingHtml(urls)
    if (!urls || !html) return
    try {
      await navigator.clipboard.writeText(html)
      setHtmlNote({ forUrls: urls, text: 'Wing 용 HTML 을 복사했습니다. 상세설명 에디터의 HTML 코드 입력 칸에 붙여 넣으세요.' })
    } catch {
      setHtmlNote({ forUrls: urls, text: '복사가 막혔습니다. HTML 내려받기를 쓰세요.' })
    }
  }

  function downloadWingHtml() {
    const html = fullUrls && wingHtml(fullUrls)
    if (!html) return
    download(new Blob([html], { type: 'text/html;charset=utf-8' }), `${product}-wing-detail.html`)
  }

  const fullBytes = result?.full.reduce((sum, f) => sum + f.blob.size, 0) ?? 0
  const sectionBytes = result?.sections.reduce((sum, s) => sum + s.blob.size, 0) ?? 0
  const motionCount = result?.full.filter((f) => f.mime === 'image/webp').length ?? 0

  return (
    <div className="border-t border-[var(--border-subtle)] px-4 py-3">
      <div className="text-[10px] font-semibold text-[var(--text-disabled)] uppercase tracking-wider mb-2">
        쿠팡 상세 이미지
      </div>
      <button
        onClick={handleBake}
        disabled={busy || !doc || masterOnly}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-[var(--editor-brand)] text-white disabled:opacity-40"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <ImageDown size={14} />}
        {phase === 'baking'
          ? `굽는 중 ${progress}%`
          : phase === 'uploading'
            ? `저장 중 ${progress}%`
            : '상세 이미지 굽기·저장'}
      </button>
      <p className="text-xs text-[var(--text-disabled)] mt-1.5">
        편집기 화면 그대로 섹션별 이미지와 상품등록용 전체 이미지(780px)를 만듭니다. 고친 뒤 다시 누르면 목록을 새로
        바꿉니다. 메뉴를 닫아도 계속 진행됩니다.
      </p>
      {masterOnly && (
        <p className="text-xs text-amber-700 mt-1">
          파생본 미리보기 중에는 굽지 않습니다. 원본(마스터) 보기로 돌아가서 누르세요.
        </p>
      )}

      {result && (
        <div className="mt-2 text-xs text-[var(--text-primary)] space-y-1">
          <div>
            전체 이미지 {result.full.length}장({mb(fullBytes)}, 높이 {result.totalHeight.toLocaleString()}px) · 섹션
            이미지 {result.sections.length}장({mb(sectionBytes)})
          </div>
          {result.full.length > 1 && motionCount === 0 && (
            <div className="text-amber-700">
              전체 이미지가 길어 {result.full.length}조각으로 나눴습니다. 쿠팡에서 간격 없이 이어 붙어 한 장처럼
              보입니다(IMAGE_NO_SPACE).
            </div>
          )}
          {motionCount > 0 && (
            <div className="text-amber-700">
              움직이는 칸 {motionCount}개를 WebP로 끼워 전체 이미지를 {result.full.length}장으로 나눴습니다. 쿠팡
              상세설명에 &apos;이미지 업로드&apos; 방식으로 순서대로 올리면 간격 없이 이어 붙고 그 칸만
              움직입니다(IMAGE_NO_SPACE). 편집기 화면은 첫 장면(포스터)입니다.
            </div>
          )}
          {result.motionNotes.length > 0 && (
            <div className="text-[var(--text-disabled)]">
              움직이는 칸 중 정지 그림으로 넣은 곳: {result.motionNotes.join(' · ')}
            </div>
          )}
          {result.previewSkipReason && <div className="text-[var(--text-disabled)]">{result.previewSkipReason}</div>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={downloadFull}
              className="flex items-center gap-1 px-2 py-1 rounded border border-[var(--border-default)] hover:bg-[var(--hover-overlay)]"
            >
              <Download size={12} />{' '}
              {result.full.length > 1 ? '전체 조각 ZIP' : extOfPart(result.full[0]) === 'webp' ? '전체 WebP' : '전체 JPEG'}
            </button>
            <button
              onClick={downloadUploadPack}
              disabled={pack.busy}
              className="flex items-center gap-1 px-2 py-1 rounded border border-[var(--editor-brand)] text-[var(--editor-brand)] hover:bg-[var(--hover-overlay)] disabled:opacity-40"
            >
              {pack.busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} 업로드 준비 묶음
            </button>
            <button
              onClick={downloadSections}
              className="flex items-center gap-1 px-2 py-1 rounded border border-[var(--border-default)] hover:bg-[var(--hover-overlay)]"
            >
              <Download size={12} /> 섹션 ZIP
            </button>
          </div>
          {pack.note && <div className="text-[var(--text-disabled)]">{pack.note}</div>}
          {fullUrls && (
            <WingHtmlActions
              motionCount={motionCount}
              note={visibleNote}
              onCopy={copyWingHtml}
              onDownload={downloadWingHtml}
            />
          )}
        </div>
      )}
      {message && (
        <div className={`mt-2 text-xs ${phase === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>{message}</div>
      )}
    </div>
  )
}
