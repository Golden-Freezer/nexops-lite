import { describe, expect, it } from 'vitest'
import { parseOptionLabels, type OptionSpec } from './option-spec'
import { buildRegistrationOptionExport } from './registration-export'
import { FAIRNEX_OPTION_LABELS } from './__fixtures__/fairnex-option-labels'

const exportOf = (labels: readonly string[]) => buildRegistrationOptionExport(parseOptionLabels(labels).spec)

describe('buildRegistrationOptionExport — 실 테스트 상품 옵션', () => {
  it('P01 스티커: 수량 × 디자인 13개', () => {
    const designs = ['생일답례-01', '생일답례-02', '생일답례-03', '생일답례-04', '생일답례-05', '생일답례-07']
    const item = (qty: string, design: string) => ({
      itemName: `${qty} ${design}`,
      attributes: { 수량: qty, 디자인: design },
      detailShared: true,
    })
    expect(exportOf(FAIRNEX_OPTION_LABELS.P01)).toEqual({
      axes: [
        { name: '수량', values: ['20개', '30개', '50개'] },
        { name: '디자인', values: designs },
      ],
      items: [
        ...designs.map((d) => item('20개', d)),
        item('30개', '생일답례-04'),
        ...designs.map((d) => item('50개', d)),
      ],
    })
  })

  it('P02 구디백: 디자인·사이즈', () => {
    expect(exportOf(FAIRNEX_OPTION_LABELS.P02)).toEqual({
      axes: [
        { name: '디자인', values: ['데이지', '체리'] },
        { name: '사이즈', values: ['S', 'L'] },
      ],
      items: [
        { itemName: '20개 데이지(S)', attributes: { 디자인: '데이지', 사이즈: 'S' }, detailShared: true },
        { itemName: '20개 체리(L)', attributes: { 디자인: '체리', 사이즈: 'L' }, detailShared: true },
      ],
    })
  })

  it('P05 돈모 브러쉬: 수량', () => {
    expect(exportOf(FAIRNEX_OPTION_LABELS.P05)).toEqual({
      axes: [{ name: '수량', values: ['2개', '4개'] }],
      items: [
        { itemName: '2개 브라운', attributes: { 수량: '2개' }, detailShared: true },
        { itemName: '4개 브라운', attributes: { 수량: '4개' }, detailShared: true },
      ],
    })
  })

  it('P10 무릎 보호대: 수량(표기 중복 옵션도 각각 등록값 그대로)', () => {
    const result = exportOf(FAIRNEX_OPTION_LABELS.P10)
    expect(result.axes).toEqual([{ name: '수량', values: ['1개', '2개', '3개', '4개', '5개', '6개'] }])
    expect(result.items).toHaveLength(7)
    expect(result.items.map((i) => i.itemName).sort()).toEqual([...FAIRNEX_OPTION_LABELS.P10].sort())
    expect(result.items.filter((i) => i.attributes.수량 === '1개')).toHaveLength(2)
  })
})

describe('buildRegistrationOptionExport — 이미지·불변', () => {
  const base = parseOptionLabels(FAIRNEX_OPTION_LABELS.P02).spec
  const withSource: OptionSpec = {
    ...base,
    variants: base.variants.map((v) => ({ ...v, sourceImage: `src/${v.values.design}.jpg` })),
  }

  it('대표 이미지: 지정 맵 → sourceImage 순서', () => {
    const result = buildRegistrationOptionExport(withSource, {
      representationImages: { '20개 체리(L)': 'thumb/cherry.png' },
    })
    expect(result.items.map((i) => i.representationImage)).toEqual(['src/데이지.jpg', 'thumb/cherry.png'])
  })

  it('지정 맵의 빈 문자열은 없는 값으로 보고 sourceImage를 쓴다', () => {
    const result = buildRegistrationOptionExport(withSource, { representationImages: { '20개 데이지(S)': '' } })
    expect(result.items[0].representationImage).toBe('src/데이지.jpg')
  })

  it('이미지가 없으면 키 자체를 넣지 않는다', () => {
    const result = buildRegistrationOptionExport(base)
    expect(result.items.every((i) => !('representationImage' in i))).toBe(true)
  })

  it('가격·재고·바코드 없음, 모든 옵션 detailShared', () => {
    const result = buildRegistrationOptionExport(withSource)
    const json = JSON.stringify(result)
    for (const banned of ['price', 'stock', 'barcode', '가격']) expect(json).not.toContain(banned)
    expect(result.items.every((i) => i.detailShared === true)).toBe(true)
  })

  it('입력 spec을 변경하지 않는다', () => {
    const snapshot = JSON.stringify(withSource)
    const result = buildRegistrationOptionExport(withSource)
    result.axes[0].values.push('변경')
    expect(JSON.stringify(withSource)).toBe(snapshot)
  })

  it('단일 옵션은 축 없이 항목 1개', () => {
    expect(exportOf(['1개 세이지 그린'])).toEqual({
      axes: [],
      items: [{ itemName: '1개 세이지 그린', attributes: {}, detailShared: true }],
    })
  })
})
