/**
 * 화면 쪽 레퍼런스 보내기 — 품질 단계 선택(예산 3.8MB)과 요청 모양(PDF는 파일, 캡처는 띠·위치·표집 표시)을 고정한다.
 * canvas 띠 자르기는 브라우저 전용이라 deps로 바꿔 끼우고, 실제 띠 모양은 Railway 렌더 확인(reference-input)이 본다.
 */

import { describe, expect, it, vi } from 'vitest'
import { BROWSER_STRIPS_BUDGET_BYTES, encodeWithinBudget, fetchReferenceAnalysis } from './reference-browser'
import type { ReferenceInput } from './reference-types'

const blob = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })
const REFERENCE = { id: 'r1', kind: 'own', fileName: 'page.png' } as ReferenceInput
const okFetch = () =>
  vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify({ reference: REFERENCE }), { status: 200 }))
const sentForm = (fetchImpl: ReturnType<typeof okFetch>) => fetchImpl.mock.calls[0][1]!.body as FormData

describe('encodeWithinBudget — 합계가 예산 안이 되는 첫 품질', () => {
  it('처음 품질이 맞으면 그대로', async () => {
    const encode = vi.fn(async () => [blob(100), blob(100)])
    expect(await encodeWithinBudget(encode, 300)).toMatchObject({ quality: 0.8 })
    expect(encode).toHaveBeenCalledTimes(1)
  })

  it('넘치면 품질을 낮춰 다시 만든다', async () => {
    const encode = vi.fn(async (q: number) => [blob(Math.round(q * 1000))])
    const fitted = await encodeWithinBudget(encode, 600)
    expect(fitted?.quality).toBe(0.6)
    expect(encode.mock.calls.map(([q]) => q)).toEqual([0.8, 0.7, 0.6])
  })

  it('가장 낮은 품질도 넘치면 null', async () => {
    expect(await encodeWithinBudget(async () => [blob(10)], 5)).toBeNull()
  })

  it('기본 예산은 요청 상한(4MB) 안', () => {
    expect(BROWSER_STRIPS_BUDGET_BYTES).toBeLessThan(4 * 1024 * 1024)
  })
})

describe('fetchReferenceAnalysis — 요청 모양', () => {
  it('캡처는 띠·위치·표집 표시·파일명·종류로 보내고 원본은 보내지 않는다', async () => {
    const fetchImpl = okFetch()
    const slice = vi.fn(async () => ({
      blobs: [blob(10), blob(20)],
      positions: [{ start: 0, end: 60 }, { start: 55, end: 100 }],
      sampled: true,
      quality: 0.7,
    }))
    const file = new File([new Uint8Array(50)], 'page.png', { type: 'image/png' })
    expect(await fetchReferenceAnalysis('own', file, { slice, fetchImpl })).toEqual(REFERENCE)
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/registration/references')
    const form = sentForm(fetchImpl)
    expect(form.getAll('strips')).toHaveLength(2)
    expect(JSON.parse(form.get('positions') as string)).toEqual([{ start: 0, end: 60 }, { start: 55, end: 100 }])
    expect(form.get('sampled')).toBe('1')
    expect(form.get('kind')).toBe('own')
    expect(form.get('fileName')).toBe('page.png')
    expect(form.get('file')).toBeNull()
  })

  it('PDF는 띠 없이 파일 그대로(4MB 넘으면 보내지 않는다)', async () => {
    const fetchImpl = okFetch()
    const slice = vi.fn()
    const pdf = new File([new Uint8Array(100)], 'page.pdf', { type: 'application/pdf' })
    await fetchReferenceAnalysis('competitor', pdf, { slice, fetchImpl })
    expect(sentForm(fetchImpl).get('file')).toBeInstanceOf(File)
    expect(slice).not.toHaveBeenCalled()

    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'big.PDF')
    await expect(fetchReferenceAnalysis('competitor', big, { slice, fetchImpl })).rejects.toThrow('4MB 이하')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('띠 자르기 실패·서버 거절은 그 문구로 throw', async () => {
    const fetchImpl = okFetch()
    const file = new File([new Uint8Array(5)], 'narrow.png', { type: 'image/png' })
    await expect(
      fetchReferenceAnalysis('own', file, { slice: async () => ({ error: '캡처 폭이 너무 좁습니다' }), fetchImpl })
    ).rejects.toThrow('캡처 폭이 너무 좁습니다')
    expect(fetchImpl).not.toHaveBeenCalled()

    const refused = vi.fn(async () => new Response(JSON.stringify({ error: '월 AI 예산 한도' }), { status: 409 }))
    const slice = async () => ({ blobs: [blob(1)], positions: [{ start: 0, end: 100 }], sampled: false, quality: 0.8 })
    await expect(fetchReferenceAnalysis('own', file, { slice, fetchImpl: refused })).rejects.toThrow('월 AI 예산 한도')
  })
})
