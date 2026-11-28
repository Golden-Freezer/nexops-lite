/**
 * 대표이미지 파이프라인 E2E — 실 API(Anthropic·OpenAI·Gemini)·실 DB 관통.
 * 비용이 발생하므로 기본 skip — 유료 게이트(H2)는 대상 파일을 명시해야 열린다:
 *   NEXOPS_E2E=1 NEXOPS_E2E_PAID=1 NEXOPS_E2E_TARGET=thumbnail-e2e npx vitest run src/lib/registration/thumbnail-e2e.integration.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { loadE2EEnv, shouldRunPaid } from './__e2e__/e2e-env'

const RUN = shouldRunPaid('thumbnail-e2e')
const OWNER_USER_ID = 'user_3Bkwe08mkfnqi2K0knP7Vag4gwn'

describe.skipIf(!RUN)('thumbnail pipeline E2E (real APIs)', () => {
  beforeAll(() => {
    const env = loadE2EEnv()
    console.log(`[E2E thumb] env 적재: ${env.source} (${env.loadedKeys}개 키)`)
  })

  async function runFullJob(imageModel: 'gpt-image-2' | 'gemini-3-pro-image') {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { createThumbnailJob } = await import('./jobs')
    const { runThumbnailStep } = await import('./thumbnail-pipeline')
    const { currentMonthKey } = await import('@/lib/agents/budget')

    const db = createAdminClient()
    const startedAt = new Date().toISOString()
    // 실존 소스 이미지 1장 — 오너 버킷의 기존 생성 이미지 재사용
    const { data: files, error: listErr } = await db.storage
      .from('sourcing-product-images')
      .list(OWNER_USER_ID, { limit: 1 })
    expect(listErr).toBeNull()
    expect(files && files.length).toBeTruthy()
    const { data: pub } = db.storage
      .from('sourcing-product-images')
      .getPublicUrl(`${OWNER_USER_ID}/${files![0].name}`)

    const job = await createThumbnailJob(db, OWNER_USER_ID, {
      sourceImages: [pub.publicUrl],
      productName: 'E2E 테스트 상품',
      imageModel,
      imageQuality: 'medium',
    })
    expect(job.status).toBe('pending')
    expect(job.imageModel).toBe(imageModel)

    let current = job
    for (let i = 0; i < 12; i++) {
      const next = await runThumbnailStep(db, OWNER_USER_ID, job.id)
      expect(next).not.toBeNull()
      current = next!
      console.log(
        `[E2E ${imageModel}] step ${i + 1}: ${current.status} ${current.progress}% cost=$${current.costUsd.toFixed(3)}`
      )
      if (current.status === 'done' || current.status === 'failed') break
    }

    // 이번 잡 실행 구간의 로그만 대조 — 선택 모델이 실제 이미지 콜 경로에 반영됐는지(설계문서 Phase 1 검증 항목)
    const { data: logs } = await db
      .from('ai_usage_log')
      .select('agent, model, created_at')
      .eq('month_key', currentMonthKey())
      .gte('created_at', startedAt)
      .like('agent', 'registration/thumbnail%')
      .limit(100)
    const imageCalls = (logs ?? []).filter((r) => r.agent === 'registration/thumbnail-image')
    expect(imageCalls.length).toBeGreaterThan(0)
    expect(imageCalls.every((r) => r.model === imageModel)).toBe(true)

    return { db, job: current }
  }

  it('gpt-image-2: 3컷 생성·게이트·비용 기록 관통', { timeout: 600_000 }, async () => {
    const { job } = await runFullJob('gpt-image-2')
    expect(job.status, `잡 실패: ${job.error}`).toBe('done')
    expect(job.cuts.cutout?.url).toBeTruthy()
    expect(job.cuts.studio?.url).toBeTruthy()
    expect(job.cuts.usage?.url).toBeTruthy()
    expect(job.cuts.cutout?.gate).toBeTruthy()
    expect(job.visionAnalysis?.category).toBeTruthy()
    expect(job.costUsd).toBeGreaterThan(0)
  })

  it('gemini-3-pro-image: 3컷 생성·게이트·비용 기록 관통', { timeout: 600_000 }, async () => {
    const { job } = await runFullJob('gemini-3-pro-image')
    expect(job.status, `잡 실패: ${job.error}`).toBe('done')
    expect(job.cuts.cutout?.url).toBeTruthy()
    expect(job.cuts.studio?.url).toBeTruthy()
    expect(job.cuts.usage?.url).toBeTruthy()
    expect(job.costUsd).toBeGreaterThan(0)
  })

  it('ai_usage_log에 이미지·에이전트 사용량이 기록됐다', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { currentMonthKey } = await import('@/lib/agents/budget')
    const db = createAdminClient()
    const { data, error } = await db
      .from('ai_usage_log')
      .select('agent, model, cost_usd')
      .eq('month_key', currentMonthKey())
      .like('agent', 'registration/thumbnail%')
      .limit(100)
    expect(error).toBeNull()
    const agents = new Set((data ?? []).map((r) => r.agent))
    expect(agents.has('registration/thumbnail-image')).toBe(true)
    expect(agents.has('registration/thumbnail-vision')).toBe(true)
    expect(agents.has('registration/thumbnail-gate')).toBe(true)
  })

  it('격리: 타 user_id로는 잡이 보이지 않는다', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { listThumbnailJobs } = await import('./jobs')
    const db = createAdminClient()
    const mine = await listThumbnailJobs(db, OWNER_USER_ID)
    expect(mine.length).toBeGreaterThan(0)
    const others = await listThumbnailJobs(db, 'user_intruder_e2e')
    expect(others).toHaveLength(0)
  })
})
