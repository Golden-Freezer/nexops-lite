/**
 * D 라인 카피 규칙 — 첫 화면 질문 재기와 쓰기 지시. 효과는 V2 전까지 못 잰다.
 */

import { describe, expect, it } from 'vitest'
import { DESIGN_COPY_WRITE_BLOCK, DESIGN_HOOK_MODE_BLOCKS, firstScreenQuestions } from './copy-design-rules'
import { regulatedClaimTermsIn } from './eval/claim-lexicon'
import type { CopywritingResult } from './pdp-state'

const intro = (mainIntro: Record<string, string>) => ({ mainIntro }) as CopywritingResult

describe('firstScreenQuestions', () => {
  it.each([
    ['아직도 손으로 닦으시나요', ['hook']],
    ['매번 번거로우셨나요?', ['hook']],
    ['어떤 걸 고를까', ['hook']],
    ['왜 이걸까요', ['hook']],
  ])('%s → 질문', (hook, fields) => {
    expect(firstScreenQuestions(intro({ hook }))).toEqual(fields)
  })

  it.each(['손이 편해요', '가벼운 하루의 시작', '30초면 끝', '그렇죠'])('%s → 질문 아님', (hook) => {
    expect(firstScreenQuestions(intro({ hook }))).toEqual([])
  })

  it('제목·보조도 보고, 첫 화면 밖 칸은 보지 않는다', () => {
    expect(firstScreenQuestions(intro({ hook: '장면', benefitHeadline: '될까요?', subBenefit: '어떤가요?', category: '무엇일까요?' }))).toEqual(['benefitHeadline', 'subBenefit'])
    expect(firstScreenQuestions(null)).toEqual([])
    expect(firstScreenQuestions({} as CopywritingResult)).toEqual([])
  })
})

describe('쓰기 지시', () => {
  it('D2 첫 화면이 그리는 hook을 가리킨다 — 저장 잡의 질문형이 이 칸에 있었다', () => {
    expect(DESIGN_COPY_WRITE_BLOCK).toContain('mainIntro.hook과 mainIntro.benefitHeadline은')
  })

  it('고민 시작은 막지 않고 허용 조건을 준다', () => {
    expect(DESIGN_COPY_WRITE_BLOCK).toContain('고민 질문은 그 고민이 곧 구매 이유일 때만')
    for (const block of Object.values(DESIGN_HOOK_MODE_BLOCKS).slice(0, 2)) expect(block).toContain('고민 질문은 그 고민이 곧 구매 이유일 때만')
  })

  it('지시 글 자체에 규제 표현이 없다', () => {
    expect(regulatedClaimTermsIn(DESIGN_COPY_WRITE_BLOCK)).toEqual([])
    for (const block of Object.values(DESIGN_HOOK_MODE_BLOCKS)) expect(regulatedClaimTermsIn(block)).toEqual([])
  })
})
