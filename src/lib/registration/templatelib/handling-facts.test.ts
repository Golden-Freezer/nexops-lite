/**
 * 실물 쓰는 법 줄(점검 고침 3) — 판매자 입력·식별 카드의 쓰는 법 문장만, 상한, 없으면 null.
 */

import { describe, expect, it } from 'vitest'
import { gifPromptOf } from '../motion/stage'
import { CORRECT_USE_LINE, HANDLING_FACTS_MAX, handlingFactsOf, handlingLinesOf } from './handling-facts'

describe('handlingFactsOf', () => {
  it('판매자 입력을 먼저, 식별 카드에서 쓰는 법 낱말이 든 문장만 고른다', () => {
    const card = 'A round pink hairbrush with a white logo. The handle is the long flat part at the bottom. Soft nylon bristles cover the oval head.'
    expect(handlingFactsOf('빗살이 있는 면으로 빗는다.', card)).toBe('빗살이 있는 면으로 빗는다. The handle is the long flat part at the bottom.')
    expect(handlingFactsOf(null, card)).toBe('The handle is the long flat part at the bottom. Soft nylon bristles cover the oval head.')
  })

  it('쓰는 법 낱말이 없거나 재료가 없으면 null — 부르는 쪽이 줄을 빼고 기록한다', () => {
    expect(handlingFactsOf(null, 'A small round pink case with a white logo.')).toBeNull()
    expect(handlingFactsOf(undefined, undefined)).toBeNull()
    expect(handlingFactsOf('  ', '')).toBeNull()
  })

  it('같은 문장은 한 번, 최대 2문장·240자(첫 문장이 길면 잘라 하나)', () => {
    const s = 'The handle is the long flat part.'
    expect(handlingFactsOf(s, `${s} The lid opens at the top. The strap goes on the wrist.`)).toBe('The handle is the long flat part. The lid opens at the top.')
    const long = `The handle ${'x'.repeat(400)}.`
    const out = handlingFactsOf(long, null)!
    expect(out.length).toBe(HANDLING_FACTS_MAX.chars)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('handlingLinesOf', () => {
  it('늘 바르게 쓰기 줄, 재료가 있으면 Use 줄 — 없으면 missing', () => {
    expect(handlingLinesOf('The handle is at the bottom.')).toEqual({
      lines: [`Correct use: ${CORRECT_USE_LINE}`, 'Use (from the seller note and the product photos — follow exactly): The handle is at the bottom.'],
      missing: false,
    })
    expect(handlingLinesOf(null)).toEqual({ lines: [`Correct use: ${CORRECT_USE_LINE}`], missing: true })
  })

  it('GIF 지시는 같은 문장을 쓴다(글 그대로)', () => {
    expect(gifPromptOf('B', { action: 'a', loop: 'back_and_forth' })).toContain(`- ${CORRECT_USE_LINE}`)
  })
})
