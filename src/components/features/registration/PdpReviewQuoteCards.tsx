'use client'

/**
 * 리뷰 인용 카드(W3, PDP-W2W3-CONTRACT v1 §1·§4) — 자사 리뷰 파일에서 고른 후보(30개 이하)를 카드로 보여 주고 6장 이하를 체크로 고른다.
 * 글은 정화 뒤 리뷰 글 그대로다(바꿔 쓰지 않는다). 고른 카드는 글 안 낱말을 눌러 강조(3개·12자 이하)를 고른다 — 글에 없는 말은 못 고른다.
 * 리뷰어번호는 후보에 없고 이름은 가린 꼴('김**')만 있다(A의 정화, P1-6). 고른 카드는 spec.reviewQuotes, 후보 목록은 저장하지 않는다(PdpReviewFiles가 쥔다).
 * 인용 금지 표현(효능·최상급·대가성)·삭제 표시가 남은 후보(blocked, 목록 맨 뒤)는 흐리게 두고 체크를 막은 채 사유 칩을 붙인다.
 */

import { Star } from 'lucide-react'
import {
  HIGHLIGHT_MAX,
  QUOTE_BLOCK_LABELS,
  QUOTE_CANDIDATE_MAX,
  QUOTE_MAX,
  highlightChips,
  quoteCardText,
  toggleHighlight,
  toggleQuote,
  type ReviewCandidate,
  type ReviewQuote,
} from '@/lib/registration/pdp-input-assist'

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-500" aria-label={`별점 ${rating}점`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} className={`w-3 h-3 ${i < rating ? 'fill-amber-400' : 'text-slate-300'}`} />
      ))}
    </span>
  )
}

export function PdpReviewQuoteCards({
  candidates,
  selected,
  onChange,
  disabled,
}: {
  candidates: ReviewCandidate[]
  selected: ReviewQuote[]
  onChange: (quotes: ReviewQuote[]) => void
  disabled?: boolean
}) {
  const shown = candidates.slice(0, QUOTE_CANDIDATE_MAX)
  const full = selected.length >= QUOTE_MAX
  const blockedCount = shown.filter((c) => c.blocked).length
  if (shown.length === 0) {
    return <p className="text-xs text-slate-400">자사 리뷰 파일을 올리면 인용할 후기 후보가 여기 나옵니다.</p>
  }
  return (
    <div className="flex flex-col gap-2 text-xs text-slate-500">
      <span>
        {`후기 인용 카드 — ${selected.length}/${QUOTE_MAX}장 선택`}
        <span className="ml-1 text-[11px] text-slate-400">{`(글은 그대로 씁니다. 고른 카드는 낱말을 눌러 강조를 ${HIGHLIGHT_MAX}개까지)`}</span>
        {blockedCount > 0 && (
          <span className="ml-1 text-[11px] text-slate-400">{`· 인용할 수 없는 후기 ${blockedCount}장은 흐리게 두고 고를 수 없습니다`}</span>
        )}
      </span>
      <ul aria-label="후기 인용 후보" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {shown.map((c) => {
          const quote = selected.find((q) => q.id === c.id)
          const checked = Boolean(quote)
          // 고른 카드는 사유가 붙어도 뺄 수 있게 둔다(후보는 파일을 올릴 때만 만들어져 실제로는 생기지 않는다)
          const block = c.blocked ? QUOTE_BLOCK_LABELS[c.blocked] ?? `${c.blocked} — 인용 불가` : null
          const blockId = `quote-block-${c.id}`
          const tone = checked ? 'border-brand-400 bg-brand-50' : block ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'
          return (
            <li key={c.id} className={`rounded border p-2 ${tone}`}>
              <label className={`flex items-start gap-2 ${block && !checked ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || (!checked && (full || Boolean(block)))}
                  aria-describedby={block ? blockId : undefined}
                  onChange={() => onChange(toggleQuote(selected, c))}
                  className="mt-0.5"
                />
                <span className="flex min-w-0 flex-col gap-1">
                  {block && (
                    <span id={blockId} className="self-start rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      {block}
                    </span>
                  )}
                  <span className={`flex min-w-0 flex-col gap-1 ${block ? 'opacity-50' : ''}`}>
                    <span className="flex items-center gap-2">
                      <Stars rating={c.rating} />
                      {c.option && <span className="truncate text-[11px] text-slate-400">{c.option}</span>}
                    </span>
                    <span className="whitespace-pre-line text-slate-700">{c.text}</span>
                    {c.cardSummary && c.cardSummary !== c.text && (
                      <span className="text-[11px] text-slate-500">{`페이지 카드 글: ${c.cardSummary}`}</span>
                    )}
                  </span>
                </span>
              </label>
              {quote && (
                <div role="group" className="mt-2 flex flex-wrap gap-1" aria-label="강조할 낱말">
                  {highlightChips(quoteCardText(quote)).map((chip) => {
                    const on = quote.highlights?.includes(chip) ?? false
                    return (
                      <button
                        key={chip}
                        type="button"
                        aria-pressed={on}
                        disabled={disabled || (!on && (quote.highlights?.length ?? 0) >= HIGHLIGHT_MAX)}
                        onClick={() => onChange(selected.map((q) => (q.id === quote.id ? toggleHighlight(q, chip) : q)))}
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          on ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        } disabled:opacity-40`}
                      >
                        {chip}
                      </button>
                    )
                  })}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
