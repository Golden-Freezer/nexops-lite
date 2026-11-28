/** MS 지시 맞추기 ③ 앞 세 단계(J46) — 겹친 블록 빼기·인쇄 규칙 짧은 한 블록·학부모 장면 짧은 판, 그리고 fitMsPrompt 차례 */

import { describe, expect, it } from 'vitest'
import { buildPrintedDesignsRule, PRINTED_DESIGN_PRESERVE_INSTRUCTION, PRINTED_MARKS_RULE } from '@/lib/agents/registration/prompts/pdp-image-prompts'
import { fitMsPrompt, MS_PRE_LAST_RESORT_STEPS } from './ms-prompt-fit'
import { PARENT_PREP_MS, printedRuleMs, withoutContainedBlocks, withParentPrepMs, withPrintedRuleMs } from './ms-prompt-shorten'
import { buildParentProxyImageBlock, PARENT_PREP_IMAGE_BLOCK } from './parent-proxy-copy'

const pad = (head: string, n: number) => `${head} ${'x'.repeat(Math.max(0, n - head.length - 1))}`
const join = (...blocks: string[]) => blocks.join('\n\n')
const IDENTITY = 'PRODUCT IDENTITY (read from the photos): flat printed favor bag with a daisy print.'
const OPTION = 'OPTION DESIGN RULE: show only the daisy design exactly as in the reference photo.'
const DESIGNS = buildPrintedDesignsRule(1)

describe('A 겹친 블록 빼기(dup)', () => {
  it('다른 블록 안에 통째로 든 블록을 빼고 긴 쪽을 남긴다 — 같은 글 둘이면 앞의 것', () => {
    const withOption = `${PRINTED_DESIGN_PRESERVE_INSTRUCTION}\n${OPTION}`
    expect(withoutContainedBlocks(['SCENE', PRINTED_DESIGN_PRESERVE_INSTRUCTION, withOption, IDENTITY])).toEqual(['SCENE', withOption, IDENTITY])
    expect(withoutContainedBlocks(['SCENE', 'RULE A', IDENTITY, 'RULE A'])).toEqual(['SCENE', 'RULE A', IDENTITY])
  })

  it('첫 블록은 다른 블록에 들어 있어도 빼지 않고, 일부만 겹치는 블록은 남긴다', () => {
    expect(withoutContainedBlocks(['SCENE', 'SCENE plus more'])).toEqual(['SCENE', 'SCENE plus more'])
    expect(withoutContainedBlocks(['SCENE', 'alpha beta', 'beta gamma'])).toEqual(['SCENE', 'alpha beta', 'beta gamma'])
  })
})

describe('B 인쇄 규칙 짧은 한 블록(printed)', () => {
  it('두 고정 문구가 둘 다 있을 때만 — 옵션 디자인 줄·식별 카드·PRINTED MARKS는 바이트 그대로', () => {
    const blocks = ['SCENE', `${PRINTED_DESIGN_PRESERVE_INSTRUCTION}\n${OPTION}`, IDENTITY, PRINTED_MARKS_RULE, DESIGNS]
    const out = withPrintedRuleMs(blocks)!
    expect(out).toEqual(['SCENE', `${printedRuleMs(1)}\n${OPTION}`, IDENTITY, PRINTED_MARKS_RULE])
    expect(out.join('\n\n').length).toBeLessThan(blocks.join('\n\n').length)
    expect(withPrintedRuleMs(['SCENE', PRINTED_DESIGN_PRESERVE_INSTRUCTION, IDENTITY])).toBeNull()
    expect(withPrintedRuleMs(['SCENE', IDENTITY, DESIGNS])).toBeNull()
  })

  it('도안 고정 문구가 다른 줄과 한 블록이면 그 글만 빼고, 사진 수는 원래 문구의 값을 따른다', () => {
    const designs3 = buildPrintedDesignsRule(3)
    const out = withPrintedRuleMs(['SCENE', PRINTED_DESIGN_PRESERVE_INSTRUCTION, `${IDENTITY}\n${designs3}`])!
    expect(out).toEqual(['SCENE', printedRuleMs(3), IDENTITY])
    expect(printedRuleMs(3)).toContain('the first 3 attached images')
  })

  it('짧은 블록은 두 문구의 뜻 문장을 모두 지닌다', () => {
    const short = printedRuleMs(1)
    for (const sentence of [
      'exactly as in the product reference photo (the first attached image)', // 사진 그대로
      'Korean stays Korean', // 한글은 한글로
      'Never erase, translate, re-letter, invent or blend designs', // 지우거나 번역·다시 쓰거나 지어내거나 섞지 않음
      'with several items, repeat only those designs', // 여러 개면 그 도안만 반복
      'A style reference attached after them is not a source of designs', // 스타일 참조는 도안 출처 아님
      'Add no text anywhere else', // 다른 곳 글자 없음
      'Keep it FLAT printed material', // 납작한 인쇄물
    ]) {
      expect(short, sentence).toContain(sentence)
    }
    expect(short.length).toBeLessThan(PRINTED_DESIGN_PRESERVE_INSTRUCTION.length + DESIGNS.length)
  })
})

describe('C 학부모 장면 짧은 판(parent)', () => {
  it('학부모 장면 블록만 바꾸고 아이를 어디에도 그리지 않는 문장을 지닌다', () => {
    expect(buildParentProxyImageBlock({} as never)).toBe(PARENT_PREP_IMAGE_BLOCK)
    expect(withParentPrepMs(['SCENE', IDENTITY, PARENT_PREP_IMAGE_BLOCK])).toEqual(['SCENE', IDENTITY, PARENT_PREP_MS])
    expect(withParentPrepMs(['SCENE', IDENTITY])).toBeNull()
    expect(PARENT_PREP_MS).toContain('Never depict children, kids, babies or minors anywhere in the image')
    expect(PARENT_PREP_MS.length).toBeLessThan(PARENT_PREP_IMAGE_BLOCK.length)
  })
})

describe('fitMsPrompt — ③ 앞 세 단계 차례(dup → printed → parent), 들어가면 멈춘다', () => {
  const shot = (n: number) => pad('[Shot direction]', n)
  const printed = (shotLength: number) =>
    join(
      pad('SCENE', 1000),
      PRINTED_DESIGN_PRESERVE_INSTRUCTION,
      `${PRINTED_DESIGN_PRESERVE_INSTRUCTION}\n${OPTION}`,
      IDENTITY,
      DESIGNS,
      PARENT_PREP_IMAGE_BLOCK,
      shot(shotLength),
      pad('Art direction:', 600)
    )

  it('차례 표는 size-dup(AX-CT-32, 잃는 뜻 없음) → dup → printed → parent', () => {
    expect(MS_PRE_LAST_RESORT_STEPS.map(([name]) => name)).toEqual(['size-dup', 'dup', 'printed', 'parent'])
  })

  it('겹침만 빼서 들어가면 printed·parent는 하지 않는다', () => {
    const fit = fitMsPrompt(printed(1500))
    expect(fit.fits).toBe(true)
    expect(fit.compacted).toEqual(['dup'])
    expect(fit.prompt).toContain(PRINTED_DESIGN_PRESERVE_INSTRUCTION)
    expect(fit.prompt).toContain(PARENT_PREP_IMAGE_BLOCK)
  })

  it('겹침을 빼도 넘으면 인쇄 규칙을, 그래도 넘으면 학부모 장면을 줄인다 — 옵션 줄·감독 줄·K 컷 지시는 그대로', () => {
    const fit = fitMsPrompt(printed(2200))
    expect(fit.fits).toBe(true)
    expect(fit.compacted).toEqual(['dup', 'printed'])
    expect(fit.prompt).toContain(`${printedRuleMs(1)}\n${OPTION}`)
    expect(fit.prompt).toContain(shot(2200))
    const tighter = fitMsPrompt(printed(2400))
    expect(tighter.compacted).toEqual(['dup', 'printed', 'parent'])
    expect(tighter.prompt).toContain(PARENT_PREP_MS)
    expect(tighter.prompt).toContain(pad('Art direction:', 600))
  })

  it('세 단계 뒤에도 넘으면 fits false — 몰래 자르지 않는다', () => {
    const fit = fitMsPrompt(printed(4200))
    expect(fit.fits).toBe(false)
    expect(fit.compacted).toEqual(['dup', 'printed', 'parent'])
    expect(fit.prompt).toContain(shot(4200))
  })

  it('상한 안이면 겹침이 있어도 원문 그대로', () => {
    const p = join('SCENE', PRINTED_DESIGN_PRESERVE_INSTRUCTION, PRINTED_DESIGN_PRESERVE_INSTRUCTION, IDENTITY)
    expect(fitMsPrompt(p)).toEqual({ prompt: p, originalLength: p.length, dropped: [], compacted: [], fits: true })
  })
})
