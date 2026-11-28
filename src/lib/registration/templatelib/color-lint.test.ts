/**
 * K9 색 경고(상세페이지 조사 L10 적용 후보 7) — 유채 색상 계열 수와 장식 겹침. 경고만 하고 막지 않는다. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { lchToHex } from '@/lib/registration/internalized/designcut-palette'
import { colorSetsOf } from './color-sets'
import { DECORATIONS, decorationsOfTemplate, designColorsOf, hueFamiliesOf, lintKPageColors, lintPageColors } from './color-lint'
import { CONCEPTS } from './concepts'
import { TEMPLATES } from './library'

const at = (h: number, l = 55, c = 40) => lchToHex({ l, c, h })

describe('유채 색상 계열', () => {
  it('같은 색상각의 명도 단계는 한 계열이다', () => {
    expect(hueFamiliesOf([at(25, 35), at(25, 55), at(25, 75, 25)])).toHaveLength(1)
  })

  it('채도 20 아래(연한 면·짙은 갈색 글자·회색·흰색)는 세지 않는다', () => {
    const quiet = [lchToHex({ l: 93, c: 9, h: 240 }), lchToHex({ l: 20, c: 12, h: 60 }), '#F4F4F4', '#FFFFFF', '#111111']
    expect(hueFamiliesOf(quiet)).toEqual([])
  })

  it('0°를 넘나드는 색상각도 30° 안이면 한 계열이다', () => {
    expect(hueFamiliesOf([at(355), at(12)])).toHaveLength(1)
  })

  it('30° 폭을 넘으면 사슬로 잇지 않는다 — 0·25·50°는 두 계열', () => {
    expect(hueFamiliesOf([at(0), at(25), at(50)])).toHaveLength(2)
  })

  it('세 색상각이 떨어지면 세 계열이고, 순서·중복·잘못된 값과 무관하다', () => {
    const colors = [at(25), at(145), at(255)]
    const families = hueFamiliesOf(colors)
    expect(families).toHaveLength(3)
    expect(hueFamiliesOf([...colors].reverse().concat([colors[0].toLowerCase(), '없음']))).toEqual(families)
  })
})

describe('페이지 경고', () => {
  it('유채 2계열은 경고 없음, 3계열이면 hue-families 경고', () => {
    expect(lintPageColors({ colors: [at(25), at(250)] })).toEqual([])
    const [warning] = lintPageColors({ colors: [at(25), at(145), at(250)] })
    expect(warning.rule).toBe('hue-families')
    expect(warning.families).toHaveLength(3)
  })

  it('장식은 한 종이 여러 번이면 괜찮고, 두 종 이상이면 decoration-stack 경고', () => {
    expect(lintPageColors({ colors: [], decorations: ['speech-bubble', 'speech-bubble'] })).toEqual([])
    const [warning] = lintPageColors({ colors: [], decorations: ['laurel', 'gradient-text', 'laurel'] })
    expect(warning.rule).toBe('decoration-stack')
    expect(warning.decorations).toEqual(['gradient-text', 'laurel'])
    expect(DECORATIONS).toEqual(['gradient-text', 'speech-bubble', 'laurel', 'caption-italic'])
  })
})

describe('K 페이지', () => {
  const allSets = CONCEPTS.flatMap((c) => colorSetsOf(c).sets)

  it('디자인 색은 본문·제목 글자를 빼고, 형광 띠 조합은 강조 글자(잉크)도 뺀다', () => {
    const set = allSets.find((s) => !s.colors.highlight)!
    expect(designColorsOf(set.colors)).not.toContain(set.colors.ink)
    expect(designColorsOf(set.colors)).toContain(set.colors.accentText)
    const marked = allSets.find((s) => s.colors.highlight)!
    expect(designColorsOf(marked.colors)).toContain(marked.colors.accent)
    expect(designColorsOf(marked.colors)).toHaveLength(designColorsOf(set.colors).length - 1)
  })

  it('지금 색 조합 하나로 된 K 페이지는 유채 계열이 2개 이하라 경고가 없다', () => {
    expect(allSets.length).toBeGreaterThan(1000)
    for (const s of allSets) expect(hueFamiliesOf(designColorsOf(s.colors)).length, s.id).toBeLessThanOrEqual(2)
  })

  it('말풍선은 꼬리 단 bubble 판이 있는 템플릿 8개에서만 찾는다(K7-c 고민 말풍선 3 칸 더함)', () => {
    const speech = TEMPLATES.filter((t) => decorationsOfTemplate(t).includes('speech-bubble')).map((t) => t.id)
    expect(speech.sort()).toEqual(['faq.bubbles', 'faq.center-bubble', 'hidden_page.qa-bubble', 'problem_empathy.bubble-bleed', 'problem_raise.bubble-bleed', 'problem_raise.bubbles', 'problem_raise.bubbles-answer', 'review.bubbles'])
  })

  it('말풍선 템플릿에 다른 장식, 색 조합에 먼 제품색 면 둘을 더하면 두 경고가 함께 난다', () => {
    const set = allSets[0]
    const bubble = TEMPLATES.find((t) => t.id === 'review.bubbles')!
    expect(lintKPageColors(set.colors, [bubble])).toEqual([])
    const families = hueFamiliesOf(designColorsOf(set.colors))
    const far = (k: number) => (families[0]?.hue ?? 0) + 120 * k
    const warnings = lintKPageColors(set.colors, [bubble], { colors: [at(far(1)), at(far(2))], decorations: ['laurel'] })
    expect(warnings.map((w) => w.rule)).toEqual(['hue-families', 'decoration-stack'])
  })
})
