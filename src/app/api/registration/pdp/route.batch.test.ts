/**
 * POST /api/registration/pdp — 모델 배치(R03). 기본 지금 배치, 'new'는 새 배치 이미지 모델(MS 2k — R05 공급자)로 정하고, 공급자가 없는
 * 환경에서는 조용히 다른 모델로 만들지 않고 400. 잡마다 배치·단계 모델 스냅숏을 넘기고, 화면이 보낸 예약 키는 받지 않는다.
 * 이미지 모델 목록은 모의로 고정한다(R05 병합 전후 모두 같은 결과). 잡 저장·초안 연결은 모의(DB 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ createPdpJob: vi.fn(), extraModels: [] as Array<{ id: string }> }))

vi.mock('@/lib/auth/clerk', () => ({ requireOwner: vi.fn(async () => 'user-1') }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/registration/job-draft-link', () => ({
  resolveJobDraftLink: vi.fn(async () => ({ ok: true, draftId: null, businessId: null })),
}))
vi.mock('@/lib/registration/pdp-jobs', () => ({
  createPdpJob: (...a: unknown[]) => h.createPdpJob(...a),
  listPdpJobs: vi.fn(),
}))
vi.mock('@/lib/agents/image/types', async (orig) => {
  const real = await orig<typeof import('@/lib/agents/image/types')>()
  // 등록된 이미지 모델 = 실제 목록에서 MS 2k를 빼고(R05 전 환경), 시험이 정한 모델만 더한다
  const base = real.ALL_IMAGE_MODELS.filter((m) => m.id !== ('higgsfield-ms-2k' as string))
  return {
    ...real,
    get ALL_IMAGE_MODELS() {
      return [...base, ...h.extraModels]
    },
  }
})

import { snapshotPdpRoutes } from '@/lib/registration/pdp-model-routes'
import { POST } from './route'

const post = (extra: Record<string, unknown>) =>
  POST(
    new NextRequest('http://localhost/api/registration/pdp', {
      method: 'POST',
      body: JSON.stringify({
        specSheet: { productName: '세척 쉬운 컵' },
        sourceImages: ['https://example.com/a.jpg'],
        imageModel: 'gpt-image-2.6-sunburst',
        ...extra,
      }),
    })
  )
const saved = () => h.createPdpJob.mock.calls[0][2] as Record<string, unknown>

beforeEach(() => {
  h.createPdpJob.mockReset().mockResolvedValue({ id: 'job-1' })
  h.extraModels = []
})

describe('POST /api/registration/pdp — 모델 배치', () => {
  it('없으면 지금 배치 — 고른 이미지 모델 그대로, 지금 표 스냅숏을 넘긴다', async () => {
    expect((await post({})).status).toBe(202)
    expect(saved()).toMatchObject({
      imageModel: 'gpt-image-2.6-sunburst',
      modelBatch: { batch: 'now', snapshot: snapshotPdpRoutes('now') },
    })
  })

  it("'now'·'new' 밖의 값은 400(저장 없음)", async () => {
    expect((await post({ modelBatch: 'v2' })).status).toBe(400)
    expect(h.createPdpJob).not.toHaveBeenCalled()
  })

  it('새 배치 — MS 2k 공급자가 없는 환경이면 명시 오류 400(다른 이미지 모델로 만들지 않는다)', async () => {
    const res = await post({ modelBatch: 'new' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('higgsfield-ms-2k')
    expect(h.createPdpJob).not.toHaveBeenCalled()
  })

  it('새 배치 — 공급자가 있으면 이미지 모델을 MS 2k로 정하고 새 표 스냅숏을 넘긴다', async () => {
    h.extraModels = [{ id: 'higgsfield-ms-2k' }]
    expect((await post({ modelBatch: 'new' })).status).toBe(202)
    expect(saved()).toMatchObject({
      imageModel: 'higgsfield-ms-2k',
      modelBatch: { batch: 'new', snapshot: snapshotPdpRoutes('new') },
    })
  })

  it('화면이 spec에 예약 키를 보내도 받지 않는다 — 배치는 modelBatch 칸으로만', async () => {
    expect((await post({ specSheet: { productName: '컵', modelBatch: 'new', modelRouteSnapshot: { x: 1 } } })).status).toBe(202)
    expect(saved().specSheet).toEqual({ productName: '컵' })
    expect(saved()).toMatchObject({ modelBatch: { batch: 'now' } })
  })
})

describe('POST /api/registration/pdp — 구독 표지(R13)', () => {
  const saved0 = { worker: process.env.NEXOPS_PDP_SUBSCRIPTION_WORKER }
  const restore = () => {
    if (saved0.worker === undefined) delete process.env.NEXOPS_PDP_SUBSCRIPTION_WORKER
    else process.env.NEXOPS_PDP_SUBSCRIPTION_WORKER = saved0.worker
  }

  it('작업자 스위치가 없으면 표지 없음(api) — 지금과 같은 잡', async () => {
    delete process.env.NEXOPS_PDP_SUBSCRIPTION_WORKER
    h.extraModels = [{ id: 'higgsfield-ms-2k' }]
    try {
      expect((await post({ modelBatch: 'new' })).status).toBe(202)
      expect(saved()).toMatchObject({ modelBatch: { batch: 'new', backend: 'api' } })
    } finally {
      restore()
    }
  })

  it('스위치 on이면 새 배치 잡만 구독 표지 — 지금 배치는 표지 없음, 화면이 보낸 표지 키는 받지 않는다', async () => {
    process.env.NEXOPS_PDP_SUBSCRIPTION_WORKER = 'on'
    h.extraModels = [{ id: 'higgsfield-ms-2k' }]
    try {
      expect((await post({ modelBatch: 'new' })).status).toBe(202)
      expect(saved()).toMatchObject({ modelBatch: { batch: 'new', backend: 'subscription' } })
      h.createPdpJob.mockClear()
      expect((await post({ specSheet: { productName: '컵', modelBackend: 'subscription' } })).status).toBe(202)
      expect(saved().specSheet).toEqual({ productName: '컵' })
      expect(saved()).toMatchObject({ modelBatch: { batch: 'now', backend: 'api' } })
    } finally {
      restore()
    }
  })
})

describe('POST /api/registration/pdp — 구독 멈춤 표지(AX-CT-29)', () => {
  const keys = ['NEXOPS_PDP_SUBSCRIPTION_WORKER', 'NEXOPS_PDP_SUBSCRIPTION_STOP'] as const
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  const setEnv = (worker: string | undefined, stop: string | undefined) => {
    for (const [k, v] of [[keys[0], worker], [keys[1], stop]] as const) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
  const restore = () => {
    for (const k of keys) {
      if (before[k] === undefined) delete process.env[k]
      else process.env[k] = before[k]
    }
  }
  const modelBatch = () => saved().modelBatch as Record<string, unknown>

  it("env가 없음·off·true·1·빈 값이면 표지를 달지 않는다 — 저장 값은 지금과 같다(modelBatch 키가 batch·snapshot·backend뿐)", async () => {
    h.extraModels = [{ id: 'higgsfield-ms-2k' }]
    try {
      for (const value of [undefined, 'off', 'true', '1', '']) {
        setEnv('on', value)
        h.createPdpJob.mockClear()
        expect((await post({ modelBatch: 'new' })).status).toBe(202)
        expect(Object.keys(modelBatch()).sort(), String(value)).toEqual(['backend', 'batch', 'snapshot'])
        expect(modelBatch().backend).toBe('subscription')
      }
    } finally {
      restore()
    }
  })

  it("'on'(공백·대소문자 무시) + 구독 표지 잡일 때만 subscriptionStop: true를 더 붙인다", async () => {
    h.extraModels = [{ id: 'higgsfield-ms-2k' }]
    try {
      for (const value of ['on', ' ON ']) {
        setEnv('on', value)
        h.createPdpJob.mockClear()
        expect((await post({ modelBatch: 'new' })).status).toBe(202)
        expect(modelBatch()).toMatchObject({ batch: 'new', backend: 'subscription', subscriptionStop: true })
      }
    } finally {
      restore()
    }
  })

  it("멈춤 스위치가 on이어도 API 잡(작업자 스위치 꺼짐·지금 배치)은 표지를 달지 않는다", async () => {
    h.extraModels = [{ id: 'higgsfield-ms-2k' }]
    try {
      setEnv(undefined, 'on')
      expect((await post({ modelBatch: 'new' })).status).toBe(202)
      expect(modelBatch()).toMatchObject({ batch: 'new', backend: 'api' })
      expect(modelBatch()).not.toHaveProperty('subscriptionStop')
      h.createPdpJob.mockClear()
      setEnv('on', 'on')
      expect((await post({})).status).toBe(202)
      expect(modelBatch()).toMatchObject({ batch: 'now', backend: 'api' })
      expect(modelBatch()).not.toHaveProperty('subscriptionStop')
    } finally {
      restore()
    }
  })

  it('화면이 spec에 보낸 subscriptionStop 키는 받지 않는다', async () => {
    try {
      setEnv(undefined, undefined)
      expect((await post({ specSheet: { productName: '컵', subscriptionStop: true } })).status).toBe(202)
      expect(saved().specSheet).toEqual({ productName: '컵' })
    } finally {
      restore()
    }
  })
})
