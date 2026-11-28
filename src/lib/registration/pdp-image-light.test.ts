import { describe, expect, it } from 'vitest'
import {
  buildDesignPromptEngineeringPrompt,
  CHARTER_LIGHT_EXAMPLE_SWAPS,
  LIGHT_FROM_CHARTER_SCOPE,
} from '@/lib/agents/registration/prompts/pdp-design-prompts'
import {
  buildImagePrompts,
  buildStyleCharter,
  getPhotographyBase,
  getPhotographyContext,
  PHOTOGRAPHY_PRESETS,
  PRODUCT_CONSISTENCY_RULES,
} from '@/lib/agents/registration/prompts/pdp-image-prompts'
import { tidyImageBrief } from './pdp-image-brief'
import { canonLight, LIGHT_PHRASE_SWAPS, LIGHT_RULE } from './pdp-image-light'

const CHARTER = buildStyleCharter({
  bgHex: '#fff7f0',
  colorTemp: 'Warm-neutral 5000K',
  direction: 'top-left',
  shadowAngle: 45,
  propColors: '#c2410c, #f4b8a0',
  mood: 'cozy · warm',
  setDesc: 'one continuous studio set shared by every cut of this page',
})
/** 헌장 밖에 남으면 안 되는 광원·방향·색온도 표현 */
const LIGHT_WORDS = /softbox|golden hour|window light|tungsten|rim light|ring light|top-left|side\/below|\b\d{4}K\b|color temperature/i
const count = (text: string, part: string) => text.split(part).length - 1
/** 헌장(머리 줄 ~ 규칙 줄)을 뺀 본문 */
function outsideCharter(text: string): string {
  const start = text.indexOf('GLOBAL STYLE CHARTER')
  const end = text.indexOf(LIGHT_RULE)
  return text.slice(0, start) + text.slice(end + LIGHT_RULE.length)
}
const CATEGORIES = ['food', 'beauty', 'digital', 'fashion', 'household', 'packaging', 'stationery', 'pet']
const HERO_MODES = ['studio', 'lifestyle', 'premium', 'original'] as const
/** 카테고리 하나의 컷 템플릿 — 히어로 모드 4종을 모두 펼친다(premium 히어로에만 있는 빛 줄이 있다) */
const cuts = (category: string) =>
  HERO_MODES.flatMap((heroImageMode) =>
    Object.entries(
      buildImagePrompts({
        productName: '고양이 식기 2구',
        designPalette: { bgMain: '#fff7f0' },
        problemQuestion: '밥그릇이 자꾸 밀려요',
        solutionDeclaration: '미끄럼 방지 받침',
        category,
        heroImageMode,
      })
    ).map(([section, entry]) => [`${heroImageMode}:${section}`, entry] as const)
  )
const assemble = (positive: string) => [positive, getPhotographyBase(false), CHARTER].join('\n\n')

describe('canonLight — 빛·색온도는 헌장 한 곳만', () => {
  for (const category of CATEGORIES) {
    it(`${category}: 컷 템플릿·사진 기본·카테고리 조명의 광원·색온도가 헌장 밖에서 사라지고, 헌장 값은 그대로`, () => {
      for (const [section, entry] of cuts(category)) {
        const { prompt, changed } = canonLight(assemble(entry.prompt))
        expect(changed, section).toBe(true)
        expect(outsideCharter(prompt), section).not.toMatch(LIGHT_WORDS)
        expect(prompt, section).not.toContain('Category lighting')
        expect(prompt).toContain('- Single color temperature for every cut: Warm-neutral 5000K')
        expect(prompt).toContain('- Single key light direction: top-left')
        expect(count(prompt, LIGHT_RULE), section).toBe(1)
      }
    })
  }

  it('바꾸는 문구가 지금 템플릿·프리셋·사진 기본에 실제로 있다(원문이 바뀌면 이 시험이 먼저 깨진다)', () => {
    const sources = [
      ...CATEGORIES.flatMap((c) => cuts(c).map(([, e]) => e.prompt)),
      ...Object.keys(PHOTOGRAPHY_PRESETS).map(getPhotographyContext),
      getPhotographyBase(false),
    ].join('\n')
    for (const [from] of LIGHT_PHRASE_SWAPS) expect(sources, from).toContain(from)
    expect(sources).toMatch(/Category lighting: .*\d{4}K/)
  })

  it('연출 프리셋 6종 — 광원 이름 대신 대비·밝기만 남는다', () => {
    for (const key of Object.keys(PHOTOGRAPHY_PRESETS)) {
      const { prompt } = canonLight([getPhotographyContext(key), CHARTER].join('\n\n'))
      expect(outsideCharter(prompt), key).not.toMatch(/softbox|ring light|window light|golden hour/i)
      expect(outsideCharter(prompt), key).toContain('Photography setup:')
    }
  })

  it('설계 LLM이 예시에서 옮긴 빛 문구·남은 K 값·골든아워를 바꾼다(헌장 안 값은 둔다)', () => {
    const scene = 'Premium aspirational product display of X. Golden hour warm soft lighting. Warm 3200-4000K glow on a table at golden hour.'
    const { prompt } = canonLight([scene, CHARTER].join('\n\n'))
    expect(prompt).toContain('Soft inviting light.')
    expect(outsideCharter(prompt)).not.toMatch(/golden hour|\d{4}K/i)
    expect(prompt).toContain('Warm-neutral 5000K')
  })

  it('헌장이 없으면 그대로 — 기댈 정본이 없다', () => {
    const plain = [cuts('pet')[0][1].prompt, getPhotographyBase(false)].join('\n\n')
    expect(canonLight(plain)).toEqual({ prompt: plain, changed: false })
  })

  it('두 번 돌려도 같고, 브리프 정리와 어느 순서로 겹쳐도 규칙 줄은 한 번', () => {
    const assembled = assemble(cuts('pet')[1][1].prompt)
    const once = canonLight(assembled).prompt
    expect(canonLight(once)).toEqual({ prompt: once, changed: false })
    const tidy = (p: string) => tidyImageBrief(p, { sizeHonored: true }).prompt
    // 브리프의 '헌장 우선' 한 줄은 헌장을 가리키는 말이라 빼고 본다
    const withoutPointer = (p: string) => outsideCharter(p).replace(/^Where any other line of this brief.*$/m, '')
    for (const p of [tidy(once), canonLight(tidy(assembled)).prompt]) {
      expect(count(p, LIGHT_RULE)).toBe(1)
      expect(withoutPointer(p)).not.toMatch(LIGHT_WORDS)
    }
  })
})

describe('설계 프롬프트 — light 기록 잡만 예시 빛 문구를 바꾸고 헌장 우선 블록을 붙인다', () => {
  const input = {
    productName: '고양이 식기 2구',
    category: 'pet',
    targetPersona: '고양이 보호자',
    primaryColor: '#c2410c',
    secondaryColor: '#f4b8a0',
    bgColor: '#fff7f0',
    problemQuestion: '밥그릇이 밀려요',
    solutionDeclaration: '미끄럼 방지',
    detailPoints: '받침',
    howTo: '올려 둔다',
    comparisonObject: '손',
  }

  it('꺼진 잡은 원문 그대로, 켜진 잡은 예시 5곳이 바뀌고 블록이 붙는다', () => {
    const plain = buildDesignPromptEngineeringPrompt(input, PRODUCT_CONSISTENCY_RULES)
    const light = buildDesignPromptEngineeringPrompt(input, PRODUCT_CONSISTENCY_RULES, { lightFromCharter: true })
    for (const [from, to] of CHARTER_LIGHT_EXAMPLE_SWAPS) {
      expect(plain, from).toContain(from)
      expect(light, from).not.toContain(from)
      expect(light, from).toContain(to)
    }
    expect(plain).not.toContain('## 빛·색온도')
    expect(light).toContain(LIGHT_FROM_CHARTER_SCOPE.trim())
    expect(buildDesignPromptEngineeringPrompt(input, PRODUCT_CONSISTENCY_RULES, { textBearing: true })).not.toContain('## 빛·색온도')
  })
})
