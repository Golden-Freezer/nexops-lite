/**
 * 첫 화면 글 줄이기(hookshort) — 상한 검사, 상품 종류 낱말 규칙, 11상품에서 규칙을 지킬 수 있는지. LLM 없음.
 */

import { describe, expect, it } from 'vitest'
import { PDP_TEST_PRODUCT_IDS, getPdpTestProduct } from './__fixtures__/pdp-products'
import { HOOK_SHORT, HOOK_SHORT_WRITE_BLOCK, buildHookShortFixBlock, findHookShortIssues } from './copy-hook-short'
import { findCopyRhythmIssues } from './copy-rhythm-check'
import { buildCopyRuleFixBlock, findCopyRuleViolations, productNameTypeWords } from './copy-rule-check'
import type { CopywritingResult } from './pdp-state'

const copy = (mainIntro: Record<string, string>) => ({ mainIntro }) as unknown as CopywritingResult
const HEAD = 'benefitHeadline'
const SUB = 'subBenefit'

describe('findHookShortIssues', () => {
  it('상한 안이면 없다 — 줄당 7자·공백 뺀 12자·보조 한 줄', () => {
    expect(findHookShortIssues(copy({ [HEAD]: '끈만 당기면\n선물 포장 끝', [SUB]: '답례품 20개 한 번에' }))).toEqual([])
  })

  it('큰 제목 — 글자 수·줄 수·한 줄 길이를 따로 알린다', () => {
    const detailOf = (text: string) => findHookShortIssues(copy({ [HEAD]: text })).map((f) => f.detail)
    expect(detailOf('가나다라마바\n사아자차카타파')).toEqual(['공백 뺀 13자(상한 12자)'])
    expect(detailOf('가나다\n라마바\n사아자')).toEqual(['3줄(상한 2줄)'])
    expect(detailOf('가나다라마바사아')).toEqual(['한 줄 8자(상한 7자)'])
  })

  it('줄 첫머리가 조사뿐이면 어색한 줄바꿈이다', () => {
    expect(findHookShortIssues(copy({ [HEAD]: '포장\n을 받아요' })).map((f) => f.detail)).toEqual(['줄 첫머리가 조사·어미이거나 한두 글자만 남았다'])
  })

  it('보조 — 글자 수와 줄 수', () => {
    const detailOf = (text: string) => findHookShortIssues(copy({ [SUB]: text })).map((f) => f.detail)
    expect(detailOf('은은하게 비치는 반투명 소재로 포장')).toEqual(['공백 뺀 15자(상한 12자)'])
    expect(detailOf('가나다\n라마바')).toEqual(['2줄(상한 1줄)'])
  })

  it('칸이 비었거나 mainIntro가 없으면 걸리지 않는다 — hook은 보지 않는다', () => {
    expect(findHookShortIssues({} as CopywritingResult)).toEqual([])
    expect(findHookShortIssues(copy({ hook: '가'.repeat(40) }))).toEqual([])
  })
})

describe('쓰기 지시·고칠 곳', () => {
  it('쓰기 지시에 상한·제목 우선·POINT 카드 넘기기가 있다', () => {
    expect(HOOK_SHORT_WRITE_BLOCK).toContain(`공백 뺀 ${HOOK_SHORT.headlineChars}자`)
    expect(HOOK_SHORT_WRITE_BLOCK).toContain('benefitHeadline에 먼저 넣고')
    expect(HOOK_SHORT_WRITE_BLOCK).toContain('pointCards[].title·description에 옮긴다')
    expect(HOOK_SHORT_WRITE_BLOCK).toContain('\\n으로 끊는다')
  })

  it('고칠 곳은 걸린 칸을 적고, 없으면 빈 문자열이다', () => {
    expect(buildHookShortFixBlock([])).toBe('')
    const block = buildHookShortFixBlock(findHookShortIssues(copy({ [SUB]: '은은하게 비치는 반투명 소재로 포장' })))
    expect(block).toContain('[mainIntro.subBenefit]')
    expect(block).toContain('공백 뺀 15자')
    expect(block).toContain('pointCards[].title·description에 옮긴다')
  })
})

describe('상품 종류 낱말 — 제목이나 보조 중 한 칸(스위치 켠 잡)', () => {
  const NAME = { productName: '페어넥스 데이지 파우치', brandName: '페어넥스' }
  const on = { hookShort: true }

  it('제목이나 보조에 있으면 통과, hook에만 있으면 통과가 아니다', () => {
    expect(findCopyRuleViolations(copy({ [HEAD]: '데이지 파우치', hook: '없음' }), NAME, on).hookType?.present).toBe(true)
    expect(findCopyRuleViolations(copy({ [HEAD]: '포장 끝', [SUB]: '데이지 파우치' }), NAME, on).hookType?.present).toBe(true)
    expect(findCopyRuleViolations(copy({ [HEAD]: '포장 끝', hook: '데이지 파우치' }), NAME, on).hookType?.present).toBe(false)
  })

  it('스위치가 꺼진 잡은 지금 그대로 hook도 첫 화면으로 본다', () => {
    expect(findCopyRuleViolations(copy({ [HEAD]: '포장 끝', hook: '데이지 파우치' }), NAME).hookType?.present).toBe(true)
  })

  it('고칠 곳은 켠 잡에서 두 칸만 말하고 제목을 먼저 적는다', () => {
    const findings = findCopyRuleViolations(copy({ [HEAD]: '포장 끝', hook: '데이지 파우치' }), NAME, on)
    const block = buildCopyRuleFixBlock(findings, on)
    expect(block).toContain('benefitHeadline에 먼저')
    expect(block).not.toContain('hook·benefitHeadline·subBenefit')
    const off = buildCopyRuleFixBlock(findCopyRuleViolations(copy({ [HEAD]: '포장 끝' }), NAME))
    expect(off).toContain('첫 화면(hook·benefitHeadline·subBenefit)')
  })
})

describe('리듬 검사와 겹치지 않게', () => {
  const LONG = '가나다라마바사아자차카타파하가나다'

  it('켠 잡은 첫 화면 세 칸을 리듬 검사에서 빼고, 다른 제목은 16자 그대로다', () => {
    const c = { mainIntro: { hook: LONG, benefitHeadline: LONG, subBenefit: LONG }, directionHint: { headline: LONG } } as unknown as CopywritingResult
    const on = findCopyRhythmIssues(c, { hookShort: true })
    expect(on.headLong.map((f) => f.path)).toEqual(['directionHint.headline'])
    const off = findCopyRhythmIssues(c)
    expect(off.headLong.map((f) => f.path)).toEqual(['mainIntro.hook', 'mainIntro.benefitHeadline', 'directionHint.headline'])
  })
})

describe('11상품 — 규칙을 지킬 수 있는가', () => {
  it.each(PDP_TEST_PRODUCT_IDS)('%s: 한 줄 7자 안에 드는 상품 종류 낱말이 있고, 그 낱말을 제목에 쓰면 두 검사를 모두 통과한다', (id) => {
    const { specSheet } = getPdpTestProduct(id)
    const words = productNameTypeWords(specSheet)
    const word = words.find((w) => [...w].length <= HOOK_SHORT.headlineLineChars)
    expect(word, `${id} 상품명 낱말: ${words.join(', ')}`).toBeDefined()
    const c = copy({ [HEAD]: word! })
    expect(findHookShortIssues(c)).toEqual([])
    expect(findCopyRuleViolations(c, specSheet, { hookShort: true }).hookType?.present).toBe(true)
  })
})
