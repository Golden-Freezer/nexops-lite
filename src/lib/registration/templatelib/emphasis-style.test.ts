/**
 * 컨셉 강조 방식(적용 K4 T1-18, 연구 A2 #13·6-3) — 밝은 면은 band면 형광 띠, color면 색 글자(강조 글자색을 못 만드는 highlight 조합은 띠),
 * 짙은 면은 늘 색 글자다. 옛 계획 색(칸 없음)은 지금 규칙 그대로 그린다. 공급자 콜 없음
 */

import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { readDesignCut } from '@/lib/registration/editor/utils/sectionConverter/designCut/contract'
import { designCutPlanForB } from '@/lib/registration/editor/utils/sectionConverter/designCut/designCut.fixture'
import { EMPHASIS_STYLES, headingOn, mix, surfaceOf, type Colors } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import { colorSetsOf, toDesignTokens } from './color-sets'
import { CONCEPTS, conceptById } from './concepts'
import { BAND_ALPHA, renderTemplate } from './engine'
import { ctxOf, templateOf, textSlot } from './engine.fixture'
import type { SurfaceName } from './template-types'

const BAND = ['pastel-baby', 'jelly-soft', 'cloud-soft', 'candy-pop', 'cozy-beige', 'animal-friends', 'y2k-glossy', 'spring-blossom', 'summer-citrus']
const WHITE = '#FFFFFF'
const contrast = (a: string, b: string) => contrastRatio(parseColor(a)!, parseColor(b)!)
const setsOf = (id: string) => colorSetsOf(conceptById(id)!).sets
const usesBand = (c: Colors) => c.highlight || c.emphasisStyle === 'band'

const head = templateOf({
  surfaces: ['W', 'T', 'N', 'D'],
  flow: [{ kind: 'text', slot: 'headline', token: 'H1', emphasis: true }],
  slots: { headline: textSlot({ required: true }) },
})
const draw = (colors: Colors, bg: SurfaceName) => renderTemplate(head, { headline: '20개 한 번에 보관 끝' }, ctxOf({ colors, bg, usp: ['보관'] }))!
/** 요소 id는 그릴 때마다 늘어나는 순번이라 빼고 바이트를 잰다 */
const bytesOf = (colors: Colors, bg: SurfaceName) => JSON.stringify(draw(colors, bg)).replace(/"id":"[^"]*"/g, '"id":""')
const richOf = (colors: Colors, bg: SurfaceName) => draw(colors, bg).elements.find((e) => e.name === 'designcut-headline')!.textProps!.richContent ?? ''
const isBand = (rich: string) => rich.includes('background-color:')
const isColor = (rich: string) => /<span style="color:#/.test(rich)
/** 옛 계획 색 — 강조 방식 칸이 없다 */
const withoutStyle = (colors: Colors): Colors => {
  const rest = { ...colors }
  delete rest.emphasisStyle
  return rest
}

describe('컨셉 배정', () => {
  it('44컨셉 모두 color 또는 band이고, band는 놀이·부드러움 쪽 9개다', () => {
    for (const c of CONCEPTS) expect(EMPHASIS_STYLES, c.id).toContain(c.emphasisStyle)
    expect(CONCEPTS.filter((c) => c.emphasisStyle === 'band').map((c) => c.id).sort()).toEqual([...BAND].sort())
  })

  it('band 컨셉은 부드러움 축 1 이상·고가 아님·귀여움·트렌디·계절 계열이고, 신뢰·고급·미니멀 계열은 모두 color다', () => {
    for (const c of CONCEPTS.filter((x) => x.emphasisStyle === 'band')) {
      expect(c.axes.soft, c.id).toBeGreaterThanOrEqual(1)
      expect(c.price, c.id).not.toBe('premium')
      expect(['cute', 'trendy', 'season'], c.id).toContain(c.family)
    }
    for (const c of CONCEPTS.filter((x) => ['trust', 'premium', 'minimal'].includes(x.family))) expect(c.emphasisStyle, c.id).toBe('color')
  })
})

describe('색 조합', () => {
  it('색 조합은 컨셉 강조 방식을 싣고, 토큰 내보내기는 확장 칸에 둔다', () => {
    for (const c of CONCEPTS) for (const s of colorSetsOf(c).sets) expect(s.colors.emphasisStyle, s.id).toBe(c.emphasisStyle)
    const tokens = toDesignTokens(setsOf('jelly-soft')[0]) as { color: Record<string, unknown>; $extensions: Record<string, { emphasisStyle: string }> }
    expect(tokens.color).not.toHaveProperty('emphasisStyle')
    expect(tokens.$extensions['nexops.templatelib'].emphasisStyle).toBe('band')
  })

  it('띠를 쓰는 조합은 모든 밝은 면(바탕·T·N·흰)에서 띠 위 제목 대비 4.5 이상이다(M2) — 최소 5.81(candy-pop)', () => {
    let min = Infinity
    let at = ''
    for (const s of CONCEPTS.flatMap((c) => colorSetsOf(c).sets).filter((x) => usesBand(x.colors))) {
      const c = s.colors
      for (const fill of [c.base, c.tint, c.neutral, WHITE]) {
        const ratio = contrast(headingOn({ fill, text: c.ink, dark: false }, c), mix(fill, c.accent, BAND_ALPHA))
        if (ratio < min) [min, at] = [ratio, s.id]
      }
    }
    expect(min, at).toBeGreaterThanOrEqual(4.5)
    expect(Math.round(min * 100) / 100, at).toBe(5.81)
    expect(at.startsWith('candy-pop.')).toBe(true)
  })
})

describe('엔진 — 제목 강조 구절', () => {
  const band = setsOf('jelly-soft').find((s) => !s.colors.highlight)!.colors
  const color = setsOf('clean-trust')[0].colors
  const colorHighlight = setsOf('pro-navy').find((s) => s.colors.highlight)!.colors

  it('band 컨셉은 밝은 면(W·T·N)에서 형광 띠, 짙은 면(D)은 색 글자다', () => {
    for (const bg of ['W', 'T', 'N'] as const) {
      const rich = richOf(band, bg)
      expect(isBand(rich), bg).toBe(true)
      expect(rich, bg).toContain(`background-color:rgba(`)
      expect(rich, bg).toContain(`, ${BAND_ALPHA})`)
    }
    // band 9컨셉은 모두 짙은 면이 없다(deep null — D가 T 색에 잉크 글자) — D는 지금처럼 강조 글자를 못 만들어 칠하지 않고 띠도 없다
    expect(CONCEPTS.filter((c) => c.emphasisStyle === 'band').every((c) => c.deep === null)).toBe(true)
    expect(isBand(richOf(band, 'D'))).toBe(false)
    expect(bytesOf(band, 'D')).toBe(bytesOf({ ...band, emphasisStyle: 'color' }, 'D'))
  })

  it('color 컨셉은 색 글자, 그 컨셉의 highlight 조합(금색 강조)만 밝은 면에서 띠다', () => {
    for (const bg of ['W', 'T', 'N'] as const) {
      expect(isColor(richOf(color, bg)), bg).toBe(true)
      expect(isBand(richOf(color, bg)), bg).toBe(false)
      expect(isBand(richOf(colorHighlight, bg)), bg).toBe(true)
    }
  })

  it('옛 계획 색(칸 없음)은 지금 규칙이다 — color 조합과 바이트가 같고, band 컨셉 색도 칸이 없으면 색 글자다', () => {
    for (const bg of ['W', 'T', 'N', 'D'] as const) {
      expect(bytesOf(withoutStyle(color), bg), bg).toBe(bytesOf(color, bg))
      expect(bytesOf(withoutStyle(colorHighlight), bg), bg).toBe(bytesOf(colorHighlight, bg))
      expect(isBand(richOf(withoutStyle(band), bg)), bg).toBe(false)
    }
  })

  it('짙은 면은 강조 방식과 무관하게 색 글자이고 바이트가 같다', () => {
    // 짙은 면이 있는 컨셉 색에 band를 붙여도 D는 색 글자 그대로다(연구 A2 6-3 '짙은 면은 색 글자로 고정')
    const forced: Colors = { ...color, emphasisStyle: 'band' }
    expect(isColor(richOf(forced, 'D'))).toBe(true)
    expect(bytesOf(forced, 'D')).toBe(bytesOf(color, 'D'))
    expect(isBand(richOf(forced, 'W'))).toBe(true)
  })

  it('띠 색은 그 면 위에 강조색을 BAND_ALPHA로 얹은 값이고 제목 글자색은 그대로다', () => {
    const fill = surfaceOf('W', band).fill
    const el = draw(band, 'W').elements.find((e) => e.name === 'designcut-headline')!
    expect(el.textProps!.color).toBe(headingOn({ fill, text: band.ink, dark: false }, band))
  })
})

describe('계획 기록(templateColors)', () => {
  const read = (templateColors: unknown) => readDesignCut({ designcut: Object.assign(designCutPlanForB(), { layout: 2, templateColors }) })!.templateColors
  const colors = setsOf('jelly-soft')[0].colors

  it('band·color는 그대로 지나가고, 칸이 없으면 칸 없이 읽는다', () => {
    expect(read(colors)).toEqual(colors)
    expect(read({ ...colors, emphasisStyle: 'color' })!.emphasisStyle).toBe('color')
    expect(read(withoutStyle(colors))).not.toHaveProperty('emphasisStyle')
  })

  it('모르는 강조 방식은 그 칸만 버리고 색은 둔다', () => {
    for (const bad of ['stripe', 1, null, true]) {
      const got = read({ ...colors, emphasisStyle: bad })
      expect(got, String(bad)).toEqual(withoutStyle(colors))
    }
  })
})
