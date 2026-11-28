/**
 * POST /api/registration/pdp/auto-fill(PDP-W2W3 계약 v1 §2-2) — 오너 전용, 입력 400, 월 예산 409(호출 없음), 사진은 읽은 것만,
 * 제안만 돌려준다(효능 표현이 있는 칸은 빼고 경고). ai_usage_log stage는 registration/pdp-auto-fill.
 * 예산·사진 내려받기·모델 호출은 모의, 요청·응답 정리는 실제 함수다(유료 호출 0, DB 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const h = vi.hoisted(() => ({ budget: vi.fn(), model: vi.fn(), fetchImage: vi.fn() }))

vi.mock('@/lib/auth/clerk', () => ({ requireOwner: vi.fn() }))
vi.mock('@/lib/agents/budget', () => ({ checkMonthlyBudget: (...a: unknown[]) => h.budget(...a) }))
vi.mock('@/lib/agents/registration/pdp-auto-fill-agent', () => ({
  callAutoFillModel: (...a: unknown[]) => h.model(...a),
  fetchAutoFillImage: (...a: unknown[]) => h.fetchImage(...a),
}))

import { POST } from './route'
import { requireOwner } from '@/lib/auth/clerk'

const IMAGE = { mediaType: 'image/png' as const, data: 'AA' }
const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/registration/pdp/auto-fill', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
  )

beforeEach(() => {
  vi.mocked(requireOwner).mockReset().mockResolvedValue('user-1')
  h.budget.mockReset().mockResolvedValue({ allowed: true, spentUsd: 1, budgetUsd: 50 })
  h.fetchImage.mockReset().mockResolvedValue(IMAGE)
  h.model.mockReset().mockResolvedValue({
    ok: true,
    raw: { targetPersona: '매일 도시락을 싸는 직장인', brandVoiceGuide: '담백한 생활 톤', brandHexColor: '#3366cc' },
    costUsd: 0.004,
  })
})

describe('POST /api/registration/pdp/auto-fill', () => {
  it('오너가 아니면 인증 응답을 그대로 돌려준다(호출 없음)', async () => {
    vi.mocked(requireOwner).mockRejectedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    expect((await post({ productName: '컵' })).status).toBe(403)
    expect(h.model).not.toHaveBeenCalled()
  })

  it('입력 오류는 400(예산 조회·호출 없음)', async () => {
    const res = await post({ productName: '' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('상품명(productName)은 필수입니다.')
    expect((await post({ productName: '컵', imageUrls: ['a', 'b', 'c'] })).status).toBe(400)
    expect(h.budget).not.toHaveBeenCalled()
    expect(h.model).not.toHaveBeenCalled()
  })

  it('제안·모델·비용을 돌려주고, 자동 작성 agent·stage로 부른다', async () => {
    const res = await post({
      productName: '세척 쉬운 컵',
      specSheet: { material: '스테인리스' },
      reviewsText: '좋아요',
      imageUrls: ['https://a.example/1.jpg'],
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      suggestions: {
        targetPersona: '매일 도시락을 싸는 직장인',
        brandVoiceGuide: '담백한 생활 톤',
        brandHexColor: '#3366CC',
      },
      model: 'claude-sonnet-5-5',
      costUsd: 0.004,
    })
    expect(h.budget).toHaveBeenCalledWith('registration/pdp-auto-fill', 'claude-sonnet-5-5')
    expect(h.fetchImage).toHaveBeenCalledWith('https://a.example/1.jpg', 10_000)
    const [request, images, runContext] = h.model.mock.calls[0]
    expect(request).toEqual({
      productName: '세척 쉬운 컵',
      specSheet: { material: '스테인리스' },
      reviewsText: '좋아요',
      imageUrls: ['https://a.example/1.jpg'],
    })
    expect(images).toEqual([IMAGE])
    expect(runContext).toEqual({ userId: 'user-1', stage: 'registration/pdp-auto-fill' })
  })

  it('월 예산 한도·지출 조회 실패(degraded)면 409 budget(사진·호출 없음)', async () => {
    h.budget.mockResolvedValueOnce({ allowed: false, spentUsd: 50.5, budgetUsd: 50, limitReason: 'global' })
    const blocked = await post({ productName: '컵', imageUrls: ['https://a/1.jpg'] })
    expect(blocked.status).toBe(409)
    expect(await blocked.json()).toEqual({ error: '월 AI 예산 한도 — 당월 지출 $50.50 / $50', code: 'budget' })
    h.budget.mockResolvedValueOnce({ allowed: false, spentUsd: 0, budgetUsd: 50, degraded: true })
    const degraded = await post({ productName: '컵' })
    expect(degraded.status).toBe(409)
    expect((await degraded.json()).code).toBe('budget')
    expect(h.fetchImage).not.toHaveBeenCalled()
    expect(h.model).not.toHaveBeenCalled()
  })

  it('읽지 못한 사진은 빼고 부르고, 효능 표현이 있는 칸은 빼고 경고를 함께 준다', async () => {
    h.fetchImage.mockResolvedValueOnce(null).mockResolvedValueOnce(IMAGE)
    h.model.mockResolvedValueOnce({
      ok: true,
      raw: { targetPersona: '탈모 예방에 관심 많은 직장인', brandHexColor: '#2E7D5B' },
      costUsd: 0.003,
    })
    const res = await post({ productName: '두피 브러시', imageUrls: ['https://a/1.jpg', 'https://a/2.jpg'] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      suggestions: { brandHexColor: '#2E7D5B' },
      model: 'claude-sonnet-5-5',
      costUsd: 0.003,
      warnings: [
        '타겟 페르소나 제안에 인증·의학 표현(탈모 예방)이 있어 뺐습니다.',
        '사진 1장을 읽지 못해 빼고 작성했습니다.',
      ],
    })
    expect(h.model.mock.calls[0][1]).toEqual([IMAGE])
  })

  it('라우트 확인 뒤 공용 callAgent가 예산으로 막으면 같은 409 budget', async () => {
    h.model.mockResolvedValueOnce({ ok: false, error: '월 AI 예산 초과', stage: 'budget', costUsd: 0 })
    const res = await post({ productName: '컵' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: '월 AI 예산 초과', code: 'budget' })
  })

  it('모델 호출·파싱 실패는 502(costUsd는 callAgent가 준 값 — 끝내 실패하면 0)', async () => {
    h.model.mockResolvedValueOnce({ ok: false, error: 'timeout', stage: 'api_call', costUsd: 0 })
    const res = await post({ productName: '컵' })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: '자동 작성에 실패했습니다: timeout', costUsd: 0 })
  })
})
