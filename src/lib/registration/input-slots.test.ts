/**
 * 입력 칸(적용 JOB C1) — 값이 없으면 안 나온다, 반쪽 값은 버린다, 프롬프트에 안 들어간다, P07·P08·P05 답.
 */
import { describe, expect, it } from 'vitest'
import { INPUT_SLOT_SAMPLE, withSampleInputSlots } from './__fixtures__/input-slots.sample'
import { getPdpTestProduct, PDP_TEST_PRODUCT_IDS } from './__fixtures__/pdp-products'
import {
  cleanNoticeItems,
  cleanSizeMatrix,
  cleanUsageSteps,
  formatLayerLines,
  formatMatrixLines,
  formatMetricLines,
  formatNoticeLines,
  formatPhotoLines,
  formatStepLines,
  formatSwatchLines,
  INPUT_SLOT_KEYS,
  INPUT_SLOT_LIMITS,
  normalizeInputSlots,
  parseLayerLines,
  parseMatrixLines,
  parseMetricLines,
  parseNoticeLines,
  parsePhotoLines,
  parseStepLines,
  parseSwatchLines,
} from './input-slots'
import { inputSlotsOf, ratingBarsOf } from './input-slots-read'
import { specSheetPromptJson, type PdpSpecSheet } from './pdp-state'
import { normalizeSpecInputs } from './spec-inputs'

const base = (patch: Partial<PdpSpecSheet> = {}): PdpSpecSheet => ({ productName: '시험 상품', ...patch })

describe('값이 없으면 안 나온다', () => {
  it('빈 spec은 모든 칸이 비었다', () => {
    expect(inputSlotsOf(base())).toEqual({
      notices: [],
      metrics: [],
      ratingBars: [],
      certifications: [],
      ingredients: [],
      usageSteps: [],
      sizeMatrix: null,
      parts: [],
      layers: [],
      swatches: [],
      realPhotos: [],
      productColor: null,
      compareBasis: [],
      compareSource: null,
      schedule: [],
    })
  })

  it('시험 상품 11개에 새 칸 값이 없고 표본이 섞이지 않았다', () => {
    for (const id of PDP_TEST_PRODUCT_IDS) {
      const { specSheet } = getPdpTestProduct(id)
      const slots = inputSlotsOf(specSheet)
      expect(INPUT_SLOT_KEYS.filter((key) => key in specSheet), id).toEqual([])
      expect([slots.usageSteps, slots.layers, slots.swatches, slots.realPhotos], id).toEqual([[], [], [], []])
      expect([slots.sizeMatrix, slots.productColor], id).toEqual([null, null])
      expect(JSON.stringify(specSheet), id).not.toContain('표본')
    }
  })

  it('평점 입력 하나로 별점 분포를 만들지 않는다', () => {
    expect(ratingBarsOf(base({ rating: 4.8, reviewCount: 100 }))).toEqual([])
  })

  it('표본은 모든 칸을 채운다(부품 눈 확인용)', () => {
    const slots = inputSlotsOf(withSampleInputSlots(base()))
    expect(slots.notices.map((n) => n.kind)).toEqual(['caution', 'storage', 'care', 'care'])
    expect(slots.metrics).toHaveLength(2)
    expect(slots.ratingBars.map((b) => b.count)).toEqual([70, 20, 6, 3, 1])
    expect(slots.ratingBars[0].share).toBeCloseTo(0.7)
    expect(slots.ingredients).toEqual(['표본 재료 가', '표본 재료 나'])
    expect(slots.parts).toEqual(['표본 본체', '표본 받침'])
    expect(slots.usageSteps).toHaveLength(3)
    expect(slots.sizeMatrix?.rows).toHaveLength(2)
    expect(slots.layers).toHaveLength(2)
    expect(slots.swatches).toHaveLength(2)
    expect(slots.realPhotos).toHaveLength(1)
    expect(slots.productColor).toBe('#5A7D5A')
    // 표본 비교는 두 행 모두 기존이 있다(C5 ② 표본 (가) — D 비교 줄 눈 확인용, K 비교 칸은 0, 줄표는 시험으로)
    expect(slots.compareBasis.map((r) => r.other ?? null)).toEqual(['표본 350ml', '표본 320g'])
    expect(slots.compareSource).toBe('표본 출처입니다')
    expect(slots.schedule).toHaveLength(3)
  })

  it('제품 수치 칸이 없으면 크기 입력의 이름 붙은 값을 읽는다', () => {
    expect(inputSlotsOf(base({ size: '길이 7.3cm, 굵기 3.2cm' })).metrics.map((m) => m.name)).toEqual(['길이', '굵기'])
  })

  it('인증은 입력 글에서만 읽는다', () => {
    expect(inputSlotsOf(base({ certificationInfo: 'KC 인증; 특허 제1호' })).certifications).toEqual(['KC 인증', '특허 제1호'])
  })
})

describe('반쪽 값은 버린다', () => {
  it('사용 순서는 빈 단계가 있거나 한 단계뿐이면 통째로 없앤다', () => {
    expect(cleanUsageSteps([{ title: '하나' }])).toEqual([])
    expect(cleanUsageSteps([{ title: '하나' }, { title: ' ' }, { title: '셋' }])).toEqual([])
    expect(cleanUsageSteps([{ title: '하나' }, { title: '둘' }])).toHaveLength(2)
  })

  it('사이즈 표는 칸 수가 머리와 다른 행을 버린다', () => {
    const matrix = cleanSizeMatrix({ columns: ['어깨', '가슴'], rows: [{ label: 'S', values: ['40'] }, { label: 'M', values: ['42', '95'] }] })
    expect(matrix?.rows.map((row) => row.label)).toEqual(['M'])
    expect(cleanSizeMatrix({ columns: ['어깨'], rows: [{ label: 'S', values: ['40', '90'] }] })).toBeNull()
    expect(cleanSizeMatrix({ columns: [], rows: [] })).toBeNull()
  })

  it('층·칩은 둘 미만이면 없고 색값이 틀리면 뺀다', () => {
    expect(inputSlotsOf(base({ layers: [{ name: '한 층' }] })).layers).toEqual([])
    expect(inputSlotsOf(base({ swatches: [{ name: '가', hex: 'red' }, { name: '나', hex: '#112233' }] })).swatches).toEqual([])
  })

  it('상한을 넘는 글은 자르지 않고 버린다', () => {
    expect(cleanNoticeItems([{ kind: 'caution', text: '가'.repeat(INPUT_SLOT_LIMITS.notice.chars + 1) }])).toEqual([])
    expect(cleanUsageSteps([{ title: '하나' }, { title: '가'.repeat(INPUT_SLOT_LIMITS.step.title + 1) }])).toEqual([])
  })

  it('형식이 틀린 저장 값에도 던지지 않는다', () => {
    const broken = { noticeItems: 3, usageSteps: 3, sizeMatrix: '표', layers: {}, swatches: null, realPhotos: 'x', productMetrics: 1, productColor: 5 } as unknown as Partial<PdpSpecSheet>
    const slots = inputSlotsOf(base(broken))
    expect([slots.notices, slots.usageSteps, slots.layers, slots.swatches, slots.realPhotos, slots.metrics]).toEqual([[], [], [], [], [], []])
    expect([slots.sizeMatrix, slots.productColor]).toEqual([null, null])
  })

  it('실제 사진은 https 주소만 받는다', () => {
    const out = normalizeInputSlots(base({ realPhotos: [{ kind: 'origin', url: 'http://a.test/x.jpg' }, { kind: 'origin', url: 'javascript:alert(1)' }, { kind: 'origin', url: 'https://a.test/y.jpg' }] }))
    expect(out.realPhotos).toEqual([{ kind: 'origin', url: 'https://a.test/y.jpg' }])
  })
})

describe('규제 표현은 표와 같은 규칙으로 뺀다', () => {
  it('주의 줄·층 설명에서 뺀다', () => {
    const notices = inputSlotsOf(base({ noticeItems: [{ kind: 'caution', text: '무독성 소재입니다' }, { kind: 'storage', text: '서늘한 곳에 두세요' }] })).notices
    expect(notices).toEqual([{ kind: 'storage', text: '서늘한 곳에 두세요' }])
  })

  it('사용 순서는 한 단계라도 걸리면 통째로 없앤다', () => {
    const steps = [{ title: '바르기' }, { title: '무독성 확인하기' }]
    expect(inputSlotsOf(base({ usageSteps: steps })).usageSteps).toEqual([])
  })
})

describe('저장·프롬프트', () => {
  it('칸이 없으면 같은 객체다(저장 바이트 불변)', () => {
    const spec = base()
    expect(normalizeInputSlots(spec)).toBe(spec)
    expect(normalizeSpecInputs(spec)).toBe(spec)
  })

  it('잡 생성 정리가 칸을 정리하고 빈 결과는 키를 지운다', () => {
    const out = normalizeSpecInputs(base({ weight: ' 120g ', usageSteps: [{ title: '하나' }], productColor: 'red', layers: INPUT_SLOT_SAMPLE.layers }))
    expect(out.weight).toBe('120g')
    expect(out).not.toHaveProperty('usageSteps')
    expect(out).not.toHaveProperty('productColor')
    expect(out.layers).toEqual(INPUT_SLOT_SAMPLE.layers)
  })

  it('입력 칸만 있는 spec도 정리한다', () => {
    expect(normalizeSpecInputs(base({ usageSteps: [{ title: '하나' }] }))).not.toHaveProperty('usageSteps')
  })

  it('값이 있어도 프롬프트 스펙 JSON은 그대로다(R 라인·앞 단계 불변)', () => {
    const spec = base({ material: '면' })
    expect(specSheetPromptJson({ ...spec, ...INPUT_SLOT_SAMPLE })).toBe(specSheetPromptJson(spec))
  })
})

describe('화면 글 ↔ 값', () => {
  it.each([
    ['주의', parseNoticeLines, formatNoticeLines, '주의: 표본 주의\n보관: 표본 보관\n관리: 표본 관리'],
    ['수치', parseMetricLines, formatMetricLines, '길이: 7.3cm\n무게: 120g'],
    ['순서', parseStepLines, formatStepLines, '담기 | 그릇에 담아요\n놓기'],
    ['층', parseLayerLines, formatLayerLines, '겉감 | 표본 설명\n안감'],
    ['칩', parseSwatchLines, formatSwatchLines, '초록: #5A7D5A\n베이지: #D9C7A7'],
    ['사진', parsePhotoLines, formatPhotoLines, '산지: https://a.test/y.jpg | 표본 설명\n제조: https://a.test/z.jpg'],
  ] as Array<[string, (raw: string) => unknown, (value: never) => string, string]>)('%s 줄이 그대로 돌아온다', (_name, parse, format, raw) => {
    expect(format(parse(raw) as never)).toBe(raw)
  })

  it('사이즈 표 줄이 그대로 돌아온다', () => {
    const raw = '사이즈, 어깨, 가슴\nS, 40, 90\nM, 42, 95'
    expect(formatMatrixLines(parseMatrixLines(raw) ?? undefined)).toBe(raw)
    expect(parseMatrixLines('사이즈')).toBeNull()
  })

  it('앞말 없는 주의 줄은 주의, 형식이 틀린 수치 줄은 버린다', () => {
    expect(parseNoticeLines('그냥 쓴 글')).toEqual([{ kind: 'caution', text: '그냥 쓴 글' }])
    expect(parseMetricLines('큼직함: 아주 큼')).toEqual([])
  })
})

describe('입력 미결 오너 답(2026-11-02)', () => {
  it('P07 높이 조절은 불가', () => {
    const rows = getPdpTestProduct('P07').specSheet.extraSpecs ?? []
    expect(rows.find((row) => row.key === '높이 조절')?.value).toBe('불가')
  })

  it('P08 포장은 비워 두고 짓지 않는다', () => {
    const { specSheet } = getPdpTestProduct('P08')
    expect(JSON.stringify(specSheet)).not.toMatch(/포장|한 통|봉지|박스|케이스/)
  })

  it('P05 크기는 오너 11-05 확인대로 펼쳤을 때 가로·세로다 — 수치는 그대로, 미확인 표시는 풀었다', () => {
    const product = getPdpTestProduct('P05')
    expect(product.specSheet.size).toBe('펼쳤을 때 가로 1cm x 세로 9.6cm')
    expect(product.unconfirmed).toBeUndefined()
  })
})
