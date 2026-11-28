/**
 * fontpair 편집기 렌더 — D2 장면 모드에서 아트 디렉션의 글꼴 짝을 읽어 페이지 모든 섹션(그대로 두는 기존 섹션 포함)의 제목 수준
 * (display·h1·h2) 글자에 제목 글꼴·굵기를 입힌다. 크기와 본문·표·캡션은 그대로, 글꼴 짝이 없으면 지금 렌더 그대로.
 */

import { describe, expect, it } from 'vitest'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import type { DesigncutFontPair, DesigncutPalette2 } from '@/lib/registration/pdp-state'
import { designCutJobB, designCutPlanForB } from './designCut.fixture'

const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight from the left window', season: 'spring', props: ['linen cloth'] },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
  alignment: { hero: 'center', closing: 'center', body: 'left' },
  corners: 'soft',
}
const PAIR: Record<DesigncutFontPair['tone'], DesigncutFontPair> = {
  playful: { tone: 'playful', basis: 'target_terms', heading: 'Jua', weight: 400, body: 'Pretendard' },
  premium: { tone: 'premium', basis: 'category', heading: 'Hahmlet', weight: 700, body: 'Pretendard' },
  handwritten: { tone: 'handwritten', basis: 'hand_terms', heading: 'Gaegu', weight: 400, body: 'Pretendard' },
  everyday: { tone: 'everyday', basis: 'default', heading: 'SUIT Variable', weight: 800, body: 'Pretendard' },
}

const docOf = (extra: { fontPair?: DesigncutFontPair; palette2?: DesigncutPalette2 } = {}) => {
  const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
  plan.layout = 2
  plan.artDirection = { ...ART, ...extra }
  const job = designCutJobB({ plan })
  return buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
}
const texts = (doc: { sections: CanvasSection[] }, pick: (s: CanvasSection) => boolean) =>
  doc.sections.filter(pick).flatMap((s) => s.elements.filter((e) => e.type === 'text' && e.textProps))
const designcut = (s: CanvasSection) => Boolean(s.layoutId?.startsWith('designcut_'))
const heading = (e: { textProps?: { typoLevel?: string } }) => ['display', 'h1', 'h2'].includes(e.textProps?.typoLevel ?? '')

describe('fontpair 편집기 렌더', () => {
  it('글꼴 짝이 없으면 지금 렌더 그대로(제목은 기본 글꼴)', async () => {
    const doc = await docOf()
    expect(texts(doc, designcut).filter(heading).some((e) => ['Jua', 'Hahmlet', 'SUIT Variable'].includes(e.textProps!.fontFamily))).toBe(false)
  })

  for (const tone of ['playful', 'premium', 'handwritten', 'everyday'] as const) {
    it(`${tone} — 모든 섹션의 제목 수준 글자는 ${PAIR[tone].heading} ${PAIR[tone].weight}(기존 섹션 포함, 크기 그대로), 본문·캡션은 그대로`, async () => {
      const base = await docOf()
      const doc = await docOf({ fontPair: PAIR[tone] })
      const heads = texts(doc, () => true).filter(heading)
      expect(heads.length).toBeGreaterThan(0)
      expect(texts(doc, (s) => !designcut(s)).filter(heading).length, '기존 섹션 제목').toBeGreaterThan(0)
      for (const e of heads) expect([e.textProps!.fontFamily, e.textProps!.fontWeight]).toEqual([PAIR[tone].heading, PAIR[tone].weight])
      const bodyOf = (d: { sections: CanvasSection[] }) => texts(d, () => true).filter((e) => !heading(e)).map((e) => e.textProps!.fontFamily)
      expect(bodyOf(doc)).toEqual(bodyOf(base))
      const sizesOf = (d: { sections: CanvasSection[] }) => texts(d, () => true).map((e) => `${e.textProps!.fontSize}/${e.textProps!.lineHeight}`)
      expect(sizesOf(doc)).toEqual(sizesOf(base))
      // 글자 크기는 그대로 — 모바일 판독 위반이 늘지 않는다
      expect(checkMobileReadability(doc).violations.length).toBeLessThanOrEqual(checkMobileReadability(base).violations.length)
    })
  }

  it('palette2 playful과 함께 켜지면 첫 화면 제목은 palette2 값 그대로(주아 112·1.4)', async () => {
    const palette2: DesigncutPalette2 = {
      tone: 'playful',
      basis: 'target_terms',
      colors: { primary: '#FF928B', secondary: ['#F6D55D', '#68E0C0'], studio: '#FFF4F3', accentText: '#B94747', heading: '#492E2B', deep: '#7C3E3B' },
    }
    const doc = await docOf({ palette2, fontPair: PAIR.playful })
    const hero = doc.sections.find((s) => s.layoutId === 'designcut_T1')!.elements.find((e) => e.name === 'designcut-headline')!.textProps!
    expect([hero.fontFamily, hero.fontWeight, hero.fontSize, hero.lineHeight]).toEqual(['Jua', 400, 112, 1.4])
    // 첫 화면 밖 제목(섹션·POINT)도 같은 짝 — palette2만 켜면 첫 화면만 주아
    const others = texts(doc, (s) => designcut(s) && s.layoutId !== 'designcut_T1').filter(heading)
    expect(others.length).toBeGreaterThan(0)
    for (const e of others) expect([e.textProps!.fontFamily, e.textProps!.fontWeight]).toEqual(['Jua', 400])
    const p2only = texts(await docOf({ palette2 }), (s) => designcut(s) && s.layoutId !== 'designcut_T1').filter(heading)
    expect(p2only.some((e) => e.textProps!.fontFamily === 'Jua')).toBe(false)
  })

  it('palette2 calm + premium — 첫 화면 제목은 함렛 700, 크기·줄 간격은 palette2 값(112·1.4)', async () => {
    const doc = await docOf({ palette2: { tone: 'calm', basis: 'default' }, fontPair: PAIR.premium })
    const hero = doc.sections.find((s) => s.layoutId === 'designcut_T1')!.elements.find((e) => e.name === 'designcut-headline')!.textProps!
    expect([hero.fontFamily, hero.fontWeight, hero.fontSize, hero.lineHeight]).toEqual(['Hahmlet', 700, 112, 1.4])
  })

  it('짝 표에 없는 (글꼴, 굵기) — 주아 800·카페24 — 는 편집기 응답에서 버려 지금 렌더 그대로', async () => {
    const base = await docOf()
    for (const bad of [{ ...PAIR.playful, weight: 800 }, { ...PAIR.premium, heading: 'Cafe24 Ssurround' }]) {
      const doc = await docOf({ fontPair: bad as DesigncutFontPair })
      const fams = (d: { sections: CanvasSection[] }) => texts(d, designcut).map((e) => `${e.textProps!.fontFamily} ${e.textProps!.fontWeight}`)
      expect(fams(doc)).toEqual(fams(base))
    }
  })
})
