/**
 * 코퍼스 그라운딩 on/off A/B — 설계문서 §10 검증 항목("주입이 오히려 품질 저하 가능" 리스크 대응).
 * 이미지 단계 없이 분석→리서치→디자인(콜1)→카피만 두 번 실행(그라운딩 on/off)해 산출을 나란히
 * 파일로 남긴다(오너 육안 판정 자료 — 모바일 뷰 기준). 실 API 비용이 발생하므로 기본 skip.
 *   NEXOPS_E2E=1 NEXOPS_E2E_PAID=1 NEXOPS_E2E_TARGET=pdp-grounding-ab npx vitest run src/lib/registration/pdp-grounding-ab.integration.test.ts
 *
 * H4(2026-10-26 하네스 점검): 이 A/B 하네스는 현재 파이프라인(트랙 분기·연령 블록 등)과 불일치가 있어
 * pdp-enrichment 실 테스트 대상에서 제외한다. 수리는 별도 작업.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PdpSpecSheet } from './pdp-state'
import { loadE2EEnv, shouldRunPaid } from './__e2e__/e2e-env'

const RUN = shouldRunPaid('pdp-grounding-ab')
const OUT_DIR = resolve(__dirname, '../../../docs/plans/registration-tab/ab-grounding')

// household — 코퍼스 스냅샷이 실존하는 카테고리(그라운딩 실주입 경로)
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
    '꽃가루 색이 화려해서 사진이 예쁘게 나와요. 다만 뒷정리가 조금 번거로웠어요.',
}

describe.skipIf(!RUN)('그라운딩 on/off A/B (real APIs, 이미지 제외)', () => {
  beforeAll(() => {
    const env = loadE2EEnv()
    console.log(`[AB] env 적재: ${env.source} (${env.loadedKeys}개 키)`)
  })

  it('동일 spec으로 두 번 생성해 산출 비교 파일을 남긴다', { timeout: 900_000 }, async () => {
    const { runPdpAnalysis } = await import('@/lib/agents/registration/pdp-analysis-agent')
    const { runPdpResearch } = await import('@/lib/agents/registration/pdp-research-agent')
    const { planPdpSections } = await import('@/lib/agents/registration/pdp-design-agent')
    const { runPdpCopywriting } = await import('@/lib/agents/registration/pdp-copy-agent')
    const { buildDesignGroundingBlock, buildCopyGroundingBlock } = await import('./corpus')

    // 공통 선행 단계(분석·리서치)는 1회만 실행해 양쪽에 동일 입력을 공급 — 차이는 그라운딩 유무만
    const analysis = await runPdpAnalysis({ specSheet: SPEC_SHEET, reviewsSummary: SPEC_SHEET.reviewsText ?? '' })
    expect(analysis.success, analysis.success ? '' : String(analysis.error)).toBe(true)
    if (!analysis.success) return
    const research = await runPdpResearch({
      specSheet: SPEC_SHEET,
      analysis: analysis.data.analysis,
      strategyContract: analysis.data.strategyContract,
    })
    expect(research.success).toBe(true)
    if (!research.success) return

    const category = 'household'
    const variants: Array<{ label: string; designGrounding?: string; copyGrounding?: string }> = [
      {
        label: 'grounded',
        designGrounding: buildDesignGroundingBlock(category),
        copyGrounding: buildCopyGroundingBlock(category),
      },
      { label: 'ungrounded' },
    ]

    mkdirSync(OUT_DIR, { recursive: true })
    for (const v of variants) {
      const plan = await planPdpSections({
        specSheet: SPEC_SHEET,
        analysis: analysis.data.analysis,
        research: research.data.research,
        strategyContract: analysis.data.strategyContract,
        groundingBlock: v.designGrounding,
      })
      const copy = await runPdpCopywriting({
        specSheet: SPEC_SHEET,
        mode: 'pro',
        analysis: analysis.data.analysis,
        research: research.data.research,
        sectionPlan: plan.sectionPlan,
        strategyContract: analysis.data.strategyContract,
        groundingBlock: v.copyGrounding,
      })
      expect(copy.success).toBe(true)
      const out = {
        variant: v.label,
        section_order: plan.sectionPlan.section_order,
        activated_sections: plan.sectionPlan.activated_sections,
        copy: copy.success ? copy.data.final : null,
        warnings: copy.success ? copy.data.warnings : null,
      }
      const file = resolve(OUT_DIR, `${v.label}.json`)
      writeFileSync(file, JSON.stringify(out, null, 2), 'utf8')
      console.log(`[A/B] ${v.label}: sections=${plan.sectionPlan.activated_sections?.length} → ${file}`)
    }
  })
})
