/**
 * 프리셋 적용 가능 행렬(preset-safety.json) 생성·고정 — docs/plans/pdp-enrichment/00_DESIGN.md §4.3.
 * 기준 잡 픽스처 6건 + 합성 전체 카피 픽스처 1건을 편집기 빌더 섹션으로 변환하고, 섹션마다 프리셋 10종에
 * applyLayoutPresetIfSafe(콘텐츠 유실 가드)를 실제로 적용해 통과 여부를 잰다. 측정된 모든 인스턴스에서 통과한 조합만 safe.
 * 측정되지 않은 조합은 행렬에 없다(배정 후보에서 빠진다). 행렬은 콘텐츠 의존적이라 보장 범위는 이 측정 범위다.
 * mobileSafe(설계 §4.3-7·§4.8): 가드를 통과한 적용 결과가 섹션 단위 모바일 위반(M1·M2·M4·M5·M6)을 하나라도 늘린 인스턴스가 없는 조합.
 *
 *   재생성: NEXOPS_WRITE_PRESET_SAFETY=1 npx vitest run src/lib/registration/editor/data/layouts/preset-safety.test.ts
 * 그 밖의 실행은 커밋된 JSON과 다르면 실패한다(변환기·프리셋이 바뀌면 다시 생성해 검토한다).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { assembleEditorDataResponse } from '../../../editor-data'
import {
  fixtureToJob,
  GOLDEN_NOW,
  loadEnrichmentFixture,
  syntheticFullCopyJob,
  type FixtureKey,
} from '../../../__golden__/golden-harness'
import type { PdpJobRow } from '../../../pdp-state'
import { ProSectionType } from '../../types/section'
import { applyLayoutPresetIfSafe } from '../../utils/applyLayoutPreset'
import { worsensSectionMobile } from '../../utils/applyMobileFloor'
import { buildEditorDocument, PRESET_EXEMPT_SECTIONS } from '../../utils/buildEditorDocument'
import { loadLayoutPresets } from './index'

const OUT = resolve(__dirname, 'preset-safety.json')
const FIXTURES: FixtureKey[] = ['A-track-s', 'B-track-s', 'C-track-s', 'A-track-i', 'B-track-i', 'C-track-i']

interface Cell {
  measured: number
  passed: number
  safe: boolean
  /** 가드 통과 인스턴스 중 섹션 단위 모바일 위반을 늘린 수 */
  mobileWorse: number
  mobileSafe: boolean
}

async function builderSections(job: PdpJobRow) {
  const response = assembleEditorDataResponse(
    { ...job, section_plan: { ...job.section_plan, layout_selections: {} } },
    null
  )
  const doc = await buildEditorDocument(job.id, { ...response, is_new: true, sections_data: [] })
  return { sections: doc.sections, palette: doc.sourceData.designPalette }
}

async function measure(): Promise<Record<string, Record<string, Cell>>> {
  const matrix: Record<string, Record<string, Cell>> = {}
  const jobs = [...FIXTURES.map((k) => fixtureToJob(loadEnrichmentFixture(k))), syntheticFullCopyJob()]
  for (const job of jobs) {
    const { sections, palette } = await builderSections(job)
    for (const section of sections) {
      const type = String(section.sectionType)
      if (PRESET_EXEMPT_SECTIONS.has(type) || type === ProSectionType.DIVIDER) continue
      for (const preset of await loadLayoutPresets(section.sectionType)) {
        if (preset.category === 'minimal') continue // _layout_01 = 적용 안 함과 같다
        const cell = ((matrix[type] ??= {})[preset.category] ??= {
          measured: 0,
          passed: 0,
          safe: false,
          mobileWorse: 0,
          mobileSafe: false,
        })
        cell.measured++
        const applied = applyLayoutPresetIfSafe(section, preset, palette)
        if (!applied) continue
        cell.passed++
        if (worsensSectionMobile(section, applied)) cell.mobileWorse++
      }
    }
  }
  for (const row of Object.values(matrix)) {
    for (const cell of Object.values(row)) {
      cell.safe = cell.measured > 0 && cell.passed === cell.measured
      cell.mobileSafe = cell.safe && cell.mobileWorse === 0
    }
  }
  return Object.fromEntries(
    Object.keys(matrix)
      .sort()
      .map((type) => [
        type,
        Object.fromEntries(
          Object.keys(matrix[type])
            .sort()
            .map((c) => [c, matrix[type][c]])
        ),
      ])
  )
}

describe('프리셋 적용 가능 행렬', () => {
  it('측정 결과가 커밋된 preset-safety.json과 같다', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(GOLDEN_NOW)
    const matrix = await measure()
    const document = {
      schemaVersion: 1,
      source: [...FIXTURES, 'synthetic-full-copy'],
      rule: 'applyLayoutPresetIfSafe 통과 — 측정된 모든 인스턴스에서 통과한 조합만 safe, minimal·PRESET_EXEMPT 제외. mobileSafe = safe이고 섹션 단위 M1·M2·M4·M5·M6 증가 0',
      matrix,
    }
    if (process.env.NEXOPS_WRITE_PRESET_SAFETY === '1')
      writeFileSync(OUT, `${JSON.stringify(document, null, 1)}\n`, 'utf8')
    expect(JSON.parse(readFileSync(OUT, 'utf8'))).toEqual(document)
    vi.restoreAllMocks()
  })
})
