'use client'

// 생성 히스토리 — 대표이미지 잡 + 상세페이지(PDP) 잡 통합 이력 (Phase 2). 시간순 병합, 종류·모드 배지로 구분.
// 진행 중 잡은 각자의 화면으로 재개(대표이미지 ?jobId=, 상세페이지 ?jobId=).
// 병합·트랙 필터·페이지 넘김은 서버(/api/registration/history, before 커서)가 하고, 화면은 이어 붙이기만 한다.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import {
  THUMBNAIL_CUTS,
  THUMBNAIL_CUT_LABELS,
  type ThumbnailJob,
} from '@/lib/registration/thumbnail-types'
import { resolveGenerationTrack, type GenerationTrack, type PdpJobRow, type PdpStep } from '@/lib/registration/pdp-state'
import { PDP_STATUS_LABELS } from '@/lib/registration/pdp-client'
import type { HistoryEntry, HistoryPage } from '@/lib/registration/history'

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

const PAGE_SIZE = 20

function formatKst(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
}

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

/** 잡이 속한 사업장 — 등록 초안에서 물려받는다. 없으면 '사업장 없음'(초안 없이 만든 잡) */
function BusinessBadge({ name }: { name: string | null }) {
  return (
    <span
      className={`text-[10px] border rounded-full px-1.5 py-0.5 shrink-0 ${
        name ? 'text-slate-600 border-slate-200 bg-white' : 'text-slate-400 border-dashed border-slate-200'
      }`}
    >
      {name ?? '사업장 없음'}
    </span>
  )
}

function ThumbnailRow({ job, businessName }: { job: ThumbnailJob; businessName: string | null }) {
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
        <div className="flex items-center gap-1.5 flex-wrap">
          <KindBadge kind="thumbnail" />
          <BusinessBadge name={businessName} />
          <div className="text-xs font-medium text-slate-700 truncate">
            {job.productName || job.visionAnalysis?.product_summary || '(상품명 없음)'}
          </div>
        </div>
        <div className="text-[10px] text-slate-400">
          {formatKst(job.createdAt)} · {job.imageModel} ({job.imageQuality}) · ${job.costUsd.toFixed(3)}
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

function PdpRow({ job, businessName }: { job: PdpJobRow; businessName: string | null }) {
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
          <BusinessBadge name={businessName} />
          <div className="text-xs font-medium text-slate-700 truncate">{job.spec_sheet.productName || '(상품명 없음)'}</div>
        </div>
        <div className="text-[10px] text-slate-400">
          {formatKst(job.created_at)} · {job.image_model} ({job.image_quality}) · ${job.cost_usd.toFixed(3)}
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

type HistoryResponse = HistoryPage & { businesses: Array<{ id: string; name: string }> }

async function fetchHistory(trackFilter: 'all' | GenerationTrack, before: string | null): Promise<HistoryResponse> {
  const qs = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (trackFilter !== 'all') qs.set('track', trackFilter)
  if (before) qs.set('before', before)
  const res = await fetch(`/api/registration/history?${qs.toString()}`, { cache: 'no-store' })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || '목록 조회 실패')
  return json.data as HistoryResponse
}

export default function RegistrationHistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [businessNames, setBusinessNames] = useState<Map<string, string>>(new Map())
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 트랙 필터(부록 F-3) — 표준/내재화 선택 시 상세페이지 잡만 해당 트랙으로 좁힌다(대표이미지는 트랙 무관이라 숨김)
  const [trackFilter, setTrackFilter] = useState<'all' | GenerationTrack>('all')

  // 필터가 바뀌면 첫 페이지부터 다시 읽는다
  useEffect(() => {
    let alive = true
    setEntries(null)
    setNextBefore(null)
    setError(null)
    fetchHistory(trackFilter, null)
      .then((page) => {
        if (!alive) return
        setEntries(page.entries)
        setNextBefore(page.nextBefore)
        setBusinessNames(new Map(page.businesses.map((b) => [b.id, b.name])))
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : '목록 조회 실패'))
    return () => {
      alive = false
    }
  }, [trackFilter])

  const loadMore = useCallback(async () => {
    if (!nextBefore) return
    setLoadingMore(true)
    setError(null)
    try {
      const page = await fetchHistory(trackFilter, nextBefore)
      setEntries((prev) => [...(prev ?? []), ...page.entries])
      setNextBefore(page.nextBefore)
    } catch (e) {
      setError(e instanceof Error ? e.message : '목록 조회 실패')
    } finally {
      setLoadingMore(false)
    }
  }, [nextBefore, trackFilter])

  const loading = entries === null && !error
  const nameOf = (id: string | null) => (id ? businessNames.get(id) ?? null : null)

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
        {entries !== null && entries.length === 0 && <div className="text-xs text-slate-400">아직 생성 이력이 없습니다.</div>}
        {entries?.map((entry) =>
          entry.kind === 'thumbnail' ? (
            <ThumbnailRow key={`thumb-${entry.id}`} job={entry.job} businessName={nameOf(entry.businessId)} />
          ) : (
            <PdpRow key={`pdp-${entry.id}`} job={entry.job} businessName={nameOf(entry.businessId)} />
          )
        )}
        {nextBefore && (
          <div className="flex justify-center pt-1">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="inline-flex items-center gap-1 text-[11px] px-3 py-1 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {loadingMore && <Loader2 className="w-3 h-3 animate-spin" />}
              이전 이력 더 보기
            </button>
          </div>
        )}
      </div>
    </>
  )
}
