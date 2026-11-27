'use client'

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { fmtShort } from '@/lib/analytics/format'
import type { PeriodTile } from '@/lib/analytics/types'

/** 기간 타일 4장 (오늘/어제/이번달/지난달) — 자기완결 섹션. 기간은 서버가 결정(고정 4기간) */
export function PeriodTilesSection() {
  const [tiles, setTiles] = useState<PeriodTile[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch('/api/analytics/tiles')
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        if (json.error) setError(json.error)
        else setTiles(json.data.tiles)
      })
      .catch(() => { if (!cancelled) setError('조회 실패') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-200 shadow-card p-4 flex items-center justify-center min-h-[120px]">
            <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
          </div>
        ))}
      </div>
    )
  }
  if (error || !tiles) return null

  // 신규 사용자(전 기간 0)면 섹션 전체 미렌더 — 홈의 시작하기 가이드를 가리지 않음
  const allZero = tiles.every((t) => t.revenue === 0 && t.adSpend === 0 && t.expenses === 0)
  if (allZero) return null

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {tiles.map((t) => (
        <Tile key={t.key} tile={t} />
      ))}
    </div>
  )
}

function Tile({ tile }: { tile: PeriodTile }) {
  const dateText =
    tile.startDate === tile.endDate
      ? tile.startDate.slice(5)
      : `${tile.startDate.slice(5)} ~ ${tile.endDate.slice(5)}`

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-slate-500">{tile.label}</span>
        <span className="text-[10px] text-slate-400">{dateText}</span>
      </div>
      {/* 주인공은 순이익 */}
      <p className={`text-xl font-bold font-mono ${tile.netProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
        {tile.netProfit < 0 ? '-' : ''}{fmtShort(Math.abs(tile.netProfit))}
        <span className="text-[10px] font-normal text-slate-400 ml-0.5">원</span>
      </p>
      <div className="mt-2 space-y-1 text-[11px]">
        <TileRow label="매출" value={tile.revenue} />
        <TileRow label="광고비" value={tile.adSpend} />
        <TileRow label="예상 정산금 (추정)" value={tile.estimatedPayout} />
      </div>
    </div>
  )
}

function TileRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono font-medium text-slate-700">
        {value < 0 ? '-' : ''}{fmtShort(Math.abs(value))}원
      </span>
    </div>
  )
}
