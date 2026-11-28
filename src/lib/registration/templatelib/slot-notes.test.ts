/**
 * K 슬롯 글 페이지 기록 — 같은 끝말 3연속, 세 번째 느낌표, 짝 없는 고민, POINT 제목 글자 수. 글을 지우거나 고치기 콜을 부르는 종류가 아니다.
 * 같은 말 반복(같은 첫머리 제목·POINT 제목끼리 같은 말, 적용 K3)은 고치기 콜을 부르고 글은 지우지 않는다.
 */

import { describe, expect, it } from 'vitest'
import { asksFix, dropProblemValues, dropsText, type CopySlot, type CopyValues } from './slot-copy'
import { endingOf, openingOf, pageCopyNotes, pageEchoProblems, pointTitleChars, type NoteSection } from './slot-notes'

const headline: CopySlot = { name: 'headline', required: true, facts: 0 }
const pains: CopySlot = { name: 'pains', required: false, facts: 0, list: { min: 1, max: 3, fields: [{ name: 'pain', required: true, facts: 0 }] } }

const page = (rows: Array<[string, CopyValues]>) => {
  const sections: NoteSection[] = rows.map(([section, values], index) => ({ index, section, slots: 'pains' in values ? [headline, pains] : [headline] }))
  return { sections, values: new Map(rows.map(([, values], index) => [index, values])) }
}
const notesOf = (rows: Array<[string, CopyValues]>) => {
  const { sections, values } = page(rows)
  return [...pageCopyNotes(sections, values)].flatMap(([index, list]) => list.map((note) => ({ index, slot: note.slot, kind: note.kind })))
}
const titled = (...titles: string[]) => titles.map((title): [string, CopyValues] => ['sub_div', { headline: title }])

describe('endingOf — 제목 끝말', () => {
  it.each([
    ['손이 편해요', '존댓말'],
    ['바로 쓸 수 있습니다', '존댓말'],
    ['엉키지 않아요!', '존댓말'],
    ['매번 번거로우셨나요?', '질문'],
    ['가벼운 하루', '하루'],
    ['가벼운 하루...', '하루'],
  ])('%s → %s', (title, ending) => {
    expect(endingOf(title)).toBe(ending)
  })
})

describe('같은 끝말', () => {
  it('세 섹션 연속이면 세 번째부터 기록한다', () => {
    expect(notesOf(titled('손이 편해요', '잘 닦여요', '오래 써요', '네 번째도 좋아요', '접어 두는 하루'))).toEqual([
      { index: 2, slot: 'headline', kind: 'ending' },
      { index: 3, slot: 'headline', kind: 'ending' },
    ])
  })

  it('두 섹션 연속이나 끼어든 다른 끝말은 기록하지 않는다', () => {
    expect(notesOf(titled('손이 편해요', '잘 닦여요', '접어 두는 하루', '오래 써요', '잘 말라요'))).toEqual([])
  })

  it('제목 칸이 없는 섹션은 건너뛴다 — 끊지 않는다', () => {
    const rows: Array<[string, CopyValues]> = [...titled('손이 편해요', '잘 닦여요'), ['sub2_div_page', { sub: '글' }], ...titled('오래 써요')]
    expect(notesOf(rows)).toEqual([{ index: 3, slot: 'headline', kind: 'ending' }])
  })
})

describe('느낌표', () => {
  it('페이지에 2번까지는 없고 세 번째가 든 섹션부터 기록한다', () => {
    expect(notesOf(titled('편한 손!', '가벼운 무게!', '닦이는 표면', '접히는 구조!', '남는 자리'))).toEqual([{ index: 3, slot: '섹션 전체', kind: 'exclaim' }])
    expect(notesOf(titled('편한 손!', '가벼운 무게!', '닦이는 표면'))).toEqual([])
  })

  it('목록 항목의 느낌표도 센다', () => {
    const rows: Array<[string, CopyValues]> = [['problem_raise', { headline: '무거운 냄비', pains: [{ pain: '무겁다!' }, { pain: '좁다!' }, { pain: '길다!' }] }]]
    expect(notesOf(rows).filter((note) => note.kind === 'exclaim')).toEqual([{ index: 0, slot: '섹션 전체', kind: 'exclaim' }])
  })
})

describe('고민-POINT 짝', () => {
  it('같은 낱말이 POINT에 없는 고민 글만 기록한다', () => {
    const rows: Array<[string, CopyValues]> = [
      ['problem_raise', { headline: '자꾸 번거로운 설거지', pains: [{ pain: '바닥 얼룩이 남아요' }, { pain: '손잡이가 미끄러워요' }] }],
      ['point_div', { headline: '얼룩 없이 닦이는 바닥' }],
    ]
    expect(notesOf(rows)).toEqual([{ index: 0, slot: 'pains.pain', kind: 'pair' }])
  })

  it('목록이 없으면 제목이 고민 글이다', () => {
    expect(notesOf([['problem_empathy', { headline: '설거지 끝나면 손목 시큰' }], ['point_div', { headline: '얼룩 없는 바닥' }]])).toEqual([{ index: 0, slot: 'headline', kind: 'pair' }])
    expect(notesOf([['problem_empathy', { headline: '바닥 얼룩이 남아서' }], ['point_div', { headline: '얼룩 없는 바닥' }]])).toEqual([])
  })

  it('POINT가 아닌 섹션의 글은 답으로 보지 않는다', () => {
    expect(notesOf([['problem_empathy', { headline: '바닥 얼룩이 남아서' }], ['sub_div', { headline: '얼룩 없는 바닥' }]])).toEqual([{ index: 0, slot: 'headline', kind: 'pair' }])
  })

  it('핵심 낱말이 없는 고민 글은 판정하지 않는다', () => {
    expect(notesOf([['problem_empathy', { headline: '이런 때 있죠?' }], ['point_div', { headline: '얼룩 없는 바닥' }]])).toEqual([])
  })
})

describe('기록 종류는 글을 지우지 않고 고치기 콜을 부르지 않는다', () => {
  it.each(['ending', 'exclaim', 'pair', 'orphan'] as const)('%s', (kind) => {
    expect(dropsText(kind)).toBe(false)
    expect(asksFix(kind)).toBe(false)
    expect(dropProblemValues({ headline: '글' }, [{ slot: 'headline', kind, detail: '' }])).toEqual({ headline: '글' })
  })

  it('규제 표현과 글자 수는 그대로 고치기 콜을 부르고 글을 지운다', () => {
    for (const kind of ['claim', 'length', 'number', 'compare', 'phrase'] as const) {
      expect(dropsText(kind)).toBe(true)
      expect(asksFix(kind)).toBe(true)
    }
  })
})

describe('같은 말 반복(K3 R-K20·R-K21)', () => {
  const echoesOf = (rows: Array<[string, CopyValues]>, exclude: string[] = []) => {
    const { sections, values } = page(rows)
    return [...pageEchoProblems(sections, values, exclude)].flatMap(([index, list]) => list.map((problem) => ({ index, slot: problem.slot, kind: problem.kind })))
  }
  const points = (...titles: string[]) => titles.map((title): [string, CopyValues] => ['point_div', { headline: title }])

  it('첫머리는 첫 두 어절이고 끝 조사를 뗀 꼴로 센다 — 한 어절 제목은 없다', () => {
    expect(openingOf('사료와 물을 한 번에')).toEqual({ key: '사료 물', shown: '사료와 물을' })
    expect(openingOf('사료와 물도 깔끔하게')?.key).toBe('사료 물')
    expect(openingOf('가벼움')).toBeNull()
  })

  it('첫머리가 같은 제목은 페이지에서 세 번째부터 고칠 곳이다 — 이어지지 않아도 센다', () => {
    expect(echoesOf(titled('사료와 물을 한 번에', '사료와 물도 깔끔하게', '편한 손잡이', '사료와 물로 넘치지 않게', '사료와 물을 함께'))).toEqual([
      { index: 3, slot: 'headline', kind: 'echo' },
      { index: 4, slot: 'headline', kind: 'echo' },
    ])
  })

  it('두 번까지·첫 어절만 같은 제목·한 어절 제목은 아니다', () => {
    expect(echoesOf(titled('사료와 물을 한 번에', '사료와 물도 깔끔하게', '사료 그릇 하나로'))).toEqual([])
    expect(echoesOf(titled('가벼움', '가벼움', '가벼움'))).toEqual([])
  })

  it('POINT 제목이 앞 POINT 제목과 같은 어절 짝을 쓰면 뒤 POINT만 고칠 곳이다', () => {
    expect(echoesOf(points('수채화 카네이션 그대로', '선명한 인쇄', '수채화 카네이션 답례 선물'))).toEqual([{ index: 2, slot: 'headline', kind: 'echo' }])
  })

  it('POINT 밖 제목끼리, 낱말 하나만 같은 POINT, 빼는 낱말(옵션 값·브랜드)·숫자로 된 짝은 아니다', () => {
    expect(echoesOf(titled('수채화 카네이션 그대로', '수채화 카네이션 답례 선물'))).toEqual([])
    expect(echoesOf(points('수채화 그대로', '수채화 답례'))).toEqual([])
    expect(echoesOf(points('세이지 그린 하나로', '세이지 그린 둘로'), ['세이지', '그린'])).toEqual([])
    expect(echoesOf(points('50 100 구성', '50 100 묶음'))).toEqual([])
  })

  it('고치기 콜을 부르지만 글은 지우지 않는다 — 같은 말은 틀린 글이 아니다', () => {
    expect(asksFix('echo')).toBe(true)
    expect(dropsText('echo')).toBe(false)
    expect(dropProblemValues({ headline: '글' }, [{ slot: 'headline', kind: 'echo', detail: '' }])).toEqual({ headline: '글' })
  })

  it('기록(pageCopyNotes)에는 나오지 않는다 — 고치기 콜을 부르지 않는 종류만 낸다', () => {
    const { sections, values } = page(titled('사료와 물을 한 번에', '사료와 물도 깔끔하게', '사료와 물로 넘치지 않게'))
    expect([...pageCopyNotes(sections, values).values()].flat().some((note) => note.kind === 'echo')).toBe(false)
  })
})

describe('POINT 제목 글자 수', () => {
  const titles = (...texts: string[]) => {
    const { sections, values } = page(texts.map((title): [string, CopyValues] => ['point_div', { headline: title }]))
    return pointTitleChars(sections, values)
  }

  it('공백을 뺀 글자 수의 중앙값이다', () => {
    expect(titles('가 나 다 라 마', '가나다', '가나다라마바사아자')).toEqual({ count: 3, medianChars: 5 })
    expect(titles('가나', '가나다라')).toEqual({ count: 2, medianChars: 3 })
  })

  it('POINT 밖 제목은 세지 않고, POINT가 없으면 값이 없다', () => {
    const { sections, values } = page([['sub_div', { headline: '가나다라마바사아자차카타' }]])
    expect(pointTitleChars(sections, values)).toEqual({ count: 0, medianChars: null })
  })
})
