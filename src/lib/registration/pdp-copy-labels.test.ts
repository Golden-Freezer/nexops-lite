/**
 * 고정 표기(오너 지시 11-01) — 비교 상대는 '기존 제품', 우리 쪽은 '우리 제품', '이런 고민' 삭제. 값은 모두 합성이다.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PREMIUM_COPYWRITING_PROMPT } from '@/lib/agents/registration/prompts/pdp-copy-prompts'
import { extractContent } from './editor/utils/sectionConverter/content'
import { createSectionElements } from './editor/utils/sectionConverter/sections'
import { ProSectionType } from './editor/types/section'
import type { CopywritingResult } from './editor/types/editor'
import { normalizeCompareItems, withoutWorryPhrase } from './pdp-copy-labels'
import { checkBannedExpressions, sanitizeCopyData } from './pdp-copy-sanitize'

const PALETTE = { primary: '#335CFF', secondary: '#111111', bgMain: '#FFFFFF', bgSub: '#F5F5F5', textMain: '#222222', textHighlight: '#335CFF' }
const OLD_THREE_WAY = [
  { name: 'A사 봉투', pros: '값이 싸요', cons: '금방 찢어져요' },
  { name: 'B사 상자', pros: '단단해요', cons: '무거워요' },
  { name: '본 상품', pros: '가볍고 튼튼해요', cons: '' },
]

describe('normalizeCompareItems', () => {
  it('옛 3자 비교 저장본 — 이름은 코드가 정하고, 단점 칸은 버리고, 마지막 항목이 우리 쪽이다', () => {
    expect(normalizeCompareItems(OLD_THREE_WAY)).toEqual([
      { name: '기존 제품', pros: '값이 싸요' },
      { name: '우리 제품', pros: '가볍고 튼튼해요' },
    ])
  })

  it('모델이 상대 이름을 적어도 이름은 고정이다', () => {
    const items = normalizeCompareItems([
      { name: '타사 제품', pros: '기본 구성' },
      { name: '본 상품', pros: '칸이 나뉘어요' },
    ])
    expect(items.map((item) => item.name)).toEqual(['기존 제품', '우리 제품'])
  })

  it('한쪽이라도 글이 없으면 비교를 그리지 않는다 — 상대 칸에 단점만 있던 저장본 포함', () => {
    expect(normalizeCompareItems([{ name: 'A', pros: '', cons: '금방 찢어져요' }, { name: '본 상품', pros: '튼튼해요' }])).toEqual([])
    expect(normalizeCompareItems([{ name: 'A', pros: '값이 싸요' }, { name: '본 상품', pros: ' ' }])).toEqual([])
    expect(normalizeCompareItems([{ name: '본 상품', pros: '튼튼해요' }])).toEqual([])
    expect(normalizeCompareItems(undefined)).toEqual([])
    expect(normalizeCompareItems(['글', 3])).toEqual([])
  })
})

describe('비교 섹션 그리기 — 저장 카피도 두 칸, 단점 표식 없음', () => {
  const copy = { compareItems: OLD_THREE_WAY, compareSummary: '요약' } as unknown as CopywritingResult
  const content = extractContent(ProSectionType.COMPARE_DIV, copy, {} as never) as Record<string, unknown>
  const texts = createSectionElements(ProSectionType.COMPARE_DIV, content, null, PALETTE)
    .map((element) => element.textProps?.content)
    .filter(Boolean)

  it('이름표는 기존 제품·우리 제품이고 상대 이름·단점이 없다', () => {
    expect(texts).toEqual(expect.arrayContaining(['기존 제품', '★ 우리 제품', '✓ 값이 싸요', '✓ 가볍고 튼튼해요']))
    expect(texts.join(' ')).not.toMatch(/✗|A사|B사|본 상품|찢어져요|무거워요|단단해요/)
  })

  it('비교할 글이 없으면 비교 표를 그리지 않는다', () => {
    const empty = extractContent(ProSectionType.COMPARE_DIV, { compareItems: [] } as unknown as CopywritingResult, {} as never) as Record<string, unknown>
    const names = createSectionElements(ProSectionType.COMPARE_DIV, empty, null, PALETTE).map((element) => element.name)
    expect(names.filter((name) => name.startsWith('cmp_'))).toEqual([])
  })

  it('저장 카피의 고민 질문에서 이런 고민을 뺀다', () => {
    const saved = { problem: { question: '이런 고민 있으신가요?', empathy: '' } } as unknown as CopywritingResult
    expect(extractContent(ProSectionType.PROBLEM_RAISE, saved, {} as never)).toMatchObject({ question: '고민 있으신가요?' })
  })
})

describe('카피 정화 — 비교 상대 표기와 고민 문구', () => {
  const clean = (text: string) => (sanitizeCopyData(text)[0] as string)

  it.each([
    ['일반 제품보다 가벼워요', '기존 제품보다 가벼워요'],
    ['일반제품과 달라요', '기존 제품과 달라요'],
    ['타사 제품 대비 튼튼해요', '기존 제품 대비 튼튼해요'],
    ['타사 대비 튼튼해요', '기존 제품 대비 튼튼해요'],
    ['타사보다 튼튼해요', '기존 제품보다 튼튼해요'],
    ['시중 상품과 달리', '기존 제품과 달리'],
    ['경쟁 제품과 달리', '기존 제품과 달리'],
    ['경쟁사 제품과 달리', '기존 제품과 달리'],
    ['경쟁사와 달리', '기존 제품과 달리'],
    ['경쟁사는 무거워요', '기존 제품은 무거워요'],
    ['타사가 쓰는 소재', '기존 제품이 쓰는 소재'],
    ['이런 고민 있으신가요?', '고민 있으신가요?'],
    ['이런고민 해보셨나요', '고민 해보셨나요'],
  ])('%s → %s', (before, after) => {
    expect(clean(before)).toBe(after)
    expect(checkBannedExpressions(clean(before))).toEqual([])
  })

  it.each(['일반적인 크기예요', '베타사이트에서 봤어요', '기존 제품보다 가벼워요', '우리 제품은 가벼워요', '정리 고민, 끝낼 때예요'])('%s는 그대로다', (text) => {
    expect(clean(text)).toBe(text)
  })

  it('withoutWorryPhrase는 한 문장의 여러 곳을 바꾼다', () => {
    expect(withoutWorryPhrase('이런 고민, 저런 걱정, 이런  고민')).toBe('고민, 저런 걱정, 고민')
  })
})

describe('프롬프트 재료', () => {
  it('카피 스키마가 상대 이름·단점을 쓰게 하지 않는다', () => {
    expect(PREMIUM_COPYWRITING_PROMPT).toContain('{"name": "기존 제품", "pros"')
    expect(PREMIUM_COPYWRITING_PROMPT).toContain('{"name": "우리 제품", "pros"')
    expect(PREMIUM_COPYWRITING_PROMPT).not.toMatch(/3자 비교|대안 A|대안 B|경쟁\/대체재|"cons"/)
  })

  it('corpus 패턴 설명에 타사 비교·이런 고민이 남지 않는다(카피 프롬프트에 들어간다)', () => {
    const dir = join(__dirname, 'corpus')
    const files = [...readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f)), ...readdirSync(join(dir, 'v2')).filter((f) => f.endsWith('.json')).map((f) => join(dir, 'v2', f))]
    expect(files.length).toBeGreaterThanOrEqual(10)
    for (const file of files) expect(readFileSync(file, 'utf8'), file).not.toMatch(/타사 vs 자사|이런 고민/)
  })
})
