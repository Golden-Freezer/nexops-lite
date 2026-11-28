/**
 * 프롬프트 슬롯 채우기 — 값 안의 `$&`·`$$`·`` $` ``·`$'`를 치환 패턴으로 해석하지 않고 글자 그대로 넣는다(R4 pdp-r4-copy-bridge,
 * #155 후속 ③). 상품명·카피 JSON·리뷰에 `$`가 들어와도 프롬프트가 바뀌지 않아야 한다. 순수 함수, 외부 호출 0.
 */

import { describe, expect, it } from 'vitest'
import { buildStage2StorytellingPrompt, buildStage3QualityGatePrompt } from './pdp-copy-pro-prompts'
import { buildPremiumCopywritingPrompt, buildReviewsAnalysisPrompt } from './pdp-copy-prompts'
import { buildDesignPromptEngineeringPrompt } from './pdp-design-prompts'
import { buildProImagePrompt } from './pdp-image-pro-prompts'
import { buildDataAnalysisPrompt } from './pdp-analysis-prompts'
import { buildResearchPlanningPrompt } from './pdp-research-prompts'

const DOLLARS = "가격 $$ 표기 $& 원문 $` 앞 $' 뒤"

describe('슬롯 채우기 — $ 패턴을 글자 그대로', () => {
  it('Stage 3·Stage 2(카피 JSON·상품명)', () => {
    expect(buildStage3QualityGatePrompt({ specSheet: '{}', enhancedJson: DOLLARS })).toContain(DOLLARS)
    const stage2 = buildStage2StorytellingPrompt({
      productName: DOLLARS,
      category: 'c',
      essenceType: 'e',
      draftJson: '{}',
    })
    expect(stage2).toContain(DOLLARS)
  })

  it('리뷰 분석·데이터 분석·리서치(리뷰·상품 정보)', () => {
    expect(buildReviewsAnalysisPrompt(DOLLARS)).toContain(DOLLARS)
    expect(buildDataAnalysisPrompt({ specSheet: DOLLARS, reviewsSummary: DOLLARS, category: 'c' })).toContain(DOLLARS)
    const research = buildResearchPlanningPrompt({
      targetPersona: 'p',
      analysisResult: DOLLARS,
      reviewsText: DOLLARS,
      brandVoiceGuide: 'v',
      strategyContract: '{}',
    })
    expect(research).toContain(DOLLARS)
  })
})

describe('슬롯 채우기 — 카피 본문·이미지 설계·Pro 이미지', () => {
  it('Stage 1/Premium 카피 본문 슬롯', () => {
    const prompt = buildPremiumCopywritingPrompt({
      planningSkeleton: DOLLARS,
      brandVoiceGuide: DOLLARS,
      painPoints: DOLLARS,
      reviewInsights: '{}',
      uspMapping: '{}',
      analysisResult: DOLLARS,
      specSheet: DOLLARS,
      essenceType: 'e',
      reviewsAnalysis: '',
      brandColorInstruction: '',
    })
    expect(prompt.split(DOLLARS).length).toBeGreaterThan(4)
  })

  it('이미지 프롬프트 설계(같은 슬롯이 여러 번 나오는 템플릿)·Pro 이미지', () => {
    const design = buildDesignPromptEngineeringPrompt(
      {
        productName: DOLLARS,
        category: 'c',
        targetPersona: 'p',
        primaryColor: '#111111',
        secondaryColor: '#222222',
        bgColor: '#ffffff',
        problemQuestion: DOLLARS,
        solutionDeclaration: DOLLARS,
        detailPoints: DOLLARS,
        howTo: DOLLARS,
        comparisonObject: 'o',
      },
      DOLLARS
    )
    expect(design).toContain(DOLLARS)
    expect(design).not.toContain('{product_name}')
    expect(buildProImagePrompt('product_exposure', { productName: DOLLARS, keyBenefit: DOLLARS })).toContain(DOLLARS)
  })
})
