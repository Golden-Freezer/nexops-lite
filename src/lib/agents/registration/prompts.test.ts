import { describe, expect, it } from 'vitest'
import { getWingMapperPrompt } from './prompts'

describe('getWingMapperPrompt', () => {
  it('단일 SKU 가격·재고를 추정하거나 옵션명을 만들지 않도록 제한한다', () => {
    const { system, user } = getWingMapperPrompt({
      fields: [
        { ref: 'w1', kind: 'text', label: '제조자' },
        {
          ref: 'r2',
          kind: 'radio',
          label: '과세 유형',
          options: ['과세', '면세'],
        },
      ],
      product: {
        productName: '테스트 상품',
        salePrice: 19900,
        options: [],
      },
    })

    expect(system).toContain('options가 빈 배열이면 단일 SKU')
    expect(system).toContain('옵션명·옵션값을 임의로 만들지 마세요')
    expect(system).toContain('정상가·판매가·재고 입력은 브라우저가 별도 처리')
    expect(system).toContain(
      '상품 정보에 없는 숫자는 추정하거나 기본값을 만들지 않습니다',
    )
    expect(system).toContain(
      'value가 반드시 그 필드의 options 중 하나와 정확히 일치',
    )

    const payload = JSON.parse(user)
    expect(payload.product).toMatchObject({
      productName: '테스트 상품',
      salePrice: 19900,
      options: [],
    })
    expect(payload.fields).toHaveLength(2)
  })
})
