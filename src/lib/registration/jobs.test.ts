/**
 * jobs.ts CRUD — user_id 격리 필터 강제 검증 (체이너블 Supabase 스텁으로 쿼리 구성 캡처).
 * 전역 규칙: 모든 UPDATE/DELETE는 명시적 소유 필터 필수.
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createThumbnailJob,
  getThumbnailJob,
  listThumbnailJobs,
  updateThumbnailJob,
  deleteThumbnailJob,
} from './jobs'

interface CapturedQuery {
  table: string
  method: 'select' | 'insert' | 'update' | 'delete' | null
  eqs: Array<[string, unknown]>
  insertPayload?: Record<string, unknown>
  updatePayload?: Record<string, unknown>
}

const SAMPLE_ROW = {
  id: 'job-1',
  user_id: 'user-1',
  business_id: null,
  draft_id: null,
  source_images: ['https://a.test/1.png'],
  product_name: null,
  category_hint: null,
  image_model: 'gpt-image-2',
  image_quality: 'medium',
  vision_analysis: {},
  cuts: {},
  selected_cut: null,
  status: 'pending',
  progress: 0,
  error: null,
  cost_usd: 0,
  created_at: '2026-08-10T00:00:00Z',
  updated_at: '2026-08-10T00:00:00Z',
}

/** thenable 체이너블 스텁 — 호출된 필터·페이로드를 기록하고 SAMPLE_ROW를 돌려준다 */
function stubClient(captured: CapturedQuery[]): SupabaseClient {
  function makeBuilder(table: string) {
    const q: CapturedQuery = { table, method: null, eqs: [] }
    captured.push(q)
    const rows = () => [{ ...SAMPLE_ROW }]
    const builder: Record<string, unknown> = {
      select(_cols?: string) {
        if (q.method === null) q.method = 'select'
        return builder
      },
      insert(payload: Record<string, unknown>) {
        q.method = 'insert'
        q.insertPayload = payload
        return builder
      },
      update(payload: Record<string, unknown>) {
        q.method = 'update'
        q.updatePayload = payload
        return builder
      },
      delete() {
        q.method = 'delete'
        return builder
      },
      eq(col: string, val: unknown) {
        q.eqs.push([col, val])
        return builder
      },
      order() {
        return builder
      },
      limit() {
        return builder
      },
      single() {
        return Promise.resolve({ data: rows()[0], error: null })
      },
      then(resolve: (v: { data: unknown[]; error: null }) => void) {
        resolve({ data: rows(), error: null })
      },
    }
    return builder
  }
  return { from: (table: string) => makeBuilder(table) } as unknown as SupabaseClient
}

describe('registration_thumbnail_jobs CRUD 격리 필터', () => {
  it('create: user_id가 insert 페이로드에 강제 포함된다', async () => {
    const captured: CapturedQuery[] = []
    await createThumbnailJob(stubClient(captured), 'user-1', {
      sourceImages: ['https://a.test/1.png'],
      imageModel: 'gpt-image-2',
      imageQuality: 'medium',
    })
    expect(captured[0].method).toBe('insert')
    expect(captured[0].insertPayload?.user_id).toBe('user-1')
    expect(captured[0].insertPayload?.image_model).toBe('gpt-image-2')
    expect(captured[0].insertPayload?.image_quality).toBe('medium')
  })

  it('get/list: user_id eq 필터가 걸린다', async () => {
    const captured: CapturedQuery[] = []
    const db = stubClient(captured)
    await getThumbnailJob(db, 'user-1', 'job-1')
    await listThumbnailJobs(db, 'user-1')
    for (const q of captured) {
      expect(q.eqs).toContainEqual(['user_id', 'user-1'])
    }
  })

  it('update: user_id + id 필터가 둘 다 걸리고 updated_at이 갱신된다', async () => {
    const captured: CapturedQuery[] = []
    await updateThumbnailJob(stubClient(captured), 'user-1', 'job-1', { status: 'failed', error: 'x' })
    const q = captured[0]
    expect(q.method).toBe('update')
    expect(q.eqs).toContainEqual(['user_id', 'user-1'])
    expect(q.eqs).toContainEqual(['id', 'job-1'])
    expect(q.updatePayload?.status).toBe('failed')
    expect(q.updatePayload?.updated_at).toBeTruthy()
  })

  it('delete: user_id + id 필터가 둘 다 걸린다', async () => {
    const captured: CapturedQuery[] = []
    await deleteThumbnailJob(stubClient(captured), 'user-1', 'job-1')
    const q = captured[0]
    expect(q.method).toBe('delete')
    expect(q.eqs).toContainEqual(['user_id', 'user-1'])
    expect(q.eqs).toContainEqual(['id', 'job-1'])
  })

  it('행 매핑: snake_case → camelCase, cost_usd 숫자 변환', async () => {
    const captured: CapturedQuery[] = []
    const job = await getThumbnailJob(stubClient(captured), 'user-1', 'job-1')
    expect(job?.imageModel).toBe('gpt-image-2')
    expect(job?.costUsd).toBe(0)
    expect(job?.visionAnalysis).toBeNull() // 빈 객체 {} → null
    expect(job?.sourceImages).toEqual(['https://a.test/1.png'])
  })
})
