import { describe, it, expect } from 'vitest'
import { composePdp, type ComposePdpInput } from './pdp-composer'
import { buildAvailableSections } from './pdp-composer-sections'
import { toGeneratedImagesMap } from './pdp-image-tasks'
import type { CopywritingResult, GeneratedImagesMap, PdpSpecSheet, SectionImage, SectionPlan, StrategyContract } from './pdp-state'

function baseInput(overrides: Partial<ComposePdpInput> = {}): ComposePdpInput {
  const specSheet: PdpSpecSheet = { productName: '테스트 상품', ...overrides.specSheet }
  const copy: CopywritingResult = {
    mainIntro: { title: '메인 헤드라인', subtitle: '서브 헤드라인' },
    closingCta: { headline: '지금 구매하기', subtext: '오늘만 특가' },
    ...overrides.copy,
  }
  const images: GeneratedImagesMap = { hero: 'https://img/hero.jpg', ...overrides.images }
  const sectionPlan: SectionPlan = { ...overrides.sectionPlan }
  const strategyContract: StrategyContract = { ...overrides.strategyContract }
  return {
    mode: overrides.mode ?? 'premium',
    copy,
    images,
    sectionPlan,
    strategyContract,
    specSheet,
  }
}

describe('composePdp — section_order 우선순위', () => {
  it('section_plan.section_order가 있으면 그 순서를 그대로 따른다', () => {
    const input = baseInput({ sectionPlan: { section_order: ['cta', 'main_intro'] } })
    const { sections } = composePdp(input)
    expect(sections.map((s) => s.type)).toEqual(['cta', 'main_intro'])
  })

  it('section_order 없으면 essence 폴백(premium) — sold_out_banner가 main_intro보다 앞선다', () => {
    const input = baseInput({
      specSheet: { productName: '완판상품', soldOutCount: 5 },
    })
    const { sections } = composePdp(input)
    const types = sections.map((s) => s.type)
    expect(types[0]).toBe('sold_out_banner')
    expect(types.indexOf('sold_out_banner')).toBeLessThan(types.indexOf('main_intro'))
    expect(types.at(-1)).toBe('cta')
  })

  it('section_order 없고 pro + 빈 strategy_contract면 PRO_DEFAULT_ORDER를 따른다(main_intro가 problem보다 앞)', () => {
    const input = baseInput({
      mode: 'pro',
      copy: {
        mainIntro: { title: '메인' },
        problem: { question: '문제 있나요?' },
        closingCta: { headline: 'CTA' },
      },
    })
    const { sections } = composePdp(input)
    const types = sections.map((s) => s.type)
    expect(types.indexOf('main_intro')).toBeLessThan(types.indexOf('problem'))
    expect(types.at(-1)).toBe('cta')
  })
})

describe('composePdp — FLOW_ALIAS 정규화', () => {
  it('설계 LLM·템플릿 flow의 이명 키를 내부 표준 키로 변환한다', () => {
    const input = baseInput({
      sectionPlan: { section_order: ['hook_3step', 'problem_raise', 'solution_guide', 'petit_div'] },
      copy: {
        mainIntro: { title: '메인' },
        problem: { question: '문제' },
        solution: { declaration: '해결' },
        colorOptions: { title: '컬러', options: ['블랙', '화이트'] },
      },
    })
    const { sections } = composePdp(input)
    expect(sections.map((s) => s.type)).toEqual(['main_intro', 'problem', 'solution', 'color_options'])
  })
})

describe('composePdp — perf_rating 데이터 게이트', () => {
  it('spec_sheet.rating이 없으면 perf_rating 섹션을 생략한다(허위 평점 표기 방지)', () => {
    const input = baseInput({
      mode: 'pro',
      sectionPlan: { section_order: ['perf_rating', 'cta'] },
    })
    const { sections } = composePdp(input)
    expect(sections.some((s) => s.type === 'perf_rating')).toBe(false)
  })

  it('spec_sheet.rating이 있으면 perf_rating 섹션을 실값으로 채운다', () => {
    const input = baseInput({
      mode: 'pro',
      sectionPlan: { section_order: ['perf_rating', 'cta'] },
      specSheet: { productName: '평점상품', rating: 4.8 },
    })
    const { sections } = composePdp(input)
    const rating = sections.find((s) => s.type === 'perf_rating')
    expect(rating?.headline).toBe('4.8')
    expect(rating?.sub_copy).toBe('★★★★★ 4.8 / 5.0')
  })

  it('perf_rating 별은 평점만큼 — 4.0이면 다섯 개를 다 채우지 않는다(근거 없는 기본값 제거)', () => {
    const input = baseInput({
      mode: 'pro',
      sectionPlan: { section_order: ['perf_rating', 'cta'] },
      specSheet: { productName: '평점상품', rating: 4.0 },
    })
    const rating = composePdp(input).sections.find((s) => s.type === 'perf_rating')
    expect(rating?.sub_copy).toBe('★★★★☆ 4 / 5.0')
  })
})

describe('composePdp — 리뷰 목록 작성자 표기(R6)', () => {
  it('인용 카드(평점 있음)는 작성자를 붙이지 않고, 평점 없는 기존 발췌는 그대로', () => {
    const input = baseInput({
      mode: 'pro',
      sectionPlan: { section_order: ['reviews', 'cta'] },
      copy: {
        reviewHighlights: [
          { text: '손잡이가 편해요', author: '구매고객', rating: 4 },
          { text: '거품이 잘 나요', author: '구매고객' },
        ],
      },
    })
    const { finalHtml } = composePdp(input)
    expect(finalHtml).toContain('<li style="margin:4px 0;">손잡이가 편해요</li>')
    expect(finalHtml).toContain('거품이 잘 나요 — 구매고객')
  })
})

describe('composePdp — 결정론', () => {
  it('동일 입력을 두 번 호출하면 바이트 동일 출력을 낸다', () => {
    const input = baseInput({
      mode: 'pro',
      specSheet: { productName: '결정론상품', soldOutCount: 2, rating: 4.5, certificationInfo: 'KC 인증' },
      copy: {
        mainIntro: { benefitHeadline: '혜택 헤드라인' },
        problem: { question: '문제', empathyLines: ['공감1', '공감2'] },
        pointCards: [{ title: 'P1', description: 'D1' }],
        detailPoints: [{ claim: 'C1', proof: 'PR1' }],
      },
    })
    const first = composePdp(input)
    const second = composePdp(baseInput({
      mode: 'pro',
      specSheet: { productName: '결정론상품', soldOutCount: 2, rating: 4.5, certificationInfo: 'KC 인증' },
      copy: {
        mainIntro: { benefitHeadline: '혜택 헤드라인' },
        problem: { question: '문제', empathyLines: ['공감1', '공감2'] },
        pointCards: [{ title: 'P1', description: 'D1' }],
        detailPoints: [{ claim: 'C1', proof: 'PR1' }],
      },
    }))
    expect(second).toEqual(first)
  })
})

describe('composePdp — 빈 섹션 배제', () => {
  it('이미지도 카피도 없는 섹션은 최종 sections에서 제외된다', () => {
    const input = baseInput({
      sectionPlan: { section_order: ['color_options', 'main_intro'] },
      copy: { mainIntro: { title: '메인' } }, // colorOptions 미지정 → color_options는 available에도 없음
    })
    const { sections } = composePdp(input)
    expect(sections.map((s) => s.type)).toEqual(['main_intro'])
  })
})

describe('buildAvailableSections — 빈 문자열 폴백(원본 Python `or` 체인)', () => {
  const images = { hero: 'https://img/hero.jpg' }
  const spec = { productName: '테스트 상품' }

  it('key_message: 전용 카피가 빈 문자열이면 다음 후보(keyMessageVariations → pointCards → detailPoints)로 넘어간다', () => {
    const available = buildAvailableSections(
      'pro',
      {
        keyMessageCopy: { headline: '', subCopy: '  ' },
        keyMessageVariations: { top: '', mid: '중간 메시지', bottom: '' },
        pointCards: [{ title: '카드 제목', description: '카드 설명' }],
      },
      images,
      spec,
    )
    const km = available.key_message as { headline: string; sub_copy: string }
    expect(km.headline).toBe('카드 제목')
    expect(km.sub_copy).toBe('중간 메시지')
  })

  it('convert_div: 전용 카피가 빈 문자열이면 closingCta → keyMessageVariations.bottom 순으로 넘어간다', () => {
    const available = buildAvailableSections(
      'pro',
      {
        convertDivCopy: { headline: '', subCopy: '' },
        closingCta: { headline: '', subtext: '오늘만 특가' },
        keyMessageVariations: { bottom: '지금 담아보세요' },
      },
      images,
      spec,
    )
    const cd = available.convert_div as { headline: string; sub_copy: string }
    expect(cd.headline).toBe('지금 담아보세요')
    expect(cd.sub_copy).toBe('오늘만 특가')
  })

  it('전용 카피에 내용이 있으면 그대로 쓴다(기존 동작)', () => {
    const available = buildAvailableSections(
      'pro',
      {
        keyMessageCopy: { headline: '전용 헤드', subCopy: '전용 서브' },
        convertDivCopy: { headline: '전환 헤드', subCopy: '전환 서브' },
        closingCta: { headline: 'CTA', subtext: 'sub' },
      },
      images,
      spec,
    )
    expect(available.key_message).toMatchObject({ headline: '전용 헤드', sub_copy: '전용 서브' })
    expect(available.convert_div).toMatchObject({ headline: '전환 헤드', sub_copy: '전환 서브' })
  })
})

describe('buildAvailableSections — 번호 컷이 중간에 실패해도 컷과 항목이 엇갈리지 않는다', () => {
  const url = (section: string) => `https://cdn.test/${section.replace(':', '-')}.png`
  const entry = (section: string, ok = true): SectionImage =>
    ok ? { section, url: url(section) } : { section, url: '', error: `${section} 생성 실패` }
  const copy: CopywritingResult = {
    detailPoints: Array.from({ length: 6 }, (_, i) => ({ claim: `특징 ${i + 1}`, proof: `근거 ${i + 1}` })),
    pointCards: Array.from({ length: 4 }, (_, i) => ({ title: `카드 ${i + 1}`, description: `설명 ${i + 1}` })),
    howTo: Array.from({ length: 3 }, (_, i) => ({ step: `단계 ${i + 1}`, description: `방법 ${i + 1}` })),
  }

  it('features:4 실패·features:5 성공 — 5번 특징은 5번 컷, 4번 특징은 사진 없이(뒤 컷을 당겨 오지 않는다)', () => {
    const images = toGeneratedImagesMap([
      ...[0, 1, 2, 3].map((i) => entry(`features:${i}`)),
      entry('features:4', false),
      entry('features:5'),
    ])
    const points = buildAvailableSections('premium', copy, images, { productName: '테스트 상품' }).detail_points as Array<{
      image: string
    }>
    expect(points.map((p) => p.image)).toEqual([
      url('features:0'),
      url('features:1'),
      url('features:2'),
      url('features:3'),
      '',
      url('features:5'),
    ])
  })

  it('사용법 단계·요약 카드 아이콘도 같은 번호 컷만 — 실패한 번호는 빈 칸', () => {
    const images = toGeneratedImagesMap([
      entry('howto:0'),
      entry('howto:1', false),
      entry('howto:2'),
      entry('usp_icons:0', false),
      ...[1, 2, 3].map((i) => entry(`usp_icons:${i}`)),
    ])
    const available = buildAvailableSections('premium', copy, images, { productName: '테스트 상품' })
    expect((available.how_to as Array<{ image: string }>).map((h) => h.image)).toEqual([url('howto:0'), '', url('howto:2')])
    const cards = (available.point_cards as unknown as { cards: Array<{ icon_url?: string }> }).cards
    expect(cards.map((c) => c.icon_url)).toEqual([undefined, url('usp_icons:1'), url('usp_icons:2'), url('usp_icons:3')])
  })

  it('번호 밖 여분 컷은 그대로 빈 항목이 대신 쓴다(같은 컷 중복 없이) — 뒤 항목 자기 컷만 건너뛴다', () => {
    // 특징 4개·컷 6장: 2번 컷 실패 → 2번 항목은 뒤 항목(3번) 컷이 아니라 번호 밖 여분 컷(4·5번 중 앞)
    const images = toGeneratedImagesMap([0, 1, 2, 3, 4, 5].map((i) => entry(`features:${i}`, i !== 2)))
    const four = { ...copy, detailPoints: copy.detailPoints!.slice(0, 4) }
    const points = buildAvailableSections('premium', four, images, { productName: '테스트 상품' }).detail_points as Array<{
      image: string
    }>
    expect(points.map((p) => p.image)).toEqual([url('features:0'), url('features:1'), url('features:4'), url('features:3')])
  })
})
