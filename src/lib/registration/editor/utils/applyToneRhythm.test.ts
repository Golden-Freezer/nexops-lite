import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '../types/canvas'
import type { DesignPalette } from '../types/editor'
import { ProSectionType } from '../types/section'
import { MIN_TONE_DISTANCE, applyToneRhythm, deepTone, lightTones, toneDistance } from './applyToneRhythm'
import { checkMobileReadability } from './mobileReadability'
import { makeImageEl, makeShapeEl, makeTextEl } from './sectionConverter/elements'

const PALETTE: DesignPalette = {
  primary: '#C2410C',
  secondary: '#BE185D',
  bgMain: '#FDF2F8',
  bgSub: '#FFF7ED',
  textMain: '#262626',
  textHighlight: '#D63384',
}

let seq = 0
function section(type: ProSectionType, background: string, elements: CanvasElement[], height = 1200): CanvasSection {
  return {
    id: `s${seq++}`,
    sectionType: type,
    groupType: 'usp',
    order: seq,
    isVisible: true,
    layoutId: `${type}_layout_01`,
    canvas: { width: 860, height, backgroundColor: background },
    elements,
  }
}
const body = (text = '본문') => [makeTextEl('t', text, 'body', 60, 140, 740, PALETTE.textMain)]
const bgs = (sections: CanvasSection[]) =>
  sections.filter((s) => s.sectionType !== ProSectionType.DIVIDER).map((s) => s.canvas.backgroundColor)

describe('applyToneRhythm — 경계 사례', () => {
  it('밝은 톤은 서로 거의 같은 색을 합친다(bgMain이 흰색이면 T와 W가 하나)', () => {
    expect(Object.keys(lightTones({ ...PALETTE, bgMain: '#FFFFFF' }))).toEqual(['T', 'N'])
    expect(Object.keys(lightTones(PALETTE))).toEqual(['T', 'N', 'W'])
    expect(toneDistance('#FDF2F8', '#FFF7ED')).toBeGreaterThanOrEqual(MIN_TONE_DISTANCE)
  })

  it('cta·perf_sales는 고정(기존 색 그대로) — 같은 밝은 톤 세 섹션은 이웃끼리 다른 색이 된다', () => {
    const page = [
      section(ProSectionType.PROBLEM_RAISE, PALETTE.bgMain, body()),
      section(ProSectionType.POINT_DIV, PALETTE.bgMain, body()),
      section(ProSectionType.SUB_DIV, PALETTE.bgMain, body()),
      section(ProSectionType.PERFORMANCE_SALES, '#2A1A10', body()),
      section(ProSectionType.CTA, PALETTE.primary, body()),
    ]
    const out = bgs(applyToneRhythm(page, PALETTE))
    expect(out[3]).toBe('#2A1A10')
    expect(out[4]).toBe(PALETTE.primary)
    for (let i = 1; i < 3; i++) expect(toneDistance(out[i], out[i - 1])).toBeGreaterThanOrEqual(MIN_TONE_DISTANCE)
  })

  it('짙은 띠 후보(solution_guide, 글자만)는 흰 글자로 바뀌고, 도형이 있는 섹션은 짙은 띠가 되지 않는다', () => {
    const page = [
      section(ProSectionType.PROBLEM_RAISE, PALETTE.bgMain, body()),
      section(ProSectionType.SOLUTION_GUIDE, PALETTE.bgSub, body('해결 요약')),
      section(ProSectionType.POINT_LIST_DIV, PALETTE.bgMain, [
        ...body('추천 대상'),
        makeShapeEl('list_circle_0', 'circle', 60, 140, 48, 48, { fill: PALETTE.primary }, 2),
      ]),
      section(ProSectionType.CTA, PALETTE.primary, body()),
    ]
    const out = applyToneRhythm(page, PALETTE)
    const solution = out.find((s) => s.sectionType === ProSectionType.SOLUTION_GUIDE)!
    expect(solution.canvas.backgroundColor).toBe(deepTone(PALETTE.primary))
    expect(solution.elements[0].textProps!.color).toBe('#FFFFFF')
    expect(out.find((s) => s.sectionType === ProSectionType.POINT_LIST_DIV)!.canvas.backgroundColor).not.toBe(
      deepTone(PALETTE.primary)
    )
  })

  it('사진 주도(P)는 바탕이 거의 안 보여도 이웃과 같은 색이면 겹치지 않는 밝은 톤으로 바꾼다', () => {
    const photo = [makeImageEl('product_img', 'https://img.test/p.png', 'product_exposure', 0, 0, 860, 1100)]
    const page = [
      section(ProSectionType.PROBLEM_RAISE, PALETTE.bgSub, body()),
      section(ProSectionType.PRODUCT_EXPOSURE, PALETTE.bgSub, photo, 1200),
      section(ProSectionType.SUB_DIV, PALETTE.bgSub, body()),
    ]
    const out = bgs(applyToneRhythm(page, PALETTE))
    for (let i = 1; i < out.length; i++)
      expect(toneDistance(out[i], out[i - 1])).toBeGreaterThanOrEqual(MIN_TONE_DISTANCE)
  })

  it('현재 톤도 대비를 검사한다 — 테마 색(#F5F5F5)에서 하한에 맞춘 글자가 가장 가까운 팔레트 톤으로 바뀌어도 위반이 늘지 않는다', () => {
    const palette = { ...PALETTE, bgMain: '#E2F9F3', bgSub: '#F4F4F2' }
    const edge = [makeTextEl('step_num_0', '01', 'body', 60, 140, 740, '#707070')]
    const page = [
      section(ProSectionType.PROBLEM_RAISE, '#F5F5F5', edge),
      section(ProSectionType.POINT_DIV, '#F5F5F5', edge),
      section(ProSectionType.SUB_DIV, '#F5F5F5', edge),
    ]
    const m2 = (sections: CanvasSection[]) =>
      checkMobileReadability({ sections }).violations.filter((v) => v.rule === 'M2').length
    expect(m2(applyToneRhythm(page, palette))).toBeLessThanOrEqual(m2(page))
  })

  it('바탕을 바꿔 글자 대비(M2) 위반이 늘어나는 톤은 고르지 않는다', () => {
    // 흰 바탕에서만 4.5를 넘는 연한 회색 글자 — 분홍·크림으로 바꾸면 대비가 떨어진다
    const faint = [makeTextEl('t', '연한 글자', 'body', 60, 140, 740, '#767676')]
    const page = [
      section(ProSectionType.PROBLEM_RAISE, '#FFFFFF', faint),
      section(ProSectionType.POINT_DIV, '#FFFFFF', faint),
      section(ProSectionType.SUB_DIV, '#FFFFFF', faint),
    ]
    const before = checkMobileReadability({ sections: page }).violations.filter((v) => v.rule === 'M2').length
    const after = checkMobileReadability({ sections: applyToneRhythm(page, PALETTE) }).violations.filter(
      (v) => v.rule === 'M2'
    ).length
    expect(after).toBeLessThanOrEqual(before)
  })
})

describe('applyToneRhythm — R4 짙은 띠 하나·같은 톤 경계 표시', () => {
  const divider = (height: number, background = '#FFFFFF') => section(ProSectionType.DIVIDER, background, [], height)
  const seam = (s: CanvasSection) => s.elements.find((e) => e.name === 'rhythm_seam')

  it('짙은 띠 후보가 둘이어도 하나만 — solution_guide(문제 → 해결 전환점)', () => {
    const page = [
      section(ProSectionType.PROBLEM_RAISE, PALETTE.bgMain, body()),
      section(ProSectionType.SOLUTION_GUIDE, PALETTE.bgSub, body('해결 요약')),
      section(ProSectionType.POINT_DIV, PALETTE.bgMain, body()),
      section(ProSectionType.SUB_DIV, PALETTE.bgMain, body()),
      section(ProSectionType.POINT_LIST_DIV, PALETTE.bgMain, body('추천 대상')),
      section(ProSectionType.HIDDEN_PAGE, PALETTE.bgMain, body()),
      section(ProSectionType.CTA, PALETTE.primary, body()),
    ]
    const deep = deepTone(PALETTE.primary)
    const out = applyToneRhythm(page, PALETTE)
    expect(out.filter((s) => s.canvas.backgroundColor === deep).map((s) => s.sectionType)).toEqual([
      ProSectionType.SOLUTION_GUIDE,
    ])
  })

  it('같은 톤 이웃 — 남은 거터는 기본 바탕(bgMain)으로 칠하고 선은 긋지 않는다', () => {
    const page = [
      section(ProSectionType.PERFORMANCE_SALES, '#FFFFFF', body()),
      divider(40),
      section(ProSectionType.CTA, '#FFFFFF', body()),
    ]
    const out = applyToneRhythm(page, PALETTE)
    expect(out[1].canvas.backgroundColor).toBe(PALETTE.bgMain)
    expect(seam(out[2])).toBeUndefined()
  })

  it('거터가 없거나(0px) 기본 바탕도 같은 톤이면 뒤 섹션 맨 위에 폰 1px 선(본문 폭)', () => {
    const noGutter = applyToneRhythm(
      [section(ProSectionType.PERFORMANCE_SALES, '#FFFFFF', body()), divider(0), section(ProSectionType.CTA, '#FFFFFF', body())],
      PALETTE
    )
    expect(seam(noGutter[2])!.transform).toMatchObject({ x: 60, y: 0, width: 740, height: 2 })
    const white = { ...PALETTE, bgMain: '#FFFFFF' }
    const sameBase = applyToneRhythm(
      [section(ProSectionType.PERFORMANCE_SALES, '#FFFFFF', body()), divider(40), section(ProSectionType.CTA, '#FFFFFF', body())],
      white
    )
    expect(sameBase[1].canvas.backgroundColor).toBe('#FFFFFF')
    expect(seam(sameBase[2])).toBeDefined()
    const before = [section(ProSectionType.PERFORMANCE_SALES, '#FFFFFF', body()), divider(40), section(ProSectionType.CTA, '#FFFFFF', body())]
    expect(checkMobileReadability({ sections: sameBase }).counts.M4).toBeLessThanOrEqual(
      checkMobileReadability({ sections: before }).counts.M4
    )
  })

  it('바탕이 다르거나 전폭 사진이 경계에 붙어 있으면 표시하지 않는다', () => {
    const photo = makeImageEl('cta_img', 'https://img.test/c.png', 'cta', 0, 0, 860, 600)
    const flush = applyToneRhythm(
      [section(ProSectionType.PERFORMANCE_SALES, '#FFFFFF', body()), section(ProSectionType.CTA, '#FFFFFF', [photo, ...body()])],
      PALETTE
    )
    expect(seam(flush[1])).toBeUndefined()
    const differ = applyToneRhythm(
      [section(ProSectionType.PERFORMANCE_SALES, '#FFFFFF', body()), section(ProSectionType.CTA, '#2A1A10', body())],
      PALETTE
    )
    expect(seam(differ[1])).toBeUndefined()
  })
})
