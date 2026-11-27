'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { fmtShort } from '@/lib/analytics/format'
import type { SkuProfitability } from '@/types/settlement'

export function ProductProfitRankingSection({
  periodStart,
  periodEnd,
}: {
  periodStart: string
  periodEnd: string
}) {
  const [ranking, setRanking] = useState<SkuProfitability[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ periodStart, periodEnd })
    setLoading(true)
    setError(null)

    apiFetch(`/api/settlement/ranking?${params}`)
      .then(async (response) => {
        const json = await response.json()
        if (!response.ok) throw new Error(json.error || '상품 수익 랭킹 조회 실패')
        if (!cancelled) setRanking(json.data || [])
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '상품 수익 랭킹 조회 실패')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [periodEnd, periodStart])

  const profitable = ranking.filter((item) => !item.isLoss)
  const losses = ranking.filter((item) => item.isLoss).sort((a, b) => a.totalNetProfit - b.totalNetProfit)

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">상품별 추정 순이익 Top</h3>
          <p className="mt-0.5 text-[10px] text-slate-400">광고비·운영비 배부 반영</p>
        </div>
        <Link
          href="/settlement"
          className="flex items-center gap-0.5 text-[10px] text-brand-600 hover:text-brand-700"
        >
          전체 <ArrowRight className="h-2.5 w-2.5" />
        </Link>
      </div>

      <div className="px-4 py-3">
        {loading ? (
          <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-slate-400" />
        ) : error ? (
          <p className="py-8 text-center text-xs text-slate-400">{error}</p>
        ) : ranking.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-400">데이터 없음</p>
        ) : (
          <div className="space-y-2">
            {profitable.slice(0, 5).map((item) => (
              <div key={item.productId} className="rounded-lg px-1 py-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      item.rank <= 3 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {item.rank}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-700" title={item.productName}>
                    {item.productName}
                  </span>
                  <span className="shrink-0 font-mono text-xs font-semibold text-blue-600">
                    {fmtShort(item.totalNetProfit)}원
                  </span>
                </div>
                <div className="ml-7 mt-1 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-blue-400"
                      style={{ width: `${Math.min(100, item.contributionRate * 100)}%` }}
                    />
                  </div>
                  <span className="w-11 text-right text-[9px] text-slate-400">
                    기여 {(item.contributionRate * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}

            {losses.length > 0 && (
              <div className="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-red-700">
                  <AlertTriangle className="h-3 w-3" /> 적자 상품 {losses.length}개
                </div>
                {losses.slice(0, 2).map((item) => (
                  <div key={item.productId} className="flex items-center gap-2 py-0.5 text-[10px]">
                    <span className="min-w-0 flex-1 truncate text-red-700">{item.productName}</span>
                    <span className="shrink-0 font-mono font-semibold text-red-600">
                      {fmtShort(item.totalNetProfit)}원
                    </span>
                  </div>
                ))}
              </div>
            )}

            <p className="pt-1 text-[9px] text-slate-400">
              직접 연결 광고는 귀속, 미연결 광고·운영비는 매출 비중으로 배부한 추정치입니다.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
