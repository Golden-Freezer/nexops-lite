import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireAuthOrApiKey: vi.fn(),
  createAdminClient: vi.fn(),
  requireOwnedBusinessId: vi.fn(),
  runAdReportImport: vi.fn(),
  runImport: vi.fn(),
}))

vi.mock('@/lib/auth/clerk', () => ({
  requireAuthOrApiKey: mocks.requireAuthOrApiKey,
}))
vi.mock('@/lib/auth/business', () => ({
  requireOwnedBusinessId: mocks.requireOwnedBusinessId,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}))
vi.mock('@/lib/import/ad-report', () => ({
  AdReportParseError: class extends Error {},
  runAdReportImport: mocks.runAdReportImport,
}))
vi.mock('@/lib/import/process', () => ({ runImport: mocks.runImport }))

import { POST } from './route'

function fileRequest(file: File): NextRequest {
  const formData = new FormData()
  formData.append('file', file)
  return new NextRequest('http://localhost/api/import/file', {
    method: 'POST',
    body: formData,
  })
}

describe('POST /api/import/file 입력 제한', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAuthOrApiKey.mockResolvedValue('user-1')
  })

  it('여러 날짜의 Statistics 파일을 400으로 거부한다', async () => {
    const request = fileRequest(new File(
      ['not-opened'],
      'Statistics-20261101~20261102_(0).xlsx',
    ))

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toContain('하루치 파일만')
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('10MB를 초과한 파일을 413으로 거부한다', async () => {
    const request = fileRequest(new File(
      [new Uint8Array(10 * 1024 * 1024 + 1)],
      'inventory_health_sku_info_20261127.xlsx',
    ))

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error).toContain('최대 10MB')
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
})
