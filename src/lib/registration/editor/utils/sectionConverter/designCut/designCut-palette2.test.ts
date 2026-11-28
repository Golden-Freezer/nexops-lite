/**
 * palette2 편집기 렌더(PALETTE2.md) — D2 장면 모드에서 palette2를 읽는다. playful: 밝은 고채도 토큰·짙은 전환 면 없음·스티커 배지·
 * 둥근 주아 첫 화면 제목. calm: 색은 그대로, 첫 화면 제목만 키운다. palette2가 없으면 지금 렌더 그대로.
 */

import { describe, expect, it } from 'vitest'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import type { DesigncutPalette2 } from '@/lib/registration/pdp-state'
import { buildPalette2 } from '@/lib/registration/internalized/art-palette'
import { designCutJobB, designCutPlanForB } from './designCut.fixture'
import { assignActBackgrounds, type BgRow } from './layout2'

const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight from the left window', season: 'spring', props: ['linen cloth'] },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
  alignment: { hero: 'center', closing: 'center', body: 'left' },
  corners: 'soft',
}
const PARENT = { enrichment: { version: 1, features: [], audience: { kind: 'parent_proxy', version: 1, basis: 'name_tags', terms: ['어린이집'], ageGate: false } } }

/** zone: 첫 화면 글자 자리 측정 통과(D2-3 겹침) — designCut-scene.test와 같은 기록 모양 */
const docOf = (palette2?: DesigncutPalette2, zone = false, hook?: string, aspect?: number) => {
  const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
  plan.layout = 2
  plan.artDirection = { ...ART, ...(palette2 ? { palette2 } : {}) }
  if (hook) Object.assign(plan.sections.find((s) => s.template === 'T1')!.text, { hook })
  const planned = designCutJobB({ plan })
  const job = aspect ? { ...planned, section_images: planned.section_images.map((s) => ({ ...s, imageAspect: aspect })) } : planned
  const measure = { pass: true, ink: 'dark', std: 3, gradient: 0.5, contrast: 12 }
  const withZone = zone
    ? {
        ...job,
        section_images: job.section_images.map((s) =>
          s.section === 'hero' ? { ...s, copyZone: { version: 1, zone: { from: 0, to: 0.33 }, attempt: 1, measure } } : s
        ),
      }
    : job
  return buildEditorDocument(withZone.id, assembleEditorDataResponse(withZone as typeof job, null))
}
const named = (doc: { sections: CanvasSection[] }, name: string) => doc.sections.flatMap((s) => s.elements.filter((e) => e.name === name))
const heroHeadline = (doc: { sections: CanvasSection[] }) =>
  doc.sections.find((s) => s.layoutId === 'designcut_T1')!.elements.find((e) => e.name === 'designcut-headline')!

describe('palette2 편집기 렌더', () => {
  const playful = buildPalette2(PARENT, null, '#D9622B', '#1A1A1A')

  it('palette2 없으면 첫 화면 제목은 장면 모드 H1(92·줄 간격 1.45·기본 글꼴, K H1과 같은 크기)', async () => {
    const tp = heroHeadline(await docOf()).textProps!
    expect([tp.fontSize, tp.lineHeight]).toEqual([92, 1.45])
    expect(tp.fontFamily).not.toBe('Jua')
  })

  it('calm — 첫 화면 제목만 112·줄 간격 1.4, 장 번호 캡슐은 아트 디렉션 강조색 그대로', async () => {
    const doc = await docOf({ tone: 'calm', basis: 'default' })
    const tp = heroHeadline(doc).textProps!
    expect([tp.fontSize, tp.lineHeight, tp.fontWeight]).toEqual([112, 1.4, 800])
    const caps = named(doc, 'designcut-chapter-bg')
    expect(caps.length).toBeGreaterThan(0)
    for (const cap of caps) expect(cap.shapeProps?.fill?.toUpperCase()).toBe(ART.background.accent)
  })

  it('playful — 첫 화면은 주아 112·1.4, POINT 단추는 페이지 강조색 하나(오너 지시 11-01), 짙은 전환 면 없음', async () => {
    const doc = await docOf(playful)
    const c = playful.colors!
    const tp = heroHeadline(doc).textProps!
    expect([tp.fontFamily, tp.fontSize, tp.lineHeight, tp.fontWeight]).toEqual(['Jua', 112, 1.4, 400])
    const fills = named(doc, 'designcut-chapter-bg').map((e) => e.shapeProps?.fill?.toUpperCase())
    expect(fills.length).toBeGreaterThan(1)
    expect([...new Set(fills)]).toEqual([c.primary])
    const darkFills = doc.sections.map((s) => s.canvas.backgroundColor?.toUpperCase()).filter((f) => f === c.deep || f === designCutPlanForB().palette.deep.toUpperCase())
    expect(darkFills).toEqual([])
  })

  it('POINT 단추 글자는 어떤 강조색에서도 대비 검사를 지난다 — 밝은 노랑·빨강·청록 주색', async () => {
    for (const primary of ['#D9622B', '#F5C518', '#E53935', '#14B8A6', '#FF8FB1']) {
      const doc = await docOf(buildPalette2(PARENT, null, primary, '#1A1A1A'))
      const chapter = checkMobileReadability(doc).violations.filter((v) => v.rule === 'M2' && (v.element ?? '').includes('chapter'))
      expect(chapter, primary).toEqual([])
      expect(new Set(named(doc, 'designcut-chapter-bg').map((e) => e.shapeProps?.fill)).size, primary).toBe(1)
    }
  })

  it('playful도 모바일 판독 규칙을 지킨다(지금 렌더와 같은 기준)', async () => {
    const base = checkMobileReadability(await docOf())
    const p2 = checkMobileReadability(await docOf(playful))
    expect(p2.violations.length).toBeLessThanOrEqual(base.violations.length)
  })

  it('막 바탕 — noDark면 짙은 전환 면(D) 자리가 앞이 흰 면이면 스튜디오(N), 아니면 흰 면(W) — 같은 면 연속 없음', () => {
    const rows: BgRow[] = [
      { key: 'main_cut', role: 'hook', template: 'T1' },
      { key: 'problem_raise', role: 'problem', template: 'T2' },
      { key: 'point_div:0', role: 'usp_feature', template: 'T3a' },
      { key: 'solution_guide', role: 'problem', template: 'T5' },
      { key: 'cta', role: 'cta', template: 'T8' },
    ]
    expect(assignActBackgrounds(rows, false, true)[3]).toBe('D')
    const noDark = assignActBackgrounds(rows, false, true, true)
    // 앞(장면 T3a)이 사진으로 끝나 흰 면부터 — W
    expect(noDark[3]).toBe('W')
    expect(noDark).not.toContain('D')
    const afterWhite: BgRow[] = [
      { key: 'main_cut', role: 'hook', template: 'T1' },
      { key: 'problem_raise', role: 'problem', template: 'T2' },
      { key: 'solution_guide', role: 'problem', template: 'T5' },
    ]
    expect(assignActBackgrounds(afterWhite, false, true, true)).toEqual(['W', 'W', 'N'])
  })

  it('겹침(D2-3) — 큰 첫 화면 제목이 글자 자리를 넘으면 76·72로 줄여 겹침 배치를 지킨다(palette2 켬/끔 모두 겹침)', async () => {
    const scrimOf = (doc: { sections: CanvasSection[] }) =>
      doc.sections.find((s) => s.layoutId === 'designcut_T1')!.elements.some((e) => e.name === 'designcut-scrim')
    const off = await docOf(undefined, true)
    expect(scrimOf(off)).toBe(true)
    for (const p2 of [{ tone: 'calm', basis: 'default' } as DesigncutPalette2, playful]) {
      const on = await docOf(p2, true)
      expect(scrimOf(on), p2.tone).toBe(true)
      const tp = heroHeadline(on).textProps!
      expect(tp.fontSize, p2.tone).toBeGreaterThanOrEqual(72)
      expect(tp.fontFamily === 'Jua', p2.tone).toBe(p2.tone === 'playful')
    }
  })

  it('겹침(D2-3) — 후킹 문장이 있으면 사진 아래로 내리고 제목은 92로 얹는다(R17-L 11잡: 글자 자리 315, 후킹 + 제목은 72에서도 넘침)', async () => {
    for (const p2 of [{ tone: 'calm', basis: 'default' } as DesigncutPalette2, playful]) {
      const doc = await docOf(p2, true, '답례품 포장, 아직 하나씩 하세요?', 2 / 3)
      const t1 = doc.sections.find((s) => s.layoutId === 'designcut_T1')!
      const scene = t1.elements.find((e) => e.name === 'designcut-scene')!
      expect(scene.transform.y, p2.tone).toBe(0)
      expect(heroHeadline(doc).textProps!.fontSize, p2.tone).toBe(92)
      expect(heroHeadline(doc).textProps!.lineHeight, p2.tone).toBe(1.35)
      const hook = t1.elements.find((e) => e.name === 'designcut-hook')!
      expect(hook.transform.y, p2.tone).toBeGreaterThanOrEqual(scene.transform.height)
    }
  })

  it('playful 분위기(T3c) — 밝은 막(글 뒤 + 흐림)·진한 글자·스튜디오 바탕(짙은 면 없음)', async () => {
    const doc = await docOf(playful)
    const t3c = doc.sections.find((s) => s.layoutId === 'designcut_T3c')!
    expect(t3c.canvas.backgroundColor?.toUpperCase()).toBe(playful.colors!.studio)
    const head = t3c.elements.find((e) => e.name === 'designcut-headline')!
    expect(head.textProps?.color?.toUpperCase()).toBe(playful.colors!.heading)
    // 막은 글 자리 아래 SVG(흰 막, 농도는 흰·검은 사진 양쪽 대비 4.5 계산 — 적용 T1-30 D), 글 자리 도형은 투명한 표지
    expect(t3c.elements.find((e) => e.name === 'designcut-scrim')?.shapeProps?.fill).toBe('transparent')
    expect(t3c.elements.find((e) => e.name === 'designcut-scrim-film')?.svgProps?.svgString).toMatch(/stop-color="#FFFFFF" stop-opacity="0\.\d+"/i)
  })
})
