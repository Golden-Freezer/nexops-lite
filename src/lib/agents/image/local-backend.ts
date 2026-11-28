/**
 * 로컬 이미지 백엔드 레지스트리 (C1, 설계 §4.9) — 등록·조회만 담당하며 child_process를 쓰지 않는다.
 *
 * codex-image처럼 이 PC의 구독 로그인으로만 돌 수 있는 생성 수단은 로컬 프로세스(실 테스트 하네스·
 * 콘텐츠 실행기)가 시작할 때 등록한다. Vercel 번들에는 등록 코드가 없으므로 generateImage는 명시 오류로 실패한다.
 * 코덱스 CLI 래퍼 구현은 Next 번들 밖 `scripts/content-runner/codex-image-backend.mjs`에 있다.
 *
 * 소프트 종료: 구독 한도 소진·시간 초과는 잡을 failed로 만들 사유가 아니다(재개 가능). 백엔드가 그런 오류를
 * 던지면 generate.ts가 여기에 기록하고, 하네스는 run 사이에 peekLocalBackendSoftStop()을 보고 멈춘다.
 * 섹션 오류 문자열에는 LOCAL_BACKEND_SOFT_STOP_MARKER가 남아 재개 때 다시 만들 컷을 식별할 수 있다.
 */

import type { CodexTrace, ImageModel, ImageQuality, ReferenceImage } from './types'
import type { RunContext } from '@/lib/agents/types'

export type LocalImageModel = Extract<ImageModel, 'codex-image'>

export interface LocalImageRequest {
  prompt: string
  /** 'WxH' — 백엔드는 이 비율을 목표 화면비로 삼는다(출력 픽셀 크기는 백엔드 기본값) */
  size: string
  quality?: ImageQuality
  referenceImages: ReferenceImage[]
  agentName: string
  runContext?: RunContext
}

export interface LocalImageOutput {
  base64: string
  mimeType: string
  /** 코덱스 전용 홈 실행의 재작성 기록(E1) — 있을 때만 */
  trace?: CodexTrace
}

export type LocalImageBackend = (request: LocalImageRequest) => Promise<LocalImageOutput>

/** codex-image-backend.mjs와 같은 값이어야 한다(그쪽 테스트가 대조) */
export const LOCAL_BACKEND_SOFT_STOP_MARKER = '[local-backend:soft-stop]'

export type LocalBackendSoftStopReason = 'quota' | 'timeout'

export interface LocalBackendSoftStop {
  model: LocalImageModel
  reason: LocalBackendSoftStopReason
  message: string
  at: string
}

interface RegistryState {
  backends: Map<LocalImageModel, LocalImageBackend>
  softStop: LocalBackendSoftStop | null
}

// 하네스가 다른 경로로 같은 모듈을 다시 불러와도 등록이 하나로 유지되게 전역 심볼에 둔다
const REGISTRY_KEY = Symbol.for('nexops.agents.image.localBackends')

function registry(): RegistryState {
  const store = globalThis as unknown as Record<symbol, RegistryState | undefined>
  let state = store[REGISTRY_KEY]
  if (!state) {
    state = { backends: new Map(), softStop: null }
    store[REGISTRY_KEY] = state
  }
  return state
}

/** 백엔드를 등록하고 해제 함수를 돌려준다. 다른 백엔드가 이미 있으면 덮어쓰지 않고 throw한다. */
export function registerLocalImageBackend(model: LocalImageModel, backend: LocalImageBackend): () => void {
  const { backends } = registry()
  const existing = backends.get(model)
  if (existing && existing !== backend) {
    throw new Error(`${model} 로컬 백엔드가 이미 등록돼 있습니다 — 먼저 해제하세요.`)
  }
  backends.set(model, backend)
  return () => {
    if (backends.get(model) === backend) backends.delete(model)
  }
}

export function getLocalImageBackend(model: LocalImageModel): LocalImageBackend | undefined {
  return registry().backends.get(model)
}

/** 테스트·실행기 종료용 — 등록과 소프트 종료 기록을 모두 지운다 */
export function clearLocalImageBackends(): void {
  const state = registry()
  state.backends.clear()
  state.softStop = null
}

/**
 * 오류가 소프트 종료 대상이면 사유를, 아니면 null을 돌려준다.
 * 백엔드 오류 객체의 softStop·softStopReason 표지를 먼저 보고, 없으면 메시지의 표지 문자열을 본다.
 */
export function softStopReasonOf(error: unknown): LocalBackendSoftStopReason | null {
  if (error && typeof error === 'object') {
    const marked = error as { softStop?: unknown; softStopReason?: unknown }
    if (marked.softStop === true) {
      return marked.softStopReason === 'timeout' ? 'timeout' : 'quota'
    }
  }
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const at = message.indexOf(LOCAL_BACKEND_SOFT_STOP_MARKER)
  if (at === -1) return null
  // 표지 바로 뒤의 `quota:`·`timeout:`만 읽는다 — 상세 문구의 단어로 사유를 추측하지 않는다
  const reason = /^\s*(quota|timeout):/.exec(message.slice(at + LOCAL_BACKEND_SOFT_STOP_MARKER.length))?.[1]
  return reason === 'timeout' ? 'timeout' : 'quota'
}

export function noteLocalBackendSoftStop(entry: LocalBackendSoftStop): void {
  registry().softStop = entry
}

export function peekLocalBackendSoftStop(): LocalBackendSoftStop | null {
  return registry().softStop
}

export function clearLocalBackendSoftStop(): void {
  registry().softStop = null
}
