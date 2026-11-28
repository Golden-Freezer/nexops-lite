import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProSectionType } from '../types/section'
import { CopyRegenApiError, copyRegenApi } from './copyRegenApi'
import { RegenApiError } from './regenApi'

const JOB = '6bbc4fa8-1111-4222-8333-444455556666'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('copyRegenApi (A 계약 경로·본문)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('사전 조회는 sectionType만 쿼리로 보내는 GET이다(텍스트를 보내지 않는다)', async () => {
    const fn = mockFetch(200, { sectionType: 'hook_3step', estimate: { model: 'claude-sonnet-5', billed: true, maxUsd: 0.05 }, blocked: null })
    const res = await copyRegenApi.preview(JOB, ProSectionType.HOOK_3STEP)
    expect(fn.mock.calls[0][0]).toBe(`/api/registration/pdp/${JOB}/copy/regenerate?sectionType=hook_3step`)
    expect(fn.mock.calls[0][1]).toEqual({ credentials: 'include' })
    expect(res.blocked).toBeNull()
  })

  it('요청은 JSON 본문 POST이고 응답(후보)을 그대로 돌려준다', async () => {
    const fn = mockFetch(200, { status: 'ok', candidates: ['새 카피'], rejected: [], costUsd: 0.01, recorded: true, estimate: { model: 'claude-sonnet-5', billed: true, maxUsd: 0.05 } })
    const body = { sectionType: ProSectionType.HOOK_3STEP, currentText: '지금 카피', tone: 'emotional' as const }
    const res = await copyRegenApi.request(JOB, body)
    const [url, init] = fn.mock.calls[0]
    expect(url).toBe(`/api/registration/pdp/${JOB}/copy/regenerate`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(body)
    expect(res.candidates).toEqual(['새 카피'])
  })

  it('409(CopyRegenConflictBody)는 서버 문구·code·busyKind를 살려 던진다(RegenApiError 계열)', async () => {
    mockFetch(409, { error: '이미지 생성 중이라 잠시 뒤 다시 시도해 주세요.', code: 'busy', busy: true, busyKind: 'images' })
    const err = await copyRegenApi.request(JOB, { sectionType: ProSectionType.HOOK_3STEP, currentText: 'x' }).catch((e) => e)
    expect(err).toBeInstanceOf(CopyRegenApiError)
    expect(err).toBeInstanceOf(RegenApiError)
    expect(err).toMatchObject({ status: 409, code: 'busy', busyKind: 'images', message: '이미지 생성 중이라 잠시 뒤 다시 시도해 주세요.' })
    mockFetch(409, { error: '월 예산 한도에 걸렸습니다.', code: 'budget' })
    await expect(copyRegenApi.request(JOB, { sectionType: ProSectionType.HOOK_3STEP, currentText: 'x' })).rejects.toMatchObject({ code: 'budget', busyKind: undefined })
  })

  it('본문 없는 실패는 상태 코드 문구로 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })))
    await expect(copyRegenApi.preview(JOB, ProSectionType.HOOK_3STEP)).rejects.toMatchObject({ status: 500, message: '요청 실패(500)' })
  })
})
