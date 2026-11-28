import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '../../types/canvas'
import type { CopywritingResult } from '../../types/editor'
import type { EditorDataResponse } from '../../services/editorApi'
import { buildEditorDocument } from '../buildEditorDocument'
import { checkMobileReadability } from '../mobileReadability'
import fixture from './__fixtures__/r1-p02-d10ea762.json'
import {
  ctaContent,
  fitCtaHeadline,
  keywordsOf,
  matchFeatures,
  planFeatureDedupe,
  repeatsShown,
  sameWord,
  specRowsFromInput,
} from './dedupe'
import { normalizeDetailPoint } from './helpers'
import { createSectionElements } from './sections'
import { ProSectionType } from '../../types/section'
import { SPACING } from '../../constants/designTokens'
import p03 from './__fixtures__/r1-p03-f2d72bd0.json'
import p07 from './__fixtures__/r1-p07-8e7006a3.json'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { applyDesignSkeleton, resolveDesignSkeleton } from '@/lib/registration/pdp-enrichment-stage'
import { mergeManualStrategy } from '@/lib/registration/pdp-strategy-contract'
import type { PdpJobRow, SectionImage } from '@/lib/registration/pdp-state'
import { toGeneratedImagesMap } from '@/lib/registration/pdp-image-tasks'
import { fixtureToJob, loadEnrichmentFixture, type FixtureKey } from '@/lib/registration/__golden__/golden-harness'

// R1 P02 treatment 잡 d10ea762(심사 r4 흐름·중복 2점)의 저장 카피·섹션 계획 — 이미지 URL은 자리표시
const copy = fixture.copy as unknown as CopywritingResult
const FEATURES_ONLY = (fixture.section_plan.enrichment.features as string[]).filter((f) => f !== 'persuasion')

async function render(features: string[] = fixture.section_plan.enrichment.features) {
  const response = {
    is_new: true,
    sections_data: [],
    layout_assignments: {},
    copywriting_result: fixture.copy,
    generated_images: fixture.images,
    spec_sheet: fixture.spec_sheet,
    section_plan: { ...fixture.section_plan, enrichment: { ...fixture.section_plan.enrichment, features } },
    mobile_floor: true,
  } as unknown as EditorDataResponse
  return buildEditorDocument('r1-p02', response)
}

const visible = (sections: CanvasSection[]) => sections.filter((s) => s.sectionType !== 'divider')
const photosOf = (sections: CanvasSection[]) =>
  visible(sections)
    .flatMap((s) => s.elements.map((el) => el.imageProps?.src ?? el.framedImageProps?.src ?? ''))
    .filter((src) => src && !src.includes('usp_icons'))
// POINT 제목은 수량+단위를 줄바꿈 없는 공백으로 붙인다(keepCountUnits) — 카피 글과 견줄 때는 보통 공백으로 읽는다
const textsOf = (section: CanvasSection | undefined) =>
  (section?.elements ?? []).map((el) => (el.textProps?.content ?? '').replace(/\u00A0/g, ' ')).filter(Boolean)
const countOf = (values: string[]) =>
  values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {})
const generated = (sections: CanvasSection[]) => photosOf(sections).filter((src) => !src.includes('icon'))

/** 특징마다 point_div·sub_div에 실린 주 항목 수 — 그 특징의 detailPoint 제목 또는 카드 제목 */
function primaryCounts(sections: CanvasSection[], c: CopywritingResult): number[] {
  const features = c.pointCards.slice(0, 4).filter((f) => f.title)
  const points = c.detailPoints.map((p) => normalizeDetailPoint(p as Record<string, string | undefined>))
  const owner = matchFeatures(features, points)
  const texts = sections
    .filter((s) => s.sectionType === 'point_div' || s.sectionType === 'sub_div')
    .flatMap((s) => textsOf(s))
  return features.map((f, k) => {
    const titles = new Set([f.title, ...points.filter((_, i) => owner[i] === k).map((p) => p.title)])
    return texts.filter((t) => titles.has(t)).length
  })
}

/** 분석이 features를 기록한 잡으로 설계 단계(골격 + E-2)를 다시 돌린다(layout-mobile-replay와 같은 방식) */
function designedJob(key: FixtureKey): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture(key))
  const features = ['vocab', 'persuasion', 'layouts', 'shots', 'mobile']
  job.analysis = { ...job.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  return job
}
const renderJob = (job: PdpJobRow) =>
  buildEditorDocument(job.id, { ...assembleEditorDataResponse(job, null), is_new: true, sections_data: [] })

describe('낱말 겹침 판정', () => {
  it('조사·어미가 붙은 꼴을 같은 낱말로 본다 — 숫자는 앞부분 일치만, 한 글자 겹침은 다른 말', () => {
    expect(sameWord('데이지', '데이지와')).toBe(true)
    expect(sameWord('화사한', '화사하게')).toBe(true)
    expect(sameWord('분위기에', '분위기가')).toBe(true)
    expect(sameWord('20개', '20개씩')).toBe(true)
    expect(sameWord('20개', '20cm')).toBe(false)
    expect(sameWord('선택', '선물')).toBe(false)
    expect(keywordsOf('S/L 두 사이즈로 고민 해결')).toEqual(['S/L', '사이즈로', '고민', '해결'])
  })

  it('앞 문장 하나와 낱말 절반 이상(두 개 이상)이 같으면 되풀이다', () => {
    const shown = ['화사한 데이지, 발랄한 체리 두 컬러로 구성']
    expect(repeatsShown('데이지는 화사하게, 체리는 발랄하게', shown)).toBe(true)
    expect(repeatsShown('컬러별 다른 분위기', shown)).toBe(false)
    expect(repeatsShown('포장 하나로 분위기가 달라져요', ['봉투 하나로 선물 분위기가 달라져요'])).toBe(true)
  })

  it('P02 detailPoints → 특징: 반투명·(없음)·컬러·S/L·20개·(활용 — 없음)', () => {
    const points = copy.detailPoints.map((p) => normalizeDetailPoint(p as Record<string, string | undefined>))
    expect(matchFeatures(copy.pointCards, points)).toEqual([0, -1, 1, 2, 3, -1])
  })

  it('낱말로 짝을 못 찾은 특징은 같은 번호의 짝 없는 detailPoint로 보충한다(카피 지시: 1~4번 같은 순서)', () => {
    const features = [
      { title: '원터치 작동', description: '돌리기만 하면 끝' },
      { title: '화려한 컬러', description: '선명한 꽃가루' },
    ]
    const points = [
      { title: '손 하나로 완성되는 축하 장면', description: '회전 즉시 분사' },
      { title: '화려한 컬러 꽃가루', description: '사진 속 포인트' },
      { title: '실외 사용 권장', description: '정리가 쉬워요' },
    ]
    expect(matchFeatures(features, points)).toEqual([0, 1, -1])
  })
})

describe('CTA·스펙', () => {
  it('CTA 제목은 단어 경계에서 자른다 — 낱말 조각·덧붙인 마침표 없음', () => {
    const long = '데이지와 체리 중 마음에 드는 디자인으로 지금 바로 담아보세요'
    const cut = fitCtaHeadline(long)
    expect(cut.length).toBeLessThanOrEqual(25)
    expect(long.startsWith(`${cut} `)).toBe(true)
    expect(fitCtaHeadline('컬러와 사이즈 선택하고 담아보세요')).toBe('컬러와 사이즈 선택하고 담아보세요')
    // 띄어쓰기가 앞쪽에만 있어도 낱말 경계에서 자른다
    expect(fitCtaHeadline('컬러와사이즈를선택하고 지금바로마음에드는디자인을담아보세요')).toBe('컬러와사이즈를선택하고')
  })

  it('convert_div가 없으면 행동 촉구 문장(headline), 있으면 subtext — 25자 안 후보 우선', () => {
    expect(ctaContent(copy, false).ctaHeadline).toBe('컬러와 사이즈 선택하고 담아보세요')
    expect(ctaContent(copy, true).ctaHeadline).toBe('데이지와 체리 중 분위기에 맞게 골라보세요')
    const longHeadline = { ...copy, closingCta: { headline: '가'.repeat(30), subtext: '오늘 바로 골라 담아보세요' } }
    expect(ctaContent(longHeadline, false).ctaHeadline).toBe('오늘 바로 골라 담아보세요')
    const empty = { ...copy, closingCta: { headline: '', subtext: '' } }
    expect(ctaContent(empty, false).ctaHeadline).toBe('지금 구매하기')
  })

  it('스펙 표 행은 입력 값만 — 내부 extra 키·객체 값은 싣지 않는다', () => {
    expect(specRowsFromInput(fixture.spec_sheet as Record<string, unknown>).map((r) => r.label)).not.toContain('hookMode')
    expect(
      specRowsFromInput({
        material: 'OPP',
        size: '가로 10cm',
        extra: { hookMode: 'problem', strategyHints: ['x'], 용량: '500ml', 구성: { a: 1 } },
      })
    ).toEqual([
      { label: '사이즈', value: '가로 10cm' },
      { label: '소재', value: 'OPP' },
      { label: '사용연령', value: '만 14세 이상' },
      { label: '용량', value: '500ml' },
    ])
  })
})

describe('P02 d10ea762 재렌더 — persuasion 기록 잡의 특징·사진 중복 정리', () => {
  it('기록 없이(대조) 그리면 R1 렌더 그대로: 피처 컷 2번 2회·3번 3회, S/L 설명이 핵심 포인트·추가 특징에 두 번', async () => {
    const doc = await render(FEATURES_ONLY)
    const photos = countOf(photosOf(doc.sections))
    expect(photos['https://img.test/r1-p02/features-1.png']).toBe(2)
    expect(photos['https://img.test/r1-p02/features-2.png']).toBe(3)
    const sub = doc.sections.find((s) => s.sectionType === 'sub_div')
    expect(textsOf(sub)).toContain('S/L 두 사이즈로 고민 해결')
  })

  it('같은 생성 컷을 두 번 쓰지 않는다 — 추가 특징·추천 섹션은 쓰지 않던 컷으로', async () => {
    const doc = await render()
    const photos = photosOf(doc.sections)
    expect(
      Object.values(countOf(photos)).every((n) => n === 1),
      JSON.stringify(countOf(photos))
    ).toBe(true)
    const sub = doc.sections.find((s) => s.sectionType === 'sub_div')!
    expect(photosOf([sub])).toEqual([
      'https://img.test/r1-p02/features-3.png',
      'https://img.test/r1-p02/key_benefit_visual.png',
    ])
    expect(photosOf(doc.sections.filter((s) => s.sectionType === 'point_list_div'))).toEqual([
      'https://img.test/r1-p02/usage.png',
    ])
  })

  it('특징마다 주 섹션 하나 — 요약 카드는 제목만, 핵심 포인트는 근거 문장, 추가 특징은 남은 특징·새 관점만', async () => {
    const doc = await render()
    const all = visible(doc.sections).flatMap((s) => textsOf(s))
    // 특징마다 주 항목(point_div·sub_div)이 정확히 한 번 — 빠져도, 두 번 실려도 실패
    expect(primaryCounts(doc.sections, copy)).toEqual([1, 1, 1, 1])
    // detailPoint 주장·근거와 카드 설명은 페이지에 한 번 이하
    const once = [...copy.detailPoints.flatMap((p) => [p.claim, p.proof]), ...copy.pointCards.map((c) => c.description)]
    for (const text of once) expect(all.filter((t) => t === text).length, text).toBeLessThanOrEqual(1)

    const mainCut = doc.sections.find((s) => s.sectionType === 'main_cut')!
    expect(textsOf(mainCut)).toEqual([
      '선물의 첫인상이 바뀌어요',
      '은은한 반투명',
      '컬러 2종',
      'S/L 두 사이즈',
      '20개 구성',
    ])
    const point = doc.sections.find((s) => s.sectionType === 'point_div')!
    expect(textsOf(point)).toEqual(
      expect.arrayContaining([
        '비칠 듯 안 비치는 신비로움',
        '데이지와 체리, 분위기 따라 선택',
        'S/L 두 사이즈로 고민 해결',
      ])
    )
    const sub = doc.sections.find((s) => s.sectionType === 'sub_div')!
    expect(textsOf(sub)).toEqual([
      '추가 특징',
      '여러 번 쓰는 20개 구성',
      '한 번에 20개씩 들어 있어 반복 사용 가능',
      '소품부터 핸드메이드까지 활용',
      '액세서리, 베이킹 선물 등 다양한 용도로 사용',
    ])
    // 앞 문장을 되풀이하는 한 줄은 뺀다 — 상품 노출 보조 문구·선택 안내 설명
    expect(textsOf(doc.sections.find((s) => s.sectionType === 'product_exposure'))).toEqual(['컬러별 다른 분위기'])
    expect(all).not.toContain('화사한 데이지와 발랄한 체리, 선물 분위기에 맞게 골라보세요')
    expect(textsOf(doc.sections.find((s) => s.sectionType === 'cta'))).toContain('컬러와 사이즈 선택하고 담아보세요')
    // 골격에 스펙 표가 없어도 상품 정보 표 하나는 CTA 앞에 든다(오너 지시 11-01)
    expect(doc.sections.filter((s) => s.sectionType === 'spec_table')).toHaveLength(1)
  })

  it('모바일 판독 위반이 늘지 않는다(M1~M8, 대조 대비 규칙별)', async () => {
    const off = checkMobileReadability(await render(FEATURES_ONLY)).counts
    const on = checkMobileReadability(await render()).counts
    for (const [rule, n] of Object.entries(on))
      expect(n, `${rule} on ${n} > off ${off[rule as keyof typeof off]}`).toBeLessThanOrEqual(
        off[rule as keyof typeof off]
      )
  })
})

describe('A·B·C 기록 잡(T3 기능 + persuasion) — 중복 정리', () => {
  for (const key of ['A-track-i', 'B-track-i', 'C-track-i'] as FixtureKey[]) {
    it(`${key}: 같은 생성 컷 재사용 0 · 특징마다 주 항목 정확히 한 번 · 모바일 M1~M7 0`, async () => {
      const job = designedJob(key)
      const doc = await renderJob(job)
      const photos = countOf(generated(doc.sections))
      expect(
        Object.values(photos).every((n) => n === 1),
        JSON.stringify(photos)
      ).toBe(true)
      expect(
        primaryCounts(doc.sections, job.copy_sections.final as unknown as CopywritingResult).every((n) => n === 1)
      ).toBe(true)
      expect(checkMobileReadability(doc).violations).toEqual([])
    })
  }

  it('A: 남은 특징(4번)의 주 항목이 추가 특징에 실리고, 컷은 같은 번호의 피처 컷(장식 라벨 pointCards[3])', async () => {
    const job = designedJob('A-track-i')
    const c = job.copy_sections.final as unknown as CopywritingResult
    const points = c.detailPoints.map((p) => normalizeDetailPoint(p as Record<string, string | undefined>))
    const owner = matchFeatures(c.pointCards.slice(0, 4), points)
    const doc = await renderJob(job)
    const sub = doc.sections.find((s) => s.sectionType === 'sub_div')!
    expect(textsOf(sub)).toContain(points[owner.indexOf(3)].title)
    const features = (assembleEditorDataResponse(job, null).generated_images as Record<string, string[]>).features
    expect(generated([sub])[0]).toBe(features[3])
  })

  it('C: concept_desc가 쓰는 detailPoints[1]은 다른 섹션에 다시 싣지 않는다', async () => {
    const job = designedJob('C-track-i')
    const plan = job.section_plan
    const at = plan.section_order!.indexOf('main_cut') + 1
    job.section_plan = {
      ...plan,
      section_order: [...plan.section_order!.slice(0, at), 'concept_desc', ...plan.section_order!.slice(at)],
      activated_sections: [...plan.activated_sections!, 'concept_desc'],
    }
    const c = job.copy_sections.final as unknown as CopywritingResult
    const dp1 = normalizeDetailPoint(c.detailPoints[1] as Record<string, string | undefined>)
    const doc = await renderJob(job)
    expect(doc.sections.some((s) => s.sectionType === 'concept_desc')).toBe(true)
    const all = visible(doc.sections).flatMap((s) => textsOf(s))
    expect(all.filter((t) => t === dp1.title)).toHaveLength(1)
    expect(all.filter((t) => t === dp1.description)).toHaveLength(1)
  })
})

describe('문장을 뺀 자리에 간격이 남지 않는다(#114 회귀 — R1 P02 옵션 제목과 카드 사이 약 115px 빈 공간)', () => {
  const R1 = [
    ['P02', fixture],
    ['P03', p03],
    ['P07', p07],
  ] as const
  async function renderR1(f: (typeof R1)[number][1], persuasion = true) {
    const features = (f.section_plan.enrichment.features as string[]).filter((x) => persuasion || x !== 'persuasion')
    const response = {
      is_new: true,
      sections_data: [],
      layout_assignments: {},
      copywriting_result: f.copy,
      generated_images: f.images,
      spec_sheet: f.spec_sheet,
      section_plan: { ...f.section_plan, enrichment: { ...f.section_plan.enrichment, features } },
      mobile_floor: true,
    } as unknown as EditorDataResponse
    return buildEditorDocument('r1', response)
  }
  const bottom = (el: CanvasSection['elements'][number]) => el.transform.y + el.transform.height
  /** 섹션 안 요소 사이 가장 큰 세로 빈 띠 */
  function largestBlank(section: CanvasSection): number {
    const els = [...section.elements].sort((a, b) => a.transform.y - b.transform.y)
    let reach = els[0]?.transform.y ?? 0
    let largest = 0
    for (const el of els) {
      largest = Math.max(largest, el.transform.y - reach)
      reach = Math.max(reach, bottom(el))
    }
    return largest
  }

  it('P02 옵션 섹션: 설명을 뺐으면 제목 → 첫 카드 간격은 머리→첫 콘텐츠 정본 갭(60)뿐(수정 전 100)', async () => {
    const petit = (await renderR1(fixture)).sections.find((s) => s.sectionType === 'petit_div')!
    expect(textsOf(petit)).not.toContain(fixture.copy.colorOptions.description)
    const title = petit.elements.find((e) => e.name === 'petit_title')!
    const firstAfter = Math.min(
      ...petit.elements.filter((e) => e.transform.y > bottom(title)).map((e) => e.transform.y)
    )
    expect(firstAfter - bottom(title)).toBe(SPACING.headerToContent)
    // 기록 없는 잡(설명 있음)은 기존 배치 그대로 — 설명 아래 본문 간격 30 + 설명 뒤 40
    const control = (await renderR1(fixture, false)).sections.find((s) => s.sectionType === 'petit_div')!
    const desc = control.elements.find((e) => e.name === 'petit_desc')!
    expect(desc.textProps!.content).toBe(fixture.copy.colorOptions.description)
    const afterDesc = Math.min(
      ...control.elements.filter((e) => e.transform.y > bottom(desc)).map((e) => e.transform.y)
    )
    expect(afterDesc - bottom(desc)).toBe(SPACING.bodyToCaption + 40)
  })

  it('추가 특징(한 열): 설명을 비운 항목은 빈 설명 상자와 제목 아래 간격을 남기지 않는다 — 기록 없는 잡은 그대로', () => {
    const palette = fixture.copy.designPalette as unknown as Parameters<typeof createSectionElements>[3]
    const content = {
      sectionTitle: '추가 특징',
      points: [
        { title: '여러 번 쓰는 20개 구성', description: '', image: '' },
        { title: '소품부터 핸드메이드까지 활용', description: '다양한 용도', image: '' },
      ],
    }
    const build = (dedupe: boolean) =>
      createSectionElements(ProSectionType.SUB_DIV, content, null, palette, {
        mobileFloor: true,
        ...(dedupe ? { dedupe: true } : {}),
      })
    const on = build(true)
    expect(on.find((e) => e.name === 'sub_0_desc')).toBeUndefined()
    const gapOn =
      on.find((e) => e.name === 'sub_1_title')!.transform.y - bottom(on.find((e) => e.name === 'sub_0_title')!)
    expect(gapOn).toBe(60)
    const off = build(false)
    expect(off.find((e) => e.name === 'sub_0_desc')).toBeDefined()
  })

  it('상품 노출: 글자를 모두 뺐으면 사진 앞 글자→사진 간격(110)을 두지 않는다 — 기록 없는 잡은 그대로', () => {
    const palette = fixture.copy.designPalette as unknown as Parameters<typeof createSectionElements>[3]
    const img = 'https://img.test/r1-p02/product_exposure.png'
    const imageY = (dedupe: boolean) =>
      createSectionElements(ProSectionType.PRODUCT_EXPOSURE, { headline: '', subCopy: '' }, img, palette, {
        ...(dedupe ? { dedupe: true } : {}),
      }).find((e) => e.type === 'image')!.transform.y
    expect(imageY(false) - imageY(true)).toBe(SPACING.captionToImage)
  })

  for (const [key, f] of R1) {
    it(`${key}: 기록 잡 재렌더의 어느 섹션도 대조(기록 없음) 렌더보다 큰 빈 띠를 만들지 않는다 · 모바일 M1~M7 0`, async () => {
      const on = await renderR1(f)
      const off = await renderR1(f, false)
      for (const s of visible(on.sections)) {
        const control = off.sections.find((c) => c.sectionType === s.sectionType)
        if (control) expect(largestBlank(s), `${s.sectionType}`).toBeLessThanOrEqual(largestBlank(control))
      }
      expect(checkMobileReadability(on).violations).toEqual([])
    })
  }
})

describe('번호 컷이 중간에 실패해도 추가 특징 항목과 컷이 엇갈리지 않는다(features:4 실패·features:5 성공)', () => {
  // 특징 4개(낱말 짝 없음 → 같은 번호 detailPoint) + 특징 밖 새 관점 2개(4·5번) — 추가 특징 = 특징 4·관점 4번·관점 5번
  const copy = {
    mainIntro: { title: '제목', subtitle: '추가 특징' },
    pointCards: ['가벼움', '넉넉함', '단단함', '말랑함'].map((t) => ({ title: t, description: `${t} 설명` })),
    detailPoints: ['바람', '햇볕', '구름', '안개', '박음질', '손잡이'].map((t) => ({ claim: `${t} 주장`, proof: `${t} 근거` })),
  } as unknown as CopywritingResult
  const order = [ProSectionType.POINT_DIV, ProSectionType.SUB_DIV]
  const url = (section: string) => `https://img.test/slots/${section.replace(':', '-')}.png`
  const entry = (section: string, ok = true): SectionImage =>
    ok ? { section, url: url(section) } : { section, url: '', error: `${section} 생성 실패` }
  const cuts = (...extra: SectionImage[]) =>
    toGeneratedImagesMap([...[0, 1, 2, 3].map((i) => entry(`features:${i}`)), entry('features:4', false), entry('features:5'), ...extra]) as Record<
      string,
      string | string[]
    >
  const subImages = (images: Record<string, string | string[]>, mobileFloor: boolean) => {
    const plan = planFeatureDedupe(copy, order, images, mobileFloor)
    const points = plan.content[ProSectionType.SUB_DIV]!.points as Array<{ title: string; image: string; index: number }>
    return points.map((p) => [p.index, p.image])
  }

  it('5번 관점은 5번 컷, 4번 관점은 남는 컷 — 전에는 5번 컷이 4번 관점에 붙고 5번 관점이 남는 컷을 받았다', () => {
    expect(subImages(cuts(entry('key_benefit_visual')), true)).toEqual([
      [3, url('features:3')],
      [4, url('key_benefit_visual')],
      [5, url('features:5')],
    ])
  })

  it('남는 컷이 없으면 4번 관점은 사진 없이 — 재사용 대체(지그재그)도 뒤 항목 몫인 5번 컷을 먼저 쓰지 않는다', () => {
    for (const mobileFloor of [true, false]) {
      expect(subImages(cuts(), mobileFloor), String(mobileFloor)).toEqual([
        [3, url('features:3')],
        [4, ''],
        [5, url('features:5')],
      ])
    }
  })
})
