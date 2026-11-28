/**
 * POST /api/registration/pdp — 새 잡의 이미지 모델은 PDP 선택지만 받는다(pdp-model-refresh: Claude·GPT만, Gemini 없음).
 * W2a 입력 필드는 저장 전에 계약 한도로 정리한다. 잡 저장·초안 연결은 모의(DB 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ createPdpJob: vi.fn() }))

vi.mock('@/lib/auth/clerk', () => ({ requireOwner: vi.fn(async () => 'user-1') }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/registration/job-draft-link', () => ({
  resolveJobDraftLink: vi.fn(async () => ({ ok: true, draftId: null, businessId: null })),
}))
vi.mock('@/lib/registration/pdp-jobs', () => ({
  createPdpJob: (...a: unknown[]) => h.createPdpJob(...a),
  listPdpJobs: vi.fn(),
}))

import { POST } from './route'

function post(imageModel: unknown) {
  return POST(
    new NextRequest('http://localhost/api/registration/pdp', {
      method: 'POST',
      body: JSON.stringify({
        specSheet: { productName: '세척 쉬운 컵' },
        sourceImages: ['https://example.com/a.jpg'],
        imageModel,
      }),
    })
  )
}

beforeEach(() => {
  h.createPdpJob.mockReset().mockResolvedValue({ id: 'job-1' })
})

describe('POST /api/registration/pdp — 이미지 모델', () => {
  it.each(['gemini-3-pro-image', 'gemini-3.1-flash-image', 'codex-image', undefined])(
    '%s는 새 잡으로 받지 않는다(400, 저장 없음)',
    async (model) => {
      const res = await post(model)
      expect(res.status).toBe(400)
      expect(h.createPdpJob).not.toHaveBeenCalled()
    }
  )

  it('gpt-image-2는 받는다', async () => {
    const res = await post('gpt-image-2')
    expect(res.status).toBe(202)
    expect(h.createPdpJob).toHaveBeenCalledWith({}, 'user-1', expect.objectContaining({ imageModel: 'gpt-image-2' }))
  })

  it('GPT-Image 2.5(sunburst — 상세페이지 기본)는 받고 품질 기본 high, 하네스 전용 flare는 400', async () => {
    const res = await post('gpt-image-2.5-sunburst')
    expect(res.status).toBe(202)
    expect(h.createPdpJob).toHaveBeenCalledWith(
      {},
      'user-1',
      expect.objectContaining({ imageModel: 'gpt-image-2.5-sunburst', imageQuality: 'high' })
    )
    h.createPdpJob.mockClear()
    expect((await post('gpt-image-2.5-flare')).status).toBe(400)
    expect(h.createPdpJob).not.toHaveBeenCalled()
  })
})

describe('POST /api/registration/pdp — 생성 트랙 기본값(K4 운영 전환)', () => {
  const postTrack = (track?: unknown) =>
    POST(
      new NextRequest('http://localhost/api/registration/pdp', {
        method: 'POST',
        body: JSON.stringify({
          specSheet: { productName: '세척 쉬운 컵' },
          sourceImages: ['https://example.com/a.jpg'],
          imageModel: 'gpt-image-2',
          ...(track === undefined ? {} : { generationTrack: track }),
        }),
      })
    )
  const savedTrack = (call: number) => (h.createPdpJob.mock.calls[call][2] as { generationTrack: string }).generationTrack

  it('트랙을 안 주면 내재화로 만든다', async () => {
    expect((await postTrack()).status).toBe(202)
    expect(savedTrack(0)).toBe('internalized')
  })

  it('표준을 고르면 그대로 표준이고, 두 값 밖은 400', async () => {
    expect((await postTrack('standard')).status).toBe(202)
    expect(savedTrack(0)).toBe('standard')
    h.createPdpJob.mockClear()
    expect((await postTrack('v2')).status).toBe(400)
    expect(h.createPdpJob).not.toHaveBeenCalled()
  })
})

describe('POST /api/registration/pdp — 시험 잡 표식(costPool)', () => {
  const postWith = (extra: Record<string, unknown>) =>
    POST(
      new NextRequest('http://localhost/api/registration/pdp', {
        method: 'POST',
        body: JSON.stringify({ specSheet: { productName: '세척 쉬운 컵' }, sourceImages: ['https://example.com/a.jpg'], imageModel: 'gpt-image-2', ...extra }),
      })
    )

  it("'test'는 시험 잡으로 만들고, 없으면 운영 잡(칸 없음), 다른 값은 400", async () => {
    expect((await postWith({ costPool: 'test' })).status).toBe(202)
    expect(h.createPdpJob.mock.calls[0][2]).toMatchObject({ costPool: 'test' })
    expect((await postWith({})).status).toBe(202)
    expect(h.createPdpJob.mock.calls[1][2]).not.toHaveProperty('costPool')
    h.createPdpJob.mockClear()
    expect((await postWith({ costPool: 'pdp-test' })).status).toBe(400)
    expect(h.createPdpJob).not.toHaveBeenCalled()
  })
})

describe('POST /api/registration/pdp — W2a 입력 필드 정리', () => {
  const savedSpec = () => (h.createPdpJob.mock.calls[0][2] as { specSheet: Record<string, unknown> }).specSheet

  it('새 필드가 없으면 받은 spec 그대로 저장한다', async () => {
    await post('gpt-image-2')
    expect(savedSpec()).toEqual({ productName: '세척 쉬운 컵' })
  })

  it('무게·원산지·추가 스펙·인용 카드·초안 표시를 계약 한도로 정리해 저장한다(트랙 키는 빠진다)', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/registration/pdp', {
        method: 'POST',
        body: JSON.stringify({
          specSheet: {
            productName: '세척 쉬운 컵',
            generationTrack: 'standard',
            weight: ' 120g ',
            origin: '',
            extraSpecs: [
              { key: '용량', value: '350ml' },
              { key: '', value: '빈 키' },
            ],
            reviewQuotes: [
              { id: 'q1', text: '세척이 쉬워요', rating: 5, highlights: ['세척', '없는 말'] },
              { id: 'q2', text: '평점이 없어요', rating: 0 },
            ],
            draftPrefill: ['weight', 'reviewsText'],
          },
          sourceImages: ['https://example.com/a.jpg'],
          imageModel: 'gpt-image-2',
        }),
      })
    )
    expect(res.status).toBe(202)
    expect(savedSpec()).toEqual({
      productName: '세척 쉬운 컵',
      weight: '120g',
      extraSpecs: [{ key: '용량', value: '350ml' }],
      reviewQuotes: [{ id: 'q1', text: '세척이 쉬워요', rating: 5, highlights: ['세척'] }],
      draftPrefill: ['weight'],
    })
  })
})

describe('POST /api/registration/pdp — 원천 사진 역할(결정 카드 c12)', () => {
  const A = 'https://example.com/a.jpg'
  const B = 'https://example.com/b.jpg'
  const postRoles = (sourcePhotoRoles: unknown) =>
    POST(
      new NextRequest('http://localhost/api/registration/pdp', {
        method: 'POST',
        body: JSON.stringify({ specSheet: { productName: '세척 쉬운 컵', sourcePhotoRoles }, sourceImages: [A, B], imageModel: 'gpt-image-2' }),
      })
    )
  const savedSpec = () => (h.createPdpJob.mock.calls[0][2] as { specSheet: Record<string, unknown>; sourceImages: string[] })

  it('보낸 사진에 있는 주소·옵션·설명 그림만 남기고 sourceImages 순서는 그대로다', async () => {
    const res = await postRoles([
      { url: B, role: 'explain' },
      { url: 'https://example.com/other.jpg', role: 'option' },
      { url: A, role: 'original' },
    ])
    expect(res.status).toBe(202)
    expect(savedSpec().specSheet.sourcePhotoRoles).toEqual([{ url: B, role: 'explain' }])
    expect(savedSpec().sourceImages).toEqual([A, B])
  })

  it('남는 역할이 없거나 키가 없으면 spec에 키를 두지 않는다(지금과 같은 행)', async () => {
    await postRoles([{ url: A, role: 'original' }])
    expect('sourcePhotoRoles' in savedSpec().specSheet).toBe(false)
    h.createPdpJob.mockClear()
    await post('gpt-image-2')
    expect('sourcePhotoRoles' in savedSpec().specSheet).toBe(false)
  })
})
