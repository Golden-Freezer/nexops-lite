'use client'

/**
 * 등록 대기 목록 — 등록 임시저장(초안)을 최근 수정순으로 보여주고, 행을 누르면 등록 준비 드로어를 연다.
 * 서버 페이지 넘김(/api/registration/drafts ?page=&status=)·전체 개수·사업장 표시.
 * 소싱 상품에 묶이지 않은 초안은 드로어(소싱 상품 기준)를 열 수 없어 대표이미지·상세페이지 링크만 둔다.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, FileText, Image as ImageIcon, Loader2 } from 'lucide-react'
import { RegistrationPrepDrawer } from '@/components/features/sourcing/registration/RegistrationPrepDrawer'
import type { DraftListItem, DraftListPage } from '@/lib/registration/draft-list'
import { formatWon } from '@/lib/utils/format'

type StatusFilter = 'all' | 'draft' | 'ready'

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'draft', label: '작성 중' },
  { key: 'ready', label: '등록 준비 완료' },
]

function formatKst(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function AssetBadge({ on, icon: Icon, label }: { on: boolean; icon: typeof ImageIcon; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] border rounded-full px-1.5 py-0.5 ${
        on ? 'text-brand-700 border-brand-200 bg-brand-50' : 'text-slate-400 border-slate-200'
      }`}
      title={on ? `${label} 있음` : `${label} 없음`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
  )
}

function DraftRow({ item, onOpen }: { item: DraftListItem; onOpen: (item: DraftListItem) => void }) {
  const openable = Boolean(item.sourcingProductId)
  const categoryLeaf = item.categoryPath?.split('>').pop()?.trim() || null
  return (
    <div
      role={openable ? 'button' : undefined}
      tabIndex={openable ? 0 : undefined}
      onClick={openable ? () => onOpen(item) : undefined}
      onKeyDown={
        openable
          ? (e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              onOpen(item)
            }
          : undefined
      }
      className={`rounded-lg border border-slate-200 bg-white p-3 flex items-center flex-wrap gap-3 ${
        openable ? 'cursor-pointer hover:border-brand-400' : ''
      }`}
    >
      {item.heroImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.heroImage} alt="" className="w-12 h-12 rounded object-cover border border-slate-100 shrink-0" />
      ) : (
        <div className="w-12 h-12 rounded bg-slate-50 border border-slate-100 shrink-0" />
      )}
      <div className="flex-1 min-w-[160px]">
        <div className="text-xs font-medium text-slate-700 truncate">{item.productName || '(상품명 없음)'}</div>
        <div className="text-[10px] text-slate-400 truncate">
          {[item.keyword, categoryLeaf].filter(Boolean).join(' · ') || '키워드 없음'}
          {item.salePrice != null && ` · ${formatWon(item.salePrice)}`}
          {` · 수정 ${formatKst(item.updatedAt)}`}
        </div>
        <div className="mt-1 flex items-center gap-1 flex-wrap">
          <span
            className={`text-[10px] border rounded-full px-1.5 py-0.5 ${
              item.businessName ? 'text-slate-600 border-slate-200 bg-slate-50' : 'text-amber-700 border-amber-200 bg-amber-50'
            }`}
          >
            {item.businessName ?? '사업장 미지정'}
          </span>
          <AssetBadge on={Boolean(item.heroImage)} icon={ImageIcon} label="대표이미지" />
          <AssetBadge on={item.hasDetailPage} icon={FileText} label="상세페이지" />
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <span
          className={`text-[10px] border rounded-full px-2 py-0.5 ${
            item.status === 'ready'
              ? 'text-brand-600 border-brand-200 bg-brand-50'
              : 'text-slate-500 border-slate-200 bg-slate-50'
          }`}
        >
          {item.status === 'ready' ? '등록 준비 완료' : '작성 중'}
        </span>
        {openable ? (
          <span className="text-[11px] px-2.5 py-1 rounded-full border border-slate-200 text-slate-600">등록 준비 열기</span>
        ) : (
          <>
            <Link
              href={`/registration/thumbnail?draftId=${item.id}`}
              className="text-[11px] px-2.5 py-1 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              대표이미지
            </Link>
            <Link
              href={`/registration/detail-page?draftId=${item.id}`}
              className="text-[11px] px-2.5 py-1 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              상세페이지
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

export function RegistrationDraftList() {
  const [status, setStatus] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<DraftListPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [open, setOpen] = useState<DraftListItem | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams({ page: String(page) })
    if (status !== 'all') qs.set('status', status)
    fetch(`/api/registration/drafts?${qs.toString()}`, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || '등록 대기 목록을 불러오지 못했습니다.')
        if (alive) setData(json.data as DraftListPage)
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : '목록 조회 실패'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [page, status, reloadKey])

  const changeStatus = useCallback((next: StatusFilter) => {
    setStatus(next)
    setPage(1)
  }, [])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        {STATUS_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => changeStatus(key)}
            className={`text-[11px] px-2.5 py-1 rounded-full border ${
              status === key ? 'bg-slate-700 border-slate-700 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-slate-400">{data ? `${data.total.toLocaleString('ko-KR')}건` : ''}</span>
      </div>

      {error && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">{error}</div>
      )}
      {loading && !data && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> 불러오는 중…
        </div>
      )}
      {data && data.items.length === 0 && !loading && (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-xs text-slate-400">
          {status === 'all'
            ? '등록 대기 초안이 없습니다. AI 소싱기 후보 상세에서 "쿠팡 등록 준비"를 저장하면 여기에 쌓입니다.'
            : '이 상태의 초안이 없습니다.'}
        </div>
      )}

      <div className={`space-y-2 ${loading && data ? 'opacity-60' : ''}`}>
        {data?.items.map((item) => <DraftRow key={item.id} item={item} onOpen={setOpen} />)}
      </div>

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="inline-flex items-center gap-0.5 text-[11px] px-2.5 py-1 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> 이전
          </button>
          <span className="text-[11px] text-slate-500">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="inline-flex items-center gap-0.5 text-[11px] px-2.5 py-1 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            다음 <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {open?.sourcingProductId && (
        <RegistrationPrepDrawer
          sourcingProductId={open.sourcingProductId}
          keyword={open.keyword ?? ''}
          onClose={() => setOpen(null)}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  )
}
