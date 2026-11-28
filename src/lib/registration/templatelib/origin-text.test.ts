/**
 * 원산지는 상품 정보 표에만(하네스 R09b) — K 칸 카피 콜의 사실·장점 후보에서 빼고, 칸 검사가 원산지·제조국을 쓴 칸을 잡는다.
 * 사례: R08 P09 새 배치 잡 4a3c5af1 k8_sub_div(sub_div.digital-text-plate) 제목 '여행 준비 전\n원산지 확인' — 사진 show도 같은 글이었다
 */
import { describe, expect, it } from 'vitest'
import { getPdpTestProduct } from '../__fixtures__/pdp-products'
import { productInfoRows } from '../product-info-rows'
import { buildSlotCopyPrompt } from '@/lib/agents/registration/prompts/pdp-template-copy-prompts'
import { copyInputWithoutOrigin, isOriginFact, mentionsOrigin } from './origin-text'
import { lineFactsOf } from './select-line'
import { factBudget, factsOf } from './selection-facts'
import { checkCopyValues, dropProblemValues, type CopySlot } from './slot-copy'

const P09 = getPdpTestProduct('P09').specSheet

describe('mentionsOrigin — 원산지·제조국을 말하는 글', () => {
  it('원산지 낱말(원산지·원산국·제조국·생산국·Made in)은 원산지 값과 관계없이 잡는다', () => {
    for (const text of ['여행 준비 전\n원산지 확인', '원산국 표시', '제조국 중국', '생산국을 확인하세요', 'Made in Korea', 'MADE IN CHINA']) {
      expect(mentionsOrigin(text, null), text).toBe(true)
    }
  })

  it('원산지 값으로 만든 말(중국산·중국 제조·중국 생산)을 잡고, 값만 홀로 든 글은 잡지 않는다', () => {
    expect(mentionsOrigin('튼튼한 중국산 원단', '중국')).toBe(true)
    expect(mentionsOrigin('중국 제조 공장에서', '중국')).toBe(true)
    expect(mentionsOrigin('중국에서 생산한', '중국')).toBe(true)
    expect(mentionsOrigin('중국 여행에도 가볍게', '중국')).toBe(false)
    expect(mentionsOrigin('가방 고리에 걸어 두면 편해요', '중국')).toBe(false)
  })

  it('국내 원산지면 국산·국내산·국내 생산을 잡는다', () => {
    for (const origin of ['대한민국', '한국', '국내']) {
      expect(mentionsOrigin('믿을 수 있는 국내산', origin), origin).toBe(true)
      expect(mentionsOrigin('국내 생산이라 빠른 배송', origin), origin).toBe(true)
    }
    expect(mentionsOrigin('국산 원단', '중국')).toBe(false)
  })

  it('사실 목록 — 원산지 값 그 자체와 원산지를 말하는 사실을 가른다', () => {
    expect(isOriginFact('중국', '중국')).toBe(true)
    expect(isOriginFact(' 중국 ', '중국')).toBe(true)
    expect(isOriginFact('제조국 중국', '중국')).toBe(true)
    expect(isOriginFact('폴리에스터', '중국')).toBe(false)
    expect(isOriginFact('중국', null)).toBe(false)
  })
})

describe('K 칸 카피 콜 — 원산지를 사실·장점 후보로 넘기지 않는다(P09, 잡 4a3c5af1)', () => {
  it('P09 사실 목록에는 원산지(중국)가 있지만 카피 콜에는 빠진다 — 사실 예산·섹션 구성은 그대로 센다', () => {
    expect(P09.origin).toBe('중국')
    const facts = lineFactsOf({ spec: P09 }).map((fact) => fact.text)
    expect(facts).toContain('중국')
    const out = copyInputWithoutOrigin({ facts, usps: ['펼치면 37.3cm', '가볍게 접혀요', '중국산 튼튼한 원단'] }, P09.origin)
    expect(out.facts).toEqual(facts.filter((fact) => fact !== '중국'))
    expect(out.usps).toEqual(['펼치면 37.3cm', '가볍게 접혀요'])
    // 예산은 factsOf 그대로(구성·섹션 수가 바뀌지 않는다)
    expect(factBudget(factsOf(P09))).toEqual(factBudget(lineFactsOf({ spec: P09 })))
  })

  it('카피 프롬프트 — 실을 수 있는 사실·장점 후보에 원산지가 없다', () => {
    const facts = lineFactsOf({ spec: P09 }).map((fact) => fact.text)
    const out = copyInputWithoutOrigin({ facts, usps: ['중국산 원단'] }, P09.origin)
    const prompt = buildSlotCopyPrompt({
      product: { category: '여행용품', persona: null, summary: '', keywords: [], usps: out.usps, pains: [] },
      guideline: { tone: '', persona: '' } as never,
      facts: out.facts,
      sections: [],
    })
    expect(prompt).not.toMatch(/원산지|중국/)
  })

  it('맨 아래 상품 정보 표에는 원산지가 그대로 있다', () => {
    expect(productInfoRows(P09)).toContainEqual(expect.objectContaining({ label: '원산지', value: '중국' }))
  })
})

describe('칸 검사 — 원산지를 쓴 칸은 고치기를 청하고, 남으면 지운다', () => {
  const slots: CopySlot[] = [
    { name: 'title', required: true, maxChars: 20, facts: 1 },
    { name: 'sub', required: false, maxChars: 40, facts: 0 },
  ]

  it('잡 4a3c5af1 제목 그대로 — origin 문제(고치기 청함·남으면 지움)', () => {
    const values = { title: '여행 준비 전\n원산지 확인', sub: '가방 고리에 걸어 두면 편해요' }
    const problems = checkCopyValues(slots, values, P09)
    expect(problems).toContainEqual({ slot: 'title', kind: 'origin', detail: '여행 준비 전\n원산지 확인' })
    expect(problems.some((p) => p.slot === 'sub' && p.kind === 'origin')).toBe(false)
    expect(dropProblemValues(values, problems)).toEqual({ sub: '가방 고리에 걸어 두면 편해요' })
  })

  it('목록 칸 항목도 잡는다 — 잡 80962f2d(P07 새 배치) k10_hidden_page 항목 "제조국 중국"', () => {
    const list: CopySlot[] = [{ name: 'items', required: true, facts: 2, list: { min: 1, max: 4, fields: [{ name: 'item', required: true, maxChars: 20, facts: 1 }] } }]
    const values = { items: [{ item: '프레임 소재 ABS' }, { item: '제조국 중국' }] }
    const problems = checkCopyValues(list, values, getPdpTestProduct('P07').specSheet).filter((p) => p.kind === 'origin')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ slot: 'items.item', detail: '제조국 중국' })
    // 고치기 콜이 먼저다. 고친 뒤에도 남으면 목록 칸은 지금 규칙(규제 표현·숫자와 같다)대로 그 항목 칸을 모두 지운다
    expect(dropProblemValues(values, problems)).toEqual({})
  })

  it('고치기 콜에 까닭이 실린다(이 문제가 있을 때만 — 보통 콜의 글은 그대로)', () => {
    const fixes = new Map([[0, [{ slot: 'title', kind: 'origin' as const, detail: '원산지 확인' }]]])
    const base = { product: { category: '', persona: null, summary: '', keywords: [], usps: [], pains: [] }, guideline: { tone: '', persona: '' } as never, facts: [], sections: [] }
    expect(buildSlotCopyPrompt(base, fixes)).toContain('[0] title: 원산지·제조국 — 상품 정보 표에만 싣는 정보다')
    expect(buildSlotCopyPrompt(base)).not.toContain('원산지')
  })
})
