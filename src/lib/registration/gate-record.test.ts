import { describe, expect, it } from 'vitest'
import { SCALE_KEPT_NOTE, gateRecordOf, gateStats } from './gate-record'
import type { SectionImage } from './pdp-state'

const SCORE = { consistency: 0.72, same_product: true, has_artifact: false, artifact_reason: '' }

describe('gateRecordOf', () => {
  it('통과·미달은 점수와 사유를 남긴다', () => {
    expect(gateRecordOf({ verdict: 'pass', score: SCORE })).toEqual({ verdict: 'pass', consistency: 0.72, same_product: true, has_artifact: false })
    expect(gateRecordOf({ verdict: 'fail', reason: 'structure', score: { ...SCORE, same_product: false, artifact_reason: 'x'.repeat(300) } })).toEqual({
      verdict: 'fail',
      consistency: 0.72,
      same_product: false,
      has_artifact: false,
      reason: 'structure',
      artifact_reason: 'x'.repeat(200),
    })
  })

  it('판정하지 못했거나 점수가 없으면 남기지 않는다', () => {
    expect(gateRecordOf({ verdict: 'skip' })).toBeNull()
    expect(gateRecordOf({ verdict: 'skip', score: SCORE })).toBeNull()
    expect(gateRecordOf({ verdict: 'pass' })).toBeNull()
    expect(gateRecordOf({ verdict: 'pass', score: null })).toBeNull()
  })

  it('K 라인 크기 판정은 칸이 있을 때만 남긴다(실물 크기 11-05)', () => {
    expect(gateRecordOf({ verdict: 'fail', reason: 'scale', score: { ...SCORE, size_plausible: false, size_reason: 'y'.repeat(300) } })).toEqual({
      verdict: 'fail',
      consistency: 0.72,
      same_product: true,
      has_artifact: false,
      reason: 'scale',
      size_plausible: false,
      size_reason: 'y'.repeat(200),
    })
    expect(gateRecordOf({ verdict: 'pass', score: { ...SCORE, size_plausible: true, size_reason: '' } })).toEqual({ verdict: 'pass', consistency: 0.72, same_product: true, has_artifact: false, size_plausible: true })
    // 크기만 미달이라 통과한 판정은 판정 글과 재생성하지 않은 까닭을 남긴다(K5 P01 11-06)
    expect(gateRecordOf({ verdict: 'pass', score: { ...SCORE, size_plausible: false, size_reason: 'twice the hand' } })).toEqual({
      verdict: 'pass',
      consistency: 0.72,
      same_product: true,
      has_artifact: false,
      size_plausible: false,
      size_reason: 'twice the hand',
      note: SCALE_KEPT_NOTE,
    })
    // 크기를 묻지 않은 판정(D 라인·예전 기록)은 지금 기록 그대로
    expect(gateRecordOf({ verdict: 'pass', score: { ...SCORE, size_plausible: 'no' } })).toEqual({ verdict: 'pass', consistency: 0.72, same_product: true, has_artifact: false })
  })

  it('점수 모양이 어긋나도 던지지 않는다', () => {
    expect(gateRecordOf({ verdict: 'pass', score: { consistency: 'high', same_product: 'yes' } })).toEqual({ verdict: 'pass', consistency: null, same_product: null, has_artifact: false })
  })
})

describe('gateStats', () => {
  it('칸이 없는 예전 잡은 요약이 없다 — 그대로 읽힌다', () => {
    const old = [{ section: 'hero', url: 'u', prompt: 'p', retried: false }] as unknown as SectionImage[]
    expect(gateStats(old)).toBeNull()
    expect(gateStats([])).toBeNull()
  })

  it('예전 컷과 새 컷이 섞여도 있는 칸만 센다', () => {
    const images = [
      { section: 'hero' },
      { section: 'a', gate: { verdict: 'pass', consistency: 0.8, same_product: true, has_artifact: false } },
      { section: 'b', gateBefore: { verdict: 'fail', consistency: 0.62, same_product: true, has_artifact: false, reason: 'consistency' } },
      { section: 'c', gate: { verdict: 'pass', consistency: null, same_product: true, has_artifact: false } },
    ] as unknown as SectionImage[]
    expect(gateStats(images)).toEqual({ judged: 2, regenerated: 1, reasons: { consistency: 1 }, consistency: [0.8, 0.62] })
  })

  it('K 라인 크기 단독 통과·재판정 없음 수는 있을 때만 칸을 둔다(K5 P01 11-06) — D 원장 키 그대로', () => {
    const kept = { verdict: 'pass', consistency: 0.9, same_product: true, has_artifact: false, size_plausible: false, size_reason: 'r', note: SCALE_KEPT_NOTE }
    const failed = { verdict: 'fail', consistency: 0.5, same_product: true, has_artifact: false, reason: 'consistency', size_plausible: false }
    const images = [
      { section: 'hero', gate: kept },
      { section: 'k1', gate: kept },
      { section: 'k2', gateBefore: failed, regenNotRejudged: true },
      // 크기 칸이 true인 통과는 세지 않는다
      { section: 'k3', gate: { ...kept, size_plausible: true, note: undefined } },
    ] as unknown as SectionImage[]
    expect(gateStats(images)).toEqual({ judged: 3, regenerated: 1, reasons: { consistency: 1 }, consistency: [0.9, 0.9, 0.5, 0.9], scaleKept: 2, notRejudged: 1 })
    // D 컷만이면 칸이 없다 — 키 순서까지 예전 그대로
    const dOnly = [
      { section: 'a', gate: { verdict: 'pass', consistency: 0.8, same_product: true, has_artifact: false } },
      { section: 'b', gateBefore: { verdict: 'fail', consistency: 0.62, same_product: true, has_artifact: false, reason: 'consistency' } },
    ] as unknown as SectionImage[]
    expect(Object.keys(gateStats(dOnly)!)).toEqual(['judged', 'regenerated', 'reasons', 'consistency'])
  })
})
