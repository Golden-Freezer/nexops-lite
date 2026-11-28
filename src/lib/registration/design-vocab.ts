/**
 * 디자인 어휘 스냅샷 로더(E-0, docs/plans/pdp-enrichment/00_DESIGN.md §4.1) — 빌드타임 생성물
 * corpus/design-vocab.json(scripts/registration/build-design-vocab.mjs)을 정적 import한다. 런타임 fs 읽기 없음.
 * 스키마 검증에 실패하면 null과 경고를 남기고, Track I는 기존 경로(buildSkeleton·v2)를 쓴다.
 *
 * 조회 순서(판매 채널이 쿠팡이므로 쿠팡 축 우선): 쿠팡 카테고리 → 네이버 카테고리 → 쿠팡 pooled → 네이버 pooled.
 * stationery·packaging·pet은 원천 카테고리가 없어 항상 pooled. 결과에 priorSource를 남긴다.
 *
 * 키 해석 주의: 부록 B 초안 밖의 포괄 키(overlay.caption = "사진 위 글자 있음", elements.headline·photo,
 * staging.graphic_marks·product_state·multiple 등)는 커버리지 보강용이다 — 라벨·지시선 같은 장치로 읽지 않는다.
 * 핵심 키만 센 커버리지는 coreCoverage에 있다.
 */

import rawVocab from './corpus/design-vocab.json'
import { ROLE16, type Role16 } from './corpus-v2'

export const VOCAB_PLATFORMS = ['coupang', 'naver'] as const
export type VocabPlatform = (typeof VOCAB_PLATFORMS)[number]
export const VOCAB_POSITIONS = ['opening', 'early', 'middle', 'late', 'closing'] as const
export type VocabPosition = (typeof VOCAB_POSITIONS)[number]
export const VOCAB_SHOT_AXES = ['angle', 'composition', 'lighting', 'staging', 'backdrop'] as const
export type VocabShotAxis = (typeof VOCAB_SHOT_AXES)[number]

/** 원천 카테고리가 없어 항상 pooled로 조회하는 카테고리. */
export const POOLED_ONLY_CATEGORIES = new Set(['stationery', 'packaging', 'pet'])

export interface VocabShare {
  key: string
  share: number
}

export interface RoleVocab {
  sections: number
  /** 페이지당 출현율(trust gate pooled 산출에도 사용) */
  prevalence: number
  positionDist: Record<VocabPosition, number>
  layout: VocabShare[]
  background: VocabShare[]
  elements: VocabShare[]
  copyDevices: VocabShare[]
  overlay: { imageShare: number; devices: VocabShare[] }
  shot: Record<VocabShotAxis, VocabShare[]>
}

export interface VocabCell {
  pages: number
  /** pooled 길이 상한용(v2 profile 대체) */
  sectionCountMedian: number
  roles: Partial<Record<Role16, RoleVocab>>
}

export interface VocabPlatformData {
  pages: number
  pooled: VocabCell
  byCategory: Record<string, VocabCell>
  tierLevers: Array<{ key: string; pro: number; template: number }>
}

export interface DesignVocabSnapshot {
  schemaVersion: 1
  generatedAt: string
  sourceCommitSha?: string
  derivedFingerprint: string
  contentHash: string
  taxonomyVersion: string
  coverage: Record<string, number>
  /** 부록 B 핵심 키만 센 커버리지(보고용) */
  coreCoverage?: Record<string, number>
  platforms: Record<VocabPlatform, VocabPlatformData>
}

/** `coupang:beauty`·`naver:digital`·`coupang:pooled` 형식. */
export type VocabPriorSource = `${VocabPlatform}:${string}`

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isRatio = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1

function shareListError(value: unknown, path: string): string | null {
  if (!Array.isArray(value)) return `${path}: 배열 아님`
  for (const [i, s] of value.entries()) {
    if (!isObject(s) || typeof s.key !== 'string' || !isRatio(s.share)) return `${path}[${i}]: {key, share} 형식 위반`
  }
  return null
}

function roleError(role: unknown, path: string): string | null {
  if (!isObject(role)) return `${path}: 객체 아님`
  if (typeof role.sections !== 'number' || !isRatio(role.prevalence)) return `${path}: sections·prevalence 위반`
  if (!isObject(role.positionDist) || !VOCAB_POSITIONS.every((p) => isRatio((role.positionDist as Record<string, unknown>)[p]))) {
    return `${path}.positionDist 위반`
  }
  for (const axis of ['layout', 'background', 'elements', 'copyDevices'] as const) {
    const err = shareListError(role[axis], `${path}.${axis}`)
    if (err) return err
  }
  if (!isObject(role.overlay) || !isRatio(role.overlay.imageShare)) return `${path}.overlay 위반`
  const overlayErr = shareListError(role.overlay.devices, `${path}.overlay.devices`)
  if (overlayErr) return overlayErr
  if (!isObject(role.shot)) return `${path}.shot 위반`
  for (const axis of VOCAB_SHOT_AXES) {
    const err = shareListError(role.shot[axis], `${path}.shot.${axis}`)
    if (err) return err
  }
  return null
}

function cellError(cell: unknown, path: string): string | null {
  if (!isObject(cell) || typeof cell.pages !== 'number' || typeof cell.sectionCountMedian !== 'number') {
    return `${path}: pages·sectionCountMedian 위반`
  }
  if (!isObject(cell.roles)) return `${path}.roles 위반`
  for (const [role, value] of Object.entries(cell.roles)) {
    if (!(ROLE16 as readonly string[]).includes(role)) return `${path}.roles: 알 수 없는 역할 ${role}`
    const err = roleError(value, `${path}.roles.${role}`)
    if (err) return err
  }
  return null
}

/** 스키마 검증 — 통과하면 타입이 좁혀진 스냅샷, 실패하면 첫 위반 사유. */
export function validateDesignVocab(
  value: unknown
): { ok: true; snapshot: DesignVocabSnapshot } | { ok: false; reason: string } {
  if (!isObject(value) || value.schemaVersion !== 1) return { ok: false, reason: 'schemaVersion 1 아님' }
  if (typeof value.contentHash !== 'string' || typeof value.taxonomyVersion !== 'string') {
    return { ok: false, reason: 'contentHash·taxonomyVersion 없음' }
  }
  if (!isObject(value.platforms)) return { ok: false, reason: 'platforms 없음' }
  for (const platform of VOCAB_PLATFORMS) {
    const p = value.platforms[platform]
    if (!isObject(p) || typeof p.pages !== 'number' || !isObject(p.byCategory) || !Array.isArray(p.tierLevers)) {
      return { ok: false, reason: `${platform}: pages·byCategory·tierLevers 위반` }
    }
    const pooledErr = cellError(p.pooled, `${platform}.pooled`)
    if (pooledErr) return { ok: false, reason: pooledErr }
    for (const [category, cell] of Object.entries(p.byCategory)) {
      const err = cellError(cell, `${platform}.byCategory.${category}`)
      if (err) return { ok: false, reason: err }
    }
  }
  return { ok: true, snapshot: value as unknown as DesignVocabSnapshot }
}

let cached: DesignVocabSnapshot | null | undefined

/** 정적 스냅샷(검증 1회, 실패 시 null + 경고 1회). */
export function getDesignVocab(): DesignVocabSnapshot | null {
  if (cached !== undefined) return cached
  const result = validateDesignVocab(rawVocab as unknown)
  if (!result.ok) {
    console.warn(`[design-vocab] 스냅샷 검증 실패 — Track I는 기존 경로로 동작: ${result.reason}`)
    cached = null
  } else {
    cached = result.snapshot
  }
  return cached
}

export function getVocabHash(vocab: DesignVocabSnapshot | null = getDesignVocab()): string | null {
  return vocab?.contentHash ?? null
}

/** 조회 순서대로 [셀, priorSource] 후보를 나열한다. */
function candidateCells(
  category: string | null | undefined,
  vocab: DesignVocabSnapshot
): Array<{ cell: VocabCell; priorSource: VocabPriorSource }> {
  const key = category?.trim().toLowerCase() ?? ''
  const out: Array<{ cell: VocabCell; priorSource: VocabPriorSource }> = []
  if (key && !POOLED_ONLY_CATEGORIES.has(key)) {
    for (const platform of VOCAB_PLATFORMS) {
      const cell = vocab.platforms[platform].byCategory[key]
      // 역할이 하나도 없는 셀(표본 부족)은 건너뛴다 — 셀 출처와 역할 출처가 어긋나지 않게.
      if (cell && Object.keys(cell.roles).length > 0) out.push({ cell, priorSource: `${platform}:${key}` })
    }
  }
  for (const platform of VOCAB_PLATFORMS) out.push({ cell: vocab.platforms[platform].pooled, priorSource: `${platform}:pooled` })
  return out
}

/** 카테고리 셀 조회(셀 단위 값 — sectionCountMedian 등). */
export function lookupVocabCell(
  category: string | null | undefined,
  vocab: DesignVocabSnapshot | null = getDesignVocab()
): { cell: VocabCell; priorSource: VocabPriorSource } | null {
  if (!vocab) return null
  return candidateCells(category, vocab)[0] ?? null
}

/** 역할 단위 조회 — 셀에 그 역할(표본 30섹션 이상)이 없으면 다음 순서로 넘어간다. */
export function lookupRoleVocab(
  category: string | null | undefined,
  role: Role16,
  vocab: DesignVocabSnapshot | null = getDesignVocab()
): { role: RoleVocab; priorSource: VocabPriorSource } | null {
  if (!vocab) return null
  for (const { cell, priorSource } of candidateCells(category, vocab)) {
    const found = cell.roles[role]
    if (found) return { role: found, priorSource }
  }
  return null
}
