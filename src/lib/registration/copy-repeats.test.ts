/**
 * 섹션 사이 반복(pdp-copy-facts-r4) — 어절 2-그램이 최상위 섹션 3곳 이상에 나오면 반복. pointCards·detailPoints는 한 묶음,
 * 옵션 값·브랜드·숫자 낱말은 뺀다. 입력은 R4 재합성 잡 실측 문구를 줄인 것(P03 '손가락 대신'·P07 '세이지 그린'·P01 '7가지 디자인').
 */

import { describe, expect, it } from 'vitest'
import type { CopywritingResult, PdpSpecSheet } from './pdp-state'
import {
  buildRepeatFixBlock,
  findCrossSectionRepeats,
  REPEAT_FIX_LIMIT,
  REPEAT_MIN_SECTIONS,
  repeatExclusionTerms,
  repeatFixEffect,
} from './copy-repeats'

const copyOf = (c: Record<string, unknown>) => c as unknown as CopywritingResult

describe('findCrossSectionRepeats', () => {
  it('P03: 손가락 대신이 여러 섹션에 — 섹션 수·이름을 돌려준다(문턱 3)', () => {
    expect(REPEAT_MIN_SECTIONS).toBe(3)
    const out = findCrossSectionRepeats(
      copyOf({
        mainIntro: { subBenefit: '손가락 대신 브러쉬로 감아요' },
        solution: { summary: '손가락 대신 실리콘 돌기가 닿아요' },
        summary: '손가락 대신 쓰는 샴푸 브러쉬',
        closingCta: { headline: '손가락 대신 브러쉬로 시작하세요' },
        pointCards: [{ title: '실리콘 돌기' }],
      })
    )
    expect(out[0]).toEqual({ phrase: '손가락 대신', sections: ['closingCta', 'mainIntro', 'solution', 'summary'] })
  })

  it('pointCards·detailPoints는 한 묶음(특징 배정 번호 짝) — 둘에만 나오면 반복이 아니다', () => {
    const out = findCrossSectionRepeats(
      copyOf({
        pointCards: [{ title: '반투명 소재', description: '반투명 소재라 안이 보여요' }],
        detailPoints: [{ claim: '반투명 소재로 내용물 확인' }],
        mainIntro: { subBenefit: '반투명 소재 파우치' },
      })
    )
    expect(out).toEqual([])
  })

  it('옵션 값(색·사이즈)·브랜드·숫자 낱말은 빼고, 한 글자 옵션 값은 같은 낱말만 뺀다(대신은 남는다)', () => {
    const spec = {
      productName: '식기',
      brandName: '페어넥스',
      colorOptions: ['세이지 그린', '크림'],
      optionSpec: {
        axes: [{ kind: 'size', name: '사이즈', values: ['대', '소'] }],
        variants: [
          { label: '대', values: { size: '대' } },
          { label: '소', values: { size: '소' } },
        ],
        source: 'products',
      },
    } as unknown as PdpSpecSheet
    const terms = repeatExclusionTerms(spec)
    expect(terms).toEqual(expect.arrayContaining(['세이지', '그린', '크림', '대', '소', '페어넥스']))
    const out = findCrossSectionRepeats(
      copyOf({
        mainIntro: { subBenefit: '세이지 그린으로 손가락 대신 페어넥스 식기' },
        solution: { summary: '세이지 그린 손가락 대신 페어넥스 식기' },
        closingCta: { headline: '세이지 그린 손가락 대신 페어넥스 식기' },
      }),
      { excludeTerms: terms }
    )
    expect(out.map((f) => f.phrase)).toEqual(['손가락 대신'])
  })

  it('옵션 목록(colorOptions.options)·이미지 힌트·파생 미러(sections 등)는 보지 않는다', () => {
    // 실제 칸(summary) 한 곳 + 보지 않는 칸 — 보지 않는 칸을 세면 3섹션(colorOptions·features·summary)이 된다
    const out = findCrossSectionRepeats(
      copyOf({
        summary: '7가지 디자인 준비',
        colorOptions: { options: ['7가지 디자인 A', '7가지 디자인 B'] },
        detailPoints: [{ imageHint: '7가지 디자인 나란히' }],
        sections: [{ sub_copy: '7가지 디자인' }],
        hero_copy: { subline: '7가지 디자인' },
        cta_variants: [{ copy: '7가지 디자인' }],
      })
    )
    expect(out).toEqual([])
  })

  it('섹션 수가 많은 순, 같으면 낱말 순', () => {
    const out = findCrossSectionRepeats(
      copyOf({
        mainIntro: { subBenefit: '한 그릇에 사료 칸' },
        solution: { summary: '한 그릇에 사료 칸' },
        summary: '한 그릇에 사료 칸',
        compareSummary: '한 그릇에 물',
      })
    )
    // 세기는 끝 조사를 뗀 꼴, 보여 주기는 가장 많이 나온 원래 꼴
    expect(out.map((f) => `${f.phrase}:${f.sections.length}`)).toEqual(['한 그릇에:4', '그릇에 사료:3', '사료 칸:3'])
  })

  it('조사를 뗀 꼴은 보이지 않는다 — 좋은 선택은 그대로(좋 선택이 아니다)', () => {
    const out = findCrossSectionRepeats(
      copyOf({
        mainIntro: { subBenefit: '좋은 선택으로 시작해요' },
        solution: { summary: '좋은 선택' },
        summary: '좋은 선택을 도와요',
      })
    )
    expect(out).toEqual([{ phrase: '좋은 선택', sections: ['mainIntro', 'solution', 'summary'] }])
  })

  it('조사만 다른 꼴은 같은 낱말로 센다(P02 반투명 소재와·소재로) — 한 글자 이·가는 떼지 않는다(고양이)', () => {
    const out = findCrossSectionRepeats(
      copyOf({
        solution: { summary: '반투명 소재와 넉넉한 크기' },
        recommendedTargets: ['반투명 소재로 내용물을 보이고 싶은 분'],
        mainCutCopy: { headline: '반투명 소재' },
        summary: '강아지 고양이 식기',
        closingCta: { headline: '강아지 고양이를 위한 식기' },
        compareSummary: '강아지 고양이와 함께',
      })
    )
    expect(out.map((f) => `${f.phrase}:${f.sections.length}`)).toEqual(['강아지 고양이:3', '반투명 소재:3'])
  })
})

describe('repeatFixEffect — 고칠 곳으로 넘긴 반복의 전후', () => {
  const f = (phrase: string, n: number) => ({ phrase, sections: Array.from({ length: n }, (_, i) => `s${i}`) })

  it('앞 limit개만 고칠 곳으로 세고, 줄어듦·사라짐·새로 생김을 나눈다', () => {
    const out = repeatFixEffect([f('한 장', 9), f('꽃 한', 8), f('상자 봉투', 5), f('무광 코팅', 3)], [f('한 장', 9), f('꽃 한', 7), f('새 말', 3)], 3)
    expect(out.top).toEqual([
      { phrase: '한 장', before: 9, after: 9 },
      { phrase: '꽃 한', before: 8, after: 7 },
      { phrase: '상자 봉투', before: 5, after: 0 },
    ])
    expect(out).toMatchObject({ reduced: 2, gone: 1, fresh: 1, total: { before: 4, after: 3 } })
  })

  it('기본은 고칠 곳 상한과 같다, 찾은 것이 없으면 0', () => {
    const many = Array.from({ length: REPEAT_FIX_LIMIT + 2 }, (_, i) => f(`말 ${i}`, 3))
    expect(repeatFixEffect(many, []).top).toHaveLength(REPEAT_FIX_LIMIT)
    expect(repeatFixEffect([], [])).toMatchObject({ top: [], reduced: 0, gone: 0, fresh: 0 })
  })
})

describe('buildRepeatFixBlock', () => {
  it('반복이 없으면 빈 문자열(Stage 3 프롬프트 불변)', () => {
    expect(buildRepeatFixBlock([])).toBe('')
  })

  it('상위 5개만, 특징 묶음은 주 섹션이라 목록에서 빼고 함께 있음만 적는다', () => {
    const findings = Array.from({ length: 7 }, (_, i) => ({
      phrase: `낱말${i} 반복`,
      sections: ['features', 'mainIntro', 'summary'],
    }))
    const block = buildRepeatFixBlock(findings)
    expect(REPEAT_FIX_LIMIT).toBe(5)
    expect(block.split('\n')[0]).toBe('## [섹션 사이 반복 — 고칠 곳(결정론 검사)]')
    expect(block.split('\n').filter((l) => l.startsWith("- '"))).toHaveLength(5)
    expect(block).toContain("- '낱말0 반복' — mainIntro·summary(pointCards·detailPoints에도 있음)")
  })
})
