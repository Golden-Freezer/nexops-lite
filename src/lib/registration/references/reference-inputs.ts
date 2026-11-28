/**
 * spec_sheet.referenceInputs 읽기 — 잡 생성 입력은 사용자 JSON이라 모양을 다시 확인하고 상한(잡당 3개·글 칸 길이)을 다시 건다.
 * 가드용 글: 자사 기존 페이지(own)가 아닌 레퍼런스 원문은 재현 가드·유사도 검사에 더하고, own 원문은 재현 가드에서 뺀다
 * (우리 자신의 기존 문구를 다시 쓰는 것은 막지 않는다 — 통합 결정 2026-10-30).
 */

import type { PdpSpecSheet } from '../pdp-state'
import { buildTextCorpusCheck, type CorpusCheck } from '../similarity-gate'
import {
  REFERENCE_DENSITIES,
  REFERENCE_KINDS,
  REFERENCE_LAYOUTS,
  REFERENCE_LIMITS,
  REFERENCE_ROLES,
  type ReferenceInput,
  type ReferenceInsights,
  type ReferenceSection,
} from './reference-types'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const strList = (v: unknown, max: number, count: number) =>
  (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, count)
const inList = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v)
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

function readSection(v: unknown): ReferenceSection | null {
  if (!isObject(v) || !inList(REFERENCE_ROLES, v.role) || !inList(REFERENCE_LAYOUTS, v.layout)) return null
  return {
    start: Math.min(100, Math.max(0, num(v.start))),
    end: Math.min(100, Math.max(0, num(v.end))),
    role: v.role,
    layout: v.layout,
    visual: str(v.visual, REFERENCE_LIMITS.visualMaxChars),
    move: str(v.move, REFERENCE_LIMITS.moveMaxChars),
    appeals: strList(v.appeals, REFERENCE_LIMITS.appealMaxChars, REFERENCE_LIMITS.appealsPerSection),
    density: inList(REFERENCE_DENSITIES, v.density) ? v.density : 'medium',
  }
}

function readInsights(v: unknown): ReferenceInsights | null {
  if (!isObject(v) || v.version !== 1 || !Array.isArray(v.sections)) return null
  return {
    version: 1,
    sections: v.sections
      .map(readSection)
      .filter((s): s is ReferenceSection => s !== null)
      .slice(0, REFERENCE_LIMITS.sectionsMax),
    flow: str(v.flow, 400),
    strengths: strList(v.strengths, REFERENCE_LIMITS.observationMaxChars, REFERENCE_LIMITS.observationsMax),
    weaknesses: strList(v.weaknesses, REFERENCE_LIMITS.observationMaxChars, REFERENCE_LIMITS.observationsMax),
    regulatedSuspects: Math.max(0, Math.trunc(num(v.regulatedSuspects))),
  }
}

function readInput(v: unknown): ReferenceInput | null {
  if (!isObject(v) || !inList(REFERENCE_KINDS, v.kind) || (v.source !== 'image' && v.source !== 'pdf')) return null
  const insights = readInsights(v.insights)
  if (!insights) return null
  return {
    id: str(v.id, 64) || 'reference',
    kind: v.kind,
    fileName: str(v.fileName, REFERENCE_LIMITS.fileNameMaxChars),
    source: v.source,
    units: Math.max(0, Math.trunc(num(v.units))),
    insights,
    transcript: str(v.transcript, REFERENCE_LIMITS.transcriptMaxChars),
    costUsd: Math.max(0, num(v.costUsd)),
    analyzedAt: str(v.analyzedAt, 40),
    warnings: strList(v.warnings, 200, 10),
  }
}

/** 모양이 맞는 레퍼런스만, 잡당 상한까지 */
export function readReferenceInputs(spec: PdpSpecSheet | null | undefined): ReferenceInput[] {
  const raw = (spec as { referenceInputs?: unknown } | null | undefined)?.referenceInputs
  if (!Array.isArray(raw)) return []
  return raw
    .map(readInput)
    .filter((r): r is ReferenceInput => r !== null)
    .slice(0, REFERENCE_LIMITS.perJob)
}

/** 재현 가드용 글 — texts는 own이 아닌 레퍼런스 원문, exclude는 own 원문 */
export function referenceGuardTexts(spec: PdpSpecSheet | null | undefined): { texts: string[]; exclude: string[] } {
  const inputs = readReferenceInputs(spec).filter((r) => r.transcript)
  return {
    texts: inputs.filter((r) => r.kind !== 'own').map((r) => r.transcript),
    exclude: inputs.filter((r) => r.kind === 'own').map((r) => r.transcript),
  }
}

/** 유사도 검사용 잡 단위 임시 코퍼스 — own이 아닌 레퍼런스 원문 문장(없으면 null) */
export function referenceCorpusCheck(spec: PdpSpecSheet | null | undefined): CorpusCheck | null {
  return buildTextCorpusCheck(referenceGuardTexts(spec).texts)
}
