/**
 * POINT 진행 표시(적용 D1 R-W7, pointSteps.ts) — D2 장면 모드 POINT 머리의 위 여백 안, 'POINT' 캡슐 바로 위 줄(본문 폭 전체)에 K 진행 표시.
 * 제목이 모두 탭 칸에 들어가면 탭 띠, 아니면 오른쪽 끝 점 줄. 글색은 K stepsInk와 같다. 진행 표시를 끈 문서와 섹션 높이·다른 요소 자리·
 * 판독 규칙(M1~M7) 결과가 같고, 비장면 v2·v1은 그리지 않는다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import { MOBILE_LIMITS, checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { stepsInk } from '@/lib/registration/templatelib/engine'
import { STEPS } from '@/lib/registration/templatelib/steps'
import { CutBuilder } from './build'
import type { CutPlan } from './contract'
import { designCutJobB, designCutPlanForB } from './designCut.fixture'
import { POINT_STEPS_GAP, POINT_STEPS_MIN_TOP, drawPointSteps, pointStepsInk, pointStepsLine, type PagePoint } from './pointSteps'
import { CONTENT_W, MARGIN, TYPE, colorsOf, surfaceOf } from './tokens'

/** 진행 표시 끄개 — 조립 시험에서 같은 계획을 진행 표시 없이 다시 그려 비교한다 */
const steps = vi.hoisted(() => ({ off: false }))
vi.mock('./pointSteps', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./pointSteps')>()
  return { ...mod, drawPointSteps: (...args: Parameters<typeof mod.drawPointSteps>) => (steps.off ? false : mod.drawPointSteps(...args)) }
})
beforeEach(() => {
  steps.off = false
})

const LABEL = TYPE.LABEL
const isSteps = (e: CanvasElement) => Boolean(e.name?.startsWith('designcut-steps') || e.name?.startsWith('annotation-label-step'))
const pts = (...heads: Array<string | null>): PagePoint[] => heads.map((headline, i) => ({ chapter: i + 1, headline }))
/** 고정 계획(B)의 팔레트에서 강조색·강조 글자색만 바꾼 렌더 v2 색 */
const colorsFor = (accent: string, accentText?: string) => {
  const plan = designCutPlanForB()
  return colorsOf({ ...plan, layout: 2, palette: { ...plan.palette, accent, accentText: accentText ?? plan.palette.accentText } } as unknown as CutPlan)
}

describe('pointStepsInk — K stepsInk와 같은 색', () => {
  const palettes = [{ accent: '#D9622B' }, { accent: '#2B6CD9', accentText: '#2B6CD9' }, { accent: '#F2C94C' }, { accent: '#53634D', accentText: '#53634D' }]
  it.each(palettes)('강조 $accent — 흰·스튜디오·짙은·틴트·사진 면 모두', ({ accent, accentText }) => {
    const c = colorsFor(accent, accentText)
    for (const bg of ['W', 'N', 'D', 'T', 'P'] as const) {
      const surf = surfaceOf(bg, c)
      const k = stepsInk({ ctx: { colors: c, radius: { chip: 12 } } } as unknown as Parameters<typeof stepsInk>[0], { surf } as unknown as Parameters<typeof stepsInk>[1])
      expect(pointStepsInk(surf, c, 12), bg).toEqual(k)
    }
  })
})

describe('pointStepsLine — 이름은 제목 그대로, 탭에 다 들어갈 때만', () => {
  it('제목이 모두 탭 칸에 들면 탭(이름 그대로·지금 칸 순번)', () => {
    expect(pointStepsLine(pts('수납 공간', '6단 조절', '튼튼한 내구'), 2, CONTENT_W, LABEL)).toEqual({ names: ['수납 공간', '6단 조절', '튼튼한 내구'], current: 1 })
  })
  it('하나라도 칸을 넘거나 비면 이름 없는 점 줄(지금 이름 + 점은 쓰지 않는다)', () => {
    expect(pointStepsLine(pts('수납', '여섯 칸 높이를 바꾸는 선반', '내구'), 1, CONTENT_W, LABEL)).toEqual({ names: [null, null, null], current: 0 })
    expect(pointStepsLine(pts('수납', null, '내구'), 3, CONTENT_W, LABEL)).toEqual({ names: [null, null, null], current: 2 })
  })
  it('POINT가 둘보다 적거나 지금 chapter가 목록에 없으면 null', () => {
    expect(pointStepsLine(pts('수납'), 1, CONTENT_W, LABEL)).toBeNull()
    expect(pointStepsLine(pts('수납', '정리'), 5, CONTENT_W, LABEL)).toBeNull()
  })
})

describe('drawPointSteps — 캡슐 바로 위 줄, 본문 폭 전체', () => {
  const c = colorsFor('#D9622B')
  const surf = surfaceOf('W', c)
  const draw = (points: PagePoint[], chapter = 1, capsuleY = 120) => {
    const b = new CutBuilder()
    const drawn = drawPointSteps(b, { points, chapter, capsuleY, surf, colors: c, chipRadius: 12, token: LABEL })
    return { drawn, steps: b.elements.filter(isSteps) }
  }
  const rowOf = (capsuleY: number) => ({ top: capsuleY - POINT_STEPS_GAP - STEPS.h, bottom: capsuleY - POINT_STEPS_GAP })

  it('점 줄: svg 하나가 줄 안 오른쪽 끝', () => {
    const { drawn, steps: els } = draw(pts('여섯 칸 높이를 바꾸는 선반', '정리', '내구'))
    expect(drawn).toBe(true)
    expect(els.map((e) => e.name)).toEqual(['designcut-steps-dots'])
    const [dots] = els
    expect(dots.transform.y).toBeGreaterThanOrEqual(rowOf(120).top)
    expect(dots.transform.y + dots.transform.height).toBeLessThanOrEqual(rowOf(120).bottom)
    expect(dots.transform.x + dots.transform.width).toBe(MARGIN + CONTENT_W)
  })

  it('탭: 본문 폭 띠 하나 + 지금 칸 + 이름 글, 한 묶음·글자는 장식 라벨 하한 이상', () => {
    const { steps: els } = draw(pts('수납 공간', '6단 조절', '튼튼한 내구'), 2)
    const band = els.find((e) => e.name === 'designcut-steps-band')!
    expect(band.transform).toMatchObject({ x: MARGIN, y: rowOf(120).top, width: CONTENT_W, height: STEPS.h })
    const texts = els.filter((e) => e.type === 'text')
    expect(texts.map((e) => e.textProps?.content)).toEqual(['수납 공간', '6단 조절', '튼튼한 내구'])
    for (const t of texts) expect(t.textProps!.fontSize).toBeGreaterThanOrEqual(MOBILE_LIMITS.annotationLabelMinPx)
    expect(els.filter((e) => e.name === 'designcut-steps-current')).toHaveLength(1)
    expect(new Set(els.map((e) => e.groupId)).size).toBe(1)
  })

  it(`캡슐 위 끝이 ${POINT_STEPS_MIN_TOP}보다 위거나 POINT 하나면 그리지 않는다`, () => {
    expect(draw(pts('수납', '정리'), 1, POINT_STEPS_MIN_TOP - 1)).toEqual({ drawn: false, steps: [] })
    expect(draw(pts('수납', '정리'), 1, POINT_STEPS_MIN_TOP).drawn).toBe(true)
    expect(draw(pts('수납'))).toEqual({ drawn: false, steps: [] })
  })
})

describe('조립 — 장면 모드 POINT 머리마다, 끈 문서와 같은 높이·자리·판독', () => {
  const ART = {
    set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight', season: 'spring', props: ['linen cloth'] },
    background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
    corners: 'soft',
  }
  type Plan = ReturnType<typeof designCutPlanForB> & { layout?: 2; artDirection?: typeof ART }
  const docOf = async (opts: { layout2?: boolean; art?: boolean; heads?: readonly string[] } = {}) => {
    const plan = designCutPlanForB() as Plan
    if (opts.layout2 ?? true) plan.layout = 2
    if (opts.art ?? true) plan.artDirection = ART
    if (opts.heads) plan.sections.filter((s) => s.chapter !== null).forEach((s, i) => (s.text = { ...s.text, headline: opts.heads![i] ?? s.text.headline }))
    const job = designCutJobB({ plan })
    return buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
  }
  const heads = (doc: { sections: CanvasSection[] }) => doc.sections.filter((s) => s.elements.some((e) => e.name === 'designcut-chapter-bg'))
  const box = (e: CanvasElement) => ({ l: e.transform.x, t: e.transform.y, r: e.transform.x + e.transform.width, b: e.transform.y + e.transform.height })
  const hits = (a: CanvasElement, b: CanvasElement) => {
    const [x, y] = [box(a), box(b)]
    return x.l < y.r && y.l < x.r && x.t < y.b && y.t < x.b
  }
  /** 요소 자리 요약(id 빼고) — 끈 문서와 비교 */
  const layout = (doc: { sections: CanvasSection[] }) =>
    doc.sections.map((s) => ({ h: s.canvas.height, els: s.elements.filter((e) => !isSteps(e)).map((e) => [e.name, e.type, e.transform, e.textProps?.content ?? null]) }))
  const brief = (sections: CanvasSection[]) => checkMobileReadability({ sections }).violations.map((v) => `${v.rule}:${v.section}:${v.element ?? ''}:${v.detail}`).sort()

  for (const [label, opts, look] of [
    ['긴 제목 → 점 줄', { heads: ['여섯 칸 높이를 바꾸는 선반', '정리', '내구'] }, 'dots'],
    ['짧은 제목 → 탭', { heads: ['수납 공간', '6단 조절', '튼튼한 내구'] }, 'tabs'],
  ] as const) {
    it(`${label}: 캡슐 위 줄, 겹침 없음, 끈 문서와 섹션 높이·다른 요소·판독 결과가 같다`, async () => {
      const on = await docOf(opts)
      steps.off = true
      const off = await docOf(opts)
      const points = heads(on)
      expect(points.length).toBeGreaterThanOrEqual(2)
      for (const sec of points) {
        const capsule = sec.elements.find((e) => e.name === 'designcut-chapter-bg')!
        const els = sec.elements.filter(isSteps)
        expect(els.some((e) => e.name === (look === 'dots' ? 'designcut-steps-dots' : 'designcut-steps-band'))).toBe(true)
        if (look === 'tabs') {
          // 탭은 chapter 순 제목 그대로, 지금 칸(강조색 면) 안 글은 이 섹션 제목
          const tabs = els.filter((e) => e.type === 'text')
          expect(tabs.map((e) => e.textProps?.content)).toEqual(opts.heads)
          const current = els.find((e) => e.name === 'designcut-steps-current')!
          const inside = tabs.find((t) => t.transform.x >= current.transform.x && t.transform.x + t.transform.width <= current.transform.x + current.transform.width)!
          const headline = sec.elements.find((e) => e.name === 'designcut-headline')!.textProps!.content
          expect(headline).toContain(inside.textProps!.content)
        }
        for (const e of els) {
          expect(e.transform.y, e.name).toBeGreaterThanOrEqual(capsule.transform.y - POINT_STEPS_GAP - STEPS.h)
          expect(e.transform.y + e.transform.height, e.name).toBeLessThanOrEqual(capsule.transform.y - POINT_STEPS_GAP)
          const others = sec.elements.filter((o) => !isSteps(o) && !(o.type === 'shape' && o.transform.width >= 859))
          for (const o of others) expect(hits(e, o), `${e.name} × ${o.name}`).toBe(false)
        }
      }
      expect(layout(on)).toEqual(layout(off))
      expect(brief(on.sections)).toEqual(brief(off.sections))
    })
  }

  it('비장면 v2·v1은 진행 표시 없음', async () => {
    for (const opts of [{ art: false }, { layout2: false }]) {
      const doc = await docOf(opts)
      expect(doc.sections.flatMap((s) => s.elements).filter(isSteps), JSON.stringify(opts)).toHaveLength(0)
    }
  })
})
