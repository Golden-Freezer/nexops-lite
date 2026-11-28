/**
 * 적용 D6 P5 — 구역 연결 표식(R-W9·T2-13): 계획 표지(고민 T2 바로 다음이 해결 안내 또는 첫 큰 POINT일 때만, 페이지당 1개), 계약(T2의 true만),
 * 조립(장면 모드 T2 아래 여백 안 세로 점선 + 원 화살표 — 높이 그대로, 원은 섹션 끝 4 안), 리플로우 뒤에도 끝에 붙음. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { reflowSectionLayout } from '@/lib/registration/editor/utils/reflowSectionLayout'
import { TRACK_I_KEYS, fixtureToJob, loadEnrichmentFixture, type FixtureKey } from '@/lib/registration/__golden__/golden-harness'
import { applyDesignSkeleton, resolveDesignSkeleton } from '@/lib/registration/pdp-enrichment-stage'
import type { DesigncutSection, DesigncutTemplate, PdpJobRow } from '@/lib/registration/pdp-state'
import { mergeManualStrategy } from '@/lib/registration/pdp-strategy-contract'
import { buildDesigncutPlan } from '@/lib/registration/internalized/designcut-plan'
import { markZoneLink } from '@/lib/registration/internalized/designcut-structure'
import { LINK } from '@/lib/registration/templatelib/zone-link'
import { composeDesignCut } from './compose'
import { readDesignCut } from './contract'
import { designCutPlanForB } from './designCut.fixture'
import { withZoneLink } from './zoneLink'
import { W } from './tokens'

const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight from the left window', season: 'spring', props: ['linen cloth'] },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
  corners: 'soft',
}
const IMAGES = { hero: 'https://img.test/hero.png', features: Array.from({ length: 6 }, (_, i) => `https://img.test/f${i}.png`) }

const ON = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut']
const D2 = [...ON, 'designcut2', 'designlayout']
/** 골든 고정물 잡(designcut-structure.test와 같은 꼴) — 기능 목록으로 D2 여부를 정한다 */
function jobOf(key: FixtureKey, features: string[]): PdpJobRow {
  const j = fixtureToJob(loadEnrichmentFixture(key))
  j.analysis = { ...j.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  const strategy = mergeManualStrategy(j.analysis.recommended_strategy_contract ?? {}, j.spec_sheet, [])
  j.section_plan = applyDesignSkeleton(j.section_plan, resolveDesignSkeleton(j, strategy))
  return j
}

type Opts = { link?: unknown; scene?: boolean; accent?: string; photo?: boolean }
/** 고정물 계획 — 장면 모드(layout 2)면 아트 디렉션을 주고, 고민 칸(problem_raise)에 표지·고민 사진을 준다 */
const planOf = ({ link, scene = true, accent = ART.background.accent, photo = true }: Opts = {}) => {
  const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
  if (scene) {
    plan.layout = 2
    plan.artDirection = { ...ART, background: { ...ART.background, accent } }
  }
  const problem = plan.sections.find((s) => s.key === 'problem_raise')! as Record<string, unknown>
  if (photo) problem.productImageKey = 'hero'
  if (link !== undefined) problem.linkBelow = link
  return plan
}
const compose = (opts: Opts = {}) =>
  composeDesignCut([], readDesignCut({ designcut: JSON.parse(JSON.stringify(planOf(opts))) })!, { images: IMAGES, sectionOrder: [] })
const t2 = (out: CanvasSection[]) => out.find((s) => s.layoutId === 'designcut_T2')!
const links = (sec: CanvasSection) => sec.elements.filter((e) => e.name?.startsWith('designcut-link-'))
const one = (sec: CanvasSection, name: string) => {
  const found = sec.elements.filter((e) => e.name === name)
  expect(found, name).toHaveLength(1)
  return found[0]
}
/** id(무작위)를 뺀 섹션 — 같은 그리기인지 비교 */
const shape = (sec: CanvasSection) =>
  JSON.stringify({ ...sec, id: '', elements: sec.elements.map((e) => ({ ...e, id: '', groupId: e.groupId ? 'g' : undefined })) }).replace(
    /([a-z]+)_\d+_\d{10,}/g,
    '$1'
  )

describe('계획 표지(markZoneLink)', () => {
  const s = (key: string, template: DesigncutTemplate, chapter: number | null = null) => ({ key, template, chapter })
  const page = [s('main_cut', 'T1'), s('problem_raise', 'T2'), s('point_div:0', 'T3a', 1), s('point_div:1', 'T3a', 2), s('point_div:2', 'T3a', 3)]

  it('고민 바로 다음이 첫 큰 POINT면 고민 칸 하나에만 단다', () => {
    const out = markZoneLink([...page], page.map((p) => p.key))
    expect(out.filter((p) => 'linkBelow' in p).map((p) => p.key)).toEqual(['problem_raise'])
    expect(out.find((p) => p.key === 'problem_raise')).toMatchObject({ linkBelow: true })
  })

  it('고민 바로 다음이 해결 안내면(기존 빌더 섹션이어도, 계획 칸이어도) 단다 — 큰 POINT가 없어도', () => {
    const kept = ['main_cut', 'problem_raise', 'solution_guide', 'point_div:0', 'point_div:1', 'point_div:2']
    expect(markZoneLink([...page], kept).filter((p) => 'linkBelow' in p).map((p) => p.key)).toEqual(['problem_raise'])
    const planned = [...page.slice(0, 2), s('solution_guide', 'T4'), ...page.slice(2)]
    expect(markZoneLink(planned, planned.map((p) => p.key)).filter((p) => 'linkBelow' in p).map((p) => p.key)).toEqual(['problem_raise'])
    const noPoints = [s('main_cut', 'T1'), s('problem_raise', 'T2')]
    expect(markZoneLink(noPoints, ['main_cut', 'problem_raise', 'solution_guide']).filter((p) => 'linkBelow' in p)).toHaveLength(1)
  })

  it('다음이 다른 기존 빌더 섹션이거나, 첫 장이 아닌 POINT이거나, 고민이 끝 칸·없으면 달지 않는다', () => {
    const between = ['main_cut', 'problem_raise', 'problem_empathy', 'point_div:0', 'point_div:1', 'point_div:2']
    expect(markZoneLink([...page], between).some((p) => 'linkBelow' in p)).toBe(false)
    const second = ['main_cut', 'point_div:0', 'problem_raise', 'point_div:1', 'point_div:2']
    expect(markZoneLink([...page], second).some((p) => 'linkBelow' in p)).toBe(false)
    const last = page.slice(0, 2)
    expect(markZoneLink(last, last.map((p) => p.key))).toBe(last)
    const noT2 = [page[0], ...page.slice(2)]
    expect(markZoneLink(noT2, noT2.map((p) => p.key))).toBe(noT2)
  })

  it('고정물 계획(고민 → 공감 기존 섹션 → POINT)은 표지가 없다', () => {
    const plan = designCutPlanForB()
    expect(markZoneLink(plan.sections as unknown as DesigncutSection[], plan.order).some((p) => 'linkBelow' in p)).toBe(false)
  })

  it('계획(buildDesigncutPlan) — 골든 D2 잡(고민 → 해결 안내 기존 빌더 → POINT)은 고민 칸 하나에 달고, D2가 아니면 달지 않는다', () => {
    for (const key of TRACK_I_KEYS) {
      const p = buildDesigncutPlan(jobOf(key, D2))!
      expect(p.order[p.order.indexOf('problem_raise') + 1], key).toBe('solution_guide')
      expect(p.sections.filter((s) => s.linkBelow).map((s) => s.key), key).toEqual(['problem_raise'])
      expect(buildDesigncutPlan(jobOf(key, ON))!.sections.some((s) => s.linkBelow), key).toBe(false)
    }
  })

  it('계획 — 고민과 POINT 사이 기존 섹션(해결 안내)을 빼 고민 바로 다음이 첫 POINT가 되면 D2 잡은 고민 칸 하나에 단다(D2 아니면 없음)', () => {
    // 고정물 설계 골격은 고민 → 해결 안내(기존 빌더) → POINT다. R17-L 잡처럼 그 사이를 비운다
    const adjacent = (features: string[]) => {
      const j = jobOf('A-track-i', features)
      const between = new Set(['solution_guide', 'problem_empathy'])
      j.section_plan = { ...j.section_plan, section_order: (j.section_plan.section_order ?? []).filter((k) => !between.has(k)) }
      return buildDesigncutPlan(j)!
    }
    const p = adjacent(D2)
    const next = p.sections.find((s) => s.key === p.order[p.order.indexOf('problem_raise') + 1])
    expect(next?.chapter).toBe(1)
    expect(p.sections.filter((s) => s.linkBelow).map((s) => s.key)).toEqual(['problem_raise'])
    expect(adjacent(ON).sections.some((s) => s.linkBelow)).toBe(false)
  })
})

describe('계약', () => {
  it('고민(T2) 칸의 true만 읽고, 다른 템플릿·true가 아닌 값은 칸을 두지 않는다', () => {
    expect(readDesignCut({ designcut: JSON.parse(JSON.stringify(planOf({ link: true }))) })!.sections.find((s) => s.key === 'problem_raise')).toMatchObject({
      linkBelow: true,
    })
    expect(readDesignCut({ designcut: JSON.parse(JSON.stringify(planOf({ link: 'yes' }))) })!.sections.find((s) => s.key === 'problem_raise')).not.toHaveProperty(
      'linkBelow'
    )
    const plan = planOf()
    Object.assign(plan.sections.find((s) => s.key === 'point_div:0')!, { linkBelow: true })
    expect(readDesignCut({ designcut: JSON.parse(JSON.stringify(plan)) })!.sections.find((s) => s.key === 'point_div:0')).not.toHaveProperty('linkBelow')
  })
})

describe('조립 — 고민 칸 아래 여백 안 표식', () => {
  it('원은 가운데·섹션 끝 4 안, 점선은 내용 끝 + 20부터 원 위 8까지 — 섹션 높이는 표식 없을 때와 같다', () => {
    const base = t2(compose())
    const sec = t2(compose({ link: true }))
    expect(sec.canvas.height).toBe(base.canvas.height)
    const arrow = one(sec, 'designcut-link-arrow')
    const line = one(sec, 'designcut-link-line')
    expect(arrow.transform).toMatchObject({ x: W / 2 - LINK.arrow / 2, y: sec.canvas.height - LINK.inset - LINK.arrow, width: LINK.arrow, height: LINK.arrow })
    const photo = one(sec, 'designcut-problem-photo')
    expect(line.transform.y).toBe(photo.transform.y + photo.transform.height + LINK.gap)
    expect(line.transform.y + line.transform.height).toBe(arrow.transform.y - LINK.lineGap)
    expect(Math.min(arrow.zIndex, line.zIndex)).toBeGreaterThan(Math.max(...base.elements.map((e) => e.zIndex)))
  })

  it('표식 말고는 문서가 바이트 같다 — 고민 칸의 다른 요소·다른 섹션 모두', () => {
    const base = compose()
    const out = compose({ link: true })
    expect(out.map((s) => s.layoutId)).toEqual(base.map((s) => s.layoutId))
    out.forEach((sec, i) => {
      const plain = { ...sec, elements: sec.elements.filter((e) => !e.name?.startsWith('designcut-link-')) }
      expect(shape(plain)).toBe(shape(base[i]))
    })
  })

  it('고민 사진이 없어도 결론 글 아래 여백에 둔다', () => {
    const sec = t2(compose({ link: true, photo: false }))
    expect(links(sec)).toHaveLength(2)
    expect(one(sec, 'designcut-link-arrow').transform.y).toBe(sec.canvas.height - LINK.inset - LINK.arrow)
  })

  it('표지가 없거나 장면 모드가 아니면 그리지 않는다', () => {
    expect(links(t2(compose()))).toEqual([])
    expect(links(t2(compose({ link: true, scene: false })))).toEqual([])
  })

  it('색 — 강조색이 바탕 대비 3 이상이면 강조색, 아니면 바탕 글자색(원 안은 바탕색)', () => {
    const blue = t2(compose({ link: true }))
    expect(one(blue, 'designcut-link-arrow').svgProps?.svgString).toContain('stroke="#2B6CD9"')
    expect(one(blue, 'designcut-link-arrow').svgProps?.svgString).toContain(`fill="${blue.canvas.backgroundColor}"`)
    const pale = t2(compose({ link: true, accent: '#F6E7A8' }))
    const svg = one(pale, 'designcut-link-arrow').svgProps?.svgString ?? ''
    expect(svg).not.toContain('stroke="#F6E7A8"')
    expect(/stroke="(#[0-9A-Fa-f]{6})"/.exec(svg)?.[1]).toBe(/stroke="(#[0-9A-Fa-f]{6})"/.exec(one(pale, 'designcut-link-line').svgProps?.svgString ?? '')?.[1])
  })

  it('표식 함수 — 원 안은 그 섹션 바탕색(흰색 아님도), 여백이 간격 + 원 + 끝보다 좁으면 섹션을 그대로 돌려준다', () => {
    const sec = { id: 's', canvas: { width: W, height: 600, backgroundColor: '#F5F2EF' }, elements: [] } as unknown as CanvasSection
    const drawn = withZoneLink(sec, 400, { text: '#222222' }, '#2B6CD9')
    expect(one(drawn, 'designcut-link-arrow').svgProps?.svgString).toContain('fill="#F5F2EF"')
    const tight = 600 - (LINK.gap + LINK.arrow + LINK.inset) + 1
    expect(withZoneLink(sec, tight, { text: '#222222' }, '#2B6CD9')).toBe(sec)
  })

  it('리플로우 — 실측이 같으면 높이 그대로, 결론 글이 60 늘면 사진·점선·원이 함께 내려가고 원은 섹션 끝 4 안에 붙어 있다', () => {
    const same = structuredClone(t2(compose({ link: true })))
    const height = same.canvas.height
    reflowSectionLayout(same)
    expect(same.canvas.height).toBe(height)
    const grown = structuredClone(t2(compose({ link: true })))
    const text = one(grown, 'designcut-conclusion-text')
    const lineY = one(grown, 'designcut-link-line').transform.y
    text.measuredHeight = text.transform.height + 60
    reflowSectionLayout(grown)
    expect(grown.canvas.height).toBe(height + 60)
    expect(one(grown, 'designcut-link-line').transform.y).toBe(lineY + 60)
    expect(one(grown, 'designcut-link-arrow').transform.y).toBe(grown.canvas.height - LINK.inset - LINK.arrow)
  })
})
