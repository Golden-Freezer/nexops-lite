import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '../../types/canvas'
import { ProSectionType } from '../../types/section'
import { checkMobileReadability } from '../mobileReadability'
import { decideLongSections, FAQ_QUESTION, LONG_SECTION_TITLE } from '@/lib/registration/long-sections'
import { buildSceneSection, expansionTables, placeExpansions } from './longSections'
import { addableImageKey } from '../regenTarget'
import { createSectionElements } from './sections'
import { PURCHASE_CHECK_TITLE } from './purchaseCheck'
import { renderR1 as render } from './__fixtures__/r1Render'
import { convertToCanvasSections } from './convert'
import p03 from './__fixtures__/r1-p03-f2d72bd0.json'

// 긴 상세페이지 확장 섹션 L-1 — 설계 기록(section_plan.long)의 확장 섹션을 스펙 표 빌더로 짓고, 이미 보이는 값은 한쪽에만 싣는다

const EXTRA = {
  size: '가로 8.5cm × 세로 8cm × 높이 4cm',
  weight: '75g',
  material: '의료용 등급 TPE',
  usageLocation: '샤워 부스 선반',
  extraSpecs: [
    { key: '구성품', value: '브러시 본체 1개, 보관 캡 1개' },
    { key: '세척 방법', value: '흐르는 물에 헹군 뒤 그늘에서 말려 주세요' },
    { key: '보관', value: '습기가 적은 곳에 캡을 씌워 보관하세요' },
  ],
}
const OBJECTIONS = [
  { objection: '소재가 피부에 괜찮을까', type: 'material_eco' },
  { objection: '어디에 두고 쓰나', type: 'environment_versatility' },
  { objection: '사이즈가 손에 맞을까', type: 'quantity_size' },
]

/** R1 P03 저장 잡에 long 기록·근거 입력·고객 고민을 얹은 잡 */
function longJob(features: string[] = [...p03.section_plan.enrichment.features, 'long']) {
  const spec = { ...p03.spec_sheet, ...EXTRA }
  const skeleton = (p03.section_plan as { internalized_skeleton?: Record<string, unknown> }).internalized_skeleton ?? {}
  const persuasion = (skeleton.persuasion as Record<string, unknown> | undefined) ?? {}
  return {
    ...p03,
    spec_sheet: spec,
    section_plan: {
      ...p03.section_plan,
      enrichment: { ...p03.section_plan.enrichment, features },
      long: decideLongSections(spec, OBJECTIONS),
      internalized_skeleton: { ...skeleton, persuasion: { ...persuasion, objectionCoverage: OBJECTIONS } },
    },
  } as unknown as typeof p03
}

const texts = (s: CanvasSection) => s.elements.filter((e) => e.type === 'text').map((e) => e.textProps!.content ?? '')
const body = (sections: CanvasSection[]) => sections.filter((s) => s.sectionType !== ProSectionType.DIVIDER)

describe('expansionTables — 이미 보이는 값은 빼고 최소 행 수 이상만', () => {
  const spec = { ...p03.spec_sheet, ...EXTRA }
  const kinds = ['size', 'care', 'faq'] as const

  it('앞 섹션 글에 보인 값은 빼고, 앞서 지은 확장 표가 실은 값은 뒤 표(질문 답)에서 뺀다', () => {
    const tables = expansionTables({ kinds: [...kinds], objections: OBJECTIONS }, spec, ['소재는 의료용 등급 TPE예요'])
    expect(tables.map((t) => t.kind)).toEqual(['size', 'care'])
    // 질문 답: 소재는 이미 보이고, 크기·구성은 크기·구성 표가 실었다 → 사용 장소 하나만 남아 최소 2개에 못 미친다
    const faqOnly = expansionTables({ kinds: ['faq'], objections: OBJECTIONS }, spec, [])
    expect(faqOnly[0].rows.map((r) => r.label)).toEqual([
      `Q. ${FAQ_QUESTION.material_eco}`,
      `Q. ${FAQ_QUESTION.environment_versatility}`,
      `Q. ${FAQ_QUESTION.quantity_size}`,
    ])
    expect(faqOnly[0].rows[0].value).toBe('A. 의료용 등급 TPE')
  })

  it('기록에 없는 종류는 짓지 않는다', () => {
    expect(expansionTables({ kinds: ['care'], objections: [] }, spec, []).map((t) => t.kind)).toEqual(['care'])
    expect(expansionTables({ kinds: [], objections: OBJECTIONS }, spec, [])).toEqual([])
  })
})

describe('재렌더 — R1 P03 + long 기록', () => {
  it('상품 정보 표가 실은 값(크기·구성·소재)은 확장 표에 되풀이하지 않는다 — 남은 관리·보관만 확장 표지와 제목으로 CTA 앞에, 모바일 M1~M7 0', async () => {
    const { doc } = await render(longJob())
    const sections = body(doc.sections)
    const expansions = sections.filter((s) => s.expansion)
    expect(expansions.map((s) => s.expansion).sort()).toEqual(['care'])
    for (const s of expansions) {
      expect(s.sectionType).toBe(ProSectionType.SPEC_TABLE)
      expect(texts(s)[0]).toBe(LONG_SECTION_TITLE[s.expansion!])
    }
    const cta = sections.findIndex((s) => s.sectionType === ProSectionType.CTA)
    for (const s of expansions) expect(sections.indexOf(s)).toBeLessThan(cta)
    expect(checkMobileReadability(doc).violations).toEqual([])
  })

  it('겹치면 한쪽만 — 크기·구성 표가 실은 사이즈는 구매 전 확인 표에 다시 싣지 않고, 사이즈 값은 페이지에 한 번', async () => {
    const { doc } = await render(longJob())
    const sections = body(doc.sections)
    const purchase = sections.find((s) => !s.expansion && texts(s)[0] === PURCHASE_CHECK_TITLE)
    if (purchase) expect(texts(purchase)).not.toContain(EXTRA.size)
    const all = sections.flatMap(texts)
    expect(all.filter((t) => t.includes(EXTRA.size))).toHaveLength(1)
  })

  it('long 기록이 없으면(대조군) 확장 섹션이 없고 섹션 구성이 예전과 같다', async () => {
    const before = await render(p03)
    const off = await render(longJob(p03.section_plan.enrichment.features))
    expect(body(off.doc.sections).some((s) => s.expansion)).toBe(false)
    // 근거 입력만 늘었고 확장 섹션이 없으니 유형 순서는 구매 전 확인 표(사이즈 행)까지 같은 자리
    expect(body(off.doc.sections).map((s) => s.sectionType)).toEqual(body(before.doc.sections).map((s) => s.sectionType))
  })
})

describe('스펙 표 빌더 — 질문 표는 모바일 하한이 아니어도 위아래 한 열', () => {
  it('stacked 내용이면 라벨(질문) 아래 값(답), 아니면 2열(라벨 옆 값)', () => {
    const palette = { primary: '#2563eb', secondary: '#64748b', bgMain: '#ffffff', bgSub: '#f8fafc', textMain: '#1a1a1a' }
    const rows = [{ label: `Q. ${FAQ_QUESTION.material_eco}`, value: 'A. 의료용 등급 TPE' }]
    const at = (elements: ReturnType<typeof createSectionElements>, name: string) => elements.find((e) => e.name === name)!.transform
    const stacked = createSectionElements(ProSectionType.SPEC_TABLE, { title: '구매 전 질문', specRows: rows, stacked: true }, null, palette as never)
    expect(at(stacked, 'spec_val_0').y).toBeGreaterThan(at(stacked, 'spec_label_0').y)
    expect(at(stacked, 'spec_val_0').x).toBe(at(stacked, 'spec_label_0').x)
    const table = createSectionElements(ProSectionType.SPEC_TABLE, { title: '제품 스펙', specRows: rows }, null, palette as never)
    expect(at(table, 'spec_val_0').y).toBe(at(table, 'spec_label_0').y)
    expect(at(table, 'spec_val_0').x).toBeGreaterThan(at(table, 'spec_label_0').x)
  })
})

describe('L-2 사용 장면 — 사진 확장 섹션', () => {
  const palette = { primary: '#2563eb', secondary: '#64748b', bgMain: '#ffffff', bgSub: '#f8fafc', textMain: '#1a1a1a' } as never
  const TAGS = ['#캠핑', '#차박', '#피크닉', '#집들이']
  const IMAGES = {
    'long_scene:0': 'https://cdn.test/scene0.png',
    'long_scene:1': 'https://cdn.test/scene1.png',
    'long_scene:2': 'https://cdn.test/scene2.png',
  }
  const srcs = (s: CanvasSection) => s.elements.filter((e) => e.type === 'image').map((e) => e.imageProps!.src)

  it('페이지에 없는 태그·생성 컷 2쌍 이상이면 제목 + 사진·캡션(태그 그대로, # 뗌), 컷이 빠진 태그는 뺀다', () => {
    const s = buildSceneSection(TAGS, IMAGES, ['point_div', 'sub_div', 'cta'], palette)!
    expect(s.expansion).toBe('scenes')
    expect(s.sectionType).toBe(ProSectionType.SUB2_DIV_PAGE)
    expect(texts(s)).toEqual([LONG_SECTION_TITLE.scenes, '캠핑', '차박', '피크닉'])
    expect(srcs(s)).toEqual(Object.values(IMAGES))
    const gap = buildSceneSection(TAGS, { 'long_scene:0': IMAGES['long_scene:0'], 'long_scene:2': IMAGES['long_scene:2'] }, [], palette)!
    expect(texts(gap)).toEqual([LONG_SECTION_TITLE.scenes, '캠핑', '피크닉'])
  })

  it('다른 섹션 글에 이미 보이는 태그는 뺀다 — 짧은 태그는 낱말(조사 허용)로 본다', () => {
    const s = buildSceneSection(TAGS, IMAGES, [], palette, ['차박에 딱 맞는 크기', '캠핑족 필수'])!
    expect(texts(s)).toEqual([LONG_SECTION_TITLE.scenes, '캠핑', '피크닉'])
  })

  it('후기 카드에 같은 말이 있어도 장면을 빼지 않는다 — 컷 계획도 후기를 보지 않아, 빼면 만든 컷이 그려지지 않는다', () => {
    const ORDER = ['key_message', 'perf_reviews']
    const page = (reviewText: string, keyMessage: string) =>
      convertToCanvasSections(
        {
          ...p03.copy,
          usageSceneTags: TAGS,
          reviewHighlights: [{ text: reviewText, author: '구매고객', rating: 5 }],
          keyMessageCopy: { headline: keyMessage, subCopy: '' },
        } as never,
        IMAGES,
        palette,
        { long_scenes: true, activated_sections: ORDER, section_order: ORDER, layout_assignments: {} } as never,
        {}
      )
    const scenes = (sections: CanvasSection[]) => sections.find((s) => s.expansion === 'scenes')!
    const withReview = page('차박 갈 때 챙겼는데 손잡이가 편해요.', '가볍게 들고 나가요')
    expect(withReview.some((s) => s.sectionType === ProSectionType.PERFORMANCE_REVIEWS)).toBe(true)
    expect(texts(scenes(withReview))).toEqual([LONG_SECTION_TITLE.scenes, '캠핑', '차박', '피크닉'])
    // 후기 밖 섹션 글에 있는 태그는 지금처럼 뺀다
    expect(texts(scenes(page('손잡이가 편해요.', '차박에 맞는 크기')))).toEqual([LONG_SECTION_TITLE.scenes, '캠핑', '피크닉'])
  })

  it('확장 섹션은 사진을 다 지워도 \'이 섹션 AI 새 컷\' 대상이 아니다(유형 대표 키 usage는 다른 자리 컷)', () => {
    const s = buildSceneSection(TAGS, IMAGES, [], palette)!
    const empty = { ...s, elements: s.elements.filter((e) => e.type !== 'image') }
    expect(addableImageKey([], empty)).toBeNull()
    expect(addableImageKey([], { ...empty, expansion: undefined })).toBe('usage')
  })

  it('컷이 하나뿐이거나, 골격에 사용 장면 태그 섹션(sub2_div_page)이 있으면(태그가 이미 보인다) 짓지 않는다', () => {
    expect(buildSceneSection(TAGS, { 'long_scene:0': IMAGES['long_scene:0'] }, [], palette)).toBeNull()
    expect(buildSceneSection(TAGS, IMAGES, ['sub2_div_page'], palette)).toBeNull()
    expect(buildSceneSection(['#캠핑'], IMAGES, [], palette)).toBeNull()
  })

  it('자리 — 사용 방법 뒤, 없으면 마지막 추가 특징 뒤, 둘 다 없으면 첫 CTA 앞(같은 사용 방법 뒤의 관리·보관 표보다 앞)', () => {
    const sec = (sectionType: ProSectionType, expansion?: CanvasSection['expansion']) =>
      ({ id: `${sectionType}-${expansion ?? ''}`, sectionType, ...(expansion ? { expansion } : {}) }) as CanvasSection
    const scenes = sec(ProSectionType.SUB2_DIV_PAGE, 'scenes')
    const care = sec(ProSectionType.SPEC_TABLE, 'care')
    const order = (list: CanvasSection[]) => list.map((s) => s.id)
    const withHowto = [sec(ProSectionType.SUB_DIV), sec(ProSectionType.HIDDEN_PAGE), sec(ProSectionType.CTA)]
    expect(order(placeExpansions(withHowto, [{ kind: 'care', section: care }, { kind: 'scenes', section: scenes }]))).toEqual([
      'sub_div-',
      'hidden_page-',
      scenes.id,
      care.id,
      'cta-',
    ])
    const subOnly = [sec(ProSectionType.SUB_DIV), sec(ProSectionType.SUB_DIV), sec(ProSectionType.SPEC_TABLE), sec(ProSectionType.CTA)]
    expect(order(placeExpansions(subOnly, [{ kind: 'scenes', section: scenes }])).indexOf(scenes.id)).toBe(2)
    const none = [sec(ProSectionType.POINT_DIV), sec(ProSectionType.CTA)]
    expect(order(placeExpansions(none, [{ kind: 'scenes', section: scenes }]))).toEqual(['point_div-', scenes.id, 'cta-'])
  })

  it('재렌더 R1 P03 + long: 사용 장면이 마지막 추가 특징 뒤에 확장 표지로 들어가고, 모바일 M1~M7 0 — long이 없으면 없다', async () => {
    const withScenes = (job: typeof p03) =>
      ({
        ...job,
        copy: { ...job.copy, usageSceneTags: TAGS },
        images: { ...job.images, ...IMAGES },
      }) as unknown as typeof p03
    const { doc } = await render(withScenes(longJob()))
    const sections = body(doc.sections)
    const scenes = sections.find((s) => s.expansion === 'scenes')!
    expect(texts(scenes)).toEqual([LONG_SECTION_TITLE.scenes, '캠핑', '차박', '피크닉'])
    // 이미지 배정 단계가 유형(sub2_div_page)의 대표 컷(usage)으로 덮지 않는다 — 자기 컷 그대로
    expect(srcs(scenes)).toEqual(Object.values(IMAGES))
    const lastSub = sections.findLastIndex((s) => s.sectionType === ProSectionType.SUB_DIV && !s.expansion)
    expect(sections.indexOf(scenes)).toBe(lastSub + 1)
    expect(checkMobileReadability(doc).violations).toEqual([])
    const off = await render(withScenes(longJob(p03.section_plan.enrichment.features)))
    expect(body(off.doc.sections).some((s) => s.expansion === 'scenes')).toBe(false)
  })
})
