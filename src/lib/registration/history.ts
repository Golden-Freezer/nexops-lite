/**
 * 생성 히스토리 — 대표이미지 잡과 상세페이지(PDP) 잡을 생성 시각 하나로 합친 페이지.
 *
 * 두 표를 따로 limit+1개씩 읽어(같은 before 커서) 합친 뒤 앞에서 limit개만 돌려준다. 각 표에서 limit+1개를
 * 읽었으므로 합친 상위 limit개는 두 표 전체의 상위 limit개와 같고, 남는 행이 있으면 다음 페이지가 있다.
 * 다음 커서는 이번 페이지 마지막 행의 created_at — 다음 조회는 그보다 앞선 행만 읽는다.
 */

import type { ThumbnailJob } from './thumbnail-types'
import type { PdpJobRow } from './pdp-state'

export type HistoryEntry =
  | { kind: 'thumbnail'; id: string; createdAt: string; businessId: string | null; job: ThumbnailJob }
  | { kind: 'pdp'; id: string; createdAt: string; businessId: string | null; job: PdpJobRow }

export interface HistoryPage {
  entries: HistoryEntry[]
  /** 다음 페이지 커서(created_at). 더 없으면 null */
  nextBefore: string | null
}

export const HISTORY_PAGE_DEFAULT = 20
export const HISTORY_PAGE_MAX = 50

/** 쿼리 문자열 limit → 1~HISTORY_PAGE_MAX 정수 */
export function clampHistoryLimit(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(n) || n < 1) return HISTORY_PAGE_DEFAULT
  return Math.min(n, HISTORY_PAGE_MAX)
}

/** before 커서 검증 — ISO 시각으로 해석되는 값만 쓴다(임의 문자열을 쿼리에 넣지 않음) */
export function parseHistoryCursor(raw: string | null | undefined): string | null {
  if (!raw) return null
  const t = Date.parse(raw)
  return Number.isFinite(t) ? raw : null
}

/** 두 목록(각각 limit+1개까지, 최신순)을 합쳐 limit개 페이지와 다음 커서를 만든다. */
export function mergeHistoryPage(thumbnails: ThumbnailJob[], pdps: PdpJobRow[], limit: number): HistoryPage {
  const merged: HistoryEntry[] = [
    ...thumbnails.map((job) => ({
      kind: 'thumbnail' as const,
      id: job.id,
      createdAt: job.createdAt,
      businessId: job.businessId ?? null,
      job,
    })),
    ...pdps.map((job) => ({
      kind: 'pdp' as const,
      id: job.id,
      createdAt: job.created_at,
      businessId: job.business_id ?? null,
      job,
    })),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))

  const entries = merged.slice(0, limit)
  const hasMore = merged.length > limit
  return { entries, nextBefore: hasMore && entries.length > 0 ? entries[entries.length - 1].createdAt : null }
}
