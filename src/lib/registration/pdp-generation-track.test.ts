/**
 * 생성 트랙(결정 T-1) 단위 테스트 — 화이트리스트·컬럼 SSOT(DDL 20260811210000)·레거시 JSONB 폴백·
 * spec_sheet 키 제거(프롬프트 오염 방지) 계약. POST 라우트의 400 분기는 isGenerationTrack이 SSOT다.
 */

import { describe, it, expect } from 'vitest'
import {
  GENERATION_TRACKS,
  isGenerationTrack,
  resolveGenerationTrack,
  stripGenerationTrackKey,
  type PdpSpecSheet,
} from './pdp-state'

function spec(overrides: Partial<PdpSpecSheet> = {}): PdpSpecSheet {
  return { productName: '테스트 상품', ...overrides }
}

describe('isGenerationTrack — 화이트리스트(2값 외 전부 거부)', () => {
  it('standard·internalized만 유효하다', () => {
    expect(isGenerationTrack('standard')).toBe(true)
    expect(isGenerationTrack('internalized')).toBe(true)
    expect(GENERATION_TRACKS).toEqual(['standard', 'internalized'])
  })

  it('그 외 값은 전부 거부한다 — 라우트가 이 판정으로 400을 낸다', () => {
    for (const bad of ['Standard', 'INTERNALIZED', 'v2', '', ' internalized', 1, null, undefined, {}]) {
      expect(isGenerationTrack(bad)).toBe(false)
    }
  })
})

describe('resolveGenerationTrack — 컬럼 SSOT + 레거시 JSONB 폴백', () => {
  it('generation_track 컬럼 값이 최우선이다(왕복)', () => {
    expect(resolveGenerationTrack({ generation_track: 'internalized', spec_sheet: spec() })).toBe('internalized')
    expect(resolveGenerationTrack({ generation_track: 'standard', spec_sheet: spec() })).toBe('standard')
  })

  it('컬럼이 비정상이고 레거시 JSONB 키가 있으면 폴백한다(컬럼 전환 전 생성 행 호환)', () => {
    expect(
      resolveGenerationTrack({ generation_track: null, spec_sheet: spec({ generationTrack: 'internalized' }) })
    ).toBe('internalized')
    expect(resolveGenerationTrack({ spec_sheet: spec({ generationTrack: 'internalized' }) })).toBe('internalized')
  })

  it('컬럼이 유효하면 레거시 키와 충돌해도 컬럼이 이긴다', () => {
    expect(
      resolveGenerationTrack({ generation_track: 'standard', spec_sheet: spec({ generationTrack: 'internalized' }) })
    ).toBe('standard')
  })

  it('무기록·비정상 값은 예외 없이 standard', () => {
    expect(resolveGenerationTrack({ spec_sheet: spec() })).toBe('standard')
    expect(resolveGenerationTrack({ generation_track: 'v3', spec_sheet: spec() })).toBe('standard')
    expect(resolveGenerationTrack({ generation_track: null, spec_sheet: spec({ generationTrack: 'v3' as never }) })).toBe(
      'standard'
    )
  })
})

describe('stripGenerationTrackKey — spec_sheet 무오염(결정 T-7)', () => {
  // spec_sheet는 buildSpecSheetJson이 통째로 프롬프트에 직렬화된다 — 키가 남으면 LLM 입력이 오염된다.
  it('클라가 미리 실어 보낸 키를 제거하고 다른 필드는 보존한다', () => {
    const stripped = stripGenerationTrackKey(spec({ generationTrack: 'internalized', size: '30cm' }))
    expect('generationTrack' in stripped).toBe(false)
    expect(stripped.productName).toBe('테스트 상품')
    expect(stripped.size).toBe('30cm')
  })

  it('키가 없으면 동일 객체를 그대로 반환한다(불필요한 복사 없음)', () => {
    const original = spec()
    expect(stripGenerationTrackKey(original)).toBe(original)
  })
})
