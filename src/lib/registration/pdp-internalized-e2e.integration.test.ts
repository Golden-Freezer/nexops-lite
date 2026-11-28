/**
 * Track I(internalized) 파이프라인 E2E — 실 API·실 DB 관통. pdp-e2e.integration.test.ts 하네스와
 * 동일 관례(유료 게이트·소프트 종료·재개 모드)로, internalized 전용 검증을 더한다:
 *   ① 잡 generation_track 컬럼 기록  ② design 산출 activated_sections = buildSkeleton 결정론 출력
 *     (I-2 통합 게이트 — LLM이 이탈해도 enforceSkeleton이 복원했음을 실증)
 *   ③ internalized_skeleton 감사 추적(excluded 근거) 기록  ④ done 후 quality_report(trust gate) 기록
 * 스펙은 표준 E2E와 동일 상품(household) — 인증·이벤트·옵션 근거가 없어 조건 게이트(환각 금지)와
 * trust gate 경고 경로까지 함께 실증된다.
 *
 *   NEXOPS_E2E=1 NEXOPS_E2E_PAID=1 NEXOPS_E2E_TARGET=pdp-internalized-e2e npx vitest run src/lib/registration/pdp-internalized-e2e.integration.test.ts
 *   재개: NEXOPS_E2E_JOB_ID=<id> 동일 명령(재개 잡은 삭제하지 않는다) · 보존: NEXOPS_E2E_KEEP=1
 */

import { describe, it, expect, beforeAll } from 'vitest'
import type { ImageModel, ImageQuality } from '@/lib/agents/image/types'
import type { PdpMode, PdpSpecSheet } from './pdp-state'
import { canDeleteJob, loadE2EEnv, shouldRunPaid } from './__e2e__/e2e-env'

const RUN = shouldRunPaid('pdp-internalized-e2e')
const OWNER_USER_ID = 'user_3Bkwe08mkfnqi2K0knP7Vag4gwn'

const MAX_RUN_CALLS = 60
const TOTAL_TIMEOUT_MS = 3_600_000
const SOFT_BUDGET_MS = 450_000

const E2E_MODE: PdpMode = process.env.NEXOPS_E2E_MODE === 'premium' ? 'premium' : 'pro'
const E2E_QUALITY: ImageQuality = process.env.NEXOPS_E2E_QUALITY === 'high' ? 'high' : 'medium'
const E2E_MODEL: ImageModel = process.env.NEXOPS_E2E_MODEL === 'gemini-3-pro-image' ? 'gemini-3-pro-image' : 'gpt-image-2'

// 표준 E2E와 동일 스펙 — 트랙 간 비교 가능 기준선. category=household(v2 스냅샷 보유).
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
  // 실상품 속성(오너 확인 2026-08-12): 폭죽은 만 14세 이상 사용 — 어린이 KC 미인증. 리뷰 원문에
  // "아이 생일파티"가 있어도 컴플라이언스 게이트가 카피·이미지·인용에서 걸러내야 한다(실검증 대상).
  minAgeYears: 14,
}

const SOURCE_IMAGE_PATH =
  `${OWNER_USER_ID}/registration/56a06150-82c8-44ef-bfca-e56945546b92/thumb-cutout-1786357147976.jpg`

const KEEP_JOB = process.env.NEXOPS_E2E_KEEP === '1'
const RESUME_JOB_ID = process.env.NEXOPS_E2E_JOB_ID?.trim() || null

describe.skipIf(!RUN)('PDP internalized 트랙 E2E (real APIs)', () => {
  beforeAll(() => {
    const env = loadE2EEnv()
    console.log(`[E2E-I] env 적재: ${env.source} (${env.loadedKeys}개 키)`)
  })

  it(
    `internalized/${E2E_MODE}/${E2E_QUALITY}/${E2E_MODEL}: 골격 결정론·trust gate 관통`,
    { timeout: TOTAL_TIMEOUT_MS },
    async () => {
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const { createPdpJob, getPdpJob, deletePdpJob } = await import('./pdp-jobs')
      const { runPdpStep } = await import('./pdp-pipeline')
      const { getCorpusSnapshotV2 } = await import('./corpus-v2')
      const { buildSkeleton } = await import('./internalized/pdp-internalized-skeleton')

      const db = createAdminClient()

      let job
      if (RESUME_JOB_ID) {
        const existing = await getPdpJob(db, OWNER_USER_ID, RESUME_JOB_ID)
        expect(existing, `재개할 잡 없음: ${RESUME_JOB_ID}`).toBeTruthy()
        job = existing!
        console.log(`[E2E-I] 잡 재개: ${job.id} (${job.current_step} ${job.progress}%)`)
      } else {
        const { data: pub } = db.storage.from('sourcing-product-images').getPublicUrl(SOURCE_IMAGE_PATH)
        const head = await fetch(pub.publicUrl, { method: 'HEAD' })
        expect(head.ok, `참조 이미지 접근 불가: ${pub.publicUrl}`).toBe(true)

        job = await createPdpJob(db, OWNER_USER_ID, {
          specSheet: SPEC_SHEET,
          sourceImages: [pub.publicUrl],
          imageModel: E2E_MODEL,
          imageQuality: E2E_QUALITY,
          mode: E2E_MODE,
          generationTrack: 'internalized',
        })
        expect(job.generation_track).toBe('internalized') // 컬럼 왕복
        expect('generationTrack' in job.spec_sheet).toBe(false) // spec_sheet 무오염(T-7)
        console.log(`[E2E-I] 잡 생성: ${job.id}`)
      }

      const invocationStart = Date.now()
      let current = job
      const stepLog: string[] = []
      for (let i = 0; i < MAX_RUN_CALLS; i++) {
        if (Date.now() - invocationStart > SOFT_BUDGET_MS) {
          console.log(`[E2E-I] 소프트 종료(시간 상한) — 재호출로 이어서: NEXOPS_E2E_JOB_ID=${job.id}`)
          expect(current.current_step).not.toBe('failed')
          return
        }
        current = await runPdpStep(job.id, OWNER_USER_ID)
        const line =
          `[E2E-I] run ${i + 1}: ${current.current_step} ${current.progress}% ` +
          `images=${current.section_images.filter((s) => s.url).length}/${current.section_images.length} cost=$${current.cost_usd.toFixed(3)}`
        stepLog.push(line)
        console.log(line)
        if (current.current_step === 'done' || current.current_step === 'failed') break
      }

      expect(current.current_step, `잡 실패 또는 미완주: ${current.error}\n${stepLog.join('\n')}`).toBe('done')

      // ── internalized 전용 검증 ──
      // ② 골격 결정론: design 산출이 buildSkeleton(순수 함수) 출력과 정확히 일치해야 한다(I-2 통합 게이트).
      //    detected_category 기준 스냅샷 — household 스펙이므로 category 감지도 household여야 정상.
      const snapshot = getCorpusSnapshotV2(current.analysis.detected_category)
      expect(snapshot, `v2 스냅샷 없음: detected_category=${current.analysis.detected_category}`).toBeTruthy()
      const expected = buildSkeleton({ snapshot: snapshot!, specSheet: current.spec_sheet, strategyContract: {} })
      expect(current.section_plan.activated_sections).toEqual(expected.activatedSections.map(String))
      expect(current.section_plan.section_order).toEqual(expected.sectionOrder.map(String))

      // ③ 골격 감사 추적 — excluded에 근거 미보유 역할(환각 금지)과 플랫폼 영역이 기록돼야 한다
      const skeletonAudit = current.section_plan.internalized_skeleton
      expect(skeletonAudit).toBeTruthy()
      const excludedRoles = (skeletonAudit?.excluded ?? []).map((e) => e.role)
      expect(excludedRoles).toContain('certification_evidence') // certificationInfo 없음
      expect(excludedRoles).toContain('shipping_cs') // 플랫폼 영역

      // ④ trust gate — 근거 미입력 필수 역할이 정직하게 누락 보고돼야 한다(경고만, 완주는 차단 안 함)
      const report = current.copy_sections.quality_report
      expect(report).toBeTruthy()
      expect(report!.trust_gate.missing_required).toContain('certification_evidence')
      expect(report!.trust_gate.user_action_hints.length).toBeGreaterThan(0)

      // 공통 산출 검증
      expect(current.copy_sections.final).toBeTruthy()
      expect(current.final_html).toBeTruthy()
      expect(current.section_images.filter((s) => s.url).length).toBeGreaterThan(0)

      console.log('\n[E2E-I] ── 결과 요약 ──')
      console.log(`섹션 순서(${current.section_plan.section_order?.length}): ${current.section_plan.section_order?.join(' → ')}`)
      console.log(`골격 제외: ${(skeletonAudit?.excluded ?? []).map((e) => `${e.role}(${e.reason})`).join(' / ')}`)
      console.log(`trust gate: pass=${report!.trust_gate.pass} missing_required=${report!.trust_gate.missing_required.join(',')}`)
      console.log(`힌트: ${report!.trust_gate.user_action_hints.join(' | ')}`)
      console.log(`비용: $${current.cost_usd.toFixed(3)} · 이미지 ${current.section_images.filter((s) => s.url).length}/${current.section_images.length}`)

      // H1: 삭제는 이번 실행이 만든 잡만 — 재개 잡은 KEEP과 무관하게 보존한다.
      if (canDeleteJob({ createdByThisRun: !RESUME_JOB_ID, keep: KEEP_JOB })) {
        await deletePdpJob(db, OWNER_USER_ID, job.id)
      } else {
        const reason = RESUME_JOB_ID ? '재개 잡' : 'NEXOPS_E2E_KEEP=1'
        console.log(`[E2E-I] 잡 보존(${reason}): ${job.id} — /registration/detail-page?jobId=${job.id} 에서 육안 검수`)
      }
    }
  )
})
