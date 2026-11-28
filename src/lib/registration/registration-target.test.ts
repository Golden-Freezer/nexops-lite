import { describe, expect, it } from 'vitest'
import { emptyForm } from '@/lib/sourcing/registration/form'
import {
  GUARDED_MESSAGE_TYPE,
  LEGACY_MESSAGE_TYPE,
  buildWingHandoff,
  compareWingAccount,
  evaluateHandoffStart,
  interpretGuardedHandoffResponse,
  isAccountGuardOn,
  normalizeVendorId,
  resolveRegistrationTarget,
} from './registration-target'

const owned = [
  { id: 'b-default', name: '기본 사업장', coupangVendorId: 'A0001', isDefault: true },
  { id: 'b-two', name: '둘째 사업장', coupangVendorId: ' a0002 ', isDefault: false },
  { id: 'b-novendor', name: '벤더 없음', coupangVendorId: null, isDefault: false },
]

describe('isAccountGuardOn', () => {
  it('on 일 때만 켜진다(공백·대소문자 무시)', () => {
    expect(isAccountGuardOn({ REGISTRATION_ACCOUNT_GUARD: 'on' })).toBe(true)
    expect(isAccountGuardOn({ REGISTRATION_ACCOUNT_GUARD: ' ON ' })).toBe(true)
    expect(isAccountGuardOn({ REGISTRATION_ACCOUNT_GUARD: 'off' })).toBe(false)
    expect(isAccountGuardOn({ REGISTRATION_ACCOUNT_GUARD: '1' })).toBe(false)
    expect(isAccountGuardOn({})).toBe(false)
  })
})

describe('normalizeVendorId', () => {
  it('공백을 떼고 대문자로 — 숫자도 문자열로', () => {
    expect(normalizeVendorId(' a0000 ')).toBe('A0000')
    expect(normalizeVendorId('A0000')).toBe('A0000')
    expect(normalizeVendorId(12345)).toBe('12345')
  })
  it('빈 값·다른 형은 null', () => {
    expect(normalizeVendorId('')).toBeNull()
    expect(normalizeVendorId('   ')).toBeNull()
    expect(normalizeVendorId(null)).toBeNull()
    expect(normalizeVendorId(undefined)).toBeNull()
    expect(normalizeVendorId({})).toBeNull()
  })
})

describe('resolveRegistrationTarget', () => {
  it('초안 사업장이 없으면 기본 사업장이 있어도 no-business', () => {
    expect(resolveRegistrationTarget({ draftBusinessId: null, owned })).toEqual({ ok: false, reason: 'no-business' })
    expect(resolveRegistrationTarget({ draftBusinessId: undefined, owned })).toEqual({ ok: false, reason: 'no-business' })
  })
  it('내 목록에 없으면 not-owned', () => {
    expect(resolveRegistrationTarget({ draftBusinessId: 'b-other', owned })).toEqual({ ok: false, reason: 'not-owned' })
  })
  it('벤더코드가 없으면 no-vendor', () => {
    expect(resolveRegistrationTarget({ draftBusinessId: 'b-novendor', owned })).toEqual({ ok: false, reason: 'no-vendor' })
  })
  it('성공 — 사업장 이름과 정규화된 판매자 계정', () => {
    expect(resolveRegistrationTarget({ draftBusinessId: 'b-two', owned })).toEqual({
      ok: true,
      businessId: 'b-two',
      businessName: '둘째 사업장',
      vendorId: 'A0002',
    })
  })
})

describe('compareWingAccount', () => {
  it('같으면 ok — 대소문자·공백 차이는 무시', () => {
    expect(compareWingAccount('A0000', 'A0000')).toBe('ok')
    expect(compareWingAccount('A0000', ' a0000 ')).toBe('ok')
  })
  it('다르면 mismatch', () => {
    expect(compareWingAccount('A0000', 'A0001')).toBe('mismatch')
  })
  it('어느 쪽이든 못 읽으면 unknown', () => {
    expect(compareWingAccount('A0000', null)).toBe('unknown')
    expect(compareWingAccount('A0000', '')).toBe('unknown')
    expect(compareWingAccount(undefined, 'A0000')).toBe('unknown')
    expect(compareWingAccount(null, null)).toBe('unknown')
  })
})

describe('evaluateHandoffStart', () => {
  const base = { draftId: 'd1', savedBusinessId: 'b-two', currentBusinessId: 'b-two', owned }
  it('저장된 초안이 없으면 멈춘다', () => {
    expect(evaluateHandoffStart({ ...base, draftId: null }).ok).toBe(false)
  })
  it('화면에서 사업장을 바꾼 뒤 저장 안 했으면 멈춘다', () => {
    const r = evaluateHandoffStart({ ...base, currentBusinessId: 'b-default' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('저장')
  })
  it('저장된 사업장이 없으면(기본 사업장이 있어도) 멈춘다', () => {
    expect(evaluateHandoffStart({ ...base, savedBusinessId: null, currentBusinessId: null }).ok).toBe(false)
  })
  it('벤더코드 없음도 까닭과 함께 멈춘다', () => {
    const r = evaluateHandoffStart({ ...base, savedBusinessId: 'b-novendor', currentBusinessId: 'b-novendor' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('벤더코드')
  })
  it('통과하면 대상을 돌려준다', () => {
    const r = evaluateHandoffStart(base)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.target.vendorId).toBe('A0002')
  })
})

describe('buildWingHandoff', () => {
  const form = {
    ...emptyForm(),
    productName: '시험 상품',
    brand: '시험 브랜드',
    salePrice: 10000,
    originalPrice: 20000,
    categoryPath: '가전 > 주방 > 컵',
    displayCategoryCode: 123,
    searchTags: ['a', 'b'],
    barcode: '8800000000000',
    memo: '메모',
    content: { ...emptyForm().content, heroImages: ['https://example.com/h.jpg'], detailHtml: '<p>x</p>' },
  }
  const target = { ok: true as const, businessId: 'b-two', businessName: '둘째 사업장', vendorId: 'A0002' }

  it('사업장·판매자 계정 ID 가 target 으로 들어간다', () => {
    expect(buildWingHandoff(form, target).target).toEqual({
      businessId: 'b-two',
      businessName: '둘째 사업장',
      expectedVendorId: 'A0002',
      guardVersion: 1,
    })
  })
  it('기존 product 칸과 카테고리 칸은 지금 드로어가 보내던 그대로', () => {
    const h = buildWingHandoff(form, target)
    expect(h.categoryName).toBe('컵')
    expect(h.displayCategoryCode).toBe(123)
    expect(h.product).toEqual({
      productName: '시험 상품',
      brand: '시험 브랜드',
      salePrice: 10000,
      originalPrice: 20000,
      categoryPath: '가전 > 주방 > 컵',
      displayCategoryCode: 123,
      searchTags: ['a', 'b'],
      barcode: '8800000000000',
      heroImageUrl: 'https://example.com/h.jpg',
      detailHtml: '<p>x</p>',
      notice: form.notice,
      options: form.options,
      memo: '메모',
    })
  })
  it('카테고리 경로·대표이미지가 없으면 null', () => {
    const h = buildWingHandoff({ ...emptyForm() }, target)
    expect(h.categoryName).toBeNull()
    expect(h.product.heroImageUrl).toBeNull()
  })
})

describe('interpretGuardedHandoffResponse — 옛 확장에서 가드가 조용히 빠지지 않는다', () => {
  it('guard: 1 인 ok 만 통과', () => {
    expect(interpretGuardedHandoffResponse({ ok: true, guard: 1 })).toEqual({ ok: true })
  })
  it('응답 없음 → 멈춤(확장 업데이트 안내)', () => {
    for (const res of [undefined, null, 'x']) {
      const r = interpretGuardedHandoffResponse(res)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message).toContain('확장을 업데이트')
    }
  })
  it('ok 만 있고 guard 가 없거나 다른 값이면 멈춤', () => {
    for (const res of [{ ok: true }, { ok: true, guard: 0 }, { ok: true, guard: 2 }]) {
      const r = interpretGuardedHandoffResponse(res)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message).toContain('확장을 업데이트')
    }
  })
  it('확장이 거절하면 멈춤', () => {
    expect(interpretGuardedHandoffResponse({ ok: false, reason: 'no-target' }).ok).toBe(false)
    expect(interpretGuardedHandoffResponse({ ok: false, error: 'x' }).ok).toBe(false)
  })
})

describe('메시지 이름', () => {
  it('가드용은 옛 이름과 다르다', () => {
    expect(GUARDED_MESSAGE_TYPE).toBe('NEXOPS_REG_OPEN_SPLIT_GUARDED')
    expect(LEGACY_MESSAGE_TYPE).toBe('NEXOPS_REG_OPEN_SPLIT')
  })
})
