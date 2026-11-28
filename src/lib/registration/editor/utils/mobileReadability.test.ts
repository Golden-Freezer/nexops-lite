import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '../types/canvas'
import { ProSectionType } from '../types/section'
import { backdropBehindText, blendOver, checkMobileReadability, contrastRatio, parseColor } from './mobileReadability'
import { makeImageEl, makeShapeEl, makeTextEl } from './sectionConverter/elements'

let seq = 0
function section(type: string, height: number, elements: CanvasElement[], backgroundColor = '#ffffff'): CanvasSection {
  seq++
  return {
    id: `s${seq}`,
    sectionType: type as ProSectionType,
    groupType: 'usp',
    order: seq,
    isVisible: true,
    layoutId: `${type}_layout_01`,
    canvas: { width: 860, height, backgroundColor },
    elements,
  }
}
const text = (
  name: string,
  y: number,
  opts: {
    size?: number
    level?: 'h2' | 'body' | 'caption'
    color?: string
    x?: number
    width?: number
    content?: string
    z?: number
  } = {}
) =>
  makeTextEl(
    name,
    opts.content ?? '읽기 쉬운 문장',
    opts.level ?? 'body',
    opts.x ?? 60,
    y,
    opts.width ?? 740,
    opts.color ?? '#1a1a1a',
    'left',
    opts.z ?? 3,
    {
      fontSize: opts.size ?? 45,
      height: 70,
      allowBelowMin: true,
    }
  )
const image = (name: string, y: number, height = 600, width = 860, x = 0) =>
  makeImageEl(name, 'https://x.test/a.png', 'main', x, y, width, height, 1)
const rules = (doc: CanvasSection[]) =>
  checkMobileReadability({ sections: doc }).violations.map((v) => `${v.rule}:${v.element ?? v.section}`)

describe('색 계산', () => {
  it('WCAG 대비 — 흑백 21, 같은 색 1', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5)
    expect(contrastRatio([120, 120, 120], [120, 120, 120])).toBe(1)
  })

  it('blendOver — 반투명 채움은 아래 색과 합성, transparent는 아래 색', () => {
    expect(blendOver('rgba(0, 0, 0, 0.5)', [255, 255, 255])).toEqual([128, 128, 128])
    expect(blendOver('#00000080', [255, 255, 255])).toEqual([127, 127, 127])
    expect(blendOver('transparent', [10, 20, 30])).toEqual([10, 20, 30])
    expect(blendOver('rgba(0,0,0,0.5)', null)).toBeNull()
    expect(blendOver('#123456', null)).toEqual([18, 52, 86])
  })

  it('parseColor — hex·rgb는 읽고 반투명·그라데이션은 판정하지 않는다', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255])
    expect(parseColor('#1A1A1A')).toEqual([26, 26, 26])
    expect(parseColor('rgb(10, 20, 30)')).toEqual([10, 20, 30])
    expect(parseColor('rgba(0,0,0,0.5)')).toBeNull()
    expect(parseColor('#00000080')).toBeNull()
    expect(parseColor('linear-gradient(#000, #fff)')).toBeNull()
  })
})

describe('checkMobileReadability M1~M8', () => {
  it('M1 — 위계별 하한, footer 24 허용, 장식 라벨 32', () => {
    const doc = [
      section(ProSectionType.SPEC_TABLE, 800, [
        image('img', 0, 300),
        text('body_small', 320, { size: 38 }),
        text('footer_notice', 420, { size: 24, level: 'caption' }),
        text('annotation-label-0', 520, { size: 30, level: 'caption', content: '접착력' }),
        text('annotation-label-1', 620, { size: 32, level: 'caption', content: '방수' }),
      ]),
    ]
    const m1 = rules(doc).filter((r) => r.startsWith('M1'))
    expect(m1).toEqual(['M1:body_small', 'M1:annotation-label-0'])
  })

  it('M2 — 본문 4.5·60px 제목 3, 사진 위 글자는 띠가 있어야 한다', () => {
    const doc = [
      section(ProSectionType.SPEC_TABLE, 1200, [
        image('img', 0, 300),
        text('grey_body', 320, { color: '#949494' }),
        text('grey_title', 420, { color: '#949494', size: 60, level: 'h2' }),
        image('photo', 600, 300),
        text('on_photo', 650, { z: 3 }),
        makeShapeEl('band', 'rect', 0, 860, 860, 120, { fill: '#000000' }, 2),
        image('photo2', 840, 200),
        text('on_band', 880, { color: '#ffffff', z: 4 }),
      ]),
    ]
    const m2 = rules(doc).filter((r) => r.startsWith('M2'))
    expect(m2).toEqual(['M2:grey_body', 'M2:on_photo'])
  })

  it('M2 바탕 — 감싼 반투명 도형은 섹션 바탕에 합성해 판정, 사진 위 띠는 띠 색으로', () => {
    const tinted = section(ProSectionType.SPEC_TABLE, 600, [
      makeShapeEl('cell', 'roundedRect', 40, 300, 780, 120, { fill: 'rgba(214, 51, 132, 0.04)' }, 2),
      text('pale_in_cell', 320, { color: '#aaaaaa' }),
    ])
    expect(backdropBehindText(tinted.elements[1], tinted)).toEqual([253, 247, 250])
    expect(
      rules([
        section(ProSectionType.MAIN_CUT, 300, [text('h', 0, { level: 'h2', size: 60 }), image('i', 80, 200)]),
        tinted,
      ]).filter((r) => r.startsWith('M2'))
    ).toEqual(['M2:pale_in_cell'])
    const banded = section(ProSectionType.CTA, 700, [
      image('bg', 0, 700),
      makeShapeEl('scrim', 'rect', 0, 160, 860, 300, { fill: 'rgba(17, 17, 17, 0.82)' }, 2),
      text('white', 200, { color: '#ffffff' }),
    ])
    expect(backdropBehindText(banded.elements[2], banded)).toBeNull() // 사진 위 반투명 띠 — 합성색 판정 불가(띠로 충족)
  })

  it('M2 바탕 — 짙은 띠 안 투명 행 상자 속 글은 띠 색으로 판정한다(K10). 투명 상자만 있으면 전과 같다', () => {
    const band = section(ProSectionType.SPEC_TABLE, 600, [
      makeShapeEl('band', 'rect', 0, 100, 860, 400, { fill: '#1f2a24' }, 1),
      makeShapeEl('designcut-row', 'rect', 60, 200, 740, 120, { fill: 'transparent' }, 2),
      text('white_in_row', 220, { color: '#ffffff' }),
    ])
    expect(backdropBehindText(band.elements[2], band)).toEqual([31, 42, 36])
    expect(rules([band]).filter((r) => r.startsWith('M2'))).toEqual([])
    const open = section(ProSectionType.SPEC_TABLE, 600, [
      makeShapeEl('designcut-row', 'rect', 60, 200, 740, 120, { fill: '#00000000' }, 2),
      text('dark_in_row', 220),
    ])
    expect(backdropBehindText(open.elements[1], open)).toEqual([255, 255, 255])
  })

  it('M3 — 첫 화면(1,860px)에 상품 이미지와 제목급 글자', () => {
    const empty = [section(ProSectionType.SPEC_TABLE, 2400, [text('only_body', 100), image('late', 1900, 400)])]
    expect(rules(empty).filter((r) => r.startsWith('M3'))).toHaveLength(2)
    const ok = [
      section(ProSectionType.MAIN_CUT, 1200, [text('title', 100, { level: 'h2', size: 60 }), image('hero', 200)]),
    ]
    expect(rules(ok).filter((r) => r.startsWith('M3'))).toEqual([])
  })

  it('M4 — 연속 빈 영역 200px 초과(섹션 경계를 넘어 잰다, 전면 배경 도형 제외)', () => {
    const backdrop = makeShapeEl('bg', 'rect', 0, 0, 860, 600, { fill: '#f5f5f5' }, 0)
    const doc = [
      section(ProSectionType.MAIN_CUT, 600, [
        backdrop,
        text('h', 0, { level: 'h2', size: 60 }),
        image('a', 100, 100),
        image('b', 400, 100),
      ]),
      section(ProSectionType.SPEC_TABLE, 400, [text('next', 150)]),
    ]
    const report = checkMobileReadability({ sections: doc })
    // 200~400(200 — 경계값은 통과), 500~750(250 — 섹션 경계를 넘음) → 1건 + 하단 820~1000(180) 통과
    expect(report.violations.filter((v) => v.rule === 'M4').map((v) => v.detail)).toEqual(['빈 영역 250px(500~750)'])
  })

  it('M4 — 장면 모드(D2) 문서의 디자인 컷 경계는 합 300까지, 경계로 나눈 섹션 안 몫은 각각 200까지(통합 결정 10-31)', () => {
    const as = (s: CanvasSection, layoutId: string) => ({ ...s, layoutId })
    // 디자인 컷 A(내용 0~700, 아래 여백 tail) → 디자인 컷 B(위 여백 head). 장면 모드 문서 = 장면 사진(designcut-scene)이 있다
    const doc = (scene: boolean, tail = 140, head = 140) => [
      as(section(ProSectionType.MAIN_CUT, 700 + tail, [text('h', 0, { level: 'h2', size: 60 }), image(scene ? 'designcut-scene' : 'photo', 70, 630)]), 'designcut_T1'),
      as(section(ProSectionType.SPEC_TABLE, head + 200, [text('next', head)]), 'designcut_T4'),
    ]
    const m4 = (d: CanvasSection[]) =>
      checkMobileReadability({ sections: d }).violations.filter((v) => v.rule === 'M4').map((v) => v.detail)
    expect(m4(doc(true))).toEqual([])
    // 장면 모드가 아니면 지금 기준(200)
    expect(m4(doc(false))).toEqual(['빈 영역 280px(700~980)'])
    // 경계 합 300 초과
    expect(m4(doc(true, 160, 160))).toEqual(['빈 영역 320px(700~1020)'])
    // 섹션 안 몫이 200 초과(사진이 빠진 빈 칸 등) — 합이 300 안이어도 위반
    expect(m4(doc(true, 220, 40))).toEqual(['빈 영역 260px(700~960)'])
    // 장면 모드 문서라도 디자인 컷이 끼지 않은 경계(기존 섹션끼리)는 200
    const kept = [
      as(section(ProSectionType.MAIN_CUT, 700, [text('h', 0, { level: 'h2', size: 60 }), image('designcut-scene', 70, 630)]), 'designcut_T1'),
      section(ProSectionType.SPEC_TABLE, 210, [text('a', 0)]),
      section(ProSectionType.CTA, 340, [text('b', 140)]),
    ]
    expect(m4(kept)).toEqual(['빈 영역 280px(770~1050)'])
  })

  it('M5 — 상품 컷 높이·원형 확대·번호 배지·지시선·라벨 길이', () => {
    const doc = [
      section(ProSectionType.POINT_DIV, 1400, [
        text('t', 0, { level: 'h2', size: 60 }),
        image('cut', 80, 400),
        makeShapeEl('annotation-zoom-0', 'circle', 100, 500, 200, 200, { stroke: '#000', strokeWidth: 4 }, 5),
        makeShapeEl('annotation-number-0', 'circle', 400, 500, 50, 50, { fill: '#000' }, 5),
        makeShapeEl('annotation-leader-0', 'line', 400, 800, 200, 2, { stroke: '#000', strokeWidth: 2 }, 5),
        text('annotation-label-0', 900, { size: 32, level: 'caption', content: '아주 긴 장식 라벨 문구입니다' }),
      ]),
    ]
    const m5 = rules(doc).filter((r) => r.startsWith('M5'))
    expect(m5).toEqual([
      'M5:cut',
      'M5:annotation-zoom-0',
      'M5:annotation-number-0',
      'M5:annotation-leader-0',
      'M5:annotation-label-0',
    ])
  })

  it('M6 — 나란한 본문 열은 폭 380 이상·40자 이하', () => {
    const narrow = [
      section(ProSectionType.SPEC_TABLE, 600, [
        image('img', 0, 300),
        text('left', 320, { x: 60, width: 340 }),
        text('right', 320, { x: 460, width: 340 }),
      ]),
    ]
    expect(rules(narrow).filter((r) => r.startsWith('M6'))).toEqual(['M6:left', 'M6:right'])
    // 3자 이하 표식(번호·이니셜·기호)은 본문 열이 아니다
    const marks = [
      section(ProSectionType.POINT_DIV, 600, [
        image('img', 0, 300),
        text('num', 320, { x: 60, width: 64, content: '01' }),
        text('title', 320, { x: 140, width: 660, content: '나란한 제목' }),
      ]),
    ]
    expect(rules(marks).filter((r) => r.startsWith('M6'))).toEqual([])
    const wide = [
      section(ProSectionType.SPEC_TABLE, 600, [
        image('img', 0, 300),
        text('left', 320, { x: 0, width: 420 }),
        text('right', 320, { x: 440, width: 420 }),
      ]),
    ]
    expect(rules(wide).filter((r) => r.startsWith('M6'))).toEqual([])
  })

  it('M7 — 폰 한 화면 장식 3개 이하', () => {
    const marks = [0, 1, 2, 3].map((i) =>
      makeShapeEl(`annotation-number-${i}`, 'circle', 100 * i, 200 + i * 300, 64, 64, { fill: '#000' }, 5)
    )
    const doc = [
      section(ProSectionType.HIDDEN_PAGE, 2000, [
        text('h', 0, { level: 'h2', size: 60 }),
        image('i', 60, 600),
        ...marks,
      ]),
    ]
    expect(rules(doc).filter((r) => r.startsWith('M7'))).toEqual(['M7:annotation-number-0'])
  })

  it('M8 — 폰 화면 수와 대조군 대비 길이(20% 넘으면 경고)', () => {
    const doc = [section(ProSectionType.MAIN_CUT, 3720, [text('h', 0, { level: 'h2', size: 60 }), image('i', 80)])]
    expect(checkMobileReadability({ sections: doc }).phoneScreens).toBe(2)
    expect(checkMobileReadability({ sections: doc }, { baselineHeightPx: 3000 })).toMatchObject({
      lengthRatioToBaseline: 1.24,
      lengthWarning: '대조군보다 24% 길다(M8 경고)',
    })
    expect(checkMobileReadability({ sections: doc }, { baselineHeightPx: 3400 }).lengthWarning).toBeUndefined()
  })

  it('숨긴 섹션·숨긴 요소는 재지 않는다', () => {
    const hidden = { ...section(ProSectionType.SPEC_TABLE, 600, [text('small', 0, { size: 20 })]), isVisible: false }
    const hiddenEl = { ...text('hidden_small', 300, { size: 20 }), isVisible: false }
    const doc = [
      section(ProSectionType.MAIN_CUT, 800, [text('h', 0, { level: 'h2', size: 60 }), image('i', 100), hiddenEl]),
      hidden,
    ]
    expect(rules(doc).filter((r) => r.startsWith('M1'))).toEqual([])
  })
})

describe('강조 장식(T4) 판정 — 배지 라벨·SVG 지시선·장식 묶음·별점 기호', () => {
  const badge = (
    name: string,
    content: string,
    opts: { size?: number; color?: string; fill?: string; group?: string; y?: number } = {}
  ) =>
    ({
      id: `${name}-${content}-${opts.y ?? 0}`,
      type: 'badge',
      name,
      transform: { x: 100, y: opts.y ?? 700, width: 300, height: 64, rotation: 0 },
      zIndex: 9,
      isLocked: false,
      isVisible: true,
      opacity: 1,
      ...(opts.group ? { groupId: opts.group } : {}),
      textProps: {
        content,
        fontFamily: 'Pretendard',
        fontSize: opts.size ?? 32,
        fontWeight: 800,
        fontStyle: 'normal',
        textDecoration: 'none',
        color: opts.color ?? '#111111',
        textAlign: 'center',
        lineHeight: 1.2,
        letterSpacing: 0,
      },
      shapeProps: { shapeType: 'roundedRect', fill: opts.fill ?? '#FFFFFF' },
    }) as CanvasElement
  const leader = (width: number, group?: string, y = 760) =>
    ({
      id: `leader-${width}-${y}`,
      type: 'svg',
      name: 'annotation-leader',
      transform: { x: 400, y, width: 200, height: 40, rotation: 0 },
      zIndex: 8,
      isLocked: false,
      isVisible: true,
      opacity: 1,
      ...(group ? { groupId: group } : {}),
      svgProps: { svgString: `<svg><line stroke-width="${width * 2}"/><line stroke-width="${width}"/></svg>` },
    }) as CanvasElement
  const base = () => [text('h', 0, { level: 'h2', size: 60 }), image('i', 80, 600)]

  it('장식 라벨 배지는 글자로 본다 — 32px 하한(M1)·자기 채움색 대비(M2)·12자(M5). 다른 배지는 그대로', () => {
    const doc = [
      section(ProSectionType.POINT_DIV, 1400, [
        ...base(),
        badge('annotation-label', '작은 글자', { size: 28 }),
        badge('annotation-label', '흰 바탕 흰 글자', { color: '#FFFFFF', y: 800 }),
        badge('annotation-label', '열세 글자를 넘는 장식 라벨', { y: 900 }),
        badge('sale-badge', 'SALE', { size: 20, y: 1000 }),
      ]),
    ]
    expect(rules(doc).filter((r) => /^M[125]:/.test(r) && r !== 'M5:i')).toEqual([
      'M1:annotation-label',
      'M2:annotation-label',
      'M5:annotation-label',
    ])
  })

  it('SVG 지시선 굵기는 가장 가는 stroke-width로 잰다', () => {
    const thin = [section(ProSectionType.POINT_DIV, 1400, [...base(), leader(2)])]
    const ok = [section(ProSectionType.POINT_DIV, 1400, [...base(), leader(4)])]
    expect(rules(thin).filter((r) => r.startsWith('M5:annotation'))).toEqual(['M5:annotation-leader'])
    expect(rules(ok).filter((r) => r.startsWith('M5:annotation'))).toEqual([])
  })

  it('M7은 장식 묶음(groupId) 수를 센다 — 라벨 + 지시선은 장식 1개', () => {
    const grouped = (n: number) =>
      Array.from({ length: n }, (_, i) => [
        badge('annotation-label', `라벨${i}`, { group: `g${i}`, y: 200 + i * 150 }),
        leader(4, `g${i}`, 260 + i * 150),
      ]).flat()
    const three = [section(ProSectionType.POINT_DIV, 1400, [...base(), ...grouped(3)])]
    const four = [section(ProSectionType.POINT_DIV, 1400, [...base(), ...grouped(4)])]
    expect(checkMobileReadability({ sections: three }).counts.M7).toBe(0)
    expect(checkMobileReadability({ sections: four }).counts.M7).toBe(1)
  })

  it('별점 기호(★☆만)는 비텍스트 대비 3:1 — 흰 바탕 #D97706 통과, #FBBF24 미달', () => {
    const star = (color: string) =>
      section(ProSectionType.PERFORMANCE_REVIEWS, 400, [
        text('review_stars_0', 100, { size: 28, level: 'caption', color, content: '★★★★☆' }),
      ])
    expect(rules([star('#D97706')]).filter((r) => r.startsWith('M2'))).toEqual([])
    expect(rules([star('#FBBF24')]).filter((r) => r.startsWith('M2'))).toEqual(['M2:review_stars_0'])
    // 같은 색이라도 일반 글자는 4.5 기준
    const word = section(ProSectionType.PERFORMANCE_REVIEWS, 400, [
      text('t', 100, { size: 28, level: 'caption', color: '#D97706', content: '별점 4.8' }),
    ])
    expect(rules([word]).filter((r) => r.startsWith('M2'))).toEqual(['M2:t'])
  })
})
