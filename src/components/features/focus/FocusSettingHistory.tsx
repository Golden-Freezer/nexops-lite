'use client'

import { History, Settings2 } from 'lucide-react'
import type { DailyOpsRow } from '@/types/focus'

interface FocusSettingHistoryProps {
  rows: DailyOpsRow[]
}

interface SettingChange {
  date: string
  budget: number | null
  previousBudget: number | null
  targetRoas: number | null
  previousTargetRoas: number | null
}

const formatWon = (value: number | null) =>
  value == null ? '—' : `${Math.round(value).toLocaleString('ko-KR')}원`
const formatRoas = (value: number | null) =>
  value == null ? '—' : `${value.toLocaleString('ko-KR')}%`

export function FocusSettingHistory({ rows }: FocusSettingHistoryProps) {
  const changes = rows.reduce<SettingChange[]>((result, row, index) => {
    if (!row.setting_changed_on_date) return result
    const previous = index > 0 ? rows[index - 1] : null
    result.push({
      date: row.date,
      budget: row.budget,
      previousBudget: previous?.budget ?? null,
      targetRoas: row.target_roas,
      previousTargetRoas: previous?.target_roas ?? null,
    })
    return result
  }, [])

  return (
    <details className="bg-white rounded-xl border border-slate-200">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-slate-700">
        <History className="h-4 w-4 text-emerald-500" />
        예산·목표 ROAS 변경 이력
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{changes.length}건</span>
      </summary>
      <div className="border-t border-slate-100 px-4 py-3">
        {changes.length === 0 ? (
          <p className="text-xs text-slate-400">이 달에 기록된 설정 변경이 없습니다.</p>
        ) : (
          <ol className="space-y-2">
            {changes.map((change) => (
              <li key={change.date} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-[11px]">
                <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                  <Settings2 className="h-3.5 w-3.5 text-emerald-500" /> {change.date}
                </span>
                {(change.previousBudget !== change.budget || change.previousBudget == null) && (
                  <span className="text-slate-500">
                    예산 <b className="text-slate-700">{formatWon(change.previousBudget)}</b> → <b className="text-slate-700">{formatWon(change.budget)}</b>
                  </span>
                )}
                {(change.previousTargetRoas !== change.targetRoas || change.previousTargetRoas == null) && (
                  <span className="text-slate-500">
                    목표 ROAS <b className="text-slate-700">{formatRoas(change.previousTargetRoas)}</b> → <b className="text-slate-700">{formatRoas(change.targetRoas)}</b>
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  )
}
