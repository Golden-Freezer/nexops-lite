/**
 * 게이트 판정 기록 — 통과 점수까지 컷 기록에 남긴다(동작은 그대로, 추가 콜 없음). 통과 점수가 없어 왜 통과했는지 다시 물어야 했고(H6 재현 $0.74),
 * 재생성 사유도 알 수 없었다(R9~R12 220컷 중 20컷). consistency 문턱을 실제 분포로 정하기 위한 자료다(통합 승인 2026-11-01).
 * 칸이 없는 예전 잡은 그대로 읽힌다 — 이 파일의 함수는 없는 칸을 건너뛴다.
 */

import type { GateRecord, SectionImage } from './pdp-state'

interface Judged {
  verdict: string
  score?: {
    consistency?: unknown
    same_product?: unknown
    has_artifact?: unknown
    artifact_reason?: unknown
    size_plausible?: unknown
    size_reason?: unknown
    parts_match?: unknown
    parts_reason?: unknown
    use_correct?: unknown
    use_reason?: unknown
  } | null
  reason?: string
}

/** 크기 단독 미달을 통과시킨 컷의 기록 글(K5 P01 실측 11-06 — 재생성해도 크기를 못 고치고 장수만 2배) */
export const SCALE_KEPT_NOTE = '크기 미달 — 재생성 안 함(재생성으로 못 고침, K5 P01 실측)'

/** 게이트 결과 → 컷 기록 칸. 판정하지 못했거나 점수가 없으면 null(기록하지 않는다). 크기 칸은 K 라인 크기 판정에만 있다(실물 크기 11-05) */
export function gateRecordOf(gate: Judged): GateRecord | null {
  if ((gate.verdict !== 'pass' && gate.verdict !== 'fail') || !gate.score) return null
  const { consistency, same_product, has_artifact, artifact_reason, size_plausible, size_reason, parts_match, parts_reason, use_correct, use_reason } = gate.score
  return {
    verdict: gate.verdict,
    consistency: typeof consistency === 'number' ? consistency : null,
    same_product: typeof same_product === 'boolean' ? same_product : null,
    has_artifact: has_artifact === true,
    ...(gate.reason ? { reason: gate.reason } : {}),
    ...(typeof artifact_reason === 'string' && artifact_reason ? { artifact_reason: artifact_reason.slice(0, 200) } : {}),
    ...(typeof size_plausible === 'boolean' ? { size_plausible } : {}),
    ...(typeof size_reason === 'string' && size_reason ? { size_reason: size_reason.slice(0, 200) } : {}),
    // K 컷 부품·사용 판정(점검 고침 1·3) — 묻지 않은 판정은 칸이 없다(D·예전 기록 그대로)
    ...(typeof parts_match === 'boolean' ? { parts_match } : {}),
    ...(typeof parts_reason === 'string' && parts_reason ? { parts_reason: parts_reason.slice(0, 200) } : {}),
    ...(typeof use_correct === 'boolean' ? { use_correct } : {}),
    ...(typeof use_reason === 'string' && use_reason ? { use_reason: use_reason.slice(0, 200) } : {}),
    // 크기만 미달이라 통과한 컷 — 판정 글(size_reason)과 함께 재생성하지 않은 까닭을 남긴다
    ...(gate.verdict === 'pass' && size_plausible === false ? { note: SCALE_KEPT_NOTE } : {}),
  }
}

export interface GateStats {
  /** 지금 컷의 판정 기록 수 */
  judged: number
  /** 미달 뒤 재생성된 컷 수와 그 사유별 수 */
  regenerated: number
  reasons: Record<string, number>
  /** 판정한 컷의 consistency — 재생성 전 점수도 넣는다(문턱 분포용) */
  consistency: number[]
  /** K 라인만 — 크기만 미달이라 재생성하지 않고 기록만 한 컷 수(0이면 칸 없음) */
  scaleKept?: number
  /** K 라인만 — 재생성한 뒤 다시 판정하지 않은 컷 수(0이면 칸 없음) */
  notRejudged?: number
}

/** 원장 요약 — 기록이 하나도 없으면(예전 잡) 칸 없음. K 라인 칸(scaleKept·notRejudged)은 0이면 두지 않는다(D·운영 기본 원장 키 그대로) */
export function gateStats(images: readonly Pick<SectionImage, 'gate' | 'gateBefore' | 'regenNotRejudged'>[]): GateStats | null {
  const records = images.flatMap((image) => [image.gateBefore, image.gate]).filter((r): r is GateRecord => Boolean(r))
  if (records.length === 0) return null
  const before = images.flatMap((image) => (image.gateBefore ? [image.gateBefore] : []))
  const reasons: Record<string, number> = {}
  for (const r of before) reasons[r.reason ?? '미상'] = (reasons[r.reason ?? '미상'] ?? 0) + 1
  const scaleKept = images.filter((image) => image.gate?.note === SCALE_KEPT_NOTE).length
  const notRejudged = images.filter((image) => image.regenNotRejudged).length
  return {
    judged: images.filter((image) => image.gate).length,
    regenerated: before.length,
    reasons,
    consistency: records.map((r) => r.consistency).filter((c): c is number => c !== null),
    ...(scaleKept > 0 ? { scaleKept } : {}),
    ...(notRejudged > 0 ? { notRejudged } : {}),
  }
}
