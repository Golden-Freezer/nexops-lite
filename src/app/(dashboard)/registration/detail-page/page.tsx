'use client'

// 상세페이지 생성 — Premium/Pro 6단계 파이프라인 (Phase 2, Phase 1 준비중 플레이스홀더 대체)
// ?draftId= 등록 드래프트 프리로드(폼 단계) / ?jobId= 기존 잡 재개(진행·결과 단계) / ?name= 작명 결과 상품명 프리필
// ?photoroles=1 사진별 역할 칸 미리보기(결정 카드 c12 — 스위치 photoroles가 꺼진 동안 화면 확인용, 생성에는 잡 기록 스위치만 쓰인다)
// ?demoshot=1도 같은 역할 칸을 연다(J57 시험 사진 — 스위치 demoshot이 꺼진 동안 화면 확인용)

import { Suspense, useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { PdpForm } from '@/components/features/registration/PdpForm'
import { PdpProgress } from '@/components/features/registration/PdpProgress'
import { PdpPreview } from '@/components/features/registration/PdpPreview'
import { LocalCodexNotice } from '@/components/features/registration/LocalCodexNotice'
import type { PdpJobRow } from '@/lib/registration/pdp-state'
import { ENRICHMENT_DEFAULTS } from '@/lib/registration/enrichment-switch'

function DetailPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const draftId = searchParams.get('draftId') ?? undefined
  const initialName = searchParams.get('name')?.slice(0, 200) ?? undefined
  const showPhotoRoles =
    ENRICHMENT_DEFAULTS.photoroles || ENRICHMENT_DEFAULTS.demoshot || searchParams.get('photoroles') === '1' || searchParams.get('demoshot') === '1'
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
      {!jobId && <PdpForm draftId={draftId} initialName={initialName} showPhotoRoles={showPhotoRoles} onCreated={handleCreated} />}
      {jobId && !showPreview && <PdpProgress jobId={jobId} onJobChange={setJob} />}
      {jobId && showPreview && job && <PdpPreview job={job} />}
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
