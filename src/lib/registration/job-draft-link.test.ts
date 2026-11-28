/**
 * 생성 잡의 초안 연결·사업장 결정 — 초안 사업장 상속, 불일치 400, 남의 초안 404, 남의 사업장 403.
 */

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveJobDraftLink } from './job-draft-link'

interface Tables {
  sourcing_registration_drafts: Array<{ id: string; user_id: string; business_id: string | null }>
  businesses: Array<{ id: string; user_id: string }>
}

/** eq 조건을 실제로 적용하는 작은 메모리 스텁 — user_id 필터를 빠뜨리면 남의 행이 잡혀 테스트가 실패한다 */
function memoryDb(tables: Tables, calls: Array<{ table: string; eqs: Array<[string, unknown]> }>): SupabaseClient {
  return {
    from(table: keyof Tables) {
      const eqs: Array<[string, unknown]> = []
      calls.push({ table, eqs })
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq(col: string, val: unknown) {
          eqs.push([col, val])
          return builder
        },
        limit: () => builder,
        then(resolve: (v: { data: unknown[]; error: null }) => void) {
          const rows = (tables[table] as Array<Record<string, unknown>>).filter((r) =>
            eqs.every(([c, v]) => r[c] === v)
          )
          resolve({ data: rows, error: null })
        },
      }
      return builder
    },
  } as unknown as SupabaseClient
}

const tables: Tables = {
  sourcing_registration_drafts: [
    { id: 'draft-a', user_id: 'owner', business_id: 'biz-a' },
    { id: 'draft-none', user_id: 'owner', business_id: null },
    { id: 'draft-other', user_id: 'someone', business_id: 'biz-x' },
  ],
  businesses: [
    { id: 'biz-a', user_id: 'owner' },
    { id: 'biz-b', user_id: 'owner' },
    { id: 'biz-x', user_id: 'someone' },
  ],
}

describe('resolveJobDraftLink', () => {
  it('사업장을 따로 주지 않으면 초안 사업장을 물려받는다', async () => {
    const calls: Array<{ table: string; eqs: Array<[string, unknown]> }> = []
    const link = await resolveJobDraftLink(memoryDb(tables, calls), 'owner', { draftId: 'draft-a' })
    expect(link).toEqual({ ok: true, draftId: 'draft-a', businessId: 'biz-a' })
    expect(calls[0].eqs).toContainEqual(['user_id', 'owner'])
  })

  it('초안 사업장과 다른 사업장을 실으면 400', async () => {
    const link = await resolveJobDraftLink(memoryDb(tables, []), 'owner', { draftId: 'draft-a', businessId: 'biz-b' })
    expect(link).toMatchObject({ ok: false, status: 400 })
  })

  it('사업장 없는 초안에 오너 사업장을 실으면 그 사업장으로', async () => {
    const link = await resolveJobDraftLink(memoryDb(tables, []), 'owner', { draftId: 'draft-none', businessId: 'biz-b' })
    expect(link).toEqual({ ok: true, draftId: 'draft-none', businessId: 'biz-b' })
  })

  it('남의 초안은 찾지 못한다(404)', async () => {
    const link = await resolveJobDraftLink(memoryDb(tables, []), 'owner', { draftId: 'draft-other' })
    expect(link).toMatchObject({ ok: false, status: 404 })
  })

  it('초안 없이 남의 사업장을 실으면 403', async () => {
    const link = await resolveJobDraftLink(memoryDb(tables, []), 'owner', { businessId: 'biz-x' })
    expect(link).toMatchObject({ ok: false, status: 403 })
  })

  it('초안도 사업장도 없으면 둘 다 null', async () => {
    const link = await resolveJobDraftLink(memoryDb(tables, []), 'owner', {})
    expect(link).toEqual({ ok: true, draftId: null, businessId: null })
  })
})
