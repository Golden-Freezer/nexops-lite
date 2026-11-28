/**
 * K 라인 사실 예산·근거 — 사실 세기, 예산, 카피 사실 수, 근거 이름. LLM·DB 없음.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EVIDENCE_NAMES, LOCK_EVIDENCE, availableEvidence } from '../../../../scripts/pdp-eval/stage-h0-core.mjs'
import type { PdpSpecSheet } from '../pdp-state'
import { tpl } from './selection.fixture'
import { FACT_MAX_PLACES, SECTION_EVIDENCE, copyFactRange, evidenceOf, factBudget, factOveruse, factsOf } from './selection-facts'
import { EVIDENCE_LOCKED } from './template-meta'

const facts = (narrative: number, table = 0) => [
  ...Array.from({ length: table }, (_, i) => ({ text: `표${i}`, inTable: true })),
  ...Array.from({ length: narrative }, (_, i) => ({ text: `글${i}`, inTable: false })),
]
const spec = (over: Record<string, unknown>) => over as unknown as PdpSpecSheet
const fixture = (p: string) => JSON.parse(readFileSync(join(process.cwd(), `src/lib/registration/__fixtures__/pdp-products/${p}.json`), 'utf8')).specSheet

describe('사실 세기', () => {
  it('시험 상품의 사실 수 — 규제 표현이 든 값은 세지 않는다(P07 급체 방지)', () => {
    expect(['P08', 'P11', 'P01', 'P09', 'P03', 'P02', 'P07'].map((p) => factsOf(fixture(p)).length)).toEqual([5, 5, 6, 8, 8, 10, 9])
  })

  it('표 7행에 드는 사실을 가른다 — 소재·사이즈·원산지·옵션. 빈 값과 값 없는 행은 세지 않는다. 고정 값인 사용연령은 이야기 칸을 쓰지 않아 세지 않는다', () => {
    const value = spec({
      material: '도자기',
      size: '10cm',
      origin: '중국',
      weight: ' ',
      keyFeatures: ['가벼워요', ''],
      extraSpecs: [{ key: '용량', value: '' }, { key: '구성', value: '2개' }],
      colorOptions: ['흰색', '검정'],
      minAgeYears: 3,
    })
    expect(factsOf(value)).toEqual([
      { text: '도자기', inTable: true },
      { text: '10cm', inTable: true },
      { text: '중국', inTable: true },
      { text: '가벼워요', inTable: false },
      { text: '구성 2개', inTable: false },
      { text: '옵션', inTable: true },
    ])
    expect(factsOf(spec({ optionSpec: { axes: [], variants: [] } }))).toEqual([{ text: '옵션', inTable: true }])
    expect(factsOf(spec({}))).toEqual([])
  })

  it('장점 후보(uspfacts 잡)는 표 밖 사실로 뒤에 붙는다 — 규제 표현·빈 값·이미 있는 사실과 같은 글은 세지 않는다', () => {
    const value = spec({ material: '도자기', keyFeatures: ['가벼워요'] })
    expect(factsOf(value, [' 손에 잘 맞아요 ', '가 벼워요', '', 7, '아토피 개선'])).toEqual([
      { text: '도자기', inTable: true },
      { text: '가벼워요', inTable: false },
      { text: '손에 잘 맞아요', inTable: false },
    ])
    expect(factsOf(value)).toEqual(factsOf(value, []))
  })
})

describe('사실 예산', () => {
  it('표에 드는 사실은 한 곳, 나머지는 두 곳 — 목표 섹션은 20~22(긴 페이지가 먼저)', () => {
    expect(factBudget(facts(1, 3))).toEqual({ places: 5, targetSections: 20 })
    expect(factBudget(facts(5, 4))).toEqual({ places: 14, targetSections: 20 })
    expect(factBudget(facts(0, 10)).places).toBe(10)
    expect(factBudget(facts(0)).targetSections).toBe(20)
    expect(factBudget(facts(8)).targetSections).toBe(22)
    expect(factBudget(facts(20)).targetSections).toBe(22)
  })

  it('한 사실이 2곳을 넘으면 알려 준다 — 공백·대소문자는 무시하고, 짧은 값은 잡지 않는다', () => {
    const texts = ['소재는 도자 기예요', '도자기 그릇', 'DOGI 도자기', '다른 말']
    expect(factOveruse(['도자기', '다른 말', '기'], texts)).toEqual([{ fact: '도자기', places: 3 }])
    expect(factOveruse(['도자기'], texts.slice(0, 2))).toEqual([])
    expect(FACT_MAX_PLACES).toBe(2)
  })
})

describe('카피 사실 수', () => {
  it('입력값 슬롯은 빼고 카피 슬롯만 센다 — 필수는 min, 전부는 max', () => {
    const slots = tpl('a.b', {
      slots: {
        head: { type: 'text', required: true, source: 'copy', facts: 1 },
        sub: { type: 'text', required: false, source: 'copy', facts: 1 },
        rating: { type: 'text', required: true, source: 'input', facts: 1 },
        photo: { type: 'image', required: true, purpose: ['scene'], composition: ['front'] },
      },
    })
    expect(copyFactRange(slots)).toEqual({ min: 1, max: 2 })
  })

  it('목록은 min개 × 필수 칸, max개 × 전체 칸 — 필수가 아닌 목록은 min에 들지 않는다', () => {
    const field = (required: boolean, facts: number) => ({ type: 'text' as const, required, source: 'copy' as const, facts })
    const list = tpl('a.b', {
      slots: {
        must: { type: 'list', required: true, min: 2, max: 4, fields: { t: field(true, 1), u: field(false, 1), n: field(true, 0) } },
        opt: { type: 'list', required: false, min: 1, max: 3, fields: { t: field(true, 1) } },
      },
    })
    expect(copyFactRange(list)).toEqual({ min: 2, max: 4 * 2 + 3 })
  })

  it('상품 정보 표·후기처럼 코드가 채우는 목록은 예산을 쓰지 않는다', () => {
    const rows = tpl('spec_table.a', {
      slots: {
        rows: {
          type: 'list',
          required: true,
          source: 'input',
          min: 1,
          max: 7,
          fields: { label: { type: 'text', required: true, source: 'input', facts: 0 }, value: { type: 'text', required: true, source: 'input', facts: 1 } },
        },
      },
    })
    expect(copyFactRange(rows)).toEqual({ min: 0, max: 0 })
    const partly = tpl('a.b', {
      slots: { items: { type: 'list', required: true, min: 1, max: 2, fields: { fixed: { type: 'text', required: true, source: 'input', facts: 1 } } } },
    })
    expect(copyFactRange(partly)).toEqual({ min: 0, max: 0 })
    const inputList = tpl('a.b', {
      slots: { items: { type: 'list', required: true, source: 'input', min: 1, max: 2, fields: { note: { type: 'text', required: true, source: 'copy', facts: 1 } } } },
    })
    expect(copyFactRange(inputList)).toEqual({ min: 0, max: 0 })
  })
})

describe('근거', () => {
  const option = (axes: unknown[], variants: unknown[]) => ({ source: 'manual', axes, variants })

  it('잠금 섹션마다 요구 자료가 있고 하네스 H0와 같다', () => {
    expect(Object.keys(SECTION_EVIDENCE).sort()).toEqual([...EVIDENCE_LOCKED].sort())
    for (const section of EVIDENCE_LOCKED) {
      const lock = (LOCK_EVIDENCE as Record<string, string>)[section] ?? section
      expect(SECTION_EVIDENCE[section], section).toBe(lock)
      expect(EVIDENCE_NAMES as readonly string[]).toContain(lock)
    }
  })

  it('시험 11상품에서 하네스 H0와 같은 근거를 낸다', () => {
    for (const p of ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11']) {
      const value = fixture(p)
      expect([...evidenceOf(value)].sort(), p).toEqual([...availableEvidence(value)].sort())
    }
  })

  it('쓰는 법 근거는 사용 낱말·사용 장소·쓰는 법 칸이 있을 때만 서고 하네스 H0와 같다', () => {
    const words = ['조립하면', '세척하기만', '돌리면', '붙이는', '끼워서', '여며', '밀봉하면', '충전해서', '사용법', '사용 방법', '간편 사용', '원터치', '당기기만', '눌러서', '뿌리는', '바르면', '발라', '씌우고', '걸어두는']
    const keys = ['용도', '사용법', '사용 방법', '사용 부위', '착용']
    const open = [
      ...words.map((word) => spec({ keyFeatures: [`끈을 ${word} 끝`] })),
      spec({ keyFeatures: ['바르면 흡수가 빨라요'] }),
      spec({ keyFeatures: ['눌러서 열면 끝'] }),
      ...keys.map((key) => spec({ extraSpecs: [{ key, value: '값' }] })),
      spec({ usageLocation: '여행지' }),
    ]
    for (const value of open) {
      expect(evidenceOf(value).has('usage'), JSON.stringify(value)).toBe(true)
      expect(availableEvidence(value).has('usage'), JSON.stringify(value)).toBe(true)
    }
    const shut = [
      spec({ material: 'EVA' }),
      spec({ keyFeatures: ['가벼워요'] }),
      spec({ usageLocation: ' ' }),
      spec({ extraSpecs: [{ key: '사용 부위', value: ' ' }] }),
      spec({ extraSpecs: [{ key: '소재', value: '당기는 끈' }] }),
      // D 공용 조각 규칙이 걸던 오탐(통합 11-03 07:0x) — K는 끝맺음·사용 동작 낱말까지 본다
      spec({ keyFeatures: ['바르게 세워지는 구조'] }),
      spec({ keyFeatures: ['바르셀로나 디자인'] }),
      spec({ keyFeatures: ['편하면서도 튼튼한'] }),
      spec({ keyFeatures: ['부담 없이 하면 좋은'] }),
      spec({ keyFeatures: ['바른 자세를 돕는 높이'] }),
      spec({ keyFeatures: ['뿌리 깊은 원목'] }),
    ]
    for (const value of shut) {
      expect(evidenceOf(value).has('usage'), JSON.stringify(value)).toBe(false)
      expect(availableEvidence(value).has('usage'), JSON.stringify(value)).toBe(false)
    }
  })

  it('시험 11상품에서 쓰는 법 근거는 P01·P09·P10만 선다 — K1의 P07·P11은 how_to가 열리지 않는다', () => {
    const list = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11']
    expect(list.filter((p) => evidenceOf(fixture(p)).has('usage'))).toEqual(['P01', 'P09', 'P10'])
  })

  it('아무것도 없으면 근거가 없다', () => {
    expect([...evidenceOf(spec({}))]).toEqual([])
  })

  it('후기 인용·평점·인증·이벤트 — 규격 이름으로 낸다', () => {
    expect(evidenceOf(spec({ reviewQuotes: [{ text: 'x' }] })).has('review')).toBe(true)
    expect(evidenceOf(spec({ reviewQuotes: [] })).has('review')).toBe(false)
    expect(evidenceOf(spec({ rating: 4.5, reviewCount: 3 })).has('rating')).toBe(true)
    expect(evidenceOf(spec({ rating: 4.5 })).has('rating')).toBe(false)
    expect(evidenceOf(spec({ reviewCount: 3 })).has('rating')).toBe(false)
    expect(evidenceOf(spec({ reviewFiles: { own: { stats: { rating_counts: { 5: 2, 4: 0 } } } } })).has('rating')).toBe(true)
    expect(evidenceOf(spec({ reviewFiles: { own: { stats: { rating_counts: { 5: 0 } } } } })).has('rating')).toBe(false)
    expect(evidenceOf(spec({ soldOutCount: 100 })).has('rating')).toBe(false)
    expect(evidenceOf(spec({ certificationInfo: 'KC' })).has('certification')).toBe(true)
    expect(evidenceOf(spec({ certificationInfo: ' ' })).has('certification')).toBe(false)
    expect(evidenceOf(spec({ eventBannerInfo: '증정' })).has('offer')).toBe(true)
    expect(evidenceOf(spec({ eventBannerInfo: ' ' })).has('offer')).toBe(false)
  })

  it('FAQ — 자사 리뷰가 있거나 답할 사실 칸이 둘 이상(H0와 같은 칸)', () => {
    expect(evidenceOf(spec({ brandName: 'A', minAgeYears: 3 })).has('faq')).toBe(true)
    expect(evidenceOf(spec({ material: ' ', origin: '한국' })).has('faq')).toBe(false)
    expect(evidenceOf(spec({ keyFeatures: [], origin: '한국' })).has('faq')).toBe(false)
    expect(evidenceOf(spec({ reviewsText: '좋아요' })).has('faq')).toBe(true)
    expect(evidenceOf(spec({ reviewFiles: { own: { sampled: 3 } } })).has('faq')).toBe(true)
    expect(evidenceOf(spec({ reviewFiles: { own: { sampled: 0 } } })).has('faq')).toBe(false)
    expect(evidenceOf(spec({ material: '면' })).has('faq')).toBe(false)
    expect(evidenceOf(spec({ material: '면', origin: '한국' })).has('faq')).toBe(true)
  })

  it('사이즈·옵션·수량 — 옵션 구조의 축과 공통 수량을 본다', () => {
    const axis = (kind: string) => ({ kind, name: kind, values: ['1'] })
    expect(evidenceOf(spec({ size: '10cm' })).has('size')).toBe(true)
    expect(evidenceOf(spec({ optionSpec: option([axis('size')], []) })).has('size')).toBe(true)
    expect(evidenceOf(spec({ optionSpec: option([axis('color')], []) })).has('size')).toBe(false)
    expect(evidenceOf(spec({ colorOptions: ['흰색'] })).has('option')).toBe(true)
    expect(evidenceOf(spec({ optionSpec: option([axis('color')], []) })).has('option')).toBe(true)
    expect(evidenceOf(spec({ optionSpec: option([axis('quantity')], []) })).has('quantity')).toBe(true)
    const same = [{ label: 'a', values: { quantity: '10개' } }, { label: 'b', values: { quantity: '10개' } }]
    expect(evidenceOf(spec({ optionSpec: option([], same) })).has('quantity')).toBe(true)
    const mixed = [{ label: 'a', values: { quantity: '10개' } }, { label: 'b', values: { quantity: '20개' } }]
    expect(evidenceOf(spec({ optionSpec: option([], mixed) })).has('quantity')).toBe(false)
    expect(evidenceOf(spec({ optionSpec: option([], [{ label: 'a', values: {} }]) })).has('quantity')).toBe(false)
    expect(evidenceOf(spec({ optionSpec: option([], []) })).has('quantity')).toBe(false)
  })

  it('옵션 구조가 아닌 값은 옵션으로 치지 않는다', () => {
    expect(evidenceOf(spec({ optionSpec: { nope: true } })).has('option')).toBe(false)
  })
})
