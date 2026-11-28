import { afterEach, describe, expect, it } from 'vitest'
import {
  clearLocalBackendSoftStop,
  clearLocalImageBackends,
  getLocalImageBackend,
  LOCAL_BACKEND_SOFT_STOP_MARKER,
  noteLocalBackendSoftStop,
  peekLocalBackendSoftStop,
  registerLocalImageBackend,
  softStopReasonOf,
  type LocalImageBackend,
} from './local-backend'

const backend: LocalImageBackend = async () => ({ base64: 'aGk=', mimeType: 'image/png' })

afterEach(() => clearLocalImageBackends())

describe('local image backend registry', () => {
  it('등록하면 조회되고, 해제 함수로 지운다', () => {
    expect(getLocalImageBackend('codex-image')).toBeUndefined()
    const unregister = registerLocalImageBackend('codex-image', backend)
    expect(getLocalImageBackend('codex-image')).toBe(backend)
    unregister()
    expect(getLocalImageBackend('codex-image')).toBeUndefined()
  })

  it('다른 백엔드가 이미 있으면 덮어쓰지 않고 throw한다', () => {
    registerLocalImageBackend('codex-image', backend)
    expect(() => registerLocalImageBackend('codex-image', async () => ({ base64: 'eA==', mimeType: 'image/png' }))).toThrow(
      /이미 등록/,
    )
    expect(() => registerLocalImageBackend('codex-image', backend)).not.toThrow()
  })

  it('해제 함수는 자기 백엔드일 때만 지운다', () => {
    const unregisterOld = registerLocalImageBackend('codex-image', backend)
    unregisterOld()
    const other: LocalImageBackend = async () => ({ base64: 'eA==', mimeType: 'image/png' })
    registerLocalImageBackend('codex-image', other)
    unregisterOld()
    expect(getLocalImageBackend('codex-image')).toBe(other)
  })

  it('전역 심볼에 두어 모듈을 다시 불러와도 같은 등록을 본다', async () => {
    registerLocalImageBackend('codex-image', backend)
    const key = Symbol.for('nexops.agents.image.localBackends')
    const state = (globalThis as unknown as Record<symbol, { backends: Map<string, unknown> }>)[key]
    expect(state.backends.get('codex-image')).toBe(backend)
  })
})

describe('soft stop', () => {
  it('오류 객체 표지에서 사유를 읽는다', () => {
    expect(softStopReasonOf(Object.assign(new Error('x'), { softStop: true, softStopReason: 'timeout' }))).toBe('timeout')
    expect(softStopReasonOf(Object.assign(new Error('x'), { softStop: true, softStopReason: 'quota' }))).toBe('quota')
  })

  it('메시지 표지 문자열로도 판별한다(섹션 오류 문자열 재판독)', () => {
    expect(softStopReasonOf(`images/hero 생성 실패: ${LOCAL_BACKEND_SOFT_STOP_MARKER} timeout: 시간 초과`)).toBe('timeout')
    expect(softStopReasonOf(new Error(`${LOCAL_BACKEND_SOFT_STOP_MARKER} quota: 한도`))).toBe('quota')
  })

  it('사유는 표지 바로 뒤에서만 읽는다(상세 문구의 timeout 단어에 속지 않는다)', () => {
    expect(softStopReasonOf(`${LOCAL_BACKEND_SOFT_STOP_MARKER} quota: request timeout while checking usage limit`)).toBe('quota')
  })

  it('일반 오류는 소프트 종료가 아니다', () => {
    expect(softStopReasonOf(new Error('codex-image 생성 실패(2회 시도): 산출 파일 없음'))).toBeNull()
    expect(softStopReasonOf(undefined)).toBeNull()
  })

  it('기록·조회·초기화', () => {
    expect(peekLocalBackendSoftStop()).toBeNull()
    noteLocalBackendSoftStop({ model: 'codex-image', reason: 'quota', message: 'm', at: '2026-10-27T00:00:00.000Z' })
    expect(peekLocalBackendSoftStop()).toMatchObject({ reason: 'quota' })
    clearLocalBackendSoftStop()
    expect(peekLocalBackendSoftStop()).toBeNull()
  })
})
