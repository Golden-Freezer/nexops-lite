'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, ChevronDown, ChevronUp, Scale, AlertTriangle } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import type { ReconciliationRow } from '@/types/settlement-recon'
import { SettlementReconcileBriefing } from './SettlementReconcileBriefing'

const fmt = (v: number) => Math.ceil(v).toLocaleString('ko-KR')

function periodLabel(row: ReconciliationRow): string {
  if (row.periodStart && row.periodEnd) return `${row.periodStart.slice(0, 10)} ~ ${row.periodEnd.slice(0, 10)}`
  return row.cycle ?? row.settlementGroupKey
}

// ── 정산주기 1건 카드 ──
function ReconcileCard({ row }: { row: ReconciliationRow }) {
  const [expanded, setExpanded] = useState(false)
  const shortfall = row.totalDiff < 0 // 쿠팡 확정 지급액이 우리 예상 지급액보다 적음 = 경고

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-slate-50"
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-400">{row.cycle || row.settlementGroupKey}</p>
          <p className="text-sm font-medium text-slate-700 truncate">{periodLabel(row)}</p>
          {row.settlementDate && <p className="text-[10px] text-slate-400">지급일 {row.settlementDate.slice(0, 10)}</p>}
        </div>

        <div className="hidden sm:grid grid-cols-3 gap-4 text-right shrink-0">
          <div>
            <p className="text-[10px] text-slate-400">우리 예상 지급액</p>
            <p className="text-sm font-mono text-slate-700">{fmt(row.ourEstimatedPayout)}원</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400">쿠팡 확정 지급액</p>
            <p className="text-sm font-mono text-slate-700">{fmt(row.coupangFinalPayout)}원</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400">실제 계좌입금</p>
            <p className="text-sm font-mono text-slate-700">{row.actualDeposit != null ? `${fmt(row.actualDeposit)}원` : '미확인'}</p>
          </div>
        </div>

        <div className="text-right shrink-0 w-28">
          <p className="text-[10px] text-slate-400">차액(확정−예상)</p>
          <p className={`text-sm font-mono font-semibold flex items-center justify-end gap-1 ${shortfall ? 'text-red-600' : 'text-blue-600'}`}>
            {shortfall && <AlertTriangle className="w-3.5 h-3.5" />}
            {row.totalDiff >= 0 ? '+' : ''}{fmt(row.totalDiff)}원
          </p>
        </div>

        {expanded ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
      </button>

      {/* 모바일 3열 요약(헤더에서 숨긴 경우) */}
      <div className="sm:hidden grid grid-cols-3 gap-2 px-4 pb-3 text-center text-[10px]">
        <div><p className="text-slate-400">우리 예상 지급액</p><p className="font-mono text-slate-700">{fmt(row.ourEstimatedPayout)}</p></div>
        <div><p className="text-slate-400">쿠팡 확정 지급액</p><p className="font-mono text-slate-700">{fmt(row.coupangFinalPayout)}</p></div>
        <div><p className="text-slate-400">실제 계좌입금</p><p className="font-mono text-slate-700">{row.actualDeposit != null ? fmt(row.actualDeposit) : '미확인'}</p></div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-2 py-1.5 font-medium text-slate-500">항목</th>
                  <th className="text-right px-2 py-1.5 font-medium text-slate-500">우리 계산</th>
                  <th className="text-right px-2 py-1.5 font-medium text-slate-500">쿠팡 확정</th>
                  <th className="text-right px-2 py-1.5 font-medium text-slate-500">차액</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {row.lines.map((line) => (
                  <tr key={line.label}>
                    <td className="px-2 py-1.5 text-slate-700">
                      {line.label}
                      {line.ourBlindSpot && (
                        <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 align-middle">
                          우리가 못 잡던 비용
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-500">{line.ours != null ? fmt(line.ours) : '—'}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-700">{fmt(line.coupang)}</td>
                    <td className={`px-2 py-1.5 text-right font-mono ${line.diff < 0 ? 'text-red-600' : 'text-blue-600'}`}>
                      {line.diff >= 0 ? '+' : ''}{fmt(line.diff)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SettlementReconcileBriefing groupKey={row.settlementGroupKey} />
        </div>
      )}
    </div>
  )
}

// ── 정산 대조 탭 본체 ──
export function SettlementReconcile() {
  const [rows, setRows] = useState<ReconciliationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/settlement/reconcile')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '정산 대조 조회에 실패했습니다.')
      setRows((json.data || []) as ReconciliationRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : '정산 대조 조회 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
  }

  if (error) {
    return <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
  }

  if (rows.length === 0) {
    return (
      <div className="text-center py-12">
        <Scale className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">아직 수집된 정산이 없습니다.</p>
        <p className="text-xs text-slate-400 mt-1">확장으로 윙 정산현황 페이지를 열면 자동 수집됩니다.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <ReconcileCard key={row.settlementGroupKey} row={row} />
      ))}
    </div>
  )
}
