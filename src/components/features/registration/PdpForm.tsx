'use client'

/**
 * 상세페이지(PDP) spec_sheet 입력 폼 — 참조 이미지(드래프트 프리로드/업로드) → 상품 정보 →
 * Premium/Pro 모드 선택 → 이미지 모델·품질 → 잡 생성. 제출 성공 시 onCreated(jobId)로
 * 진행 화면 전환을 상위(page.tsx)에 위임한다(§6.3 run 드라이버는 PdpProgress 소관).
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { PDP_IMAGE_MODELS, type ImageModel, type ImageQuality } from '@/lib/agents/image/types'
import {
  PDP_MAX_SOURCE_IMAGES,
  isGenerationTrack,
  type GenerationTrack,
  type PdpMode,
  type PdpSpecSheet,
} from '@/lib/registration/pdp-state'
import { pdpApi } from '@/lib/registration/pdp-client'
import { applyDraftPrefill } from '@/lib/registration/pdp-input-assist'
import type { DraftPrefillSource } from '@/lib/registration/spec-inputs'
import type { ImageDimensions } from '@/lib/registration/reference-image-quality'
import { rolesForUrls, type SourcePhotoRole } from '@/lib/registration/source-photo-roles'
import type { PdpModelBatch } from '@/lib/registration/pdp-model-batch'
import { draftSourceImageUrls, type DraftSourceContent } from '@/lib/sourcing/registration/draft-source-images'
import { ImageModelSelect } from './ImageModelSelect'
import { PdpFormBatch } from './PdpFormBatch'
import { PdpFormPhotos } from './PdpFormPhotos'
import { PdpFormPro } from './PdpFormPro'
import { EMPTY_OWN_SALES, PdpOwnSales, ownSalesSpecFields, useOwnSalesBusinessId, type OwnSalesValue } from './PdpOwnSales'
import { PdpFormProductInfo } from './PdpFormProductInfo'
import { SectionTitle } from './PdpFormFields'
import { LOCAL_CODEX_NOTICE, useLocalCodexAvailable } from './LocalCodexNotice'

// POST /api/registration/pdp의 검증 상한과 공유하는 SSOT — pdp-state.ts에서 임포트한다.
const MAX_SOURCE_IMAGES = PDP_MAX_SOURCE_IMAGES
// 실제 장수는 design 단계 섹션 수에 따라 달라진다 — 모델·품질 선택 시 예상 비용 감을 잡기 위한 근사치
const ESTIMATED_IMAGE_COUNT: Record<PdpMode, number> = { premium: 6, pro: 10 }
// 결정 T-1: 최근 잡의 트랙 선택을 다음 기본값으로(결정 E 패턴) — 에디터 localStorage 관례를 따른다
const TRACK_STORAGE_KEY = 'nexops-pdp-generation-track'

interface DraftLoad {
  businessId: string | null
  // 등록 폼 — 상품명·브랜드·옵션·고시정보는 W2a draftToSpecPrefill이 spec 칸으로 옮긴다(W3)
  form: Partial<DraftPrefillSource> & {
    content?: DraftSourceContent
  }
}

export function PdpForm({
  draftId,
  initialName,
  showPhotoRoles = false,
  onCreated,
}: {
  draftId?: string
  /** 작명 결과에서 넘어온 상품명(?name=) — 초안이 있으면 초안 상품명이 우선 */
  initialName?: string
  /** 사진별 역할 칸(결정 카드 c12) — 스위치 photoroles 기본값 또는 미리보기 ?photoroles=1일 때만(page.tsx가 정한다) */
  showPhotoRoles?: boolean
  onCreated: (jobId: string) => void
}) {
  const [mode, setMode] = useState<PdpMode>('pro')
  // K4 운영 전환(오너 2026-11-06 '전환 PR 준비 승인') — 새 잡 기본은 내재화. 표준은 폼에서 고를 수 있다
  const [track, setTrack] = useState<GenerationTrack>('internalized')
  // 모델 배치(R03) — 켜기(R09, 오너 승인 2026-11-08 21:0x) 뒤 새 잡 기본은 새 배치. 지금 배치는 잡마다 고를 수 있다.
  // 새 배치는 서버가 이미지 모델도 새 배치 값으로 정한다. 서버는 값이 없으면 지금처럼 now(다른 호출 경로 호환)
  const [batch, setBatch] = useState<PdpModelBatch>('now')
  const [spec, setSpec] = useState<PdpSpecSheet>({ productName: initialName ?? '' })
  const [categoryMode, setCategoryMode] = useState<'select' | 'custom'>('select')
  const [sourceUrls, setSourceUrls] = useState<string[]>([])
  // 사진별 역할(원본이 아닌 사진만) — 역할 칸이 보일 때만 보낸다
  const [photoRoles, setPhotoRoles] = useState<SourcePhotoRole[]>([])
  const [businessId, setBusinessId] = useState<string | null>(null)
  // 우리 쿠팡 판매량(J51) — 초안 사업장, 없으면 상단 사업장에서 고른다. 고른 상품이 있으면 그 사업장으로 잡을 만든다
  const ownSalesBusinessId = useOwnSalesBusinessId(businessId)
  const [ownSales, setOwnSales] = useState<OwnSalesValue>(EMPTY_OWN_SALES)
  const [model, setModel] = useState<ImageModel>(PDP_IMAGE_MODELS[0].id)
  const [quality, setQuality] = useState<ImageQuality>('high') // 오너 지시(2026-08-10) — 단가 제한 해제로 기본 high
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 참조 사진 실해상도 — 미리보기 로드 시점에 URL별로 모은다(NEXFIT A-5). 경고만 하고 막지 않는다
  const [imageDims, setImageDims] = useState<Record<string, ImageDimensions>>({})
  const aliveRef = useRef(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const localCodexAvailable = useLocalCodexAvailable()

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

  // 드래프트 프리로드 — 상품명·브랜드·고시정보(소재·크기·무게·원산지·추가 스펙)·옵션(색상)·기존 이미지.
  // 빈 칸만 채우고 '(초안)' 표시(draftPrefill)를 단다 — 상품명은 초안이 이긴다(기존 규칙). 이미지는 ThumbnailStudio와 같은 원천
  // (원본 대표 사진 먼저, 생성 컷·채택 썸네일은 빼고 — 결정 카드 c01 draftSourceImageUrls)
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
        setSpec((s) => applyDraftPrefill(s, draft.form as DraftPrefillSource))
        const images = draftSourceImageUrls(draft.form.content)
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
    if (!localCodexAvailable) {
      setError(LOCAL_CODEX_NOTICE)
      return
    }
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
    const roles = showPhotoRoles ? rolesForUrls(photoRoles, sourceUrls) : []
    const sourcePhotoRolesField = roles.length > 0 ? { sourcePhotoRoles: roles } : {}
    const ownSalesFields = ownSalesSpecFields(ownSales)
    const jobBusinessId = businessId ?? (ownSalesFields.ownSalesProductIds ? ownSalesBusinessId : null)
    try {
      const { jobId } = await pdpApi<{ jobId: string }>('/api/registration/pdp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId,
          businessId: jobBusinessId ?? undefined,
          specSheet: { ...spec, productName: spec.productName.trim(), ...sourcePhotoRolesField, ...ownSalesFields },
          sourceImages: sourceUrls,
          imageModel: model,
          imageQuality: quality,
          mode,
          generationTrack: track,
          modelBatch: batch,
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

  function recordDims(url: string, width: number, height: number) {
    setImageDims((prev) =>
      prev[url]?.width === width && prev[url]?.height === height ? prev : { ...prev, [url]: { width, height } }
    )
  }

  return (
    <div className="space-y-4">
      {/* 참조 이미지 — 순서·대표·빼기·역할(결정 카드 c12) */}
      <PdpFormPhotos
        urls={sourceUrls}
        onUrlsChange={setSourceUrls}
        roles={photoRoles}
        onRolesChange={setPhotoRoles}
        showRoles={showPhotoRoles}
        imageDims={imageDims}
        onDims={recordDims}
        maxImages={MAX_SOURCE_IMAGES}
        uploading={uploading}
        busy={busy}
        fileRef={fileRef}
        onFiles={uploadFiles}
      />

      <PdpFormProductInfo
        spec={spec}
        onChange={updateSpec}
        categoryMode={categoryMode}
        onCategoryModeChange={setCategoryMode}
        disabled={busy}
      />

      <PdpOwnSales businessId={ownSalesBusinessId} value={ownSales} onChange={setOwnSales} disabled={busy} />

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

      <PdpFormBatch batch={batch} onChange={setBatch} disabled={busy} />

      {/* 이미지 모델·품질 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <SectionTitle>이미지 모델</SectionTitle>
        <ImageModelSelect
          models={PDP_IMAGE_MODELS}
          model={model}
          quality={quality}
          imageCount={ESTIMATED_IMAGE_COUNT[mode]}
          // 새 배치는 이미지 모델을 배치가 정한다(MS 2k) — 고르지 않게 막는다
          disabled={busy || batch === 'new'}
          onModelChange={setModel}
          onQualityChange={setQuality}
        />
        <p className="text-[11px] text-slate-400">
          예상 장수는 섹션 수에 따른 근사치입니다 — 실제 생성 장수는 design 단계에서 확정됩니다.
        </p>
      </section>

      <button
        onClick={submit}
        disabled={busy || !localCodexAvailable}
        title={!localCodexAvailable ? LOCAL_CODEX_NOTICE : undefined}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 text-xs px-4 py-2 rounded-full bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
        상세페이지 생성 시작
      </button>
      {error && <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">{error}</div>}
    </div>
  )
}
