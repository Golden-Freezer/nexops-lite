/**
 * 잡 진행 잠금(속도 개선 1차, DDL 없음) — updated_at 조건부 갱신으로 같은 잡을 두 곳이 동시에 쥐지 못한다.
 * Supabase는 조건(eq)을 실제로 적용하는 가짜 행 하나로 대신한다(DB 호출 0).
 */

import { describe, expect, it } from 'vitest'
import {
  PDP_RUN_LEASE_MS,
  PdpLeaseLostError,
  claimPdpJobRun,
  isPdpJobLeased,
  jobUpdatedAt,
  updatePdpJob,
  updatePdpJobIfUnchanged,
} from './pdp-jobs'

/** registration_pdp_jobs 한 행 — update().eq()...select()의 조건을 실제로 따진다. trigger: updated_at을 덮어쓰는 트리거 */
function fakeDb(row: Record<string, unknown>, trigger?: () => string) {
  const updates: Array<Record<string, unknown>> = []
  const db = {
    from: () => {
      let patch: Record<string, unknown> = {}
      const conds: Array<[string, unknown]> = []
      const builder = {
        update(fields: Record<string, unknown>) {
          patch = fields
          return builder
        },
        eq(column: string, value: unknown) {
          conds.push([column, value])
          return builder
        },
        // select()는 바로 기다리거나(claim) .single()로 이어진다(updatePdpJob). single()이 0행이면 postgrest-js처럼
        // 406 PGRST116 오류를 돌려준다
        select() {
          return {
            then: (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) =>
              builder.result().then(resolve, reject),
            single: () =>
              builder.result().then((r) =>
                r.data.length === 1
                  ? { data: r.data[0], error: null }
                  : {
                      data: null,
                      error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
                    }
              ),
          }
        },
        async result() {
          const matched = conds.every(([column, value]) => row[column] === value)
          if (!matched) return { data: [], error: null }
          Object.assign(row, patch)
          if (trigger) row.updated_at = trigger()
          updates.push(patch)
          return { data: [{ ...row }], error: null }
        },
      }
      return builder
    },
  }
  return { db: db as never, row, updates }
}

const NOW = Date.parse('2026-10-28T10:00:00.000Z')
const baseRow = (updatedAt: string) => ({
  id: 'job-1',
  user_id: 'user-1',
  current_step: 'images',
  section_images: [],
  updated_at: updatedAt,
})

describe('잡 진행 잠금 — claimPdpJobRun', () => {
  it('읽은 updated_at이 그대로면 잠금 기한(지금 + 340초)을 쓴다', async () => {
    const { db, row } = fakeDb(baseRow('2026-10-28T09:59:00.000Z'))
    const claimed = await claimPdpJobRun(db, 'user-1', { id: 'job-1', updated_at: '2026-10-28T09:59:00.000Z' }, NOW)
    expect(claimed?.leaseUntil).toBe(new Date(NOW + PDP_RUN_LEASE_MS).toISOString())
    expect(row.updated_at).toBe(claimed!.leaseUntil)
  })

  it('같은 값을 읽은 두 곳이 함께 쥐려 하면 하나만 쥔다(조건부 갱신 — 갱신된 행 0이면 null)', async () => {
    const read = { id: 'job-1', updated_at: '2026-10-28T09:59:00.000Z' }
    const { db } = fakeDb(baseRow(read.updated_at))
    const [a, b] = await Promise.all([claimPdpJobRun(db, 'user-1', read, NOW), claimPdpJobRun(db, 'user-1', read, NOW)])
    expect([a, b].filter(Boolean)).toHaveLength(1)
  })

  it('잠금 기한이 남아 있으면 쓰지 않고 null — 기한이 지난 잠금(504로 끝난 run)은 가져온다', async () => {
    const live = new Date(NOW + 200_000).toISOString()
    const { db, updates } = fakeDb(baseRow(live))
    expect(await claimPdpJobRun(db, 'user-1', { id: 'job-1', updated_at: live }, NOW)).toBeNull()
    expect(updates).toHaveLength(0)

    const expired = new Date(NOW - 1_000).toISOString()
    const second = fakeDb(baseRow(expired))
    expect(await claimPdpJobRun(second.db, 'user-1', { id: 'job-1', updated_at: expired }, NOW)).not.toBeNull()
  })
})

describe('잡 진행 잠금 — 유지·해제는 jobUpdatedAt 한 곳', () => {
  it('leaseUntil이 있으면 기한 유지(images 중간 저장), 없으면 지금(단계의 마지막 저장이 해제)', () => {
    expect(jobUpdatedAt({ leaseUntil: '2026-10-28T10:05:40.000Z' }, NOW)).toBe('2026-10-28T10:05:40.000Z')
    expect(jobUpdatedAt({}, NOW)).toBe(new Date(NOW).toISOString())
  })

  it('updatePdpJob이 같은 규칙으로 updated_at을 쓴다 — 중간 저장 뒤에도 다른 곳은 쥐지 못하고, 마지막 저장 뒤에는 쥔다', async () => {
    const { db, row } = fakeDb(baseRow('2026-10-28T09:59:00.000Z'))
    const claimed = (await claimPdpJobRun(db, 'user-1', { id: 'job-1', updated_at: row.updated_at as string }, NOW))!
    await updatePdpJob(db, 'user-1', 'job-1', { progress: 76, leaseUntil: claimed.leaseUntil! })
    expect(row.updated_at).toBe(claimed.leaseUntil)
    expect(isPdpJobLeased(row as never, NOW + 60_000)).toBe(true)
    expect(
      await claimPdpJobRun(db, 'user-1', { id: 'job-1', updated_at: row.updated_at as string }, NOW + 60_000)
    ).toBeNull()

    await updatePdpJob(db, 'user-1', 'job-1', { progress: 95, currentStep: 'compose' })
    expect(isPdpJobLeased(row as never)).toBe(false)
    expect(await claimPdpJobRun(db, 'user-1', { id: 'job-1', updated_at: row.updated_at as string })).not.toBeNull()
  })

  it('판단 여유: 지금보다 30초 안쪽의 미래 시각(다른 서버 인스턴스가 쓴 해제 시각)은 잠금이 아니다 — 실제 잠금은 310초', () => {
    expect(isPdpJobLeased({ updated_at: new Date(NOW + 20_000).toISOString() }, NOW)).toBe(false)
    expect(isPdpJobLeased({ updated_at: new Date(NOW + 40_000).toISOString() }, NOW)).toBe(true)
    // 잠금을 쥔 지 300초(run 상한) 뒤에도 아직 잠금, 310초를 넘으면 풀린다
    const lease = { updated_at: new Date(NOW + PDP_RUN_LEASE_MS).toISOString() }
    expect(isPdpJobLeased(lease, NOW + 300_000)).toBe(true)
    expect(isPdpJobLeased(lease, NOW + 311_000)).toBe(false)
  })
})

describe('잡 진행 잠금 — 잃은 잠금·쓸 수 없는 잠금', () => {
  it('기한이 지나 다른 곳이 쥐었으면 잠금을 실은 중간 저장은 덮어쓰지 않고 PdpLeaseLostError(0행)', async () => {
    const { db, row } = fakeDb(baseRow('2026-10-28T09:59:00.000Z'))
    const a = (await claimPdpJobRun(db, 'user-1', { id: 'job-1', updated_at: row.updated_at as string }, NOW))!
    // A가 기한(310초)을 넘겨 아직 돌고 있을 때 B가 쥔다
    const later = NOW + 315_000
    const b = (await claimPdpJobRun(db, 'user-1', { id: 'job-1', updated_at: row.updated_at as string }, later))!
    expect(b).not.toBeNull()
    await expect(
      updatePdpJob(db, 'user-1', 'job-1', { progress: 80, leaseUntil: a.leaseUntil! })
    ).rejects.toBeInstanceOf(PdpLeaseLostError)
    expect(row.updated_at).toBe(b.leaseUntil)
    expect(row.progress).toBeUndefined()
  })

  it('updated_at을 덮어쓰는 트리거가 있으면 기한이 남지 않는다 — 잠금 없이(leaseUntil null) 진행한다', async () => {
    const { db } = fakeDb(baseRow('2026-10-28T09:59:00.000Z'), () => new Date(NOW).toISOString())
    const claimed = await claimPdpJobRun(db, 'user-1', { id: 'job-1', updated_at: '2026-10-28T09:59:00.000Z' }, NOW)
    expect(claimed).not.toBeNull()
    expect(claimed!.leaseUntil).toBeNull()
  })
})

describe('잡 진행 잠금 — 0행 판별', () => {
  it('잠금 없는 저장의 0행(PGRST116)은 잠금 상실이 아니라 일반 갱신 실패다', async () => {
    const { db } = fakeDb(baseRow('2026-10-28T09:59:00.000Z'))
    const failure = updatePdpJob(db, 'user-1', 'job-other', { progress: 80 })
    await expect(failure).rejects.toThrow('PDP 잡 갱신 실패')
    await expect(failure).rejects.not.toBeInstanceOf(PdpLeaseLostError)
  })
})

describe('읽은 뒤 바뀌지 않았을 때만 갱신 — updatePdpJobIfUnchanged(편집기 재생성 요청)', () => {
  it('읽은 updated_at이 그대로면 쓰고 updated_at을 지금으로 둔다(잠금 아님)', async () => {
    const { db, row } = fakeDb(baseRow('2026-10-28T09:59:00.000Z'))
    const updated = await updatePdpJobIfUnchanged(
      db,
      'user-1',
      { id: 'job-1', updated_at: '2026-10-28T09:59:00.000Z' },
      { currentStep: 'images', progress: 75 }
    )
    expect(updated).not.toBeNull()
    expect(row.current_step).toBe('images')
    expect(row.progress).toBe(75)
    expect(isPdpJobLeased({ updated_at: row.updated_at as string })).toBe(false)
  })

  it('그사이 run이 쥐었거나 저장했으면 쓰지 않고 null — 다른 사용자의 잡도 0행이다', async () => {
    const { db, row } = fakeDb(baseRow('2026-10-28T09:59:00.000Z'))
    const claimed = (await claimPdpJobRun(db, 'user-1', { id: 'job-1', updated_at: row.updated_at as string }, NOW))!
    const stale = await updatePdpJobIfUnchanged(
      db,
      'user-1',
      { id: 'job-1', updated_at: '2026-10-28T09:59:00.000Z' },
      { currentStep: 'compose', progress: 75 }
    )
    expect(stale).toBeNull()
    expect(row.updated_at).toBe(claimed.leaseUntil)
    expect(row.current_step).toBe('images')
    expect(row.progress).toBeUndefined()
    const other = await updatePdpJobIfUnchanged(db, 'user-2', { id: 'job-1', updated_at: row.updated_at as string }, { progress: 1 })
    expect(other).toBeNull()
    expect(row.progress).toBeUndefined()
  })
})
