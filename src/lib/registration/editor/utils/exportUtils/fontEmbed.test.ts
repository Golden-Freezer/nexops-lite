import { describe, expect, it } from 'vitest'
import {
  familyNames,
  fontUrls,
  parseUnicodeRange,
  rangesHit,
  replaceFontUrls,
  selectFontFaces,
  type FontFaceLike,
} from './fontEmbed'

const cps = (text: string) => new Set([...text].map((ch) => ch.codePointAt(0)!))

describe('parseUnicodeRange', () => {
  it('단일·범위·와일드카드', () => {
    expect(parseUnicodeRange('U+0041')).toEqual([[0x41, 0x41]])
    expect(parseUnicodeRange('U+AC00-D7A3, U+0020')).toEqual([
      [0xac00, 0xd7a3],
      [0x20, 0x20],
    ])
    expect(parseUnicodeRange('U+4??')).toEqual([[0x400, 0x4ff]])
  })

  it('없거나 읽을 수 없으면 null(전 범위)', () => {
    expect(parseUnicodeRange(null)).toBeNull()
    expect(parseUnicodeRange('  ')).toBeNull()
    expect(parseUnicodeRange('bogus')).toBeNull()
  })

  it('읽을 수 없는 조각만 건너뛴다', () => {
    expect(parseUnicodeRange('bogus, u+0030-0039')).toEqual([[0x30, 0x39]])
  })

  it('Chrome 직렬화 형식(U+0-FF)과 거꾸로 된 범위', () => {
    expect(parseUnicodeRange('U+0-FF, U+1F600-1F64F')).toEqual([
      [0, 0xff],
      [0x1f600, 0x1f64f],
    ])
    expect(parseUnicodeRange('U+00FF-0000')).toBeNull()
  })
})

describe('rangesHit', () => {
  it('범위 없음(null)은 항상 맞음', () => {
    expect(rangesHit(null, cps('a'))).toBe(true)
    expect(rangesHit(null, new Set())).toBe(true)
  })

  it('쓰인 글자가 하나라도 범위 안이면 맞음', () => {
    expect(rangesHit([[0xac00, 0xd7a3]], cps('abc가'))).toBe(true)
    expect(rangesHit([[0xac00, 0xd7a3]], cps('abc'))).toBe(false)
    expect(rangesHit([[0xac00, 0xd7a3]], new Set())).toBe(false)
  })
})

describe('familyNames', () => {
  it('따옴표 제거·소문자·빈 값 제외', () => {
    expect(familyNames(`"Noto Sans KR", 'Pretendard', sans-serif`)).toEqual([
      'noto sans kr',
      'pretendard',
      'sans-serif',
    ])
    expect(familyNames('')).toEqual([])
    expect(familyNames(undefined)).toEqual([])
  })
})

describe('selectFontFaces', () => {
  const face = (family: string, unicodeRange: string | null): FontFaceLike => ({
    family,
    unicodeRange,
    cssText: `@font-face { font-family: ${family}; }`,
    baseUrl: null,
  })
  const faces = [
    face('"Noto Sans KR"', 'U+AC00-D7A3'),
    face('"Noto Sans KR"', 'U+0000-00FF'),
    face('"Noto Sans KR"', 'U+4E00-9FFF'),
    face('"Black Han Sans"', 'U+AC00-D7A3'),
    face('Pretendard', null),
  ]

  it('쓰인 글꼴 이름 + 쓰인 글자가 든 subset만 고른다', () => {
    const picked = selectFontFaces(faces, { families: new Set(['noto sans kr']), codePoints: cps('가A') })
    expect(picked.map((f) => f.unicodeRange)).toEqual(['U+AC00-D7A3', 'U+0000-00FF'])
  })

  it('안 쓰인 글꼴(편집기 글꼴 선택 목록)은 버린다', () => {
    const picked = selectFontFaces(faces, { families: new Set(['noto sans kr']), codePoints: cps('가') })
    expect(picked.some((f) => f.family.includes('Black Han Sans'))).toBe(false)
  })

  it('unicode-range 없는 글꼴은 이름만 맞으면 고른다', () => {
    const picked = selectFontFaces(faces, { families: new Set(['pretendard']), codePoints: cps('x') })
    expect(picked.map((f) => f.family)).toEqual(['Pretendard'])
  })

  it('쓰인 글자가 없으면 범위 있는 subset은 고르지 않는다', () => {
    expect(selectFontFaces(faces, { families: new Set(['noto sans kr']), codePoints: new Set() })).toEqual([])
  })
})

describe('fontUrls·replaceFontUrls', () => {
  const css = `@font-face { font-family: X; src: url("f/a.woff") format("woff"), url(f/a.woff2) format("woff2"), url('data:font/woff2;base64,AA'); }`

  it('url 값(data: 제외·중복 제거)', () => {
    expect(fontUrls(css)).toEqual(['f/a.woff', 'f/a.woff2'])
    expect(fontUrls(`src: url(a.woff2), url( a.woff2 )`)).toEqual(['a.woff2'])
  })

  it('url 토큰 단위로 바꾼다 — 짧은 url이 긴 url을 깨뜨리지 않는다', () => {
    const out = replaceFontUrls(
      css,
      new Map([
        ['f/a.woff', 'data:ONE'],
        ['f/a.woff2', 'data:TWO'],
      ])
    )
    expect(out).toContain('url("data:ONE") format("woff")')
    expect(out).toContain('url(data:TWO) format("woff2")')
    expect(out).toContain(`url('data:font/woff2;base64,AA')`)
  })

  it('바꿀 값이 없는 url은 그대로 둔다', () => {
    expect(replaceFontUrls(css, new Map([['f/a.woff2', 'data:TWO']]))).toContain('url("f/a.woff") format("woff")')
    expect(replaceFontUrls(css, new Map())).toBe(css)
  })
})
