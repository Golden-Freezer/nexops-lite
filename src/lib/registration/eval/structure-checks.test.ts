/**
 * 구조 자동 검사 — POINT 머리 일치, 상품 정보 표 행 수. 요소는 시험용 가짜다.
 */

import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '../editor/types/canvas'
import { ProSectionType as S } from '../editor/types/section'
import type { PdpJobRow } from '../pdp-state'
import { INFO_ROWS_LIMIT, checkStructure, headSignature } from './structure-checks'

const el = (name: string, type: CanvasElement['type'], x: number, y: number, over: Partial<CanvasElement> = {}): CanvasElement =>
  ({ id: name, name, type, transform: { x, y, width: 200, height: 60, rotation: 0 }, zIndex: 0, isLocked: false, isVisible: true, opacity: 1, ...over }) as CanvasElement

const text = (name: string, x: number, y: number, typoLevel: 'h1' | 'h2' | 'body') => el(name, 'text', x, y, { textProps: { typoLevel } } as Partial<CanvasElement>)

const section = (elements: CanvasElement[], over: Partial<CanvasSection> = {}): CanvasSection =>
  ({ id: 's', sectionType: S.POINT_DIV, groupType: 'modules', order: 0, isVisible: true, layoutId: 'designcut_T3a', canvas: { width: 860, height: 1700, backgroundColor: '#fff' }, elements, ...over }) as CanvasSection

const head = (photoY: number, titleY = 200) => [el('cap', 'shape', 60, 120), text('num', 60, titleY, 'h1'), text('title', 180, titleY, 'h2'), el('photo', 'framed-image', 0, photoY)]
const job = (sections: unknown[] = []) => ({ section_plan: { designcut: { sections } } }) as unknown as PdpJobRow

describe('첫 화면 글의 양', () => {
  const box = (content: string, over: Partial<CanvasElement> = {}) => el(content, 'text', 60, 100, { textProps: { content, typoLevel: 'body' }, ...over } as Partial<CanvasElement>)

  it('첫 섹션의 보이는 글 상자 수와 공백 뺀 글자 수 — 태그는 빼고, 숨긴 글·사진·뒤 섹션은 세지 않는다', () => {
    const first = section([box('엉킨 머리에\n유연한 빗살'), box('<span style="color:red">아침</span> 빗질'), box('숨긴 글', { isVisible: false }), el('photo', 'framed-image', 0, 300)])
    expect(checkStructure(job(), [first, section([box('다른 섹션')])]).hookText).toEqual({ blocks: 2, chars: 14 })
  })

  it('섹션이 없으면 null, 글이 없으면 0', () => {
    expect(checkStructure(job(), []).hookText).toBeNull()
    expect(checkStructure(job(), [section([el('photo', 'framed-image', 0, 0)])]).hookText).toEqual({ blocks: 0, chars: 0 })
  })
})

describe('POINT 머리 일치', () => {
  it('머리가 같으면 사진 자리가 달라도 일치다 — 제목 줄 수로 세로 자리가 달라도 된다', () => {
    const r = checkStructure(job(), [section(head(500)), section(head(700, 220)), section(head(600))])
    expect(r.pointHeads.count).toBe(3)
    expect(r.pointHeads.consistent).toBe(true)
    expect(new Set(r.pointHeads.signatures).size).toBe(1)
  })

  it('한 POINT만 머리가 다르면 불일치다(예전 grid 번호 타일)', () => {
    const grid = [el('cap', 'shape', 60, 120), el('tile', 'shape', 60, 200), text('num', 60, 210, 'h1'), text('title', 200, 210, 'h2'), el('photo', 'framed-image', 0, 500)]
    const r = checkStructure(job(), [section(head(500)), section(head(500)), section(grid)])
    expect(r.pointHeads.consistent).toBe(false)
  })

  it('가로 자리나 글자 수준이 달라도 불일치다', () => {
    const moved = [el('cap', 'shape', 60, 120), text('num', 60, 200, 'h1'), text('title', 240, 200, 'h2'), el('photo', 'framed-image', 0, 500)]
    expect(checkStructure(job(), [section(head(500)), section(moved)]).pointHeads.consistent).toBe(false)
    const level = [el('cap', 'shape', 60, 120), text('num', 60, 200, 'h1'), text('title', 180, 200, 'h1'), el('photo', 'framed-image', 0, 500)]
    expect(checkStructure(job(), [section(head(500)), section(level)]).pointHeads.consistent).toBe(false)
  })

  it('사진 아래 글, 전면 바탕, 풀폭 띠는 머리에 넣지 않는다', () => {
    const base = section(head(500))
    const wide = (name: string, height: number) => el(name, 'shape', 0, 0, { transform: { x: 0, y: 0, width: 860, height, rotation: 0 } })
    const plus = section([wide('bg', 1700), wide('band', 480), ...head(500), text('below', 60, 900, 'body')])
    expect(headSignature(plus)).toBe(headSignature(base))
  })

  it('큰 POINT가 하나 이하면 판정하지 않고, 디자인 컷이 아닌 섹션은 세지 않는다', () => {
    expect(checkStructure(job(), [section(head(500))]).pointHeads).toMatchObject({ count: 1, consistent: null })
    expect(checkStructure(job(), [section(head(500), { layoutId: 'point_layout_01' })]).pointHeads.count).toBe(0)
  })

  it('큰 POINT만 센다 — 추가 컷·자세히 보기는 섹션 종류가 같아도 빼고, K point_div는 넣는다', () => {
    const others = [section(head(500), { layoutId: 'designcut_T10' }), section(head(500), { layoutId: 'designcut_T11' }), section(head(500), { layoutId: 'designcut_k_review.big-quote' })]
    expect(checkStructure(job(), others).pointHeads.count).toBe(0)
    const k = section(head(500), { layoutId: 'designcut_k_point_div.offset-plate' })
    expect(checkStructure(job(), [k, section(head(600))]).pointHeads).toMatchObject({ count: 2, consistent: true })
  })
})

describe('상품 정보 표', () => {
  const rows = (labels: string[]) => ({ key: 'long:info', modules: [{ type: 'M9', data: { rows: labels.map((label) => ({ label, value: 'x' })) } }] })
  const REQUIRED = ['상품명', '브랜드', '색상/수량', '사이즈', '소재', '원산지', '사용연령']

  it('필수 7행과 허용된 특별한 내용은 문제가 없다', () => {
    expect(checkStructure(job([rows([...REQUIRED, '구성', '용량'])]), []).infoTable).toEqual({ rows: 9, limit: INFO_ROWS_LIMIT, overLimit: false, unknownLabels: [] })
  })

  it('허용 밖 행 이름을 낸다(R13 표)', () => {
    const r = checkStructure(job([rows([...REQUIRED, '방수', '기능', '휴대', '구조'])]), []).infoTable!
    expect(r.rows).toBe(11)
    expect(r.overLimit).toBe(true)
    expect(r.unknownLabels).toEqual(['방수', '기능', '휴대', '구조'])
  })

  it('K 슬롯 표도 읽는다', () => {
    const k = { key: 'spec_table', modules: [], templateRef: { id: 'spec_table.line-rows', version: 1, slots: { rows: REQUIRED.map((label) => ({ label, value: 'x' })), special: [{ label: '방수', value: 'x' }] } } }
    expect(checkStructure(job([k]), []).infoTable).toMatchObject({ rows: 8, unknownLabels: ['방수'] })
  })

  it('표가 없으면 null이다', () => {
    expect(checkStructure(job([{ key: 'cta', modules: [] }]), []).infoTable).toBeNull()
    expect(checkStructure({ section_plan: {} } as unknown as PdpJobRow, []).infoTable).toBeNull()
  })
})

describe('사이즈·상품 정보의 자리(기록만)', () => {
  const layout = (layoutId: string) => section([], { layoutId })
  const tail = (layouts: string[], plan: unknown[] = []) => checkStructure(job(plan), layouts.map(layout)).pageTail

  it('K 표가 맨 끝이면 지킨 것이고, 마무리가 표 뒤면 어긴 것이다', () => {
    expect(tail(['designcut_k_hook_3step.a', 'designcut_k_cta.a', 'designcut_k_spec_table.a'])).toEqual({ total: 3, purchaseFromEnd: [], sizeFromEnd: [], infoFromEnd: [0], ok: true })
    expect(tail(['designcut_k_hook_3step.a', 'designcut_k_spec_table.a', 'designcut_k_cta.a'])).toEqual({ total: 3, purchaseFromEnd: [], sizeFromEnd: [], infoFromEnd: [1], ok: false })
  })

  it('사이즈 → 표면 지킨 것이고, 순서가 바뀌거나 사이에 다른 섹션이 있으면 어긴 것이다', () => {
    const info = 'designcut_k_spec_table.a'
    expect(tail(['designcut_T1', 'designcut_T6', info])).toEqual({ total: 3, purchaseFromEnd: [], sizeFromEnd: [1], infoFromEnd: [0], ok: true })
    expect(tail(['designcut_T1', info, 'designcut_T6']).ok).toBe(false)
    expect(tail(['designcut_T6', 'designcut_T8', info]).ok).toBe(false)
  })

  it('표가 없고 사이즈만 있으면 사이즈가 맨 끝이어야 한다, 둘 다 없으면 판정하지 않는다', () => {
    expect(tail(['designcut_T1', 'designcut_T6']).ok).toBe(true)
    expect(tail(['designcut_T6', 'designcut_T8']).ok).toBe(false)
    expect(tail(['designcut_T1', 'designcut_T8'])).toEqual({ total: 2, purchaseFromEnd: [], sizeFromEnd: [], infoFromEnd: [], ok: null })
  })

  it('구매 전 확인 표는 끝 두 자리 바로 앞에만 올 수 있다 — K', () => {
    expect(tail(['designcut_T1', 'designcut_purchase', 'designcut_k_spec_table.a'])).toEqual({ total: 3, purchaseFromEnd: [1], sizeFromEnd: [], infoFromEnd: [0], ok: true })
    expect(tail(['designcut_purchase', 'designcut_T8', 'designcut_k_spec_table.a']).ok).toBe(false)
    expect(tail(['designcut_T1', 'designcut_k_spec_table.a', 'designcut_purchase']).ok).toBe(false)
  })

  it('구매 전 확인 표 자리 — D: 구매 전 확인 → 사이즈 → 상품 정보만 지킨 것이다', () => {
    const plan = [{ key: 'long:info', template: 'T9', modules: [] }]
    const [purchase, size, info] = ['designcut_purchase', 'designcut_T6', 'designcut_T9']
    expect(tail(['designcut_T1', purchase, size, info], plan)).toEqual({ total: 4, purchaseFromEnd: [2], sizeFromEnd: [1], infoFromEnd: [0], ok: true })
    // 사이즈가 끝 두 자리를 벗어난다(오너 지시 위반)
    expect(tail(['designcut_T1', size, purchase, info], plan).ok).toBe(false)
    expect(tail(['designcut_T1', size, info, purchase], plan).ok).toBe(false)
  })

  it('구매 전 확인 표만 있으면 판정하지 않고, 사이즈만 있으면 그 바로 앞이다', () => {
    expect(tail(['designcut_T1', 'designcut_purchase', 'designcut_T8']).ok).toBeNull()
    expect(tail(['designcut_T1', 'designcut_purchase', 'designcut_T6']).ok).toBe(true)
    expect(tail(['designcut_T1', 'designcut_T6', 'designcut_purchase']).ok).toBe(false)
  })

  it('소재·원산지 표(long:material)는 상품 정보로 세지 않는다 — D2에 없는 예전 표다', () => {
    const plan = [
      { key: 'long:material', template: 'T9', modules: [] },
      { key: 'long:info', template: 'T9', modules: [] },
    ]
    expect(tail(['designcut_T9', 'designcut_T8', 'designcut_T9'], plan)).toEqual({ total: 3, purchaseFromEnd: [], sizeFromEnd: [], infoFromEnd: [0], ok: true })
    expect(tail(['designcut_T9', 'designcut_T8'], [{ key: 'long:material', template: 'T9', modules: [] }]).ok).toBeNull()
  })

  it('디자인 컷 표(T9)는 계획 키로 가른다 — 상품 정보 표만 센다', () => {
    const plan = [
      { key: 'long:faq', template: 'T9', modules: [] },
      { key: 'long:info', template: 'T9', modules: [] },
    ]
    expect(tail(['designcut_T1', 'designcut_T9', 'designcut_T8', 'designcut_T9'], plan)).toEqual({ total: 4, purchaseFromEnd: [], sizeFromEnd: [], infoFromEnd: [0], ok: true })
    expect(tail(['designcut_T1', 'designcut_T9', 'designcut_T9', 'designcut_T8'], plan).ok).toBe(false)
  })
})

describe('POINT 단추 색(기록만)', () => {
  const badge = (name: string, fill: string, y = 120, over: Partial<CanvasElement> = {}) =>
    el(name, 'shape', 60, y, { shapeProps: { fill, shapeType: 'roundedRect' }, ...over } as unknown as Partial<CanvasElement>)
  const point = (elements: CanvasElement[], layoutId = 'designcut_T3a') => section(elements, { layoutId })

  it('색이 모두 같으면 같다 — 대소문자는 가리지 않는다', () => {
    const r = checkStructure(job(), [point([badge('designcut-chapter-bg', '#2B6CD9')]), point([badge('designcut-chapter-bg', '#2b6cd9')])]).pointBadges
    expect(r).toEqual({ count: 2, same: true, colors: ['#2b6cd9', '#2b6cd9'] })
  })

  it('장마다 색이 다르면 다르다(스티커 색 교대)', () => {
    const r = checkStructure(job(), [point([badge('designcut-chapter-bg', '#ff0000')]), point([badge('designcut-chapter-bg', '#00ff00')])]).pointBadges
    expect(r.same).toBe(false)
    expect(r.colors).toEqual(['#ff0000', '#00ff00'])
  })

  it('K POINT 캡슐도 잰다, 한 섹션에 캡슐이 여럿이면 맨 위 것이다', () => {
    const k = 'designcut_k_point_div.a'
    const r = checkStructure(job(), [point([badge('designcut-capsule-bg', '#111111', 500), badge('designcut-capsule-bg', '#222222', 100)], k), point([badge('designcut-capsule-bg', '#222222')], k)]).pointBadges
    expect(r).toEqual({ count: 2, same: true, colors: ['#222222', '#222222'] })
  })

  it('큰 POINT 밖 캡슐과 숨긴 캡슐은 세지 않고, 테두리만 있으면 테두리 색이다', () => {
    const outline = el('designcut-capsule-bg', 'shape', 60, 120, { shapeProps: { fill: 'transparent', stroke: '#ABCDEF' } } as unknown as Partial<CanvasElement>)
    const hidden = badge('designcut-chapter-bg', '#000000', 120, { isVisible: false })
    const r = checkStructure(job(), [section([badge('designcut-capsule-bg', '#999999')], { layoutId: 'designcut_k_cta.a' }), point([hidden]), point([outline], 'designcut_k_point_div.a')]).pointBadges
    expect(r).toEqual({ count: 1, same: null, colors: ['#abcdef'] })
  })
})

describe('계획 지표 무대(적용 D4 ⓐ)', () => {
  it('디자인 컷 잡의 무대 기록(designcut_stages)을 계획 지표에 넘겨 최다 무대를 낸다 — 기록이 없으면 null', () => {
    const plan = { order: ['hook', 'point_div:0'], sections: [{ key: 'hook', role: 'hook', bg: 'W', productImageKey: 'hero', modules: [] }, { key: 'point_div:0', role: 'usp_feature', bg: 'W', productImageKey: 'features:0', modules: [] }] }
    const withStages = { section_plan: { designcut: plan, designcut_stages: { hero: 'life', 'features:0': 'macro' } } } as unknown as PdpJobRow
    const drawn = [section([]), section([])]
    expect(checkStructure(withStages, drawn).plan?.shots.topStageShare).toBe(0.5)
    expect(checkStructure({ section_plan: { designcut: plan } } as unknown as PdpJobRow, drawn).plan?.shots.topStageShare).toBeNull()
  })
})
