import { describe, expect, it } from 'vitest'
import { CLAIM_RESTRICTED_TYPES, classifyObjection } from './objection-types'

describe('고민 유형 분류', () => {
  // 실측 고민 — 기준 잡 A(폭죽)·B(스티커)·C(구디백)의 analysis.objection_priority(Track I·S)
  it.each([
    ['사용 후 뒷정리가 복잡하지 않을까?', 'usage_care'],
    ['뒷정리가 번거롭지 않을까?', 'usage_care'],
    ['실내에서 사용해도 괜찮을까?', 'environment_versatility'],
    ['안전성은 확보되어 있나?', 'safety_cert'],
    ['10개가 정말 충분할까?', 'quantity_size'],
    ['단일 디자인으로 다양한 상황에 대응 가능한가', 'environment_versatility'],
    ['종이 스티커의 접착력과 내구성이 충분한가', 'quality_durability'],
    ['종이 스티커의 실제 접착력과 내구성은 어느 정도인가?', 'quality_durability'],
    ['50매가 실제로 충분한 수량인가', 'quantity_size'],
    ['PE 소재의 일회용 특성으로 환경 우려', 'material_eco'],
    ['일회용 포장재로 환경 친화성 부족', 'material_eco'],
    ['PE 소재의 재사용 불가능성', 'material_eco'],
    ['소량 구매 시 단가 경쟁력', 'price_value'],
    ['습기 민감 상품 보관 제한', 'usage_care'],
  ])('실측: %s → %s', (text, type) => {
    expect(classifyObjection(text)).toBe(type)
  })

  it.each([
    ['아이 피부에 자극은 없을까?', 'safety_cert'],
    ['플라스틱이라 재활용이 될까?', 'material_eco'],
    ['세척은 어떻게 하나요?', 'usage_care'],
    ['금방 찢어지지 않을까?', 'quality_durability'],
    ['사이즈가 우리 집 강아지에게 맞을까?', 'quantity_size'],
    ['가격 대비 가성비가 괜찮을까?', 'price_value'],
    ['야외 캠핑에서도 쓸 수 있나?', 'environment_versatility'],
    ['다양한 환경에서 사용 가능한가', 'environment_versatility'],
    ['사용 환경이 제한되지 않을까', 'environment_versatility'],
    ['환경 오염이 걱정된다', 'material_eco'],
    ['배송이 빠른가요?', 'other'],
    ['', 'other'],
  ])('합성: %s → %s', (text, type) => {
    expect(classifyObjection(text)).toBe(type)
  })

  it('안전·소재는 사실 주장 금지 유형', () => {
    expect([...CLAIM_RESTRICTED_TYPES].sort()).toEqual(['material_eco', 'safety_cert'])
  })
})
