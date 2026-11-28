'use client'

/**
 * 리뷰 파일 입력 두 개(pdp-review-input) — 쿠팡 리뷰 다운로드 엑셀.
 * - 자사 리뷰: 생성 입력. 정화·표집한 텍스트를 "리뷰 원문" 칸(reviewsText)에 채운다.
 * - 경쟁사 리뷰: 소구점 분석 전용. 카피에는 원문을 쓰지 않는다 — spec_sheet.competitorReviews. 오너가 올린 파일, 또는 파일이 없을 때
 *   '리뷰 받을 쿠팡 상품 번호'로 수집한 리뷰(잡 생성 때 서버가 채운다, PdpReviewSourceProducts).
 * 파일은 /api/registration/reviews가 정화·표집해 돌려주고 저장하지 않는다. 상태는 PdpForm의 spec이 쥔다.
 * 자사 파일 응답의 인용 후보(reviewCandidates, W2a)는 이 화면만 쥐고(저장하지 않음), 고른 카드만 spec.reviewQuotes에 넣는다(W3).
 */

import { useRef, useState } from 'react'
import { FileSpreadsheet, Loader2, X } from 'lucide-react'
import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import type { ReviewIntake } from '@/lib/registration/reviews/review-intake'
import type { ReviewCandidate, ReviewFileKind, ReviewQuote, ReviewStats } from '@/lib/registration/reviews/review-types'
import { PdpReviewQuoteCards } from './PdpReviewQuoteCards'
import { PdpReviewSourceProducts } from './PdpReviewSourceProducts'

/** 파싱 라우트 호출 — 실패면 서버 오류 문구로 throw */
export async function fetchReviewIntake(kind: ReviewFileKind, file: File): Promise<ReviewIntake> {
  const form = new FormData()
  form.append('file', file)
  form.append('kind', kind)
  const res = await fetch('/api/registration/reviews', { method: 'POST', body: form })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || '리뷰 파일을 읽지 못했습니다.')
  return json.data as ReviewIntake
}

/** 파싱 결과 → spec 패치. 자사는 리뷰 원문 칸과 파일 메타, 경쟁사는 competitorReviews */
export function reviewIntakePatch(data: ReviewIntake): Partial<PdpSpecSheet> {
  return data.kind === 'own'
    ? { reviewsText: data.reviewsText, reviewFiles: { own: data.meta } }
    : { competitorReviews: data.competitorReviews }
}

/**
 * 파일 빼기 → spec 패치. 자사는 고른 인용 카드(reviewQuotes)를 함께 비우고, 파일로 채운 리뷰 원문(filledText)은 사용자가
 * 고치지 않았을 때만 비운다
 */
export function removeReviewFilePatch(
  kind: ReviewFileKind,
  spec: PdpSpecSheet,
  filledText: string | null
): Partial<PdpSpecSheet> {
  if (kind === 'competitor') return { competitorReviews: undefined }
  const untouched = filledText !== null && spec.reviewsText === filledText
  return { reviewFiles: undefined, reviewQuotes: undefined, ...(untouched ? { reviewsText: undefined } : {}) }
}

/** 카드 목록 — 이번 후보, 그리고 후보에 없는 이미 고른 카드(다른 파일·다시 연 화면)도 보여 줘서 뺄 수 있게 한다 */
export function quoteCards(candidates: ReviewCandidate[], selected: ReviewQuote[] | undefined): ReviewCandidate[] {
  const ids = new Set(candidates.map((c) => c.id))
  return [...candidates, ...(selected ?? []).filter((q) => !ids.has(q.id))]
}

function statsLine(stats: ReviewStats, sampled: number): string {
  return `리뷰 ${stats.total_rows}건 · 글 리뷰 ${stats.text_review_count}건 · 표집 ${sampled}건`
}

function ReviewFileRow({
  label,
  hint,
  current,
  busy,
  disabled,
  onPick,
  onRemove,
}: {
  label: string
  hint: string
  current: { fileName: string; summary: string } | null
  busy: boolean
  disabled?: boolean
  onPick: (file: File) => void
  onRemove: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-col gap-1 text-xs text-slate-500">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy || disabled}
          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-slate-600 hover:border-brand-400 hover:text-brand-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
          {current ? '다른 파일' : '파일 선택'}
        </button>
        {current && (
          <span className="flex min-w-0 items-center gap-1 text-slate-600">
            <span className="truncate">{current.fileName}</span>
            <span className="shrink-0 text-slate-400">({current.summary})</span>
            <button
              type="button"
              onClick={onRemove}
              disabled={busy || disabled}
              className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-50"
              aria-label={`${label} 빼기`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) onPick(file)
          }}
        />
      </div>
      <span className="text-[11px] text-slate-400">{hint}</span>
    </div>
  )
}

export function PdpReviewFiles({
  spec,
  onChange,
  disabled,
}: {
  spec: PdpSpecSheet
  onChange: (patch: Partial<PdpSpecSheet>) => void
  disabled?: boolean
}) {
  const [busy, setBusy] = useState<ReviewFileKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 파일로 채운 리뷰 원문 — 파일을 뺄 때 사용자가 고치지 않았으면 함께 비운다
  const ownTextRef = useRef<string | null>(null)
  // 자사 파일의 인용 후보 — 저장하지 않는다(다시 열면 고른 카드만 보인다)
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([])

  async function upload(kind: ReviewFileKind, file: File) {
    setBusy(kind)
    setError(null)
    try {
      const data = await fetchReviewIntake(kind, file)
      if (data.kind === 'own') {
        ownTextRef.current = data.reviewsText
        setCandidates(data.reviewCandidates)
      }
      onChange(reviewIntakePatch(data))
    } catch (e) {
      setError(e instanceof Error ? e.message : '리뷰 파일을 읽지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }

  const own = spec.reviewFiles?.own
  const competitor = spec.competitorReviews
  return (
    <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
      <ReviewFileRow
        label="자사 리뷰 파일 (WING 리뷰 다운로드)"
        hint="개인정보를 지우고 평점 분포대로 골라 아래 '리뷰 원문' 칸에 채웁니다. 인용·요약에 씁니다."
        current={own ? { fileName: own.fileName, summary: statsLine(own.stats, own.sampled) } : null}
        busy={busy === 'own'}
        disabled={disabled}
        onPick={(f) => upload('own', f)}
        onRemove={() => {
          onChange(removeReviewFilePatch('own', spec, ownTextRef.current))
          ownTextRef.current = null
          setCandidates([])
        }}
      />
      <ReviewFileRow
        label="경쟁사 리뷰 파일 (분석용)"
        hint="불만 유형만 뽑아 소구점 기획에 씁니다. 리뷰 문장·타사명은 카피에 쓰지 않습니다."
        current={
          competitor
            ? { fileName: competitor.fileName, summary: statsLine(competitor.stats, competitor.items.length) }
            : null
        }
        busy={busy === 'competitor'}
        disabled={disabled}
        onPick={(f) => upload('competitor', f)}
        onRemove={() => onChange(removeReviewFilePatch('competitor', spec, null))}
      />
      <PdpReviewSourceProducts spec={spec} onChange={onChange} disabled={disabled} />
      <PdpReviewQuoteCards
        candidates={quoteCards(candidates, spec.reviewQuotes)}
        selected={spec.reviewQuotes ?? []}
        onChange={(quotes) => onChange({ reviewQuotes: quotes.length > 0 ? quotes : undefined })}
        disabled={disabled}
      />
      {error && (
        <div role="alert" className="text-xs text-red-600">
          {error}
        </div>
      )}
    </div>
  )
}
