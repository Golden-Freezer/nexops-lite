/**
 * D2 디자인 컷 구조(pdp-design-structure) — 첫 화면 후킹 문장·후기(T12)·상품 정보 표(T9 하나)·옵션 칩 통일·같은 템플릿 3연속 풀기와
 * 계약 왕복·조립. 큰 POINT 3개 + 자세히 보기(T11)는 designcut-plan.test D2 절. 픽스처 A·B·C(Track I)를 D2 기록 잡으로 다시 설계한다.
 * LLM·DB 없음.
 */
import { describe, expect, it } from 'vitest'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import type { DesigncutSection, PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture, type FixtureKey } from '../__golden__/golden-harness'
import { decideLongSections } from '../long-sections'
import { buildDesigncutPlan } from './designcut-plan'
import { designcutTaskFilter } from './designcut-images'
import { infoRows } from './designcut-long'
import { reviewCards, spreadRuns } from './designcut-structure'
import { D2_SECTION_TARGET, planExtraShotsForLength, planExtraShots, pointCutsOf } from './shot-diversity'
import { readDesignCut } from '../editor/utils/sectionConverter/designCut/contract'
import { composeDesignCut } from '../editor/utils/sectionConverter/designCut/compose'

const ON = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut']
const D2 = [...ON, 'designcut2', 'designlayout']

function job(key: FixtureKey, features: string[] = D2, spec: Partial<PdpJobRow['spec_sheet']> = {}): PdpJobRow {
  const j = fixtureToJob(loadEnrichmentFixture(key))
  j.analysis = { ...j.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  j.spec_sheet = { ...j.spec_sheet, ...spec }
  const strategy = mergeManualStrategy(j.analysis.recommended_strategy_contract ?? {}, j.spec_sheet, [])
  j.section_plan = applyDesignSkeleton(j.section_plan, resolveDesignSkeleton(j, strategy))
  return j
}
const withCopy = (j: PdpJobRow, final: Partial<NonNullable<PdpJobRow['copy_sections']['final']>>): PdpJobRow => ({
  ...j,
  copy_sections: { ...j.copy_sections, final: { ...j.copy_sections.final!, ...final } },
})
const plan = (j: PdpJobRow) => buildDesigncutPlan(j)!
const section = (j: PdpJobRow, template: string) => plan(j).sections.find((s) => s.template === template)

describe('첫 화면(T1) — D2는 분류 글자 대신 후킹 문장', () => {
  it('D2: eyebrow 없음 + hook(mainIntro.hook), 제목·보조 효익은 그대로 — D1은 예전 그대로(분류 글자, hook 칸 없음)', () => {
    const d2 = job('A-track-i')
    const intro = d2.copy_sections.final!.mainIntro!
    expect(section(d2, 'T1')!.text).toEqual({
      eyebrow: null,
      headline: intro.benefitHeadline ?? intro.title,
      sub: intro.subBenefit ?? intro.subtitle,
      hook: intro.hook,
    })
    const d1 = section(job('A-track-i', ON), 'T1')!
    expect(d1.text.eyebrow).toBe(intro.category)
    expect(d1.text).not.toHaveProperty('hook')
    // 후킹 문장이 없으면 칸이 없다
    const none = withCopy(d2, { mainIntro: { ...intro, hook: '  ' } })
    expect(section(none, 'T1')!.text).not.toHaveProperty('hook')
  })
})

describe('후기(T12) — 실제 후기 카드만, #330 규칙(가린 작성자·요약 본문)', () => {
  it('A(리뷰 원문·카피 후기 3장): 후기 한 섹션(카드형), 작성자는 가린 꼴 — D1은 예전처럼 뺀다', () => {
    const j = job('A-track-i')
    const p = plan(j)
    const review = p.sections.find((s) => s.template === 'T12')!
    expect(review.key).toBe('perf_reviews')
    expect(review.layoutVariant).toBe('card')
    const m = review.modules[0]
    expect(m.type).toBe('M12')
    if (m.type !== 'M12') return
    expect(m.data.cards).toEqual(reviewCards(j.copy_sections.final!))
    expect(m.data.cards.length).toBeGreaterThan(0)
    for (const c of m.data.cards) expect(c.author === '구매고객' || /^.\*{1,3}$/u.test(c.author)).toBe(true)
    expect(plan(job('A-track-i', ON)).omitted.find((o) => o.key === 'perf_reviews')?.reason).toBe('자사 후기 미확인 — 인용 카드 비활성(08 §8)')
  })

  it('카드 고르기 — 인용 금지 표현·정화 표지는 빼고, 이름은 가리고, 최대 5장. 평점은 원본만', () => {
    const cards = reviewCards({
      reviewHighlights: [
        { text: '아이 생일에 쓰기 좋았어요', author: '홍길동', rating: 5, month: '2026.09' },
        { text: '업계 최고 제품이에요', author: '김철수', rating: 5 },
        { text: '배송 빨라요 (연락처 삭제)', author: '이영희', rating: 4 },
        { text: '접어서 보관하기 편해요', author: '구매고객', summary: true },
        { text: '색이 예뻐요', author: '박**', rating: 9 },
        { text: '튼튼해요', rating: 4 },
        { text: '크기가 딱 좋아요', author: '최지우', rating: 4 },
        { text: '또 살게요', author: '정', rating: 5 },
      ],
    })
    expect(cards).toEqual([
      { text: '아이 생일에 쓰기 좋았어요', author: '홍**', rating: 5, month: '2026.09' },
      { text: '접어서 보관하기 편해요', author: '구매고객', rating: null, summary: true },
      { text: '색이 예뻐요', author: '박**', rating: null },
      { text: '튼튼해요', author: '구매고객', rating: 4 },
      { text: '크기가 딱 좋아요', author: '최**', rating: 4 },
    ])
  })

  it('평점·리뷰 수는 입력 값 그대로 같은 섹션에(평점 섹션은 합침), 카드가 하나도 없으면 후기 섹션이 없다(가상 후기 금지)', () => {
    const rated = job('A-track-i', D2, { rating: 4.8, reviewCount: 1234 })
    const p = plan(rated)
    const review = p.sections.find((s) => s.template === 'T12')!
    expect(review.modules[0]).toMatchObject({ type: 'M12', data: { rating: 4.8, count: 1234 } })
    if (rated.section_plan.section_order!.includes('perf_rating'))
      expect(p.omitted.find((o) => o.key === 'perf_rating')?.reason).toBe('후기(T12) 하나로 합침')
    const empty = withCopy(job('A-track-i'), { reviewHighlights: [{ text: '최고의 선택', author: '김철수' }] })
    const q = plan(empty)
    expect(q.sections.some((s) => s.template === 'T12')).toBe(false)
    expect(q.omitted.find((o) => o.key === 'perf_reviews')?.reason).toBe('D2 — 인용할 수 있는 실제 후기 카드 없음')
    // 리뷰 근거가 없는 상품(B)은 플래너가 후기 섹션을 만들지 않는다
    expect(plan(job('B-track-i')).order).not.toContain('perf_reviews')
  })
})

describe('상품 정보 표(T9 하나) — 사실이 있는 행만, 소재·원산지·크기·구성 표를 대신한다', () => {
  const FACTS = {
    size: '34cm x 19.5cm x 12.5cm',
    material: '면 100%',
    weight: '120g',
    origin: '중국',
    extraSpecs: [
      { key: '구성', value: '가방 1개, 파우치 1개' },
      { key: '세탁', value: '찬물 손세탁' },
      { key: '효과', value: '아토피 개선' },
    ],
  }

  it('행 순서 — 상품명·브랜드·색상/수량·사이즈·소재·원산지·사용연령·허용 목록 추가 스펙(오너 지시 11-01), 무게는 없고, 규제 표현이 든 행은 뺀다', () => {
    const j = job('A-track-i', D2, { ...FACTS, colorOptions: ['데이지', '체리'] })
    expect(infoRows(j.spec_sheet)).toEqual([
      { label: '상품명', value: j.spec_sheet.productName },
      { label: '브랜드', value: '지야픽' },
      { label: '색상/수량', value: '데이지, 체리' },
      { label: '사이즈', value: '34cm x 19.5cm x 12.5cm' },
      { label: '소재', value: '면 100%' },
      { label: '원산지', value: '중국' },
      { label: '사용연령', value: '만 14세 이상' },
      { label: '구성', value: '가방 1개, 파우치 1개' },
      { label: '세탁', value: '찬물 손세탁' },
    ])
  })

  it('D2: 치수(T6) 뒤에 상품 정보 표 하나 — designlong이어도 소재·원산지·크기·구성 표는 없고 관리·보관 표는 남는다. D1은 예전 그대로', () => {
    const d2 = job('A-track-i', D2, FACTS)
    const p = plan(d2)
    const info = p.sections.find((s) => s.key === 'long:info')!
    expect(info.template).toBe('T9')
    expect(info.text).toEqual({ eyebrow: 'INFO', headline: '상품 정보', sub: null })
    expect(p.order.indexOf('long:info')).toBe(p.order.indexOf('spec_table') + 1)
    expect(info.modules[0]).toEqual({ type: 'M9', data: { rows: infoRows(d2.spec_sheet) } })

    const long = job('A-track-i', [...D2, 'designlong'], FACTS)
    long.section_plan = { ...long.section_plan, long: decideLongSections(long.spec_sheet, []) }
    const keys = plan(long).sections.filter((s) => s.key.startsWith('long:')).map((s) => s.key)
    expect(keys).toContain('long:info')
    expect(keys).not.toContain('long:material')
    expect(keys).not.toContain('long:size')

    const d1 = job('A-track-i', [...ON, 'designlong'], FACTS)
    d1.section_plan = { ...d1.section_plan, long: decideLongSections(d1.spec_sheet, []) }
    const d1Keys = plan(d1).sections.filter((s) => s.key.startsWith('long:')).map((s) => s.key)
    expect(d1Keys).toContain('long:material')
    expect(d1Keys).not.toContain('long:info')
  })

  it('구석구석 보면(T10) — D2는 designlong 없이도 이미지 쪽 추가 컷 기록(2장 이상)을 싣는다', () => {
    const j = job('A-track-i')
    const shots = { version: 1, shots: [{ key: 'features:6', purpose: 'texture', caption: '근접' }, { key: 'long_scene:0', purpose: 'scene', caption: '' }] }
    j.section_plan = { ...j.section_plan, extra_shots: shots } as PdpJobRow['section_plan']
    // 컷 하나가 섹션 하나다(오너 지시 11-01 — 섹션 20개 내외). 캡션이 제목이고, 캡션이 없으면 막 이름이다
    const t10s = plan(j).sections.filter((s) => s.template === 'T10')
    expect(t10s.map((s) => s.key)).toEqual(['long:shot:0', 'long:shot:1'])
    expect(t10s.map((s) => s.text)).toEqual([
      { eyebrow: 'MORE VIEWS', headline: '근접', sub: null },
      { eyebrow: 'MORE VIEWS', headline: '구석구석 보면', sub: null },
    ])
    expect(t10s.map((s) => s.modules[0])).toEqual([
      { type: 'M10', data: { scenes: [{ imageKey: 'features:6', caption: '' }] } },
      { type: 'M10', data: { scenes: [{ imageKey: 'long_scene:0', caption: '' }] } },
    ])
    expect(section(job('A-track-i'), 'T10')).toBeUndefined()
  })

  it('추가 컷 하나만 있으면 섹션을 만들지 않고, 섹션은 한곳에 몰리지 않고 흩어진다', () => {
    const one = job('A-track-i')
    one.section_plan = { ...one.section_plan, extra_shots: { version: 1, shots: [{ key: 'long_scene:0', purpose: 'scene', caption: '' }] } } as PdpJobRow['section_plan']
    expect(section(one, 'T10')).toBeUndefined()

    const many = job('A-track-i')
    const shots = Array.from({ length: 6 }, (_, i) => ({ key: `features:${6 + i}`, purpose: 'texture', caption: `컷${i}` }))
    many.section_plan = { ...many.section_plan, extra_shots: { version: 1, shots } } as PdpJobRow['section_plan']
    const order = plan(many).order
    const positions = order.flatMap((key, i) => (key.startsWith('long:shot:') ? [i] : []))
    expect(positions).toHaveLength(6)
    // 추가 컷끼리 세 번 이어지지 않는다, 마무리 뒤로 가지 않는다
    expect(positions.some((p, i) => positions[i + 2] === p + 2)).toBe(false)
    expect(Math.max(...positions)).toBeLessThan(order.length - 1)
  })

  it('D2 잡은 페이지가 20섹션을 향해 채운다(태그·앵글이 모자라면 덜 채우되 18 이상), D2가 아니면 기본 계획 그대로', () => {
    for (const key of ['A-track-i', 'B-track-i', 'C-track-i'] as const) {
      const j = job(key, [...D2, 'shotdiv'])
      const filled = planExtraShotsForLength(j, pointCutsOf(j))!
      const p = plan({ ...j, section_plan: { ...j.section_plan, extra_shots: filled } })
      const count = p.sections.length + p.kept.length
      expect(count, key).toBeGreaterThanOrEqual(18)
      expect(count, key).toBeLessThanOrEqual(D2_SECTION_TARGET)
    }
    const d1 = job('A-track-i', [...ON, 'shotdiv'])
    expect(planExtraShotsForLength(d1, pointCutsOf(d1))).toEqual(planExtraShots(d1, pointCutsOf(d1)))
  })

  it('경계(B shotdiv) — 이미지 쪽 추가 컷 기록을 넣고 다시 계획해도 피처 컷 수는 같고, 구석구석 보면 첫 칸은 실사용(long_scene:0)', () => {
    const j = job('A-track-i', [...D2, 'shotdiv'])
    const cuts = pointCutsOf(j)
    expect(cuts).toBe(6)
    const extra = planExtraShots(j, cuts)!
    j.section_plan = { ...j.section_plan, extra_shots: extra }
    expect(pointCutsOf(j)).toBe(cuts)
    const t10 = section(j, 'T10')!
    expect(t10.modules[0].type).toBe('M10')
    if (t10.modules[0].type === 'M10') expect(t10.modules[0].data.scenes[0].imageKey).toBe('long_scene:0')
  })

  it('상품명 밖 사실이 2개 미만이면 표가 없다', () => {
    const thin = job('B-track-i', D2, { brandName: undefined, material: '종이 스티커' })
    expect(plan(thin).sections.some((s) => s.key === 'long:info')).toBe(false)
  })
})

describe('옵션 칩(T7) — D2는 형태 통일(사진 있으면 전부 사진, 하나라도 없으면 전부 이름)', () => {
  const optionSpec = (images: Array<string | undefined>) => ({
    source: 'manual' as const,
    axes: [{ kind: 'design' as const, name: '디자인', values: images.map((_, i) => `옵션${i + 1}`) }],
    variants: images.map((img, i) => ({
      label: `옵션${i + 1}`,
      values: { design: `옵션${i + 1}` },
      ...(img ? { sourceImage: img } : {}),
    })),
  })
  /** 설계 골격에 옵션 섹션(petit_div, option_catalog)을 끼운다 */
  const withOptions = (features: string[], images: Array<string | undefined>): PdpJobRow => {
    const j = job('A-track-i', features, { optionSpec: optionSpec(images) as PdpJobRow['spec_sheet']['optionSpec'] })
    const order = [...j.section_plan.section_order!]
    if (!order.includes('petit_div')) order.splice(order.indexOf('cta'), 0, 'petit_div')
    const skeleton = j.section_plan.internalized_skeleton!
    const stages = [...skeleton.persuasion!.stages, { section: 'petit_div', role: 'option_catalog', stage: 'VALUE' as const, reason: 'test' }]
    j.section_plan = {
      ...j.section_plan,
      section_order: order,
      internalized_skeleton: { ...skeleton, persuasion: { ...skeleton.persuasion!, stages } },
    }
    return j
  }
  const chipsOf = (j: PdpJobRow) => {
    const m = section(j, 'T7')!.modules.find((x) => x.type === 'M8')
    return m?.type === 'M8' ? m.data.chips.map((c) => c.image ?? null) : []
  }

  it('사진 없는 옵션이 섞이면 D2는 모두 이름만, 모두 있으면 사진 그대로 — D1은 섞인 그대로', () => {
    const mixed = ['https://img.test/a.png', undefined, 'https://img.test/c.png']
    expect(chipsOf(withOptions(D2, mixed))).toEqual([null, null, null])
    expect(chipsOf(withOptions(D2, ['https://img.test/a.png', 'https://img.test/b.png']))).toEqual([
      'https://img.test/a.png',
      'https://img.test/b.png',
    ])
    expect(chipsOf(withOptions(ON, mixed))).toEqual(['https://img.test/a.png', null, 'https://img.test/c.png'])
  })

  it('실물 사진 기준(isRealOptionPhoto) 밖 값은 사진 없는 옵션 — 자리표시·생성 실패 주소, http(s)가 아닌 값(D2 ③ 따로 절)', () => {
    const failed = 'https://placehold.co/600x600?text=Image+Generation+Failed'
    expect(chipsOf(withOptions(ON, ['https://img.test/a.png', failed, 'data:image/png;base64,AAAA']))).toEqual(['https://img.test/a.png', null, null])
    // D2는 하나라도 실물 사진이 아니면 모두 이름만(형태 통일)
    expect(chipsOf(withOptions(D2, ['https://img.test/a.png', failed]))).toEqual([null, null])
    expect(chipsOf(withOptions(D2, ['https://img.test/a.png', 'https://img.test/b.png']))).toEqual(['https://img.test/a.png', 'https://img.test/b.png'])
  })
})

describe('흐름 — 같은 템플릿·변형 3연속 풀기', () => {
  const piece = (key: string, template: DesigncutSection['template'], layoutVariant?: DesigncutSection['layoutVariant']) =>
    ({
      key,
      role: 'r',
      template,
      chapter: null,
      productImageKey: null,
      productAlpha: false,
      text: { eyebrow: null, headline: null, sub: null },
      modules: [],
      ...(layoutVariant ? { layoutVariant } : {}),
    }) as Omit<DesigncutSection, 'bg' | 'plateKey' | 'plateAspect'>
  const sigs = (order: string[], pieces: ReturnType<typeof piece>[]) =>
    order.map((k) => {
      const p = pieces.find((x) => x.key === k)
      return p ? `${p.template}${p.layoutVariant ? '/' + p.layoutVariant : ''}` : `kept`
    })

  it('셋째를 다음 다른 섹션 뒤로 옮기고, 마무리(T8) 뒤로는 옮기지 않는다 — 변형이 다르면 같은 템플릿이어도 그대로', () => {
    const pieces = [piece('a', 'T1'), piece('t1', 'T9'), piece('t2', 'T9'), piece('t3', 'T9'), piece('h', 'T5'), piece('cta', 'T8')]
    const order = pieces.map((p) => p.key)
    spreadRuns(pieces, order)
    expect(order).toEqual(['a', 't1', 't2', 'h', 't3', 'cta'])
    expect(pieces.map((p) => p.key)).toEqual(order)

    const tail = [piece('a', 'T1'), piece('x', 'T5'), piece('t1', 'T9'), piece('t2', 'T9'), piece('t3', 'T9'), piece('cta', 'T8')]
    const tailOrder = tail.map((p) => p.key)
    spreadRuns(tail, tailOrder)
    expect(tailOrder).toEqual(['a', 't1', 'x', 't2', 't3', 'cta'])

    const varied = [piece('p1', 'T3a', 'scene'), piece('p2', 'T3a', 'zigzag'), piece('p3', 'T3a', 'grid')]
    const variedOrder = varied.map((p) => p.key)
    spreadRuns(varied, variedOrder)
    expect(variedOrder).toEqual(['p1', 'p2', 'p3'])
  })

  it('기존 빌더 섹션(kept)이 끼면 연속이 아니다 — 픽스처 D2 계획은 3연속이 없다', () => {
    const pieces = [piece('t1', 'T9'), piece('t2', 'T9'), piece('t3', 'T9')]
    const order = ['t1', 't2', 'certification', 't3']
    spreadRuns(pieces, order)
    expect(order).toEqual(['t1', 't2', 'certification', 't3'])
    for (const key of ['A-track-i', 'B-track-i', 'C-track-i'] as const) {
      const p = plan(job(key))
      const s = sigs(p.order, p.sections as ReturnType<typeof piece>[])
      const triple = s.some((x, i) => i >= 2 && x !== 'kept' && x === s[i - 1] && x === s[i - 2])
      expect(triple, key).toBe(false)
    }
  })
})

describe('계약 왕복·생성 필터·조립', () => {
  it('readDesignCut이 T11·T12·형태 변형·hook을 그대로 읽고, 모르는 변형·형식 밖 값은 버린다', () => {
    const j = job('A-track-i', D2, { rating: 4.8, reviewCount: 12 })
    const p = plan(j)
    const read = readDesignCut({ ...j.section_plan, designcut: p })!
    expect(read.sections).toEqual(p.sections)
    const raw = JSON.parse(JSON.stringify(p))
    raw.sections[0].layoutVariant = 'carousel'
    const review = raw.sections.find((s: { template: string }) => s.template === 'T12')
    review.modules[0].data.cards[0].rating = 7
    review.modules[0].data.count = -3
    const detail = raw.sections.find((s: { template: string }) => s.template === 'T11')
    detail.modules[0].data.items[0].imageKey = 'hero'
    const bad = readDesignCut({ designcut: raw })!
    expect(bad.sections[0]).not.toHaveProperty('layoutVariant')
    const badReview = bad.sections.find((s) => s.template === 'T12')!.modules[0]
    expect(badReview).toMatchObject({ type: 'M12', data: { count: null } })
    if (badReview.type === 'M12') expect(badReview.data.cards[0].rating).toBeNull()
    const badDetail = bad.sections.find((s) => s.template === 'T11')!.modules[0]
    expect(badDetail.type).toBe('M11')
    if (badDetail.type === 'M11') expect(badDetail.data.items.map((i) => i.imageKey)).toEqual([null, 'features:4', 'features:5'])
  })

  it('생성 필터 — 자세히 보기 항목 컷(features:3~5)은 만들고, 후기(T12)는 대체용 기존 섹션 컷을 더하지 않는다', () => {
    const p = plan(job('A-track-i'))
    const filter = designcutTaskFilter(p)!
    for (const key of ['features:3', 'features:4', 'features:5']) expect(filter(key), key).toBe(true)
    expect(filter('rating_bg')).toBe(false)
  })

  it('조립 — 자세히 보기는 항목 제목·컷을, 후기는 따옴표 본문·가린 작성자·평점을 그린다', () => {
    const j = job('A-track-i', D2, { rating: 4.8, reviewCount: 1234 })
    const p = plan(j)
    const read = readDesignCut({ ...j.section_plan, designcut: p })!
    const images = { hero: 'https://img.test/hero.png', features: Array.from({ length: 6 }, (_, i) => `https://img.test/f${i}.png`) }
    const out = composeDesignCut([], read, { images, sectionOrder: j.section_plan.section_order ?? [] })
    const texts = out.flatMap((s) => s.elements.map((e) => (e.textProps?.content ?? '').replace(/ /g, ' ')))
    const srcs = out.flatMap((s) => s.elements.map((e) => e.framedImageProps?.src ?? e.imageProps?.src ?? ''))
    const detail = p.sections.find((s) => s.template === 'T11')!.modules[0]
    expect(detail.type).toBe('M11')
    if (detail.type === 'M11') for (const item of detail.data.items) expect(texts).toContain(item.title.replace(/ /g, ' '))
    expect(srcs).toEqual(expect.arrayContaining(['https://img.test/f3.png', 'https://img.test/f4.png', 'https://img.test/f5.png']))
    const cards = reviewCards(j.copy_sections.final!)
    for (const c of cards) expect(texts).toContain(`"${c.text}"`)
    expect(texts).toEqual(expect.arrayContaining(['구매 고객 후기', '4.8', '리뷰 1,234개']))
    expect(texts.some((t) => t.startsWith(cards[0].author))).toBe(true)
  })
})
