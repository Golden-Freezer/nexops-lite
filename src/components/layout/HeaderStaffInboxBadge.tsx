'use client'

// 헤더 미처리 보고 뱃지 (오너 전용) — AI 직원 보고함(submitted/failed)이 있을 때만 노출.
// HeaderWorkerControl 선례를 따르되 폴링 없이 마운트 시 1회 조회(저비용) — 최신화는 페이지 진입 시.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bot } from 'lucide-react'

export function HeaderStaffInboxBadge() {
  const [pending, setPending] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch('/api/ai-staff/reports')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.data) return
        // 서버 정확 집계 우선 (최근 50건 창 밖의 미처리 보고 누락 방지) — 구응답 폴백은 창 내 카운트
        if (typeof json.data.pendingCount === 'number') {
          setPending(json.data.pendingCount)
          return
        }
        if (!json.data.reports) return
        const count = (json.data.reports as Array<{ status: string }>).filter(
          (r) => r.status === 'submitted' || r.status === 'failed'
        ).length
        setPending(count)
      })
      .catch(() => {
        // 뱃지는 부가 정보 — 조회 실패 시 조용히 미노출 (헤더를 깨지 않는다)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (pending === 0) return null

  return (
    <Link
      href="/ai-staff"
      className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-700 hover:bg-amber-200"
      title={`AI 직원 미처리 보고 ${pending}건`}
    >
      <Bot className="h-3.5 w-3.5" />
      {pending}
    </Link>
  )
}
