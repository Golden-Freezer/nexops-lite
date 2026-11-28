/**
 * 디자인 컷 렌더 v2(plan.layout 2, PDP-DR-PLAN §1) — C3 막 단위 바탕·사진 하단 페이드, C5 강조 구절·캡슐은 POINT만·정렬 축 2개·
 * 장 번호 DISPLAY 한 번·제목 본색, C6 상자 한 문법·체크 상한. layout이 없는 기록은 지금 렌더 그대로(기존 시험·골든이 지킨다).
 */

import { describe, expect, it } from 'vitest'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import { sanitizeRichText } from '@/lib/registration/editor/utils/textSanitizer'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { withDesigncutLayout } from '@/lib/registration/eval/render-capture'
import { buildDesigncutPlan } from '@/lib/registration/internalized/designcut-plan'
import { accentPhraseOf, richWithAccent, uspWordsOf } from './accent'
import { readDesignCut } from './contract'
import { designCutJobB, designCutPlanForB, designcutJobFromD1 } from './designCut.fixture'
import { assignActBackgrounds, isLightTint, isWhite, type BgRow } from './layout2'

const PINK = '#F7CECF'
const v2Plan = (photoBackground?: string) => {
  const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & { layout?: 2 }
  plan.layout = 2
  if (photoBackground) Object.assign(plan.palette, { photoBackground, source: 'photo' })
  return plan
}
const docFor = (plan: unknown) => {
  const job = designCutJobB({ plan })
  return buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
}
const cuts = (doc: { sections: CanvasSection[] }) => doc.sections.filter((s) => s.layoutId.startsWith('designcut_'))
const named = (sec: CanvasSection, name: string) => sec.elements.filter((e) => e.name === name)
const all = (doc: { sections: CanvasSection[] }, name: string) => doc.sections.flatMap((s) => named(s, name))

describe('강조 구절(C5) — 수량+단위 → USP 낱말 → 없음', () => {
  it('제목의 수량+단위를 먼저 고른다(줄바꿈 없는 공백으로 묶인 글도)', () => {
    expect(accentPhraseOf('답례품 포장, 20개 한 번에 준비', [])).toBe('20개')
    expect(accentPhraseOf('50매 대용량', ['대용량'])).toBe('50매')
    expect(accentPhraseOf('20 장 구성', [])).toBe('20 장')
  })

  it('수량이 없으면 POINT 제목 낱말로 시작하는 제목 낱말 — 조사는 빼고 그 낱말만, 일반 낱말은 쓰지 않는다', () => {
    const usp = uspWordsOf(['소분 포장', '반투명 소재', '20장 구성', null])
    expect(usp).not.toContain('구성')
    expect(usp).not.toContain('20장')
    expect(accentPhraseOf('답례품은 골랐는데, 포장은 늘 막히죠?', usp)).toBe('포장')
    expect(accentPhraseOf('밥도 물도 한 세트로', usp)).toBeNull()
  })

  it('richContent는 첫 일치만 span으로 감싸고 나머지는 이스케이프·줄바꿈 <br>', () => {
    expect(richWithAccent('A&B 20개\n<준비>', '20개', 'color:#123456')).toBe(
      'A&amp;B <span style="color:#123456">20개</span><br>&lt;준비&gt;'
    )
    expect(richWithAccent('없음', '20개', 'color:#000')).toBeNull()
  })

  it('편집 뒤 정화도 형광 띠(background-color 색 값)를 남기고 url 같은 값은 버린다', () => {
    expect(sanitizeRichText('<span style="background-color:rgba(250, 204, 21, 0.45)">20개</span>')).toBe(
      '<span style="background-color:rgba(250, 204, 21, 0.45)">20개</span>'
    )
    expect(sanitizeRichText('<span style="background-color:url(javascript:alert(1))">x</span>')).toBe('x')
  })
})

describe('막 단위 바탕(C3)', () => {
  const row = (key: string, role: string | null, template: BgRow['template'], keptFill?: string): BgRow => ({
    key,
    role,
    template,
    keptFill,
  })
  const page: BgRow[] = [
    row('main_cut', 'hook', 'T1'),
    row('problem_raise', 'problem', 'T2'),
    row('point_div:0', 'usp_feature', 'T3a'),
    row('point_div:1', 'usp_feature', 'T3a'),
    row('solution_guide', 'problem', 'T4'),
    row('hidden_page', 'how_to_guide', 'T5'),
    row('spec_table', 'size_spec', 'T6'),
    row('petit_div', 'option_catalog', 'T7'),
    row('cta', 'cta', 'T8'),
  ]

  it('흰 기본·스튜디오 교대, 짙은 면은 공감→해결 첫 섹션과 마무리 두 곳뿐', () => {
    expect(assignActBackgrounds(page, false)).toEqual(['P', 'W', 'D', 'W', 'W', 'N', 'W', 'N', 'D'])
  })

  it('상품 컷 배경이 흰색이면 사진으로 끝나는 섹션 다음은 스튜디오', () => {
    expect(assignActBackgrounds(page, true)).toEqual(['P', 'N', 'D', 'N', 'N', 'W', 'N', 'W', 'D'])
  })

  it('공감 막이 없으면 해결 전환 짙은 면을 두지 않는다 — 흰 kept 다음은 스튜디오', () => {
    const rows = [row('main_cut', 'hook', 'T1'), row('certification', null, null, '#FFFFFF'), row('point_div:0', 'usp_feature', 'T3a'), row('cta', 'cta', 'T8')]
    expect(assignActBackgrounds(rows, false)).toEqual(['P', null, 'N', 'D'])
  })

  it('흰색 판정 — 사진 흰 배경(#FAFAFA)은 흰색, 스튜디오(#F4F4F4)는 아니다', () => {
    expect([isWhite('#FFFFFF'), isWhite('#FAFAFA'), isWhite('#F4F4F4'), isWhite(null)]).toEqual([true, true, false, false])
  })

  it('밝은 유채색(tint) kept는 흰·스튜디오 교대 색으로 다시 칠하고, 흰·스튜디오·짙은 kept는 그대로 둔다', () => {
    expect([isLightTint('#FEEDED'), isLightTint('#F4F4F4'), isLightTint('#FFFFFF'), isLightTint('#4A2414')]).toEqual([true, false, false, false])
    const rows = [
      row('main_cut', 'hook', 'T1'),
      row('problem_raise', 'problem', 'T2'),
      row('solution_guide', null, null, '#FEEDED'),
      row('point_div:0', 'usp_feature', 'T3a'),
      row('certification', null, null, '#1E2A44'),
      row('cta', 'cta', 'T8'),
    ]
    expect(assignActBackgrounds(rows, false)).toEqual(['P', 'W', 'N', 'D', null, 'D'])
  })
})

describe('조립 v2 — 고정물 B(사진 배경 분홍)', () => {
  it('바탕은 흰·스튜디오·짙은 면(2곳)·사진뿐이고 tint 면이 없다', async () => {
    const plan = v2Plan(PINK)
    const doc = await docFor(plan)
    const fills = cuts(doc).map((s) => s.canvas.backgroundColor.toLowerCase())
    expect(fills).not.toContain(plan.palette.tint.toLowerCase())
    const deep = cuts(doc).filter((s) => s.canvas.backgroundColor === plan.palette.deep && s.layoutId !== 'designcut_T3c')
    expect(deep.map((s) => s.layoutId)).toEqual(['designcut_T3a', 'designcut_T8'])
  })

  it('같은 바탕 구분선 대신 사진 하단 페이드(SVG 그라데이션, 다음 바탕 색으로)', async () => {
    const doc = await docFor(v2Plan(PINK))
    expect(all(doc, 'designcut-divider')).toEqual([])
    const sections = doc.sections
    const faded = sections.filter((s) => named(s, 'designcut-fade').length > 0)
    expect(faded.length).toBeGreaterThan(0)
    for (const sec of faded) {
      const fade = named(sec, 'designcut-fade')[0]
      const next = sections[sections.indexOf(sec) + 1]
      expect(fade.transform.y + fade.transform.height).toBe(sec.canvas.height)
      expect(fade.svgProps!.svgString).toContain(`stop-color="${next.canvas.backgroundColor}"`)
      expect(fade.zIndex).toBe(Math.max(...sec.elements.map((e) => e.zIndex)))
    }
  })

  it('캡슐은 POINT 장 번호에만, 장 번호는 DISPLAY 한 번, 정렬 축은 첫 화면·마무리 가운데 + 본문 왼쪽', async () => {
    const doc = await docFor(v2Plan(PINK))
    expect(all(doc, 'designcut-eyebrow-bg')).toEqual([])
    expect(all(doc, 'designcut-dim-w-label-bg')).toEqual([])
    expect(all(doc, 'designcut-chapter-text').map((e) => e.textProps!.content)).toEqual(['POINT', 'POINT', 'POINT'])
    expect(all(doc, 'designcut-chapter-number').map((e) => [e.textProps!.content, e.textProps!.typoLevel])).toEqual([
      ['01', 'display'],
      ['02', 'display'],
      ['03', 'display'],
    ])
    const align = (layout: string) =>
      cuts(doc)
        .filter((s) => s.layoutId === layout)
        .flatMap((s) => named(s, 'designcut-headline'))
        .map((e) => e.textProps!.textAlign)
    expect(align('designcut_T1')).toEqual(['center'])
    expect(align('designcut_T8')).toEqual(['center'])
    for (const layout of ['designcut_T2', 'designcut_T3a', 'designcut_T3c', 'designcut_T4', 'designcut_T5', 'designcut_T6', 'designcut_T7'])
      expect(new Set(align(layout))).toEqual(new Set(['left']))
  })

  it('강조 구절은 제목마다 하나(수량+단위 우선) — 밝은 바탕은 accentText, 제목 본색은 ink와 다른 짙은 값', async () => {
    const plan = v2Plan(PINK)
    const doc = await docFor(plan)
    const point2 = cuts(doc).filter((s) => s.layoutId === 'designcut_T3a')[1]
    const head = named(point2, 'designcut-headline')[0]
    expect(head.textProps!.richContent).toMatch(/<span style="color:#[0-9a-f]{6}">50매<\/span>/i)
    const light = cuts(doc).find((s) => s.layoutId === 'designcut_T6')!
    const lightHead = named(light, 'designcut-headline')[0].textProps!
    expect(lightHead.color.toLowerCase()).not.toBe(plan.palette.ink.toLowerCase())
    expect(lightHead.richContent ?? '').not.toMatch(/<span[^>]*>[^<]*<\/span>[\s\S]*<span/)
  })

  it('상자 한 문법 — 말풍선·옵션 칸은 판넬 채움·테두리 없음, 결론 띠 없음, 체크 표시는 페이지 4개까지', async () => {
    const doc = await docFor(v2Plan(PINK))
    const boxes = [...all(doc, 'designcut-bubble-0'), ...doc.sections.flatMap((s) => s.elements.filter((e) => /^designcut-option-(name|card)-/.test(e.name)))]
    expect(boxes.length).toBeGreaterThan(0)
    for (const box of boxes) expect(box.shapeProps!.stroke).toBeUndefined()
    expect(all(doc, 'designcut-conclusion')).toEqual([])
    const checks = doc.sections.flatMap((s) => s.elements.filter((e) => /^designcut-check-\d+$/.test(e.name)))
    expect(checks.length).toBeLessThanOrEqual(4)
  })

  it('해결 체크리스트가 POINT 제목과 같아 기존 섹션으로 그려지면(예전 기록) 짙은 전환 면은 첫 POINT로 간다', async () => {
    const plan = v2Plan(PINK)
    const titles = plan.sections.filter((s) => s.key.startsWith('point_div:')).map((s) => s.text.headline as string)
    const sol = plan.sections.find((s) => s.key === 'solution_guide')!
    Object.assign(sol, { role: 'problem', modules: [{ type: 'M1', data: { items: titles } }] })
    // R5-D 기록처럼 해결 요약이 고민 바로 뒤, POINT 앞
    const order = plan.order.filter((k: string) => k !== 'solution_guide')
    order.splice(order.indexOf('problem_raise') + 1, 0, 'solution_guide')
    plan.order = order
    const doc = await docFor(plan)
    expect(cuts(doc).some((s) => s.layoutId === 'designcut_T4' && named(s, 'designcut-check-0').length > 0 && s.order < 3)).toBe(false)
    const deep = cuts(doc).filter((s) => s.canvas.backgroundColor === plan.palette.deep && s.layoutId !== 'designcut_T3c')
    expect(deep.map((s) => s.layoutId)).toEqual(['designcut_T3a', 'designcut_T8'])
    expect(named(deep[0], 'designcut-chapter-number')[0].textProps!.content).toBe('01')
  })

  it('모바일 검사 위반 0(v1과 같은 기준)', async () => {
    expect(checkMobileReadability(await docFor(v2Plan(PINK))).violations).toEqual([])
    expect(checkMobileReadability(await docFor(v2Plan())).violations).toEqual([])
  })
})

describe('D1 실제 계획 + v2', () => {
  it.each(['A-track-i', 'B-track-i', 'C-track-i'] as const)('%s — 배정 섹션이 모두 그려지고 모바일 위반 0', async (key) => {
    const job = designcutJobFromD1(key, true)
    const v2 = withDesigncutLayout(job, 2)
    const plan = readDesignCut(v2.section_plan)!
    const doc = await buildEditorDocument(v2.id, assembleEditorDataResponse(v2, null))
    const planned = doc.sections.filter((s) => s.layoutId.startsWith('designcut_') && s.layoutId !== 'designcut_purchase')
    expect(planned).toHaveLength(plan.sections.length)
    expect(all(doc, 'designcut-divider')).toEqual([])
    expect(checkMobileReadability(doc).violations).toEqual([])
  })

  it('designlayout 기록 잡만 계획에 layout 2를 남긴다', () => {
    const job = designcutJobFromD1('A-track-i')
    expect(buildDesigncutPlan(job)).not.toHaveProperty('layout')
    const features = [...(job.section_plan.enrichment?.features ?? []), 'designlayout']
    const enrichment = { ...job.section_plan.enrichment!, features } as typeof job.section_plan.enrichment
    expect(buildDesigncutPlan({ ...job, section_plan: { ...job.section_plan, enrichment } })!.layout).toBe(2)
  })
})

describe('스위치·측정 경로', () => {
  it('계약은 layout 2만 읽는다(다른 값은 필드 없음 — v1 렌더)', () => {
    expect(readDesignCut({ designcut: v2Plan() })!.layout).toBe(2)
    expect(readDesignCut({ designcut: { ...designCutPlanForB(), layout: 3 } })).not.toHaveProperty('layout')
  })

  it('capture --designcut-layout 2는 메모리 사본에만 layout을 붙인다(원본·계획 없는 잡은 그대로)', () => {
    const job = designCutJobB()
    const copy = withDesigncutLayout(job, 2)
    expect((copy.section_plan.designcut as { layout?: number }).layout).toBe(2)
    expect((job.section_plan.designcut as { layout?: number }).layout).toBeUndefined()
    const plain = { ...job, section_plan: { ...job.section_plan, designcut: undefined } }
    expect(withDesigncutLayout(plain, 2)).toBe(plain)
    expect(withDesigncutLayout(job, undefined)).toBe(job)
  })
})
