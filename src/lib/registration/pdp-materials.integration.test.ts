/**
 * 재료 기반 범용 PDP 실행 하네스 — 임의 상품의 spec JSON으로 잡을 생성해 완주시킨다(실 API·실 DB).
 * I-5 다상품 비교·실등록용 생성 공용 러너. E2E 하네스와 동일 관례(소프트 종료·재개), 잡은 항상 보존.
 *
 *   NEXOPS_E2E=1 NEXOPS_E2E_PAID=1 NEXOPS_E2E_TARGET=pdp-materials NEXOPS_E2E_SPEC_FILE=<json 경로> \
 *     npx vitest run src/lib/registration/pdp-materials.integration.test.ts
 *   재개: NEXOPS_E2E_JOB_ID=<uuid> (SPEC_FILE 불필요)
 *
 * spec JSON 스키마: { specSheet: PdpSpecSheet, sourceImages: string[], generationTrack?, mode?, imageQuality?, imageModel? }
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import type { ImageModel, ImageQuality } from '@/lib/agents/image/types'
import type { GenerationTrack, PdpMode, PdpSpecSheet } from './pdp-state'
import { loadE2EEnv, shouldRunPaid } from './__e2e__/e2e-env'

const RUN = shouldRunPaid('pdp-materials')
const OWNER_USER_ID = 'user_3Bkwe08mkfnqi2K0knP7Vag4gwn'
const MAX_RUN_CALLS = 60
const TOTAL_TIMEOUT_MS = 3_600_000
const SOFT_BUDGET_MS = 450_000

const SPEC_FILE = process.env.NEXOPS_E2E_SPEC_FILE?.trim() || null
const RESUME_JOB_ID = process.env.NEXOPS_E2E_JOB_ID?.trim() || null

interface MaterialSpec {
  specSheet: PdpSpecSheet
  sourceImages: string[]
  generationTrack?: GenerationTrack
  mode?: PdpMode
  imageQuality?: ImageQuality
  imageModel?: ImageModel
}

describe.skipIf(!RUN)('재료 기반 PDP 생성 러너 (real APIs)', () => {
  beforeAll(() => {
    const env = loadE2EEnv()
    console.log(`[MAT] env 적재: ${env.source} (${env.loadedKeys}개 키)`)
  })

  it('spec JSON 잡 생성·완주', { timeout: TOTAL_TIMEOUT_MS }, async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { createPdpJob, getPdpJob } = await import('./pdp-jobs')
    const { runPdpStep } = await import('./pdp-pipeline')

    const db = createAdminClient()
    let job
    if (RESUME_JOB_ID) {
      const existing = await getPdpJob(db, OWNER_USER_ID, RESUME_JOB_ID)
      expect(existing, `재개할 잡 없음: ${RESUME_JOB_ID}`).toBeTruthy()
      job = existing!
      console.log(`[MAT] 잡 재개: ${job.id} (${job.current_step} ${job.progress}%)`)
    } else {
      expect(SPEC_FILE, 'NEXOPS_E2E_SPEC_FILE 필요').toBeTruthy()
      const material = JSON.parse(readFileSync(SPEC_FILE!, 'utf8')) as MaterialSpec
      expect(material.specSheet?.productName?.trim()).toBeTruthy()
      expect(material.sourceImages?.length).toBeGreaterThan(0)
      job = await createPdpJob(db, OWNER_USER_ID, {
        specSheet: material.specSheet,
        sourceImages: material.sourceImages,
        imageModel: material.imageModel ?? 'gpt-image-2',
        imageQuality: material.imageQuality ?? 'medium',
        mode: material.mode ?? 'pro',
        generationTrack: material.generationTrack ?? 'standard',
      })
      console.log(`[MAT] 잡 생성: ${job.id} (${job.spec_sheet.productName} · ${job.generation_track})`)
    }

    const start = Date.now()
    let current = job
    for (let i = 0; i < MAX_RUN_CALLS; i++) {
      if (Date.now() - start > SOFT_BUDGET_MS) {
        console.log(`[MAT] 소프트 종료 — 재호출: NEXOPS_E2E_JOB_ID=${job.id}`)
        expect(current.current_step).not.toBe('failed')
        return
      }
      current = await runPdpStep(job.id, OWNER_USER_ID)
      console.log(
        `[MAT] run ${i + 1}: ${current.current_step} ${current.progress}% images=${current.section_images.filter((s) => s.url).length}/${current.section_images.length} cost=$${current.cost_usd.toFixed(3)}`
      )
      if (current.current_step === 'done' || current.current_step === 'failed') break
    }

    expect(current.current_step, `잡 실패: ${current.error}`).toBe('done')
    expect(current.final_html).toBeTruthy()
    console.log(
      `[MAT] 완료: ${job.id} · 섹션 ${current.section_plan.section_order?.length} · $${current.cost_usd.toFixed(3)} — /registration/detail-page?jobId=${job.id}`
    )
  })
})
