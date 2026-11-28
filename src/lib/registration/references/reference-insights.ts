/**
 * 레퍼런스 분석 산출 정리(순수 함수) — 모델 응답(묶음별)을 검사해 ReferenceInsights와 원문(transcript)으로 합친다.
 * - 역할·레이아웃·글 양은 정해진 어휘만, 위치는 0~100으로, 글 칸은 상한으로 자른다.
 * - transcript 밖 칸(연출·설득 동작·소구 유형·관찰)이 원문을 15자 넘게 옮기면 그 글을 버린다(재현 가드 재사용).
 * - flow는 역할 순서로 코드가 만든다(같은 역할 연속은 ×n). 규제 표현 의심은 원문을 규제 사전으로 세어 수치만 남긴다.
 */

import { findRegulatedClaims } from '../eval/claim-lexicon'
import { buildEchoGuard, hasEcho } from '../reviews/competitor-echo'
import {
  REFERENCE_DENSITIES,
  REFERENCE_LAYOUTS,
  REFERENCE_LIMITS,
  REFERENCE_ROLES,
  type ReferenceInsights,
  type ReferenceRole,
  type ReferenceSection,
} from './reference-types'

export interface ReferenceBatch {
  transcript: Array<{ unit: number; text: string }>
  sections: unknown[]
  strengths: unknown[]
  weaknesses: unknown[]
  lastRole: string | null
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback
const pct = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n * 10) / 10)) : null
}

/** 모델 응답 JSON 한 묶음 → ReferenceBatch. 모양이 틀리면 예외(호출기가 재시도·실패로 처리) */
export function readReferenceBatch(parsed: Record<string, unknown> | null): ReferenceBatch {
  if (!parsed || !Array.isArray(parsed.sections)) throw new Error('sections 배열이 없습니다')
  const transcript = (Array.isArray(parsed.transcript) ? parsed.transcript : [])
    .filter(isObject)
    .map((t, i) => ({ unit: Number(t.unit) || i + 1, text: typeof t.text === 'string' ? t.text.trim() : '' }))
  const obs = isObject(parsed.observations) ? parsed.observations : {}
  return {
    transcript,
    sections: parsed.sections,
    strengths: Array.isArray(obs.strengths) ? obs.strengths : [],
    weaknesses: Array.isArray(obs.weaknesses) ? obs.weaknesses : [],
    lastRole: typeof parsed.last_role === 'string' ? parsed.last_role : null,
  }
}

/** 역할 순서 → 흐름 한 줄(같은 역할 연속은 ×n) */
export function flowOf(roles: readonly ReferenceRole[]): string {
  const parts: string[] = []
  for (let i = 0; i < roles.length; ) {
    let n = 1
    while (roles[i + n] === roles[i]) n++
    parts.push(n > 1 ? `${roles[i]} ×${n}` : roles[i])
    i += n
  }
  return parts.join(' → ')
}

/** 묶음들 → insights + 원문. dropped = 원문을 옮겨 버린 글 칸 수 */
export function mergeReferenceBatches(batches: readonly ReferenceBatch[]): {
  insights: ReferenceInsights
  transcript: string
  dropped: number
} {
  const transcript = batches
    .flatMap((b) => b.transcript.map((t) => t.text))
    .filter(Boolean)
    .join('\n')
    .slice(0, REFERENCE_LIMITS.transcriptMaxChars)
  const guard = buildEchoGuard([transcript])
  let dropped = 0
  /** 원문을 옮긴 글은 버린다 */
  const keep = (text: string) => {
    if (!text) return ''
    if (guard && hasEcho(text, guard)) {
      dropped += 1
      return ''
    }
    return text
  }
  const sections: ReferenceSection[] = []
  for (const raw of batches.flatMap((b) => b.sections)) {
    if (!isObject(raw) || sections.length >= REFERENCE_LIMITS.sectionsMax) continue
    const start = pct(raw.start)
    const end = pct(raw.end)
    if (start === null || end === null || end < start) continue
    sections.push({
      start,
      end,
      role: oneOf(REFERENCE_ROLES, raw.role, 'other'),
      layout: oneOf(REFERENCE_LAYOUTS, raw.layout, 'other'),
      visual: keep(clip(raw.visual, REFERENCE_LIMITS.visualMaxChars)),
      move: keep(clip(raw.move, REFERENCE_LIMITS.moveMaxChars)),
      appeals: (Array.isArray(raw.appeals) ? raw.appeals : [])
        .map((a) => keep(clip(a, REFERENCE_LIMITS.appealMaxChars)))
        .filter(Boolean)
        .slice(0, REFERENCE_LIMITS.appealsPerSection),
      density: oneOf(REFERENCE_DENSITIES, raw.density, 'medium'),
    })
  }
  sections.sort((a, b) => a.start - b.start)
  const observations = (key: 'strengths' | 'weaknesses') =>
    [...new Set(batches.flatMap((b) => b[key]).map((o) => keep(clip(o, REFERENCE_LIMITS.observationMaxChars))))]
      .filter(Boolean)
      .slice(0, REFERENCE_LIMITS.observationsMax)
  const regulatedSuspects = findRegulatedClaims(
    transcript.split('\n').map((text, i) => ({ section: String(i), text }))
  ).length
  return {
    insights: {
      version: 1,
      sections,
      flow: flowOf(sections.map((s) => s.role)),
      strengths: observations('strengths'),
      weaknesses: observations('weaknesses'),
      regulatedSuspects,
    },
    transcript,
    dropped,
  }
}
