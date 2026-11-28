/**
 * 카피 사실 값(pdp-copy-facts-r4) — 등록 옵션 구조에서 옵션 개수·수량을 계산하고, 최종 카피의 축 개수 오기를 숫자만 고친다.
 * 입력은 R4 P01(844d1231) 실측 구조: 수량 20·30·50개 × 디자인 6종(생일답례-01~05·07, 06 없음), 변형 13개, 30개는 04만.
 * 검수 지적 반영: 빠진 조합의 값별 개수는 맞는 개수, 값 하나를 짚은 문장·범위·묶음·옵션명 속 숫자는 고치지 않고, 옵션명·리뷰
 * 원문·상품명 칸은 보지 않는다. 축 낱말 앞뒤 경계로 '특색'·'색도화지'·'스타일'을 잡지 않는다.
 */

import { describe, expect, it } from 'vitest'
import type { OptionSpec } from './options/option-spec'
import type { CopywritingResult, PdpSpecSheet } from './pdp-state'
import { buildCopyFacts, buildCopyFactsBlock, correctCopyFacts, type CopyFacts } from './copy-facts'

const DESIGNS = ['생일답례-01', '생일답례-02', '생일답례-03', '생일답례-04', '생일답례-05', '생일답례-07']
const variant = (q: string, d: string) => ({ label: `${q} ${d}`, values: { quantity: q, design: d } })
const P01_SPEC: OptionSpec = {
  axes: [
    { kind: 'quantity', name: '수량', values: ['20개', '30개', '50개'] },
    { kind: 'design', name: '디자인', values: DESIGNS },
  ],
  variants: [
    ...DESIGNS.map((d) => variant('20개', d)),
    variant('30개', '생일답례-04'),
    ...DESIGNS.map((d) => variant('50개', d)),
  ],
  source: 'products',
}
/** 디자인 3 × 색상 2, C는 블랙만 */
const COLOR_SPEC: OptionSpec = {
  axes: [
    { kind: 'design', name: '디자인', values: ['A', 'B', 'C'] },
    { kind: 'color', name: '색상', values: ['블랙', '화이트'] },
  ],
  variants: [
    { label: 'A 블랙', values: { design: 'A', color: '블랙' } },
    { label: 'A 화이트', values: { design: 'A', color: '화이트' } },
    { label: 'B 블랙', values: { design: 'B', color: '블랙' } },
    { label: 'B 화이트', values: { design: 'B', color: '화이트' } },
    { label: 'C 블랙', values: { design: 'C', color: '블랙' } },
  ],
  source: 'products',
}
const sheet = (optionSpec?: OptionSpec) =>
  ({ productName: '생일 답례 스티커', ...(optionSpec ? { optionSpec } : {}) }) as PdpSpecSheet
const p01 = () => buildCopyFacts(sheet(P01_SPEC))!
const fix = (text: string, facts: CopyFacts = p01()) =>
  correctCopyFacts({ mainIntro: { subBenefit: text } } as CopywritingResult, facts)
const fixedText = (text: string, facts?: CopyFacts) => fix(text, facts).copy.mainIntro?.subBenefit

describe('buildCopyFacts', () => {
  it('P01: 축마다 서로 다른 값 개수·변형 수·빠진 조합(30개는 04만)·맞는 개수(값별 개수 포함, 양방향)·옵션명', () => {
    const facts = p01()
    expect(facts).toMatchObject({
      axes: [
        { kind: 'quantity', name: '수량', values: ['20개', '30개', '50개'] },
        { kind: 'design', name: '디자인', values: DESIGNS },
      ],
      variantCount: 13,
      partialCombos: ['30개: 생일답례-04'],
      // 디자인: 전체 6 + 30개의 1, 수량: 전체 3 + 04 말고 디자인의 2(20·50개)
      validCounts: { quantity: [3, 2], design: [6, 1] },
    })
    expect(facts.optionTerms).toEqual(expect.arrayContaining(['20개 생일답례-01', '30개 생일답례-04', '생일답례-07', '50개']))
  })

  it('등록 옵션 구조가 없으면 null — 블록도 없다(프롬프트 그대로)', () => {
    expect(buildCopyFacts(sheet())).toBeNull()
    expect(buildCopyFactsBlock(null)).toBe('')
  })

  it('값은 trim·중복 제거, 모든 조합이 있으면 빠진 조합이 없다', () => {
    const facts = buildCopyFacts(
      sheet({
        axes: [
          { kind: 'design', name: '디자인', values: ['데이지', ' 데이지', '체리'] },
          { kind: 'size', name: '사이즈', values: ['S', 'L'] },
        ],
        variants: ['데이지(S)', '데이지(L)', '체리(S)', '체리(L)'].map((label) => ({
          label,
          values: { design: label.slice(0, -3), size: label.slice(-2, -1) },
        })),
        source: 'products',
      })
    )
    expect(facts?.axes[0].values).toEqual(['데이지', '체리'])
    expect(facts?.partialCombos).toEqual([])
    expect(facts?.validCounts).toEqual({ design: [2], size: [2] })
  })
})

describe('buildCopyFactsBlock', () => {
  it('개수·수량·변형·빠진 조합·번호 주의 — 축 이름 뒤에 조사를 붙이지 않는다', () => {
    expect(buildCopyFactsBlock(p01())).toBe(
      [
        '## [사실 값 — 옵션 개수·수량 숫자는 이 값만 쓴다]',
        '- 수량: 20개/30개/50개',
        '- 디자인 6가지',
        '- 등록 옵션 13개(수량·디자인 조합)',
        '- 모든 조합이 있지는 않다 — 30개: 생일답례-04. 모든 수량·디자인 조합이 있는 것처럼 쓰지 마라.',
        '- 옵션명 속 번호(예: -07)는 이름이다. 번호 최댓값을 개수로 읽지 마라. 개수를 말할 때는 위 개수만 쓴다.',
      ].join('\n')
    )
  })
})

describe('correctCopyFacts — 축 낱말과 붙은 개수만 고친다', () => {
  it.each([
    ['7가지 디자인을 골라 붙여요', '6가지 디자인을 골라 붙여요'],
    ['7가지의 패턴', '6가지의 패턴'],
    ['디자인 7종이 준비돼 있어요', '디자인 6종이 준비돼 있어요'],
    ['7종 도안으로 꾸며요', '6종 도안으로 꾸며요'],
    ['20개부터 50개까지, 7가지 디자인', '20개부터 50개까지, 6가지 디자인'],
    ['17가지 디자인', '6가지 디자인'],
    // '입니다'는 묶음('20입')이 아니다
    ['7가지 디자인입니다', '6가지 디자인입니다'],
    ['디자인 7종입니다', '디자인 6종입니다'],
  ])('%s → %s(조사·나머지 글자 그대로)', (from, to) => {
    const out = fix(from)
    expect(out.copy.mainIntro?.subBenefit).toBe(to)
    expect(out.corrections).toEqual([{ path: 'mainIntro.subBenefit', from, to }])
  })

  it('색 축: 색 낱말로 대조하고, 앞뒤에 다른 한글이 붙은 낱말(특색·배색·색다른·색도화지·색감)은 잡지 않는다', () => {
    const facts = buildCopyFacts(sheet(COLOR_SPEC))!
    expect(fixedText('3가지 색으로 고르세요', facts)).toBe('2가지 색으로 고르세요')
    expect(fixedText('컬러 5종', facts)).toBe('컬러 2종')
    for (const text of ['이 상품의 특색 3가지', '배색 3종', '3가지 색다른 활용', '3가지 색도화지', '5가지 색감'])
      expect(fix(text, facts).corrections, text).toEqual([])
  })

  it('파생 칸(배열·중첩)까지 모두 고치고 입력 카피는 바꾸지 않는다', () => {
    const copy = {
      pointCards: [{ title: '7가지 디자인' }],
      sections: [{ sub_copy: '7가지 패턴 중 골라보세요' }],
    } as unknown as CopywritingResult
    const out = correctCopyFacts(copy, p01())
    expect(out.corrections.map((c) => c.path)).toEqual(['pointCards[0].title', 'sections[0].sub_copy'])
    expect((copy as unknown as { pointCards: Array<{ title: string }> }).pointCards[0].title).toBe('7가지 디자인')
    expect(out.warnings[0]).toBe('[CopyFacts] 옵션 개수 2곳 정정 — copy_sections.fact_corrections 참조')
  })
})

describe('correctCopyFacts — 고치지 않는 경우(검수 지적)', () => {
  it('빠진 조합의 값별 개수는 맞는 개수다 — 고치지 않고 모든 조합 경고도 없다', () => {
    for (const text of ['30개는 1가지 디자인만 있어요', '50개는 6가지 디자인, 30개는 1가지 디자인']) {
      const out = fix(text)
      expect(out.corrections, text).toEqual([])
      expect(out.warnings, text).toEqual([])
    }
    expect(fix('C 디자인은 1가지 색상', buildCopyFacts(sheet(COLOR_SPEC))!).corrections).toEqual([])
  })

  it('다른 축 값 하나를 짚은 문장의 틀린 개수는 고치지 않고 경고만(그 값의 개수를 전체 개수로 덮지 않는다)', () => {
    const out = fix('30개는 7가지 디자인이에요')
    expect(out.corrections).toEqual([])
    expect(out.warnings).toEqual([
      "[CopyFacts] 옵션 값 하나의 개수가 사실과 다름 '7가지 디자인'(mainIntro.subBenefit) — 30개: 생일답례-04",
    ])
  })

  it('범위·묶음 구성·옵션이 아닌 뜻의 낱말(스타일·타입)은 고치지 않는다', () => {
    expect(fixedText('6~7가지 디자인')).toBe('6~7가지 디자인')
    expect(fix('6~7가지 디자인').warnings).toContain(
      "[CopyFacts] 범위로 쓴 개수 '7가지 디자인'(mainIntro.subBenefit) — 디자인 6가지 확인"
    )
    for (const text of ['디자인 3종 세트로 드려요', '3가지 스타일로 연출해 보세요', '2가지 타입의 스티커 모양'])
      expect(fix(text).corrections, text).toEqual([])
  })

  it('상품명은 보호어 — 히어로 상품명 등 글 속 상품명의 숫자는 그대로, 다른 칸의 오기는 고친다', () => {
    const facts = buildCopyFacts({ ...sheet(P01_SPEC), productName: '꽃 스티커 디자인 7종' } as PdpSpecSheet)!
    const copy = {
      mainIntro: { brandAndName: '꽃 스티커 디자인 7종', subBenefit: '7가지 디자인을 골라요' },
    } as unknown as CopywritingResult
    const out = correctCopyFacts(copy, facts)
    expect(out.corrections).toEqual([
      { path: 'mainIntro.subBenefit', from: '7가지 디자인을 골라요', to: '6가지 디자인을 골라요' },
    ])
  })

  it('등록 옵션명 칸(options)·리뷰 원문(reviewHighlights)·상품명(title)은 보지 않고, 글 속 옵션명의 숫자도 그대로다', () => {
    const facts = buildCopyFacts(
      sheet({
        axes: [{ kind: 'design', name: '디자인', values: ['디자인 3종 세트', '디자인 5종 세트'] }],
        variants: [
          { label: '디자인 3종 세트', values: { design: '디자인 3종 세트' } },
          { label: '디자인 5종 세트', values: { design: '디자인 5종 세트' } },
        ],
        source: 'products',
      })
    )!
    const copy = {
      title: '7가지 디자인 스티커',
      colorOptions: { options: ['디자인 3종 세트', '디자인 5종 세트'] },
      reviewHighlights: [{ text: '7가지 디자인이 다 예뻐요' }],
      mainIntro: { subBenefit: '디자인 5종 세트는 넉넉해요' },
    } as unknown as CopywritingResult
    expect(correctCopyFacts(copy, facts).corrections).toEqual([])
  })
})

describe('correctCopyFacts — 경고만(고치지 않음)', () => {
  it('축·일반 낱말이 있는 글의 사실 값에 없는 개수(떨어진 꼴 포함)는 경고, 맞으면 조용하다', () => {
    expect(fix('9가지 구성으로 준비했어요').warnings).toEqual([
      "[CopyFacts] 사실 값에 없는 개수 '9가지'(mainIntro.subBenefit) — 등록 옵션 13개 확인",
    ])
    expect(fix('디자인은 7가지').warnings).toEqual([
      "[CopyFacts] 사실 값에 없는 개수 '7가지'(mainIntro.subBenefit) — 등록 옵션 13개 확인",
    ])
    expect(fix('13가지 옵션 중 선택').warnings).toEqual([])
    // 축·일반 낱말이 없는 글은 보지 않는다
    expect(fix('3가지 이유가 있어요').warnings).toEqual([])
  })

  it('등록 수량과 함께 쓴 다른 수량은 경고 — 수량이 없는 문장의 개수(칸 2개)는 보지 않는다', () => {
    expect(fix('20개부터 45개까지 골라요').warnings).toEqual([
      "[CopyFacts] 등록 수량(20개/30개/50개)에 없는 수량 '45개'(mainIntro.subBenefit)",
    ])
    expect(fix('칸 2개로 나뉜 그릇').warnings).toEqual([])
  })

  it('빠진 조합이 있는데 두 축 모두 여러 값을 말하면 모든 조합처럼 읽힌다고 경고(고친 뒤 문장으로)', () => {
    const out = fix('20개부터 50개까지, 7가지 디자인')
    expect(out.warnings).toContain(
      "[CopyFacts] 모든 조합이 있지는 않은데(30개: 생일답례-04) 모든 조합처럼 읽힘: '20개부터 50개까지, 6가지 디자인'(mainIntro.subBenefit)"
    )
    for (const text of ['20~50개, 모든 디자인', '20·30·50개 모두 6가지 디자인', '20/30/50개, 6가지 디자인'])
      expect(fix(text).warnings.some((w) => w.includes('모든 조합처럼')), text).toBe(true)
    // 수량 축이 없는 빠진 조합(R4 P02 — 데이지: S / 체리: L)
    const p02 = buildCopyFacts(
      sheet({
        axes: [
          { kind: 'design', name: '디자인', values: ['데이지', '체리'] },
          { kind: 'size', name: '사이즈', values: ['S', 'L'] },
        ],
        variants: [
          { label: '데이지(S)', values: { design: '데이지', size: 'S' } },
          { label: '체리(L)', values: { design: '체리', size: 'L' } },
        ],
        source: 'products',
      })
    )!
    expect(fix('데이지·체리 모두 S·L 사이즈로', p02).warnings.some((w) => w.includes('모든 조합처럼'))).toBe(true)
    // 범위가 수량 단위 없이 쓰이면(6~7가지) 수량 범위가 아니다
    expect(fix('6~7가지 디자인').warnings.some((w) => w.includes('모든 조합처럼'))).toBe(false)
    // 빠진 조합이 없으면 경고하지 않는다
    expect(fix('20개부터 50개까지, 6가지 디자인', { ...p01(), partialCombos: [] }).warnings).toEqual([])
  })

  it('경고는 잡 오류 칸에 붙으므로 4건까지 — 나머지는 개수로', () => {
    const copy = {
      a: '9가지 구성',
      b: '8가지 구성',
      c: '7가지 구성',
      d: '5가지 구성',
      e: '4가지 구성',
      f: '11가지 구성',
    } as unknown as CopywritingResult
    const out = correctCopyFacts(copy, p01())
    expect(out.warnings).toHaveLength(5)
    expect(out.warnings[4]).toBe('[CopyFacts] 경고 외 2건')
  })
})
