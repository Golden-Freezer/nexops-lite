/**
 * GET /api/registration/pdp/own-products(J51) — 사업장 필수(400)·남의 사업장(403)·목록은 user_id·business_id로 읽는다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const owned = { value: true }
const listOwnListings = vi.fn(async () => [{ productId: '15969912606', name: '구디백', options: [] }])

vi.mock('@/lib/auth/clerk', () => ({ requireOwner: vi.fn(async () => 'user-1') }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const b = { select: () => b, eq: () => b, limit: async () => ({ data: owned.value ? [{ id: 'biz-1' }] : [], error: null }) }
      return b
    },
  }),
}))
vi.mock('@/lib/registration/own-sales-load', () => ({ listOwnListings: (...args: unknown[]) => listOwnListings(...(args as [])) }))

import { GET } from './route'

const req = (qs: string) => new NextRequest(`http://localhost/api/registration/pdp/own-products${qs}`)

describe('GET own-products', () => {
  beforeEach(() => {
    owned.value = true
    listOwnListings.mockClear()
  })

  it('사업장이 없으면 400', async () => {
    const res = await GET(req(''))
    expect(res.status).toBe(400)
    expect(listOwnListings).not.toHaveBeenCalled()
  })

  it('남의 사업장이면 403', async () => {
    owned.value = false
    const res = await GET(req('?businessId=biz-9'))
    expect(res.status).toBe(403)
    expect(listOwnListings).not.toHaveBeenCalled()
  })

  it('본인 사업장이면 목록 — 검색어는 다듬어 넘긴다', async () => {
    const res = await GET(req('?businessId=biz-1&q=%20%EA%B5%AC%EB%94%94%EB%B0%B1%20'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ listings: [{ productId: '15969912606', name: '구디백', options: [] }] })
    expect(listOwnListings).toHaveBeenCalledWith(expect.anything(), 'user-1', 'biz-1', '구디백')
  })
})
