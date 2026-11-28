import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/sourcing/registration/businesses', () => ({
  getVendorIdForBusiness: vi.fn(),
}))
// openapi-target 이 기본값으로 끌어오는 실제 키 로더는 부르지 않는다(시험은 가짜 loadEnv 를 넘긴다)
vi.mock('../../../scripts/coupang-openapi/env.mjs', () => ({ loadOpenApiEnv: vi.fn() }))

import { getVendorIdForBusiness } from '@/lib/sourcing/registration/businesses'
import { MissingVendorError, OpenApiKeysError, openApiEnvForBusiness } from './openapi-target'

const db = {} as SupabaseClient
const vendorLookup = vi.mocked(getVendorIdForBusiness)

const fakeEnv = (vendorId: string) => ({ host: 'h', accessKey: 'ak', secretKey: 'sk', vendorId })

describe('openApiEnvForBusiness', () => {
  it('그 사업장의 벤더코드로만 loadEnv 를 부른다', async () => {
    vendorLookup.mockResolvedValueOnce('A0002')
    const loadEnv = vi.fn((_root: string, opts: { vendorId: string }) => fakeEnv(opts.vendorId))
    const env = await openApiEnvForBusiness(db, 'user-1', 'b-two', loadEnv)
    expect(vendorLookup).toHaveBeenLastCalledWith(db, 'user-1', 'b-two')
    expect(loadEnv).toHaveBeenCalledTimes(1)
    expect(loadEnv.mock.calls[0][1]).toEqual({ vendorId: 'A0002', requireApiKeys: true, requireDb: false })
    expect(env.vendorId).toBe('A0002')
  })

  it('사업장이 없으면 던지고 loadEnv 는 부르지 않는다', async () => {
    const loadEnv = vi.fn()
    await expect(openApiEnvForBusiness(db, 'user-1', null, loadEnv)).rejects.toBeInstanceOf(MissingVendorError)
    await expect(openApiEnvForBusiness(db, 'user-1', undefined, loadEnv)).rejects.toBeInstanceOf(MissingVendorError)
    expect(loadEnv).not.toHaveBeenCalled()
  })

  it('벤더코드가 없으면 던지고 loadEnv 는 부르지 않는다 — 기본 벤더로 떨어지지 않음', async () => {
    vendorLookup.mockResolvedValueOnce(null)
    const loadEnv = vi.fn()
    await expect(openApiEnvForBusiness(db, 'user-1', 'b-novendor', loadEnv)).rejects.toBeInstanceOf(MissingVendorError)
    expect(loadEnv).not.toHaveBeenCalled()
  })

  it('키를 못 불러오면 어느 벤더코드였는지 담아 던진다', async () => {
    vendorLookup.mockResolvedValueOnce('A0003')
    const loadEnv = vi.fn(() => {
      throw new Error('키 없음')
    })
    const err = await openApiEnvForBusiness(db, 'user-1', 'b-three', loadEnv).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OpenApiKeysError)
    expect((err as OpenApiKeysError).vendorId).toBe('A0003')
  })

  it('벤더코드 조회 자체가 실패하면 그대로 던진다(분류 안 함)', async () => {
    vendorLookup.mockRejectedValueOnce(new Error('조회 실패'))
    const loadEnv = vi.fn()
    await expect(openApiEnvForBusiness(db, 'user-1', 'b', loadEnv)).rejects.toThrow('조회 실패')
    expect(loadEnv).not.toHaveBeenCalled()
  })
})
