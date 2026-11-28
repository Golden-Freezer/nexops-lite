/**
 * 생성 히스토리 병합 페이지 — 두 잡 표를 생성 시각 하나로 합치고, 다음 커서를 이번 페이지 마지막 시각으로 준다.
 * 옛 화면은 각 표 30건을 따로 잘라 합쳐서 31번째 이후가 영영 보이지 않았다(01_REVIEW §4 히스토리).
 */

import { describe, expect, it } from 'vitest'
import type { ThumbnailJob } from './thumbnail-types'
import type { PdpJobRow } from './pdp-state'
import { clampHistoryLimit, mergeHistoryPage, parseHistoryCursor } from './history'

function thumb(id: string, createdAt: string, businessId: string | null = null): ThumbnailJob {
  return { id, createdAt, businessId } as unknown as ThumbnailJob
}

function pdp(id: string, createdAt: string, businessId: string | null = null): PdpJobRow {
  return { id, created_at: createdAt, business_id: businessId } as unknown as PdpJobRow
}

describe('mergeHistoryPage', () => {
  it('두 표를 최신순으로 섞고 limit개만 돌려준다', () => {
    const page = mergeHistoryPage(
      [thumb('t1', '2026-10-28T10:00:00Z'), thumb('t2', '2026-10-28T08:00:00Z'), thumb('t3', '2026-10-28T06:00:00Z')],
      [pdp('p1', '2026-10-28T09:00:00Z'), pdp('p2', '2026-10-28T07:00:00Z'), pdp('p3', '2026-10-28T05:00:00Z')],
      2
    )
    expect(page.entries.map((e) => e.id)).toEqual(['t1', 'p1'])
    expect(page.nextBefore).toBe('2026-10-28T09:00:00Z')
  })

  it('남는 행이 없으면 다음 커서가 없다', () => {
    const page = mergeHistoryPage([thumb('t1', '2026-10-28T10:00:00Z')], [pdp('p1', '2026-10-28T09:00:00Z')], 2)
    expect(page.entries).toHaveLength(2)
    expect(page.nextBefore).toBeNull()
  })

  it('페이지를 이어 읽으면 빠지거나 겹치는 행이 없다', () => {
    const thumbs = ['10', '08', '06', '04'].map((h, i) => thumb(`t${i}`, `2026-10-28T${h}:00:00Z`))
    const pdps = ['09', '07', '05', '03'].map((h, i) => pdp(`p${i}`, `2026-10-28T${h}:00:00Z`))
    const seen: string[] = []
    let before: string | null = null
    for (let round = 0; round < 10; round++) {
      // 서버가 하는 일: 커서보다 앞선 행을 각 표에서 limit+1개까지
      const cut = (iso: string) => !before || Date.parse(iso) < Date.parse(before)
      const limit = 3
      const page = mergeHistoryPage(
        thumbs.filter((t) => cut(t.createdAt)).slice(0, limit + 1),
        pdps.filter((p) => cut(p.created_at)).slice(0, limit + 1),
        limit
      )
      seen.push(...page.entries.map((e) => e.id))
      if (!page.nextBefore) break
      before = page.nextBefore
    }
    expect(seen).toEqual(['t0', 'p0', 't1', 'p1', 't2', 'p2', 't3', 'p3'])
  })

  it('행마다 잡의 사업장을 싣는다', () => {
    const page = mergeHistoryPage([thumb('t1', '2026-10-28T10:00:00Z', 'biz-a')], [pdp('p1', '2026-10-28T09:00:00Z')], 5)
    expect(page.entries.map((e) => e.businessId)).toEqual(['biz-a', null])
  })
})

describe('쿼리 파싱', () => {
  it('limit는 1~50, 이상값은 기본 20', () => {
    expect(clampHistoryLimit(null)).toBe(20)
    expect(clampHistoryLimit('0')).toBe(20)
    expect(clampHistoryLimit('abc')).toBe(20)
    expect(clampHistoryLimit('7')).toBe(7)
    expect(clampHistoryLimit('999')).toBe(50)
  })

  it('before는 시각으로 해석되는 값만 받는다', () => {
    expect(parseHistoryCursor('2026-10-28T09:00:00.123456+00:00')).toBe('2026-10-28T09:00:00.123456+00:00')
    expect(parseHistoryCursor('not-a-date')).toBeNull()
    expect(parseHistoryCursor('')).toBeNull()
  })
})
