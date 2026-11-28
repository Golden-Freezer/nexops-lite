import { describe, expect, it } from 'vitest'
import type { PdpSpecSheet } from './pdp-state'
import type { DraftPrefillSource } from './spec-inputs'
import {
  QUOTE_MAX,
  applyDraftPrefill,
  autoFillRequestBody,
  clearDraftMark,
  clipText,
  highlightChips,
  quoteCardText,
  planAutoFill,
  toggleHighlight,
  toggleQuote,
  type ReviewCandidate,
} from './pdp-input-assist'

const cand = (id: string, text = `후기 ${id} 정말 좋아요`, rating = 5, option?: string): ReviewCandidate => ({ id, text, rating, ...(option ? { option } : {}) })

describe('clipText — 서버와 같은 UTF-16 상한, 이모지 가운데는 자르지 않는다', () => {
  it('상한 이하면 그대로, 넘으면 깨진 글자 없이 상한 안에서 자른다', () => {
    expect(clipText('짧은 글', 150)).toBe('짧은 글')
    const withEmoji = '가'.repeat(149) + '😀끝' // 149 + 2(서로게이트 쌍) + 1
    const clipped = clipText(withEmoji, 150)
    expect(clipped).toBe('가'.repeat(149)) // 이모지 반쪽을 남기지 않는다
    expect(clipped.length).toBeLessThanOrEqual(150)
    expect(clipText('가'.repeat(148) + '😀끝', 150)).toBe('가'.repeat(148) + '😀')
  })
})

describe('planAutoFill — 빈 칸만 채우고 이미 쓴 칸은 묻는다(계약 §4)', () => {
  it('빈 칸은 채우고, 다른 값이 있는 칸은 conflicts, 같은 값·빈 제안은 무시', () => {
    const plan = planAutoFill(
      { targetPersona: '', brandVoiceGuide: '따뜻하게', brandHexColor: '#112233' },
      { targetPersona: '30대 반려인', brandVoiceGuide: '담백하게', brandHexColor: '#112233' }
    )
    expect(plan.fill).toEqual({ targetPersona: '30대 반려인' })
    expect(plan.conflicts).toEqual([{ field: 'brandVoiceGuide', current: '따뜻하게', suggested: '담백하게' }])
    expect(planAutoFill({}, { targetPersona: '   ' })).toEqual({ fill: {}, conflicts: [] })
  })
  it('브랜드 컬러는 #RRGGBB만 쓴다', () => {
    expect(planAutoFill({}, { brandHexColor: 'green' }).fill).toEqual({})
    expect(planAutoFill({}, { brandHexColor: '#A1b2C3' }).fill).toEqual({ brandHexColor: '#A1b2C3' })
  })
})

describe('autoFillRequestBody — 계약 §2-2 본문', () => {
  it('상품명·카테고리·브랜드·사실 칸을 담고, 리뷰 원문은 앞 4,000자만', () => {
    const spec = {
      productName: ' 2구 식기 ',
      category: 'pet',
      material: '스테인리스',
      weight: '450g',
      origin: '중국',
      extraSpecs: [{ key: '용량', value: '450ml' }],
      keyFeatures: ['높이 조절'],
      reviewsText: 'r'.repeat(5000),
      targetPersona: '보내지 않는다',
    } as PdpSpecSheet
    const body = autoFillRequestBody(spec)
    expect(body.productName).toBe('2구 식기')
    expect(body).toMatchObject({ category: 'pet', specSheet: { material: '스테인리스', weight: '450g', origin: '중국', extraSpecs: [{ key: '용량', value: '450ml' }] } })
    expect(body.reviewsText).toHaveLength(4000)
    expect(body).not.toHaveProperty('brandName')
    expect(JSON.stringify(body)).not.toContain('보내지 않는다')
  })
})

describe('applyDraftPrefill — 초안 → 빈 칸만, draftPrefill은 실제로 채운 8개 이름 안에서', () => {
  const draft = {
    productName: '스테인리스 컵 350ml',
    brand: '페어넥스',
    options: [{ name: '색상', value: '블랙', salePrice: null, stock: null, barcode: null }],
    notice: { '제품 소재': '스테인리스 304', 중량: '180g', '제조국(원산지)': '중국', 용량: '350ml' },
  } as unknown as DraftPrefillSource
  it('빈 spec이면 상품명·브랜드·소재·무게·원산지·추가 스펙·색상을 채우고 그 이름을 표시한다', () => {
    const next = applyDraftPrefill({ productName: '' }, draft)
    expect(next).toMatchObject({ productName: '스테인리스 컵 350ml', brandName: '페어넥스', material: '스테인리스 304', weight: '180g', origin: '중국', colorOptions: ['블랙'] })
    expect(next.extraSpecs).toEqual([{ key: '용량', value: '350ml' }])
    expect(next.draftPrefill).toEqual(['productName', 'brandName', 'material', 'weight', 'origin', 'colorOptions', 'extraSpecs'])
  })
  it('이미 쓴 칸(상품명 제외)은 두고 표시도 하지 않는다. 상품명은 초안이 이긴다(기존 규칙)', () => {
    const next = applyDraftPrefill({ productName: '작명 결과', material: '오너가 쓴 소재' }, draft)
    expect(next.productName).toBe('스테인리스 컵 350ml')
    expect(next.material).toBe('오너가 쓴 소재')
    expect(next.draftPrefill).not.toContain('material')
    expect(next.draftPrefill).toContain('productName')
  })
  it('검색 태그는 spec이 비어 있을 때만 옮기고 초안 표시는 하지 않는다', () => {
    const tagged = { ...draft, searchTags: ['어린이집답례품'] } as DraftPrefillSource
    const next = applyDraftPrefill({ productName: '' }, tagged)
    expect(next.searchTags).toEqual(['어린이집답례품'])
    expect(next.draftPrefill).not.toContain('searchTags')
    expect(applyDraftPrefill({ productName: '', searchTags: ['오너 태그'] }, tagged).searchTags).toEqual(['오너 태그'])
  })
})

describe('clearDraftMark — 오너가 고친 칸은 초안 표시를 뺀다', () => {
  it('이름을 빼고, 다 빠지면 undefined', () => {
    expect(clearDraftMark(['origin', 'weight'], 'origin')).toEqual(['weight'])
    expect(clearDraftMark(['origin'], 'origin')).toBeUndefined()
    expect(clearDraftMark(undefined, 'origin')).toBeUndefined()
  })
})

describe('인용 카드 — 6장 이하, 글은 그대로, 강조는 글 안 조각만', () => {
  it('별점 3점 후보도 오너가 고를 수 있다', () => {
    expect(toggleQuote([], { ...cand('b'), rating: 3 }).map((q) => q.rating)).toEqual([3])
  })

  it('사유(blocked)가 있는 후보는 고르지 않고, 사유는 고른 카드에 남기지 않는다', () => {
    const blocked = { ...cand('b'), blocked: '최상급' as const }
    expect(toggleQuote([], blocked)).toEqual([])
    const picked = toggleQuote([], cand('a'))
    expect(Object.keys(picked[0])).not.toContain('blocked')
    // 이미 고른 카드는 사유가 붙어 와도 뺄 수 있다
    expect(toggleQuote([{ id: 'b', text: '가', rating: 5 }], blocked)).toEqual([])
  })
  it('본문에서 고른 카드 문장도 옮기고, 강조는 페이지에 실릴 글에서 고른다', () => {
    const [picked] = toggleQuote([], { ...cand('m', '가방이 자주 무거웠어요'), cardSummary: '부드럽게 열려요.' })
    expect(picked.cardSummary).toBe('부드럽게 열려요.')
    expect(quoteCardText(picked)).toBe('부드럽게 열려요.')
    expect(toggleHighlight(picked, '부드럽게').highlights).toEqual(['부드럽게'])
    expect(toggleHighlight(picked, '무거웠어요').highlights).toBeUndefined()
    expect(quoteCardText({ text: '색이 예뻐요' })).toBe('색이 예뻐요')
    expect(toggleHighlight({ id: 'x', text: '색이 예뻐요', rating: 5 }, '색이').highlights).toEqual(['색이'])
  })
  it('작성 월·가린 작성자도 고른 카드로 옮긴다(P1-6)', () => {
    const picked = toggleQuote([], { ...cand('m'), month: '2026.10', author: '김**' })
    expect(picked[0]).toMatchObject({ id: 'm', month: '2026.10', author: '김**' })
  })
  it('고르면 더하고 다시 누르면 빼며, 6장에서 멈춘다(글은 150자에서 자르기만)', () => {
    let selected = toggleQuote([], cand('a', '가'.repeat(200), 4, '화이트'))
    expect(selected).toEqual([{ id: 'a', text: '가'.repeat(150), rating: 4, option: '화이트' }])
    selected = toggleQuote(selected, cand('a'))
    expect(selected).toEqual([])
    for (const id of ['1', '2', '3', '4', '5', '6', '7']) selected = toggleQuote(selected, cand(id))
    expect(selected.map((q) => q.id)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(selected).toHaveLength(QUOTE_MAX)
  })
  it('강조 후보는 낱말에서 문장부호를 뗀 2~12자 조각(중복 없이)', () => {
    expect(highlightChips('물도 사료도, 한 번에! 정말 정말 편해요.')).toEqual(['물도', '사료도', '번에', '정말', '편해요'])
    expect(highlightChips('가나다라마바사아자차카타파하')).toEqual([]) // 12자 넘는 낱말
  })
  it('강조는 글 안에 있는 조각만, 3개까지 켜고 끈다', () => {
    let q = toggleQuote([], cand('a', '물도 사료도 한 번에 정말 편해요'))[0]
    q = toggleHighlight(q, '사료도')
    q = toggleHighlight(q, '없는말')
    expect(q.highlights).toEqual(['사료도'])
    for (const c of ['정말', '편해요', '번에']) q = toggleHighlight(q, c)
    expect(q.highlights).toEqual(['사료도', '정말', '편해요'])
    q = toggleHighlight(q, '사료도')
    expect(q.highlights).toEqual(['정말', '편해요'])
  })
})
