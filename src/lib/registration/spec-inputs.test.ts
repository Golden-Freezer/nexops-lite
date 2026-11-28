/**
 * W2a 입력 배선(PDP-W2W3 계약 v1) — 새 spec 필드 정리(normalizeSpecInputs), 등록 초안 프리필(draftToSpecPrefill),
 * 프롬프트 스펙 JSON 제외 키(인용 카드·초안 표시는 빼고 무게·원산지·추가 스펙은 넣는다, 없으면 바이트 그대로).
 */

import { describe, expect, it } from 'vitest'
import { specSheetPromptJson, type PdpSpecSheet } from './pdp-state'
import { buildSpecSheetJson } from '@/lib/agents/registration/pdp-copy-defaults'
import { draftToSpecPrefill, normalizeSpecInputs, type DraftPrefillSource } from './spec-inputs'

const base = (over: Record<string, unknown> = {}) => ({ productName: '세척 쉬운 컵', ...over }) as PdpSpecSheet

describe('normalizeSpecInputs', () => {
  it('새 필드가 없으면 같은 객체(저장 바이트 불변)', () => {
    const spec = base({ material: '스테인리스' })
    expect(normalizeSpecInputs(spec)).toBe(spec)
  })

  it('무게·원산지는 한 줄로 40자까지, 비면 키를 지운다', () => {
    const out = normalizeSpecInputs(base({ weight: '  120g \n', origin: '중'.repeat(50), extraSpecs: [] }))
    expect(out.weight).toBe('120g')
    expect(out.origin).toHaveLength(40)
    expect(out).not.toHaveProperty('extraSpecs')
    expect(normalizeSpecInputs(base({ weight: '   ' }))).not.toHaveProperty('weight')
  })

  it('직접 API 입력의 이모지가 상한(40) 가운데에 걸리면 그 이모지를 통째로 뺀다 — 깨진 글자 없이 저장', () => {
    const out = normalizeSpecInputs(base({ origin: `${'가'.repeat(39)}😀`, weight: `${'나'.repeat(38)}😀` }))
    expect(out.origin).toBe('가'.repeat(39))
    expect(out.weight).toBe(`${'나'.repeat(38)}😀`)
    // 이모지 반쪽짜리 강조 조각은 글 안 이모지 반쪽과 맞아도 받지 않는다
    const quotes = normalizeSpecInputs(
      base({ reviewQuotes: [{ id: 'q1', text: '좋아요😀', rating: 5, highlights: ['\uD83D', '좋아요'] }] })
    ).reviewQuotes!
    expect(quotes[0].highlights).toEqual(['좋아요'])
  })

  it('인용 카드의 작성 월은 YYYY.MM만, 작성자는 가린 꼴(한 글자 + *)만 남긴다 — 원래 이름은 저장되지 않는다(P1-6)', () => {
    const quotes = normalizeSpecInputs(
      base({
        reviewQuotes: [
          { id: 'a', text: '좋아요', rating: 5, month: '2026.10', author: '김**' },
          { id: 'b', text: '편해요', rating: 4, month: '10월', author: '김철수' },
          { id: 'c', text: '예뻐요', rating: 5, author: '*희' },
          { id: 'd', text: '좋아요', rating: 5, month: '2026.13' },
        ],
      })
    ).reviewQuotes!
    expect(quotes[0]).toMatchObject({ month: '2026.10', author: '김**' })
    expect(quotes[1]).not.toHaveProperty('month')
    expect(quotes[1]).not.toHaveProperty('author')
    expect(quotes[2]).not.toHaveProperty('author')
    expect(quotes[3]).not.toHaveProperty('month')
  })

  it('추가 스펙: 빈 행을 지우고, key가 겹치면 마지막 값(마지막 자리), key 20자·value 60자·12행까지', () => {
    const rows = [
      { key: '두께', value: '2mm' },
      { key: '', value: '빈 키' },
      { key: '용량', value: ' ' },
      { key: '두께', value: '3mm' },
      ...Array.from({ length: 15 }, (_, i) => ({ key: `항목${i}`, value: '값' })),
      { key: '키'.repeat(30), value: '값'.repeat(80) },
    ]
    const out = normalizeSpecInputs(base({ extraSpecs: rows })).extraSpecs!
    expect(out).toHaveLength(12)
    expect(out[0]).toEqual({ key: '두께', value: '3mm' })
    expect(out[11]).toEqual({ key: '항목10', value: '값' })
    const short = normalizeSpecInputs(base({ extraSpecs: rows.slice(0, 4) })).extraSpecs!
    expect(short).toEqual([{ key: '두께', value: '3mm' }])
    // 겹친 key는 마지막 값이 마지막 자리로 간다
    const moved = normalizeSpecInputs(
      base({
        extraSpecs: [
          { key: 'a', value: '1' },
          { key: 'b', value: '2' },
          { key: 'a', value: '3' },
        ],
      })
    ).extraSpecs
    expect(moved).toEqual([
      { key: 'b', value: '2' },
      { key: 'a', value: '3' },
    ])
    expect(normalizeSpecInputs(base({ extraSpecs: rows.slice(-1) })).extraSpecs![0]).toEqual({
      key: '키'.repeat(20),
      value: '값'.repeat(60),
    })
  })

  it('인용 카드: 6장·150자·평점 1~5 정수, 강조는 글 안의 12자 이하 조각 3개까지, id가 겹치면 앞 카드만', () => {
    const quote = (i: number, over: Record<string, unknown> = {}) => ({
      id: `q${i}`,
      text: '세척이 정말 쉬워요. 손잡이도 튼튼합니다.',
      rating: 5,
      ...over,
    })
    const out = normalizeSpecInputs(
      base({
        reviewQuotes: [
          // 글 안에 있어도 12자를 넘는 조각('세척이 정말 쉬워요. 손잡이도', 16자)은 강조가 아니다
          quote(1, { highlights: ['세척이 정말 쉬워요', '튼튼', '없는 말', '세척이 정말 쉬워요. 손잡이도', '튼튼'] }),
          quote(1, { text: '겹친 id' }),
          quote(2, { rating: 4.6, option: ' 화이트 ' }),
          quote(3, { rating: 0 }),
          quote(4, { text: '' }),
          quote(5, { text: '가'.repeat(200) }),
          quote(6),
          quote(7),
          quote(8),
          quote(9),
        ],
      })
    ).reviewQuotes!
    expect(out.map((q) => q.id)).toEqual(['q1', 'q2', 'q5', 'q6', 'q7', 'q8'])
    expect(out[0].highlights).toEqual(['세척이 정말 쉬워요', '튼튼'])
    expect(out[1]).toMatchObject({ rating: 5, option: '화이트' })
    expect(out[1]).not.toHaveProperty('highlights')
    expect(out[2].text).toHaveLength(150)
  })

  it('본문에서 고른 카드 문장(cardSummary)은 상한 안에서만 남기고 자르지 않는다 — 강조는 글이나 그 문장에 있는 조각', () => {
    const out = normalizeSpecInputs(
      base({
        reviewQuotes: [
          { id: 'q1', text: '가방이 자주 무거웠어요', rating: 5, cardSummary: ' 부드럽게 열려요. ', highlights: ['부드럽게', '무거웠어요', '없는 말'] },
          { id: 'q2', text: '가볍고 손에 잘 맞아요', rating: 5, cardSummary: '가'.repeat(71) },
          { id: 'q3', text: '색이 예뻐요', rating: 5, cardSummary: 3 },
          { id: 'q4', text: '색이 예뻐요', rating: 5, cardSummary: '가'.repeat(70) },
        ],
      })
    ).reviewQuotes!
    expect(out[0].cardSummary).toBe('부드럽게 열려요.')
    expect(out[0].highlights).toEqual(['부드럽게', '무거웠어요'])
    expect(out[1]).not.toHaveProperty('cardSummary')
    expect(out[2]).not.toHaveProperty('cardSummary')
    expect(out[3].cardSummary).toHaveLength(70)
  })

  it('인용 카드 저장에는 후보의 카드 불가 사유(blocked)가 남지 않는다', () => {
    const out = normalizeSpecInputs(
      base({ reviewQuotes: [{ id: 'q1', text: '가볍고 손에 잘 맞아요', rating: 5, blocked: '정화' }] })
    ).reviewQuotes!
    expect(out).toEqual([{ id: 'q1', text: '가볍고 손에 잘 맞아요', rating: 5 }])
  })

  it('초안 표시는 프리필 칸 이름만 중복 없이', () => {
    const out = normalizeSpecInputs(base({ draftPrefill: ['material', 'material', 'reviewsText', 'origin', 3] }))
    expect(out.draftPrefill).toEqual(['material', 'origin'])
  })

  it('검색 태그는 한 줄로 펴서 30자까지, 빈 태그·중복을 지우고 20개까지 — 비면 키를 지운다', () => {
    const many = Array.from({ length: 30 }, (_, i) => `태그${i}`)
    const out = normalizeSpecInputs(base({ searchTags: ['  어린이집\n답례 ', '어린이집 답례', '', 3, '구'.repeat(40), ...many] }))
    expect(out.searchTags?.slice(0, 3)).toEqual(['어린이집 답례', '구'.repeat(30), '태그0'])
    expect(out.searchTags).toHaveLength(20)
    expect(normalizeSpecInputs(base({ searchTags: ['  '] }))).not.toHaveProperty('searchTags')
  })
})

describe('draftToSpecPrefill', () => {
  const draft = (over: Partial<DraftPrefillSource> = {}): DraftPrefillSource => ({
    productName: '스테인리스 컵 350ml',
    brand: '페어넥스',
    options: [
      { name: '색상', value: '블랙', salePrice: null, stock: null, barcode: null },
      { name: '색상', value: '화이트', salePrice: null, stock: null, barcode: null },
      { name: '색상', value: '블랙', salePrice: null, stock: null, barcode: null },
    ],
    notice: {
      '제품 소재': '스테인리스 304',
      크기: '8 x 8 x 10 cm',
      중량: '180g',
      '제조국(원산지)': '중국',
      용량: '350ml',
      '품명 및 모델명': 'FN-CUP-350',
      'A/S 책임자와 전화번호': '고객센터',
      품질보증기준: '관련 법 기준',
      'KC 인증': '해당없음',
      색상: '상세페이지 참조',
    },
    ...over,
  })

  it('고시정보 → 소재·크기·무게·원산지, 나머지 스펙 항목 → 추가 스펙, 브랜드·상품명·옵션값(중복 제거) → 각 칸', () => {
    const { patch, filled } = draftToSpecPrefill(draft())
    expect(patch).toEqual({
      productName: '스테인리스 컵 350ml',
      brandName: '페어넥스',
      material: '스테인리스 304',
      size: '8 x 8 x 10 cm',
      weight: '180g',
      origin: '중국',
      extraSpecs: [
        { key: '용량', value: '350ml' },
        { key: '품명 및 모델명', value: 'FN-CUP-350' },
      ],
      colorOptions: ['블랙', '화이트'],
    })
    expect(filled).toEqual([
      'productName',
      'brandName',
      'material',
      'size',
      'weight',
      'origin',
      'colorOptions',
      'extraSpecs',
    ])
  })

  it('검색 태그는 patch에만 — 화면 초안 표시(filled)에는 없다', () => {
    const { patch, filled } = draftToSpecPrefill(draft({ searchTags: ['어린이집답례품', '어린이집답례품', '구디백'] }))
    expect(patch.searchTags).toEqual(['어린이집답례품', '구디백'])
    expect(filled).not.toContain('searchTags')
    expect(draftToSpecPrefill(draft({ searchTags: [] })).patch).not.toHaveProperty('searchTags')
  })

  it('행정 항목·자리 표시 값(상세페이지 참조·해당없음)은 넣지 않고, 빈 초안은 빈 패치', () => {
    const { patch } = draftToSpecPrefill(draft())
    expect(JSON.stringify(patch)).not.toMatch(/고객센터|관련 법|해당없음|상세페이지 참조/)
    expect(draftToSpecPrefill({ productName: '', brand: '', options: [], notice: {} })).toEqual({
      patch: {},
      filled: [],
    })
  })

  it('같은 칸에 맞는 고시 항목이 둘이면 첫 값만(원산지·제조국)', () => {
    const { patch } = draftToSpecPrefill(draft({ notice: { 원산지: '한국', 제조국: '중국' } }))
    expect(patch.origin).toBe('한국')
  })

  it('떠넘기는 문구 변형(…참조 바랍니다·별도 표기·상세페이지에 표기·해당 사항 없음)은 사실 값으로 넣지 않는다', () => {
    const { patch, filled } = draftToSpecPrefill(
      draft({
        notice: {
          소재: '상품 상세페이지 참조',
          크기: '별도 표기',
          중량: '상세페이지에 표기',
          원산지: '제품 상세 참고 바랍니다',
          용량: '해당 사항 없음',
          두께: '-',
        },
      })
    )
    expect(patch).not.toHaveProperty('material')
    expect(patch).not.toHaveProperty('size')
    expect(patch).not.toHaveProperty('weight')
    expect(patch).not.toHaveProperty('origin')
    expect(patch).not.toHaveProperty('extraSpecs')
    expect(filled).toEqual(['productName', 'brandName', 'colorOptions'])
  })

  it('행정 항목 경계 — 제조사·제조업자·판매업자·출시년월은 빼고, 영문 낱말 속 AS(CLASS)는 스펙으로 둔다', () => {
    const { patch } = draftToSpecPrefill(
      draft({
        notice: {
          'CLASS 등급': 'A',
          제조사: '페어넥스',
          '화장품제조업자, 책임판매업자': '페어넥스',
          '동일모델의 출시년월': '2026-01',
          'A/S 안내': '고객센터',
          'AS 기간': '1년',
        },
      })
    )
    expect(patch.extraSpecs).toEqual([{ key: 'CLASS 등급', value: 'A' }])
  })
})

describe('프롬프트 스펙 JSON(W2a 직렬화 규칙)', () => {
  it('새 필드가 없으면 이전과 같은 바이트 — 기존 제외 키(리뷰 원문·옵션 구조·파일 메타·경쟁사)는 그대로 빠진다', () => {
    const spec = base({ material: '스테인리스', reviewsText: '좋아요', reviewFiles: {}, optionSpec: {} })
    expect(specSheetPromptJson(spec)).toBe('{"productName":"세척 쉬운 컵","material":"스테인리스"}')
    expect(buildSpecSheetJson(spec)).toBe(specSheetPromptJson(spec))
  })

  it('무게·원산지·추가 스펙은 사실로 들어가고, 인용 카드·초안 표시는 빠진다', () => {
    const json = specSheetPromptJson(
      base({
        weight: '120g',
        origin: '중국',
        extraSpecs: [{ key: '두께', value: '2mm' }],
        reviewQuotes: [{ id: 'q1', text: '좋아요', rating: 5 }],
        draftPrefill: ['weight'],
      })
    )
    expect(JSON.parse(json)).toEqual({
      productName: '세척 쉬운 컵',
      weight: '120g',
      origin: '중국',
      extraSpecs: [{ key: '두께', value: '2mm' }],
    })
  })

  it('검색 태그는 빠진다 — 태그가 있어도 없는 spec과 같은 바이트(분석·카피 직렬화 공통)', () => {
    const spec = base({ material: '종이', weight: '20g' })
    const tagged = { ...spec, searchTags: ['어린이집답례품', '구디백'] }
    expect(specSheetPromptJson(tagged)).toBe(specSheetPromptJson(spec))
    expect(buildSpecSheetJson(tagged)).toBe(specSheetPromptJson(spec))
  })
})
