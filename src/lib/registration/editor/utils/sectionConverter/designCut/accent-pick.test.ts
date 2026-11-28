/**
 * 모델이 고른 강조 구절 검사(적용 T1-17, 연구 A2 6-1) — 제목 글자 그대로의 부분 문자열, 한 줄 안, 공백 뺀 2~8자, 제목 전체 아님.
 * 어기면 null이고 그리는 쪽이 지금 규칙(accentPhraseOf)으로 돌아간다. D 계획 조회·Stage 3 이어 붙이기도 본다
 */

import { describe, expect, it } from 'vitest'
import { headlineAccentOf, keepStage2Accents } from '@/lib/registration/copy-design-rules'
import { ACCENT_MAX_CHARS, acceptAccent, phraseIn } from './accent'
import { keepFactUnits } from './build'

const TITLE = '아침 준비가 5분 빨라져요'

describe('acceptAccent', () => {
  it.each([
    ['5분 빨라져요', '5분 빨라져요'],
    [' 아침 준비 ', '아침 준비'],
    ['5분', '5분'],
  ])('%s → 받음', (phrase, want) => {
    expect(acceptAccent(TITLE, phrase)).toBe(want)
  })

  it.each([
    ['제목에 없음', '저녁 준비'],
    ['한 글자', '분'],
    ['공백 뺀 9자', '준비가 5분 빨라져요'],
    ['제목 전체', '아침 준비가 5분 빨라져요'],
    ['공백만 다른 제목 전체', '아침준비가 5분빨라져요'],
    ['빈 값', '  '],
    ['줄을 넘음', '준비가\n5분'],
  ])('%s → null', (_why, phrase) => {
    expect(acceptAccent(phrase === '준비가\n5분' ? '아침 준비가\n5분 빨라져요' : TITLE, phrase)).toBeNull()
  })

  it('글이 아니거나 제목이 없으면 null', () => {
    for (const phrase of [undefined, null, 5, ['5분'], { x: 1 }]) expect(acceptAccent(TITLE, phrase)).toBeNull()
    expect(acceptAccent(null, '5분')).toBeNull()
    expect(acceptAccent('', '5분')).toBeNull()
  })

  it('상한은 8자다(공백 제외)', () => {
    expect(ACCENT_MAX_CHARS).toBe(8)
    expect(acceptAccent('가나다라마바사아자 차', '가나다라마바사아')).toBe('가나다라마바사아')
    expect(acceptAccent('가나다라마바사아자 차', '가나다라마바사아자')).toBeNull()
  })
})

describe('phraseIn — 그릴 글(치수 묶기 뒤)에서 찾기', () => {
  it('줄바꿈 없는 공백을 일반 공백과 같게 보고, 그릴 글의 글자 그대로 돌려준다', () => {
    const shown = keepFactUnits('가로 30cm 넉넉한 칸')
    expect(shown).not.toBe('가로 30cm 넉넉한 칸')
    const hit = phraseIn(shown, '가로 30cm')
    expect(hit).not.toBeNull()
    expect(shown.includes(hit!)).toBe(true)
    expect(hit!.replace(/ /g, ' ')).toBe('가로 30cm')
  })

  it('없으면 null', () => {
    expect(phraseIn('넉넉한 칸', '가로')).toBeNull()
    expect(phraseIn('넉넉한 칸', undefined)).toBeNull()
    expect(phraseIn('넉넉한 칸', '')).toBeNull()
  })
})

describe('D 카피 칸', () => {
  it('headlineAccentOf — 키는 공백을 빼고 맞추고, 구절은 제목으로 다시 검사한다', () => {
    expect(headlineAccentOf(TITLE, { '아침  준비가 5분빨라져요': '5분 빨라져요' })).toBe('5분 빨라져요')
    expect(headlineAccentOf(TITLE, { [TITLE]: '저녁' })).toBeNull()
    expect(headlineAccentOf(TITLE, { 다른제목: '5분' })).toBeNull()
    expect(headlineAccentOf(null, { [TITLE]: '5분' })).toBeNull()
    for (const bad of [undefined, null, '5분', ['5분']]) expect(headlineAccentOf(TITLE, bad)).toBeNull()
  })

  it('keepStage2Accents — Stage 3에 칸이 없을 때만 Stage 2 값을 잇는다', () => {
    const s2 = { headlineAccents: { [TITLE]: '5분' } }
    expect(keepStage2Accents({ a: 1 }, s2)).toEqual({ a: 1, headlineAccents: { [TITLE]: '5분' } })
    expect(keepStage2Accents({ headlineAccents: { x: 'y' } }, s2)).toEqual({ headlineAccents: { x: 'y' } })
    expect(keepStage2Accents({ a: 1 }, {})).toEqual({ a: 1 })
    expect(keepStage2Accents({ a: 1 }, { headlineAccents: ['x'] })).toEqual({ a: 1 })
  })
})
