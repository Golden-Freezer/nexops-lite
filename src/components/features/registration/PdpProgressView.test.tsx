/**
 * 상세페이지 진행 화면(PdpProgressView — PdpProgress가 그리는 몫) 렌더 시험(AX-CT-29). 서버 렌더 마크업만 본다(DOM 없음).
 * ① 표지 없는 잡(스위치 꺼짐과 같음) — 지금 글·단추 그대로, 멈춤 문구·'이어 하기' 없음, 단추는 run(onDrive)
 * ② 멈춘 표지 잡 — 멈춤 문구·'이어 하기', 누르면 resume(onResume) → POST /api/registration/pdp/[jobId]/resume
 * ③ 큐 뒤에서 기다리는 둘째 표지 잡 — 차례 대기 문구(서버가 넘겨받는다는 말 없음)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PdpJobRow } from '@/lib/registration/pdp-state'
import { fixtureToJob, loadEnrichmentFixture } from '@/lib/registration/__golden__/golden-harness'
import { PDP_BUSY_GIVE_UP, workerGiveUpMessage } from '@/lib/registration/pdp-run-driver'
import { PdpProgressView, driveEndMessage, requestPdpResume, type PdpProgressViewProps } from './PdpProgressView'

// 프로젝트 Vitest 변환은 classic JSX를 사용하고 Next 빌드는 React를 자동 주입한다.
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

const HALT = { at: '2026-11-12T05:00:00.000Z', stage: 'design', reason: 'quota' as const, detail: '한도' }
const base = fixtureToJob(loadEnrichmentFixture('A-track-i'))
const jobOf = (over: Partial<PdpJobRow>): PdpJobRow => ({ ...base, current_step: 'design', progress: 30, error: null, ...over })

const props = (job: PdpJobRow, over: Partial<PdpProgressViewProps> = {}): PdpProgressViewProps => ({
  job,
  running: false,
  resuming: false,
  workerActive: false,
  error: null,
  onDrive: vi.fn(),
  onResume: vi.fn(),
  ...over,
})
const html = (p: PdpProgressViewProps) => renderToStaticMarkup(createElement(PdpProgressView, p))

/** 요소 나무에서 글자에 text가 든 button을 찾는다(훅 없는 컴포넌트라 함수로 불러 나무를 얻는다) */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}
function findButton(node: ReactNode, text: string): ReactElement<{ onClick: () => void }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findButton(child, text)
      if (hit) return hit
    }
    return null
  }
  if (!isValidElement(node)) return null
  if (node.type === 'button' && textOf(node).includes(text)) return node as ReactElement<{ onClick: () => void }>
  return findButton((node.props as { children?: ReactNode }).children, text)
}
const click = (p: PdpProgressViewProps, text: string) => {
  const button = findButton(PdpProgressView(p), text)
  expect(button, text).not.toBeNull()
  button!.props.onClick()
}

describe('① 표지 없는 잡(스위치 꺼짐과 같음) — 지금 화면 그대로', () => {
  it('실패 잡: 생성 실패 글·이 단계부터 재시도, 멈춤 문구·이어 하기 없음 — 누르면 run(onDrive)', () => {
    const p = props(jobOf({ current_step: 'failed', progress: 30, error: '[design] 설계 실패' }))
    const out = html(p)
    expect(out).toContain('생성 실패: ')
    expect(out).toContain('설계 실패')
    expect(out).toContain('이 단계부터 재시도')
    expect(out).not.toContain('이어 하기')
    expect(out).not.toContain('구독 작업자가 멈춰')
    click(p, '이 단계부터 재시도')
    expect(p.onDrive).toHaveBeenCalledTimes(1)
    expect(p.onResume).not.toHaveBeenCalled()
  })

  it('정체 잡: 계속 실행 칸, 진행 중이면 칸이 없고 작업자 안내 줄만', () => {
    const stalled = props(jobOf({}))
    expect(html(stalled)).toContain('생성이 완료되지 않았습니다. 이어서 실행하세요.')
    click(stalled, '계속 실행')
    expect(stalled.onDrive).toHaveBeenCalledTimes(1)
    const running = html(props(jobOf({ model_backend: 'subscription' }), { running: true, workerActive: true }))
    expect(running).not.toContain('계속 실행')
    expect(running).toContain('구독 작업자가 이 잡을 진행 중입니다')
  })

  it('section_plan 에 멈춤 칸이 없는 표지 없는 잡은 subscription_stop 이 없든 false 든 마크업이 같다', () => {
    const a = jobOf({ current_step: 'failed', error: '[images] x' })
    expect(html(props({ ...a, subscription_stop: false }))).toBe(html(props(a)))
  })
})

describe('② 멈춘 표지 잡 — 멈춤 상자와 이어 하기', () => {
  const halted = () =>
    props(
      jobOf({
        model_backend: 'subscription',
        subscription_stop: true,
        section_plan: { ...base.section_plan, subscription_halt: HALT },
        error: '[design] 구독 작업자 멈춤 — 구독 한도 소진 (한도)',
      })
    )

  it('멈춤 문구(단계·사유·API로 대신 진행하지 않음)와 이어 하기 단추, 계속 실행 칸은 없다 — 누르면 resume(onResume)', () => {
    const p = halted()
    const out = html(p)
    expect(out).toContain('구독 작업자가 멈춰 생성을 멈췄습니다(단계: 섹션 디자인')
    expect(out).toContain('사유: 구독 한도 소진')
    expect(out).toContain('API 로 대신 진행하지 않습니다')
    expect(out).toContain('이어 하기')
    expect(out).not.toContain('계속 실행')
    expect(out).not.toContain('이 단계부터 재시도')
    click(p, '이어 하기')
    expect(p.onResume).toHaveBeenCalledTimes(1)
    expect(p.onDrive).not.toHaveBeenCalled()
  })

  it('이어 하기 중에는 단추가 잠긴다', () => {
    expect(html({ ...halted(), resuming: true })).toMatch(/<button[^>]*disabled=""[^>]*>.*이어 하기/)
  })

  it('멈춤 기록 없이 실패한 표지 잡의 이 단계부터 재시도도 resume 을 부른다(웹은 진행하지 않는다)', () => {
    const p = props(jobOf({ model_backend: 'subscription', subscription_stop: true, current_step: 'failed', error: '[images] 첫 화면 실패' }))
    click(p, '이 단계부터 재시도')
    expect(p.onResume).toHaveBeenCalledTimes(1)
    expect(p.onDrive).not.toHaveBeenCalled()
  })

  it('requestPdpResume 은 POST /api/registration/pdp/[jobId]/resume 를 토큰과 함께 부른다', async () => {
    const api = vi.fn(async () => ({ job: base })) as unknown as Parameters<typeof requestPdpResume>[2]
    const out = await requestPdpResume('job-123', { refreshToken: async () => 'tok', sleep: async () => {}, alive: () => true }, api)
    expect(out.job).toBe(base)
    expect(api).toHaveBeenCalledWith('/api/registration/pdp/job-123/resume', expect.objectContaining({ method: 'POST' }))
  })
})

describe('③ 큐 뒤에서 기다리는 둘째 표지 잡 — 차례 대기 문구', () => {
  it('stop 잡의 worker-stale 은 차례 대기 문구로 오류 줄에 그려지고, 표지 없는 잡·잠금 대기 문구는 그대로', () => {
    const waiting = driveEndMessage('worker-stale', true)
    expect(waiting).toContain('앞 잡을 진행 중이라')
    expect(waiting).not.toContain('넘겨받지')
    const out = html(props(jobOf({ model_backend: 'subscription', subscription_stop: true }), { error: waiting }))
    expect(out).toContain('앞 잡을 진행 중이라 이 잡은')
    expect(out).toContain('API로 대신 진행하지 않습니다')
    expect(driveEndMessage('worker-stale', false)).toBe(workerGiveUpMessage('worker-stale'))
    expect(driveEndMessage('busy', true)).toBe(PDP_BUSY_GIVE_UP)
    expect(driveEndMessage('settled', true)).toBeNull()
    expect(driveEndMessage('halted', true)).toBeNull()
  })
})
