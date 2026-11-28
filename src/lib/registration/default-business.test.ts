/**
 * 등록 준비 드로어의 등록 대상 사업장 기본값 — 옛 코드는 선택 중인 사업장을 무시하고 늘 기본 사업장(isDefault)을 골랐다
 * (01_REVIEW §4, RegistrationPrepDrawer.tsx:86).
 */

import { describe, expect, it } from 'vitest'
import { pickRegistrationBusinessId } from './default-business'

const owned = [
  { id: 'biz-default', isDefault: true },
  { id: 'biz-b', isDefault: false },
]

describe('pickRegistrationBusinessId', () => {
  it('초안에 저장된 사업장이 가장 먼저다', () => {
    expect(pickRegistrationBusinessId('biz-b', 'biz-default', owned)).toBe('biz-b')
  })

  it('새 초안은 화면에서 선택 중인 사업장을 쓴다', () => {
    expect(pickRegistrationBusinessId(null, 'biz-b', owned)).toBe('biz-b')
  })

  it('선택 중인 사업장이 오너 소유 목록에 없으면 기본 사업장', () => {
    expect(pickRegistrationBusinessId(null, 'biz-foreign', owned)).toBe('biz-default')
    expect(pickRegistrationBusinessId(undefined, null, owned)).toBe('biz-default')
  })

  it('기본 표시가 없으면 첫 사업장, 사업장이 없으면 null', () => {
    expect(pickRegistrationBusinessId(null, null, [{ id: 'only', isDefault: false }])).toBe('only')
    expect(pickRegistrationBusinessId(null, 'x', [])).toBeNull()
  })
})
