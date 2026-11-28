/**
 * 상세페이지(PDP) 파이프라인 E2E — 실 API(Anthropic·OpenAI/Gemini)·실 DB 관통.
 * 비용이 발생하므로 기본 skip — 유료 게이트(H2)는 대상 파일을 명시해야 열린다:
 *   NEXOPS_E2E=1 NEXOPS_E2E_PAID=1 NEXOPS_E2E_TARGET=pdp-e2e npx vitest run src/lib/registration/pdp-e2e.integration.test.ts
 *
 * 모드·품질은 env로 파라미터화(기본은 비용을 낮게 유지):
 *   NEXOPS_E2E_MODE=premium|pro (기본 pro)
 *   NEXOPS_E2E_QUALITY=medium|high (기본 medium — high는 §9.1 실측상 컷당 비용·시간이 크다)
 *   NEXOPS_E2E_MODEL=gpt-image-2|gemini-3-pro-image (기본 gpt-image-2)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import type { ImageModel, ImageQuality } from '@/lib/agents/image/types'
import type { PdpMode, PdpSpecSheet } from './pdp-state'
import { canDeleteJob, expectedImageModel, loadE2EEnv, sectionFromImageStage, shouldRunPaid } from './__e2e__/e2e-env'

const RUN = shouldRunPaid('pdp-e2e')
const OWNER_USER_ID = 'user_3Bkwe08mkfnqi2K0knP7Vag4gwn'

// run() 분할 실행 루프 상한 — PdpProgress.tsx(item 1)의 ABSOLUTE_MAX_RUN_CALLS와 동일 값을 쓴다.
// 단계당 최대 180s(analysis~compose는 수십 초, images는 고품질 컷 1장 기준 최대 ~80s)를 감안해도
// 실제 총 소요는 이 상한보다 한참 낮다 — 전체 타임아웃은 넉넉히 3600s로 잡는다.
const MAX_RUN_CALLS = 60
const TOTAL_TIMEOUT_MS = 3_600_000

const E2E_MODE: PdpMode = process.env.NEXOPS_E2E_MODE === 'premium' ? 'premium' : 'pro'
const E2E_QUALITY: ImageQuality = process.env.NEXOPS_E2E_QUALITY === 'high' ? 'high' : 'medium'
const E2E_MODEL: ImageModel = process.env.NEXOPS_E2E_MODEL === 'gemini-3-pro-image' ? 'gemini-3-pro-image' : 'gpt-image-2'

// 실상품 시나리오: 오너 버킷의 Phase 1 산출 클린 컷(파티 꽃가루 폭죽 세트)을 참조로,
// 오너 브랜드(지야픽)로 재등록하는 소싱 실사용 흐름. category=household → 코퍼스 그라운딩 주입 경로 실검증.
const SPEC_SHEET: PdpSpecSheet = {
  productName: '지야픽 생일 파티 꽃가루 폭죽 세트 10개입',
  brandName: '지야픽',
  category: 'household',
  keyFeatures: ['돌리기만 하면 터지는 간편 사용', '10개입 대용량 구성', '화려한 컬러 꽃가루'],
  material: '종이/압축공기',
  usageLocation: '생일파티/기념일/이벤트',
  size: '길이 30cm 원통형 10개입',
  reviewsText:
    '아이 생일파티에 썼는데 아이들이 정말 좋아했어요. 돌리기만 하면 돼서 사용이 쉽습니다. ' +
    '꽃가루 색이 화려해서 사진이 예쁘게 나와요. 다만 뒷정리가 조금 번거로웠어요. ' +
    '10개 들어있어서 행사 내내 넉넉하게 썼습니다.',
  imagePhotoStyle: 'studio',
  // 실상품 속성(오너 확인 2026-08-12): 폭죽은 만 14세 이상 사용 — 컴플라이언스 게이트 발동 스펙
  minAgeYears: 14,
}

// Phase 1 E2E 산출 클린 컷 — 스펙과 동일 상품의 실사진 (버킷 root의 마케팅 합성 이미지는 텍스트 과다로 부적합)
const SOURCE_IMAGE_PATH =
  `${OWNER_USER_ID}/registration/56a06150-82c8-44ef-bfca-e56945546b92/thumb-cutout-1786357147976.jpg`

// NEXOPS_E2E_KEEP=1 — 잡을 삭제하지 않고 보존(오너 육안 검수용, /registration/history에서 확인)
const KEEP_JOB = process.env.NEXOPS_E2E_KEEP === '1'

// NEXOPS_E2E_JOB_ID — 기존 잡 재개 모드(런너 시간 상한 회피: 한 invocation은 SOFT_BUDGET까지만 돌고
// 소프트 종료, 외부에서 done까지 재호출). 잡 생성·이미지콜 로그 검증은 생성 invocation에서만 수행.
const RESUME_JOB_ID = process.env.NEXOPS_E2E_JOB_ID?.trim() || null
const SOFT_BUDGET_MS = 450_000

describe.skipIf(!RUN)('PDP 파이프라인 E2E (real APIs)', () => {
  beforeAll(() => {
    const env = loadE2EEnv()
    console.log(`[E2E] env 적재: ${env.source} (${env.loadedKeys}개 키)`)
  })

  it(
    `${E2E_MODE}/${E2E_QUALITY}/${E2E_MODEL}: 6단계 관통·산출·비용 로그·격리`,
    { timeout: TOTAL_TIMEOUT_MS },
    async () => {
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const { createPdpJob, getPdpJob, deletePdpJob } = await import('./pdp-jobs')
      const { runPdpStep } = await import('./pdp-pipeline')
      const { currentMonthKey } = await import('@/lib/agents/budget')
      const { buildImageTasks } = await import('./pdp-image-tasks')

      const db = createAdminClient()
      const startedAt = new Date().toISOString()

      let job
      if (RESUME_JOB_ID) {
        const existing = await getPdpJob(db, OWNER_USER_ID, RESUME_JOB_ID)
        expect(existing, `재개할 잡 없음: ${RESUME_JOB_ID}`).toBeTruthy()
        job = existing!
        console.log(`[E2E] 잡 재개: ${job.id} (${job.current_step} ${job.progress}%)`)
      } else {
        // 실존 소스 이미지 — Phase 1 산출 클린 컷 (스펙과 동일 상품)
        const { data: pub } = db.storage.from('sourcing-product-images').getPublicUrl(SOURCE_IMAGE_PATH)
        const head = await fetch(pub.publicUrl, { method: 'HEAD' })
        expect(head.ok, `참조 이미지 접근 불가: ${pub.publicUrl}`).toBe(true)

        job = await createPdpJob(db, OWNER_USER_ID, {
          specSheet: SPEC_SHEET,
          sourceImages: [pub.publicUrl],
          imageModel: E2E_MODEL,
          imageQuality: E2E_QUALITY,
          mode: E2E_MODE,
          generationTrack: 'standard',
        })
        expect(job.current_step).toBe('pending')
        expect(job.mode).toBe(E2E_MODE)
      }

      const invocationStart = Date.now()
      let current = job
      const stepLog: string[] = []
      for (let i = 0; i < MAX_RUN_CALLS; i++) {
        if (Date.now() - invocationStart > SOFT_BUDGET_MS) {
          console.log(`[E2E] 소프트 종료(시간 상한) — 재호출로 이어서: NEXOPS_E2E_JOB_ID=${job.id}`)
          expect(current.current_step).not.toBe('failed')
          return
        }
        current = await runPdpStep(job.id, OWNER_USER_ID)
        const line = `[E2E ${E2E_MODE}/${E2E_QUALITY}] run ${i + 1}: ${current.current_step} ${current.progress}% ` +
          `images=${current.section_images.filter((s) => s.url).length}/${current.section_images.length} cost=$${current.cost_usd.toFixed(3)}`
        stepLog.push(line)
        console.log(line)
        if (current.current_step === 'done' || current.current_step === 'failed') break
      }

      expect(current.current_step, `잡 실패 또는 미완주: ${current.error}\n${stepLog.join('\n')}`).toBe('done')

      // 산출 검증 — copy_sections.final·final_html·section_images 성공 수
      expect(current.copy_sections.final).toBeTruthy()
      expect(current.final_html).toBeTruthy()
      expect(current.final_html!.length).toBeGreaterThan(500)
      const succeededImages = current.section_images.filter((s) => s.url)
      expect(succeededImages.length).toBeGreaterThan(0)
      expect(current.cost_usd).toBeGreaterThan(0)

      // 비용 로그 — 이번 실행 구간·오너 user_id만 대조(설계문서 Phase 1 검증 항목과 동일 관례).
      // 재개 invocation은 남은 단계에 이미지 콜이 없을 수 있어 생성 invocation에서만 이미지 콜을 강검증.
      // H3: 기대 모델은 컷별(task.model ?? job.image_model)로 계산한다. ai_usage_log에 잡 ID 컬럼이 없어
      // stage(images/<section>)로 이 잡의 태스크와 맞추고, 태스크에 없는 section 행은 다른 실행으로 보고 건너뛴다.
      const { data: logs } = await db
        .from('ai_usage_log')
        .select('agent, model, stage, created_at')
        .eq('month_key', currentMonthKey())
        .eq('user_id', OWNER_USER_ID)
        .gte('created_at', startedAt)
        .like('agent', 'registration/pdp%')
        .limit(200)
      if (!RESUME_JOB_ID) {
        expect((logs ?? []).length).toBeGreaterThan(0)
        const imageCalls = (logs ?? []).filter((r) => r.agent === 'registration/pdp-image')
        expect(imageCalls.length).toBeGreaterThan(0)
        const tasks = buildImageTasks(current)
        let foreignRows = 0
        for (const row of imageCalls) {
          const section = sectionFromImageStage(row.stage)
          const task = section ? tasks.find((t) => t.section === section) : undefined
          if (!task) {
            foreignRows++
            continue
          }
          expect(row.model, `컷 ${section} 이미지 모델`).toBe(expectedImageModel(task, current))
        }
        if (foreignRows > 0) console.log(`[E2E] 이 잡 태스크와 맞지 않는 이미지 로그 ${foreignRows}건 — 다른 실행으로 보고 제외`)
        expect(foreignRows).toBeLessThan(imageCalls.length)
      }

      // 격리 — 타 user_id로는 이 잡이 보이지 않는다
      const foreign = await getPdpJob(db, 'user_intruder_e2e', job.id)
      expect(foreign).toBeNull()

      // H1: 삭제는 이번 실행이 만든 잡만 — 재개 잡은 KEEP과 무관하게 보존한다.
      if (canDeleteJob({ createdByThisRun: !RESUME_JOB_ID, keep: KEEP_JOB })) {
        await deletePdpJob(db, OWNER_USER_ID, job.id)
      } else {
        const reason = RESUME_JOB_ID ? '재개 잡' : 'NEXOPS_E2E_KEEP=1'
        console.log(`[E2E] 잡 보존(${reason}): ${job.id} — /registration/history에서 육안 검수`)
      }
    }
  )
})
