/**
 * Canvas 에디터 문서 통합 검증 — 실 DB의 완료(done) PDP 잡으로
 *   ① 서버 응답 조립(assembleEditorDataResponse) → ② 클라이언트 문서 빌드(buildEditorDocument)
 *   → ③ 저장 왕복(upsertEditorData → getEditorData) 을 관통한다.
 * API 비용 없음 — 그래도 실 DB 접근이라 기본 skip.
 *   읽기(①②): NEXOPS_E2E=1 npx vitest run src/lib/registration/editor-document.integration.test.ts
 *   쓰기(③ 왕복)까지: NEXOPS_E2E=1 NEXOPS_E2E_DB_WRITE=1 NEXOPS_E2E_TARGET=editor-document 를 더한다
 *     (폴더 단위 NEXOPS_E2E=1 실행이 테스트 행을 쓰지 않게 하는 쓰기 게이트 — 2026-10-27 T0 L3 점검 후속)
 *   NEXOPS_E2E_JOB_ID=<uuid>  (선택 — 미지정 시 오너의 최신 done 잡)
 *
 * 왕복(③)은 해당 잡에 에디터 저장본이 "없을 때만" 실행한다 — 이미 편집 중인
 * 문서를 테스트가 덮어쓰는 파괴적 쓰기를 막기 위한 가드. 테스트 행은 종료 시 삭제.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PdpJobRow } from './pdp-state'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { loadE2EEnv, shouldRunDbWrite, shouldRunFree } from './__e2e__/e2e-env'

// 읽기(①②)는 무료 게이트(NEXOPS_E2E=1), 테스트 행을 쓰는 왕복(③)은 쓰기 게이트까지 열려야 한다.
const RUN = shouldRunFree()
const RUN_WRITE = shouldRunDbWrite('editor-document')
const OWNER_USER_ID = 'user_3Bkwe08mkfnqi2K0knP7Vag4gwn'

describe.skipIf(!RUN)('에디터 문서 통합 (실 DB)', () => {
  let db: SupabaseClient
  let job: PdpJobRow

  beforeAll(async () => {
    const env = loadE2EEnv()
    console.log(`[editor-doc] env 적재: ${env.source} (${env.loadedKeys}개 키)`)
    const { createAdminClient } = await import('@/lib/supabase/admin')
    db = createAdminClient() as unknown as SupabaseClient

    const jobId = process.env.NEXOPS_E2E_JOB_ID
    if (jobId) {
      const { getPdpJob } = await import('./pdp-jobs')
      const found = await getPdpJob(db, OWNER_USER_ID, jobId)
      if (!found) throw new Error(`잡을 찾을 수 없습니다: ${jobId}`)
      job = found
    } else {
      const { data, error } = await db
        .from('registration_pdp_jobs')
        .select('*')
        .eq('user_id', OWNER_USER_ID)
        .eq('current_step', 'done')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) throw new Error('done 상태의 PDP 잡이 없습니다 — Phase 2 E2E 보존 잡 필요')
      job = data as PdpJobRow
    }
  })

  it('done 잡 → EditorDataResponse 조립 → CanvasSection[] 문서 빌드', async () => {
    const { assembleEditorDataResponse, getEditorData } = await import('./editor-data')
    const { buildEditorDocument } = await import('@/lib/registration/editor/utils/buildEditorDocument')

    const row = await getEditorData(db, OWNER_USER_ID, job.id)
    const response = assembleEditorDataResponse(job, row)

    expect(response.copywriting_result).toBeTruthy()
    expect(Object.keys(response.generated_images ?? {}).length).toBeGreaterThan(0)

    // 신규 진입 경로 강제(is_new) — 파이프라인 산출→캔버스 변환 자체를 검증
    const doc = await buildEditorDocument(job.id, { ...response, is_new: true, sections_data: [] })

    expect(doc.pdpId).toBe(job.id)
    expect(doc.sections.length).toBeGreaterThan(0)
    const withElements = doc.sections.filter((s) => s.elements.length > 0)
    expect(withElements.length).toBeGreaterThan(0)
    // 파이프라인 이미지가 실제로 캔버스 요소에 배선됐는지 — 최소 1개 이미지 요소
    const imageEls = doc.sections.flatMap((s) =>
      s.elements.filter((e) => e.imageProps?.src || e.framedImageProps?.src)
    )
    expect(imageEls.length).toBeGreaterThan(0)
    console.log(
      `[editor-doc] job=${job.id} sections=${doc.sections.length} imageEls=${imageEls.length} ` +
        `types=${doc.sections.map((s) => s.sectionType).join(',')}`
    )
  }, 60_000)

  it.skipIf(!RUN_WRITE)('저장 왕복: upsert → 재조회 일치 → 정리 (기존 저장본 있으면 skip)', async () => {
    const { assembleEditorDataResponse, getEditorData, upsertEditorData } = await import('./editor-data')
    const { buildEditorDocument } = await import('@/lib/registration/editor/utils/buildEditorDocument')

    const existing = await getEditorData(db, OWNER_USER_ID, job.id)
    if (existing) {
      console.log('[editor-doc] 기존 에디터 저장본 존재 — 파괴 방지 가드로 왕복 생략')
      return
    }

    const response = assembleEditorDataResponse(job, null)
    const doc = await buildEditorDocument(job.id, { ...response, is_new: true, sections_data: [] })
    const assignments = { __test__: 'roundtrip' }

    try {
      const { updated_at } = await upsertEditorData(db, OWNER_USER_ID, job.id, {
        sections_data: doc.sections as unknown[],
        layout_assignments: assignments,
      })
      expect(updated_at).toBeTruthy()

      const readBack = await getEditorData(db, OWNER_USER_ID, job.id)
      expect(readBack).toBeTruthy()
      expect(readBack!.layout_assignments).toEqual(assignments)
      const sections = readBack!.sections_data as CanvasSection[]
      expect(sections.length).toBe(doc.sections.length)
      expect(sections.map((s) => s.sectionType)).toEqual(doc.sections.map((s) => s.sectionType))

      // UPSERT 갱신 경로도 검증 (pdp_job_id 충돌 → UPDATE)
      await upsertEditorData(db, OWNER_USER_ID, job.id, {
        sections_data: doc.sections.slice(0, 1) as unknown[],
        layout_assignments: { __test__: 'updated' },
      })
      const afterUpdate = await getEditorData(db, OWNER_USER_ID, job.id)
      expect((afterUpdate!.sections_data as unknown[]).length).toBe(1)
      expect(afterUpdate!.layout_assignments).toEqual({ __test__: 'updated' })
    } finally {
      // 테스트 행 정리 — 이 테스트가 만든 행만(가드로 기존 행 없음이 보장됨)
      await db
        .from('registration_editor_data')
        .delete()
        .eq('user_id', OWNER_USER_ID)
        .eq('pdp_job_id', job.id)
    }
  }, 60_000)
})
