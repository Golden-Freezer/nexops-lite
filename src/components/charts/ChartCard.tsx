import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

interface ChartCardProps {
  title: string
  subtitle?: string
  loading?: boolean
  empty?: boolean
  emptyText?: string
  action?: ReactNode
  children?: ReactNode
}

/** 모든 차트의 외곽 래퍼 — 제목/부제/로딩/빈 상태 통일 (기존 카드와 동일 톤) */
export function ChartCard({ title, subtitle, loading, empty, emptyText, action, children }: ChartCardProps) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : empty ? (
        <p className="text-xs text-slate-400 text-center py-10">{emptyText ?? '데이터 없음'}</p>
      ) : (
        children
      )}
    </div>
  )
}
