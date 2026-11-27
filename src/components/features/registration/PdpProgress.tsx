'use client'

/**
 * 상세페이지(PDP) 잡 run 드라이버 — 브라우저가 드라이버다(§6.3): GET으로 현재 단계를 복원한 뒤
 * current_step이 done/failed가 될 때까지 POST run을 순차 재호출한다(서버 상주 프로세스 없음).
 * 6단계 스텝퍼 + images 단계 서브 진행(section_images 수/예상 총수) + 실패 시 단계 재시도.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, RotateCcw } from 'lucide-react'
import type { PdpJobRow } from '@/lib/registration/pdp-state'
import { PDP_STEP_PROGRESS, stripStepFailurePrefix } from '@/lib/registration/pdp-state'
import { PDP_STATUS_LABELS, PDP_UI_STEPS, PDP_STEP_LABELS, pdpApi } from '@/lib/registration/pdp-client'
import { LOCAL_CODEX_NOTICE, useLocalCodexAvailable } from './LocalCodexNotice'

// 순수 상한 고정값으로는 이미지 단계(장당 run 1회)가 완주 전에 잘릴 수 있다 — 최악 경로(단계당
// 재시도 + Pro 20여 장 이미지)를 감안한 절대 상한. 실제 종료는 아래 스톨 감지가 대부분 담당한다.
const ABSOLUTE_MAX_RUN_CALLS = 60

export function PdpProgress({
  jobId,
  onJobChange,
}: {
  jobId: string
  onJobChange?: (job: PdpJobRow) => void
}) {
  const localCodexAvailable = useLocalCodexAvailable()
  const [job, setJob] = useState<PdpJobRow | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const drive = useCallback(async () => {
    if (!localCodexAvailable) {
      setError(LOCAL_CODEX_NOTICE)
      return
    }
    setRunning(true)
    setError(null)
    try {
      // 스톨 감지 — 직전 응답과 (단계·section_images 수·progress)가 완전히 동일하면 더 돌려도
      // 진행되지 않는다는 뜻이므로 즉시 멈춘다(잡 상태 기반 종료, 고정 호출 수 상한 대신).
      let prevSignature: string | null = null
      for (let i = 0; i < ABSOLUTE_MAX_RUN_CALLS && aliveRef.current; i++) {
        const { job: updated } = await pdpApi<{ job: PdpJobRow }>(`/api/registration/pdp/${jobId}/run`, {
          method: 'POST',
        })
        if (!aliveRef.current) return
        setJob(updated)
        onJobChange?.(updated)
        if (updated.current_step === 'done' || updated.current_step === 'failed') return
        // cost_usd 포함: 게이트 재생성이 슬롯을 소비한 run은 단계·장수·진행률이 그대로여도
        // 비용은 증가한다 — 이를 스톨로 오탐하지 않기 위함(E2E 2026-08-10 실측)
        const signature = `${updated.current_step}:${updated.section_images.length}:${updated.progress}:${updated.cost_usd}`
        if (signature === prevSignature) return
        prevSignature = signature
      }
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : '실행 실패')
    } finally {
      if (aliveRef.current) setRunning(false)
    }
  }, [jobId, onJobChange, localCodexAvailable])

  // 탭 재진입 시 GET으로 복원 후, 미완료 잡이면 이어서 run
  useEffect(() => {
    let cancelled = false
    pdpApi<{ job: PdpJobRow }>(`/api/registration/pdp/${jobId}`)
      .then(({ job: loaded }) => {
        if (cancelled) return
        setJob(loaded)
        onJobChange?.(loaded)
        if (localCodexAvailable && loaded.current_step !== 'done' && loaded.current_step !== 'failed') void drive()
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : '잡 로드 실패'))
    return () => {
      cancelled = true
    }
    // localCodexAvailable은 hydration 뒤 확정되므로 localhost에서 한 번 더 복원해 자동 실행한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onJobChange 변경은 잡 재실행 사유가 아님
  }, [jobId, localCodexAvailable])

  if (!job) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
      </div>
    )
  }

  const failed = job.current_step === 'failed'
  // 실패 시 current_step 자체는 진행 단계명을 잃으므로, progress 값으로 실패 지점을 역추정한다
  // (PDP_STEP_PROGRESS는 PDP_UI_STEPS와 동일 순서로 오르는 값이므로 매치되는 스텝을 실패 지점으로 본다).
  const activeIdx = failed
    ? PDP_UI_STEPS.findIndex((s) => PDP_STEP_PROGRESS[s] === job.progress)
    : job.current_step === 'done'
      ? PDP_UI_STEPS.length
      : PDP_UI_STEPS.indexOf(job.current_step as (typeof PDP_UI_STEPS)[number])

  const expectedImages = Object.keys(job.design_prompts?.section_image_prompts ?? {}).length
  const generatedImages = job.section_images.length

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-700">{PDP_STATUS_LABELS[job.current_step]}</div>
          <div className="text-[11px] text-slate-400">{job.progress}%</div>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-full transition-all ${failed ? 'bg-danger-500' : 'bg-brand-500'}`}
            style={{ width: `${job.progress}%` }}
          />
        </div>

        <ol className="flex items-center gap-x-1.5 gap-y-2 flex-wrap">
          {PDP_UI_STEPS.map((step, i) => {
            const status = i < activeIdx ? 'done' : i === activeIdx ? (failed ? 'failed' : 'active') : 'pending'
            return (
              <li key={step} className="flex items-center gap-1">
                <span
                  className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border ${
                    status === 'done'
                      ? 'border-brand-200 bg-brand-50 text-brand-600'
                      : status === 'active'
                        ? 'border-brand-400 bg-brand-500 text-white'
                        : status === 'failed'
                          ? 'border-danger-200 bg-danger-50 text-danger-600'
                          : 'border-slate-200 text-slate-400'
                  }`}
                >
                  {status === 'done' && <Check className="w-3 h-3" />}
                  {status === 'active' && <Loader2 className="w-3 h-3 animate-spin" />}
                  {PDP_STEP_LABELS[step]}
                </span>
                {i < PDP_UI_STEPS.length - 1 && <span className="text-slate-300">→</span>}
              </li>
            )
          })}
        </ol>

        {job.current_step === 'images' && expectedImages > 0 && (
          <div className="text-[11px] text-slate-500">
            섹션 이미지 {generatedImages} / {expectedImages}장 생성됨
          </div>
        )}
      </section>

      {job.current_step !== 'done' && !running && (
        // 실패 여부와 무관하게 항상 노출 — 스톨 감지·절대 상한으로 루프가 멈춰도(완료 아님) 여기서
        // 이어갈 수 있어야 한다(§6.4). failed는 위험색, 그 외(스톨·상한 도달)는 경고색으로만 구분한다.
        <div
          className={`rounded-lg border px-3 py-2 space-y-2 ${
            failed ? 'border-danger-200 bg-danger-50' : 'border-warning-500/30 bg-warning-50'
          }`}
        >
          <div className={`text-xs ${failed ? 'text-danger-700' : 'text-warning-700'}`}>
            {failed
              ? `생성 실패: ${stripStepFailurePrefix(job.error) ?? '알 수 없는 오류'}`
              : job.error
                ? `진행 정체 — ${stripStepFailurePrefix(job.error)}`
                : '생성이 완료되지 않았습니다. 이어서 실행하세요.'}
          </div>
          <button
            onClick={() => void drive()}
            disabled={!localCodexAvailable || running}
            title={localCodexAvailable ? undefined : LOCAL_CODEX_NOTICE}
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full text-white disabled:opacity-50 ${
              failed ? 'bg-danger-500 hover:bg-danger-600' : 'bg-warning-500 hover:bg-warning-600'
            }`}
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            {failed ? '이 단계부터 재시도' : '계속 실행'}
          </button>
        </div>
      )}
      {error && <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">{error}</div>}
    </div>
  )
}
