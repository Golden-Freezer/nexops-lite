import { describe, expect, it } from 'vitest'

import type { PdpSpecSheet } from './pdp-state'
import { buildUsageStepsFactsBlock, usageStepsForCopy, usageStepsWarning } from './usage-steps-facts'

const STEPS = [
  { title: '물을 채운다', description: '최대 선까지' },
  { title: '전원을 켠다' },
]
const spec = (usageSteps: unknown): PdpSpecSheet => ({ productName: '가습기', usageSteps } as unknown as PdpSpecSheet)

describe('usageStepsForCopy — 카피에 넘길 사용 순서(적용 G-U1)', () => {
  it('디자인 컷 잡이고 정리 뒤 2~5단계일 때만 단계를 돌려준다', () => {
    expect(usageStepsForCopy(spec(STEPS), true)).toEqual(STEPS)
    expect(usageStepsForCopy(spec(STEPS), false)).toEqual([])
    expect(usageStepsForCopy(undefined, true)).toEqual([])
    expect(usageStepsForCopy(spec(undefined), true)).toEqual([])
    expect(usageStepsForCopy(spec([STEPS[0]]), true)).toEqual([])
    expect(usageStepsForCopy(spec(Array.from({ length: 6 }, (_, i) => ({ title: `단계 ${i}` }))), true)).toEqual([])
    expect(usageStepsForCopy(spec([...STEPS, { title: '', description: '제목 없음' }]), true)).toEqual([])
  })

  it('한 단계라도 규제 표현이면 통째로 넘기지 않는다 — 입력 칸 읽기(inputSlotsOf)와 같은 거르기', () => {
    expect(usageStepsForCopy(spec([...STEPS, { title: '아토피 치료 효과를 확인한다' }]), true)).toEqual([])
  })
})

describe('buildUsageStepsFactsBlock — 사용 순서 사실 블록', () => {
  it('단계가 없으면 빈 문자열(프롬프트 불변)', () => {
    expect(buildUsageStepsFactsBlock([])).toBe('')
  })

  it('머리에 단계 수, 단계마다 번호·제목·설명(있을 때만), 순서·뜻 규칙 두 줄', () => {
    expect(buildUsageStepsFactsBlock(STEPS)).toBe(
      [
        '## [사용 순서 — 판매자 입력 2단계, howTo는 이 단계 수·순서 그대로 쓴다]',
        '1. 물을 채운다 — 최대 선까지',
        '2. 전원을 켠다',
        '- howTo의 i번째 항목이 위 i번째 단계다. 단계를 더하거나 빼거나 순서를 바꾸지 않는다.',
        '- step·description은 위 글의 뜻만 쓴다. 글자 수 규칙에 맞게 줄이거나 다듬어도 되지만, 위에 없는 동작·효능·수치를 지어내지 않는다.',
      ].join('\n')
    )
  })
})

describe('usageStepsWarning — 최종 howTo 단계 수 확인(고치지 않음)', () => {
  it('입력이 없거나 단계 수가 같으면 없고, 다르면 한 줄', () => {
    expect(usageStepsWarning({ howTo: [] }, [])).toBeNull()
    expect(usageStepsWarning({ howTo: [{}, {}] }, STEPS)).toBeNull()
    expect(usageStepsWarning({ howTo: [{}] }, STEPS)).toBe('[UsageSteps] 입력 사용 순서 2단계인데 최종 howTo 1단계 — 글·컷은 howTo 그대로')
    expect(usageStepsWarning(undefined, STEPS)).toContain('최종 howTo 0단계')
  })
})
