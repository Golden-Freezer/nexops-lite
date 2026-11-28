/**
 * D2 여백·줄 간격·첫 화면·노란색(SPACING-LAYOUT.md ①③④) — 장면 모드(계획 layout 2 + 아트 디렉션)만 바뀌고 그 밖의 잡은 그대로.
 * LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import type { DesigncutPalette2 } from '@/lib/registration/pdp-state'
import { buildPalette2 } from '@/lib/registration/internalized/art-palette'
import { composeDesignCut } from './compose'
import { readDesignCut } from './contract'
import { designCutJobB, designCutPlanForB } from './designCut.fixture'
import { SCENE_SPACE, WHITE, isYellowHue, onColor } from './tokens'

const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight from the left window', season: 'spring', props: ['linen cloth'] },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
  corners: 'soft',
}
/** 고정물 계획 팔레트의 잉크 */
const INK = '#1A1A1A'
const PARENT = { enrichment: { version: 1, features: [], audience: { kind: 'parent_proxy', version: 1, basis: 'name_tags', terms: ['어린이집'], ageGate: false } } }
const HOOK = '답례품 포장, 아직 하나씩 하세요?'
const ONE_LINE = '선물이 됩니다'

type Opts = { art?: boolean; accent?: string; palette2?: DesigncutPalette2 }
const planOf = ({ art = true, accent, palette2 }: Opts = {}) => {
  const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
  plan.layout = 2
  if (art) plan.artDirection = { ...ART, background: { ...ART.background, ...(accent ? { accent } : {}) }, ...(palette2 ? { palette2 } : {}) }
  return plan
}
const docOf = (opts: Opts = {}) => {
  const job = designCutJobB({ plan: planOf(opts) })
  return buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
}
/**
 * 계획 T1에 후킹 문장(hook)을 넣어 바로 조립한다 — hook 칸의 계약 읽기는 C 구조 PR(pdp-design-structure) 몫이라 읽은 기록에 넣는다.
 * zone: 첫 화면 글자 자리 통과(D2-3 겹침), aspect: 장면 사진 가로/세로(기본 3:4 — 글자 자리 344, 정사각은 258), headline: 제목 바꾸기
 */
const heroWith = (hook: string | null, zone = false, aspect = 0.75, headline?: string, sub?: null) => {
  const job = designCutJobB({ plan: planOf() })
  const images = assembleEditorDataResponse(job, null).generated_images as Record<string, string | string[]>
  const plan = readDesignCut(job.section_plan)!
  const hero = plan.sections.find((s) => s.template === 'T1')!
  if (hook) Object.assign(hero.text, { hook })
  if (headline) hero.text = { ...hero.text, headline }
  if (sub === null) hero.text = { ...hero.text, sub: null }
  const aspects = Object.fromEntries(Object.values(images).flat().map((url) => [url, aspect]))
  const out = composeDesignCut([], plan, {
    images,
    sectionOrder: [],
    heroCopyZone: zone ? { pass: true, ink: 'dark' } : null,
    imageAspects: aspects,
  })
  return out.find((s) => s.layoutId === 'designcut_T1')!
}
/** 흰 글자 겹침(자리가 어두운 사진) — 두 줄 제목 + hook, 2:3 */
const heroWithInk = (hook: string, ink: 'dark' | 'light') => {
  const job = designCutJobB({ plan: planOf() })
  const images = assembleEditorDataResponse(job, null).generated_images as Record<string, string | string[]>
  const plan = readDesignCut(job.section_plan)!
  Object.assign(plan.sections.find((s) => s.template === 'T1')!.text, { hook })
  const aspects = Object.fromEntries(Object.values(images).flat().map((url) => [url, 2 / 3]))
  const out = composeDesignCut([], plan, { images, sectionOrder: [], heroCopyZone: { pass: true, ink }, imageAspects: aspects })
  return out.find((s) => s.layoutId === 'designcut_T1')!
}
const named = (sec: CanvasSection, name: string) => sec.elements.filter((e) => e.name === name)
const one = (sec: CanvasSection, name: string) => {
  const [el] = named(sec, name)
  expect(el, name).toBeDefined()
  return el
}
const allNamed = (doc: { sections: CanvasSection[] }, name: string) => doc.sections.flatMap((s) => named(s, name))
const bottom = (e: CanvasElement) => e.transform.y + e.transform.height
const lineHeights = (els: CanvasElement[]) => [...new Set(els.map((e) => e.textProps!.lineHeight))]
const byLayout = (doc: { sections: CanvasSection[] }, layout: string) => doc.sections.filter((s) => s.layoutId === layout)
/** 내용 위·아래 끝 — 섹션 전면 바탕 도형(80% 이상)은 내용으로 세지 않는다(compose contentSpan·판독 규칙 M4와 같은 기준) */
const spanOf = (s: CanvasSection) => {
  const content = s.elements.filter(
    (e) => e.transform.height > 0 && !(e.type === 'shape' && e.transform.width >= 860 * 0.8 && e.transform.height >= s.canvas.height * 0.8)
  )
  return { top: Math.min(...content.map((e) => e.transform.y)), bottom: Math.max(...content.map(bottom)) }
}
/** 이웃 섹션 경계의 빈 바탕(앞 섹션 아래 여백 + 뒤 섹션 위 여백) */
const seamsOf = (doc: { sections: CanvasSection[] }) =>
  doc.sections.slice(1).map((b, i) => {
    const a = doc.sections[i]
    return { from: a.layoutId, to: b.layoutId, blank: Math.round(a.canvas.height - spanOf(a).bottom + spanOf(b).top) }
  })
const isCut = (layout: string) => layout.startsWith('designcut_')

describe('D2 여백·줄 간격(SPACING-LAYOUT.md ①) — 장면 모드만', () => {
  it('제목 줄 간격 1.45·설명 1.7(크기는 K와 같은 H1 92·H2 74), 캡슐 라벨은 높이 64 안 한 줄이라 1.2 그대로', async () => {
    const doc = await docOf()
    const heads = allNamed(doc, 'designcut-headline')
    expect(heads.length).toBeGreaterThan(5)
    expect(lineHeights(heads)).toEqual([1.45])
    expect(new Set(heads.map((e) => e.textProps!.fontSize))).toEqual(new Set([92, 74]))
    expect(lineHeights(allNamed(doc, 'designcut-sub'))).toEqual([1.7])
    expect(lineHeights(allNamed(doc, 'designcut-chapter-text'))).toEqual([1.2])
    // 캡슐 글자는 캡슐 안 — 판독 규칙 M2(글자 밑 바탕 대비)가 캡슐 채움으로 잰다
    for (const sec of doc.sections) {
      const texts = named(sec, 'designcut-chapter-text')
      named(sec, 'designcut-chapter-bg').forEach((b, i) => expect(bottom(texts[i])).toBeLessThanOrEqual(bottom(b)))
    }
  })

  it('간격 — 첫 화면은 위 120 → 제목 → 48 → 보조 효익 → 88 → 사진, POINT 장 머리는 위 120·글→사진 88', async () => {
    const doc = await docOf()
    const t1 = byLayout(doc, 'designcut_T1')[0]
    const [head, sub, photo] = ['designcut-headline', 'designcut-sub', 'designcut-scene'].map((n) => one(t1, n))
    expect(head.transform.y).toBe(SCENE_SPACE.top)
    expect(sub.transform.y - bottom(head)).toBe(SCENE_SPACE.titleGap)
    expect(photo.transform.y - bottom(sub)).toBe(SCENE_SPACE.photoGap)
    const points = byLayout(doc, 'designcut_T3a')
    expect(points.length).toBeGreaterThan(0)
    for (const sec of points) {
      const scene = one(sec, 'designcut-scene')
      expect(one(sec, 'designcut-chapter-bg').transform.y).toBe(SCENE_SPACE.top)
      const textBottom = Math.max(...sec.elements.filter((e) => e.type === 'text' && e.transform.y < scene.transform.y).map(bottom))
      expect(scene.transform.y - textBottom).toBe(SCENE_SPACE.photoGap)
    }
  })

  it('경계 — 글로 끝나는 디자인 컷 섹션은 아래 여백 120, 경계 빈 바탕 260 이하(글 → 다음 장 제목 240), 판독 규칙 M4 위반 없음', async () => {
    const doc = await docOf()
    const PHOTO_END = new Set(['designcut_T1', 'designcut_T3a', 'designcut_T3c', 'designcut_T8'])
    const textEnd = doc.sections.filter((s) => isCut(s.layoutId) && !PHOTO_END.has(s.layoutId))
    expect(textEnd.length).toBeGreaterThan(3)
    for (const s of textEnd) expect(Math.round(s.canvas.height - spanOf(s).bottom), s.layoutId).toBe(SCENE_SPACE.bottom)
    const seams = seamsOf(doc)
    expect(Math.max(...seams.map((x) => x.blank))).toBeLessThanOrEqual(260)
    expect(seams.filter((x) => isCut(x.from) && isCut(x.to) && !PHOTO_END.has(x.from) && x.blank === 240).length).toBeGreaterThanOrEqual(2)
    expect(checkMobileReadability({ sections: doc.sections }).violations.filter((v) => v.rule === 'M4')).toEqual([])
  })

  it('풀폭 사진·무드 판으로 끝나는 섹션은 사진이 아래 끝(밑에 빈 띠 없음)', async () => {
    const doc = await docOf()
    for (const layout of ['designcut_T1', 'designcut_T3a', 'designcut_T3c', 'designcut_T8']) {
      const secs = byLayout(doc, layout)
      expect(secs.length, layout).toBeGreaterThan(0)
      for (const sec of secs) {
        const photoBottom = Math.max(...sec.elements.filter((e) => e.type === 'framed-image' && e.transform.width >= 860).map(bottom))
        expect(photoBottom, layout).toBe(sec.canvas.height)
      }
    }
  })

  it('장면 모드가 아니면(아트 디렉션 없는 v2) 지금 그대로 — 제목 1.25·설명 1.45, 첫 화면 분류 글자, 경계 180 이하', async () => {
    const doc = await docOf({ art: false })
    expect(Math.max(...seamsOf(doc).map((x) => x.blank))).toBeLessThanOrEqual(180)
    expect(lineHeights(allNamed(doc, 'designcut-headline'))).toEqual([1.25])
    expect(lineHeights(allNamed(doc, 'designcut-sub'))).toEqual([1.45])
    expect(named(byLayout(doc, 'designcut_T1')[0], 'designcut-eyebrow').map((e) => e.textProps!.content)).toEqual(['선물포장 스티커'])
  })
})

describe('D2 첫 화면(SPACING-LAYOUT.md ③) — 분류 글자 없이 후킹 문장 → 제목 → 보조 효익 → 사진', () => {
  it('띠형 — 분류 글자(eyebrow)는 그리지 않고, hook이 있으면 위 120에 hook, 24 아래 제목', () => {
    const plain = heroWith(null)
    expect(named(plain, 'designcut-eyebrow')).toEqual([])
    expect(named(plain, 'designcut-hook')).toEqual([])
    const t1 = heroWith(HOOK)
    expect(named(t1, 'designcut-eyebrow')).toEqual([])
    const [hook, head, sub, photo] = ['designcut-hook', 'designcut-headline', 'designcut-sub', 'designcut-scene'].map((n) => one(t1, n))
    expect(hook.textProps!.content).toBe(HOOK)
    expect(hook.transform.y).toBe(SCENE_SPACE.top)
    expect(head.transform.y).toBe(bottom(hook) + 24)
    expect(sub.transform.y).toBe(bottom(head) + SCENE_SPACE.titleGap)
    expect(photo.transform.y).toBe(bottom(sub) + SCENE_SPACE.photoGap)
  })

  it('겹침 — 사진 위 글자 자리에 hook → 제목(스크림 안), 분류 글자 없음, 서브는 사진 아래 48', () => {
    // hook이 붙으면 두 줄 제목은 3:4 자리에도 넘쳐 hook이 사진 아래로 내려간다(아래 시험) — 한 줄 제목으로 사진 위 hook을 본다
    const t1 = heroWith(HOOK, true, 0.75, ONE_LINE)
    const [hook, head, scrim, photo, sub] = ['designcut-hook', 'designcut-headline', 'designcut-scrim', 'designcut-scene', 'designcut-sub'].map((n) =>
      one(t1, n)
    )
    expect(photo.transform.y).toBe(0)
    expect(named(t1, 'designcut-eyebrow')).toEqual([])
    expect(bottom(hook)).toBeLessThanOrEqual(head.transform.y)
    expect(bottom(head)).toBeLessThanOrEqual(bottom(scrim))
    expect(sub.transform.y).toBe(bottom(photo) + SCENE_SPACE.titleGap)
    expect(checkMobileReadability({ sections: [t1] }).violations.filter((v) => v.rule === 'M2')).toEqual([])
  })

  it('겹침 — 글자 자리에 맞춰 제목을 줄여도 줄 간격은 첫 화면 하한 1.35 이상(정사각 자리 258에 두 줄 제목은 72·1.35)', () => {
    const square = heroWith(null, true, 1)
    expect(one(square, 'designcut-scene').transform.y).toBe(0)
    const tp = one(square, 'designcut-headline').textProps!
    expect([tp.fontSize, tp.lineHeight]).toEqual([72, 1.35])
    for (const aspect of [1, 0.75, 2 / 3]) {
      for (const hook of [null, HOOK]) {
        const lh = one(heroWith(hook, true, aspect), 'designcut-headline').textProps!.lineHeight
        expect(lh, `${aspect} ${hook}`).toBeGreaterThanOrEqual(1.35)
      }
    }
  })

  it('겹침 — hook까지 글자 자리에 안 들면 겹침을 지키고 hook을 사진 아래 흰 띠로 내린다(순서: 사진 → hook → 서브)', () => {
    // 3:4(344)·2:3(315, R17-L 11잡 전부)·정사각(258) 모두 두 줄 제목 + hook은 넘친다
    for (const aspect of [0.75, 2 / 3, 1]) {
      const t1 = heroWith(HOOK, true, aspect)
      const [hook, head, scrim, photo, sub] = ['designcut-hook', 'designcut-headline', 'designcut-scrim', 'designcut-scene', 'designcut-sub'].map((n) =>
        one(t1, n)
      )
      expect(photo.transform.y, `${aspect}`).toBe(0)
      expect(bottom(head), `${aspect}`).toBeLessThanOrEqual(bottom(scrim))
      // 스크림은 사진 위 제목만 품는다 — 내린 hook 높이만큼 사진을 더 가리지 않는다
      expect(bottom(scrim), `${aspect}`).toBe(bottom(head) + 12)
      expect(hook.transform.y, `${aspect}`).toBe(bottom(photo) + SCENE_SPACE.titleGap)
      expect(sub.transform.y, `${aspect}`).toBe(bottom(hook) + 24)
      expect(t1.canvas.height, `${aspect}`).toBe(bottom(sub) + SCENE_SPACE.bottom)
      expect(checkMobileReadability({ sections: [t1] }).violations.filter((v) => v.rule === 'M2'), `${aspect}`).toEqual([])
    }
  })

  it('겹침 — 한 줄 제목이라도 hook을 얹으려고 줄 간격을 하한까지 줄이지 않는다(정사각 자리 258이면 hook은 사진 아래)', () => {
    const t1 = heroWith(HOOK, true, 1, ONE_LINE)
    expect(one(t1, 'designcut-hook').transform.y).toBeGreaterThanOrEqual(bottom(one(t1, 'designcut-scene')))
    expect(one(t1, 'designcut-headline').textProps!.lineHeight).toBe(1.45)
  })

  it('겹침 — 막은 글자 뒤 같은 농도로 깔고 아래는 사진으로 녹으며 사진 밖으로 나가지 않는다', () => {
    const t1 = heroWith(HOOK, true, 2 / 3)
    const [film, scrim, photo, head] = ['designcut-scrim-film', 'designcut-scrim', 'designcut-scene', 'designcut-headline'].map((n) => one(t1, n))
    expect(film.transform.y).toBe(0)
    expect(bottom(film)).toBe(bottom(scrim) + 200)
    expect(bottom(film)).toBeLessThanOrEqual(bottom(photo))
    expect([photo.zIndex < film.zIndex, film.zIndex < head.zIndex]).toEqual([true, true])
    expect(scrim.shapeProps?.fill).toBe('transparent')
    const stops = [...film.svgProps!.svgString.matchAll(/stop-opacity="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(stops).toEqual([0.35, 0.35, 0])
    expect(checkMobileReadability({ sections: [t1] }).violations.filter((v) => v.rule === 'M2')).toEqual([])
  })

  it('겹침 — 짙은 자리(흰 글자)는 deep 28% 막', () => {
    const stops = [...one(heroWithInk(HOOK, 'light'), 'designcut-scrim-film').svgProps!.svgString.matchAll(/stop-opacity="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(stops).toEqual([0.28, 0.28, 0])
  })

  it('겹침 — 내린 hook은 사진 위 글자색이 아니라 흰 띠 위 라벨색이다', () => {
    const light = heroWithInk(HOOK, 'light')
    const hook = one(light, 'designcut-hook')
    expect(hook.transform.y).toBeGreaterThanOrEqual(bottom(one(light, 'designcut-scene')))
    expect(hook.textProps!.color?.toUpperCase()).not.toBe('#FFFFFF')
    expect(one(light, 'designcut-headline').textProps!.color?.toUpperCase()).toBe('#FFFFFF')
  })

  it('겹침 — hook을 내려도 글은 빠지지 않고, 서브가 없으면 hook 아래가 섹션 끝이다', () => {
    const t1 = heroWith(HOOK, true, 2 / 3)
    expect(one(t1, 'designcut-hook').textProps!.content).toBe(HOOK)
    const noSub = heroWith(HOOK, true, 2 / 3, undefined, null)
    expect(named(noSub, 'designcut-sub')).toEqual([])
    expect(noSub.canvas.height).toBe(bottom(one(noSub, 'designcut-hook')) + SCENE_SPACE.bottom)
  })

  it('겹침 — hook 없는 제목만이면 사진 아래 글은 서브뿐이고, 서브도 없으면 사진이 섹션 끝이다', () => {
    const t1 = heroWith(null, true, 2 / 3)
    expect(named(t1, 'designcut-hook')).toEqual([])
    expect(one(t1, 'designcut-sub').transform.y).toBe(bottom(one(t1, 'designcut-scene')) + SCENE_SPACE.titleGap)
    const bare = heroWith(null, true, 2 / 3, undefined, null)
    expect(bare.canvas.height).toBe(bottom(one(bare, 'designcut-scene')))
  })

  it('측정 미달·기록 없음은 hook이 있어도 지금처럼 띠형이다(겹침을 얹지 않는다)', () => {
    const t1 = heroWith(HOOK, false, 2 / 3)
    expect(one(t1, 'designcut-scene').transform.y).toBeGreaterThan(0)
    expect(named(t1, 'designcut-scrim')).toEqual([])
    expect(bottom(one(t1, 'designcut-hook'))).toBeLessThanOrEqual(one(t1, 'designcut-headline').transform.y)
  })
})

describe('노란 주색(SPACING-LAYOUT.md ④) — 강조 글자·장 번호는 잉크, 강조 구절은 형광 띠, 짙은 면은 잉크', () => {
  it('노란 색상각 판정(LCh h 70~110) — 황토·앰버·겨자·금색·노랑, 주황(h 50)·연두(h 120)·무채·하늘은 아님', () => {
    // #B78936: render-check 잡(R5-D P02 구디백) 계획 강조색(h 79.5) — 강조 글자 #8C630C가 오너가 지적한 탁한 색
    for (const c of ['#B78936', '#E6A23C', '#FFBF00', '#F2C230', '#E2B33C', '#F6D55D', '#FFFF00']) expect(isYellowHue(c), c).toBe(true)
    for (const c of ['#D9622B', '#9ACD32', '#8A8A8A', '#2B6CD9', '#FFFFFF']) expect(isYellowHue(c), c).toBe(false)
  })

  /** 밝은 면의 장 번호·제목은 잉크, 제목 강조 구절은 형광 띠뿐(글자색 강조 없음) */
  const expectInkAndHighlight = (doc: { sections: CanvasSection[] }) => {
    const numbers = allNamed(doc, 'designcut-chapter-number')
    expect(numbers.length).toBeGreaterThan(0)
    for (const n of numbers) expect(n.textProps!.color.toUpperCase()).toBe(INK)
    const heads = [...byLayout(doc, 'designcut_T1'), ...byLayout(doc, 'designcut_T3a')].flatMap((s) => named(s, 'designcut-headline'))
    for (const e of heads) expect(e.textProps!.color.toUpperCase()).toBe(INK)
    const rich = heads
      .map((e) => e.textProps!.richContent)
      .filter((r): r is string => Boolean(r))
    expect(rich.length).toBeGreaterThan(0)
    for (const r of rich) {
      expect(r).toContain('background-color')
      expect(r).not.toMatch(/(^|[^-])color:/)
    }
  }

  it('D2 장면 모드 강조색이 노랑 — 장 번호·제목 잉크·형광 띠, 캡슐 글자 잉크, 짙은 면(D)은 잉크', async () => {
    const doc = await docOf({ accent: '#F2C230' })
    expectInkAndHighlight(doc)
    for (const t of allNamed(doc, 'designcut-chapter-text')) expect(t.textProps!.color.toUpperCase()).toBe(INK)
    const dark = doc.sections.filter((s) => s.layoutId.startsWith('designcut_') && onColor(s.canvas.backgroundColor, INK) === WHITE)
    expect(dark.length).toBeGreaterThan(0)
    for (const s of dark) expect(s.canvas.backgroundColor.toUpperCase(), s.layoutId).toBe(INK)
  })

  it('palette2 버터 주색(playful) — 장 번호·제목 잉크·형광 띠', async () => {
    const palette2 = buildPalette2(PARENT, null, '#E2B33C', INK)
    expect(palette2.colors!.accentText).toBe(INK)
    expectInkAndHighlight(await docOf({ palette2 }))
  })

  it('예전에 기록된 버터 계획(강조 글자·짙은 색이 같은 색상각의 올리브)도 첫 빌드에서 잉크·형광 띠로 그린다', async () => {
    const fresh = buildPalette2(PARENT, null, '#E2B33C', INK)
    const old = { ...fresh, colors: { ...fresh.colors!, accentText: '#806C02', heading: '#3A3520', deep: '#5C4B0E' } }
    expectInkAndHighlight(await docOf({ palette2: old }))
  })

  it('노랑이 아닌 강조색은 지금처럼 같은 색상각의 강조 글자(형광 띠 아님)', async () => {
    const doc = await docOf()
    const rich = allNamed(doc, 'designcut-headline')
      .map((e) => e.textProps!.richContent)
      .filter((r): r is string => Boolean(r))
    expect(rich.length).toBeGreaterThan(0)
    for (const r of rich) expect(r).not.toContain('background-color')
  })
})
