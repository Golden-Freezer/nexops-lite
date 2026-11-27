import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { pdpStorageObjectExists, uploadPdpImage } from './storage'

describe('PDP 이미지 스토리지 확인', () => {
  it('업로드 응답에 저장 경로가 없으면 URL을 만들지 않고 실패한다', async () => {
    const getPublicUrl = vi.fn()
    const bucket = {
      upload: vi.fn(async () => ({ data: null, error: null })),
      getPublicUrl,
    }
    const db = { storage: { from: vi.fn(() => bucket) } } as unknown as SupabaseClient

    await expect(uploadPdpImage(db, 'user-1', 'job-1', 'hero', 'AA==', 'image/png'))
      .rejects.toThrow('저장 경로를 확인하지 못했습니다')
    expect(getPublicUrl).not.toHaveBeenCalled()
  })

  it('USP 카탈로그 객체는 정확한 파일명이 스토리지에 있을 때만 성공한다', async () => {
    const bucket = {
      list: vi.fn(async () => ({ data: [{ name: 'icon.png' }], error: null })),
    }
    const db = { storage: { from: vi.fn(() => bucket) } } as unknown as SupabaseClient

    await expect(pdpStorageObjectExists(db, 'user/registration/icon-library/icon.png')).resolves.toBe(true)
    await expect(pdpStorageObjectExists(db, 'user/registration/icon-library/missing.png')).resolves.toBe(false)
  })
})
