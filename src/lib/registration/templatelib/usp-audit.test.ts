import { describe, expect, it } from 'vitest'
import type { CopySectionsPayload } from '../pdp-state'
import { auditUspFacts, pairOverlap, USP_AUDIT_OVERLAP } from './usp-audit'

type Audit = NonNullable<CopySectionsPayload['fact_audit']>
type Verdict = 'supported' | 'partial' | 'unsupported'

const done = (items: Array<[claim: string, verdict: Verdict]>): Audit =>
  ({
    version: 1,
    stage: 'factAudit',
    status: 'done',
    route: { name: 'copy/fact-audit', model: 'm', effort: null, maxTokens: 1, backend: 'api' },
    result: {
      items: items.map(([claim, verdict], i) => ({ id: `l${i}`, claim, verdict, evidence: '', fix: '', regulated: false })),
      summary: { checked: items.length, unsupported: items.filter(([, v]) => v === 'unsupported').length, regulated: 0 },
    },
    warnings: [],
    costUsd: 0,
    durationMs: 0,
  }) as Audit

describe('pairOverlap — 글자 짝 겹침', () => {
  it('띄어쓰기·문장 부호·대소문자는 보지 않는다', () => {
    expect(pairOverlap('미끄럼 방지 패드', '미끄럼방지패드!')).toBe(1)
    expect(pairOverlap('ABS 받침', 'abs받침')).toBe(1)
  })

  it('짧은 쪽 기준 몫 — 짧은 주장이 긴 장점 후보 안에 다 있으면 1', () => {
    expect(pairOverlap('미끄럼 방지 패드 부착으로 식사 중 밀림 방지', '미끄럼 방지 패드')).toBe(1)
    expect(pairOverlap('세이지 그린 컬러', '구성별 가격 비교')).toBe(0)
  })

  it('짧은 쪽 글자 짝이 3개 미만이면 0 — 한두 글자 낱말 하나로 지우지 않는다', () => {
    expect(pairOverlap('구성', '합리적 구성')).toBe(0)
    expect(pairOverlap('', '아무 글')).toBe(0)
  })
})

describe('auditUspFacts — 근거 없음 주장과 겹치는 장점 후보 빼기', () => {
  const usps = ['미끄럼 방지 패드 부착으로 식사 중 밀림 방지', '세이지 그린 컬러로 인테리어와 어울림', '2구 도자기 식기']

  it('근거 없음과 겹침이 문턱 이상인 후보만 빼고 순서는 그대로, 수만 남긴다', () => {
    const out = auditUspFacts(usps, done([['미끄럼 방지 패드 부착으로 그릇이 밀리지 않는다', 'unsupported'], ['세이지 그린 단일 컬러', 'supported']]))
    expect(out.usps).toEqual(usps.slice(1))
    expect(out.record).toEqual({ audit: 'done', candidates: 3, dropped: 1, unsupported: 1 })
  })

  it('근거 있음·일부만 있음 판정은 쓰지 않는다', () => {
    const out = auditUspFacts(usps, done([['미끄럼 방지 패드 부착', 'partial'], ['2구 도자기 식기', 'supported']]))
    expect(out.usps).toEqual(usps)
    expect(out.record.dropped).toBe(0)
  })

  it('겹침이 문턱보다 작으면 남긴다 — 11-09 실측 근거 없음 주장(구성별 가격 비교)과 장점 후보 짝은 0.21이었다', () => {
    const claim = '구성별 가격 옵션이 있음(입력은 핀셋 1개 단일 구성)'
    const usp = '핀셋 1개로 간편하게 시작할 수 있는 합리적 구성'
    expect(pairOverlap(usp, claim)).toBeLessThan(USP_AUDIT_OVERLAP)
    expect(auditUspFacts([usp], done([[claim, 'unsupported']])).usps).toEqual([usp])
  })

  it('감사 기록이 없거나 끝나지 않았으면 그대로 두고 상태만 남긴다', () => {
    expect(auditUspFacts(usps, undefined)).toEqual({ usps, record: { audit: 'none', candidates: 3, dropped: 0, unsupported: 0 } })
    const failed = { version: 1, stage: 'factAudit', status: 'failed', failure: { kind: 'timeout', message: 'x' }, costUsd: 0, durationMs: 0 } as unknown as Audit
    expect(auditUspFacts(usps, failed).record).toEqual({ audit: 'failed', candidates: 3, dropped: 0, unsupported: 0 })
    const skipped = { version: 1, stage: 'factAudit', status: 'skipped', reason: 'no-lines' } as unknown as Audit
    expect(auditUspFacts(usps, skipped).usps).toEqual(usps)
    expect(auditUspFacts(usps, skipped).record.audit).toBe('skipped')
  })

  it('받은 배열을 바꾸지 않는다', () => {
    const input = [...usps]
    auditUspFacts(input, done([['미끄럼 방지 패드', 'unsupported']]))
    expect(input).toEqual(usps)
  })
})
