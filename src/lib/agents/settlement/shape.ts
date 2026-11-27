// 정산 대조 분석 에이전트 출력 셰이핑 — 순수 함수(네트워크·SDK 비의존).
// normalizeAnalysis: LLM 파싱 결과 → 필수 키·배열 상한이 보장된 안전한 출력(절대 throw 안 함).

import type { SettlementAnalysisOutput } from '@/types/settlement-recon'

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function strList(v: unknown, max: number): string[] {
  return asArray(v)
    .map((s) => asStr(s).trim())
    .filter((s) => s.length > 0)
    .slice(0, max)
}

const EMPTY_ANALYSIS: SettlementAnalysisOutput = {
  headline: '',
  summary: '',
  diff_attribution: [],
  anomalies: [],
  advice: [],
}

/**
 * LLM이 돌려준(파싱된) 객체를 안전한 분석 출력으로 정규화한다. 절대 throw하지 않는다.
 * null/형태 불일치 → 빈 분석(호출측이 규칙 대조표만으로 폴백 가능).
 */
export function normalizeAnalysis(raw: Record<string, unknown> | null): SettlementAnalysisOutput {
  if (!raw) return { ...EMPTY_ANALYSIS }

  return {
    headline: asStr(raw.headline).trim().slice(0, 120),
    summary: asStr(raw.summary).trim(),
    diff_attribution: strList(raw.diff_attribution, 10),
    anomalies: strList(raw.anomalies, 10),
    advice: strList(raw.advice, 8),
  }
}
