import { describe, expect, it } from 'vitest'
import { applyFeatureOwnershipToStage3, buildFeatureOwnershipBlock } from './pdp-internalized-prompts'
import { buildStage3QualityGatePrompt } from './pdp-copy-pro-prompts'

describe('buildFeatureOwnershipBlock — 특징 배정(R2)', () => {
  it('골격에 있는 섹션의 관점 지시만 싣는다', () => {
    const block = buildFeatureOwnershipBlock(['hook_3step', 'main_cut', 'point_div', 'sub_div', 'petit_div', 'cta'])
    expect(block).toContain('main_cut 요약 카드에는 pointCards 제목만 목차로 실린다')
    expect(block).toContain('- sub_div:')
    expect(block).toContain('colorOptions.description: 선택 기준')
    expect(block).not.toContain('productExposure: 실물')
    expect(block).not.toContain('solution.summary')
    expect(block).toContain('closingCta.headline은 25자 이내 완성 문장이다')
  })

  it('convert_div가 있으면 subtext도 25자 — CTA 제목이 subtext가 된다', () => {
    const block = buildFeatureOwnershipBlock(['main_cut', 'convert_div', 'cta'])
    expect(block).toContain('closingCta.headline과 closingCta.subtext는 각각 25자 이내')
    expect(block).not.toContain('요약 카드에는 pointCards 제목만')
  })

  it('수치·규격은 입력 값만 — 치수를 만들지 않는다', () => {
    expect(buildFeatureOwnershipBlock([])).toContain('없으면 만들지 말고 옵션명(예: S/L)으로만 말한다')
  })

  it('번호 짝 밖 섹션의 되풀이를 막는다(pdp-copy-facts-r4) — 추천 대상은 사람·상황, 핵심 메시지·배너·비교는 카드 제목 반복 금지', () => {
    for (const block of [buildFeatureOwnershipBlock([]), buildFeatureOwnershipBlock(['point_div'], { review: true })]) {
      expect(block).toContain(
        '- recommendedTargets는 사람·상황(누가·언제 쓰는지)으로 쓴다. 특징 이름·옵션 개수·옵션명을 넣지 않는다.'
      )
      expect(block).toContain(
        '- keyMessageVariations·summary·closingCta·soldOutBanner·eventBundleCopy·compareItems는 pointCards 제목 낱말을 그대로 되풀이하지 않는다.'
      )
    }
  })
})

describe('applyFeatureOwnershipToStage3 — Stage 3 검수와 특징 배정의 충돌 해소(R4)', () => {
  const base = buildStage3QualityGatePrompt({ specSheet: '{}', enhancedJson: '{}' })
  const block = buildFeatureOwnershipBlock(['hook_3step', 'main_cut', 'point_div', 'sub_div', 'cta'])

  it('원문 Stage 3에는 키워드 분리 줄과 그 예시가 있다(치환 대상이 그대로인지 고정 — 예시는 지어낸 수치 없이, P0-1)', () => {
    expect(base).toContain('pointCards[].title과 detailPoints[].claim에 동일하거나 유사한 키워드를 사용하지 마세요.')
    expect(base).toContain('얇은 판 구조라 한 손으로 들고 다녀요')
  })

  it('기록 잡: 키워드 분리 줄은 같은 특징·다른 표현으로, 키워드 분리 예시는 빠지고, 말미에 특징 배정이 붙는다', () => {
    const prompt = applyFeatureOwnershipToStage3(base, block)
    expect(prompt).not.toContain('동일하거나 유사한 키워드를 사용하지 마세요')
    expect(prompt).not.toContain('얇은 판 구조라 한 손으로 들고 다녀요')
    expect(prompt).toContain('claim은 카드 제목의 핵심 낱말 1개만 함께 쓰고, 나머지는 근거·사용 장면으로 푼다')
    expect(prompt).toContain('[검수 때도 특징 배정을 지킨다')
    expect(prompt.endsWith(block)).toBe(true)
    // 그 밖의 검수 지시(글자 수·문장 완성도)는 그대로
    expect(prompt).toContain('detailPoints[].claim: 25자 이내')
    expect(prompt).toContain('### 3. 문장 완성도 체크')
    expect(prompt.startsWith(base.slice(0, 200))).toBe(true)
  })
})

describe('Stage 3 배정 블록 잡음·효과 정의(R4 copy-bridge, #155 후속 ②)', () => {
  const base = buildStage3QualityGatePrompt({ specSheet: '{}', enhancedJson: '{}' })

  it('원문 detailPoints 정의는 기록 잡에서 사실형으로 바뀌고 체감 효익은 남는다(J50 — 오너 11-10 효능 문구 부활)', () => {
    expect(base).toContain('(주장 + 기술적 근거 + 체감 효익 + 이미지 장면)')
    const prompt = applyFeatureOwnershipToStage3(base, buildFeatureOwnershipBlock(['point_div'], { review: true }))
    expect(prompt).not.toContain('(주장 + 기술적 근거 + 체감 효익 + 이미지 장면)')
    expect(prompt).toContain('(특징 + 보이는 근거 + 쓰임 장면·체감 효익 + 이미지 장면)')
  })

  it('검수용 배정 블록은 Stage 3에 없는 핵심 메시지 반복을 들먹이지 않고, 근거 예시에 사용 결과가 없다', () => {
    const review = buildFeatureOwnershipBlock(['point_div'], { review: true })
    expect(review).not.toContain('핵심 메시지 3회')
    expect(review).toContain('위 "pointCards와 detailPoints 중복 금지 규칙"보다 이 배정이 우선한다')
    const stage1 = buildFeatureOwnershipBlock(['point_div'])
    expect(stage1).toContain('핵심 메시지 3회 이상 반복')
    for (const block of [review, stage1]) {
      expect(block).not.toContain('사용 결과')
      expect(block).toContain('보이는 근거(소재·구성·사용 장면)')
    }
  })
})
