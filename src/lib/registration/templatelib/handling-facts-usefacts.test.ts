/**
 * usefacts 잡의 쓰는 법 재료(결정 카드 c02·하네스 J18) — 재료는 식별 카드 USE 줄·사용 순서 입력(없으면 카피 howTo)뿐이다.
 * 기본 경로(handlingFactsOf)는 카드 머리말 240자를 고른다(K8 55/55·실제 카드 10/11) — 켠 경로는 카드 글을 받지 않는다.
 */

import { describe, expect, it } from 'vitest'
import {
  CORRECT_USE_LINE,
  handlingFactsOf,
  USAGE_STEPS_MAX_CHARS,
  USAGE_STEPS_PREFIX,
  USE_CARD_LINE_PREFIX,
  USE_LINE_PREFIX,
  handlingLinesOfUseFacts,
  usageStepsLineOf,
} from './handling-facts'

// 운영 카드 모양(K 라인 시험 잡 저장본 P02 — 머리말 + 쉼표로 이어진 한 문장)
const REAL_CARD =
  "PRODUCT IDENTITY (read from the user's reference photo — the generated product must match every detail below): Single-compartment drawstring pouch, closed, gathered top with two yellow braided cords threaded through casing, knotted at lower sides, translucent frosted plastic, rectangular flat bottom, white daisy print with yellow centers scattered across front in varying sizes, some faded, no handles, no zipper."
const CORRECT = `Correct use: ${CORRECT_USE_LINE}`

describe('usageStepsLineOf — 사용 순서 한 줄', () => {
  it('판매자 사용 순서 입력이 있으면 그것만 — 카피 howTo는 보지 않는다', () => {
    const steps = [{ title: '끈을 당겨 연다' }, { title: '물건을 넣는다', description: '바닥이 평평해 세워 둔다' }]
    expect(usageStepsLineOf(steps, [{ step: '다른 글' }])).toBe('1. 끈을 당겨 연다; 2. 물건을 넣는다 — 바닥이 평평해 세워 둔다')
  })

  it('입력이 없으면 카피 howTo(step·description), 빈 단계는 건너뛴다', () => {
    expect(usageStepsLineOf(undefined, [{ step: '젖은 머리를 나눈다' }, {}, { step: '빗살 면으로 빗는다', description: '두피에서 끝으로' }])).toBe(
      '1. 젖은 머리를 나눈다; 2. 빗살 면으로 빗는다 — 두피에서 끝으로'
    )
    expect(usageStepsLineOf([], [{ step: '연다' }])).toBe('1. 연다')
  })

  it('둘 다 없으면 null', () => {
    expect(usageStepsLineOf(undefined, undefined)).toBeNull()
    expect(usageStepsLineOf([], [])).toBeNull()
    expect(usageStepsLineOf(null, [{ step: ' ', description: '' }])).toBeNull()
  })

  it(`${USAGE_STEPS_MAX_CHARS}자를 넘는 단계부터 '…' — 첫 단계가 넘으면 잘라 하나`, () => {
    const long = Array.from({ length: 5 }, (_, i) => ({ title: `${i + 1}단계 ${'가'.repeat(80)}` }))
    const line = usageStepsLineOf(long, null)!
    expect(line.length).toBeLessThanOrEqual(USAGE_STEPS_MAX_CHARS + 3)
    expect(line.endsWith('; …')).toBe(true)
    const one = usageStepsLineOf([{ title: '가'.repeat(400) }], null)!
    expect(one).toHaveLength(USAGE_STEPS_MAX_CHARS)
    expect(one.endsWith('…')).toBe(true)
  })
})

describe('handlingLinesOfUseFacts — usefacts 잡의 쓰는 법 블록', () => {
  it('늘 바르게 쓰기 줄 + USE 줄(사진 판독) + 사용 순서 줄(그리지 않는 참고 글)', () => {
    expect(handlingLinesOfUseFacts('grip the wooden handle, bristles face the scalp', [{ title: '빗는다' }], null)).toEqual({
      lines: [CORRECT, `${USE_CARD_LINE_PREFIX}grip the wooden handle, bristles face the scalp`, `${USAGE_STEPS_PREFIX}1. 빗는다`],
      missing: false,
    })
    expect(USAGE_STEPS_PREFIX).toContain('never drawn as text')
  })

  it('재료가 하나뿐이면 그 줄만, 둘 다 없으면 missing(부르는 쪽이 useFacts none을 남긴다)', () => {
    expect(handlingLinesOfUseFacts('hold the strap', undefined, undefined)).toEqual({ lines: [CORRECT, `${USE_CARD_LINE_PREFIX}hold the strap`], missing: false })
    expect(handlingLinesOfUseFacts(undefined, undefined, [{ step: '붙인다' }])).toEqual({ lines: [CORRECT, `${USAGE_STEPS_PREFIX}1. 붙인다`], missing: false })
    expect(handlingLinesOfUseFacts('  ', [], [])).toEqual({ lines: [CORRECT], missing: true })
  })

  it('실제 카드 모양: 기본 경로는 카드 머리말 240자를 Use 재료로 고르지만, 켠 경로는 카드 글을 받지 않아 머리말이 들어가지 않는다', () => {
    const before = handlingFactsOf(undefined, REAL_CARD)
    expect(before?.startsWith('PRODUCT IDENTITY (')).toBe(true)
    const after = handlingLinesOfUseFacts(undefined, undefined, undefined)
    expect(after).toEqual({ lines: [CORRECT], missing: true })
    expect(after.lines.join('\n')).not.toContain('PRODUCT IDENTITY')
  })

  it('켠 경로 Use 줄 머리는 기본 경로(판매자 메모·사진)와 다르다 — MS 맞추기의 카드 겹침 빼기(USE_LINE_PREFIX)에 걸리지 않는다', () => {
    expect(USE_CARD_LINE_PREFIX).not.toBe(USE_LINE_PREFIX)
    expect(handlingLinesOfUseFacts('hold it', null, null).lines.some((line) => line.startsWith(USE_LINE_PREFIX))).toBe(false)
  })
})
