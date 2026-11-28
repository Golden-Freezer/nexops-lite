/**
 * K 라인 컨셉·색·글꼴(M4) — 데이터 형식, 이름 규칙, 색 조합 자동 검사(오너 지시 '어두운 노랑 금지'·대비), 글꼴 실재, 결정론. LLM·DB 없음.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PDP_CATEGORY_KEYS } from '@/lib/registration/__fixtures__/pdp-products'
import { FONT_OPTIONS } from '@/lib/registration/editor/constants/fonts'
import { contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { regulatedClaimTermsIn } from '@/lib/registration/eval/claim-lexicon'
import { rgbToLch } from '@/lib/registration/internalized/designcut-palette'
import { TEXT_MIN_CONTRAST, colorSetsOf, isDarkYellow, rankForPhoto, textColorsOf, toDesignTokens, type ColorSet } from './color-sets'
import { CONCEPTS, CONCEPT_FAMILIES, CONCEPT_FAMILY_IDS, conceptById, conceptForCategory, type Concept } from './concepts'
import { FONT_PAIR_IDS, FONT_PAIR_TABLE } from './font-pairs'

const contrast = (a: string, b: string) => contrastRatio(parseColor(a)!, parseColor(b)!)
const allSets = CONCEPTS.flatMap((c) => colorSetsOf(c).sets)

describe('컨셉 데이터', () => {
  it('8계열 44개, 계열별 수가 계획과 같고 id·이름이 겹치지 않는다', () => {
    expect(CONCEPTS).toHaveLength(44)
    expect(CONCEPT_FAMILIES.map((f) => f.id)).toEqual([...CONCEPT_FAMILY_IDS])
    const count = (family: string) => CONCEPTS.filter((c) => c.family === family).length
    expect(CONCEPT_FAMILY_IDS.map(count)).toEqual([6, 6, 6, 6, 5, 5, 5, 5])
    expect(new Set(CONCEPTS.map((c) => c.id)).size).toBe(44)
    expect(new Set(CONCEPTS.map((c) => c.name)).size).toBe(44)
    expect(conceptById('pastel-baby')?.name).toBe('파스텔 베이비')
    expect(conceptById('없음')).toBeUndefined()
  })

  it('축·카테고리·열거 값이 범위 안이다', () => {
    for (const c of CONCEPTS) {
      for (const v of Object.values(c.axes)) expect(Math.abs(v)).toBeLessThanOrEqual(2)
      for (const v of Object.values(c.aaker)) expect(v >= 1 && v <= 5).toBe(true)
      for (const key of [...c.categories, ...c.categoryBlock]) expect(PDP_CATEGORY_KEYS as readonly string[]).toContain(key)
      expect(c.categories.filter((k) => c.categoryBlock.includes(k))).toEqual([])
      expect(c.categories.length).toBeGreaterThan(0)
      expect(c.mood.length).toBeGreaterThan(0)
      expect(['low', 'mid', 'high']).toContain(c.density)
      expect(['round', 'soft', 'square', 'mix']).toContain(c.shape)
      expect(['value', 'mid', 'premium']).toContain(c.price)
      expect(['review', 'spec', 'origin', 'none']).toContain(c.trust)
      expect(['light', 'mixed', 'dark']).toContain(c.rhythm)
      expect(c.accents).toHaveLength(3)
      expect(new Set(c.accents.map((a) => a.id)).size).toBe(3)
    }
  })

  it('카테고리마다 고를 컨셉이 충분하다(5개 이상)', () => {
    for (const key of PDP_CATEGORY_KEYS) {
      expect(CONCEPTS.filter((c) => c.categories.includes(key)).length).toBeGreaterThanOrEqual(5)
    }
  })

  it('이름·계열·분위기 낱말에 규제·효능으로 읽히는 말이 없다', () => {
    const texts = [...CONCEPT_FAMILIES.map((f) => f.name), ...CONCEPTS.flatMap((c) => [c.name, ...c.mood])]
    for (const text of texts) {
      expect(regulatedClaimTermsIn(text, { negation: true })).toEqual([])
      expect(text).not.toMatch(/메디컬|의료|약국|치료|친환경|오가닉|유기농|제로\s*웨이스트/)
    }
  })

  it('짙은 면이 없는 쪽: 귀여움 계열은 짙은 면을 쓰지 않고 rhythm도 light다(오너 지시 — 어린이집 학부모는 밝게)', () => {
    for (const c of CONCEPTS.filter((x) => x.family === 'cute')) {
      expect(c.deep).toBeNull()
      expect(c.rhythm).toBe('light')
    }
    for (const c of CONCEPTS) if (c.deep === null) expect(c.rhythm).toBe('light')
  })
})

describe('글꼴 짝', () => {
  const css = readFileSync(join(process.cwd(), 'public/fonts/pdp/fonts.css'), 'utf8')
  const faces = [...css.matchAll(/font-family:'([^']+)';[^}]*?font-weight:([0-9 ]+)/g)].map((m) => ({
    family: m[1],
    weight: m[2].trim().split(' ').map(Number),
  }))
  const hasFace = (family: string, weight: number) =>
    faces.some((f) => f.family === family && (f.weight.length === 2 ? weight >= f.weight[0] && weight <= f.weight[1] : f.weight[0] === weight))

  it.each(FONT_PAIR_IDS)('%s: 자체 보관 글꼴·굵기가 실제로 있고 라이선스가 OFL이다', (id) => {
    const pair = FONT_PAIR_TABLE[id]
    expect(hasFace(pair.heading, pair.weight)).toBe(true)
    expect(hasFace(pair.body, 400)).toBe(true)
    const options = FONT_OPTIONS.filter((f) => f.fontFamily === pair.heading)
    expect(options.length).toBeGreaterThan(0)
    expect(options.every((f) => f.license === 'OFL')).toBe(true)
  })

  it('모든 컨셉이 있는 짝을 가리키고, 쓰이지 않는 짝이 없다', () => {
    const used = new Set(CONCEPTS.flatMap((c) => [c.fontPair, ...Object.values(c.fontPairByCategory ?? {})]))
    for (const id of used) expect(FONT_PAIR_IDS).toContain(id)
    for (const id of FONT_PAIR_IDS) expect(used.has(id)).toBe(true)
  })
})

describe('색 조합 — 후보 수와 자동 검사', () => {
  // K9: 강조와 60° 넘게 벌어진 연한 면을 회백으로 두면서 cloud-soft peach soft 3벌(흰·틴트·돌)이 회백 T와 구분되지 않아 빠졌다(1,040 → 1,037)
  it('컨셉마다 후보 24개(통과 + 탈락), 전체 1,056개 중 1,037개가 남는다 — 컨셉 값을 고치면 이 수를 확인하고 함께 고친다', () => {
    for (const c of CONCEPTS) {
      const { sets, rejected } = colorSetsOf(c)
      expect(sets.length + rejected.length).toBe(24)
      expect(sets.length).toBeGreaterThanOrEqual(12)
    }
    expect(allSets.length).toBe(1037)
    expect(new Set(allSets.map((s) => s.id)).size).toBe(allSets.length)
    const reasons = CONCEPTS.flatMap((c) => colorSetsOf(c).rejected).map((r) => r.reason)
    expect(reasons.filter((r) => r === '강조 면이 바탕과 구분되지 않음').length).toBe(2)
    expect(reasons.filter((r) => r === '강조 면이 연한 면과 구분되지 않음').length).toBe(17)
    expect(reasons.length).toBe(19)
  })

  it('통과한 모든 조합: 글자 대비 4.5:1 — 모든 밝은 면과 강조 면·짙은 면 위', () => {
    const WHITE = '#FFFFFF'
    for (const { colors: c, id } of allSets) {
      for (const surface of [c.base, c.tint, c.neutral, WHITE]) {
        for (const text of [c.ink, c.heading, c.accentText]) {
          expect(contrast(text, surface), `${id} ${text} on ${surface}`).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST)
        }
      }
      expect(contrast(c.onAccent, c.accent), `${id} onAccent`).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST)
      expect(contrast(c.onDeep, c.deep), `${id} onDeep`).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST)
    }
  })

  it('통과한 모든 조합: 어두운 노랑이 글자·면 어디에도 없다', () => {
    for (const { colors: c, id } of allSets) {
      for (const color of [c.accent, c.accentText, c.ink, c.heading, c.onAccent]) {
        expect(isDarkYellow(rgbToLch(parseColor(color)!)), `${id} ${color}`).toBe(false)
      }
    }
  })

  it('노란 강조는 잉크 + 형광 띠로 쓴다(highlight), 그 밖의 색은 진하게 낮춘 강조 글자를 쓴다', () => {
    const butter = colorSetsOf(conceptById('pastel-baby')!).sets.find((s) => s.accent === 'butter')!
    expect(butter.colors.highlight).toBe(true)
    expect(butter.colors.accentText).toBe(butter.colors.ink)
    const coral = colorSetsOf(conceptById('pastel-baby')!).sets.find((s) => s.accent === 'coral')!
    expect(coral.colors.highlight).toBe(false)
    expect(coral.colors.accentText).not.toBe(coral.colors.ink)
  })

  describe('연한 면(T) — 섹션 바탕이 바뀐 것이 보여야 한다', () => {
    const labOf = (hex: string) => {
      const { l, c, h } = rgbToLch(parseColor(hex)!)
      return [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)]
    }
    const deltaE = (a: string, b: string) => {
      const [x, y] = [labOf(a), labOf(b)]
      return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
    }
    const ofBase = (base: ColorSet['base']) => allSets.filter((s) => s.base === base)

    it('흰 조합: 흰색과 색차 8 이상, 회색 면 N과 색차 6 이상 — 컨셉 전부', () => {
      expect(new Set(ofBase('white').map((s) => s.conceptId)).size).toBe(CONCEPTS.length)
      for (const { id, colors: c } of ofBase('white')) {
        expect(deltaE(c.tint, '#FFFFFF'), `${id} T-흰`).toBeGreaterThanOrEqual(8)
        expect(deltaE(c.tint, c.neutral), `${id} T-N`).toBeGreaterThanOrEqual(6)
      }
    })

    it('옅은 틴트·돌색 조합: 바탕과 색차 7.9 이상', () => {
      for (const { id, colors: c } of [...ofBase('tint'), ...ofBase('stone')]) {
        expect(deltaE(c.tint, c.base), `${id} T-바탕`).toBeGreaterThanOrEqual(7.9)
      }
    })

    it('회색 면 N은 네 조합 모두 바탕과 색차 3.9 이상이다 — 이웃 섹션이 갈린다', () => {
      for (const { id, colors: c } of allSets) expect(deltaE(c.neutral, c.base), `${id} N-바탕`).toBeGreaterThanOrEqual(3.9)
    })

    it('무채 돌색 조합은 T와 N도 갈린다', () => {
      for (const concept of CONCEPTS.filter((c) => c.baseChroma === 0)) {
        const { colors: c } = colorSetsOf(concept).sets.find((s) => s.base === 'stone')!
        expect(deltaE(c.tint, c.neutral), concept.id).toBeGreaterThanOrEqual(4.3)
      }
    })

    it('soft 조합은 바탕이 색 면이라 T가 흰색이다', () => {
      for (const { colors: c } of ofBase('soft')) expect(c.tint).toBe('#FFFFFF')
    })

    it('무채 컨셉은 T도 무채다', () => {
      for (const concept of CONCEPTS.filter((c) => c.baseChroma === 0)) {
        const t = colorSetsOf(concept).sets.find((s) => s.base === 'white')!.colors.tint
        expect(rgbToLch(parseColor(t)!).c, concept.id).toBeLessThan(1)
      }
    })

    it('강조 면은 T 위에서도 구분된다(1.3:1 이상 또는 색차 30 이상)', () => {
      for (const { id, colors: c } of allSets) {
        const seen = contrast(c.accent, c.tint) >= 1.3 || deltaE(c.accent, c.tint) >= 30
        expect(seen, `${id} ${c.accent} on ${c.tint}`).toBe(true)
      }
    })
  })

  it('짙은 면이 없는 컨셉은 deep이 띠 색이고 그 위 글자는 잉크다', () => {
    const set = colorSetsOf(conceptById('pastel-baby')!).sets[0]
    expect(set.colors.deep).toBe(set.colors.tint)
    expect(set.colors.onDeep).toBe(set.colors.ink)
  })

  const fake = (accent: { l: number; c: number; h: number }, baseChroma = 2): Concept =>
    ({ ...conceptById('simple-life')!, id: 'fake', baseChroma, accents: [{ id: 'a', ...accent }, { id: 'b', ...accent }, { id: 'c', ...accent }] }) as Concept

  it('탈락: 탁한 노랑 면, 바탕과 구분 안 되는 면을 사유와 함께 남긴다', () => {
    const reasons = (accent: { l: number; c: number; h: number }) => new Set(colorSetsOf(fake(accent)).rejected.map((r) => r.reason))
    expect(reasons({ l: 60, c: 40, h: 90 })).toContain('탁한 노랑 면')
    expect(reasons({ l: 99, c: 1, h: 90 })).toContain('강조 면이 바탕과 구분되지 않음')
  })

  it('중간 밝기 강조 면: 색상각·채도를 두고 명도만 옮겨 글자 대비를 맞춘다 — 부드러운 쪽은 잉크, 강한 쪽은 흰 글자', () => {
    const { sets, rejected } = colorSetsOf(fake({ l: 56, c: 40, h: 150 }))
    expect(rejected).toEqual([])
    const of = (strength: string) => sets.find((s) => s.strength === strength)!
    expect(of('soft').colors.onAccent).toBe(of('soft').colors.ink)
    expect(of('strong').colors.onAccent).toBe('#FFFFFF')
    const hue = (s: ColorSet) => rgbToLch(parseColor(s.colors.accent)!).h
    expect(Math.abs(hue(of('soft')) - 150)).toBeLessThan(3)
    expect(Math.abs(hue(of('strong')) - 150)).toBeLessThan(3)
  })

  it('강한 쪽은 12 어두운 곳에서 시작해 가까운 쪽으로 옮기므로 흰 글자 면이 된다', () => {
    const strong = colorSetsOf(fake({ l: 66, c: 40, h: 150 })).sets.find((s) => s.strength === 'strong')!
    expect(strong.colors.onAccent).toBe('#FFFFFF')
  })

  it('노란 강조의 강한 쪽은 어둡게 하지 않고 채도만 올린다(탁해지지 않게)', () => {
    const gold = colorSetsOf(conceptById('black-gold')!).sets.filter((s) => s.accent === 'gold')
    const lch = (s: ColorSet) => rgbToLch(parseColor(s.colors.accent)!)
    const soft = gold.find((s) => s.strength === 'soft')!
    const strong = gold.find((s) => s.strength === 'strong')!
    expect(Math.abs(lch(strong).l - lch(soft).l)).toBeLessThan(2)
    expect(lch(strong).c).toBeGreaterThan(lch(soft).c)
  })

  it('밝고 진한 색은 휘도 대비가 낮아도 색차로 보이는 면이라 남는다(레몬)', () => {
    const lemon = colorSetsOf(conceptById('summer-citrus')!).sets.filter((s) => s.accent === 'lemon')
    expect(lemon.length).toBeGreaterThan(0)
    expect(contrast(lemon[0].colors.accent, '#FFFFFF')).toBeLessThan(1.3)
  })

  it('결정론: 같은 컨셉은 언제나 같은 조합을 낸다', () => {
    const c = conceptById('city-pop')!
    expect(colorSetsOf(c)).toEqual(colorSetsOf(c))
  })
})

describe('사진 색과 맞추기', () => {
  const { sets } = colorSetsOf(conceptById('pastel-baby')!)
  const accents = (list: ColorSet[]) => [...new Set(list.map((s) => s.accent))]

  it('무채·없는 상품색은 순서를 바꾸지 않는다', () => {
    expect(rankForPhoto(sets, null)).toEqual({ sets, clashAll: false })
    expect(rankForPhoto(sets, '#F4F4F4')).toEqual({ sets, clashAll: false })
    expect(rankForPhoto(sets, 'not-a-color').sets).toEqual(sets)
  })

  it('진한 상품색과 멀리 떨어진 진한 강조는 빼고 가까운 색을 앞에 둔다', () => {
    // 노란 상품: 버터가 가장 가깝다. 산호색 상품: 입력 순서와 달리 산호색이 앞에 온다
    expect(accents(rankForPhoto(sets, '#F4C430').sets)[0]).toBe('butter')
    expect(accents(rankForPhoto(sets, '#F0746E').sets)[0]).toBe('coral')
    // 파란 상품(색상각 약 262): 산호색(약 126 차이, 채도 30 이상)은 빠진다
    const sky = rankForPhoto(sets, '#1E88C8')
    expect(accents(sky.sets)[0]).toBe('sky')
    expect(accents(sky.sets)).not.toContain('coral')
  })

  it('모두 충돌하면 후보를 비우지 않고 표시한다', () => {
    const coralOnly = sets.filter((s) => s.accent === 'coral')
    const result = rankForPhoto(coralOnly, '#1E88C8')
    expect(result.clashAll).toBe(true)
    expect(result.sets).toHaveLength(coralOnly.length)
  })
})

describe('토큰 내보내기', () => {
  it('W3C Design Tokens 형식 — 색은 sRGB 성분·hex, highlight는 확장 칸', () => {
    const set = colorSetsOf(conceptById('clean-trust')!).sets[0]
    const tokens = toDesignTokens(set) as {
      $description: string
      color: Record<string, { $type: string; $value: { colorSpace: string; components: number[]; hex: string } }>
      $extensions: Record<string, { highlight: boolean; conceptId: string }>
    }
    expect(tokens.$description).toBe(set.id)
    expect(tokens.color.accent.$type).toBe('color')
    expect(tokens.color.accent.$value.colorSpace).toBe('srgb')
    expect(tokens.color.accent.$value.hex).toBe(set.colors.accent)
    expect(tokens.color.accent.$value.components).toHaveLength(3)
    expect(tokens.color).not.toHaveProperty('highlight')
    expect(tokens.$extensions['nexops.templatelib'].conceptId).toBe('clean-trust')
  })
})

describe('카테고리 글꼴 짝 — 식품 손글씨(적용 T1-81)', () => {
  const hands = CONCEPTS.filter((c) => c.fontPairByCategory)

  it('손맛 컨셉 둘에만 있고 식품에서만 손글씨다', () => {
    expect(hands.map((c) => c.id).sort()).toEqual(['honest-kraft', 'terracotta-earth'])
    for (const concept of hands) {
      expect(concept.mood).toContain('손맛')
      expect(concept.categories).toContain('food')
      expect(conceptForCategory(concept, 'food').fontPair).toBe('hand-gaegu')
      for (const category of ['household', 'stationery', 'packaging', 'beauty']) expect(conceptForCategory(concept, category)).toBe(concept)
    }
  })

  it('다른 컨셉은 식품에서도 그대로다', () => {
    const other = CONCEPTS.find((c) => !c.fontPairByCategory && c.categories.includes('food'))!
    expect(conceptForCategory(other, 'food')).toBe(other)
  })

  it('카테고리 짝도 있는 짝을 가리키고, 본문은 Pretendard다', () => {
    for (const concept of hands) for (const id of Object.values(concept.fontPairByCategory!)) expect(FONT_PAIR_IDS).toContain(id)
    expect(FONT_PAIR_TABLE['hand-gaegu']).toEqual({ heading: 'Gaegu', weight: 400, body: 'Pretendard' })
  })
})

describe('K9 색 온도 — 연한 면과 글자색(상세페이지 조사 L10)', () => {
  const lch = (hex: string) => rgbToLch(parseColor(hex)!)
  const gap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

  it('바탕 채도 상한 2 이하 컨셉은 연한 면 T가 회백(L* 89·C* 2 이하)이다 — 강조가 같은 계열(30° 안, C* 20 이상)이면 컨셉 색 T, 무채 컨셉은 늘 회백', () => {
    const near = CONCEPTS.filter((c) => c.baseChroma <= 2)
    expect(near.length).toBeGreaterThanOrEqual(11)
    let same = 0
    for (const c of near) {
      for (const s of colorSetsOf(c).sets.filter((x) => x.base !== 'soft')) {
        const accent = c.accents.find((a) => a.id === s.accent)!
        const t = lch(s.colors.tint)
        if (c.baseChroma > 0 && accent.c >= 20 && gap(accent.h, c.baseHue) <= 30) {
          same++
          expect(Math.round(t.l), s.id).toBe(93)
          expect(t.c, s.id).toBeGreaterThanOrEqual(7.5)
        } else {
          expect(Math.round(t.l), s.id).toBe(89)
          expect(t.c, s.id).toBeLessThanOrEqual(2.5)
        }
      }
    }
    expect(same).toBeGreaterThan(0)
    // candy-pop 분홍 띠(통합 결정 11-02 20:5x) — 핫핑크 강조면 분홍 T, 레몬·터키석이면 회백
    const candy = colorSetsOf(conceptById('candy-pop')!).sets.filter((s) => s.base === 'white')
    expect(gap(lch(candy.find((s) => s.accent === 'hotpink')!.colors.tint).h, 350)).toBeLessThan(15)
    for (const s of candy.filter((x) => x.accent !== 'hotpink')) expect(lch(s.colors.tint).c, s.id).toBeLessThanOrEqual(2.5)
    // 무채 컨셉은 같은 계열 강조(mono-minimal signal 30°)여도 회백
    for (const s of colorSetsOf(conceptById('mono-minimal')!).sets.filter((x) => x.base !== 'soft')) expect(lch(s.colors.tint).c, s.id).toBeLessThanOrEqual(1)
  })

  it('강조와 색상각이 60° 넘게 벌어진 조합은 T가 회백이고, 가까운 조합은 컨셉 색 T다', () => {
    const cloud = conceptById('cloud-soft')!
    const sets = colorSetsOf(cloud).sets.filter((s) => s.base === 'white')
    const far = sets.filter((s) => gap(cloud.accents.find((a) => a.id === s.accent)!.h, cloud.baseHue) > 60)
    const near = sets.filter((s) => gap(cloud.accents.find((a) => a.id === s.accent)!.h, cloud.baseHue) <= 60)
    expect(far.length).toBeGreaterThan(0)
    expect(near.length).toBeGreaterThan(0)
    for (const s of far) expect(lch(s.colors.tint).c, s.id).toBeLessThanOrEqual(2.5)
    for (const s of near) expect(lch(s.colors.tint).c, s.id).toBeGreaterThanOrEqual(7.5)
  })

  it('글자색: 따뜻한 컨셉은 짙은 갈색, 차가운 컨셉은 짙은 남, 무채는 그대로 — 명도는 L* 20', () => {
    const warm = lch(textColorsOf(conceptById('cozy-beige')!).ink)
    expect(Math.round(warm.l)).toBe(20)
    expect(warm.c).toBeGreaterThanOrEqual(10)
    expect(gap(warm.h, 60)).toBeLessThan(10)
    const cool = lch(textColorsOf(conceptById('clean-trust')!).ink)
    expect(cool.c).toBeGreaterThanOrEqual(8)
    expect(gap(cool.h, 258)).toBeLessThan(10)
    const mono = lch(textColorsOf(conceptById('mono-minimal')!).ink)
    expect(mono.c).toBeLessThan(3)
    for (const s of allSets) expect(contrastRatio(parseColor(s.colors.ink)!, parseColor(s.colors.base)!), s.id).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST)
  })
})
