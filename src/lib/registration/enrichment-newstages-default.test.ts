/**
 * 운영 새 배치 잡 새 단계 기본 켬(하네스 R11d — 오너 2026-11-09 13:2x '켜기 + P09 확인 재현 (권장)'). 운영 실행(Vercel·Railway 구독 작업자)이고
 * 새 배치 잡일 때만 analysis.enrichment에 newstages를 더한다. 지금 배치·로컬 하네스(K<n>-N은 env 없이 꺼짐, K<n>-NS는 EXTRA)·Track S·
 * 끄는 env(NEXOPS_PDP_NEWSTAGES_DEFAULT=off)는 기록이 그대로다. 유료 0(콜 없음)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ENRICHMENT_DEFAULTS,
  ENRICHMENT_FEATURES,
  NEW_BATCH_HOSTED_DEFAULT_ON,
  resolveEnabledFeatures,
  withNewBatchHostedDefaults,
  type EnrichmentFeature,
} from './enrichment-switch'
import { analysisWithEnrichment } from './pdp-enrichment-stage'
import { newStagesActive } from './pdp-new-stages-stage'
import type { AnalysisResult, DecisionProfile, PdpJobRow } from './pdp-state'

const VERCEL = { VERCEL: '1' }
const VERCEL_PROD = { VERCEL_ENV: 'production' }
const WORKER = { NEXOPS_PDP_HOSTED: 'railway-worker' }
const HOSTED = [VERCEL, VERCEL_PROD, WORKER]
/** newstages를 더한 목록 — 기능 목록 순서(J34 뒤 usefacts·usegate가 newstages 뒤에 온다) */
const withNs = (list: readonly string[]) => ENRICHMENT_FEATURES.filter((f) => list.includes(f) || f === 'newstages')

describe('withNewBatchHostedDefaults — 운영 새 배치만 newstages를 더한다', () => {
  it('기본값 표는 그대로 off이고 운영 새 배치 표에만 newstages가 있다', () => {
    expect(ENRICHMENT_DEFAULTS.newstages).toBe(false)
    expect(NEW_BATCH_HOSTED_DEFAULT_ON).toEqual(['newstages'])
  })

  it('운영 실행(Vercel·작업자) + 새 배치 → 운영 기본 목록에 newstages(기능 목록 순서)', () => {
    for (const env of HOSTED) {
      const base = resolveEnabledFeatures(env)
      expect(base, JSON.stringify(env)).not.toContain('newstages')
      const out = withNewBatchHostedDefaults(base, 'new', env)
      expect(out, JSON.stringify(env)).toEqual(withNs(base))
      expect(out).toEqual(ENRICHMENT_FEATURES.filter((f) => out.includes(f)))
    }
  })

  it('지금 배치·배치 키 없는 잡은 운영이어도 그대로다', () => {
    for (const env of HOSTED) {
      const base = resolveEnabledFeatures(env)
      expect(withNewBatchHostedDefaults(base, 'now', env)).toEqual(base)
      expect(withNewBatchHostedDefaults(base, undefined, env)).toEqual(base)
    }
  })

  it('로컬 실행은 새 배치여도 더하지 않는다 — K<n>-N은 꺼짐, K<n>-NS는 EXTRA로만 켬', () => {
    const local = resolveEnabledFeatures({})
    expect(withNewBatchHostedDefaults(local, 'new', {})).toEqual(local)
    expect(local).not.toContain('newstages')
    const ns = { NEXOPS_PDP_ENRICHMENT_EXTRA: 'newstages' }
    expect(withNewBatchHostedDefaults(resolveEnabledFeatures(ns), 'new', ns)).toEqual(withNs(local))
    // 로컬 대조군(전부 끔)도 그대로 빈 목록
    expect(withNewBatchHostedDefaults(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT: 'off' }), 'new', {})).toEqual([])
  })

  it('끄는 길 — 운영 env NEXOPS_PDP_NEWSTAGES_DEFAULT=off(대소문자·공백 무관)면 더하지 않는다', () => {
    for (const value of ['off', ' OFF ']) {
      for (const hosted of HOSTED) {
        const env = { ...hosted, NEXOPS_PDP_NEWSTAGES_DEFAULT: value }
        const base = resolveEnabledFeatures(env)
        expect(withNewBatchHostedDefaults(base, 'new', env)).toEqual(base)
      }
    }
    const on = { ...VERCEL, NEXOPS_PDP_NEWSTAGES_DEFAULT: 'on' }
    expect(withNewBatchHostedDefaults(resolveEnabledFeatures(on), 'new', on)).toContain('newstages')
  })

  it('받은 목록을 바꾸지 않는다', () => {
    const base: EnrichmentFeature[] = ['vocab', 'templatelib']
    const out = withNewBatchHostedDefaults(base, 'new', VERCEL)
    expect(base).toEqual(['vocab', 'templatelib'])
    expect(out).toEqual(['vocab', 'templatelib', 'newstages'])
  })
})

describe('analysisWithEnrichment — 잡 기록', () => {
  const ENV_KEYS = ['VERCEL', 'VERCEL_ENV', 'NEXOPS_PDP_HOSTED', 'NEXOPS_PDP_NEWSTAGES_DEFAULT', 'NEXOPS_PDP_ENRICHMENT', 'NEXOPS_PDP_ENRICHMENT_EXTRA', 'NEXOPS_PDP_ENRICHMENT_SKIP']
  const stub = (env: Record<string, string>) => {
    for (const key of ENV_KEYS) vi.stubEnv(key, env[key] ?? '')
  }
  beforeEach(() => stub({}))
  afterEach(() => vi.unstubAllEnvs())

  const analysis = { detected_category: 'household' } as unknown as AnalysisResult
  const profile = {} as DecisionProfile
  const jobOf = (patch: Partial<PdpJobRow>): PdpJobRow =>
    ({ spec_sheet: { productName: '식물 클립' }, generation_track: 'internalized', section_images: [], ...patch }) as unknown as PdpJobRow
  const featuresOf = (job: PdpJobRow) => (analysisWithEnrichment(job, analysis, profile) as { enrichment?: { features: string[] } }).enrichment?.features

  it('운영 Track I 새 배치 잡 → 기록에 newstages, 새 단계가 돈다(첫 생성)', () => {
    for (const env of HOSTED) {
      stub(env)
      const job = jobOf({ model_batch: 'new' })
      const features = featuresOf(job)
      expect(features, JSON.stringify(env)).toEqual(withNs(resolveEnabledFeatures(env)))
      expect(newStagesActive({ ...job, analysis: analysisWithEnrichment(job, analysis, profile) })).toBe(true)
    }
  })

  it('운영 지금 배치·off env는 기록이 운영 기본 목록 그대로(newstages 없음)', () => {
    stub(VERCEL)
    const hostedDefault = resolveEnabledFeatures(VERCEL)
    expect(featuresOf(jobOf({ model_batch: 'now' }))).toEqual(hostedDefault)
    expect(featuresOf(jobOf({}))).toEqual(hostedDefault)
    stub({ ...WORKER, NEXOPS_PDP_NEWSTAGES_DEFAULT: 'off' })
    expect(featuresOf(jobOf({ model_batch: 'new' }))).toEqual(hostedDefault)
  })

  it('로컬 실행(하네스) 새 배치 잡은 env 기준 그대로 — EXTRA 없으면 없음, EXTRA면 있음', () => {
    expect(featuresOf(jobOf({ model_batch: 'new' }))).toEqual(resolveEnabledFeatures({}))
    stub({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'newstages' })
    expect(featuresOf(jobOf({ model_batch: 'new' }))).toContain('newstages')
  })

  it('Track S는 운영 새 배치여도 기록 규칙 그대로 — 학부모 판정이 꺼진 잡은 기록 없음', () => {
    stub(VERCEL)
    const out = analysisWithEnrichment(jobOf({ generation_track: 'standard', model_batch: 'new' }), analysis, profile)
    expect(out).toBe(analysis)
  })
})
