/**
 * L2 오프라인 재생(docs/plans/pdp-enrichment/01_TEST_PLAN.md §3 L2) — 기준 상품 A·B·C의 저장된 analysis·research·spec을
 * 설득 플래너에 넣고, 계획 골격과 "픽스처 카피로 편집기 변환기를 돌린 렌더 후 섹션 목록" 모두에서 측정한다.
 *   S1: 골격 쌍별 정규화 편집거리 ≥ 0.3(계획·렌더 둘 다) · R1~R8 통과(계획·렌더) · 계획했는데 렌더되지 않는 유령 섹션 0
 * 무료·결정론(LLM·DB 없음). 수치는 RUN-LOG L2 절에 옮긴다.
 *
 * S1 부분 충족(2026-10-27 통합 세션 승인): B(스티커)·C(구디백)는 입력이 거의 같다 — 둘 다 G4(감성·선물·quick),
 * 근거 없음(리뷰·치수·인증·이벤트), 같은 household v2 사전값, 가치 군집 3개. 근거가 없어 고민 응답이 같은 usp 컷으로 모이고
 * 남는 차이는 C의 사용 서술 → hidden_page 하나다(0.10, 기존 Track I는 0.00). 지표를 맞추려 설계 규칙을 바꾸지 않는다.
 * B·C는 "동일하지 않음(> 0)"만 단언하고, 다양성은 실 테스트 상품(T5, P01~P10)에서 다시 잰다.
 */

import { describe, expect, it } from 'vitest'
import { ProSectionType as S } from '@/lib/registration/editor/types/section'
import { getCorpusSnapshotV2 } from '../corpus-v2'
import { getDesignVocab } from '../design-vocab'
import { assembleEditorDataResponse } from '../editor-data'
import { buildEditorDocument } from '../editor/utils/buildEditorDocument'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture, type FixtureKey } from '../__golden__/golden-harness'
import { checkPersuasionRules } from './persuasion-rules'
import { planPersuasionSkeleton, type PersuasionPlan } from './persuasion-planner'

const KEYS: FixtureKey[] = ['A-track-i', 'B-track-i', 'C-track-i']
/** [쌍, 최소 거리] — B·C는 입력 동일성으로 비동일(> 0)만 요구(위 머리 주석) */
const PAIRS = [
  ['A-track-i', 'B-track-i', 0.3],
  ['A-track-i', 'C-track-i', 0.3],
  ['B-track-i', 'C-track-i', 0],
] as const

function expectDistance(distance: number, min: number, label: string) {
  if (min > 0) expect(distance, label).toBeGreaterThanOrEqual(min)
  else expect(distance, label).toBeGreaterThan(0)
}

/** 레벤시테인 거리 ÷ 긴 쪽 길이. */
export function normalizedEditDistance(a: readonly string[], b: readonly string[]): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return d[a.length][b.length] / Math.max(a.length, b.length, 1)
}

function planFor(key: FixtureKey): PersuasionPlan {
  const f = loadEnrichmentFixture(key)
  const job = fixtureToJob(f)
  return planPersuasionSkeleton({
    specSheet: job.spec_sheet,
    analysis: job.analysis,
    strategyContract: mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, []),
    research: job.research_result,
    category: job.analysis.detected_category,
    snapshotV2: getCorpusSnapshotV2(job.analysis.detected_category),
    vocab: getDesignVocab()!,
  })
}

/** 계획 골격을 저장 카피·이미지와 함께 편집기 문서로 변환한 뒤 섹션 타입 목록(렌더 후)을 얻는다. */
async function renderedSections(key: FixtureKey, plan: PersuasionPlan): Promise<string[]> {
  const job = fixtureToJob(loadEnrichmentFixture(key))
  job.section_plan = { ...job.section_plan, activated_sections: plan.activatedSections.map(String), section_order: plan.sectionOrder.map(String) }
  const response = assembleEditorDataResponse(job, null)
  const doc = await buildEditorDocument(job.id, { ...response, is_new: true, sections_data: [] })
  return doc.sections.map((s) => String(s.sectionType)).filter((t) => t !== S.DIVIDER)
}

describe('L2 오프라인 재생 — 설득 플래너(A·B·C)', () => {
  const plans = Object.fromEntries(KEYS.map((k) => [k, planFor(k)])) as Record<FixtureKey, PersuasionPlan>

  it('계획 골격: R1~R8 전부 통과', () => {
    for (const key of KEYS) {
      const failed = plans[key].persuasion.rules.filter((r) => !r.pass)
      expect(failed, `${key}: ${JSON.stringify(failed)}`).toEqual([])
    }
  })

  it('계획 골격: A·B·A·C 편집거리 ≥ 0.3, B·C는 비동일', () => {
    for (const [a, b, min] of PAIRS) {
      expectDistance(normalizedEditDistance(plans[a].sectionOrder, plans[b].sectionOrder), min, `${a} vs ${b}`)
    }
  })

  it('렌더 후 섹션 목록: 유령 섹션 0, R1~R8 통과, A·B·A·C 편집거리 ≥ 0.3·B·C 비동일', async () => {
    const rendered: Record<string, string[]> = {}
    for (const key of KEYS) {
      const plan = plans[key]
      rendered[key] = await renderedSections(key, plan)
      const ghosts = plan.sectionOrder.filter((s) => !rendered[key].includes(s))
      expect(ghosts, `${key} 계획했지만 렌더되지 않음`).toEqual([])
      // 골격 밖 상품 정보 표(오너 지시 11-01, CTA 앞)는 측정(page-measure)처럼 규칙 판정에서 뺀다
      const ruleOrder = rendered[key].filter((s) => s !== S.SPEC_TABLE || plan.sectionOrder.includes(S.SPEC_TABLE))
      const rules = checkPersuasionRules(ruleOrder, {
        grammar: plan.persuasion.grammar,
        lengthTarget: plan.persuasion.lengthTarget,
        isSupported: (s) => plan.sectionOrder.includes(s as S),
        objectionCoverage: plan.persuasion.objectionCoverage,
      })
      expect(rules.filter((r) => !r.pass), `${key} 렌더 규칙`).toEqual([])
    }
    for (const [a, b, min] of PAIRS) {
      expectDistance(normalizedEditDistance(rendered[a], rendered[b]), min, `${a} vs ${b}(렌더)`)
    }
  })

  it('정정 매핑이 렌더 의미와 맞다 — hidden_page = 사용 방법, point_list_div = 추천 대상(A 골격의 렌더 결과)', async () => {
    const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
    const plan = plans['A-track-i']
    job.section_plan = { ...job.section_plan, activated_sections: plan.activatedSections.map(String), section_order: plan.sectionOrder.map(String) }
    const doc = await buildEditorDocument(job.id, { ...assembleEditorDataResponse(job, null), is_new: true, sections_data: [] })
    const textOf = (type: string) => JSON.stringify(doc.sections.find((s) => String(s.sectionType) === type) ?? null)
    expect(plan.persuasion.objectionCoverage.map((o) => o.answeredBy)).toEqual([S.HIDDEN_PAGE, S.POINT_LIST_DIV, null])
    expect(textOf(S.HIDDEN_PAGE)).toContain('사용 방법')
    expect(textOf(S.POINT_LIST_DIV)).toContain('이런 분께 추천드려요')
  })

  it('기준선 대비: 기존 Track I 골격(B·C 동일)과 달리 상품마다 다르다', () => {
    const legacyB = loadEnrichmentFixture('B-track-i').section_plan.section_order as string[]
    const legacyC = loadEnrichmentFixture('C-track-i').section_plan.section_order as string[]
    expect(normalizedEditDistance(legacyB, legacyC)).toBe(0)
  })
})
