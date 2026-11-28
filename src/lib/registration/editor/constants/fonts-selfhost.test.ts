// 글꼴 목록(fonts.ts)과 자체 보관본(public/fonts/pdp — scripts/fonts/build-pdp-fonts.py가 만든다)이 서로 맞는지.
// 선택지·예전 글꼴·대체 체인 둘째 칸('Pretendard Variable')이 모두 fonts.css에 있고, 그 파일·라이선스 사본이 실제로 있어야 한다.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FONT_OPTIONS, LEGACY_FONTS, PDP_FONT_CSS_PATH, PDP_FONT_CSS_URL } from './fonts'

const DIR = resolve(__dirname, '../../../../../public/fonts/pdp')
const css = readFileSync(resolve(DIR, 'fonts.css'), 'utf8')
const notice = readFileSync(resolve(DIR, 'NOTICE.md'), 'utf8')

interface Face {
  family: string
  file: string
  weight: [number, number]
}

const faces: Face[] = [...css.matchAll(/@font-face\{([^}]*)\}/g)].map(([, body]) => {
  const family = /font-family:'([^']+)'/.exec(body)![1]
  const file = /url\('\.\/([^']+)'\)/.exec(body)![1]
  const [lo, hi = lo] = /font-weight:([\d ]+);/.exec(body)![1].trim().split(/\s+/).map(Number)
  return { family, file, weight: [lo, hi] }
})

const covers = (family: string, weight: number) =>
  faces.some((f) => f.family === family && f.weight[0] <= weight && weight <= f.weight[1])

describe('자체 보관 글꼴(pdp-font-selfhost)', () => {
  it('스타일시트 경로 — 편집기는 같은 출처, 단독 HTML은 운영 출처 절대 주소', () => {
    expect(PDP_FONT_CSS_PATH).toBe('/fonts/pdp/fonts.css')
    expect(PDP_FONT_CSS_URL).toBe('https://nexops-one.vercel.app/fonts/pdp/fonts.css')
  })

  it('선택지·예전 글꼴의 (패밀리, 굵기)마다 fonts.css에 맞는 @font-face가 있다', () => {
    const missing = [...FONT_OPTIONS, ...LEGACY_FONTS].filter((f) => !covers(f.fontFamily, f.fontWeight)).map((f) => f.label)
    expect(missing).toEqual([])
  })

  it('Pretendard는 정적 9굵기(생성기·편집기가 600·800도 쓴다), 대체 체인 둘째 칸 Pretendard Variable도 보관한다', () => {
    const pretendard = faces.filter((f) => f.family === 'Pretendard').map((f) => f.weight[0])
    expect(pretendard.sort((a, b) => a - b)).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900])
    expect(covers('Pretendard Variable', 400)).toBe(true)
    expect(covers('Pretendard Variable', 700)).toBe(true)
  })

  it('루트 layout이 이 스타일시트를 같은 출처 경로로 싣는다(앱 전체·편집기·미리보기)', () => {
    const layout = readFileSync(resolve(__dirname, '../../../../app/layout.tsx'), 'utf8')
    expect(layout).toContain(`href="${PDP_FONT_CSS_PATH}"`)
  })

  it('라이선스 원문을 확인한 글꼴만 선택지에 있다 — 예전 글꼴은 확인 못 함이고 보관한 다른 글꼴로 그린다', () => {
    expect(FONT_OPTIONS.filter((f) => f.license !== 'OFL').map((f) => f.label)).toEqual([])
    expect(LEGACY_FONTS.map((f) => [f.fontFamily, f.license])).toEqual([['Cafe24 Ssurround', '확인 못 함']])
    const cafe24 = faces.find((f) => f.family === 'Cafe24 Ssurround')!
    expect(cafe24.file).toBe(faces.find((f) => f.family === 'Jua')!.file)
    expect(readdirSync(DIR).some((n) => /cafe24/i.test(n))).toBe(false)
  })

  it('fonts.css가 가리키는 파일이 모두 있고, 폴더의 woff2는 모두 fonts.css·NOTICE에 있다', () => {
    const referenced = new Set(faces.map((f) => f.file))
    expect([...referenced].filter((file) => !existsSync(resolve(DIR, file)))).toEqual([])
    const stored = readdirSync(DIR).filter((n) => n.endsWith('.woff2'))
    expect(stored.filter((n) => !referenced.has(n))).toEqual([])
    expect(stored.filter((n) => !notice.includes(`| ${n} |`))).toEqual([])
  })

  it('NOTICE의 라이선스 사본이 licenses/에 모두 있다', () => {
    const copies = [...notice.matchAll(/^- (\S+-OFL\.txt):/gm)].map((m) => m[1])
    expect(copies.length).toBeGreaterThanOrEqual(22)
    expect(copies.filter((n) => !existsSync(resolve(DIR, 'licenses', n)))).toEqual([])
    for (const n of copies) expect(readFileSync(resolve(DIR, 'licenses', n), 'utf8')).toContain('SIL Open Font License')
  })
})
