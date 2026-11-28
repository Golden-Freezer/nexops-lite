import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '../types/canvas'
import { ProSectionType } from '../types/section'
import { applyMobileFloor, readableColor, readableStarColor, worsensSectionMobile } from './applyMobileFloor'
import { checkMobileReadability, contrastRatio, parseColor } from './mobileReadability'
import { makeImageEl, makeShapeEl, makeTextEl } from './sectionConverter/elements'

let seq = 0
function section(
  type: string,
  height: number,
  elements: CanvasElement[],
  extra: Partial<CanvasSection> = {}
): CanvasSection {
  seq++
  return {
    id: `s${seq}`,
    sectionType: type as ProSectionType,
    groupType: 'usp',
    order: seq,
    isVisible: true,
    layoutId: `${type}_layout_01`,
    canvas: { width: 860, height, backgroundColor: '#ffffff' },
    elements,
    ...extra,
  }
}
const text = (name: string, y: number, size: number, color = '#1a1a1a', level: 'h2' | 'body' = 'body') =>
  makeTextEl(name, name, level, 60, y, 740, color, 'left', 3, { fontSize: size, height: 70, allowBelowMin: true })
const textOf = (s: CanvasSection, name: string) => s.elements.find((e) => e.name === name)!.textProps!

describe('applyMobileFloor — 글자·색(전 섹션)', () => {
  it('테마가 내린 글자를 위계별 하한으로 올리고, 사용자가 정한 크기는 둔다', () => {
    const styled = text('styled', 300, 37)
    styled.textProps!.userStyledKeys = ['fontSize']
    const [out] = applyMobileFloor([
      section(ProSectionType.HIDDEN_PAGE, 600, [
        text('desc', 140, 37),
        text('title', 220, 46, '#1a1a1a', 'h2'),
        styled,
      ]),
    ])
    expect(textOf(out, 'desc').fontSize).toBe(45)
    expect(textOf(out, 'title').fontSize).toBe(60)
    expect(textOf(out, 'styled').fontSize).toBe(37)
  })

  it('대비가 모자란 글자색은 색상을 유지한 채 어둡게(밝은 바탕)·밝게(어두운 바탕) 섞어 기준을 넘긴다', () => {
    const light = section(ProSectionType.POINT_LIST_DIV, 400, [
      text('brand', 140, 45, '#d63384'),
      text('fine', 220, 45, '#333333'),
    ])
    const dark = section(ProSectionType.HIDDEN_PAGE, 400, [text('dim', 140, 45, '#333333')], {
      canvas: { width: 860, height: 400, backgroundColor: '#111111' },
    })
    const [a, b] = applyMobileFloor([light, dark])
    const brand = parseColor(textOf(a, 'brand').color)!
    expect(contrastRatio(brand, [255, 255, 255])).toBeGreaterThanOrEqual(4.5)
    expect(brand[0]).toBeGreaterThan(brand[1] * 2) // 붉은 계열 유지(회색으로 바꾸지 않는다)
    expect(textOf(a, 'fine').color).toBe('#333333')
    expect(contrastRatio(parseColor(textOf(b, 'dim').color)!, [17, 17, 17])).toBeGreaterThanOrEqual(4.5)
  })

  it('60px 이상 제목은 3:1, 감싼 도형(반투명은 섹션 바탕에 합성) 기준으로 판정한다', () => {
    expect(readableColor('#949494', 60, [255, 255, 255])).toBe('#949494') // 3.03 — 큰 제목은 통과
    expect(readableColor('#949494', 45, [255, 255, 255])).not.toBe('#949494')
    // 반올림한 hex 기준으로 기준을 넘는다(verifier 재현값 — 반올림 전 판정이면 4.49·2.99로 남았다)
    for (const [color, size] of [
      ['#009933', 45],
      ['#00c366', 45],
      ['#fff688', 60],
    ] as const) {
      const fixed = parseColor(readableColor(color, size, [255, 255, 255]))!
      expect(contrastRatio(fixed, [255, 255, 255]), color).toBeGreaterThanOrEqual(size >= 60 ? 3 : 4.5)
    }
    const card = makeShapeEl('card', 'roundedRect', 40, 100, 780, 200, { fill: '#111111' }, 1)
    const tint = makeShapeEl('tint', 'rect', 40, 300, 780, 200, { fill: 'rgba(0, 0, 0, 0.04)' }, 1)
    const [out] = applyMobileFloor([
      section(ProSectionType.PERFORMANCE_REVIEWS, 600, [
        card,
        text('on_card', 120, 45, '#333333'),
        tint,
        text('on_tint', 320, 45, '#aaaaaa'),
      ]),
    ])
    expect(contrastRatio(parseColor(textOf(out, 'on_card').color)!, [17, 17, 17])).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(parseColor(textOf(out, 'on_tint').color)!, [245, 245, 245])).toBeGreaterThanOrEqual(4.5)
  })

  it('전 섹션 — 테마가 내린 글자를 하한으로(footer 계열 24, 사진 위 글자 색은 빌더 띠 소관)', () => {
    const photo = makeImageEl('photo', 'https://x.test/a.png', 'main', 0, 300, 860, 200, 1)
    const [out] = applyMobileFloor([
      section(ProSectionType.POINT_DIV, 600, [
        text('small', 140, 37),
        makeTextEl('legal_footer', '법정 표시', 'caption', 60, 220, 740, '#1a1a1a', 'left', 3, {
          fontSize: 20,
          height: 40,
          allowBelowMin: true,
        }),
        photo,
        text('over_photo', 320, 45, '#ffffff'),
      ]),
    ])
    expect(textOf(out, 'small').fontSize).toBe(45)
    expect(textOf(out, 'legal_footer').fontSize).toBe(24)
    expect(textOf(out, 'over_photo').color).toBe('#ffffff')
  })
})

describe('applyMobileFloor — 섹션 경계 빈 영역', () => {
  const content = (name: string, y: number, h: number) =>
    makeImageEl(name, 'https://x.test/a.png', 'main', 0, y, 860, h, 1)

  it('앞 섹션 아래 여백 + 구분선 + 다음 섹션 위 여백이 200px을 넘지 않게 줄인다', () => {
    const backdrop = makeShapeEl('bg', 'rect', 0, 0, 860, 640, { fill: '#f5f5f5' }, 0)
    const sections = [
      section(ProSectionType.MAIN_CUT, 640, [backdrop, content('a', 140, 360)]),
      section(ProSectionType.DIVIDER, 40, []),
      section(ProSectionType.POINT_DIV, 640, [content('b', 140, 360)]),
    ]
    expect(checkMobileReadability({ sections }).counts.M4).toBe(1) // 140 + 40 + 140 = 320
    const out = applyMobileFloor(sections)
    expect(checkMobileReadability({ sections: out }).counts.M4).toBe(0)
    // 넘친 120을 양쪽에서 60씩 — 위 섹션은 아래 여백만, 아래 섹션은 위 여백만 줄어든다
    expect(out[0].canvas.height).toBe(580)
    expect(out[0].elements.find((e) => e.name === 'a')!.transform.y).toBe(140)
    expect(out[0].elements.find((e) => e.name === 'bg')!.transform.height).toBe(580)
    expect(out[2].elements.find((e) => e.name === 'b')!.transform.y).toBe(80)
    expect(out[2].canvas.height).toBe(580) // 다음 경계(하단 140)는 넘치지 않아 그대로
  })

  it('높이를 직접 정한 섹션은 건드리지 않고 반대쪽에서만 줄인다', () => {
    const sections = [
      section(ProSectionType.MAIN_CUT, 640, [content('a', 140, 360)], { userAdjustedHeight: true }),
      section(ProSectionType.POINT_DIV, 640, [content('b', 140, 360)]),
    ]
    const out = applyMobileFloor(sections)
    expect(out[0]).toBe(sections[0])
    expect(out[1].elements[0].transform.y).toBe(60) // 140 + 140 − 200 = 80을 아래 섹션 위 여백에서
  })

  it('숨긴 요소는 내용으로 보지 않고, 내용 위 높이 0 요소는 0에서 멈춘다', () => {
    const hiddenTop = { ...content('hidden', 0, 50), isVisible: false }
    const marker = { ...content('marker', 20, 0) }
    const sections = [section(ProSectionType.MAIN_CUT, 640, [hiddenTop, marker, content('a', 300, 200)])]
    const [out] = applyMobileFloor(sections)
    expect(out.elements.find((e) => e.name === 'a')!.transform.y).toBe(200) // 위 여백 300 → 200(앞 섹션 없음)
    expect(out.elements.find((e) => e.name === 'marker')!.transform.y).toBe(0)
    expect(out.elements.find((e) => e.name === 'hidden')!.transform.y).toBe(0)
  })

  it('경계가 이미 200px 이하면 같은 객체를 돌려준다', () => {
    const sections = [
      section(ProSectionType.MAIN_CUT, 600, [content('a', 100, 400)]),
      section(ProSectionType.POINT_DIV, 600, [content('b', 100, 400)]),
    ]
    expect(applyMobileFloor(sections)).toEqual(sections)
    expect(applyMobileFloor(sections)[0]).toBe(sections[0])
  })
})

describe('worsensSectionMobile — 프리셋 적용 전후 섹션 단위 판정', () => {
  it('좁은 2열 본문이 생기면 true, 같거나 줄면 false', () => {
    const img = makeImageEl('img', 'https://x.test/a.png', 'main', 0, 0, 860, 300, 1)
    const single = section(ProSectionType.SOLUTION_GUIDE, 700, [img, text('body', 320, 45)])
    const twoCol = section(ProSectionType.SOLUTION_GUIDE, 700, [
      img,
      makeTextEl('l', '왼쪽 본문 문장', 'body', 60, 320, 340, '#1a1a1a', 'left', 3, { fontSize: 45, height: 70 }),
      makeTextEl('r', '오른쪽 본문 문장', 'body', 460, 320, 340, '#1a1a1a', 'left', 3, { fontSize: 45, height: 70 }),
    ])
    expect(worsensSectionMobile(single, twoCol)).toBe(true)
    expect(worsensSectionMobile(twoCol, single)).toBe(false)
    expect(worsensSectionMobile(single, single)).toBe(false)
  })
})

describe('별점 기호 색 — 비텍스트 3:1, 앰버 단계(2026-10-27 통합 결정)', () => {
  const star = (color: string, bg: string) =>
    section(
      ProSectionType.PERFORMANCE_REVIEWS,
      400,
      [
        makeTextEl('review_stars_0', '★★★★★', 'caption', 60, 100, 300, color, 'left', 3, {
          fontSize: 28,
          height: 40,
          allowBelowMin: true,
        }),
      ],
      { canvas: { width: 860, height: 400, backgroundColor: bg } }
    )

  it('흰 바탕 #FBBF24 → #D97706, 연회색 바탕 → #B45309(탁한 갈색으로 섞지 않는다)', () => {
    expect(textOf(applyMobileFloor([star('#FBBF24', '#FFFFFF')])[0], 'review_stars_0').color).toBe('#D97706')
    expect(textOf(applyMobileFloor([star('#FBBF24', '#F7F7F7')])[0], 'review_stars_0').color).toBe('#B45309')
    for (const bg of ['#FFFFFF', '#F7F7F7', '#FEF3C7']) {
      const fixed = parseColor(readableStarColor('#FBBF24', parseColor(bg)))!
      expect(contrastRatio(fixed, parseColor(bg)!), bg).toBeGreaterThanOrEqual(3)
    }
  })

  it('앰버 단계로 3:1이 안 되는 중간 톤 바탕은 섞지 않고 검정·흰색', () => {
    expect(readableStarColor('#FBBF24', parseColor('#8A8A8A'))).toBe('#000000')
    expect(readableStarColor('#FBBF24', parseColor('#9CA3AF'))).toBe('#000000')
  })

  it('이미 3:1을 넘는 별, 어두운 바탕의 별은 그대로', () => {
    expect(textOf(applyMobileFloor([star('#B45309', '#FFFFFF')])[0], 'review_stars_0').color).toBe('#B45309')
    expect(textOf(applyMobileFloor([star('#FBBF24', '#111111')])[0], 'review_stars_0').color).toBe('#FBBF24')
  })
})

describe('applyMobileFloor — R4 gutterFirst(경계 200 안 배분)', () => {
  const content = (name: string, y: number, h: number) =>
    makeImageEl(name, 'https://x.test/a.png', 'main', 0, y, 860, h, 1)

  it('거터 → 앞 섹션 아래 여백 → 다음 섹션 위 여백 순으로 덜어 위 여백(도입 호흡)을 남긴다', () => {
    const sections = [
      section(ProSectionType.MAIN_CUT, 640, [content('a', 140, 360)]),
      section(ProSectionType.DIVIDER, 40, []),
      section(ProSectionType.POINT_DIV, 640, [content('b', 140, 360)]),
    ]
    const out = applyMobileFloor(sections, { gutterFirst: true })
    expect(checkMobileReadability({ sections: out }).counts.M4).toBe(0)
    expect(out[1].canvas.height).toBe(0) // 거터 40
    expect(out[0].canvas.height).toBe(560) // 아래 여백 140 → 60
    expect(out[2].elements[0].transform.y).toBe(140) // 위 여백 그대로
    // 기본(Track S·mobile 기록 잡)은 반씩 — 위 여백 80
    expect(applyMobileFloor(sections)[2].elements[0].transform.y).toBe(80)
  })

  it('거터와 아래 여백으로 모자라면 나머지만 다음 섹션 위 여백에서 덜어 낸다', () => {
    const sections = [
      section(ProSectionType.MAIN_CUT, 640, [content('a', 140, 460)]), // 아래 여백 40
      section(ProSectionType.DIVIDER, 40, []),
      section(ProSectionType.POINT_DIV, 640, [content('b', 220, 300)]),
    ]
    const out = applyMobileFloor(sections, { gutterFirst: true }) // 40 + 40 + 220 − 200 = 100
    expect(out[1].canvas.height).toBe(0)
    expect(out[0].canvas.height).toBe(600)
    expect(out[2].elements[0].transform.y).toBe(200)
  })

  it('높이를 직접 정한 거터는 두고 여백에서 덜어 낸다', () => {
    const sections = [
      section(ProSectionType.MAIN_CUT, 640, [content('a', 140, 360)]),
      section(ProSectionType.DIVIDER, 40, [], { userAdjustedHeight: true }),
      section(ProSectionType.POINT_DIV, 640, [content('b', 140, 360)]),
    ]
    const out = applyMobileFloor(sections, { gutterFirst: true })
    expect(out[1]).toBe(sections[1])
    expect(out[0].canvas.height).toBe(520) // 120을 아래 여백에서
    expect(out[2].elements[0].transform.y).toBe(140)
  })
})
