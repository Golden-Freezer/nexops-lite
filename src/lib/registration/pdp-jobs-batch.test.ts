/**
 * 잡 모델 배치 저장(R03, DDL 없음) — 생성은 spec_sheet 예약 키로 배치·단계 스냅숏을 넣고, 읽을 때(toJob) 꺼내 칸으로 옮기며
 * spec_sheet에서는 지운다(프롬프트·편집기가 보지 않게). 키가 없는 잡은 칸도 없다(지금과 같은 행). DB는 모의.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createPdpJob } from './pdp-jobs'

const ROW = {
  id: 'job-1',
  user_id: 'user-1',
  business_id: null,
  draft_id: null,
  source_images: ['https://img/a.png'],
  image_model: 'gpt-image-2',
  image_quality: 'medium',
  mode: 'pro',
  generation_track: 'internalized',
  analysis: {},
  research_result: {},
  design_prompts: {},
  section_plan: {},
  copy_sections: {},
  section_images: [],
  final_html: null,
  current_step: 'analysis',
  progress: 0,
  error: null,
  cost_usd: 0,
  cost_pool: null,
  created_at: '2026-11-08T00:00:00.000Z',
  updated_at: '2026-11-08T00:00:00.000Z',
}

/** insert한 spec_sheet를 그대로 돌려주는 DB(저장 → 읽기 한 바퀴) */
function fakeDb() {
  const inserts: Array<Record<string, unknown>> = []
  const db = {
    from: () => ({
      insert(payload: Record<string, unknown>) {
        inserts.push(payload)
        const row = { ...ROW, spec_sheet: payload.spec_sheet }
        return { select: () => ({ single: async () => ({ data: row, error: null }) }) }
      },
    }),
  }
  return { db: db as unknown as SupabaseClient, inserts }
}

const INPUT = {
  specSheet: { productName: '테스트' },
  sourceImages: ['https://img/a.png'],
  imageModel: 'gpt-image-2' as const,
  imageQuality: 'medium' as const,
  mode: 'pro' as const,
  generationTrack: 'internalized' as const,
}

describe('잡 모델 배치 — 저장·읽기', () => {
  it('배치·스냅숏은 spec_sheet 예약 키로 저장하고, 읽으면 칸으로 옮기고 spec_sheet에서 지운다', async () => {
    const { db, inserts } = fakeDb()
    const snapshot = { 'images/gate': { model: 'gemini-4-argon', maxTokens: 4000, effort: 'high' } }
    const job = await createPdpJob(db, 'user-1', { ...INPUT, modelBatch: { batch: 'new', snapshot } })
    expect(inserts[0].spec_sheet).toEqual({ productName: '테스트', modelBatch: 'new', modelRouteSnapshot: snapshot })
    expect(job.spec_sheet).toEqual({ productName: '테스트' })
    expect(job.model_batch).toBe('new')
    expect(job.model_route_snapshot).toEqual(snapshot)
  })

  it('배치를 주지 않으면 지금과 같다 — 저장 spec_sheet 그대로, 읽은 잡에 배치 칸이 없다', async () => {
    const { db, inserts } = fakeDb()
    const job = await createPdpJob(db, 'user-1', INPUT)
    expect(inserts[0].spec_sheet).toEqual({ productName: '테스트' })
    expect(job).not.toHaveProperty('model_batch')
    expect(job).not.toHaveProperty('model_route_snapshot')
  })

  it('구독 표지(R13)는 subscription일 때만 키로 저장하고 읽으면 model_backend 칸으로 옮긴다 — api는 키·칸 없음', async () => {
    const marked = fakeDb()
    const job = await createPdpJob(marked.db, 'user-1', { ...INPUT, modelBatch: { batch: 'new', snapshot: {}, backend: 'subscription' } })
    expect(marked.inserts[0].spec_sheet).toEqual({ productName: '테스트', modelBatch: 'new', modelRouteSnapshot: {}, modelBackend: 'subscription' })
    expect(job.spec_sheet).toEqual({ productName: '테스트' })
    expect(job.model_backend).toBe('subscription')

    const api = fakeDb()
    const plain = await createPdpJob(api.db, 'user-1', { ...INPUT, modelBatch: { batch: 'new', snapshot: {}, backend: 'api' } })
    expect(api.inserts[0].spec_sheet).not.toHaveProperty('modelBackend')
    expect(plain).not.toHaveProperty('model_backend')
  })

  it('구독 멈춤 표지(AX-CT-29)는 구독 표지 잡만 키로 저장하고 읽으면 subscription_stop 칸으로 옮긴다 — 표지 없는 잡은 키·칸 없음(지금과 같은 행)', async () => {
    const stop = fakeDb()
    const job = await createPdpJob(stop.db, 'user-1', {
      ...INPUT,
      modelBatch: { batch: 'new', snapshot: {}, backend: 'subscription', subscriptionStop: true },
    })
    expect(stop.inserts[0].spec_sheet).toEqual({
      productName: '테스트',
      modelBatch: 'new',
      modelRouteSnapshot: {},
      modelBackend: 'subscription',
      subscriptionStop: true,
    })
    expect(job.spec_sheet).toEqual({ productName: '테스트' })
    expect(job.model_backend).toBe('subscription')
    expect(job.subscription_stop).toBe(true)

    // 구독 표지가 있어도 멈춤 표지가 없으면 지금과 같은 행
    const sub = fakeDb()
    const subJob = await createPdpJob(sub.db, 'user-1', { ...INPUT, modelBatch: { batch: 'new', snapshot: {}, backend: 'subscription' } })
    expect(sub.inserts[0].spec_sheet).not.toHaveProperty('subscriptionStop')
    expect(subJob).not.toHaveProperty('subscription_stop')

    // API 잡에는 멈춤 표지를 주어도 붙이지 않는다
    const api = fakeDb()
    const apiJob = await createPdpJob(api.db, 'user-1', { ...INPUT, modelBatch: { batch: 'new', snapshot: {}, backend: 'api', subscriptionStop: true } })
    expect(api.inserts[0].spec_sheet).not.toHaveProperty('subscriptionStop')
    expect(apiJob).not.toHaveProperty('subscription_stop')
  })
})
