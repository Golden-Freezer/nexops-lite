import { describe, it, expect } from 'vitest'
import {
  retriedCount,
  nextCutToGenerate,
  gateRetryTargets,
  finalizeCuts,
  RETRY_BUDGET,
} from './thumbnail-pipeline'
import type { CutGateDetail, CutsRecord } from './thumbnail-types'

function gate(passed: boolean, presentationPassed = passed): CutGateDetail {
  return {
    passed,
    message: passed ? null : '미통과',
    identity: { passed: true, same_product: true, consistency: 0.9, has_artifact: false, message: null },
    presentation: {
      passed: presentationPassed,
      not_continuous_single_photo: false,
      rectangular_boundary: false,
      planar_source_remnant: false,
      flat_margin_band: false,
      tight_bbox_occupancy: 0.5,
      warning: null,
      message: presentationPassed ? null : '미통과',
    },
  }
}

describe('nextCutToGenerate — 생성 순서·스킵 규칙', () => {
  it('빈 cuts → cutout부터 (체이닝 전제)', () => {
    expect(nextCutToGenerate({})).toBe('cutout')
  })
  it('cutout 완료 → studio → usage 순서', () => {
    expect(nextCutToGenerate({ cutout: { url: 'a' } })).toBe('studio')
    expect(nextCutToGenerate({ cutout: { url: 'a' }, studio: { url: 'b' } })).toBe('usage')
  })
  it('3컷 완료 → null (게이트로 전이)', () => {
    expect(
      nextCutToGenerate({ cutout: { url: 'a' }, studio: { url: 'b' }, usage: { url: 'c' } })
    ).toBeNull()
  })
  it('실패했지만 재시도 미소진 컷은 같은 컷을 다시 준다', () => {
    expect(nextCutToGenerate({ cutout: { error: 'x' } })).toBe('cutout')
  })
  it('재시도 소진(error+retried) 컷은 건너뛰고 계속 생성한다 (올-오어-낫싱은 최종에서)', () => {
    expect(nextCutToGenerate({ cutout: { error: 'x', retried: true } })).toBe('studio')
  })
})

describe('gateRetryTargets — NEXFIT service.py:453-465 재시도 트리거', () => {
  it('cutout은 전체 미통과 시 재생성 대상', () => {
    const cuts: CutsRecord = {
      cutout: { url: 'a', gate: gate(false) },
      studio: { url: 'b', gate: gate(true) },
    }
    expect(gateRetryTargets(cuts)).toEqual(['cutout'])
  })
  it('studio는 presentation 미통과만 트리거 — identity 실패는 재시도 안 함', () => {
    const identityFail: CutGateDetail = { ...gate(false, true), passed: false }
    const cuts: CutsRecord = {
      cutout: { url: 'a', gate: gate(true) },
      studio: { url: 'b', gate: identityFail },
    }
    expect(gateRetryTargets(cuts)).toEqual([])
    const presentationFail: CutsRecord = {
      cutout: { url: 'a', gate: gate(true) },
      studio: { url: 'b', gate: gate(false, false) },
    }
    expect(gateRetryTargets(presentationFail)).toEqual(['studio'])
  })
  it('이미 재생성을 소비한 컷은 제외', () => {
    const cuts: CutsRecord = {
      cutout: { url: 'a', retried: true, gate: gate(false) },
      studio: { url: 'b', gate: gate(true) },
    }
    expect(gateRetryTargets(cuts)).toEqual([])
  })
  it('잡 전체 예산(2컷)을 넘지 않는다 — 생성 실패 재시도와 공유', () => {
    const cuts: CutsRecord = {
      cutout: { url: 'a', gate: gate(false) },
      studio: { url: 'b', gate: gate(false, false) },
      usage: { url: 'c', retried: true }, // 생성 단계에서 예산 1 소비
    }
    expect(gateRetryTargets(cuts)).toHaveLength(Math.max(RETRY_BUDGET - 1, 0))
  })
})

describe('finalizeCuts — 3컷 올-오어-낫싱 (NEXFIT S11)', () => {
  it('3컷 전부 URL → 성공', () => {
    expect(
      finalizeCuts({ cutout: { url: 'a' }, studio: { url: 'b' }, usage: { url: 'c' } })
    ).toEqual({ ok: true, error: null })
  })
  it('1컷이라도 없으면 실패 + 미완성 컷과 원인 명시', () => {
    const verdict = finalizeCuts({
      cutout: { url: 'a' },
      studio: { error: 'studio 생성 실패: filter', retried: true },
      usage: { url: 'c' },
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.error).toContain('studio')
    expect(verdict.error).toContain('filter')
  })
})

describe('retriedCount', () => {
  it('retried 마킹된 컷 수를 센다', () => {
    expect(retriedCount({})).toBe(0)
    expect(retriedCount({ cutout: { retried: true }, usage: { retried: true } })).toBe(2)
  })
})
