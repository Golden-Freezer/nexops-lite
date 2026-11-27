'use client'

/**
 * 상세페이지(PDP) spec_sheet 입력 폼 — 참조 이미지(드래프트 프리로드/업로드) → 상품 정보 →
 * Premium/Pro 모드 선택 → 이미지 모델·품질 → 잡 생성. 제출 성공 시 onCreated(jobId)로
 * 진행 화면 전환을 상위(page.tsx)에 위임한다(§6.3 run 드라이버는 PdpProgress 소관).
 */

import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, Play, X } from 'lucide-react'
import { IMAGE_MODELS, type ImageModel, type ImageQuality } from '@/lib/agents/image/types'
import {
  PDP_MAX_SOURCE_IMAGES,
  isGenerationTrack,
  type GenerationTrack,
  type PdpMode,
  type PdpSpecSheet,
} from '@/lib/registration/pdp-state'
import { pdpApi } from '@/lib/registration/pdp-client'
import { ImageModelSelect } from './ImageModelSelect'
import { PdpFormPro } from './PdpFormPro'
import { PdpFormProductInfo } from './PdpFormProductInfo'
import { SectionTitle } from './PdpFormFields'

// POST /api/registration/pdp의 검증 상한과 공유하는 SSOT — pdp-state.ts에서 임포트한다.
const MAX_SOURCE_IMAGES = PDP_MAX_SOURCE_IMAGES
// 실제 장수는 design 단계 섹션 수에 따라 달라진다 — 모델·품질 선택 시 예상 비용 감을 잡기 위한 근사치
const ESTIMATED_IMAGE_COUNT: Record<PdpMode, number> = { premium: 6, pro: 10 }
// 결정 T-1: 최근 잡의 트랙 선택을 다음 기본값으로(결정 E 패턴) — 에디터 localStorage 관례를 따른다
const TRACK_STORAGE_KEY = 'nexops-pdp-generation-track'

interface DraftLoad {
  businessId: string | null
  form: {
    productName?: string
    brand?: string
    content?: { heroImages?: string[]; detailImages?: string[] }
  }
}

export function PdpForm({ draftId, onCreated }: { draftId?: string; onCreated: (jobId: string) => void }) {
  const [mode, setMode] = useState<PdpMode>('pro')
  const [track, setTrack] = useState<GenerationTrack>('standard')
  const [spec, setSpec] = useState<PdpSpecSheet>({ productName: '' })
  const [categoryMode, setCategoryMode] = useState<'select' | 'custom'>('select')
  const [sourceUrls, setSourceUrls] = useState<string[]>([])
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [model, setModel] = useState<ImageModel>(IMAGE_MODELS[0].id)
  const [quality, setQuality] = useState<ImageQuality>('high') // 오너 지시(2026-08-10) — 단가 제한 해제로 기본 high
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // 최근 잡의 트랙 선택 복원 (SSR 불일치 방지를 위해 hydration 후 반영)
  useEffect(() => {
    const stored = localStorage.getItem(TRACK_STORAGE_KEY)
    if (isGenerationTrack(stored)) setTrack(stored)
  }, [])

  // 드래프트 프리로드 — 상품명·브랜드·기존 이미지 (ThumbnailStudio와 동일 원천/관례)
  useEffect(() => {
    if (!draftId) return
    fetch(`/api/sourcing/registration-drafts/${draftId}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || '드래프트 로드 실패')
        return json.data as DraftLoad
      })
      .then((draft) => {
        if (!aliveRef.current) return
        setBusinessId(draft.businessId)
        setSpec((s) => ({
          ...s,
          productName: draft.form.productName || s.productName,
          brandName: draft.form.brand || s.brandName,
        }))
        const images = [
          ...(draft.form.content?.heroImages ?? []),
          ...(draft.form.content?.detailImages ?? []),
        ].filter(Boolean)
        if (images.length > 0) setSourceUrls(images.slice(0, MAX_SOURCE_IMAGES))
      })
      .catch((e) => setError(e instanceof Error ? e.message : '드래프트 로드 실패'))
  }, [draftId])

  function updateSpec(patch: Partial<PdpSpecSheet>) {
    setSpec((s) => ({ ...s, ...patch }))
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      // 업로드 라우트는 범용 저장소 업로더라 대표이미지 전용이 아니다 — PDP 참조 이미지에도 그대로 재사용
      for (const file of Array.from(files).slice(0, MAX_SOURCE_IMAGES - sourceUrls.length)) {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch('/api/registration/thumbnail/upload', { method: 'POST', body: form })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || '업로드 실패')
        if (!aliveRef.current) return
        const url = (json.data as { url: string }).url
        setSourceUrls((prev) => (prev.length < MAX_SOURCE_IMAGES ? [...prev, url] : prev))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '업로드 실패')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
      if (aliveRef.current) setUploading(false)
    }
  }

  async function submit() {
    if (!spec.productName.trim()) {
      setError('상품명을 입력하세요.')
      return
    }
    if (sourceUrls.length === 0) {
      setError('참조 이미지를 최소 1장 등록하세요.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const { jobId } = await pdpApi<{ jobId: string }>('/api/registration/pdp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId,
          businessId: businessId ?? undefined,
          specSheet: { ...spec, productName: spec.productName.trim() },
          sourceImages: sourceUrls,
          imageModel: model,
          imageQuality: quality,
          mode,
          generationTrack: track,
        }),
      })
      try {
        localStorage.setItem(TRACK_STORAGE_KEY, track)
      } catch {
        // localStorage 불가 환경(시크릿 등)은 기본값 복원만 포기 — 잡 생성에는 영향 없음
      }
      onCreated(jobId)
    } catch (e) {
      setError(e instanceof Error ? e.message : '잡 생성 실패')
    } finally {
      if (aliveRef.current) setSubmitting(false)
    }
  }

  const busy = submitting

  return (
    <div className="space-y-4">
      {/* 참조 이미지 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-700">참조 이미지 (1~{MAX_SOURCE_IMAGES}장)</div>
        <div className="flex items-center gap-2 flex-wrap">
          {sourceUrls.map((url) => (
            <div key={url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="참조 이미지" className="w-20 h-20 rounded object-cover border border-slate-200" />
              <button
                onClick={() => setSourceUrls((prev) => prev.filter((u) => u !== url))}
                disabled={busy}
                className="absolute -top-1.5 -right-1.5 bg-slate-600 text-white rounded-full p-0.5 hover:bg-slate-800 disabled:opacity-50"
                aria-label="이미지 제거"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {sourceUrls.length < MAX_SOURCE_IMAGES && (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading || busy}
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
      </section>

      <PdpFormProductInfo
        spec={spec}
        onChange={updateSpec}
        categoryMode={categoryMode}
        onCategoryModeChange={setCategoryMode}
        disabled={busy}
      />

      {/* 모드 선택 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <SectionTitle>생성 모드</SectionTitle>
        <div className="flex items-center gap-2 flex-wrap">
          {(['pro', 'premium'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={busy}
              className={`text-xs px-4 py-1.5 rounded-full border disabled:opacity-50 ${
                mode === m ? 'bg-brand-500 border-brand-500 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {m === 'pro' ? 'Pro (3-Stage 카피, 기본)' : 'Premium (1-shot 카피)'}
            </button>
          ))}
        </div>
        {mode === 'pro' && <PdpFormPro spec={spec} onChange={updateSpec} disabled={busy} />}
      </section>

      {/* 생성 트랙 (결정 T-1) — standard ⟷ internalized 잡 단위 선택 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <SectionTitle>생성 트랙</SectionTitle>
        <div className="flex items-center gap-2 flex-wrap">
          {(['standard', 'internalized'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTrack(t)}
              disabled={busy}
              className={`text-xs px-4 py-1.5 rounded-full border disabled:opacity-50 ${
                track === t
                  ? t === 'internalized'
                    ? 'bg-emerald-500 border-emerald-500 text-white'
                    : 'bg-brand-500 border-brand-500 text-white'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t === 'standard' ? '표준 생성' : '실측 내재화 β'}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-400">
          실측 내재화 β는 베스트셀러 1,305건 실측(네이버 899·쿠팡 406)의 섹션 구성·디자인 기준으로 생성합니다. 같은
          상품으로 표준과 비교해보세요.
        </p>
      </section>

      {/* 이미지 모델·품질 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <SectionTitle>이미지 모델</SectionTitle>
        <ImageModelSelect
          model={model}
          quality={quality}
          imageCount={ESTIMATED_IMAGE_COUNT[mode]}
          disabled={busy}
          onModelChange={setModel}
          onQualityChange={setQuality}
        />
        <p className="text-[11px] text-slate-400">
          예상 장수는 섹션 수에 따른 근사치입니다 — 실제 생성 장수는 design 단계에서 확정됩니다.
        </p>
      </section>

      <button
        onClick={submit}
        disabled={busy}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 text-xs px-4 py-2 rounded-full bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
        상세페이지 생성 시작
      </button>
      {error && <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">{error}</div>}
    </div>
  )
}
