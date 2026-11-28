import { describe, expect, it } from 'vitest'
import {
  classifyOptionLabel,
  isOptionSpec,
  parseOptionLabels,
  primaryFormAxis,
  toColorOptions,
  validateOptionSpec,
  type OptionSpec,
} from './option-spec'
import { FAIRNEX_OPTION_LABELS } from './__fixtures__/fairnex-option-labels'

const axesOf = (spec: OptionSpec) => spec.axes.map((a) => [a.name, a.values])

describe('parseOptionLabels — 페어넥스 실제 옵션명', () => {
  it('P01 스티커: 수량 × 디자인', () => {
    const { spec, warnings, fallback } = parseOptionLabels(FAIRNEX_OPTION_LABELS.P01)
    expect(axesOf(spec)).toEqual([
      ['수량', ['20개', '30개', '50개']],
      ['디자인', ['생일답례-01', '생일답례-02', '생일답례-03', '생일답례-04', '생일답례-05', '생일답례-07']],
    ])
    expect(spec.variants).toHaveLength(13)
    expect(spec.variants[0].label).toBe('20개 생일답례-01')
    expect(warnings).toEqual([])
    expect(fallback).toBe(false)
    expect(spec.source).toBe('products')
  })

  it('P02 구디백: 디자인·사이즈 결합(수량 고정은 축 아님)', () => {
    const { spec, warnings } = parseOptionLabels(FAIRNEX_OPTION_LABELS.P02)
    expect(axesOf(spec)).toEqual([
      ['디자인', ['데이지', '체리']],
      ['사이즈', ['S', 'L']],
    ])
    expect(spec.variants[0]).toEqual({ label: '20개 데이지(S)', values: { quantity: '20개', design: '데이지', size: 'S' } })
    expect(warnings).toEqual([])
  })

  it('P05 돈모 브러쉬: 수량', () => {
    const { spec } = parseOptionLabels(FAIRNEX_OPTION_LABELS.P05)
    expect(axesOf(spec)).toEqual([['수량', ['2개', '4개']]])
    expect(spec.variants.every((v) => v.values.color === '브라운')).toBe(true)
  })

  it('P10 무릎 보호대: 수량 + 표기만 다른 중복 조합 경고', () => {
    const { spec, warnings, fallback } = parseOptionLabels(FAIRNEX_OPTION_LABELS.P10)
    expect(axesOf(spec)).toEqual([['수량', ['1개', '2개', '3개', '4개', '5개', '6개']]])
    expect(spec.variants).toHaveLength(7)
    expect(fallback).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe('duplicate_combination')
    expect([...warnings[0].labels].sort()).toEqual(['1개 Free 검정', '1개 검정 Free'].sort())
  })

  it('보습양말: 수량 × 색상(합성 수량·수식어 색)', () => {
    const { spec } = parseOptionLabels(FAIRNEX_OPTION_LABELS.socks)
    expect(axesOf(spec)).toEqual([
      ['수량', ['2개 2매입', '4개 2매입']],
      ['색상', ['딥 블랙', '스킨 베이지']],
    ])
  })

  it('쿨토시: 괄호 안 수량은 고정, 디자인 축', () => {
    const { spec } = parseOptionLabels(FAIRNEX_OPTION_LABELS.coolSleeve)
    expect(axesOf(spec)).toEqual([['디자인', ['손등-블랙', '손등-스킨', '손목-블랙']]])
    expect(spec.variants.every((v) => v.values.quantity === '2p 4셋트')).toBe(true)
  })

  it('세안 밴드: 축 불일치 → 단일 디자인 축 fallback', () => {
    const { spec, warnings, fallback } = parseOptionLabels(FAIRNEX_OPTION_LABELS.faceBand)
    expect(fallback).toBe(true)
    expect(axesOf(spec)).toEqual([['디자인', ['6개 러블리핑크', '6개 혼합 3종']]])
    expect(spec.variants.map((v) => v.values)).toEqual([{ design: '6개 러블리핑크' }, { design: '6개 혼합 3종' }])
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent_axis'])
  })

  it('넥워머: 색상(수식어 + 기본색)', () => {
    expect(axesOf(parseOptionLabels(FAIRNEX_OPTION_LABELS.neckWarmer).spec)).toEqual([
      ['색상', ['라이트 크림', '오가닉 블랙']],
    ])
  })

  it('경보기: 뒤쪽 수량도 수량 축', () => {
    expect(axesOf(parseOptionLabels(FAIRNEX_OPTION_LABELS.alarm).spec)).toEqual([['수량', ['1개', '2개', '3개']]])
  })
})

describe('parseOptionLabels — 경계 사례', () => {
  it('단일 옵션은 축이 없다', () => {
    const { spec, warnings } = parseOptionLabels(['1개 세이지 그린'])
    expect(spec.axes).toEqual([])
    expect(spec.variants).toEqual([{ label: '1개 세이지 그린', values: { quantity: '1개', color: '세이지 그린' } }])
    expect(warnings).toEqual([])
  })

  it('같은 문자열은 합치고 빈 값은 무시한다', () => {
    const { spec, warnings } = parseOptionLabels(['20개 체리(L)', '20개 체리(L)', '', '  '])
    expect(spec.variants).toHaveLength(1)
    expect(warnings).toEqual([{ code: 'duplicate_label', labels: ['20개 체리(L)'] }])
  })

  it('빈 입력', () => {
    const { spec, warnings, fallback } = parseOptionLabels([])
    expect(spec).toEqual({ axes: [], variants: [], source: 'products' })
    expect(warnings).toEqual([{ code: 'empty', labels: [] }])
    expect(fallback).toBe(false)
  })

  it('세 축이 변하면 fallback', () => {
    const { warnings, fallback, spec } = parseOptionLabels(['1개 블랙 S', '2개 화이트 M'])
    expect(fallback).toBe(true)
    expect(warnings[0].code).toBe('too_many_axes')
    expect(spec.axes).toHaveLength(1)
  })

  it('label은 입력 문자열 그대로(정규화 금지)', () => {
    const labels = [' 20개  데이지(S)', '20개 체리(L) ']
    const { spec } = parseOptionLabels(labels, 'manual')
    expect(spec.variants.map((v) => v.label).sort()).toEqual([...labels].sort())
    expect(spec.source).toBe('manual')
  })

  it('결정론: 같은 입력 2회·순서 뒤집기 → 같은 결과', () => {
    const a = parseOptionLabels(FAIRNEX_OPTION_LABELS.P01)
    const b = parseOptionLabels(FAIRNEX_OPTION_LABELS.P01)
    const c = parseOptionLabels([...FAIRNEX_OPTION_LABELS.P01].reverse())
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })
})

describe('classifyOptionLabel', () => {
  it.each([
    ['챠콜그레이 1개 3cm x 1m', { color: '챠콜그레이', quantity: '1개', size: '3cm x 1m' }],
    ['1개 블랙 11.5 x 10cm', { quantity: '1개', color: '블랙', size: '11.5 x 10cm' }],
    ['FREE(지름 12cm) 1개 블랙', { size: 'FREE(지름 12cm)', quantity: '1개', color: '블랙' }],
    ['블랙 L-XL', { color: '블랙', size: 'L-XL' }],
    ['10개 베이지 스킨 Free', { quantity: '10개', color: '베이지 스킨', size: 'Free' }],
    ['2개 블랙+라벤더', { quantity: '2개', color: '블랙+라벤더' }],
    ['1세트 올리브 그린', { quantity: '1세트', color: '올리브 그린' }],
    ['1개 3m', { quantity: '1개', size: '3m' }],
    ['반투명 2개', { color: '반투명', quantity: '2개' }],
    ['1개 우드', { quantity: '1개', design: '우드' }],
    ['300개', { quantity: '300개' }],
    ['블랙', { color: '블랙' }],
    ['FREE 2개 블랙', { size: 'FREE', quantity: '2개', color: '블랙' }],
    ['손등-블랙(2p 4셋트)', { design: '손등-블랙', quantity: '2p 4셋트' }],
    ['20개 데이지(S)', { quantity: '20개', design: '데이지', size: 'S' }],
    ['딥 시크', { design: '딥 시크' }],
    // 검수 반영(2026-10-27): 치수 뒤 괄호, 한글에 붙은 치수, 띄어 쓴 연결 기호·수량, 괄호 안 색
    ['30cm(대형)', { size: '30cm(대형)' }],
    ['11.5 x 10cm(가로)', { size: '11.5 x 10cm(가로)' }],
    ['1개 지름12cm', { quantity: '1개', size: '지름12cm' }],
    ['블랙(지름12cm)', { color: '블랙', size: '지름12cm' }],
    ['블랙(지름 12cm)', { color: '블랙', size: '지름 12cm' }],
    ['블랙 + 화이트', { color: '블랙 + 화이트' }],
    ['블랙 - L', { color: '블랙', size: 'L' }],
    ['블랙-화이트', { color: '블랙-화이트' }],
    ['20 개 블랙', { quantity: '20 개', color: '블랙' }],
    ['20개(블랙)', { quantity: '20개', color: '블랙' }],
    ['XL2개', { design: 'XL2개' }],
  ])('%s', (label, expected) => {
    expect(classifyOptionLabel(label)).toEqual(expected)
  })

  it.each(['아이스크림', '스킨케어', '와인잔', '그린티', 'Bluetooth', '골드스타'])(
    '색 이름이 단어 안에만 있으면 색이 아니다: %s',
    (label) => {
      expect(classifyOptionLabel(label)).toEqual({ design: label })
    },
  )

  it.each(['피치핑크', '챠콜그레이', '반투명', '라이트크림', '스킨베이지', '하늘색', 'Navy'])(
    '합성 색 이름은 색이다: %s',
    (label) => {
      expect(classifyOptionLabel(label)).toEqual({ color: label })
    },
  )
})

describe('parseOptionLabels — 검수 반영 경계', () => {
  it('변하는 축이 없는 서로 다른 라벨도 중복 조합 경고', () => {
    const { spec, warnings } = parseOptionLabels(['1개 검정 Free', '1개 Free 검정'])
    expect(spec.axes).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['duplicate_combination'])
  })

  it('자연 정렬이 같다고 보는 값도 입력 순서와 무관하게 정렬', () => {
    const labels = ['20개 꽃-1', '20개 꽃-01', '50개 꽃-1', '50개 꽃-01']
    expect(parseOptionLabels([...labels].reverse()).spec).toEqual(parseOptionLabels(labels).spec)
  })

  it('수량은 글자 순서가 아니라 숫자 순서', () => {
    expect(parseOptionLabels(['10개 블랙', '2개 블랙', '100개 블랙']).spec.axes[0].values).toEqual(['2개', '10개', '100개'])
  })

  it('사이즈 순위: 문자 사이즈 → 범위 → 기타 → FREE', () => {
    const { spec } = parseOptionLabels(['블랙 FREE', '블랙 XL', '블랙 S', '블랙 L-XL', '블랙 M'])
    expect(spec.axes).toEqual([{ kind: 'size', name: '사이즈', values: ['S', 'M', 'L-XL', 'XL', 'FREE'] }])
  })
})

describe('조회·호환·검사', () => {
  it('primaryFormAxis: design > color > size, 형태 축 없으면 null', () => {
    expect(primaryFormAxis(parseOptionLabels(FAIRNEX_OPTION_LABELS.P01).spec)?.kind).toBe('design')
    expect(primaryFormAxis(parseOptionLabels(FAIRNEX_OPTION_LABELS.P02).spec)?.kind).toBe('design')
    expect(primaryFormAxis(parseOptionLabels(FAIRNEX_OPTION_LABELS.socks).spec)?.kind).toBe('color')
    expect(primaryFormAxis(parseOptionLabels(FAIRNEX_OPTION_LABELS.P05).spec)).toBeNull()
  })

  it('toColorOptions: variant label 목록 그대로', () => {
    const { spec } = parseOptionLabels(FAIRNEX_OPTION_LABELS.P02)
    expect(toColorOptions(spec)).toEqual(['20개 데이지(S)', '20개 체리(L)'])
  })

  it('isOptionSpec: 정상·깨진 객체', () => {
    const { spec } = parseOptionLabels(FAIRNEX_OPTION_LABELS.P01)
    expect(isOptionSpec(spec)).toBe(true)
    expect(isOptionSpec(JSON.parse(JSON.stringify(spec)))).toBe(true)
    expect(isOptionSpec(null)).toBe(false)
    expect(isOptionSpec({ ...spec, source: 'llm' })).toBe(false)
    expect(isOptionSpec({ ...spec, axes: [{ kind: 'price', name: '가격', values: [] }] })).toBe(false)
    expect(isOptionSpec({ ...spec, variants: [{ label: 3, values: {} }] })).toBe(false)
    expect(isOptionSpec({ ...spec, variants: [{ label: 'a', values: { design: 1 } }] })).toBe(false)
  })

  it('validateOptionSpec: 디자인 축은 실물 사진 필수', () => {
    const { spec } = parseOptionLabels(FAIRNEX_OPTION_LABELS.P01)
    const issues = validateOptionSpec(spec)
    expect(issues).toHaveLength(13)
    expect(issues.every((i) => i.code === 'missing_source_image')).toBe(true)
    const withImages: OptionSpec = {
      ...spec,
      variants: spec.variants.map((v) => ({ ...v, sourceImage: `products/p01/${v.values.design}.jpg` })),
    }
    expect(validateOptionSpec(withImages)).toEqual([])
  })

  it('validateOptionSpec: 수량 축만이면 사진 불필요, 값 누락·모르는 값·중복 검출', () => {
    const { spec } = parseOptionLabels(FAIRNEX_OPTION_LABELS.P05)
    expect(validateOptionSpec(spec)).toEqual([])
    expect(validateOptionSpec({ ...spec, axes: [spec.axes[0], spec.axes[0], spec.axes[0]] })[0].code).toBe('too_many_axes')
    const broken: OptionSpec = {
      ...spec,
      axes: [...spec.axes, { kind: 'size', name: '사이즈', values: [] }],
      variants: [
        { label: '2개 브라운', values: { quantity: '2개' } },
        { label: '2개 브라운', values: { quantity: '8개', size: 'S' } },
      ],
    }
    expect(validateOptionSpec(broken).map((i) => i.code)).toEqual([
      'empty_axis',
      'missing_axis_value',
      'duplicate_label',
      'unknown_axis_value',
      'unknown_axis_value',
    ])
  })
})
