import { describe, expect, it } from 'vitest'
import {
  IP_PROTECTION_RULES,
  KOREAN_CONTEXT_GUARD,
  NO_TEXT_INSTRUCTION,
  NO_TEXT_PHRASES,
  PRINTED_DESIGN_PRESERVE_INSTRUCTION,
  PRODUCT_CONSISTENCY_RULES,
  buildStyleCharter,
  getPhotographyBase,
} from '@/lib/agents/registration/prompts/pdp-image-prompts'
import { buildImageGroundingBlock } from './corpus'
import { buildInternalizedImageBlock, buildPooledInternalizedImageBlock } from './corpus-v2'
import { BRIEF_NOTES_CLOSE, BRIEF_NOTES_OPEN, TEXT_RULE_HEAD, tidyImageBrief } from './pdp-image-brief'

const tidy = (prompt: string, sizeHonored = true) => tidyImageBrief(prompt, { sizeHonored })
const count = (text: string, part: string) => text.split(part).length - 1

const CHARTER = buildStyleCharter({
  bgHex: '#fff7f0',
  colorTemp: 'Warm-neutral 5000K',
  direction: 'top-left',
  shadowAngle: 45,
  propColors: '#c2410c, #f4b8a0',
  mood: 'cozy · warm',
  setDesc: 'one continuous studio set shared by every cut of this page',
})
const SPECIFIC_RULES = [
  'PRODUCT CONSISTENCY RULES (ABSOLUTE):',
  '1. SHAPE: If reference is an oval tray with two round bowls, generated must match the same shape',
  '3. LOGO/LABEL: Preserve structural design elements, BUT omit any printed brand name or generic word text on the product surface (keep it blank/unbranded)',
  '6. COMPONENT COUNT & MECHANISM: Keep exactly TWO bowls joined by one tray base as in the reference.',
  'VERIFICATION CHECKLIST BEFORE OUTPUT:',
  '- [ ] Does it have exactly TWO bowl compartments with no invented components?',
  'If ANY checklist fails → REGENERATE',
].join('\n')
const IDENTITY = 'PRODUCT IDENTITY (read from the user\'s reference photo — the generated product must match every detail below): Elevated feeder, 4 wooden peg legs.'
const SHOT = '[Shot direction — how_to_guide]\nPro-page defaults: where the cut instructions above set angle, follow them.'

/** 실제 조립 순서를 흉내 낸 일반 상품 컷 — 상품별 규칙 + 일반 규칙 + 글자 금지 + 사진 지시 + 식별 카드 + 헌장 + 코퍼스 + 연출 */
function plainCut(): string {
  return [
    'Premium studio product photography of a dual-bowl pet feeder set into one connected tray base.\nAspect Ratio: 3:4',
    SPECIFIC_RULES,
    PRODUCT_CONSISTENCY_RULES,
    NO_TEXT_INSTRUCTION,
    getPhotographyBase(false),
    IDENTITY,
    CHARTER,
    buildPooledInternalizedImageBlock(),
    SHOT,
  ].join('\n\n')
}

describe('tidyImageBrief — 중복·충돌 정리(E4)', () => {
  it('재생성 체크리스트를 모두 빼고, 상품별 일관성 규칙이 있으면 일반 규칙 블록을 뺀다', () => {
    const { prompt, steps } = tidy(plainCut())
    expect(prompt).not.toContain('VERIFICATION CHECKLIST')
    expect(prompt).not.toContain('REGENERATE')
    expect(count(prompt, 'PRODUCT CONSISTENCY RULES (ABSOLUTE):')).toBe(1)
    expect(prompt).toContain('Keep exactly TWO bowls joined by one tray base')
    expect(prompt).not.toContain('If reference is rectangular, generated must be rectangular')
    expect(steps).toEqual(expect.arrayContaining(['checklist', 'generic-consistency']))
  })

  it('일반 규칙만 있으면 그대로 두고 체크리스트만 뺀다', () => {
    const { prompt, steps } = tidy(['Hero shot of a mug.', PRODUCT_CONSISTENCY_RULES, NO_TEXT_INSTRUCTION].join('\n\n'))
    expect(prompt).toContain('If reference is rectangular, generated must be rectangular')
    expect(prompt).not.toContain('VERIFICATION CHECKLIST')
    expect(steps).not.toContain('generic-consistency')
  })

  it('크기를 지키는 생성기면 비율 줄(목록형 포함)을 빼고, Gemini면 남긴다', () => {
    const prompt = `Hero shot.\nAspect Ratio: 3:4\n- Aspect Ratio: 1:1\n\n${NO_TEXT_INSTRUCTION}`
    expect(tidy(prompt).prompt).not.toContain('Aspect Ratio')
    expect(count(tidy(prompt, false).prompt, 'Aspect Ratio')).toBe(2)
  })

  it('모바일 글자 크기·역할별 글자 px 블록을 빼고, 시장 자료 머리말은 뒤에 남는 블록이 있을 때만 둔다', () => {
    const withShot = tidy([`Hero shot.\n\n${NO_TEXT_INSTRUCTION}`, buildPooledInternalizedImageBlock(), SHOT].join('\n\n')).prompt
    expect(withShot).not.toContain('[모바일 판독 기준]')
    expect(withShot).toContain('아래는 시장 관행 참고 자료다.')
    const alone = tidy([`Hero shot.\n\n${NO_TEXT_INSTRUCTION}`, buildPooledInternalizedImageBlock()].join('\n\n')).prompt
    expect(alone).not.toContain('아래는 시장 관행 참고 자료다.')
    // v1·v2 코퍼스 블록의 역할별 글자 px 레시피도 같다(원천 문구가 바뀌면 이 시험이 잡는다)
    for (const block of [buildImageGroundingBlock('household'), buildInternalizedImageBlock('household')!]) {
      const out = tidy(`Hero shot.\n\n${NO_TEXT_INSTRUCTION}\n\n${block}`).prompt
      expect(out).not.toMatch(/헤드라인 \d+px/)
      expect(out).not.toContain('[모바일 판독 기준]')
    }
  })

  it('스타일 헌장이 있으면 일반 조명·색온도 줄을 빼고 헌장 우선 한 줄을 더한다 — 헌장이 없으면 그대로', () => {
    const { prompt } = tidy(plainCut())
    expect(prompt).not.toContain('large softbox at 45-degree angle')
    expect(prompt).not.toContain('5500K daylight balanced')
    expect(count(prompt, 'follow this charter.')).toBe(1)
    const noCharter = tidy(`${getPhotographyBase(false)}\n\n${NO_TEXT_INSTRUCTION}`).prompt
    expect(noCharter).toContain('large softbox at 45-degree angle')
  })

  it('식별 카드가 있으면 장면 묘사와 다를 때 식별 카드를 따르라고 한 번만 적는다', () => {
    const { prompt } = tidy(plainCut())
    expect(count(prompt, 'follow this identity and the first reference photo.')).toBe(1)
    expect(prompt).toMatch(/4 wooden peg legs\. Where the scene description differs/)
  })

  it('같은 블록·같은 문단이 여러 번이면 처음 것만 남긴다', () => {
    const prompt = ['Hero shot.', IP_PROTECTION_RULES, 'Same line.', IP_PROTECTION_RULES, 'Same line.', NO_TEXT_INSTRUCTION].join('\n\n')
    const out = tidy(prompt).prompt
    expect(count(out, IP_PROTECTION_RULES)).toBe(1)
    expect(count(out, 'Same line.')).toBe(1)
  })
})

describe('tidyImageBrief — 지시 격리(P1-5)', () => {
  it('일반 상품: 글자 금지 문장을 끝의 TEXT RULE 한 곳으로 모으고 나머지를 지시 블록으로 감싼다', () => {
    const { prompt, steps } = tidy(`${plainCut()}\n\n${NO_TEXT_PHRASES[0]}`)
    expect(prompt.startsWith(BRIEF_NOTES_OPEN)).toBe(true)
    expect(prompt.endsWith(`${TEXT_RULE_HEAD}\n${NO_TEXT_INSTRUCTION}`)).toBe(true)
    expect(count(prompt, NO_TEXT_INSTRUCTION)).toBe(1)
    expect(prompt).not.toContain(NO_TEXT_PHRASES[0])
    expect(prompt.indexOf(BRIEF_NOTES_CLOSE)).toBeLessThan(prompt.indexOf(TEXT_RULE_HEAD))
    // 글자를 허용하는 일반 줄과 장면 연출의 내부 섹션 이름은 빠진다
    expect(prompt).not.toContain('Text on products must be legible')
    expect(prompt).not.toContain('Any text that appears must be generic Korean')
    expect(prompt).toContain('[Shot direction]\n')
    expect(prompt).not.toContain('how_to_guide')
    expect(steps.at(-1)).toBe('isolate')
  })

  it('인쇄 디자인 상품: 보존 지시가 TEXT RULE로 한 번만 가고, 인쇄 글자를 지우라는 LOGO/LABEL 규칙은 보존 쪽으로 바뀐다', () => {
    const prompt = [
      `USAGE SCENARIO IMAGE:\nScenario (description for you, never to be drawn as text): 포장 준비\n${KOREAN_CONTEXT_GUARD}`,
      getPhotographyBase(true),
      PRINTED_DESIGN_PRESERVE_INSTRUCTION,
      PRODUCT_CONSISTENCY_RULES,
      CHARTER,
    ].join('\n\n')
    const { prompt: out, steps } = tidy(prompt)
    expect(count(out, PRINTED_DESIGN_PRESERVE_INSTRUCTION)).toBe(1)
    expect(out.endsWith(`${TEXT_RULE_HEAD}\n${PRINTED_DESIGN_PRESERVE_INSTRUCTION}`)).toBe(true)
    expect(out).not.toContain('omit any printed brand name')
    expect(out).toContain('3. LOGO/LABEL: Keep the printed artwork and lettering exactly as in the reference (see TEXT RULE).')
    expect(out).not.toContain(NO_TEXT_INSTRUCTION)
    // 맥락 줄 주의문('어떤 글자도 그리지 말라')은 인쇄 보존과 부딪혀 격리 머리말로 대신한다
    expect(out).not.toContain('NOTE ON THE CONTEXT LINE ABOVE')
    expect(steps).toEqual(expect.arrayContaining(['printed-logo', 'duplicate', 'isolate']))
  })

  it('글자 규칙이 없는 프롬프트는 감싸지 않는다', () => {
    const { prompt, steps } = tidy(`Hero shot.\nAspect Ratio: 1:1\n\n${CHARTER}`)
    expect(prompt.startsWith('Hero shot.')).toBe(true)
    expect(prompt).not.toContain(BRIEF_NOTES_OPEN)
    expect(steps).not.toContain('isolate')
  })

  it('두 번 돌려도 그대로다(정리된 브리프는 손대지 않는다)', () => {
    const once = tidy(plainCut()).prompt
    expect(tidy(once)).toEqual({ prompt: once, steps: [] })
  })

  it('정리 결과가 원래보다 짧다 — 실제 조립 순서 기준', () => {
    const before = plainCut()
    expect(tidy(before).prompt.length).toBeLessThan(before.length * 0.85)
  })
})
