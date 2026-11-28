/**
 * 편집기 카피 재생성 가드(pdp-copy-regen-api) — 후보마다 결정론적 검사. 통과한 것만 돌려주고, 판정하지 못하면 탈락(unjudged).
 * 코퍼스는 similarity-gate 시험과 같은 방식으로 만든 해시 코퍼스, 경쟁사 재현은 실제 buildEchoGuard를 쓴다.
 */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { copyRegenLengthLimits, guardCopyCandidates, type CopyGuardContext } from './pdp-copy-regen-guard'
import { buildEchoGuard } from './reviews/competitor-echo'
import type { CopyFacts } from './copy-facts'
import type { CorpusCheck } from './similarity-gate'

function makeCorpus(sentences: string[]): CorpusCheck {
  const grams = (text: string) => {
    const clean = text.replace(/\s+/gu, '')
    const out = new Set<string>()
    for (let i = 0; i <= clean.length - 3; i++) out.add(clean.slice(i, i + 3))
    return [...out].map((g) => createHash('sha256').update(g, 'utf8').digest('hex').slice(0, 12))
  }
  return {
    schemaVersion: 1,
    algo: 'char3gram-sha256-12',
    generatedAt: '2026-10-29T00:00:00.000Z',
    sentenceCount: sentences.length,
    sentences: sentences.map((s) => ({ len: s.length, grams: grams(s) })),
  }
}

const CURRENT = '매일 쓰는 컵이라\n세척이 쉬워야 해요'
const ctx = (over: Partial<CopyGuardContext> = {}): CopyGuardContext => ({
  currentText: CURRENT,
  corpus: null,
  echoGuard: null,
  minAge: null,
  ...over,
})

describe('guardCopyCandidates', () => {
  it('깨끗한 후보는 순서대로 통과한다(정리한 글로)', () => {
    const out = guardCopyCandidates(
      ['손잡이까지 통째로\n물로 헹궈 끝내요', ' 입구가 넓어서 \r\n솔이 바닥까지 닿아요'],
      ctx()
    )
    expect(out).toEqual({
      passed: ['손잡이까지 통째로\n물로 헹궈 끝내요', '입구가 넓어서\n솔이 바닥까지 닿아요'],
      rejected: [],
    })
  })

  it('금지 표현은 치환해 통과시키고, 치환어가 없는 표현이 남으면 탈락(banned)', () => {
    const out = guardCopyCandidates(['혁신적인 세척 구조\n물로만 헹궈요', '세척의 모든 것\n한 번에 담았어요'], ctx())
    expect(out.passed).toEqual(['새로운 세척 구조\n물로만 헹궈요'])
    expect(out.rejected).toEqual([{ reason: 'banned', detail: expect.any(String) }])
  })

  it('빈 후보·현재 카피와 같은 후보(공백 무시)·앞 후보와 같은 후보는 탈락', () => {
    const out = guardCopyCandidates(
      ['  ', '매일 쓰는 컵이라 세척이\n쉬워야 해요', '물로 헹궈 끝내요', '물로 헹궈  끝내요'],
      ctx()
    )
    expect(out.passed).toEqual(['물로 헹궈 끝내요'])
    expect(out.rejected.map((r) => r.reason)).toEqual(['empty', 'duplicate', 'duplicate'])
  })

  it('길이 — 줄 수(현재 + 1)·한 줄 글자 수(22 또는 현재 최장 줄)·전체(40 또는 현재 × 1.6)를 넘으면 탈락', () => {
    expect(copyRegenLengthLimits(CURRENT)).toEqual({ lineChars: 22, lines: 3, total: 40 })
    const out = guardCopyCandidates(
      [
        '한 줄\n두 줄\n세 줄\n네 줄',
        '가'.repeat(23),
        '가나다라마바사아자차\n가나다라마바사아자차\n가나다라마바사아자차가나다라마바사아자차',
      ],
      ctx()
    )
    expect(out.passed).toEqual([])
    expect(out.rejected.map((r) => r.reason)).toEqual(['length', 'length', 'length'])
    // 본문 칸 — 현재 줄이 길면 그 길이까지 허용한다
    const long = '가'.repeat(40)
    expect(copyRegenLengthLimits(long)).toEqual({ lineChars: 40, lines: 2, total: 64 })
    expect(guardCopyCandidates(['나'.repeat(40)], ctx({ currentText: long })).passed).toHaveLength(1)
  })

  it('코퍼스 유사도에 걸리면 탈락(similarity), 대상 아닌 카테고리(null)는 검사하지 않는다', () => {
    // 유사도 게이트는 10자 이상 문장만 본다(줄마다 나뉜다)
    const corpus = makeCorpus(['손잡이까지 통째로 물로 헹궈요'])
    const out = guardCopyCandidates(
      ['손잡이까지 통째로 물로 헹궈요', '입구가 넓어서\n솔이 바닥까지 닿아요'],
      ctx({ corpus })
    )
    expect(out.passed).toEqual(['입구가 넓어서\n솔이 바닥까지 닿아요'])
    expect(out.rejected.map((r) => r.reason)).toEqual(['similarity'])
  })

  it('코퍼스를 읽지 못했거나 깨진 코퍼스로 검사가 예외면 모두 탈락(unjudged) — 통과로 보지 않는다', () => {
    const a = guardCopyCandidates(['입구가 넓어서\n솔이 바닥까지 닿아요'], ctx({ corpus: { error: '스키마 오류' } }))
    expect(a.passed).toEqual([])
    expect(a.rejected).toEqual([{ reason: 'unjudged', detail: expect.stringContaining('스키마 오류') }])
    const broken = { schemaVersion: 2 } as unknown as CorpusCheck
    const b = guardCopyCandidates(['입구가 넓어서\n솔이 바닥까지 닿아요'], ctx({ corpus: broken }))
    expect(b.rejected.map((r) => r.reason)).toEqual(['unjudged'])
  })

  it('연령 제한 상품은 어린이 표현이 있으면 탈락(age), 제한 없는 잡은 검사하지 않는다', () => {
    const kid = '아이도 혼자서\n쉽게 헹궈요'
    expect(guardCopyCandidates([kid], ctx({ minAge: 14 })).rejected.map((r) => r.reason)).toEqual(['age'])
    expect(guardCopyCandidates([kid], ctx()).passed).toEqual([kid])
  })

  it('경쟁사 리뷰 문장과 길게 겹치면 탈락(competitor_echo) — 사유에 원문을 싣지 않는다', () => {
    const review = '설거지할 때 손잡이 안쪽까지 솔이 잘 들어가서 좋았어요'
    const echoGuard = buildEchoGuard([review])
    // 재현 가드는 공백·문장 부호를 뺀 15자 조각으로 본다(줄바꿈도 넘는다)
    const out = guardCopyCandidates(
      ['손잡이 안쪽까지 솔이 잘\n들어가서 좋았어요', '입구가 넓어서\n솔이 바닥까지 닿아요'],
      ctx({ echoGuard })
    )
    expect(out.passed).toEqual(['입구가 넓어서\n솔이 바닥까지 닿아요'])
    expect(out.rejected).toHaveLength(1)
    expect(out.rejected[0].reason).toBe('competitor_echo')
    expect(out.rejected[0].detail).not.toContain('손잡이')
  })

  it('한 문장을 짧은 두 줄로 쪼개도 유사도 검사를 비켜 가지 못한다(줄을 이은 글도 본다 — 검수 지적)', () => {
    const corpus = makeCorpus(['손잡이까지 통째로 물로 헹궈요'])
    const out = guardCopyCandidates(
      ['손잡이까지 통째로\n물로 헹궈요', '입구가 넓어서\n솔이 바닥까지 닿아요'],
      ctx({ corpus })
    )
    expect(out.passed).toEqual(['입구가 넓어서\n솔이 바닥까지 닿아요'])
    expect(out.rejected.map((r) => r.reason)).toEqual(['similarity'])
  })

  it('NBSP·폭 없는 글자로 금지 표현을 비켜 가지 못한다 — 일반 공백으로 맞춘 뒤 치환한다(검수 지적)', () => {
    const nbsp = String.fromCharCode(0xa0)
    const zw = String.fromCharCode(0x200b)
    const out = guardCopyCandidates([`게임${nbsp}체인저 같은\n세척 구조`, `혁신${zw}적인 세척\n구조예요`], ctx())
    expect(out).toEqual({ passed: ['효과적인 대안 같은\n세척 구조', '새로운 세척\n구조예요'], rejected: [] })
  })

  it('후보의 꺾쇠는 지우지 않는다(뜻을 바꾸지 않게 — 프롬프트에 다시 들어가지 않는다)', () => {
    expect(guardCopyCandidates(['3kg > 2kg 넉넉한\n용량이에요'], ctx()).passed).toEqual([
      '3kg > 2kg 넉넉한\n용량이에요',
    ])
  })

  it('현재 카피(구분자 글자를 지운 값)와 꺾쇠만 다른 후보는 중복이다(검수 지적)', () => {
    const out = guardCopyCandidates(
      ['용량 3kg > 2kg\n넉넉하게 담아요'],
      ctx({ currentText: '용량 3kg 2kg\n넉넉하게 담아요' })
    )
    expect(out.rejected.map((r) => r.reason)).toEqual(['duplicate'])
  })

  it('소프트 하이픈·CGJ·몽골 모음 구분자·변이 선택자·한글 채움 문자로 금지 표현을 비켜 가지 못한다(검수 지적)', () => {
    const ch = (code: number) => String.fromCharCode(code)
    const out = guardCopyCandidates(
      [
        `혁신${ch(0xad)}적인 세척\n구조예요`,
        `게임${ch(0x180e)}체인저 같은\n세척 구조`,
        `셀${ch(0x34f)}러${ch(0x3164)} 걱정 없이\n쓰는 컵`,
      ],
      ctx()
    )
    expect(out).toEqual({
      passed: ['새로운 세척\n구조예요', '효과적인 대안 같은\n세척 구조', '소비자 걱정 없이\n쓰는 컵'],
      rejected: [],
    })
  })
})

describe('guardCopyCandidates — 사실 값(pdp-copy-facts-r4)', () => {
  const facts: CopyFacts = {
    axes: [
      { kind: 'quantity', name: '수량', values: ['20개', '30개', '50개'] },
      { kind: 'design', name: '디자인', values: ['01', '02', '03', '04', '05', '07'] },
    ],
    variantCount: 13,
    partialCombos: ['30개: 04'],
    validCounts: { quantity: [3, 2], design: [6, 1] },
    optionTerms: ['20개 01', '30개 04', '01', '02', '03', '04', '05', '07', '20개', '30개', '50개'],
  }

  it('옵션 개수 오기는 탈락이 아니라 숫자를 고쳐 통과시킨다(조사 그대로)', () => {
    const out = guardCopyCandidates(['7가지 디자인을\n골라 붙여요', '디자인 7종이\n준비돼 있어요'], ctx({ facts }))
    expect(out).toEqual({ passed: ['6가지 디자인을\n골라 붙여요', '디자인 6종이\n준비돼 있어요'], rejected: [] })
  })

  it('고친 글이 현재 카피와 같으면 중복으로 탈락한다(정정 뒤 비교)', () => {
    const out = guardCopyCandidates(
      ['7가지 디자인을\n골라 붙여요'],
      ctx({ currentText: '6가지 디자인을\n골라 붙여요', facts })
    )
    expect(out.passed).toEqual([])
    expect(out.rejected).toEqual([{ reason: 'duplicate', detail: '현재 카피 또는 앞 후보와 같습니다.' }])
  })

  it('사실 값이 없는 잡은 지금 그대로(숫자를 건드리지 않는다)', () => {
    expect(guardCopyCandidates(['7가지 디자인을\n골라 붙여요'], ctx()).passed).toEqual(['7가지 디자인을\n골라 붙여요'])
  })
})
