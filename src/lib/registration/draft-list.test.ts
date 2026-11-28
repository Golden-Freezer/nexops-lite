/**
 * 등록 대기 목록 — listDrafts 서버 페이지(user_id 격리·상태 필터·range·전체 개수)와 목록 한 줄 변환.
 */

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { emptyForm } from '@/lib/sourcing/registration/form'
import { listDrafts, type RegistrationDraft } from '@/lib/sourcing/registration/drafts'
import { parseDraftPage, parseDraftStatus, toDraftListItem } from './draft-list'

interface Captured {
  selectOpts?: unknown
  eqs: Array<[string, unknown]>
  range?: [number, number]
}

function stub(captured: Captured, total: number): SupabaseClient {
  const builder: Record<string, unknown> = {
    select(_cols: string, opts?: unknown) {
      captured.selectOpts = opts
      return builder
    },
    eq(col: string, val: unknown) {
      captured.eqs.push([col, val])
      return builder
    },
    order() {
      return builder
    },
    range(from: number, to: number) {
      captured.range = [from, to]
      return builder
    },
    then(resolve: (v: { data: unknown[]; error: null; count: number }) => void) {
      resolve({
        data: [
          {
            id: 'd1',
            business_id: 'biz-a',
            keyword: '키워드',
            sourcing_product_id: 'sp-1',
            form: { productName: '상품' },
            status: 'ready',
            created_at: null,
            updated_at: '2026-10-28T00:00:00Z',
          },
        ],
        error: null,
        count: total,
      })
    },
  }
  return { from: () => builder } as unknown as SupabaseClient
}

describe('listDrafts — 서버 페이지', () => {
  it('user_id로 거르고 range로 한 페이지만, 전체 개수는 count exact', async () => {
    const captured: Captured = { eqs: [] }
    const { drafts, total } = await listDrafts(stub(captured, 57), 'user-1', { limit: 20, offset: 40 })
    expect(captured.eqs).toContainEqual(['user_id', 'user-1'])
    expect(captured.selectOpts).toEqual({ count: 'exact' })
    expect(captured.range).toEqual([40, 59])
    expect(total).toBe(57)
    expect(drafts[0].status).toBe('ready')
    expect(drafts[0].form.content.heroImages).toEqual([]) // 누락 필드는 빈 폼 기본값
  })

  it('상태 필터를 서버 조건으로 건다', async () => {
    const captured: Captured = { eqs: [] }
    await listDrafts(stub(captured, 1), 'user-1', { status: 'draft' })
    expect(captured.eqs).toContainEqual(['status', 'draft'])
  })

  it('limit는 1~100으로 자른다', async () => {
    const captured: Captured = { eqs: [] }
    await listDrafts(stub(captured, 1), 'user-1', { limit: 5000, offset: -3 })
    expect(captured.range).toEqual([0, 99])
  })
})

function draft(over: Partial<RegistrationDraft> = {}): RegistrationDraft {
  return {
    id: 'd1',
    businessId: 'biz-a',
    keyword: '물티슈',
    sourcingProductId: 'sp-1',
    form: emptyForm(),
    status: 'draft',
    createdAt: null,
    updatedAt: '2026-10-28T00:00:00Z',
    ...over,
  }
}

describe('toDraftListItem', () => {
  it('사업장 이름은 오너 소유 목록에서만 붙인다', () => {
    const names = new Map([['biz-a', '페어넥스']])
    expect(toDraftListItem(draft(), names).businessName).toBe('페어넥스')
    expect(toDraftListItem(draft({ businessId: 'biz-x' }), names).businessName).toBeNull()
    expect(toDraftListItem(draft({ businessId: null }), names).businessName).toBeNull()
  })

  it('상품명이 비면 키워드, 대표이미지·상세페이지 산출 여부를 표시한다', () => {
    const form = emptyForm()
    form.content = { heroImages: ['', 'https://a.test/h.png'], detailImages: [], detailHtml: null, detailPageSections: ['s.png'] }
    const item = toDraftListItem(draft({ form }), new Map())
    expect(item.productName).toBe('물티슈')
    expect(item.heroImage).toBe('https://a.test/h.png')
    expect(item.hasDetailPage).toBe(true)
    expect(toDraftListItem(draft(), new Map()).hasDetailPage).toBe(false)
  })

  it('목록 한 줄에는 상세 HTML 같은 큰 값을 싣지 않는다', () => {
    const form = emptyForm()
    form.content.detailHtml = '<div>매우 긴 상세</div>'
    const item = toDraftListItem(draft({ form }), new Map())
    expect(JSON.stringify(item)).not.toContain('매우 긴 상세')
    expect(item.hasDetailPage).toBe(true)
  })
})

describe('쿼리 파싱', () => {
  it('page는 1 이상 정수, status는 draft·ready만', () => {
    expect(parseDraftPage(null)).toBe(1)
    expect(parseDraftPage('0')).toBe(1)
    expect(parseDraftPage('3')).toBe(3)
    expect(parseDraftStatus('ready')).toBe('ready')
    expect(parseDraftStatus('all')).toBeUndefined()
  })
})
