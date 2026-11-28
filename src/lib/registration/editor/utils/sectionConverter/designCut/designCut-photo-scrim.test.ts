/**
 * 적용 T1-30 D(보고서 A3 #11 사진 위 글 대비) — 플레이트 사진 위 글(T3c 분위기·T8 사진 없는 마무리)의 막을 K image.overlay와 같은 계산으로 깐다:
 * 흰·검은 사진 양쪽에서 글자 대비 4.5가 되는 가장 옅은 농도(overlayFilm)를 글 뒤에만, 아래 200은 흐림(scrimFilmSvg), 막은 사진 높이의 60% 이하.
 * 내보내기 HTML도 편집기와 같은 SVG 막을 싣는다(이미지 내보내기는 편집기 DOM 캡처라 같은 요소).
 */

import { describe, expect, it } from 'vitest'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import { checkMobileReadability, contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { exportHtml } from '@/lib/registration/editor/utils/exportUtils/htmlBuilders'
import { OVERLAY_MIN_CONTRAST, OVERLAY_SCRIM_MAX, SCRIM_FILM_NAME, SCRIM_NAME, scrimIssues, textsOnScrim } from '@/lib/registration/templatelib/overlay'
import { designCutJobB, designCutPlanForB } from './designCut.fixture'
import { mix } from './tokens'

const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight', season: 'spring', props: ['linen cloth'] },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
  corners: 'soft',
}
type Mode = 'v1' | 'v2' | 'scene'
type Plan = ReturnType<typeof designCutPlanForB> & { layout?: 2; artDirection?: unknown }
function planOf(mode: Mode, edit: (plan: Plan) => void = () => {}): Plan {
  const plan = designCutPlanForB() as Plan
  if (mode !== 'v1') plan.layout = 2
  if (mode === 'scene') plan.artDirection = ART
  edit(plan)
  return plan
}
const docOf = async (plan: unknown) => {
  const job = designCutJobB({ plan })
  return buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
}
/** T8을 사진 없는 플레이트 변형으로 — 제품 사진 키를 뺀다 */
const plateCta = (plan: Plan) => {
  const cta = plan.sections.find((s) => s.key === 'cta')!
  cta.productImageKey = null as never
}
const longCopy = (plan: Plan) => {
  const story = plan.sections.find((s) => s.key === 'concept_desc')!
  story.text = { ...story.text, headline: '말 대신 스티커 한 장으로 고마운 마음을 전해요', sub: '받는 사람이 봉투를 여는 순간까지 마음이 이어지도록, 한 장 한 장 손으로 붙이는 시간을 담았어요. 답례품마다 다른 이야기를 더해 보세요.' }
}
const named = (sec: CanvasSection, name: string) => sec.elements.find((e) => e.name === name)
const cr = (a: string, b: string) => contrastRatio(parseColor(a)!, parseColor(b)!)
/** 막 SVG의 색·농도 — 글 뒤(첫 정지점) */
function filmOf(el: CanvasElement): { color: string; alpha: number } {
  const m = /stop-color="(#[0-9a-fA-F]{6})" stop-opacity="([\d.]+)"/.exec(el.svgProps!.svgString)!
  return { color: m[1], alpha: Number(m[2]) }
}

const CASES: Array<[string, Mode, string, (plan: Plan) => void]> = [
  ['T3c v1', 'v1', 'designcut_T3c', () => {}],
  ['T3c v2', 'v2', 'designcut_T3c', () => {}],
  ['T3c 장면', 'scene', 'designcut_T3c', () => {}],
  ['T3c 긴 글(장면)', 'scene', 'designcut_T3c', longCopy],
  ['T8 플레이트 v1', 'v1', 'designcut_T8', plateCta],
  ['T8 플레이트 v2', 'v2', 'designcut_T8', plateCta],
]

describe('플레이트 사진 위 글 막(T1-30 D)', () => {
  it.each(CASES)('%s: 막은 글 뒤에만(사진 60% 이하)·바로 아래 SVG 막·글은 막 위 — K 판정(scrimIssues) 통과', async (_, mode, layout, edit) => {
    const sec = (await docOf(planOf(mode, edit))).sections.find((s) => s.layoutId === layout)!
    const scrim = named(sec, SCRIM_NAME)!
    const photo = named(sec, 'designcut-plate')!
    expect(scrim.shapeProps!.fill).toBe('transparent')
    expect(scrimIssues(sec.elements, OVERLAY_SCRIM_MAX)).toEqual([])
    expect(scrim.transform.height / photo.transform.height).toBeLessThanOrEqual(OVERLAY_SCRIM_MAX)
    const onScrim = textsOnScrim(sec.elements)
    for (const t of sec.elements.filter((e) => e.type === 'text' && /headline|sub/.test(e.name))) expect(onScrim.has(t.id), t.name).toBe(true)
    // 흐림 띠는 사진 밖으로 나가지 않는다
    const film = named(sec, SCRIM_FILM_NAME)!
    expect(film.transform.y + film.transform.height).toBeLessThanOrEqual(photo.transform.y + photo.transform.height)
  })

  it.each(CASES)('%s: 흰·검은 사진 어느 쪽이어도 글자 대비 4.5 이상(막 색·농도 계산)', async (_, mode, layout, edit) => {
    const sec = (await docOf(planOf(mode, edit))).sections.find((s) => s.layoutId === layout)!
    const film = filmOf(named(sec, SCRIM_FILM_NAME)!)
    const texts = sec.elements.filter((e) => e.type === 'text' && /headline|sub/.test(e.name))
    expect(texts.length).toBeGreaterThan(0)
    for (const t of texts)
      for (const photo of ['#FFFFFF', '#000000']) expect(cr(t.textProps!.color, mix(photo, film.color, film.alpha)), `${t.name} ${photo}`).toBeGreaterThanOrEqual(OVERLAY_MIN_CONTRAST)
  })

  it('예전 고정 막(deep 0.45)은 흰 사진에서 4.5에 못 미친다 — 이 픽스처 팔레트도(바꾼 까닭)', async () => {
    const sec = (await docOf(planOf('v1'))).sections.find((s) => s.layoutId === 'designcut_T3c')!
    const film = filmOf(named(sec, SCRIM_FILM_NAME)!)
    const head = named(sec, 'designcut-headline')!
    expect(cr(head.textProps!.color, mix('#FFFFFF', film.color, 0.45))).toBeLessThan(OVERLAY_MIN_CONTRAST)
    expect(film.alpha).toBeGreaterThan(0.45)
  })

  it('모바일 검사 위반 0(v1·v2·장면, T8 플레이트 변형 포함)', async () => {
    for (const mode of ['v1', 'v2', 'scene'] as const) {
      const doc = await docOf(planOf(mode, plateCta))
      const sections = doc.sections.filter((s) => s.layoutId === 'designcut_T3c' || s.layoutId === 'designcut_T8')
      expect(sections).toHaveLength(2)
      expect(checkMobileReadability({ ...doc, sections }).violations.filter((v) => v.rule !== 'M3'), mode).toEqual([])
    }
  })

  it('내보내기 HTML은 편집기와 같은 막 SVG(글 뒤 농도·흐림 정지점)와 투명한 글 자리를 싣는다', async () => {
    const sec = (await docOf(planOf('v2'))).sections.find((s) => s.layoutId === 'designcut_T3c')!
    const film = named(sec, SCRIM_FILM_NAME)!
    const html = exportHtml([sec], null)
    expect(html).toContain(film.svgProps!.svgString)
    expect(film.svgProps!.svgString).toMatch(/<linearGradient[^>]*>.*stop-opacity="0"/)
    expect(html).not.toMatch(/rgba\(\d+, \d+, \d+, 0\.45\)/)
  })

  it('플레이트가 없는 T8은 막 SVG 없이 지금처럼(짙은 바탕 위 옅은 띠)', async () => {
    const job = designCutJobB({ plan: planOf('v1', plateCta), withPlates: false })
    const bare = await buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
    const sec = bare.sections.find((s) => s.layoutId === 'designcut_T8')!
    expect(named(sec, 'designcut-plate')).toBeUndefined()
    expect(named(sec, SCRIM_FILM_NAME)).toBeUndefined()
    expect(named(sec, SCRIM_NAME)!.shapeProps!.fill).toMatch(/^rgba\(/)
  })
})
