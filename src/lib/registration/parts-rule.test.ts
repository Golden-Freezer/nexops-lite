import { describe, expect, it } from 'vitest'
import { PARTS_RULE_BLOCK, withPartsRule } from './parts-rule'

describe('withPartsRule', () => {
  it('프롬프트 뒤에 블록을 붙이고 앞 내용은 그대로다', () => {
    expect(withPartsRule('base')).toBe(`base\n\n${PARTS_RULE_BLOCK}`)
  })

  it('규칙 세 가지 — 더하지 않기, 손에 든 부품은 같은 부품, 식별 카드 위치는 멈춘 상태', () => {
    expect(PARTS_RULE_BLOCK).toContain('Never add a second cord')
    expect(PARTS_RULE_BLOCK).toContain('SAME part')
    expect(PARTS_RULE_BLOCK).toContain('at rest')
  })

  it('한 그림 한 상태·작은 부품(오너 메모 11-06 P05) — 두 상태를 섞지 않고 덮개·두 번째 손잡이를 더하지 않으며 걸쇠는 작게', () => {
    expect(PARTS_RULE_BLOCK).toContain('picture exactly one state — never both at once')
    expect(PARTS_RULE_BLOCK).toContain('never a separate cover, case or second handle')
    expect(PARTS_RULE_BLOCK).toContain('Small latches, pins and tips stay as small and as few')
    // 옛 세 줄 뒤에 붙는다 — 앞 규칙 순서는 그대로
    const lines = PARTS_RULE_BLOCK.split('\n')
    expect(lines).toHaveLength(6)
    expect(lines[3]).toContain('at rest')
  })
})
