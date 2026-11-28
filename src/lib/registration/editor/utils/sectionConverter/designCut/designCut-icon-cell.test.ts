/**
 * 적용 T1-60·T2-11·T2-56·A6-D2·T2-54 D(아이콘 칸) — 자세히 보기(T11) 항목 3~6개가 모두 K 아이콘 사전 이름(icon)과 이름 한 줄만 가질 때
 * 3열 아이콘 칸으로 그린다. icon은 선택 칸이고 사전 밖 이름은 버린다. icon이 없는 문서는 예전과 같은 값·같은 그림이다.
 * 지금 카피는 icon을 고르지 않아 저장 문서는 해당 0(V2 과제) — 픽스처로만 본다.
 */

import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { TABLE_NAME_ELEMENT, checkMobileReadability, contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { exportRenderHtml } from '@/lib/registration/editor/utils/exportUtils/htmlBuilders'
import { iconFragment } from '@/lib/registration/templatelib/icons'
import { composeDesignCut } from './compose'
import { readDesignCut } from './contract'
import { designCutPlanForB } from './designCut.fixture'
import { CONTENT_W, MARGIN } from './tokens'

const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight', season: 'spring', props: ['linen cloth'] },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
  corners: 'soft',
}
const IMAGES = { hero: 'https://img.test/hero.png', features: Array.from({ length: 6 }, (_, i) => `https://img.test/f${i}.png`) }
type Item = { title: string; description: string | null; imageKey: string | null; icon?: string }
const NAMES = ['방수 소재', '빠른 건조', '넉넉한 수납', '가벼운 휴대', '선물 포장', '세트 구성']
const ICONS = ['water', 'time', 'storage', 'carry', 'gift', 'set']
const iconItems = (n: number, over: (item: Item, i: number) => Item = (x) => x): Item[] =>
  Array.from({ length: n }, (_, i) => over({ title: NAMES[i], description: null, imageKey: null, icon: ICONS[i] }, i))
/** 기준 값은 시험에 고정한다 — 원판 160, 3열 칸 236·사이 16 */
const DISC = 160
const DISC_XS = [98, 350, 602]

function planWith(items: Item[], bg = 'W', art = true, accent?: string) {
  const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
  plan.layout = 2
  if (art) plan.artDirection = accent ? { ...ART, background: { ...ART.background, accent } } : ART
  const base = plan.sections.find((s) => s.key.startsWith('point_div:'))!
  plan.sections.push({
    ...base,
    key: 'detail:more',
    role: 'usp_feature',
    template: 'T11',
    bg,
    chapter: null,
    plateKey: null,
    productImageKey: null,
    pointIndex: null,
    text: { eyebrow: 'DETAIL', headline: '자세히 보기', sub: null },
    modules: [{ type: 'M11', data: { items } }],
    layoutVariant: 'list',
  } as unknown as (typeof plan.sections)[number])
  plan.order.splice(plan.order.indexOf('point_div:2') + 1, 0, 'detail:more')
  return plan
}
const compose = (items: Item[], bg = 'W', art = true, accent?: string) =>
  composeDesignCut([], readDesignCut({ designcut: planWith(items, bg, art, accent) })!, { images: IMAGES, sectionOrder: [], imageAspects: null }).find(
    (s) => s.layoutId === 'designcut_T11'
  )!
const svgs = (sec: CanvasSection) => sec.elements.filter((e) => e.type === 'svg' && e.name.startsWith('usp_icon_'))
const discs = (sec: CanvasSection) => sec.elements.filter((e) => e.name.startsWith('designcut-icon-disc-'))
const names = (sec: CanvasSection) => sec.elements.filter((e) => e.name === TABLE_NAME_ELEMENT)
const bottom = (e: CanvasElement) => e.transform.y + e.transform.height
const cr = (a: string, b: string) => contrastRatio(parseColor(a)!, parseColor(b)!)
/** 요소 id·그라데이션 id(시각값)를 뺀 그림 모양 */
const drawn = (sec: CanvasSection) =>
  JSON.stringify({ ...sec, id: '', elements: sec.elements.map((e) => ({ ...e, id: '', groupId: e.groupId ? 'g' : undefined })) }).replace(/(fade|frm|txt|shp|svg)_[0-9_]+/g, 'ID')

describe('아이콘 칸 계약(T1-60 D)', () => {
  it('icon은 선택 칸 — 사전 이름만 남기고 모르는 이름은 버리며, 없는 항목에는 칸을 두지 않는다', () => {
    const items: Item[] = [
      { title: '방수 소재', description: null, imageKey: null, icon: 'water' },
      { title: '빠른 건조', description: null, imageKey: null, icon: 'shield' },
      { title: '넉넉한 수납', description: null, imageKey: null },
    ]
    const read = readDesignCut({ designcut: planWith(items) })!
    const detail = read.sections.find((s) => s.key === 'detail:more')!
    const got = (detail.modules.find((m) => m.type === 'M11')!.data as { items: Item[] }).items
    expect(got[0].icon).toBe('water')
    expect('icon' in got[1]).toBe(false)
    expect('icon' in got[2]).toBe(false)
  })

  it('icon이 없거나 사전 밖이면 읽기·그리기 결과가 icon 칸이 없던 문서와 같다(저장 문서 변화 0)', () => {
    const plain = iconItems(3, (x) => ({ ...x, icon: undefined, description: '설명이 있는 지금 저장 문서 같은 항목' }))
    delete plain[0].icon
    const unknown = plain.map((x) => ({ ...x, icon: 'badge' }))
    expect(drawn(compose(unknown))).toBe(drawn(compose(plain)))
    const noDesc = iconItems(3, (x) => ({ ...x, icon: 'trophy' }))
    expect(svgs(compose(noDesc))).toEqual([])
  })
})

describe('아이콘 칸 그리기(T2-11·T2-56·A6-D2·T2-54 D)', () => {
  it.each([
    [3, [[0, 1, 2]]],
    [4, [[0, 1, 2], [1]]],
    [6, [[0, 1, 2], [0, 1, 2]]],
  ])('%i개 — 3열 격자(덜 찬 줄은 가운데), 강조색 원판 위 사전 그림, 아래 이름 한 줄(내용 라벨 한 묶음)', (n, rows) => {
    const sec = compose(iconItems(n))
    const ds = discs(sec)
    const ss = svgs(sec)
    expect(ds).toHaveLength(n)
    expect(ss).toHaveLength(n)
    const expectXs = (rows as number[][]).flat().map((col) => DISC_XS[col])
    ds.forEach((d, i) => {
      expect(d.transform).toMatchObject({ x: expectXs[i], width: DISC, height: DISC })
      expect(d.shapeProps!.shapeType).toBe('circle')
      expect(ss[i].svgProps!.svgString).toContain(iconFragment(ICONS[i])!)
      const pad = ss[i].transform.x - d.transform.x
      expect(pad).toBeGreaterThan(0)
      expect(ss[i].transform.x + ss[i].transform.width).toBe(d.transform.x + DISC - pad)
    })
    const rowYs = [...new Set(ds.map((d) => d.transform.y))]
    expect(rowYs).toHaveLength((rows as number[][]).length)
    const ns = names(sec)
    expect(ns.map((x) => x.textProps!.content)).toEqual(NAMES.slice(0, n))
    ns.forEach((x, i) => {
      expect(x.textProps!.textAlign).toBe('center')
      expect(x.transform.y).toBeGreaterThanOrEqual(bottom(ds[i]))
      expect(x.transform.width).toBe(236)
    })
    expect(new Set(ns.map((x) => x.groupId)).size).toBe(1)
    expect(sec.canvas.height).toBeGreaterThanOrEqual(Math.max(...sec.elements.map(bottom)))
    // M3는 페이지 첫 화면 규칙이라 섹션 하나만 넣은 시험에서는 늘 걸린다
    expect(checkMobileReadability({ sections: [sec] }).violations.filter((v) => v.rule !== 'M3')).toEqual([])
  })

  it.each([
    ['흰 바탕', 'W', undefined],
    ['짙은 바탕(T2-54 짙은 면 기능 목록)', 'D', undefined],
    // 밝은 강조색 — 원판 글자색은 짙고 짙은 바탕 글자색은 희다(그림 선이 바탕 글자색을 따르면 노란 원판 위 흰 선)
    ['짙은 바탕 + 밝은 강조색', 'D', '#F2C230'],
  ])('%s — 이름은 바탕 위 대비 4.5 이상, 그림 선은 원판 글자색(원판 위 4.5 이상), 모바일 위반 0', (_, bg, accent) => {
    const sec = compose(iconItems(3), bg, true, accent)
    for (const x of names(sec)) expect(cr(x.textProps!.color, sec.canvas.backgroundColor)).toBeGreaterThanOrEqual(4.5)
    discs(sec).forEach((d, i) => {
      const stroke = /stroke="(#[0-9A-Fa-f]{6})"/.exec(svgs(sec)[i].svgProps!.svgString)![1]
      // 그림 선은 원판 글자색(강조색 위 글자색)이라 글자 기준 4.5를 넘는다 — 바탕 글자색을 쓰면 흰 바탕에서 원판 위 3.5에 그친다
      expect(cr(stroke, d.shapeProps!.fill!)).toBeGreaterThanOrEqual(4.5)
    })
    expect(checkMobileReadability({ sections: [sec] }).violations.filter((v) => v.rule !== 'M3')).toEqual([])
  })

  it.each<[string, Item[]]>([
    ['항목 2개', iconItems(2)],
    ['항목 7개', [...iconItems(6), { title: '손 세척', description: null, imageKey: null, icon: 'hand' }]],
    ['사전 밖 이름이 섞임', iconItems(3, (x, i) => (i === 1 ? { ...x, icon: 'medal' } : x))],
    ['아이콘 없는 항목', iconItems(3, (x, i) => (i === 2 ? { ...x, icon: undefined } : x))],
    ['설명이 있는 항목', iconItems(3, (x, i) => (i === 0 ? { ...x, description: '물에 닿아도 괜찮아요' } : x))],
    ['이름이 12자를 넘음', iconItems(3, (x, i) => (i === 0 ? { ...x, title: 'eco tote mini' } : x))],
  ])('%s → 지금 목록(아이콘 칸 없음)', (_, items) => {
    const sec = compose(items)
    expect(svgs(sec)).toEqual([])
    expect(discs(sec)).toEqual([])
  })

  it('사진 + 아이콘 + 이름 3항목은 원 3칸(사진이 근거) — 아이콘 칸보다 원 3칸이 먼저', () => {
    const sec = compose(iconItems(3, (x, i) => ({ ...x, imageKey: `features:${i + 2}` })))
    expect(svgs(sec)).toEqual([])
    const photos = sec.elements.filter((e) => e.type === 'framed-image' && e.name.startsWith('designcut-detail-photo-'))
    expect(photos.every((p) => p.framedImageProps!.frameId === 'circle')).toBe(true)
  })

  it('기본 v2(아트 디렉션 없음)에서도 같은 칸', () => {
    const sec = compose(iconItems(3), 'W', false)
    expect(discs(sec).map((d) => d.transform.x)).toEqual(DISC_XS)
    for (const x of names(sec)) expect(x.transform.x).toBeGreaterThanOrEqual(MARGIN)
    for (const x of names(sec)) expect(x.transform.x + x.transform.width).toBeLessThanOrEqual(MARGIN + CONTENT_W)
  })

  it('내보내기 HTML이 아이콘 SVG를 그대로 싣는다', () => {
    const html = exportRenderHtml([compose(iconItems(4))] as never, {})
    for (const name of ICONS.slice(0, 4)) expect(html).toContain(iconFragment(name)!)
  })
})
