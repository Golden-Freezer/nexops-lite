/**
 * 시험 잡 표식(cost_pool) — 시험 잡은 호출 사용량이 시험 풀(pdp-test)로 남고 운영 월 한도에 들어가지 않는다(오너 지시 10-31).
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { costPoolContext, jobUsageContext, usageCostPoolOf } from './pdp-cost-pool'
import { createPdpJob } from './pdp-jobs'

const ROW = {
  id: 'job-1',
  user_id: 'user-1',
  business_id: null,
  draft_id: null,
  spec_sheet: { productName: '테스트' },
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
  created_at: '2026-10-31T00:00:00.000Z',
  updated_at: '2026-10-31T00:00:00.000Z',
}

function fakeDb() {
  const inserts: Array<Record<string, unknown>> = []
  const db = {
    from: () => ({
      insert(payload: Record<string, unknown>) {
        inserts.push(payload)
        const row = { ...ROW, cost_pool: (payload.cost_pool as string | undefined) ?? null }
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

describe('PDP 잡 예산 풀', () => {
  it('시험 잡은 cost_pool=test로 만들고, 운영 잡은 칸을 보내지 않는다(칸 없는 DB에서도 운영 생성이 끊기지 않게)', async () => {
    const { db, inserts } = fakeDb()
    const test = await createPdpJob(db, 'user-1', { ...INPUT, costPool: 'test' })
    const ops = await createPdpJob(db, 'user-1', INPUT)
    expect(inserts[0]).toMatchObject({ cost_pool: 'test', user_id: 'user-1' })
    expect(inserts[1]).not.toHaveProperty('cost_pool')
    expect(test.cost_pool).toBe('test')
    expect(ops.cost_pool).toBeNull()
  })

  it('시험 잡만 호출 사용량 풀 pdp-test — runContext 조각은 운영 잡이면 비어 있다', () => {
    expect(usageCostPoolOf({ cost_pool: 'test' })).toBe('pdp-test')
    expect(usageCostPoolOf({ cost_pool: null })).toBeUndefined()
    expect(usageCostPoolOf({})).toBeUndefined()
    expect(costPoolContext({ cost_pool: 'test' })).toEqual({ costPool: 'pdp-test' })
    expect(costPoolContext({ cost_pool: null })).toEqual({})
  })

  it('시험 잡만 run_id=잡 ID — 운영 잡은 지금과 같은 빈 조각(ai_usage_log.run_id를 건드리지 않는다)', () => {
    expect(jobUsageContext({ id: 'job-1', cost_pool: 'test' })).toEqual({ costPool: 'pdp-test', runId: 'job-1' })
    expect(jobUsageContext({ id: 'job-1', cost_pool: null })).toEqual({})
    expect(jobUsageContext({ id: 'job-1' })).toEqual({})
  })

  it('구독 표지 잡(R13)은 운영 잡이어도 run_id=잡 ID — 구독·잇기 콜을 잡과 묶는다(풀은 그대로 운영)', () => {
    expect(jobUsageContext({ id: 'job-1', cost_pool: null, model_backend: 'subscription' })).toEqual({ runId: 'job-1' })
    expect(jobUsageContext({ id: 'job-1', cost_pool: 'test', model_backend: 'subscription' })).toEqual({
      costPool: 'pdp-test',
      runId: 'job-1',
    })
    expect(jobUsageContext({ id: 'job-1', model_backend: 'api' })).toEqual({})
  })
})
