'use client'

// 생성 히스토리 — 대표이미지 잡 + 상세페이지(PDP) 잡 통합 이력 (Phase 2). 시간순 병합, 종류·모드 배지로 구분.
// 진행 중 잡은 각자의 화면으로 재개(대표이미지 ?jobId=, 상세페이지 ?jobId=).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import {
  THUMBNAIL_CUTS,
  THUMBNAIL_CUT_LABELS,
  type ThumbnailJob,
} from '@/lib/registration/thumbnail-types'
import { resolveGenerationTrack, type GenerationTrack, type PdpJobRow, type PdpStep } from '@/lib/registration/pdp-state'
import { PDP_STATUS_LABELS, pdpApi } from '@/lib/registration/pdp-client'

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  done: { label: '완료', cls: 'text-brand-600 border-brand-200 bg-brand-50' },
  failed: { label: '실패', cls: 'text-danger-600 border-danger-200 bg-danger-50' },
  pending: { label: '대기', cls: 'text-slate-500 border-slate-200 bg-slate-50' },
  analyzing: { label: '분석 중', cls: 'text-amber-600 border-amber-200 bg-amber-50' },
  generating: { label: '생성 중', cls: 'text-amber-600 border-amber-200 bg-amber-50' },
  gating: { label: '판정 중', cls: 'text-amber-600 border-amber-200 bg-amber-50' },
}

const PDP_STATUS_CLS: Record<PdpStep, string> = {
  pending: 'text-slate-500 border-slate-200 bg-slate-50',
  analysis: 'text-amber-600 border-amber-200 bg-amber-50',
  research: 'text-amber-600 border-amber-200 bg-amber-50',
  design: 'text-amber-600 border-amber-200 bg-amber-50',
  copywriting: 'text-amber-600 border-amber-200 bg-amber-50',
  images: 'text-amber-600 border-amber-200 bg-amber-50',
  compose: 'text-amber-600 border-amber-200 bg-amber-50',
  done: 'text-brand-600 border-brand-200 bg-brand-50',
  failed: 'text-danger-600 border-danger-200 bg-danger-50',
}

type HistoryEntry =
  | { kind: 'thumbnail'; id: string; createdAt: string; job: ThumbnailJob }
  | { kind: 'pdp'; id: string; createdAt: string; job: PdpJobRow }

function KindBadge({ kind }: { kind: 'thumbnail' | 'pdp' }) {
  return (
    <span
      className={`text-[10px] border rounded-full px-1.5 py-0.5 shrink-0 ${
        kind === 'pdp' ? 'text-accent-700 border-accent-200 bg-accent-50' : 'text-slate-500 border-slate-200 bg-slate-50'
      }`}
    >
      {kind === 'pdp' ? '상세페이지' : '대표이미지'}
    </span>
  )
}

function ThumbnailRow({ job }: { job: ThumbnailJob }) {
  const badge = STATUS_BADGES[job.status] ?? STATUS_BADGES.pending
  const inProgress = job.status !== 'done' && job.status !== 'failed'
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 flex items-center flex-wrap gap-3">
      <div className="flex gap-1.5 shrink-0">
        {THUMBNAIL_CUTS.map((cut) =>
          job.cuts[cut]?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={cut}
              src={job.cuts[cut]!.url}
              alt={THUMBNAIL_CUT_LABELS[cut]}
              className="w-12 h-12 rounded object-cover border border-slate-100"
            />
          ) : (
            <div key={cut} className="w-12 h-12 rounded bg-slate-50 border border-slate-100" />
          )
        )}
      </div>
      <div className="flex-1 min-w-[140px]">
        <div className="flex items-center gap-1.5">
          <KindBadge kind="thumbnail" />
          <div className="text-xs font-medium text-slate-700 truncate">
            {job.productName || job.visionAnalysis?.product_summary || '(상품명 없음)'}
          </div>
        </div>
        <div className="text-[10px] text-slate-400">
          {new Date(job.createdAt).toLocaleString('ko-KR')} · {job.imageModel} ({job.imageQuality}) · $
          {job.costUsd.toFixed(3)}
        </div>
      </div>
      {/* 상태 배지+액션 — 폭이 부족하면 이 그룹 전체가 다음 줄로 내려간다(shrink-0으로 찌그러짐 방지) */}
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <span className={`text-[10px] border rounded-full px-2 py-0.5 ${badge.cls}`}>{badge.label}</span>
        <Link
          href={`/registration/thumbnail?jobId=${job.id}`}
          className="text-[11px] px-2.5 py-1 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
        >
          {inProgress ? '이어서 실행' : '결과 보기'}
        </Link>
      </div>
    </div>
  )
}

function PdpRow({ job }: { job: PdpJobRow }) {
  const thumbUrl = job.section_images.find((img) => img.url)?.url
  const inProgress = job.current_step !== 'done' && job.current_step !== 'failed'
  const track = resolveGenerationTrack(job)
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 flex items-center flex-wrap gap-3">
      {thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbUrl} alt={job.spec_sheet.productName} className="w-12 h-12 rounded object-cover border border-slate-100 shrink-0" />
      ) : (
        <div className="w-12 h-12 rounded bg-slate-50 border border-slate-100 shrink-0" />
      )}
      <div className="flex-1 min-w-[140px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <KindBadge kind="pdp" />
          <span className="text-[10px] border border-slate-200 rounded-full px-1.5 py-0.5 text-slate-500 shrink-0">
            {job.mode}
          </span>
          {/* 트랙 배지(결정 T-1·부록 F-3) — 동일 상품 양 트랙 비교 동선. 내재화=Emerald(NEXOPS 세컨더리) */}
          <span
            className={`text-[10px] border rounded-full px-1.5 py-0.5 shrink-0 ${
              track === 'internalized'
                ? 'text-emerald-700 border-emerald-200 bg-emerald-50'
                : 'text-slate-500 border-slate-200 bg-slate-50'
            }`}
          >
            {track === 'internalized' ? '실측 내재화 β' : '표준'}
          </span>
          <div className="text-xs font-medium text-slate-700 truncate">{job.spec_sheet.productName || '(상품명 없음)'}</div>
        </div>
        <div className="text-[10px] text-slate-400">
          {new Date(job.created_at).toLocaleString('ko-KR')} · {job.image_model} ({job.image_quality}) · $
          {job.cost_usd.toFixed(3)}
        </div>
      </div>
      {/* 상태 배지+액션 — 폭이 부족하면 이 그룹 전체가 다음 줄로 내려간다(shrink-0으로 찌그러짐 방지) */}
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <span className={`text-[10px] border rounded-full px-2 py-0.5 ${PDP_STATUS_CLS[job.current_step]}`}>
          {PDP_STATUS_LABELS[job.current_step]}
        </span>
        <Link
          href={`/registration/detail-page?jobId=${job.id}`}
          className="text-[11px] px-2.5 py-1 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
        >
          {inProgress ? '이어서 실행' : '결과 보기'}
        </Link>
      </div>
    </div>
  )
}

export default function RegistrationHistoryPage() {
  const [thumbnailJobs, setThumbnailJobs] = useState<ThumbnailJob[] | null>(null)
  const [pdpJobs, setPdpJobs] = useState<PdpJobRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 트랙 필터(부록 F-3) — 표준/내재화 선택 시 상세페이지 잡만 해당 트랙으로 좁힌다(대표이미지는 트랙 무관이라 숨김)
  const [trackFilter, setTrackFilter] = useState<'all' | GenerationTrack>('all')

  useEffect(() => {
    let alive = true
    fetch('/api/registration/thumbnail')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || '목록 조회 실패')
        if (alive) setThumbnailJobs(json.data as ThumbnailJob[])
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : '목록 조회 실패'))
    // PDP 잡 목록 — 별도 태스크가 배선하는 API라 부재/실패해도 대표이미지 목록은 그대로 보인다.
    pdpApi<{ jobs: PdpJobRow[] }>('/api/registration/pdp')
      .then(({ jobs }) => {
        if (alive) setPdpJobs(jobs)
      })
      .catch(() => {
        if (alive) setPdpJobs([])
      })
    return () => {
      alive = false
    }
  }, [])

  const entries: HistoryEntry[] = [
    ...(trackFilter === 'all'
      ? (thumbnailJobs ?? []).map((job) => ({ kind: 'thumbnail' as const, id: job.id, createdAt: job.createdAt, job }))
      : []),
    ...(pdpJobs ?? [])
      .filter((job) => trackFilter === 'all' || resolveGenerationTrack(job) === trackFilter)
      .map((job) => ({ kind: 'pdp' as const, id: job.id, createdAt: job.created_at, job })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const loading = thumbnailJobs === null && !error

  return (
    <>
      <Header title="생성 히스토리" />
      <div className="max-w-5xl mx-auto px-4 lg:px-6 py-6 space-y-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {(
            [
              { key: 'all', label: '전체' },
              { key: 'standard', label: '표준' },
              { key: 'internalized', label: '실측 내재화 β' },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTrackFilter(key)}
              className={`text-[11px] px-2.5 py-1 rounded-full border ${
                trackFilter === key
                  ? key === 'internalized'
                    ? 'bg-emerald-500 border-emerald-500 text-white'
                    : 'bg-slate-700 border-slate-700 text-white'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> 불러오는 중…
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">{error}</div>
        )}
        {!loading && entries.length === 0 && <div className="text-xs text-slate-400">아직 생성 이력이 없습니다.</div>}
        {entries.map((entry) =>
          entry.kind === 'thumbnail' ? (
            <ThumbnailRow key={`thumb-${entry.id}`} job={entry.job} />
          ) : (
            <PdpRow key={`pdp-${entry.id}`} job={entry.job} />
          )
        )}
      </div>
    </>
  )
}
