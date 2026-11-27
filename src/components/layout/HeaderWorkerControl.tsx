'use client'

/**
 * 헤더 전역 워커 제어 (오너 전용) — 어느 화면에서나 MASTER 수집 워커 상태를 보이고
 * 한 번에 실행/정지할 수 있게 한다. ai-sourcing 페이지의 CollectionStatusMonitor와
 * 동일한 API(GET collection-status · POST worker-control)를 재사용한다.
 *
 * 배포(Vercel) 한계: run/pause는 제어 이벤트만 기록하며, 실제 수집은 오너 PC의 로컬
 * 워커 데몬이 그 이벤트를 읽어야 동작한다. 데몬이 안 떠 있으면(alive=false) '오프라인'으로
 * 표시하고, 로컬(dev)에서는 start-local로 데몬을 띄운다.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pause, Play, MonitorUp } from 'lucide-react'

interface WorkerStatus {
  desiredState: 'run' | 'pause'
  alive: boolean
  lastHeartbeatAt: string | null
}

export function HeaderWorkerControl() {
  const [worker, setWorker] = useState<WorkerStatus | null>(null)
  const [acting, setActing] = useState(false)
  const [isLocalhost, setIsLocalhost] = useState(false)

  useEffect(() => {
    setIsLocalhost(window.location.hostname === 'localhost')
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sourcing/collection-status')
      if (!res.ok) return
      const json = await res.json()
      setWorker(json.data?.worker ?? null)
    } catch {
      /* 헤더 위젯 — 조회 실패는 조용히 무시(다음 폴링에서 복구) */
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [load])

  async function control(action: 'run' | 'pause' | 'start-local') {
    if (acting) return
    setActing(true)
    try {
      const res = await fetch('/api/sourcing/worker-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok) await load()
    } catch {
      /* 무시 — 다음 폴링에서 상태 반영 */
    } finally {
      setActing(false)
    }
  }

  if (!worker) return null

  const offline = !worker.alive
  const running = worker.alive && worker.desiredState === 'run'

  const chip = offline
    ? { label: '워커 오프라인', dot: 'bg-slate-400', text: 'text-slate-500' }
    : running
      ? { label: '수집 중', dot: 'bg-brand-500', text: 'text-brand-700' }
      : { label: '정지됨', dot: 'bg-warning-500', text: 'text-warning-700' }

  return (
    <div className="flex items-center gap-1.5 shrink-0" title={worker.lastHeartbeatAt ? `마지막 신호: ${new Date(worker.lastHeartbeatAt).toLocaleString('ko-KR')}` : '워커 데몬 신호 없음'}>
      <span className={`hidden lg:inline-flex items-center gap-1.5 text-xs font-medium ${chip.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${chip.dot} ${running ? 'animate-pulse' : ''}`} />
        {chip.label}
      </span>

      {/* 오프라인 + 로컬: 데몬 기동. 그 외: run/pause 토글 */}
      {offline && isLocalhost ? (
        <button
          onClick={() => control('start-local')}
          disabled={acting}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-50"
          title="로컬 워커 데몬 기동"
        >
          {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MonitorUp className="w-3.5 h-3.5" />}
          <span className="hidden md:inline">워커 실행</span>
        </button>
      ) : running ? (
        <button
          onClick={() => control('pause')}
          disabled={acting}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50"
          title="수집 정지"
        >
          {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />}
          <span className="hidden md:inline">정지</span>
        </button>
      ) : (
        <button
          onClick={() => control('run')}
          disabled={acting}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-50"
          title={offline ? '데몬이 오프라인입니다 — PC에서 워커를 시작하세요' : '수집 실행'}
        >
          {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          <span className="hidden md:inline">실행</span>
        </button>
      )}
    </div>
  )
}
