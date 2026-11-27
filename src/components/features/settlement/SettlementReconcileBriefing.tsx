'use client'

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import type { SettlementAnalysisOutput } from '@/types/settlement-recon'

interface AnalyzeResponse {
  analysis: SettlementAnalysisOutput | null
  fallback: boolean
  reason?: string
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; result: AnalyzeResponse }

/** 정산주기별 "AI 브리핑" 버튼 — 클릭 시 analyze 라우트를 호출해 규칙 대조표 위에 LLM 해설을 얹는다. */
export function SettlementReconcileBriefing({ groupKey }: { groupKey: string }) {
  const [state, setState] = useState<State>({ status: 'idle' })

  const runBriefing = async () => {
    setState({ status: 'loading' })
    try {
      const res = await apiFetch(`/api/settlement/analyze?groupKey=${encodeURIComponent(groupKey)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'AI 브리핑 생성에 실패했습니다.')
      setState({ status: 'done', result: json.data as AnalyzeResponse })
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : 'AI 브리핑 생성 중 오류가 발생했습니다.' })
    }
  }

  if (state.status === 'idle') {
    return (
      <button
        type="button"
        onClick={runBriefing}
        className="flex items-center gap-1.5 px-3 h-8 border border-emerald-200 text-emerald-600 rounded-lg text-xs font-medium hover:bg-emerald-50"
      >
        <Sparkles className="w-3.5 h-3.5" /> AI 브리핑
      </button>
    )
  }

  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> AI가 대조 결과를 분석하고 있습니다…
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="space-y-1.5">
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg">{state.message}</div>
        <button type="button" onClick={runBriefing} className="text-xs text-emerald-600 hover:underline">다시 시도</button>
      </div>
    )
  }

  const { analysis, fallback, reason } = state.result

  if (!analysis || fallback) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-3 text-center">
        <p className="text-xs text-slate-600">{reason || 'AI 해설을 생성하지 못했습니다.'}</p>
        <p className="text-[11px] text-slate-400 mt-0.5">위 대조표를 참고하세요.</p>
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-emerald-50 to-white rounded-lg border border-emerald-100 p-3 space-y-2.5">
      <p className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5" /> {analysis.headline}
      </p>
      {analysis.summary && <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">{analysis.summary}</p>}

      {analysis.diff_attribution.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-slate-500 mb-1">차액 귀속</p>
          <ul className="space-y-1">
            {analysis.diff_attribution.map((t, i) => (
              <li key={i} className="text-[11px] text-slate-600 flex gap-1.5"><span className="text-emerald-400 shrink-0">•</span>{t}</li>
            ))}
          </ul>
        </div>
      )}

      {analysis.anomalies.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-amber-600 mb-1">이상 신호</p>
          <ul className="space-y-1">
            {analysis.anomalies.map((t, i) => (
              <li key={i} className="text-[11px] text-slate-600 flex gap-1.5"><span className="text-amber-400 shrink-0">•</span>{t}</li>
            ))}
          </ul>
        </div>
      )}

      {analysis.advice.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-slate-500 mb-1">제안</p>
          <ul className="space-y-1">
            {analysis.advice.map((t, i) => (
              <li key={i} className="text-[11px] text-slate-600 flex gap-1.5"><span className="text-blue-400 shrink-0">•</span>{t}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
