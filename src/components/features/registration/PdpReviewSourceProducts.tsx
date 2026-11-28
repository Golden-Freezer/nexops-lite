'use client'

/**
 * 리뷰 받을 쿠팡 상품 번호(spec.reviewSourceProductIds, 오너 2026-11-05 승인) — 같은·경쟁 상품 1~3개.
 * 번호를 넣고 '수집 요청'을 누르면 입구(POST /api/competitor-reviews/requests)에 넣고, 상품마다 상태(대기·진행·끝·실패·차단, 표·입구가 없으면
 * 수집 불가)를 보여 준다. 대기·진행 중이면 30초마다 다시 묻는다. 잡을 만들 때 서버가 그때까지 받은 리뷰를 쓴다 — 기다릴지 지금 시작할지는
 * 오너가 고른다(생성 단추는 그대로). 엑셀 경쟁사 파일이 있으면 그 파일만 쓴다.
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw, Send } from 'lucide-react'
import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import {
  REVIEW_REQUEST_PATH,
  REVIEW_SOURCE_MAX_PRODUCTS,
  REVIEW_STATE_LABEL,
  isActiveReviewState,
  parseReviewSourceInput,
  readIntakeResponse,
  readStatusResponse,
  reviewRequestBody,
  type ReviewSourceView,
} from '@/lib/registration/reviews/review-source'

const POLL_MS = 30_000

async function jsonOf(res: Response): Promise<unknown> {
  return res.json().catch(() => null)
}

/** 수집 요청 — 실패해도 throw하지 않고 상품마다 '수집 불가'로 돌려준다 */
export async function requestReviewCollection(productIds: string[], productName?: string): Promise<ReviewSourceView[]> {
  try {
    const res = await fetch(REVIEW_REQUEST_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reviewRequestBody(productIds, productName)),
    })
    return readIntakeResponse(productIds, res.status, await jsonOf(res))
  } catch {
    return readIntakeResponse(productIds, 0, null)
  }
}

/** 상품 하나의 상태 */
export async function fetchReviewCollectionStatus(productId: string): Promise<ReviewSourceView> {
  try {
    const res = await fetch(`${REVIEW_REQUEST_PATH}?product_id=${encodeURIComponent(productId)}`, { cache: 'no-store' })
    return readStatusResponse(productId, res.status, await jsonOf(res))
  } catch {
    return readStatusResponse(productId, 0, null)
  }
}

const KST = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

/** 상태 한 줄 — '대기', '끝 · 리뷰 1,234행 · 11. 05. 14:20 받음' */
export function reviewStateLine(view: ReviewSourceView): string {
  const parts = [view.fresh ? `${REVIEW_STATE_LABEL[view.state]}(최근 7일 안에 받음)` : REVIEW_STATE_LABEL[view.state]]
  if (view.rows !== null) parts.push(`리뷰 ${view.rows.toLocaleString('ko-KR')}행`)
  const at = view.collectedAt ? Date.parse(view.collectedAt) : NaN
  if (Number.isFinite(at)) parts.push(`${KST.format(at)} 받음`)
  if (view.lastError && (view.state === 'failed' || view.state === 'unavailable')) parts.push(view.lastError)
  return parts.join(' · ')
}

export function PdpReviewSourceProducts({
  spec,
  onChange,
  disabled,
}: {
  spec: PdpSpecSheet
  onChange: (patch: Partial<PdpSpecSheet>) => void
  disabled?: boolean
}) {
  const [text, setText] = useState(() => (spec.reviewSourceProductIds ?? []).join(', '))
  const [views, setViews] = useState<ReviewSourceView[]>([])
  const [busy, setBusy] = useState(false)
  const parsed = parseReviewSourceInput(text)
  const ids = parsed.ids
  const idsKey = ids.join(',')
  const viewsRef = useRef(views)
  useEffect(() => {
    viewsRef.current = views
  }, [views])

  // 대기·진행 중인 상품이 있으면 다시 묻는다(화면을 떠나면 멈춘다)
  const active = views.some((v) => isActiveReviewState(v.state))
  useEffect(() => {
    if (!active) return
    const timer = setInterval(async () => {
      const current = viewsRef.current.map((v) => v.productId)
      setViews(await Promise.all(current.map(fetchReviewCollectionStatus)))
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [active])

  // 번호가 바뀌면 지난 상태는 지운다
  useEffect(() => {
    setViews((prev) => (prev.map((v) => v.productId).join(',') === idsKey ? prev : []))
  }, [idsKey])

  function edit(value: string) {
    setText(value)
    const next = parseReviewSourceInput(value).ids
    onChange({ reviewSourceProductIds: next.length > 0 ? next : undefined })
  }

  async function run(work: () => Promise<ReviewSourceView[]>) {
    setBusy(true)
    try {
      setViews(await work())
    } finally {
      setBusy(false)
    }
  }

  const excel = Boolean(spec.competitorReviews && spec.competitorReviews.origin !== 'collected')
  const inputProblem = parsed.invalid.length
    ? `읽지 못한 값: ${parsed.invalid.slice(0, 3).join(', ')}`
    : parsed.overflow
      ? `상품은 ${REVIEW_SOURCE_MAX_PRODUCTS}개까지만 씁니다.`
      : null
  return (
    <div className="flex flex-col gap-1 text-xs text-slate-500">
      <label htmlFor="pdp-review-source-ids">리뷰 받을 쿠팡 상품 번호 (같은·경쟁 상품 1~{REVIEW_SOURCE_MAX_PRODUCTS}개)</label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="pdp-review-source-ids"
          type="text"
          value={text}
          onChange={(e) => edit(e.target.value)}
          placeholder="상품 번호 또는 쿠팡 상품 주소, 쉼표로 나눔"
          disabled={disabled}
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-slate-700 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => run(() => requestReviewCollection(ids, spec.productName))}
          disabled={busy || disabled || ids.length === 0}
          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-slate-600 hover:border-brand-400 hover:text-brand-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          수집 요청
        </button>
        <button
          type="button"
          onClick={() => run(() => Promise.all(ids.map(fetchReviewCollectionStatus)))}
          disabled={busy || disabled || ids.length === 0}
          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-slate-600 hover:border-brand-400 hover:text-brand-500 disabled:opacity-50"
          aria-label="수집 상태 다시 보기"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          상태
        </button>
      </div>
      {inputProblem && <span className="text-[11px] text-amber-600">{inputProblem}</span>}
      {views.length > 0 && (
        <ul className="space-y-0.5 text-slate-600">
          {views.map((v) => (
            <li key={v.productId}>
              <span className="font-mono">{v.productId}</span> — {reviewStateLine(v)}
            </li>
          ))}
        </ul>
      )}
      <span className="text-[11px] text-slate-400">
        {excel
          ? '경쟁사 리뷰 파일이 있어 이 상품들의 수집 리뷰는 쓰지 않습니다(파일 우선).'
          : '생성할 때 그때까지 받은 리뷰를 소구점 분석에만 씁니다(카피에 원문을 쓰지 않음). 수집이 끝날 때까지 기다릴지 지금 만들지는 직접 고르세요.'}
      </span>
    </div>
  )
}
