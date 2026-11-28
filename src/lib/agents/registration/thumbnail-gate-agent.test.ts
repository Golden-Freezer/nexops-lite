import { describe, it, expect } from 'vitest'
import { evaluateCut, composeGate, failedGate } from './thumbnail-gate-agent'

/** 통과하는 원시 VLM 응답 */
function passingRaw(occupancy = 0.6) {
  return {
    identity: { same_product: true, consistency: 0.9, has_artifact: false, artifact_reason: '' },
    presentation: {
      not_continuous_single_photo: false,
      rectangular_boundary: false,
      planar_source_remnant: false,
      flat_margin_band: false,
      tight_bbox_occupancy: occupancy,
      presentation_reason: '',
    },
  }
}

describe('evaluateCut — gate.py:122-230 판정 규칙', () => {
  it('정상 응답 → 통과', () => {
    const detail = evaluateCut(passingRaw(), 'cutout')
    expect(detail.passed).toBe(true)
    expect(detail.identity.passed).toBe(true)
    expect(detail.presentation.passed).toBe(true)
    expect(detail.message).toBeNull()
  })

  it('identity: consistency < 0.70 → 미통과', () => {
    const raw = passingRaw()
    raw.identity.consistency = 0.62
    const detail = evaluateCut(raw, 'cutout')
    expect(detail.identity.passed).toBe(false)
    expect(detail.passed).toBe(false)
    expect(detail.identity.message).toContain('0.62')
  })

  it('위반 boolean 누락은 위반으로 간주한다 (`!== false` 보수 판독)', () => {
    const raw = passingRaw() as unknown as Record<string, Record<string, unknown>>
    delete raw.presentation.rectangular_boundary
    const detail = evaluateCut(raw, 'studio')
    expect(detail.presentation.passed).toBe(false)
    expect(detail.presentation.rectangular_boundary).toBe(true)
  })

  it('flat_margin_band는 cutout에 적용하지 않는다 — 순백 배경이 규격컷 스펙(원본 교훈 6)', () => {
    const raw = passingRaw()
    raw.presentation.flat_margin_band = true
    expect(evaluateCut(raw, 'cutout').presentation.passed).toBe(true)
    expect(evaluateCut(raw, 'studio').presentation.passed).toBe(false)
  })

  it('cutout 점유율 < 0.30 → 하드 실패, studio는 하드 실패 없음', () => {
    expect(evaluateCut(passingRaw(0.2), 'cutout').presentation.passed).toBe(false)
    expect(evaluateCut(passingRaw(0.2), 'cutout').message).toContain('점유율 미달')
    expect(evaluateCut(passingRaw(0.2), 'studio').presentation.passed).toBe(true)
  })

  it('권장 범위 밖 점유율은 실패가 아니라 warning만 (원본 상시 재시도 교훈 7)', () => {
    const detail = evaluateCut(passingRaw(0.45), 'cutout') // cutout 권장 0.55~1.0, 하드 0.30
    expect(detail.presentation.passed).toBe(true)
    expect(detail.presentation.warning).toContain('권장 범위')
  })

  it('점유율 판정 불가(null·비수치) → warning, 실패 아님', () => {
    const raw = passingRaw() as unknown as Record<string, Record<string, unknown>>
    raw.presentation.tight_bbox_occupancy = 'not-a-number'
    const detail = evaluateCut(raw, 'studio')
    expect(detail.presentation.tight_bbox_occupancy).toBeNull()
    expect(detail.presentation.warning).toContain('판정하지 못했습니다')
    expect(detail.presentation.passed).toBe(true)
  })

  it('점유율 null은 0으로 강제변환하지 않는다 — cutout 하드 플로어 오탐 방지 (gate.py float(None)→None 대응)', () => {
    for (const value of [null, undefined, false, '']) {
      const raw = passingRaw() as unknown as Record<string, Record<string, unknown>>
      raw.presentation.tight_bbox_occupancy = value
      const detail = evaluateCut(raw, 'cutout')
      expect(detail.presentation.tight_bbox_occupancy).toBeNull()
      expect(detail.presentation.passed).toBe(true) // 하드 플로어 미적용 (측정 실패 ≠ 미달)
      expect(detail.presentation.warning).toContain('판정하지 못했습니다')
    }
  })

  it('응답 결손 → failedDetail 형태', () => {
    const detail = evaluateCut(undefined, 'cutout')
    expect(detail.passed).toBe(false)
    expect(detail.presentation.not_continuous_single_photo).toBe(true)
    expect(detail.message).toContain('게이트 응답이 없습니다')
  })
})

describe('composeGate — gate.py:233-249', () => {
  it('두 컷 모두 통과 → passed, message null', () => {
    const gate = composeGate({ cutout: passingRaw(), studio: passingRaw() })
    expect(gate.passed).toBe(true)
    expect(gate.message).toBeNull()
  })
  it('한 컷 미통과 → 컷 접두 메시지 조립', () => {
    const raw = passingRaw()
    raw.identity.same_product = false
    const gate = composeGate({ cutout: raw, studio: passingRaw() })
    expect(gate.passed).toBe(false)
    expect(gate.message).toContain('cutout:')
  })
  it('비객체 입력도 안전하게 실패 처리', () => {
    expect(composeGate(null).passed).toBe(false)
  })
})

describe('failedGate — gate.py:252-254', () => {
  it('두 컷 모두 동일 사유로 실패 표기', () => {
    const gate = failedGate('제품 게이트 판정 실패: timeout')
    expect(gate.passed).toBe(false)
    expect(gate.cuts.cutout.message).toContain('timeout')
    expect(gate.cuts.studio.identity.consistency).toBe(0)
  })
})
