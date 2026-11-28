'use client'

/**
 * 대표이미지 스튜디오 — 업로드/드래프트 프리로드 → 모델·품질 선택 → 잡 생성 → run 드라이버.
 * 브라우저가 드라이버다(§6.3): run 응답이 done/failed가 될 때까지 순차 재호출하고,
 * 탭을 닫았다 열면 ?jobId= 로 이어서 재개할 수 있다(서버 상주 프로세스 없음).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, Play, X } from 'lucide-react'
import { IMAGE_MODELS, type ImageModel, type ImageQuality } from '@/lib/agents/image/types'
import {
  THUMBNAIL_CATEGORIES,
  THUMBNAIL_CATEGORY_LABELS,
  type ThumbnailCut,
  type ThumbnailJob,
} from '@/lib/registration/thumbnail-types'
import { draftSourceImageUrls, type DraftSourceContent } from '@/lib/sourcing/registration/draft-source-images'
import { ImageModelSelect } from './ImageModelSelect'
import { ThumbnailResults } from './ThumbnailResults'

const STATUS_LABELS: Record<string, string> = {
  pending: '대기',
  analyzing: '제품 분석 중',
  generating: '3컷 생성 중',
  gating: '동일성 게이트 판정 중',
  done: '완료',
  failed: '실패',
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || `요청 실패(${res.status})`)
  return json.data as T
}

export function ThumbnailStudio({
  draftId,
  resumeJobId,
  initialName,
}: {
  draftId?: string
  resumeJobId?: string
  /** 작명 결과에서 넘어온 상품명(?name=) — 초안이 없을 때 상품명 칸 기본값 */
  initialName?: string
}) {
  // 연결된 등록 초안 — ?draftId= 또는 재개한 잡의 draftId. 새 잡도 같은 초안에 묶여 초안 사업장을 물려받고
  // 채택 컷이 초안 대표이미지로 들어간다(서버 resolveJobDraftLink).
  const [linkedDraftId, setLinkedDraftId] = useState<string | undefined>(draftId)
  const [sourceUrls, setSourceUrls] = useState<string[]>([])
  const [productName, setProductName] = useState(initialName ?? '')
  const [categoryHint, setCategoryHint] = useState('')
  const [model, setModel] = useState<ImageModel>(IMAGE_MODELS[0].id)
  const [quality, setQuality] = useState<ImageQuality>('medium')
  const [uploading, setUploading] = useState(false)
  const [running, setRunning] = useState(false)
  const [adopting, setAdopting] = useState(false)
  const [job, setJob] = useState<ThumbnailJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // 최근 잡의 모델·품질을 기본값으로 (결정 E — 별도 설정 테이블 없이 최근 잡 사용)
  useEffect(() => {
    api<ThumbnailJob[]>('/api/registration/thumbnail')
      .then((jobs) => {
        if (!aliveRef.current || jobs.length === 0) return
        setModel(jobs[0].imageModel)
        setQuality(jobs[0].imageQuality === 'high' ? 'high' : 'medium')
      })
      .catch(() => {}) // 기본값 유지 — 프리셀렉트 실패는 치명적이지 않음
  }, [])

  // 드래프트 프리로드 — 상품명·기존 이미지(원본 대표 사진 먼저, 생성 컷·채택 썸네일은 빼고 — 결정 카드 c01)
  useEffect(() => {
    if (!draftId) return
    api<{
      form: { productName?: string; content?: DraftSourceContent }
    }>(`/api/sourcing/registration-drafts/${draftId}`)
      .then((draft) => {
        if (!aliveRef.current) return
        if (draft.form.productName) setProductName(draft.form.productName)
        const images = draftSourceImageUrls(draft.form.content)
        if (images.length > 0) setSourceUrls(images.slice(0, 3))
      })
      .catch((e) => setError(e instanceof Error ? e.message : '드래프트 로드 실패'))
  }, [draftId])

  // run 드라이버 — done/failed까지 순차 호출 (2초 간격은 불필요: run 자체가 스텝 완료까지 대기)
  const drive = useCallback(async (jobId: string) => {
    setRunning(true)
    setError(null)
    try {
      // 무한 루프 방지 상한: 최악 경로(생성 재시도 2 + 게이트 재생성·재판정 라운드 포함) 최대 12스텝 + 여유
      for (let i = 0; i < 15 && aliveRef.current; i++) {
        const updated = await api<ThumbnailJob>(`/api/registration/thumbnail/${jobId}/run`, {
          method: 'POST',
        })
        if (!aliveRef.current) return
        setJob(updated)
        if (updated.status === 'done' || updated.status === 'failed') return
      }
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : '실행 실패')
    } finally {
      if (aliveRef.current) setRunning(false)
    }
  }, [])

  // 재개 모드 — 히스토리에서 진입 (?jobId=)
  useEffect(() => {
    if (!resumeJobId) return
    api<ThumbnailJob>(`/api/registration/thumbnail/${resumeJobId}`)
      .then((loaded) => {
        if (!aliveRef.current) return
        setJob(loaded)
        if (loaded.draftId) setLinkedDraftId(loaded.draftId)
        setModel(loaded.imageModel)
        setQuality(loaded.imageQuality === 'high' ? 'high' : 'medium')
        if (loaded.productName) setProductName(loaded.productName)
        setSourceUrls(loaded.sourceImages)
        if (loaded.status !== 'done' && loaded.status !== 'failed') void drive(loaded.id)
      })
      .catch((e) => setError(e instanceof Error ? e.message : '잡 로드 실패'))
  }, [resumeJobId, drive])

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      for (const file of Array.from(files).slice(0, 3 - sourceUrls.length)) {
        const form = new FormData()
        form.append('file', file)
        const { url } = await api<{ url: string }>('/api/registration/thumbnail/upload', {
          method: 'POST',
          body: form,
        })
        if (!aliveRef.current) return
        setSourceUrls((prev) => (prev.length < 3 ? [...prev, url] : prev))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '업로드 실패')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
      if (aliveRef.current) setUploading(false)
    }
  }

  async function start() {
    setError(null)
    setJob(null)
    try {
      const { jobId } = await api<{ jobId: string }>('/api/registration/thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId: linkedDraftId,
          sourceImages: sourceUrls,
          productName: productName.trim() || undefined,
          categoryHint: categoryHint || undefined,
          imageModel: model,
          imageQuality: quality,
        }),
      })
      await drive(jobId)
    } catch (e) {
      setError(e instanceof Error ? e.message : '잡 생성 실패')
    }
  }

  async function adopt(cut: ThumbnailCut) {
    if (!job) return
    setAdopting(true)
    setError(null)
    try {
      const updated = await api<ThumbnailJob>(`/api/registration/thumbnail/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedCut: cut }),
      })
      if (aliveRef.current) setJob(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : '채택 실패')
    } finally {
      if (aliveRef.current) setAdopting(false)
    }
  }

  const showResults = job && (job.status === 'done' || job.status === 'failed') && Object.keys(job.cuts).length > 0

  return (
    <div className="space-y-4">
      {/* 입력 — 참조 이미지 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-sm font-semibold text-slate-700">참조 이미지 (1~3장)</div>
          {linkedDraftId && (
            <span className="text-[10px] border border-brand-200 bg-brand-50 text-brand-700 rounded-full px-1.5 py-0.5">
              등록 초안 연결 — 초안 사업장으로 생성, 채택 컷은 초안 대표이미지로
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {sourceUrls.map((url) => (
            <div key={url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="참조 이미지" className="w-20 h-20 rounded object-cover border border-slate-200" />
              <button
                onClick={() => setSourceUrls((prev) => prev.filter((u) => u !== url))}
                disabled={running}
                className="absolute -top-1.5 -right-1.5 bg-slate-600 text-white rounded-full p-0.5 hover:bg-slate-800 disabled:opacity-50"
                aria-label="이미지 제거"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {sourceUrls.length < 3 && (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading || running}
              className="w-20 h-20 rounded border border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 hover:border-brand-400 hover:text-brand-500 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              <span className="text-[10px] mt-1">업로드</span>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={(e) => uploadFiles(e.target.files)}
          />
        </div>
        <p className="text-[11px] text-slate-400">
          색상·디자인 변형이 있으면 전부 보이는 사진들로 올려주세요 — 참조에 없는 변형은 생성되지 않습니다.
        </p>
      </section>

      {/* 입력 — 상품 정보 + 모델 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            disabled={running}
            maxLength={200}
            placeholder="상품명 (선택 — 분석 힌트)"
            className="border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-brand-400 disabled:opacity-50"
          />
          <select
            value={categoryHint}
            onChange={(e) => setCategoryHint(e.target.value)}
            disabled={running}
            className="border border-slate-200 rounded px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-brand-400 disabled:opacity-50"
          >
            <option value="">카테고리 자동 감지</option>
            {THUMBNAIL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {THUMBNAIL_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <ImageModelSelect
          model={model}
          quality={quality}
          imageCount={3}
          disabled={running}
          onModelChange={setModel}
          onQualityChange={setQuality}
        />
        <button
          onClick={start}
          disabled={running || uploading || sourceUrls.length === 0}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 text-xs px-4 py-2 rounded-full bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          3컷 생성 시작
        </button>
      </section>

      {/* 진행 상태 */}
      {job && job.status !== 'done' && job.status !== 'failed' && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-500" />
            {STATUS_LABELS[job.status] ?? job.status} ({job.progress}%)
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-brand-500 transition-all" style={{ width: `${job.progress}%` }} />
          </div>
        </section>
      )}

      {/* 결과 */}
      {job?.status === 'failed' && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">
          생성 실패: {job.error ?? '알 수 없는 오류'}
        </div>
      )}
      {showResults && <ThumbnailResults job={job} adopting={adopting} onAdopt={adopt} />}
      {job?.status === 'done' && (
        <p className="text-[11px] text-slate-400">
          이번 잡 비용 ${job.costUsd.toFixed(3)} · 모델 {job.imageModel} ({job.imageQuality})
          {job.draftId && ' · 채택 시 등록 드래프트 대표이미지에 반영됩니다'}
        </p>
      )}
      {error && <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">{error}</div>}
    </div>
  )
}
