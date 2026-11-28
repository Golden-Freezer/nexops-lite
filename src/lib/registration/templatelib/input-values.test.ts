/**
 * K 라인 입력값 칸 — 키마다 실제 입력에서 채우는지, 없으면 비우는지, 라이브러리의 모든 입력 키를 아는지. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { PDP_TEST_PRODUCT_IDS, getPdpTestProduct } from '../__fixtures__/pdp-products'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { fillInputSlots, lineInputsOf, metricsOf, namedIngredientsOf, namedPartsOf, requiredInputsFit, shotQuantityOf, type LineInputs } from './input-values'
import { missingSlots } from './slots'
import type { Template } from './template-types'
import { TEMPLATES } from './library'
import { templateById } from './library'

const spec = (over: Partial<PdpSpecSheet> = {}) =>
  ({ productName: '데이지 파우치', brandName: '페어넥스', size: '16.5cm x 20.7cm', material: 'PE', origin: '중국', colorOptions: ['데이지'], rating: 4.8, reviewCount: 120, extraSpecs: [{ key: '구성', value: '20개' }], ...over }) as unknown as PdpSpecSheet
const CARD = (text: string, rating: number | null = 5) => ({ text, author: '김**', rating })
const inputs = (over: Partial<LineInputs> = {}): LineInputs => ({
  spec: spec(),
  cards: [CARD('포장이 금방 끝나요'), CARD('아이들이 좋아해요', null)],
  options: [
    { label: '데이지', image: 'option:daisy' },
    { label: '체리', image: 'option:cherry' },
  ],
  ...over,
})
const text = (input: string, maxChars = 40) => ({ type: 'text', required: false, source: 'input', input, facts: 1, maxChars, maxLines: 2 })
const slots = (defs: Record<string, unknown>) => ({ slots: defs }) as unknown as Pick<Template, 'slots'>

describe('글자 칸', () => {
  it('평점·후기 수·첫 후기·순번·수량·치수를 입력에서 채운다', () => {
    const t = slots({
      score: text('review.rating'),
      count: text('review.count'),
      top: text('review.quote'),
      topName: text('review.name'),
      chapter: text('chapter'),
      qty: text('spec.quantity'),
      width: text('spec.size.width'),
      height: text('spec.size.height'),
    })
    expect(fillInputSlots(t, inputs(), 2)).toEqual({ score: '4.8', count: '후기 120건', top: '포장이 금방 끝나요', topName: '김**', chapter: '2', qty: '20개', width: '가로 16.5cm', height: '세로 20.7cm' })
  })

  it('평점 입력이 없으면 자사 리뷰 파일 집계로, 그것도 없으면 비운다', () => {
    const t = slots({ score: text('review.rating'), count: text('review.count') })
    const own = spec({ rating: undefined, reviewCount: undefined, reviewFiles: { own: { stats: { rating_counts: { 5: 3, 4: 1 } } } } } as unknown as Partial<PdpSpecSheet>)
    expect(fillInputSlots(t, inputs({ spec: own }))).toEqual({ score: '4.8', count: '후기 4건' })
    expect(fillInputSlots(t, inputs({ spec: spec({ rating: undefined, reviewCount: undefined } as unknown as Partial<PdpSpecSheet>) }))).toEqual({})
  })

  it('값이 없거나 칸 상한을 넘으면 비운다 — 지어내거나 자르지 않는다', () => {
    const t = slots({ chapter: text('chapter'), qty: text('spec.quantity'), width: text('spec.size.width', 3), top: text('review.quote', 3), other: text('모르는 키') })
    expect(fillInputSlots(t, inputs({ spec: spec({ extraSpecs: [] } as unknown as Partial<PdpSpecSheet>) }))).toEqual({})
  })

  it('첫 후기가 칸보다 길면 다음 후기를 쓴다', () => {
    const t = slots({ top: text('review.quote', 6) })
    expect(fillInputSlots(t, inputs({ cards: [CARD('아주 아주 긴 후기 글입니다'), CARD('좋아요')] }))).toEqual({ top: '좋아요' })
  })

  it('대표 후기의 글과 작성자는 같은 후기에서 온다', () => {
    const t = slots({ top: text('review.quote', 6), topName: text('review.name') })
    const cards = [{ text: '아주 아주 긴 후기 글입니다', author: '이**', rating: 5 }, { text: '좋아요', author: '박**', rating: 5 }]
    expect(fillInputSlots(t, inputs({ cards }))).toEqual({ top: '좋아요', topName: '박**' })
  })
})

describe('목록 칸', () => {
  const items = {
    type: 'list',
    required: true,
    source: 'input',
    input: 'review.items',
    min: 1,
    max: 2,
    fields: { name: { type: 'text', required: true, source: 'input', input: 'review.name', facts: 0, maxChars: 8 }, quote: { type: 'text', required: true, source: 'input', input: 'review.quote', facts: 0, maxChars: 12 }, stars: { type: 'text', required: false, source: 'input', input: 'review.stars', facts: 0, maxChars: 3 } },
  }

  it('후기 — 항목 칸 이름대로, 평점 없는 후기는 별 칸을 비우고 상한까지', () => {
    const value = fillInputSlots(slots({ items }), inputs({ cards: [CARD('좋아요'), CARD('예뻐요', null), CARD('또 사요')] })).items
    expect(value).toEqual([{ name: '김**', quote: '좋아요', stars: '5.0' }, { name: '김**', quote: '예뻐요' }])
  })

  it('후기 — 칸보다 긴 글은 건너뛰고, 최소 수에 못 미치면 비운다', () => {
    const long = CARD('가'.repeat(13))
    expect(fillInputSlots(slots({ items }), inputs({ cards: [long, CARD('좋아요')] })).items).toEqual([{ name: '김**', quote: '좋아요', stars: '5.0' }])
    expect(fillInputSlots(slots({ items }), inputs({ cards: [long] }))).toEqual({})
  })

  it('표 — 필수 행은 rows, 그 밖은 special로 가른다', () => {
    const list = (input: string, max: number) => ({ type: 'list', required: true, source: 'input', input, min: 1, max, fields: { label: { type: 'text', required: true, source: 'input', input: `${input}.label`, facts: 1, maxChars: 10 }, value: { type: 'text', required: true, source: 'input', input: `${input}.value`, facts: 1, maxChars: 40 } } })
    const values = fillInputSlots(slots({ rows: list('spec.rows', 7), special: list('spec.special', 3) }), inputs({ spec: spec({ extraSpecs: [{ key: '입구', value: '조임끈' }] } as unknown as Partial<PdpSpecSheet>) }))
    const labels = (values.rows as Array<{ label: string }>).map((row) => row.label)
    expect(labels).toEqual(expect.arrayContaining(['상품명', '브랜드', '사이즈', '소재', '원산지', '사용연령']))
    expect(labels).not.toContain('입구')
  })

  it('옵션 — 이름 목록과 사진 목록, 사진이 최소 수에 못 미치면 사진 칸을 비운다', () => {
    const names = { type: 'list', required: false, source: 'input', input: 'option.names', min: 1, max: 6, fields: {} }
    const images = { type: 'list', required: false, source: 'input', input: 'option.images', min: 2, max: 6, fields: { photo: { type: 'image', required: true } } }
    expect(fillInputSlots(slots({ names, images }), inputs())).toEqual({ names: ['데이지', '체리'], images: [{ photo: 'option:daisy' }, { photo: 'option:cherry' }] })
    const one = inputs({ options: [{ label: '데이지', image: 'option:daisy' }, { label: '체리', image: null }] })
    expect(fillInputSlots(slots({ names, images }), one)).toEqual({ names: ['데이지', '체리'] })
  })

  it('옵션 — 사진 칸에 이름 칸이 있으면 같은 옵션의 이름을 묶고, 칸보다 긴 이름의 옵션은 건너뛴다', () => {
    const named = { type: 'list', required: true, source: 'input', input: 'option.images', min: 2, max: 4, fields: { photo: { type: 'image', required: true }, name: { type: 'text', required: true, source: 'input', input: 'option.name', facts: 0, maxChars: 7, maxLines: 1, claimRisk: 'none' } } }
    expect(fillInputSlots(slots({ named }), inputs())).toEqual({ named: [{ photo: 'option:daisy', name: '데이지' }, { photo: 'option:cherry', name: '체리' }] })
    // 사진 없는 옵션이 앞에 있어도 이름이 다음 사진으로 밀리지 않는다
    const shifted = inputs({ options: [{ label: '빨강', image: null }, { label: '데이지', image: 'option:daisy' }, { label: '체리', image: 'option:cherry' }] })
    expect(fillInputSlots(slots({ named }), shifted)).toEqual({ named: [{ photo: 'option:daisy', name: '데이지' }, { photo: 'option:cherry', name: '체리' }] })
    const long = inputs({ options: [{ label: '라이트 베이지 그레이', image: 'option:a' }, { label: '체리', image: 'option:cherry' }, { label: '데이지', image: 'option:daisy' }] })
    expect(fillInputSlots(slots({ named }), long)).toEqual({ named: [{ photo: 'option:cherry', name: '체리' }, { photo: 'option:daisy', name: '데이지' }] })
    // 건너뛰어 최소 수에 못 미치면 칸을 비운다 — 이 템플릿은 후보에서 빠진다
    const tooFew = inputs({ options: [{ label: '라이트 베이지 그레이', image: 'option:a' }, { label: '체리', image: 'option:cherry' }] })
    expect(fillInputSlots(slots({ named }), tooFew)).toEqual({})
  })
})

describe('근거 글', () => {
  const names = (input: string, max = 4) => ({ type: 'list', required: true, source: 'input', input, min: 1, max, fields: input === 'certification.items' ? { name: text('certification.name', 12) } : {} })

  it('인증 입력을 나눠 고쳐 쓰지 않고 넣는다', () => {
    const one = inputs({ spec: spec({ certificationInfo: 'KC 안전확인; 친환경 인증\n특허 제10-1234호, 디자인 등록' }) })
    expect(fillInputSlots(slots({ items: names('certification.items') }), one).items).toEqual([{ name: 'KC 안전확인' }, { name: '친환경 인증' }, { name: '특허 제10-1234호' }, { name: '디자인 등록' }])
    expect(fillInputSlots(slots({ tags: names('certification.names') }), one).tags).toEqual(['KC 안전확인', '친환경 인증', '디자인 등록'])
  })

  it('칸보다 긴 인증 이름은 자르지 않고 건너뛰고, 인증이 없으면 비운다', () => {
    const long = inputs({ spec: spec({ certificationInfo: '아주 길고 긴 인증 이름이 여기에 들어갑니다\nKC 안전확인' }) })
    expect(fillInputSlots(slots({ items: names('certification.items') }), long).items).toEqual([{ name: 'KC 안전확인' }])
    expect(fillInputSlots(slots({ items: names('certification.items') }), inputs()).items).toBeUndefined()
  })

  it('혜택 글은 입력 그대로이고, 칸보다 길거나 없으면 비운다', () => {
    const t = slots({ offer: text('offer.info', 12) })
    expect(fillInputSlots(t, inputs({ spec: spec({ eventBannerInfo: ' 첫 구매 10% 할인 ' }) })).offer).toBe('첫 구매 10% 할인')
    expect(fillInputSlots(t, inputs({ spec: spec({ eventBannerInfo: '첫 구매 고객께만 드리는 아주 큰 할인 혜택' }) })).offer).toBeUndefined()
    expect(fillInputSlots(t, inputs()).offer).toBeUndefined()
  })
})

describe('라이브러리 전수', () => {
  /** 입력을 다 가진 상품 — 옵션 3열 변형은 옵션이 3개 이상이어야 그려진다(적으면 다음 후보로 넘어간다) */
  const FULL = () =>
    inputs({
      cards: Array.from({ length: 5 }, () => CARD('좋아요')),
      options: Array.from({ length: 6 }, (_, i) => ({ label: `옵션${i + 1}`, image: `option:${i + 1}` })),
      spec: spec({ certificationInfo: 'KC 안전확인\n친환경 인증', eventBannerInfo: '첫 구매 10% 할인' }),
    })
  /**
   * 수치 템플릿은 크기 입력에 이름이 적힌 상품에만 열린다 — FULL의 치수는 방향 표기라 이름 있는 크기로 바꾼다.
   * 층 템플릿(T1-85)은 층·단면 입력(spec_sheet.layers)이 있는 상품에만 열린다 — FULL에 층 입력을 더한다
   * 성분 템플릿(K3 R-W8)은 입력 재료 이름이 둘 이상인 상품에만 열린다 — FULL에 원재료 행을 더한다
   * 라인업 템플릿(K3 R-W6)은 옵션 2~4개가 모두 실물 사진(공개 https)일 때만 열린다 — FULL 옵션을 실물 사진 3개로 바꾼다
   * 별점 분포 템플릿(K7-b)은 자사 리뷰 파일 rating_counts 합계가 5건 이상일 때만 열린다 — FULL에 분포를 더한다
   * 주의·보관 템플릿(K7-c (가))은 입력 주의·보관 줄이 있을 때만 열린다 — FULL에 보관·관리 줄을 더한다(주의 줄은 아이콘이 없어 타일 칸을 막는다)
   * 입력 잠금 목록(K7-c (나))은 구성품 이름 둘 이상·사용 순서 2~5단계·사이즈 표가 입력에 있을 때만 열린다 — FULL에 그 입력을 더한다
   * 주기 줄(C5 ④)은 입력 사용·교체 주기가 2줄 이상 남을 때만 열린다 — FULL에 주기 줄을 더한다
   * 비교 근거 칸(C5 ②)은 입력 꼴이 맞을 때만 열린다 — 카드 한 쌍은 기존 있는 1행, ✓·줄표 표는 기존 빈 3행
   * 3축 치수 템플릿(K7-c 4c)은 방향이 확실한 깊이 입력이 있을 때만 열린다 — FULL 치수를 가로×세로×깊이로 바꾼다
   * 견본 색 칩(C5 ③)은 입력 견본이 모든 옵션 이름과 짝지어질 때만(2개 이상) 열린다 — FULL 옵션 6개마다 이름이 맞는 견본을 더한다
   * 옵션 사진 칸은 칸 상한을 넘으면 비운다(K14) — 칸이 6개보다 적은 템플릿은 그 수만큼만 준다
   */
  const listInputs = (template: Template) => Object.values(template.slots).flatMap((def) => (def.type === 'list' && def.input ? [def.input] : []))
  const compareSpecOf = (template: Template) => {
    const keys = JSON.stringify(template.slots)
    if (keys.includes('"compare.one.')) return spec({ compareBasis: [{ label: '용량', ours: '500ml', other: '350ml' }] } as Partial<PdpSpecSheet>)
    if (keys.includes('"compare.rows"')) return spec({ compareBasis: [{ label: '손잡이', ours: '접이식' }, { label: '세척', ours: '분리 세척' }, { label: '보관', ours: '세워 보관' }] } as Partial<PdpSpecSheet>)
    return null
  }
  const fullOf = (template: Template) => {
    const compare = compareSpecOf(template)
    if (compare) return { ...FULL(), spec: compare }
    // 시험 사진 칸(J57, demoshot 잡만)은 판매자 시험 사진(원천 사진 역할 demo)이 있을 때만 열린다
    if (listInputs(template).includes('demo.photos')) return { ...FULL(), demoPhotos: ['https://img.test/demo.jpg'] }
    if (listInputs(template).includes('review.ratingBars')) return { ...FULL(), spec: spec({ reviewFiles: { own: { stats: { rating_counts: { 5: 70, 4: 20, 3: 6, 2: 3, 1: 1 } } } } } as unknown as Partial<PdpSpecSheet>) }
    if (listInputs(template).includes('spec.metrics')) return { ...FULL(), spec: spec({ size: '길이 7.3cm, 굵기 3.2cm' }) }
    if (listInputs(template).includes('product.layers')) return { ...FULL(), spec: spec({ layers: [{ name: '겉감' }, { name: '충전재', note: '가볍고 따뜻해요' }, { name: '안감' }] }) }
    if (listInputs(template).some((key) => key.startsWith('ingredient.'))) return { ...FULL(), spec: spec({ extraSpecs: [{ key: '원재료', value: '쌀, 보리' }] }) }
    if (listInputs(template).includes('parts.items')) return { ...FULL(), spec: spec({ extraSpecs: [{ key: '구성품', value: '본체, 받침' }] }) }
    if (listInputs(template).includes('usage.steps')) return { ...FULL(), spec: spec({ usageSteps: [{ title: '뚜껑 열기', description: '가볍게 돌려요' }, { title: '담기' }, { title: '닫기' }] }) }
    if (listInputs(template).includes('option.sizeScale')) return { ...FULL(), spec: spec({ sizeMatrix: { columns: ['가로', '세로'], rows: [{ label: 'S', values: ['20cm', '24cm'] }, { label: 'M', values: ['26cm', '30cm'] }] } }) }
    if (listInputs(template).includes('option.sizeRows')) return { ...FULL(), spec: spec({ sizeMatrix: { columns: ['어깨', '가슴'], rows: [{ label: 'S', values: ['40', '90'] }, { label: 'M', values: ['42', '95'] }] } }) }
    if (listInputs(template).includes('notice.items')) return { ...FULL(), spec: spec({ noticeItems: [{ kind: 'storage', text: '서늘한 곳에 보관해요' }, { kind: 'care', text: '물로 헹궈 말려요' }] }) }
    // 후기 질문 FAQ(K4 ②)는 설계 단계 후기 질문이 2개 이상일 때만 열린다 — FULL에 후기 질문 둘을 더한다
    if (listInputs(template).includes('faq.reviews')) return { ...FULL(), faqs: [{ question: '선물용으로 괜찮나요?', answer: '포장이 깔끔해서 선물로 드렸어요' }, { question: '세척은 쉬운가요?', answer: '물로 헹구면 금방 깨끗해져요' }] }
    // 우리 판매량(J51b) — 잡 생성 때 서버가 남긴 합·기간 문구(ownSales)
    if (Object.values(template.slots).some((def) => def.type === 'text' && def.input === 'sales.total')) return { ...FULL(), spec: spec({ ownSales: { total: '35,600개', basis: '2026.02~2026.08 쿠팡 누적 판매' } }) }
    if (listInputs(template).includes('schedule.rows')) return { ...FULL(), spec: spec({ schedule: [{ label: '필터 교체', period: '3개월마다' }, { label: '본체 세척', period: '주 1회' }] }) }
    if (Object.values(template.slots).some((def) => def.type === 'text' && def.input === 'spec.size.depth')) return { ...FULL(), spec: spec({ size: '40cm x 30cm x 20cm' }) }
    if (listInputs(template).includes('option.swatches')) return { ...FULL(), spec: spec({ swatches: FULL().options.map((option, i) => ({ name: option.label, hex: `#${String(i + 1).repeat(6)}` })) }) }
    // 옵션 색 띠(J54, partsbands 잡)는 옵션마다 사진에서 잰 색이 있을 때만(2~4개) 열린다 — FULL 옵션 3개에 잰 색을 더한다
    if (listInputs(template).includes('option.bands')) return { ...FULL(), options: FULL().options.slice(0, 3), optionColors: FULL().options.slice(0, 3).map((option, i) => ({ label: option.label, hex: `#${String(i + 3).repeat(6)}` })) }
    if (listInputs(template).includes('option.lineup')) return { ...FULL(), options: Array.from({ length: 3 }, (_, i) => ({ label: `옵션${i + 1}`, image: `https://cdn.example.com/option-${i + 1}.jpg` })) }
    const photos = Object.values(template.slots).find((def) => def.type === 'list' && def.input === 'option.images')
    if (photos?.type === 'list') return { ...FULL(), options: FULL().options.slice(0, photos.inputMax ?? photos.max) }
    return FULL()
  }
  const library = TEMPLATES
  /** 출처가 아직 없는 키 — 칸은 비우고 그 템플릿은 키 없이 그린다 */
  const NO_SOURCE = new Set(['review.keywords', 'compare.ours', 'compare.other'])

  it('필수 입력값 칸을 모두 채울 수 있다 — 평점·후기·표·수량이 있는 상품이면 빈 칸은 출처 없는 키뿐이다', () => {
    for (const template of library) {
      const values = fillInputSlots(template, fullOf(template), 1)
      const inputRequired = Object.entries(template.slots).filter(([, def]) => def.type !== 'image' && def.source === 'input' && def.required)
      const empty = inputRequired.filter(([name]) => values[name] === undefined).map(([name, def]) => (def as { input?: string }).input ?? name)
      expect(empty.filter((key) => !NO_SOURCE.has(key)), template.id).toEqual([])
    }
  })

  it('입력값을 채운 뒤 남는 필수 칸은 카피·사진 칸뿐이다', () => {
    for (const template of library) {
      // 목록 항목의 사진 칸(후기 사진 카드)은 컷 배정이 채운다 — 여기서는 채운 셈 친다
      const values = fillInputSlots(template, fullOf(template), 1)
      for (const [name, def] of Object.entries(template.slots)) {
        const photo = def.type === 'list' ? Object.entries(def.fields).find(([, field]) => field.type === 'image')?.[0] : undefined
        const items = values[name]
        if (photo && Array.isArray(items)) values[name] = (items as Array<Record<string, string>>).map((item) => ({ ...item, [photo]: 'cut' }))
      }
      const missing = missingSlots(template, values)
      for (const name of missing) {
        const def = template.slots[name]
        const input = def.type !== 'image' ? (def as { input?: string }).input : undefined
        if (def.type !== 'image' && def.source === 'input') expect(NO_SOURCE.has(input ?? ''), `${template.id}.${name}`).toBe(true)
      }
    }
  })

  it.each(PDP_TEST_PRODUCT_IDS)('%s: 표의 필수 행이 시험 상품 입력에서 채워진다', (id) => {
    const rows = fillInputSlots(slots({ rows: { type: 'list', required: true, source: 'input', input: 'spec.rows', min: 1, max: 7, fields: { label: { type: 'text', required: true, source: 'input', input: 'spec.rows.label', facts: 1, maxChars: 10 }, value: { type: 'text', required: true, source: 'input', input: 'spec.rows.value', facts: 1, maxChars: 40 } } } }), inputs({ spec: getPdpTestProduct(id).specSheet })).rows
    expect(Array.isArray(rows) && rows.length >= 1).toBe(true)
  })
})

describe('필수 입력값 판정', () => {
  const byId = (id: string) => TEMPLATES.find((t) => t.id === id)!
  const inputsWith = (options: Array<{ label: string; image: string | null }>): LineInputs => ({ spec: spec(), cards: [], options })

  it('옵션 이름 목록은 최소 항목 수를 채워야 한다', () => {
    const template = byId('option_gallery.names-offset')
    expect(requiredInputsFit(template, inputsWith([{ label: '빨강', image: null }]))).toBe(false)
    expect(requiredInputsFit(template, inputsWith([{ label: '빨강', image: null }, { label: '파랑', image: null }]))).toBe(true)
  })

  it('옵션 사진 목록은 사진이 있는 옵션만 센다', () => {
    const template = byId('option_gallery.grid-two')
    expect(requiredInputsFit(template, inputsWith([{ label: '빨강', image: null }, { label: '파랑', image: null }]))).toBe(false)
    expect(requiredInputsFit(template, inputsWith([{ label: '빨강', image: 'a.png' }, { label: '파랑', image: 'b.png' }]))).toBe(true)
  })

  it.each([
    ['AxB 형식', '16.5cm x 20.7cm', { width: '가로 16.5cm', height: '세로 20.7cm' }],
    ['가로·세로 낱말', '가로 12cm, 세로 8cm', { width: '가로 12cm', height: '세로 8cm' }],
    ['방향 낱말이 없는 치수(R15 P09)', '고리 21.4cm, 펼침 37.3cm', {}],
    ['길이·굵기', '길이 7.3cm, 굵기 3.2cm', {}],
    ['지름', '지름 50mm 원형', {}],
    ['숫자 하나', '5cm 원형', {}],
    ['방향 있는 값과 모르는 값이 섞임', '길이 30cm, 폭 5cm', {}],
  ])('치수 칸은 방향이 확실할 때만 채운다 — %s', (_name, size, expected) => {
    const slotsOf = { width: { type: 'text', source: 'input', input: 'spec.size.width', required: false, facts: 1, maxChars: 10, maxLines: 1, claimRisk: 'none' }, height: { type: 'text', source: 'input', input: 'spec.size.height', required: false, facts: 1, maxChars: 10, maxLines: 1, claimRisk: 'none' } }
    expect(fillInputSlots({ slots: slotsOf } as never, { spec: spec({ size }), cards: [], options: [] })).toEqual(expected)
  })

  it('치수 표는 방향을 모르면 후보가 아니다 — 다른 표는 그대로 후보다', () => {
    const dimension = byId('spec_table.dimension')
    const other = byId('spec_table.line-rows')
    const of = (size: string): LineInputs => ({ spec: spec({ size }), cards: [], options: [] })
    expect(requiredInputsFit(dimension, of('16.5cm x 20.7cm'))).toBe(true)
    expect(requiredInputsFit(dimension, of('고리 21.4cm, 펼침 37.3cm'))).toBe(false)
    expect(requiredInputsFit(other, of('고리 21.4cm, 펼침 37.3cm'))).toBe(true)
  })

  it('실제 시험 상품 — 방향을 모르는 4상품만 치수 표가 빠지고 입력 글은 표 행에 남는다', () => {
    const dimension = byId('spec_table.dimension')
    const rowsOf = (t: Pick<Template, 'slots'>, inputs: LineInputs) => JSON.stringify(fillInputSlots(t, inputs).rows ?? [])
    const unknown = PDP_TEST_PRODUCT_IDS.filter((id) => !requiredInputsFit(dimension, { spec: getPdpTestProduct(id).specSheet, cards: [], options: [] }))
    expect(unknown).toEqual(['P01', 'P08', 'P09', 'P11'])
    for (const id of unknown) {
      const product = getPdpTestProduct(id).specSheet
      expect(rowsOf(byId('spec_table.line-rows'), { spec: product, cards: [], options: [] })).toContain(String(product.size))
    }
  })

  it('입력값 칸이 없는 템플릿은 언제나 통과다', () => {
    expect(requiredInputsFit(byId('product_exposure.hero-bleed'), inputsWith([]))).toBe(true)
  })

  it('상품 정보 표는 입력 스펙으로 그려진다 — 3축 치수 표(K7-c 4c)는 깊이 입력, 같은 축척 칸(K7 4d)은 사이즈 표 입력도 있어야 한다', () => {
    const tables = TEMPLATES.filter((t) => t.section === 'spec_table')
    expect(tables.length).toBeGreaterThan(0)
    const needsDepth = (t: Template) => Object.values(t.slots).some((def) => def.type === 'text' && def.input === 'spec.size.depth' && def.required)
    const needsScale = (t: Template) => Object.values(t.slots).some((def) => def.type === 'list' && def.input === 'option.sizeScale')
    const sized: LineInputs = { ...inputsWith([]), spec: spec({ sizeMatrix: { columns: ['가로', '세로'], rows: [{ label: 'S', values: ['20cm', '24cm'] }, { label: 'M', values: ['26cm', '30cm'] }] } }) }
    expect(tables.filter((t) => !needsDepth(t) && !needsScale(t)).every((t) => requiredInputsFit(t, inputsWith([])))).toBe(true)
    expect(tables.filter(needsDepth).map((t) => t.id)).toEqual(['spec_table.dimension-box'])
    expect(tables.filter(needsDepth).every((t) => !requiredInputsFit(t, inputsWith([])) && requiredInputsFit(t, { ...inputsWith([]), spec: spec({ size: '40cm x 30cm x 20cm' }) }))).toBe(true)
    expect(tables.filter(needsScale).map((t) => [t.id, requiredInputsFit(t, inputsWith([])), requiredInputsFit(t, sized)])).toEqual([['spec_table.scale-set', false, true]])
  })
})

describe('제품 수치(spec.metrics)', () => {
  const spec = (size: string) => ({ productName: 'x', size }) as PdpSpecSheet

  it('이름이 적힌 값만 읽는다', () => {
    expect(metricsOf(spec('길이 7.3cm, 굵기 3.2cm'))).toEqual([{ name: '길이', value: '7.3', unit: 'cm' }, { name: '굵기', value: '3.2', unit: 'cm' }])
    expect(metricsOf(spec('지름 50mm 원형'))).toEqual([{ name: '지름', value: '50', unit: 'mm' }])
  })

  it('이름 없는 값은 지어내지 않는다', () => {
    expect(metricsOf(spec('5cm 원형'))).toEqual([])
    expect(metricsOf(spec('약 30cm'))).toEqual([])
    expect(metricsOf(spec('길이 약 30cm, 최대 5kg'))).toEqual([])
  })

  it('방향이 확실한 치수는 끝자리 치수 표에 실리므로 비운다', () => {
    expect(metricsOf(spec('34cm x 19.5cm x 12.5cm'))).toEqual([])
    expect(metricsOf(spec('가로 10cm, 세로 20cm'))).toEqual([])
  })

  it('시험 상품 11개 중 P08·P09·P11만 값이 있다', () => {
    const counts = PDP_TEST_PRODUCT_IDS.map((id) => [id, metricsOf(getPdpTestProduct(id).specSheet).length])
    expect(counts.filter(([, n]) => n !== 0)).toEqual([['P08', 2], ['P09', 2], ['P11', 1]])
  })

  it('값과 단위를 한 칸에 넣는다', () => {
    const inputs = lineInputsOf({ spec_sheet: getPdpTestProduct('P09').specSheet, analysis: {}, copy_sections: { final: {} } } as unknown as PdpJobRow)
    for (const id of ['sub_div.metric-rows', 'sub_div.metric-photo']) {
      expect(fillInputSlots(templateById(id)!, inputs, 1).metrics, id).toEqual([{ name: '고리', value: '21.4cm' }, { name: '펼침', value: '37.3cm' }])
    }
  })

  it('값이 없는 상품에서는 수치 템플릿이 그려지지 않는다', () => {
    const template = templateById('sub_div.metric-rows')!
    const inputsOf = (id: 'P07' | 'P08') => lineInputsOf({ spec_sheet: getPdpTestProduct(id).specSheet, analysis: {}, copy_sections: { final: {} } } as unknown as PdpJobRow)
    expect(requiredInputsFit(template, inputsOf('P07'))).toBe(false)
    expect(requiredInputsFit(template, inputsOf('P08'))).toBe(true)
  })
})

describe('shotQuantityOf — 수량 컷에 적을 수(적용 K6 R-B7)', () => {
  const spec = (over: Partial<PdpSpecSheet>) => over as PdpSpecSheet
  const set = (value: string) => ({ extraSpecs: [{ key: '구성', value }] })

  it('구성 칸이 6개 이하면 정확히 그 수, 7개 이상이면 없음 — 구성 칸이 옵션보다 이긴다', () => {
    expect(shotQuantityOf(spec(set('2개(블랙+라벤더)')))).toEqual({ exact: 2, noun: 'pieces' })
    expect(shotQuantityOf(spec(set('6매')))).toEqual({ exact: 6, noun: 'pieces' })
    expect(shotQuantityOf(spec(set('1세트')))).toEqual({ exact: 1, noun: 'set' })
    expect(shotQuantityOf(spec(set('7개')))).toBeNull()
    expect(shotQuantityOf(spec({ ...set('20개'), colorOptions: ['1개 검정', '2개 검정'] }))).toBeNull()
    expect(shotQuantityOf(spec({ ...set('3개'), colorOptions: ['1개 검정', '6개 검정'] }))).toEqual({ exact: 3, noun: 'pieces' })
  })

  it('구성 칸이 없으면 옵션 수량 가운데 가장 큰 수가 6 이하일 때 그 수 이하 — 구조화된 옵션이 먼저다', () => {
    expect(shotQuantityOf(spec({ colorOptions: ['1개 검정 Free', '6개 검정 Free', '3개 검정 Free'] }))).toEqual({ max: 6, noun: 'pieces' })
    expect(shotQuantityOf(spec({ colorOptions: ['2개 브라운', '8개 브라운'] }))).toBeNull()
    expect(shotQuantityOf(spec({ colorOptions: ['블랙', '화이트'] }))).toBeNull()
    expect(shotQuantityOf(spec({}))).toBeNull()
    // 구성 칸이 숫자가 아니면(부속 이름) 없는 것으로 본다
    expect(shotQuantityOf(spec({ ...set('슬리커 브러쉬·미세빗'), colorOptions: ['1개 모던 그레이', '2개 모던 그레이'] }))).toEqual({ max: 2, noun: 'pieces' })
    const optionSpec = { source: 'manual', axes: [{ kind: 'quantity', name: '수량', values: ['2개', '4개'] }], variants: [{ label: '2개', values: { quantity: '2개' } }, { label: '4개', values: { quantity: '4개' } }] }
    expect(shotQuantityOf(spec({ optionSpec, colorOptions: ['9개'] } as unknown as Partial<PdpSpecSheet>))).toEqual({ max: 4, noun: 'pieces' })
  })

  it('시험 상품 — P10 옵션 1~6개는 6개 이하, 구성 칸 20개·300개는 그대로', () => {
    const of = (id: string) => shotQuantityOf(getPdpTestProduct(id as (typeof PDP_TEST_PRODUCT_IDS)[number]).specSheet)
    expect(of('P10')).toEqual({ max: 6, noun: 'pieces' })
    expect(of('P05')).toEqual({ max: 4, noun: 'pieces' })
    expect(of('P04')).toEqual({ exact: 2, noun: 'pieces' })
    expect(of('P09')).toEqual({ exact: 2, noun: 'pieces' })
    expect(of('P02')).toBeNull()
    expect(of('P08')).toBeNull()
  })
})

describe('namedPartsOf — 입력에 적힌 부속 이름만', () => {
  const of = (key: string, value: string) => namedPartsOf({ extraSpecs: [{ key, value }] })

  it('시험 상품은 P09의 연결 태그만 읽히고 나머지는 빈 목록이다', () => {
    for (const id of PDP_TEST_PRODUCT_IDS) expect(namedPartsOf(getPdpTestProduct(id).specSheet), id).toEqual(id === 'P09' ? ['연결 태그'] : [])
  })

  it('부속 키의 값을 나누고 포함 낱말·괄호를 뺀다', () => {
    expect(of('구성품', '리필 브러시(2개), 보관 케이스 포함')).toEqual(['리필 브러시', '보관 케이스'])
    expect(of('부속품', '거치대')).toEqual(['거치대'])
  })

  it('구성 칸은 읽지 않는다 — 수량과 본품이 함께 적혀 있다', () => {
    expect(of('구성', '슬리커 브러쉬·미세빗')).toEqual([])
  })

  it('수량만 있거나 이름이 아닌 값은 비운다', () => {
    for (const value of ['2개', '10입', '상세페이지 참조', '해당 없음', '포함', '']) expect(of('구성품', value), value).toEqual([])
  })

  it('입력이 없거나 깨져도 빈 목록이다', () => {
    expect(namedPartsOf({})).toEqual([])
    expect(namedPartsOf({ extraSpecs: 'x' as never })).toEqual([])
  })
})

describe('namedIngredientsOf — 입력에 적힌 재료 이름만', () => {
  const of = (key: string, value: string) => namedIngredientsOf({ extraSpecs: [{ key, value }] })

  it('시험 상품 11개는 재료 칸이 없어 모두 빈 목록이다 — 지금 잡의 컷이 바뀌지 않는다', () => {
    for (const id of PDP_TEST_PRODUCT_IDS) expect(namedIngredientsOf(getPdpTestProduct(id).specSheet), id).toEqual([])
  })

  it('재료 키의 값을 나눠 읽고, 괄호 안 함량·원산지는 뺀다', () => {
    expect(of('원재료', '설탕, 소금(국산), 간장(95%)')).toEqual(['설탕', '소금', '간장'])
    expect(of('원재료명 및 함량', '쌀·보리/콩')).toEqual(['쌀', '보리', '콩'])
    expect(of('주요 성분', '히알루론산')).toEqual(['히알루론산'])
  })

  it('같은 이름은 한 번만 쓴다', () => {
    expect(namedIngredientsOf({ extraSpecs: [{ key: '재료', value: '소금' }, { key: '원료', value: '소금, 설탕' }] })).toEqual(['소금', '설탕'])
  })

  it('재질·전성분·다른 칸은 재료로 읽지 않는다', () => {
    for (const key of ['소재', '전성분', '구성', '식품유형', '재질']) expect(of(key, '면'), key).toEqual([])
  })

  it('이름이 아닌 값은 짓지 않고 비운다', () => {
    for (const value of ['상세페이지 참조', '별도 표기', '해당 없음', '제품 라벨 확인', '', '  ', '100', '아주 길게 이어지는 설명 문장이라 재료 이름으로 볼 수 없는 값입니다']) {
      expect(of('원재료', value), value).toEqual([])
    }
  })

  it('입력이 없거나 깨져도 빈 목록이다', () => {
    expect(namedIngredientsOf({})).toEqual([])
    expect(namedIngredientsOf({ extraSpecs: 'x' as never })).toEqual([])
    expect(namedIngredientsOf({ extraSpecs: [null, { key: '원재료' }, { value: '소금' }] as never })).toEqual([])
  })
})
