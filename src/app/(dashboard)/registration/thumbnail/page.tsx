'use client'

// 대표이미지 스튜디오 — NEXFIT 썸네일 생성기 이식 (Phase 1)
// ?draftId= 등록 드래프트 프리로드 / ?jobId= 기존 잡 재개

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { ThumbnailStudio } from '@/components/features/registration/ThumbnailStudio'

function ThumbnailContent() {
  const searchParams = useSearchParams()
  const draftId = searchParams.get('draftId') ?? undefined
  const resumeJobId = searchParams.get('jobId') ?? undefined
  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-6 py-6">
      <ThumbnailStudio draftId={draftId} resumeJobId={resumeJobId} />
    </div>
  )
}

export default function ThumbnailStudioPage() {
  return (
    <>
      <Header title="대표이미지 스튜디오" />
      <Suspense fallback={<div className="max-w-4xl mx-auto px-4 py-6 text-xs text-slate-400">로드 중…</div>}>
        <ThumbnailContent />
      </Suspense>
    </>
  )
}
