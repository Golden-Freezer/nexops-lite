import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPdpJob } from '@/lib/registration/pdp-jobs'
import { GET } from './route'

vi.mock('@/lib/auth/clerk', () => ({
  requireOwner: vi.fn().mockResolvedValue('user-1'),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/registration/pdp-jobs', () => ({
  getPdpJob: vi.fn(),
}))

const JOB = '6bbc4fa8-1111-4222-8333-444455556666'

type ListCall = { folder: string; options: Record<string, unknown> }

/** paged=true면 실제 스토리지처럼 offset·limit만큼 잘라 준다(기본은 받은 목록을 그대로) */
function fakeStorage(files: Array<Record<string, unknown>>, paged = false) {
  const calls: ListCall[] = []
  const bucket = {
    list: vi.fn(async (folder: string, options: Record<string, unknown>) => {
      calls.push({ folder, options })
      const { offset, limit } = options as { offset: number; limit: number }
      return { data: paged ? files.slice(offset, offset + limit) : files, error: null }
    }),
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
  }
  const db = { storage: { from: vi.fn(() => bucket) } }
  vi.mocked(createAdminClient).mockReturnValue(db as never)
  return calls
}

const file = (name: string, created = '2026-10-29T01:00:00Z', size = 1234) => ({
  id: `id-${name}`,
  name,
  created_at: created,
  metadata: { size },
})

function req(query: string) {
  return new NextRequest(`http://localhost/api/registration/editor/images${query}`)
}

describe('GET /api/registration/editor/images', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uploads: 서버 userId의 업로드 폴더만 최근 것부터 읽고, 하위 폴더·이미지 아닌 파일은 뺀다', async () => {
    const calls = fakeStorage([
      file('b.png'),
      { id: null, name: 'nested', created_at: null, metadata: null },
      file('notes.txt'),
      file('a.jpg'),
    ])
    const res = await GET(req('?userId=user-2&limit=10'))
    expect(res.status).toBe(200)
    expect(calls).toEqual([
      { folder: 'user-1/registration/editor-uploads', options: { limit: 11, offset: 0, sortBy: { column: 'created_at', order: 'desc' } } },
    ])
    const body = await res.json()
    expect(body.hasMore).toBe(false)
    expect(body.nextOffset).toBe(4)
    expect(body.items).toEqual([
      { name: 'b.png', url: 'https://cdn.test/user-1/registration/editor-uploads/b.png', createdAt: '2026-10-29T01:00:00Z', size: 1234, kind: 'upload' },
      { name: 'a.jpg', url: 'https://cdn.test/user-1/registration/editor-uploads/a.jpg', createdAt: '2026-10-29T01:00:00Z', size: 1234, kind: 'upload' },
    ])
  })

  it('limit보다 하나 더 오면 다음 쪽이 있다고 알리고 limit개만 돌려준다', async () => {
    fakeStorage([file('1.png'), file('2.png'), file('3.png')])
    const body = await (await GET(req('?limit=2&offset=4'))).json()
    expect(body.hasMore).toBe(true)
    expect(body.nextOffset).toBe(6)
    expect(body.items.map((i: { name: string }) => i.name)).toEqual(['1.png', '2.png'])
  })

  it('쪽 경계에 하위 폴더·비이미지가 섞여도 이미지로 쪽을 채우고, nextOffset으로 이어 읽으면 빠짐·중복이 없다', async () => {
    const folder = (name: string) => ({ id: null, name, created_at: null, metadata: null })
    fakeStorage([file('a.png'), folder('detail-page'), file('notes.txt'), file('b.png'), file('c.png')], true)
    const pages: string[][] = []
    let offset = 0
    for (let n = 0; n < 5; n++) {
      const body = await (await GET(req(`?limit=1&offset=${offset}`))).json()
      pages.push(body.items.map((i: { name: string }) => i.name))
      if (!body.hasMore) break
      offset = body.nextOffset
    }
    expect(pages).toEqual([['a.png'], ['b.png'], ['c.png']])
  })

  it('뒤에 하위 폴더만 남으면 다음 쪽이 없다고 알린다(빈 다음 쪽을 만들지 않는다)', async () => {
    const folder = (name: string) => ({ id: null, name, created_at: null, metadata: null })
    fakeStorage([file('a.png'), file('b.png'), folder('detail-page'), folder('composite')], true)
    const body = await (await GET(req('?limit=2'))).json()
    expect(body.items.map((i: { name: string }) => i.name)).toEqual(['a.png', 'b.png'])
    expect(body.hasMore).toBe(false)
    expect(body.nextOffset).toBe(4)
  })

  it('이미지 없는 항목이 아주 많으면 읽기 상한(5번)에서 멈추고 남은 목록은 다음 쪽으로 넘긴다', async () => {
    const calls = fakeStorage([...Array.from({ length: 20 }, (_, i) => file(`log-${i}.txt`)), file('late.png')], true)
    const body = await (await GET(req('?limit=1'))).json()
    expect(calls).toHaveLength(5)
    expect(body).toMatchObject({ items: [], hasMore: true, nextOffset: 10 })
  })

  it('job: 잡 소유를 먼저 확인하고, 그 잡 폴더의 생성 컷·썸네일을 종류와 함께 준다(detail-page 폴더 제외)', async () => {
    vi.mocked(getPdpJob).mockResolvedValue({ id: JOB } as never)
    const calls = fakeStorage([
      file('pdp-hero-1.png'),
      file('thumb-main-2.jpg'),
      { id: null, name: 'detail-page', created_at: null, metadata: null },
    ])
    const body = await (await GET(req(`?scope=job&jobId=${JOB}`))).json()
    expect(vi.mocked(getPdpJob).mock.calls[0].slice(1)).toEqual(['user-1', JOB])
    expect(calls[0].folder).toBe(`user-1/registration/${JOB}`)
    expect(body.items.map((i: { kind: string }) => i.kind)).toEqual(['section', 'thumbnail'])
  })

  it('job: 남의 잡(소유 확인 실패)은 404이고 스토리지를 읽지 않는다', async () => {
    vi.mocked(getPdpJob).mockResolvedValue(null)
    const calls = fakeStorage([file('pdp-hero.png')])
    const res = await GET(req(`?scope=job&jobId=${JOB}`))
    expect(res.status).toBe(404)
    expect(calls).toEqual([])
  })

  it('잘못된 jobId(경로 넘기기 포함)·scope·limit은 400이고 아무것도 읽지 않는다', async () => {
    const calls = fakeStorage([file('x.png')])
    for (const q of ['?scope=job&jobId=../user-2/registration', '?scope=job', '?scope=all', '?limit=0', '?limit=101', '?offset=-1', '?limit=abc']) {
      const res = await GET(req(q))
      expect(res.status, q).toBe(400)
    }
    expect(calls).toEqual([])
    expect(getPdpJob).not.toHaveBeenCalled()
  })
})
