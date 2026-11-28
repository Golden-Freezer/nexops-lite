'use client'

/**
 * 상세페이지(PDP) 진행 화면의 그리는 몫 — 훅 없는 순수 컴포넌트(PdpProgress가 상태·호출을 갖고 이 화면을 그린다).
 * 진행 표시(단계·막대·이미지 수·작업자 안내) + 멈춤 상자(구독 멈춤 표지 잡, AX-CT-29) + '계속 실행/이 단계부터 재시도' 칸 + 오류 줄.
 * 표지 없는 잡은 멈춤 상자가 없고 단추는 지금처럼 run(onDrive)을 부른다. 멈춤 표지 잡은 '이어 하기'와 실패 '다시 시도'가
 * resume(onResume)을 부른다(웹은 이 잡을 진행하지 않는다). 렌더 시험: PdpProgressView.test.tsx
 */

import { Check, Loader2, RotateCcw } from 'lucide-react'
import type { PdpJobRow } from '@/lib/registration/pdp-state'
import { PDP_STEP_PROGRESS, stripStepFailurePrefix } from '@/lib/registration/pdp-state'
import { PDP_STATUS_LABELS, PDP_UI_STEPS, PDP_STEP_LABELS, pdpApi } from '@/lib/registration/pdp-client'
import { sectionImageProgress } from '@/lib/registration/pdp-progress-count'
import {
  PDP_BUSY_GIVE_UP,
  WORKER_ACTIVE_NOTE,
  bearerHeaders,
  subscriptionHaltMessage,
  subscriptionHaltOf,
  withAuthRetry,
  workerGiveUpMessage,
  type AuthRetryDeps,
  type PdpDriveEnd,
} from '@/lib/registration/pdp-run-driver'

/** 이어 하기 — POST /api/registration/pdp/[jobId]/resume(401이면 토큰을 새로 받아 다시 보낸다) */
export function requestPdpResume(
  jobId: string,
  deps: AuthRetryDeps,
  api: typeof pdpApi = pdpApi
): Promise<{ job: PdpJobRow }> {
  return withAuthRetry(
    (token) => api<{ job: PdpJobRow }>(`/api/registration/pdp/${jobId}/resume`, { method: 'POST', headers: bearerHeaders(token) }),
    deps
  )
}

/**
 * drive가 끝난 까닭에 띄울 글 — 잠금·작업자 대기 상한만(정체·호출 수 상한은 '계속 실행' 칸이 알린다).
 * 구독 멈춤 표지 잡은 서버가 넘겨받지 않으므로 차례 대기 문구(표지 없는 잡은 지금 문구 그대로)
 */
export function driveEndMessage(end: PdpDriveEnd, stopJob: boolean): string | null {
  if (end === 'busy') return PDP_BUSY_GIVE_UP
  if (end === 'worker-stale' || end === 'worker-limit') return workerGiveUpMessage(end, undefined, stopJob)
  return null
}

export interface PdpProgressViewProps {
  job: PdpJobRow
  running: boolean
  resuming: boolean
  workerActive: boolean
  error: string | null
  onDrive: () => void
  onResume: () => void
}

export function PdpProgressView({ job, running, resuming, workerActive, error, onDrive, onResume }: PdpProgressViewProps) {
  const failed = job.current_step === 'failed'
  const halt = subscriptionHaltOf(job)
  const stopJob = job.subscription_stop === true
  // 실패 시 current_step 자체는 진행 단계명을 잃으므로, progress 값으로 실패 지점을 역추정한다
  // (PDP_STEP_PROGRESS는 PDP_UI_STEPS와 동일 순서로 오르는 값이므로 매치되는 스텝을 실패 지점으로 본다).
  const activeIdx = failed
    ? PDP_UI_STEPS.findIndex((s) => PDP_STEP_PROGRESS[s] === job.progress)
    : job.current_step === 'done'
      ? PDP_UI_STEPS.length
      : PDP_UI_STEPS.indexOf(job.current_step as (typeof PDP_UI_STEPS)[number])

  // K 라인 잡은 대표 컷 + 계획 컷으로 센다(운영 첫 K 잡 '23 / 8장'), 그 밖은 지금 그대로
  const { generated: generatedImages, expected: expectedImages } = sectionImageProgress(job)

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
        {running && workerActive && (
          <div className="text-[11px] text-brand-600">
            {WORKER_ACTIVE_NOTE} 지금까지 비용 ${job.cost_usd.toFixed(3)}
          </div>
        )}
      </section>

      {halt && job.current_step !== 'done' && !running && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 space-y-2">
          <div className="text-xs text-danger-700">
            {subscriptionHaltMessage(halt, PDP_STEP_LABELS[halt.stage as keyof typeof PDP_STEP_LABELS] ?? halt.stage)}
          </div>
          <button
            onClick={() => onResume()}
            disabled={resuming}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full text-white bg-danger-500 hover:bg-danger-600 disabled:opacity-50"
          >
            {resuming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            이어 하기
          </button>
        </div>
      )}

      {!halt && job.current_step !== 'done' && !running && (
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
            /* 구독 멈춤 표지 잡은 웹이 진행하지 않는다 — 실패 '다시 시도'도 resume이 한다(작업자 대기로 돌아간다) */
            onClick={() => (failed && stopJob ? onResume() : onDrive())}
            disabled={running || resuming}
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
