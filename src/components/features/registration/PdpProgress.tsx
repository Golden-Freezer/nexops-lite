'use client'

/**
 * 상세페이지(PDP) 잡 run 드라이버 — 브라우저가 드라이버다(§6.3): GET으로 현재 단계를 복원한 뒤
 * current_step이 done/failed가 될 때까지 POST run을 순차 재호출한다(서버 상주 프로세스 없음).
 * 6단계 스텝퍼 + images 단계 서브 진행(section_images 수/예상 총수) + 실패 시 단계 재시도.
 * 탭이 뒤에 있다 돌아와도 멈추지 않는다(R12a): /run 401은 토큰을 새로 받아 다시 보내고, 탭이 다시 보이면 미완료 잡을 이어 간다.
 * 구독 작업자 잡(R13)은 작업자가 끝낼 때까지 기다리며 받은 잡을 그린다(R13c, busy + worker — 잠금 busy 상한 밖).
 * 구독 멈춤 표지 잡(AX-CT-29)이 멈추면(halted) 대기를 멈추고 멈춤 상자를 띄운다 — '이어 하기'(resume API)가 작업자 대기로 되돌린다.
 * 이 잡의 실패 '다시 시도'도 같은 resume을 부른다(웹은 이 잡을 진행하지 않는다). 그리는 몫은 PdpProgressView(훅 없음, 렌더 시험).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth/clerk-shim'
import { Loader2 } from 'lucide-react'
import type { PdpJobRow } from '@/lib/registration/pdp-state'
import { pdpApi } from '@/lib/registration/pdp-client'
import {
  authGiveUpMessage,
  bearerHeaders,
  createSingleFlight,
  drivePdpJob,
  isTerminalStep,
  isUnauthorized,
  onTabVisible,
  shouldResumeOnVisible,
  subscriptionHaltOf,
  withAuthRetry,
  type PdpRunResponse,
} from '@/lib/registration/pdp-run-driver'
import { PdpProgressView, driveEndMessage, requestPdpResume } from './PdpProgressView'
import { LOCAL_CODEX_NOTICE, useLocalCodexAvailable } from './LocalCodexNotice'

// run 반복 규칙(호출 수 상한·busy 대기·정체 감지·401 다시 보내기)은 pdp-run-driver.ts에 있다 — 이 화면은 상태만 그린다
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function PdpProgress({
  jobId,
  onJobChange,
}: {
  jobId: string
  onJobChange?: (job: PdpJobRow) => void
}) {
  const { getToken } = useAuth()
  const localCodexAvailable = useLocalCodexAvailable()
  const [job, setJob] = useState<PdpJobRow | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 마지막 run 응답이 구독 작업자 진행(busy + worker)이었는지 — 안내 줄만 바꾼다
  const [workerActive, setWorkerActive] = useState(false)
  // 이어 하기(resume) 호출 중
  const [resuming, setResuming] = useState(false)
  const aliveRef = useRef(true)
  // 탭 복귀 판정용 최신 잡(state는 이벤트 처리기 안에서 낡은 값을 본다)
  const jobRef = useRef<PdpJobRow | null>(null)
  // drive는 잡마다 하나 — 첫 불러오기·버튼·탭 복귀(visibilitychange·pageshow가 겹쳐 와도)가 같은 문을 지난다.
  // 잡이 바뀌면 새 문이다(옛 잡 drive가 새 잡을 막지 않는다 — 지금까지와 같다)
  const { flight } = useMemo(() => ({ jobId, flight: createSingleFlight() }), [jobId])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const showJob = useCallback(
    (next: PdpJobRow) => {
      jobRef.current = next
      setJob(next)
      onJobChange?.(next)
    },
    [onJobChange]
  )

  // 401이면 토큰을 새로 받고 쉬었다 다시 보낸다(R12a) — 탭이 뒤에 있던 사이 낡은 세션 토큰으로 첫 호출이 거절되는 일
  const authDeps = useMemo(
    () => ({ refreshToken: () => getToken({ skipCache: true }), sleep, alive: () => aliveRef.current }),
    [getToken]
  )

  const drive = useCallback(() => {
    if (!localCodexAvailable) {
      setError(LOCAL_CODEX_NOTICE)
      return
    }
    void flight.run(async () => {
      setRunning(true)
      setError(null)
      try {
        const end = await drivePdpJob({
          ...authDeps,
          runOnce: (token) =>
            pdpApi<PdpRunResponse>(`/api/registration/pdp/${jobId}/run`, {
              method: 'POST',
              headers: bearerHeaders(token),
            }),
          onJob: showJob,
          onWorker: (active) => aliveRef.current && setWorkerActive(active),
        })
        // 잠금·작업자 대기 상한은 조용히 멈추지 않고 사유를 띄운다. 정체·호출 수 상한은 아래 '계속 실행' 칸이 알린다
        if (!aliveRef.current) return
        // 구독 멈춤 표지 잡은 서버가 넘겨받지 않는다 — 차례 대기 문구(표지 없는 잡은 그대로)
        const message = driveEndMessage(end, jobRef.current?.subscription_stop === true)
        if (message) setError(message)
      } catch (e) {
        if (aliveRef.current) setError(isUnauthorized(e) ? authGiveUpMessage(e) : e instanceof Error ? e.message : '실행 실패')
      } finally {
        if (aliveRef.current) {
          setRunning(false)
          setWorkerActive(false)
        }
      }
    })
  }, [flight, authDeps, jobId, localCodexAvailable, showJob])

  // 탭 재진입 시 GET으로 복원 후, 미완료 잡이면 이어서 run
  useEffect(() => {
    let cancelled = false
    withAuthRetry(
      (token) => pdpApi<{ job: PdpJobRow }>(`/api/registration/pdp/${jobId}`, { headers: bearerHeaders(token) }),
      { ...authDeps, alive: () => !cancelled && aliveRef.current }
    )
      .then(({ job: loaded }) => {
        if (cancelled) return
        showJob(loaded)
        // 멈춤 기록이 있으면 대기하지 않는다 — 멈춤 상자의 '이어 하기'가 다시 시작한다
        if (localCodexAvailable && !isTerminalStep(loaded.current_step) && !subscriptionHaltOf(loaded)) drive()
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : '잡 로드 실패'))
    return () => {
      cancelled = true
    }
    // localhost 판정이 끝나면 한 번 다시 불러 자동 진행한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drive는 jobId와 localhost 판정에 종속
  }, [jobId, localCodexAvailable])

  // 이어 하기(구독 멈춤 표지 잡, AX-CT-29) — 멈춤 기록·오류를 지우고(실패면 다시 돌릴 단계로) 작업자 대기로 돌아간다
  const resume = useCallback(async () => {
    if (!localCodexAvailable) {
      setError(LOCAL_CODEX_NOTICE)
      return
    }
    setResuming(true)
    setError(null)
    try {
      const { job: resumed } = await requestPdpResume(jobId, authDeps)
      if (!aliveRef.current) return
      showJob(resumed)
      drive()
    } catch (e) {
      if (aliveRef.current) setError(isUnauthorized(e) ? authGiveUpMessage(e) : e instanceof Error ? e.message : '이어 하기 실패')
    } finally {
      if (aliveRef.current) setResuming(false)
    }
  }, [authDeps, jobId, localCodexAvailable, showJob, drive])

  // 탭이 다시 보이면 미완료 잡을 바로 이어 간다(R12a) — 도는 drive가 있으면 그대로 두고, 실패 잡 재시도는 사람이 누른다
  useEffect(
    () =>
      onTabVisible(document, window, () => {
        const latest = jobRef.current?.id === jobId ? jobRef.current : null
        if (localCodexAvailable && shouldResumeOnVisible(latest, flight.running())) drive()
      }),
    [flight, drive, jobId, localCodexAvailable]
  )

  if (!job) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {!localCodexAvailable && (
        <div className="rounded-lg border border-warning-500/30 bg-warning-50 px-3 py-2 text-xs text-warning-700">
          {LOCAL_CODEX_NOTICE}
        </div>
      )}
      <PdpProgressView
        job={job}
        running={running}
        resuming={resuming}
        workerActive={workerActive}
        error={error}
        onDrive={() => void drive()}
        onResume={() => void resume()}
      />
    </div>
  )
}
