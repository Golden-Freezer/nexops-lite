/**
 * 적용 T2-51 D(원 사진 3~5 + 이름) — 자세히 보기(T11)의 3항목이 K point_list_div.circle-trio와 같은 값(사진 + 이름 한 줄, 설명 없음)일 때만
 * 원 3칸(지름 216)으로 그린다. 그 밖은 지금 세로 쌓기(통합 11-03 안 B). 설명을 원 칸(236) 셋에 나란히 두면 모바일 검사 M6에 걸린다.
 * R17-L 저장 11잡은 설명이 있어 해당 0이라 픽스처로만 본다.
 */

import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { TABLE_NAME_ELEMENT, checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import { exportRenderHtml } from '@/lib/registration/editor/utils/exportUtils/htmlBuilders'
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
type Item = { title: string; description: string | null; imageKey: string | null }
/** 원 칸에 드는 이름(한 줄·12자 이하), 설명 없음 — K circle-trio의 사진 + 이름과 같은 값 */
const SHORT: Item[] = [
  { title: '넉넉한 20매', description: null, imageKey: 'features:2' },
  { title: '반투명 소재', description: null, imageKey: 'features:4' },
  { title: '조임끈 마감', description: null, imageKey: 'features:5' },
]
const DESC = '한 반 답례품을 한 번에'
/** 기준 값은 시험에 고정한다 — 코드 상수를 가져오면 변이를 못 잡는다 */
const D = 216
const COL_XS = [70, 322, 574]

function compose(items: Item[], art = true) {
  const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
  plan.layout = 2
  if (art) plan.artDirection = ART
  const base = plan.sections.find((s) => s.key.startsWith('point_div:'))!
  plan.sections.push({
    ...base,
    key: 'detail:more',
    role: 'usp_feature',
    template: 'T11',
    bg: 'W',
    chapter: null,
    plateKey: null,
    productImageKey: null,
    pointIndex: null,
    text: { eyebrow: 'DETAIL', headline: '자세히 보기', sub: null },
    modules: [{ type: 'M11', data: { items } }],
    layoutVariant: 'list',
  } as unknown as (typeof plan.sections)[number])
  plan.order.splice(plan.order.indexOf('point_div:2') + 1, 0, 'detail:more')
  const out = composeDesignCut([], readDesignCut({ designcut: plan })!, { images: IMAGES, sectionOrder: [], imageAspects: null })
  return out.find((s) => s.layoutId === 'designcut_T11')!
}
const photos = (sec: CanvasSection) => sec.elements.filter((e) => e.type === 'framed-image' && e.name.startsWith('designcut-detail-photo-'))
const bottom = (e: CanvasElement) => e.transform.y + e.transform.height
const isCircleTrio = (sec: CanvasSection) => photos(sec).length > 0 && photos(sec).every((p) => p.framedImageProps!.frameId === 'circle')

describe('자세히 보기 원 3칸(T2-51 D)', () => {
  it.each([
    ['장면 모드', true],
    ['기본 v2', false],
  ])('%s: 3항목 사진 + 이름은 정원 216 사진 3개를 한 줄에, 원 아래 가운데에 이름 한 줄(내용 라벨 한 묶음)', (_, art) => {
    const sec = compose(SHORT, art)
    const ps = photos(sec)
    expect(ps).toHaveLength(3)
    ps.forEach((p, i) => {
      expect(p.framedImageProps!.frameId).toBe('circle')
      expect(p.framedImageProps!.objectFit).toBe('cover')
      expect(p.transform).toMatchObject({ x: COL_XS[i], width: D, height: D, y: ps[0].transform.y })
    })
    const names = sec.elements.filter((e) => e.name === TABLE_NAME_ELEMENT)
    expect(names.map((n) => n.textProps!.content)).toEqual(SHORT.map((s) => s.title))
    names.forEach((n, i) => {
      expect(n.textProps!.textAlign).toBe('center')
      expect(n.textProps!.fontSize).toBeGreaterThanOrEqual(32)
      expect(n.transform.x).toBe(COL_XS[i] - 10)
      expect(n.transform.width).toBe(236)
      expect(n.transform.y).toBeGreaterThanOrEqual(bottom(ps[i]))
    })
    expect(new Set(names.map((n) => n.groupId)).size).toBe(1)
    expect(names[0].groupId).toBeTruthy()
    // 세로 쌓기의 번호·제목·설명 글은 없다
    expect(sec.elements.filter((e) => /^designcut-detail-(no|title|desc)-/.test(e.name))).toEqual([])
    expect(sec.canvas.height).toBeGreaterThanOrEqual(Math.max(...sec.elements.map(bottom)))
    expect(checkMobileReadability({ sections: [sec] }).violations.filter((v) => v.rule !== 'M3')).toEqual([])
  })

  it('원 3칸은 세로 쌓기보다 짧다(특징 사진 3장 → 원 한 줄)', () => {
    const circle = compose(SHORT)
    const stacked = compose(SHORT.map((s, i) => (i === 2 ? { ...s, imageKey: null } : s)))
    expect(isCircleTrio(stacked)).toBe(false)
    expect(circle.canvas.height).toBeLessThan(stacked.canvas.height)
  })

  it.each<[string, Item[]]>([
    ['항목 4개', [...SHORT, { title: '두 가지 색', description: null, imageKey: 'features:1' }]],
    ['항목 2개', SHORT.slice(0, 2)],
    ['사진 빠진 항목', SHORT.map((s, i) => (i === 1 ? { ...s, imageKey: null } : s))],
    ['제목 없는 항목', SHORT.map((s, i) => (i === 0 ? { ...s, title: '' } : s))],
    ['설명이 있는 항목(원 칸 본문은 M6)', SHORT.map((s, i) => (i === 1 ? { ...s, description: DESC } : s))],
    // 13자지만 칸 폭(236) 안 — 12자 상한(장식 라벨 규칙)만으로 걸러진다
    ['이름이 12자를 넘음(폭은 칸 안)', SHORT.map((s, i) => (i === 0 ? { ...s, title: 'eco tote mini' } : s))],
    ['이름이 원 칸 폭을 넘음(12자 안)', SHORT.map((s, i) => (i === 0 ? { ...s, title: '넉넉한구성답례품스티커' } : s))],
  ])('%s → 지금 세로 쌓기(본문 폭 사진)', (_, items) => {
    const sec = compose(items)
    expect(isCircleTrio(sec)).toBe(false)
    for (const p of photos(sec)) expect(p.transform).toMatchObject({ x: MARGIN, width: CONTENT_W })
  })

  it('내보내기 HTML이 원 틀을 그대로 옮긴다 — 사진 3장 모두 border-radius:50%', () => {
    const sec = compose(SHORT)
    const html = exportRenderHtml([sec] as never, {})
    expect(html.match(/border-radius:50%/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    const stacked = exportRenderHtml([compose(SHORT.map((s, i) => (i === 1 ? { ...s, description: DESC } : s)))] as never, {})
    expect(stacked).not.toContain('border-radius:50%')
  })
})
