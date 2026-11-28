/**
 * D2 장면 모드(PDP-DR-PLAN §2 C2·C4 — designcut2 잡의 아트 디렉션 + 렌더 v2) — T1·T3a·T8은 무대 띠·액자 없이 860 풀폭 장면 사진,
 * 제목은 흰 띠. 첫 화면은 글자 자리 측정이 통과하면 사진 위 글자 자리에 제목을 얹는다(D2-3). 아트 디렉션이 없거나 v1이면 지금 렌더.
 */

import { describe, expect, it } from 'vitest'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import type { PdpJobRow } from '@/lib/registration/pdp-state'
import { designCutJobB, designCutPlanForB } from './designCut.fixture'
import { assignActBackgrounds, SCENE_FADE_H, type BgRow } from './layout2'
import { COPY_ZONE_H, SCENE_H, sceneBoxOf } from './templatesScene'
import { revertEditorRegen } from '@/lib/registration/pdp-image-regen'
import type { SectionImage } from '@/lib/registration/pdp-state'

const BAND = '#FFFFFF'
/** 계획 강조색(#D9622B)과 다른 아트 디렉션 강조색 — 편집기 토큰이 아트 디렉션을 읽는지 본다 */
const ART_ACCENT = '#2B6CD9'
const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight from the left window', season: 'spring', props: ['linen cloth'] },
  background: { base: BAND, studio: '#F5F2EF', accent: ART_ACCENT },
  corners: 'soft',
}

type Plan = ReturnType<typeof designCutPlanForB> & { layout?: 2; artDirection?: typeof ART }
const planOf = (opts: { layout2?: boolean; art?: boolean; headline?: string; whitePhoto?: boolean } = {}) => {
  const plan = designCutPlanForB() as Plan
  if (opts.layout2 ?? true) plan.layout = 2
  if (opts.art ?? true) plan.artDirection = ART
  if (opts.whitePhoto) Object.assign(plan.palette, { photoBackground: '#FFFFFF', source: 'photo' })
  if (opts.headline) {
    const hero = plan.sections.find((s) => s.template === 'T1')!
    hero.text = { ...hero.text, headline: opts.headline }
  }
  return plan
}
type Zone = { pass: boolean; ink: 'dark' | 'light' }
const jobOf = (plan: unknown, zone?: Zone, heroAspect?: number): PdpJobRow => {
  const job = designCutJobB({ plan })
  const measure = zone ? { ...zone, std: 3, gradient: 0.5, contrast: 12 } : null
  return {
    ...job,
    section_images: job.section_images.map((s) =>
      s.section === 'hero'
        ? {
            ...s,
            ...(measure ? { copyZone: { version: 1, zone: { from: 0, to: 0.33 }, attempt: 1, measure } } : {}),
            ...(heroAspect ? { imageAspect: heroAspect } : {}),
          }
        : s
    ),
  } as PdpJobRow
}
const docOf = (plan: unknown, zone?: Zone, heroAspect?: number) => {
  const job = jobOf(plan, zone, heroAspect)
  return buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
}
const byLayout = (doc: { sections: CanvasSection[] }, layout: string) => doc.sections.filter((s) => s.layoutId === layout)
const named = (sec: CanvasSection, name: string) => sec.elements.filter((e) => e.name === name)
const all = (doc: { sections: CanvasSection[] }, name: string) => doc.sections.flatMap((s) => named(s, name))

describe('D2 장면 모드 — T1·T3a·T8 풀폭 장면 사진 + 흰 띠 제목(C2)', () => {
  it('세 템플릿 모두 사진이 860 풀폭 3:4 cover이고, 무대 띠·contain 제품 사진이 없으며 바탕은 흰 띠', async () => {
    const doc = await docOf(planOf())
    for (const layout of ['designcut_T1', 'designcut_T3a', 'designcut_T8']) {
      const secs = byLayout(doc, layout)
      expect(secs.length, layout).toBeGreaterThan(0)
      for (const sec of secs) {
        const [scene, ...extra] = named(sec, 'designcut-scene')
        expect(extra, layout).toEqual([])
        expect(scene.transform, layout).toMatchObject({ x: 0, width: 860, height: SCENE_H })
        expect(scene.framedImageProps?.objectFit, layout).toBe('cover')
        expect(named(sec, 'designcut-stage'), layout).toEqual([])
        expect(named(sec, 'designcut-product'), layout).toEqual([])
        expect(sec.canvas.backgroundColor, layout).toBe(BAND)
      }
    }
    expect(SCENE_H).toBe(1147)
  })

  it('실제 비율 4:3~3:4 — 정사각 컷은 860×860 그대로, 2:3은 3:4로 cover, 그보다 넓으면 4:3', async () => {
    expect(sceneBoxOf(1).height).toBe(860)
    expect(sceneBoxOf(0.75).height).toBe(1147)
    expect(sceneBoxOf(2 / 3).height).toBe(1147)
    expect(sceneBoxOf(16 / 9).height).toBe(645)
    const doc = await docOf(planOf(), undefined, 1)
    const hero = byLayout(doc, 'designcut_T1')[0]
    expect(named(hero, 'designcut-scene')[0].transform.height).toBe(860)
  })

  it('아트 디렉션이 편집기 토큰 — POINT 캡슐은 아트 디렉션 강조색', async () => {
    const doc = await docOf(planOf())
    const capsule = all(doc, 'designcut-chapter-bg')[0]
    expect(capsule.shapeProps?.fill).toBe(ART_ACCENT)
  })

  it('장면 사진 아래 페이드는 80px(3:4 크롭이 이미 위아래를 잘라 짧게)', async () => {
    const doc = await docOf(planOf())
    const fade = named(byLayout(doc, 'designcut_T1')[0], 'designcut-fade')[0]
    expect(SCENE_FADE_H).toBe(80)
    expect(fade.transform.height).toBe(SCENE_FADE_H)
  })

  it('막 바탕 — 장면 모드의 T1·T3a·T8은 흰 띠(W)이고 짙은 전환 면 후보가 아니다', () => {
    const rows: BgRow[] = [
      { key: 'main_cut', role: 'hook', template: 'T1' },
      { key: 'problem_raise', role: 'problem', template: 'T2' },
      { key: 'point_div:0', role: 'usp_feature', template: 'T3a' },
      { key: 'solution_guide', role: 'problem', template: 'T5' },
      { key: 'cta', role: 'cta', template: 'T8' },
    ]
    const scene = assignActBackgrounds(rows, false, true)
    expect([scene[0], scene[2], scene[4]]).toEqual(['W', 'W', 'W'])
    expect(scene[3]).toBe('D')
    const v2 = assignActBackgrounds(rows, false)
    expect([v2[0], v2[2], v2[4]]).toEqual(['P', 'D', 'D'])
  })

  it('POINT 사진은 직각 장식 액자(rect — T4 장식 대상), 첫 화면·마무리는 장식 대상이 아니다', async () => {
    const doc = await docOf(planOf())
    for (const sec of byLayout(doc, 'designcut_T3a')) {
      expect(named(sec, 'designcut-scene')[0].framedImageProps?.frameId).toBe('rect')
      expect(named(sec, 'designcut-header')[0].shapeProps?.fill).toBe(BAND)
    }
    for (const layout of ['designcut_T1', 'designcut_T8']) {
      for (const sec of byLayout(doc, layout)) expect(named(sec, 'designcut-scene')[0].framedImageProps?.frameId, layout).toBe('designcut')
    }
  })

  it('사진은 제목 띠 아래에서 섹션 끝까지 — 다음 섹션이 있으면 사진 아래를 다음 바탕으로 녹이는 페이드가 붙는다', async () => {
    const doc = await docOf(planOf())
    const t1 = byLayout(doc, 'designcut_T1')[0]
    const scene = named(t1, 'designcut-scene')[0]
    const headline = named(t1, 'designcut-headline')[0]
    expect(scene.transform.y).toBeGreaterThan(headline.transform.y + headline.transform.height)
    expect(scene.transform.y + scene.transform.height).toBe(t1.canvas.height)
    expect(named(t1, 'designcut-fade')).toHaveLength(1)
  })

  it('판독 규칙 — 장면 모드 섹션의 글자는 모두 흰 띠 위라 M2 위반이 없다', async () => {
    const doc = await docOf(planOf())
    const scene = doc.sections.filter((s) => ['designcut_T1', 'designcut_T3a', 'designcut_T8'].includes(s.layoutId))
    const report = checkMobileReadability({ sections: scene })
    expect(report.violations.filter((v) => v.rule === 'M2')).toEqual([])
  })
})

describe('D2-3 첫 화면 겹침 — 글자 자리 통과면 사진 위 글자 자리에 제목(C4)', () => {
  it('통과(짙은 글자): 사진이 맨 위, 제목은 위 글자 자리 안에 제목 본색으로, 스크림 위라 M2 위반 없음, 서브는 사진 아래 흰 띠', async () => {
    const doc = await docOf(planOf(), { pass: true, ink: 'dark' })
    const t1 = byLayout(doc, 'designcut_T1')[0]
    const scene = named(t1, 'designcut-scene')[0]
    expect(scene.transform.y).toBe(0)
    const headline = named(t1, 'designcut-headline')[0]
    expect(headline.transform.y + headline.transform.height).toBeLessThanOrEqual(COPY_ZONE_H)
    expect(headline.textProps?.color).not.toBe('#FFFFFF')
    const scrim = named(t1, 'designcut-scrim')[0]
    expect(scrim.transform.height).toBeLessThanOrEqual(COPY_ZONE_H)
    expect(scrim.zIndex).toBeGreaterThan(scene.zIndex)
    const sub = named(t1, 'designcut-sub')[0]
    expect(sub.transform.y).toBeGreaterThanOrEqual(SCENE_H)
    expect(checkMobileReadability({ sections: [t1] }).violations.filter((v) => v.rule === 'M2')).toEqual([])
  })

  it('사진 배경이 흰색이어도 서브가 사진 아래에 있으면 페이드를 붙이지 않는다(서브 글자를 덮지 않게)', async () => {
    const doc = await docOf(planOf({ whitePhoto: true }), { pass: true, ink: 'dark' })
    const t1 = byLayout(doc, 'designcut_T1')[0]
    expect(named(t1, 'designcut-scene')[0].transform.y).toBe(0)
    expect(named(t1, 'designcut-sub')).toHaveLength(1)
    expect(named(t1, 'designcut-fade')).toEqual([])
  })

  it('글자 자리는 실제 비율로 잰다 — 정사각 컷은 자리(258px)가 좁아 같은 두 줄 제목을 72·1.35로 줄여 얹고, 3:4 컷(344px)은 장면 H1(92) 그대로', async () => {
    expect(sceneBoxOf(1).zone).toBe(258)
    expect(sceneBoxOf(0.75).zone).toBe(344)
    // 첫 화면은 분류 글자를 그리지 않는다(SPACING-LAYOUT.md ③). 후킹 문장이 사진 아래로 내려가는 경우는 designCut-spacing.test가 본다
    const headlineOf = (t1: CanvasSection) => named(t1, 'designcut-headline')[0].textProps!
    const square = byLayout(await docOf(planOf(), { pass: true, ink: 'dark' }, 1), 'designcut_T1')[0]
    expect(named(square, 'designcut-scene')[0].transform.y).toBe(0)
    expect([headlineOf(square).fontSize, headlineOf(square).lineHeight]).toEqual([72, 1.35])
    const tall = byLayout(await docOf(planOf(), { pass: true, ink: 'dark' }, 0.75), 'designcut_T1')[0]
    expect(named(tall, 'designcut-scene')[0].transform.y).toBe(0)
    expect([headlineOf(tall).fontSize, headlineOf(tall).lineHeight]).toEqual([92, 1.45])
  })

  it('통과(흰 글자): 제목이 흰색', async () => {
    const doc = await docOf(planOf(), { pass: true, ink: 'light' })
    const t1 = byLayout(doc, 'designcut_T1')[0]
    expect(named(t1, 'designcut-headline')[0].textProps?.color).toBe('#FFFFFF')
    expect(named(t1, 'designcut-scene')[0].transform.y).toBe(0)
  })

  it('미달이거나 기록이 없거나 제목이 글자 자리보다 길면 흰 띠형(사진이 제목 아래)', async () => {
    const long = '마음을 붙이면 선물이 되는 핸드메이드\n감사 스티커로 답례품 포장을\n한 번에 끝내 보세요'
    for (const [label, doc] of [
      ['미달', await docOf(planOf(), { pass: false, ink: 'dark' })],
      ['기록 없음', await docOf(planOf())],
      ['긴 제목', await docOf(planOf({ headline: long }), { pass: true, ink: 'dark' })],
    ] as const) {
      const t1 = byLayout(doc, 'designcut_T1')[0]
      expect(named(t1, 'designcut-scene')[0].transform.y, label).toBeGreaterThan(0)
      expect(named(t1, 'designcut-scrim'), label).toEqual([])
    }
  })

  it('편집기 응답은 hero 글자 자리 기록이 있을 때만 hero_copy_zone, 아트 디렉션 잡의 비율 기록만 image_aspects를 싣는다', () => {
    const plan = planOf()
    const withAll = assembleEditorDataResponse(jobOf(plan, { pass: true, ink: 'light' }, 0.75), null)
    expect(withAll.hero_copy_zone).toEqual({ pass: true, ink: 'light' })
    expect(Object.values(withAll.image_aspects ?? {})).toEqual([0.75])
    const none = assembleEditorDataResponse(jobOf(plan), null)
    expect('hero_copy_zone' in none).toBe(false)
    expect('image_aspects' in none).toBe(false)
    expect('image_aspects' in assembleEditorDataResponse(jobOf(planOf({ art: false }), undefined, 0.75), null)).toBe(false)
  })

  it('편집기 재생성 되돌리기는 글자 자리 기록도 컷과 함께 맞바꾼다', () => {
    const zoneOf = (pass: boolean) => ({ version: 1 as const, zone: { from: 0, to: 0.33 }, attempt: 1 as const, measure: { pass, std: 3, gradient: 1, contrast: 9, ink: 'dark' as const } })
    const entry: SectionImage = {
      section: 'hero',
      url: 'https://cdn.test/hero-new.png',
      copyZone: zoneOf(false),
      editorRegen: {
        status: 'done',
        requestedAt: '2026-10-31T00:00:00.000Z',
        previousUrl: 'https://cdn.test/hero-old.png',
        previous: { copyZone: zoneOf(true) },
      } as SectionImage['editorRegen'],
    }
    const back = revertEditorRegen(entry, '2026-10-31T01:00:00.000Z')!
    expect(back.url).toBe('https://cdn.test/hero-old.png')
    expect(back.copyZone?.measure?.pass).toBe(true)
    expect(back.editorRegen?.previous?.copyZone?.measure?.pass).toBe(false)
    const plain = revertEditorRegen({ ...entry, copyZone: undefined, editorRegen: { ...entry.editorRegen!, previous: {} } }, '2026-10-31T01:00:00.000Z')!
    expect(plain.copyZone).toBeUndefined()
  })
})

describe('장면 모드가 아닌 잡 — 지금 렌더 그대로', () => {
  it('아트 디렉션이 없는 v2·아트 디렉션이 있는 v1은 장면 사진이 없고 무대·제품 사진 그대로, 글자 자리 기록도 무시', async () => {
    for (const [label, plan] of [
      ['v2만', planOf({ art: false })],
      ['아트 디렉션 + v1', planOf({ layout2: false })],
    ] as const) {
      const doc = await docOf(plan, { pass: true, ink: 'dark' })
      expect(all(doc, 'designcut-scene'), label).toEqual([])
      expect(all(doc, 'designcut-product').length, label).toBeGreaterThan(0)
    }
  })
})
