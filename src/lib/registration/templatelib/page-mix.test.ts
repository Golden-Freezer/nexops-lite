/**
 * 페이지 구성 상한(적용 K12·K3, 최종 보고 개선 #4·#6·#14, T1-50) — 같은 뼈대 2회·이웃 금지, 비교·체크·말풍선·원·아치 틀 각 2곳, 첫·끝 자리 짙은 띠 후보 빼기.
 * 순서 풀이는 시험용 가짜 메타데이터에 흐름만 붙여 본다. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { conceptById } from './concepts'
import { TEMPLATES, templateById } from './library'
import { devicesOf, pageMix, skeletonOf, type PageDevice } from './page-mix'
import { candidatesFor, type SelectionProfile } from './selection'
import { one, tpl, type TplOptions } from './selection.fixture'
import { DEVICE_MAX, SKELETON_MAX, solveOrder } from './selection-order'
import type { TemplateMeta } from './template-meta'
import type { FlowNode } from './template-types'

const concept = conceptById('clean-trust')!
const textFlow = (token: 'H1' | 'H2'): FlowNode[] => [{ kind: 'text', slot: 'headline', token }]
/** 시험용 말풍선 — 카드 색 C면 기존 카드 상한(bandFits)이 먼저 막으므로 N으로 둔다 */
const BUBBLE: FlowNode[] = [{ kind: 'panel', fill: 'N', radius: 'bubble', nodes: [{ kind: 'text', slot: 'body', token: 'BODY' }] }]
/** 시험용 원·아치 틀 사진 */
const FRAMED = (frame: 'circle' | 'arch'): FlowNode[] => [{ kind: 'image', slot: 'photo', frame }]
const DARK_BAND: FlowNode[] = [{ kind: 'panel', fill: 'D', bleed: true, nodes: [{ kind: 'text', slot: 'headline', token: 'H1' }] }]
const withFlow = (id: string, flow: FlowNode[], opts: Partial<TplOptions> = {}): TemplateMeta => ({ ...tpl(id, opts), flow })
const meta = (id: string) => templateById(id) as unknown as TemplateMeta

describe('페이지 구성 지표', () => {
  it('부품을 흐름에서 읽는다 — 말풍선은 bubble 판, 체크는 체크·엑스 표식, 비교는 비교 섹션', () => {
    expect([...devicesOf(meta('faq.bubbles'))]).toEqual(['bubble'])
    expect(devicesOf(meta('cta.check-list')).has('check')).toBe(true)
    expect(devicesOf(meta('compare.grid-proof')).has('compare')).toBe(true)
    expect(devicesOf(meta('faq.center-rule')).size).toBe(0)
  })

  it('원·아치 틀은 사진 칸 수가 아니라 섹션으로 센다 — 원 셋 목록도 한 곳이고, 풀폭·꾸밈 사진은 아니다', () => {
    expect([...devicesOf(meta('point_list_div.circle-trio'))]).toContain('frame')
    expect([...devicesOf(meta('sub_div.arch-pair'))]).toContain('frame')
    expect(pageMix([meta('point_list_div.circle-trio')]).devices.frame).toBe(1)
    expect(devicesOf(withFlow('sub_div.plain', [{ kind: 'image', slot: 'photo', bleed: true }])).has('frame')).toBe(false)
    expect(devicesOf(withFlow('sub_div.decor', [{ kind: 'image', slot: 'photo', frame: 'decor' }])).has('frame')).toBe(false)
  })

  it('라이브러리 부품 수 — 말풍선 22(K7-c 고민 말풍선 3 칸 더함)·체크 30(household·stationery·pet·digital 비교 체크 칸 더함 — packaging 비교 체크 칸은 P02 faq 빠짐으로 뺌)·원·아치 틀 16(household 원·아치 3칸 더함, J51b 원형 사진 + 누적 판매 1칸 더함)·비교는 비교 섹션 전부와 비교 이름표', () => {
    const count = (d: PageDevice) => TEMPLATES.filter((t) => devicesOf(t as unknown as TemplateMeta).has(d)).length
    expect(count('bubble')).toBe(22)
    expect(count('check')).toBe(30)
    expect(count('frame')).toBe(16)
    expect(count('compare')).toBeGreaterThanOrEqual(TEMPLATES.filter((t) => t.section === 'compare').length)
  })

  it('뼈대는 큰 POINT와 흐름 없는 메타데이터를 세지 않는다', () => {
    expect(skeletonOf(meta('point_div.arch-photo'))).toBeNull()
    expect(skeletonOf(tpl('sub_div.a'))).toBeNull()
    expect(skeletonOf(withFlow('sub_div.a', textFlow('H1')))).toBe(skeletonOf(withFlow('cta.a', textFlow('H1'))))
  })

  it('한 페이지의 같은 뼈대 횟수·반복·이웃과 부품 수를 센다', () => {
    const mix = pageMix([withFlow('a.1', textFlow('H1')), withFlow('b.1', textFlow('H1')), withFlow('c.1', BUBBLE), withFlow('d.1', textFlow('H1')), withFlow('e.1', BUBBLE)])
    expect(mix).toEqual({ skeletonMax: 3, skeletonRepeats: 3, skeletonAdjacent: 1, devices: { compare: 0, check: 0, bubble: 2, frame: 0 } })
  })
})

describe('순서 풀이 — 같은 뼈대·부품 상한', () => {
  it(`같은 뼈대는 ${SKELETON_MAX}번까지다 — 셋째는 다른 뼈대 후보로 넘어간다`, () => {
    const same = (id: string) => withFlow(id, textFlow('H1'))
    const { sections, issues } = solveOrder(
      [one('a', same('a.1')), one('b', withFlow('b.1', textFlow('H2'))), one('c', same('c.1')), one('d', withFlow('d.1', BUBBLE)), one('e', same('e.1'), withFlow('e.2', textFlow('H2')))],
      concept
    )
    expect(issues).toEqual([])
    expect(sections.map((s) => s.templateId)).toEqual(['a.1', 'b.1', 'c.1', 'd.1', 'e.2'])
    expect(sections[4].fallbackFrom).toBe('e.1')
  })

  it('같은 뼈대끼리 이웃하지 않는다', () => {
    const { sections } = solveOrder([one('a', withFlow('a.1', textFlow('H1'))), one('b', withFlow('b.1', textFlow('H1')), withFlow('b.2', textFlow('H2')))], concept)
    expect(sections.map((s) => s.templateId)).toEqual(['a.1', 'b.2'])
  })

  it(`말풍선은 페이지에 ${DEVICE_MAX}곳까지다 — 셋째는 말풍선 없는 후보로 넘어간다(뼈대는 셋 다 다르다)`, () => {
    const bubble = (id: string, token: 'H1' | 'H2' | 'BODY') => withFlow(id, [{ kind: 'panel', fill: 'N', radius: 'bubble', nodes: [{ kind: 'text', slot: 'body', token }] }])
    const plain = (id: string) => withFlow(id, textFlow('H2'))
    const { sections } = solveOrder(
      [one('a', bubble('a.1', 'BODY')), one('b', plain('b.1')), one('c', bubble('c.1', 'H1')), one('d', withFlow('d.1', textFlow('H1'))), one('e', bubble('e.1', 'H2'), plain('e.2'))],
      concept
    )
    expect(sections.map((s) => s.templateId)).toEqual(['a.1', 'b.1', 'c.1', 'd.1', 'e.2'])
  })

  it(`원·아치 틀도 페이지에 ${DEVICE_MAX}곳까지다 — 셋째는 틀 없는 후보로 넘어간다(T1-50 사진 모양 상한)`, () => {
    const { sections } = solveOrder(
      [one('a', withFlow('a.1', FRAMED('circle'))), one('b', withFlow('b.1', textFlow('H1'))), one('c', withFlow('c.1', FRAMED('arch'))), one('d', withFlow('d.1', FRAMED('circle')), withFlow('d.2', textFlow('H2')))],
      concept
    )
    expect(sections.map((s) => s.templateId)).toEqual(['a.1', 'b.1', 'c.1', 'd.2'])
    expect(sections[3].fallbackFrom).toBe('d.1')
  })

  it('지킬 후보가 없으면 구성에서 고른 섹션은 빼지 않고 상한 없이 놓는다(필수 마무리가 빠지지 않게)', () => {
    const bubble = (id: string, opts: Partial<TplOptions> = {}) => withFlow(id, BUBBLE, opts)
    const { sections, issues } = solveOrder(
      [one('a', bubble('a.1')), one('b', withFlow('b.1', textFlow('H1'))), one('c', bubble('c.1')), one('cta', bubble('cta.1', { zone: 'decision' }))],
      concept
    )
    expect(issues).toEqual([])
    expect(sections.map((s) => s.templateId)).toEqual(['a.1', 'b.1', 'c.1', 'cta.1'])
  })

  it('코드가 더하는 채움은 상한을 넘기면 더하지 않는다', () => {
    const bubble = (id: string) => withFlow(id, BUBBLE, { height: 1500 })
    const { sections } = solveOrder([one('a', bubble('a.1')), one('b', withFlow('b.1', textFlow('H1'))), one('c', bubble('c.1'))], concept, {
      fillers: [one('petit_div', withFlow('petit_div.bubble', BUBBLE, { height: 1500 }))],
    })
    expect(sections.some((s) => s.filler)).toBe(false)
  })

  describe('큰 POINT — 같은 머리에서 나오므로 뼈대는 막지 않고 부품은 막는다(K3)', () => {
    const point = (id: string, flow: FlowNode[], head = 'h') => withFlow(id, flow, { head, section: 'point_div' })

    it('첫 화면·메인 컷 말풍선 뒤 말풍선 POINT는 말풍선 없는 후보로 넘어가고, 둘째·셋째 POINT는 그 머리를 따른다(P08 candy-pop 원인)', () => {
      const bubble = (id: string, token: 'H1' | 'BODY') => withFlow(id, [{ kind: 'panel', fill: 'N', radius: 'bubble', nodes: [{ kind: 'text', slot: 'body', token }] }])
      const { sections } = solveOrder(
        [
          one('hook_3step', bubble('hook_3step.1', 'BODY')),
          one('main_cut', bubble('main_cut.1', 'H1')),
          one('point_div', point('point_div.bubble', BUBBLE, 'x'), point('point_div.plain', textFlow('H2'))),
          one('point_div', point('point_div.bubble', BUBBLE, 'x'), point('point_div.plain', textFlow('H2'))),
        ],
        concept
      )
      expect(sections.map((s) => s.templateId)).toEqual(['hook_3step.1', 'main_cut.1', 'point_div.plain', 'point_div.plain'])
    })

    it('말풍선 POINT 둘 뒤 셋째는 같은 머리의 말풍선 없는 후보를 쓴다', () => {
      const { sections } = solveOrder(
        [
          one('point_div', point('point_div.a', BUBBLE)),
          one('point_div', point('point_div.b', BUBBLE)),
          one('point_div', point('point_div.c', BUBBLE), point('point_div.d', textFlow('H2'))),
        ],
        concept
      )
      expect(sections.map((s) => s.templateId)).toEqual(['point_div.a', 'point_div.b', 'point_div.d'])
    })

    it('같은 흐름(같은 뼈대) POINT 셋은 막지 않는다', () => {
      const { sections } = solveOrder([0, 1, 2].map(() => one('point_div', point('point_div.same', textFlow('H1')))), concept)
      expect(sections.map((s) => s.templateId)).toEqual(['point_div.same', 'point_div.same', 'point_div.same'])
    })

    it('같은 머리에 지킬 후보가 없으면 고른 POINT를 그대로 쓴다 — 머리가 달라지지 않는다', () => {
      const { sections } = solveOrder(
        [
          one('point_div', point('point_div.a', BUBBLE)),
          one('point_div', point('point_div.b', BUBBLE)),
          one('point_div', point('point_div.c', BUBBLE), point('point_div.other', textFlow('H2'), 'other-head')),
        ],
        concept
      )
      expect(sections.map((s) => s.templateId)).toEqual(['point_div.a', 'point_div.b', 'point_div.c'])
    })
  })
})

describe('#14 — 놓일 수 없는 후보 빼기', () => {
  const profile: SelectionProfile = { key: 'P02', categoryKey: 'household', photoCount: 4, productHex: null, evidence: new Set(['review']) }

  it('첫 화면·상품 정보 표의 짙은 풀폭 띠는 후보에 없다 — 그 자리에 짙은 띠를 두지 않아 늘 다음 후보로 넘어갔다', () => {
    for (const section of ['hook_3step', 'spec_table']) {
      const list = [withFlow(`${section}.dark`, DARK_BAND), withFlow(`${section}.plain`, textFlow('H1'))]
      expect(candidatesFor(section, list, profile, concept).map((t) => t.id)).toEqual([`${section}.plain`])
    }
    const middle = [withFlow('sub_div.dark', DARK_BAND), withFlow('sub_div.plain', textFlow('H1'))]
    expect(candidatesFor('sub_div', middle, profile, concept).map((t) => t.id).sort()).toEqual(['sub_div.dark', 'sub_div.plain'])
  })

  it('실제 라이브러리 — spec_table.dark-band는 늘, hook_3step.dark-band는 dark 리듬이 아니면 후보에 뜨지 않는다(K9 후보 2: dark는 첫 화면 짙은 띠 허용)', () => {
    const library = TEMPLATES as unknown as TemplateMeta[]
    const rich: SelectionProfile = { ...profile, photoCount: 6, evidence: new Set(['review', 'rating', 'certification', 'offer', 'faq', 'size', 'option', 'quantity']) }
    for (const c of ['clean-trust', 'dark-performance', 'pro-navy']) {
      const concept = conceptById(c)!
      const ids = ['hook_3step', 'spec_table'].flatMap((s) => candidatesFor(s, library, rich, concept, Number.POSITIVE_INFINITY).map((t) => t.id))
      expect(ids.includes('hook_3step.dark-band'), c).toBe(concept.rhythm === 'dark')
      expect(ids).not.toContain('spec_table.dark-band')
    }
  })
})
