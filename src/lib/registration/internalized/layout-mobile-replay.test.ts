/**
 * L2 오프라인 재생 — T3(E-2 레이아웃 배정 + mobile 하한)·T3m(mobile 전 섹션)의 모바일 판독
 * (docs/plans/pdp-enrichment/02_TASK_CONTRACTS.md T3 S6 단계 기준, T3m 절대 기준).
 * 기준 상품 A·B·C(Track I)의 저장 카피·이미지로 편집기 문서를 만들어 checkMobileReadability를 적용한다.
 *   off = 픽스처 그대로(기록 없음, 기존 Track I) / on = T3 기본값 기록 잡(설득 플래너 골격 + E-2 배정 + mobile)
 *   ⓪ T3m: on 렌더 M1~M7 위반 0 ① on 위반 ≤ off 위반(M1~M7 규칙별) ② T3가 배정한 프리셋이 만든 위반 0
 *   ③ 배정은 행렬 mobileSafe·인접 중복 0 ④ mobile은 기록 잡에만 — T2 기록 잡(mobile 없음)은 기존 빌더 그대로
 *   ⑤ 내보내기 HTML(exportHtml)은 편집기 문서와 같은 글자 크기를 쓴다(하한 일치)
 * 무료·결정론(LLM·DB 없음). 수치는 RUN-LOG L2 절에 옮긴다.
 */

import { describe, expect, it } from 'vitest'
import presetSafety from '@/lib/registration/editor/data/layouts/preset-safety.json'
import { ProSectionType as S } from '@/lib/registration/editor/types/section'
import { assembleEditorDataResponse } from '../editor-data'
import { exportHtml } from '../editor/utils/exportUtils/htmlBuilders'
import { buildEditorDocument } from '../editor/utils/buildEditorDocument'
import { checkMobileReadability, mobileFontFloor, type MobileRuleId } from '../editor/utils/mobileReadability'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import type { PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import {
  fixtureToJob,
  loadEnrichmentFixture,
  syntheticFullCopyJob,
  type FixtureKey,
} from '../__golden__/golden-harness'
import { checkLayoutAdjacency } from './persuasion-rules'

const KEYS: FixtureKey[] = ['A-track-i', 'B-track-i', 'C-track-i']
const RULES: MobileRuleId[] = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7']
const T3_FEATURES = ['vocab', 'persuasion', 'layouts', 'shots', 'mobile']
const MATRIX = presetSafety.matrix as Record<string, Record<string, { mobileSafe: boolean }>>

/** 분석이 features를 기록한 잡으로 설계 단계(골격 + E-2)를 다시 돌린다 — LLM 산출은 픽스처 section_plan 그대로. */
function designedJob(key: FixtureKey, features: string[]): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture(key))
  job.analysis = { ...job.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  return job
}

async function render(job: PdpJobRow) {
  return buildEditorDocument(job.id, { ...assembleEditorDataResponse(job, null), is_new: true, sections_data: [] })
}

const counts = async (job: PdpJobRow) => checkMobileReadability(await render(job)).counts
/** 규칙·섹션별 위반 수 — 문서 합계가 같아도 다른 섹션에 새 위반이 생기면 잡는다 */
async function tally(job: PdpJobRow): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const v of checkMobileReadability(await render(job)).violations)
    out[`${v.rule}:${v.section}`] = (out[`${v.rule}:${v.section}`] ?? 0) + 1
  return out
}

describe('L2 오프라인 재생 — T3 레이아웃·모바일(A·B·C Track I)', () => {
  for (const key of KEYS) {
    it(`${key}: T3m — on 렌더 M1~M7 위반 0`, async () => {
      const report = checkMobileReadability(await render(designedJob(key, T3_FEATURES)))
      expect(report.violations, JSON.stringify(report.violations.slice(0, 5))).toEqual([])
    })

    it(`${key}: 내보내기 HTML은 편집기 문서와 같은 글자 크기(하한 일치)`, async () => {
      const doc = await render(designedJob(key, T3_FEATURES))
      const html = exportHtml(doc.sections, doc.sourceData.designPalette)
      const texts = doc.sections
        .filter((s) => s.isVisible)
        .flatMap((s) => s.elements.filter((e) => e.isVisible && e.type === 'text'))
      for (const el of texts) {
        expect(el.textProps!.fontSize, el.name).toBeGreaterThanOrEqual(mobileFontFloor(el))
        expect(html, el.name).toContain(`font-size:${el.textProps!.fontSize}px`)
      }
    })

    it(`${key}: on 위반 ≤ off 위반(M1~M7 규칙별)`, async () => {
      const off = await counts(fixtureToJob(loadEnrichmentFixture(key)))
      const on = await counts(designedJob(key, T3_FEATURES))
      for (const rule of RULES)
        expect(on[rule], `${key} ${rule} on ${on[rule]} > off ${off[rule]}`).toBeLessThanOrEqual(off[rule])
    })

    it(`${key}: T3 배정 프리셋이 만든 위반 0 · 배정은 행렬 mobileSafe · 인접 중복 0`, async () => {
      const job = designedJob(key, T3_FEATURES)
      const selections = job.section_plan.layout_selections ?? {}
      for (const [section, category] of Object.entries(selections)) {
        if (category !== 'minimal') expect(MATRIX[section]?.[category]?.mobileSafe, `${section}:${category}`).toBe(true)
      }
      expect(checkLayoutAdjacency(job.section_plan.section_order ?? [], selections)).toEqual({ id: 'R7', pass: true })
      expect(job.section_plan.internalized_skeleton?.persuasion?.rules.every((r) => r.pass)).toBe(true)

      const withPresets = await tally(job)
      const minimal = Object.fromEntries(Object.keys(selections).map((s) => [s, 'minimal']))
      const withoutPresets = await tally({ ...job, section_plan: { ...job.section_plan, layout_selections: minimal } })
      for (const [cell, n] of Object.entries(withPresets))
        expect(n, `${key} ${cell}`).toBeLessThanOrEqual(withoutPresets[cell] ?? 0)
    })
  }

  for (const key of ['A-track-s', 'B-track-s', 'C-track-s'] as FixtureKey[]) {
    it(`${key}: T3m — Track S(오너 결정 확장) 렌더 M1~M7 위반 0`, async () => {
      const report = checkMobileReadability(await render(fixtureToJob(loadEnrichmentFixture(key))))
      expect(report.violations, JSON.stringify(report.violations.slice(0, 5))).toEqual([])
    })
  }

  it('T3m — 합성 전체 카피(모든 섹션 타입): Track S·mobile 기록 Track I는 M1~M7 위반 0, 무기록 Track I는 기존 그대로', async () => {
    const trackS = syntheticFullCopyJob()
    const trackI = { ...trackS, generation_track: 'internalized' as const }
    const recorded = {
      ...trackI,
      section_plan: {
        ...trackI.section_plan,
        enrichment: { version: 1 as const, features: ['mobile'], vocabHash: null },
      },
    }
    for (const job of [trackS, recorded]) {
      const report = checkMobileReadability(await render(job))
      expect(report.violations, `${job.generation_track} ${JSON.stringify(report.violations.slice(0, 5))}`).toEqual([])
    }
    expect(checkMobileReadability(await render(trackI)).violations.length).toBeGreaterThan(0)
  })

  it('mobile 변형은 기록 잡에만 — hidden_page·point_list_div 한 열·하한 준수, T2 기록 잡은 기존 빌더', async () => {
    const floorSections = new Set<string>([S.HIDDEN_PAGE, S.POINT_LIST_DIV])
    const onDoc = await render(designedJob('C-track-i', T3_FEATURES))
    const t2Doc = await render(designedJob('C-track-i', ['vocab', 'persuasion']))
    const present = onDoc.sections.filter((s) => floorSections.has(String(s.sectionType)))
    expect(present.map((s) => String(s.sectionType)).sort()).toEqual([S.HIDDEN_PAGE, S.POINT_LIST_DIV])

    const onViolations = checkMobileReadability(onDoc).violations.filter((v) => floorSections.has(v.section))
    expect(onViolations.filter((v) => ['M1', 'M2', 'M6'].includes(v.rule))).toEqual([])
    expect(present.flatMap((s) => s.elements).some((e) => e.name.startsWith('list_check_'))).toBe(false)

    const t2Elements = t2Doc.sections.filter((s) => floorSections.has(String(s.sectionType))).flatMap((s) => s.elements)
    expect(t2Elements.some((e) => e.name.startsWith('list_check_'))).toBe(true)
  })
})
