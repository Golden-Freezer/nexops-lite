import type { ReactNode } from 'react'
import { DeltaBadge } from './DeltaBadge'
import { Sparkline } from './Sparkline'

interface KpiStatCardProps {
  label: string
  value: string
  unit?: string
  delta?: number
  deltaLabel?: string // '전월 대비' 등
  deltaInvert?: boolean // 지출계열(증가=나쁨) 델타 색 반전
  spark?: number[] // 있으면 하단 스파크라인
  tone?: 'default' | 'profit' | 'loss' | 'warning'
  note?: string // '(VAT포함)' '(추정)' 등
  icon?: ReactNode
}

/** 4층 구조 KPI 카드 (라벨/값/델타/스파크라인) — 기존 대시보드 KpiCard와 동일 톤 */
export function KpiStatCard({ label, value, unit, delta, deltaLabel, deltaInvert, spark, tone = 'default', note, icon }: KpiStatCardProps) {
  const valueColor =
    tone === 'profit' ? 'text-blue-600' : tone === 'loss' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : 'text-slate-800'
  const bgColor = tone === 'warning' ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'

  return (
    <div className={`rounded-xl border p-4 shadow-card ${bgColor}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
          {icon} {label}
          {note && <span className="text-[9px] text-slate-400 font-normal">{note}</span>}
        </span>
        {delta != null && <DeltaBadge value={delta} invert={deltaInvert} />}
      </div>
      <p className={`text-xl font-bold font-mono ${valueColor}`}>
        {value}
        {unit && <span className="text-[10px] font-normal text-slate-400 ml-0.5">{unit}</span>}
      </p>
      <div className="flex items-center justify-between mt-1">
        {deltaLabel ? <p className="text-[10px] text-slate-400">{deltaLabel}</p> : <span />}
        {spark && spark.length > 0 && <Sparkline points={spark} width={64} height={16} />}
      </div>
    </div>
  )
}
