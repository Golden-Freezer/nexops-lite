'use client'

// 상세페이지 생성 — Premium/Pro 6단계 파이프라인 (Phase 2, Phase 1 준비중 플레이스홀더 대체)
// ?draftId= 등록 드래프트 프리로드(폼 단계) / ?jobId= 기존 잡 재개(진행·결과 단계)

import { Suspense, useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { PdpForm } from '@/components/features/registration/PdpForm'
import { PdpProgress } from '@/components/features/registration/PdpProgress'
import { PdpPreview } from '@/components/features/registration/PdpPreview'
import type { PdpJobRow } from '@/lib/registration/pdp-state'
import { LocalCodexNotice } from '@/components/features/registration/LocalCodexNotice'

function DetailPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const draftId = searchParams.get('draftId') ?? undefined
  const [jobId, setJobId] = useState<string | undefined>(searchParams.get('jobId') ?? undefined)
  const [job, setJob] = useState<PdpJobRow | null>(null)

  const handleCreated = useCallback(
    (id: string) => {
      setJobId(id)
      setJob(null)
      router.replace(`/registration/detail-page?jobId=${id}`)
    },
    [router]
  )

  const showPreview = job != null && job.current_step === 'done'

  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-6 py-6">
      <LocalCodexNotice />
      {!jobId && <PdpForm draftId={draftId} onCreated={handleCreated} />}
      {jobId && !showPreview && <PdpProgress jobId={jobId} onJobChange={setJob} />}
      {jobId && showPreview && job && <PdpPreview job={job} onJobChange={setJob} />}
    </div>
  )
}

export default function DetailPagePage() {
  return (
    <>
      <Header title="상세페이지 생성" />
      <Suspense fallback={<div className="max-w-4xl mx-auto px-4 py-6 text-xs text-slate-400">로드 중…</div>}>
        <DetailPageContent />
      </Suspense>
    </>
  )
}
