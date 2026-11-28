/**
 * 공식 연동(쿠팡 OpenAPI) 키 고르기(AX-CT-18) — 초안 사업장의 벤더코드로만 키를 고른다.
 * loadOpenApiEnv 는 벤더코드를 안 주면 환경 변수·기본 벤더로 떨어지므로, 이 함수가 그 길을 막는다.
 * 사업장이 없거나 벤더코드가 없으면 loadEnv 를 부르지 않고 던진다. 쓰기 코드는 여기에 두지 않는다(AX-CT-19 몫).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getVendorIdForBusiness } from '@/lib/sourcing/registration/businesses'
import { loadOpenApiEnv } from '../../../scripts/coupang-openapi/env.mjs'

export interface OpenApiEnv {
  host: string
  accessKey: string
  secretKey: string
  vendorId: string
}

export type OpenApiEnvLoader = (
  rootDir: string,
  options: { vendorId: string; requireApiKeys: boolean; requireDb: boolean }
) => OpenApiEnv

/** 사업장에 벤더코드가 없을 때 — 호출부가 400 으로 바꿀 수 있게 구분한다 */
export class MissingVendorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MissingVendorError'
  }
}

/** 그 사업장 벤더코드의 키를 못 불러왔을 때(키 미설정·미등록 벤더) — 어느 벤더코드였는지 함께 든다 */
export class OpenApiKeysError extends Error {
  readonly vendorId: string
  constructor(vendorId: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : '쿠팡 API 키를 불러오지 못했습니다.')
    this.name = 'OpenApiKeysError'
    this.vendorId = vendorId
  }
}

export async function openApiEnvForBusiness(
  db: SupabaseClient,
  userId: string,
  businessId: string | null | undefined,
  loadEnv: OpenApiEnvLoader = loadOpenApiEnv as unknown as OpenApiEnvLoader
): Promise<OpenApiEnv> {
  if (!businessId) throw new MissingVendorError('등록 대상 사업장이 없습니다.')
  const vendorId = await getVendorIdForBusiness(db, userId, businessId)
  if (!vendorId) throw new MissingVendorError('사업장에 쿠팡 벤더코드가 없습니다.')
  try {
    return loadEnv(process.cwd(), { vendorId, requireApiKeys: true, requireDb: false })
  } catch (err) {
    throw new OpenApiKeysError(vendorId, err)
  }
}
