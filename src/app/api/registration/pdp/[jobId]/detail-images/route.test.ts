import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getPdpJob } from '@/lib/registration/pdp-jobs'
import { setDraftDetailPageImages } from '@/lib/sourcing/registration/drafts'
import { POST } from './route'

const PUBLIC = 'https://store.example/storage/v1/object/public/sourcing-product-images/'
const uploaded = new Map<string, { size: number; mimetype: string }>()
const put = (...names: string[]) => names.forEach((n) => uploaded.set(n, { size: 1000, mimetype: 'image/jpeg' }))
const signed: string[] = []

const storageStub = {
  from: () => ({
    getPublicUrl: (path: string) => ({ data: { publicUrl: PUBLIC + path } }),
    createSignedUploadUrl: async (path: string) => {
      signed.push(path)
      return { data: { token: `tok:${path}`, signedUrl: `https://signed/${path}`, path }, error: null }
    },
    list: async () => ({
      data: [...uploaded].map(([name, meta]) => ({ name, metadata: meta })),
      error: null,
    }),
  }),
}

vi.mock('@/lib/auth/clerk', () => ({ requireOwner: vi.fn().mockResolvedValue('user-1') }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ storage: storageStub })) }))
vi.mock('@/lib/registration/pdp-jobs', () => ({ getPdpJob: vi.fn() }))
vi.mock('@/lib/sourcing/registration/drafts', () => ({ setDraftDetailPageImages: vi.fn() }))

function call(body: unknown, jobId = 'job-1') {
  return POST(
    new NextRequest(`http://localhost/api/registration/pdp/${jobId}/detail-images`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ jobId }) }
  )
}

const urlOf = (runId: string, name: string, jobId = 'job-1', user = 'user-1') =>
  `${PUBLIC}${user}/registration/${jobId}/detail-page/${runId}/${name}`

describe('POST /api/registration/pdp/[jobId]/detail-images', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    uploaded.clear()
    signed.length = 0
    vi.mocked(getPdpJob).mockResolvedValue({ id: 'job-1', current_step: 'done', draft_id: 'draft-1' } as never)
    vi.mocked(setDraftDetailPageImages).mockResolvedValue(true)
  })

  it('남의 잡(user_id 격리로 조회 안 됨)은 404', async () => {
    vi.mocked(getPdpJob).mockResolvedValue(null)
    const res = await call({ action: 'prepare', sections: [100], full: [100] })
    expect(res.status).toBe(404)
    expect(getPdpJob).toHaveBeenCalledWith(expect.anything(), 'user-1', 'job-1')
  })

  it('완료되지 않은 잡은 409', async () => {
    vi.mocked(getPdpJob).mockResolvedValue({ id: 'job-1', current_step: 'images', draft_id: null } as never)
    expect((await call({ action: 'prepare', sections: [100], full: [100] })).status).toBe(409)
  })

  it('한 번 완료된 잡(final_html)은 편집기 재생성으로 images에 돌아가 있어도 굽는다', async () => {
    vi.mocked(getPdpJob).mockResolvedValue({
      id: 'job-1',
      current_step: 'images',
      final_html: '<html></html>',
      draft_id: null,
    } as never)
    expect((await call({ action: 'prepare', sections: [100], full: [100] })).status).toBe(200)
  })

  it('prepare — 잡 폴더 run 경로로 서명 URL을 순서대로 발급한다', async () => {
    const res = await call({ action: 'prepare', sections: [100, 200], full: [300] })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.runId).toMatch(/^[0-9a-z]{6,32}$/)
    expect(body.bucket).toBe('sourcing-product-images')
    const folder = `user-1/registration/job-1/detail-page/${body.runId}`
    expect(body.sections.map((s: { path: string }) => s.path)).toEqual([
      `${folder}/section-01.jpg`,
      `${folder}/section-02.jpg`,
    ])
    expect(body.full[0]).toEqual({
      path: `${folder}/full-01.jpg`,
      token: `tok:${folder}/full-01.jpg`,
      publicUrl: PUBLIC + `${folder}/full-01.jpg`,
    })
  })

  it('prepare — 파일 크기 상한(5MB) 초과·빈 목록·잘못된 값은 400', async () => {
    expect((await call({ action: 'prepare', sections: [5 * 1024 * 1024 + 1], full: [1] })).status).toBe(400)
    expect((await call({ action: 'prepare', sections: [], full: [1] })).status).toBe(400)
    expect((await call({ action: 'prepare', sections: ['1'], full: [1] })).status).toBe(400)
    expect((await call({ action: 'unknown' })).status).toBe(400)
    expect(signed).toEqual([])
  })

  it('commit — 정해진 URL이 모두 올라갔으면 드래프트 두 필드를 교체한다', async () => {
    put('section-01.jpg', 'section-02.jpg', 'full-01.jpg')
    const sections = [urlOf('abc123', 'section-01.jpg'), urlOf('abc123', 'section-02.jpg')]
    const full = [urlOf('abc123', 'full-01.jpg')]
    const res = await call({ action: 'commit', runId: 'abc123', sections, full })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ draftUpdated: true, sections, full })
    expect(setDraftDetailPageImages).toHaveBeenCalledWith(expect.anything(), 'user-1', 'draft-1', { sections, full })
  })

  it.each([
    ['외부 URL', 'https://evil.example/x.jpg'],
    ['다른 잡 폴더', urlOf('abc123', 'section-01.jpg', 'job-2')],
    ['다른 사용자 폴더', urlOf('abc123', 'section-01.jpg', 'job-1', 'user-2')],
    ['다른 run 폴더', urlOf('zzz999', 'section-01.jpg')],
    ['순서가 바뀐 URL', urlOf('abc123', 'section-02.jpg')],
  ])('commit — %s는 거부하고 드래프트를 건드리지 않는다', async (_label, url) => {
    put('section-01.jpg', 'section-02.jpg', 'full-01.jpg')
    const res = await call({
      action: 'commit',
      runId: 'abc123',
      sections: [url],
      full: [urlOf('abc123', 'full-01.jpg')],
    })
    expect(res.status).toBe(400)
    expect(setDraftDetailPageImages).not.toHaveBeenCalled()
  })

  it('commit — 실제로 올라가지 않은 파일이 있으면 409', async () => {
    put('section-01.jpg')
    const res = await call({
      action: 'commit',
      runId: 'abc123',
      sections: [urlOf('abc123', 'section-01.jpg')],
      full: [urlOf('abc123', 'full-01.jpg')],
    })
    expect(res.status).toBe(409)
    expect(setDraftDetailPageImages).not.toHaveBeenCalled()
  })

  it.each([
    ['5MB 초과', { size: 5 * 1024 * 1024 + 1, mimetype: 'image/jpeg' }],
    ['JPEG가 아닌 형식', { size: 1000, mimetype: 'image/png' }],
  ])('commit — 실제 올라간 파일이 %s이면 400(신고 크기만 믿지 않는다)', async (_label, meta) => {
    put('full-01.jpg')
    uploaded.set('section-01.jpg', meta)
    const res = await call({
      action: 'commit',
      runId: 'abc123',
      sections: [urlOf('abc123', 'section-01.jpg')],
      full: [urlOf('abc123', 'full-01.jpg')],
    })
    expect(res.status).toBe(400)
    expect(setDraftDetailPageImages).not.toHaveBeenCalled()
  })

  it('commit — runId 형식이 틀리면 400(경로 조작 차단)', async () => {
    expect((await call({ action: 'commit', runId: '../x', sections: [], full: [] })).status).toBe(400)
  })

  it('commit — 드래프트가 없는 잡은 업로드만 인정하고 건너뛴 사실을 알린다', async () => {
    vi.mocked(getPdpJob).mockResolvedValue({ id: 'job-1', current_step: 'done', draft_id: null } as never)
    put('section-01.jpg', 'full-01.jpg')
    const res = await call({
      action: 'commit',
      runId: 'abc123',
      sections: [urlOf('abc123', 'section-01.jpg')],
      full: [urlOf('abc123', 'full-01.jpg')],
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.draftUpdated).toBe(false)
    expect(body.note).toContain('드래프트')
    expect(setDraftDetailPageImages).not.toHaveBeenCalled()
  })
})

describe('POST detail-images — GIF 칸 움직이는 WebP(세션 B ③ P4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    uploaded.clear()
    signed.length = 0
    vi.mocked(getPdpJob).mockResolvedValue({ id: 'job-1', current_step: 'done', draft_id: 'draft-1' } as never)
    vi.mocked(setDraftDetailPageImages).mockResolvedValue(true)
  })
  const putWebp = (name: string, mimetype = 'image/webp') => uploaded.set(name, { size: 250_000, mimetype })

  it('prepare — fullTypes가 없으면 지금처럼 모두 .jpg, 있으면 그 번호만 .webp로 발급한다', async () => {
    const plain = await (await call({ action: 'prepare', sections: [100], full: [300, 300, 300] })).json()
    expect(plain.full.map((t: { path: string }) => t.path.split('/').pop())).toEqual(['full-01.jpg', 'full-02.jpg', 'full-03.jpg'])
    const mixed = await (
      await call({
        action: 'prepare',
        sections: [100],
        full: [300, 250_000, 300],
        fullTypes: ['image/jpeg', 'image/webp', 'image/jpeg'],
      })
    ).json()
    expect(mixed.full.map((t: { path: string }) => t.path.split('/').pop())).toEqual(['full-01.jpg', 'full-02.webp', 'full-03.jpg'])
    expect(mixed.sections.map((t: { path: string }) => t.path.split('/').pop())).toEqual(['section-01.jpg'])
  })

  it.each([
    ['길이가 다름', { full: [1, 2], fullTypes: ['image/jpeg'] }],
    ['모르는 형식', { full: [1], fullTypes: ['image/png'] }],
    ['배열이 아님', { full: [1], fullTypes: 'image/webp' }],
    ['WebP 상한 초과', { full: [1, 1, 1, 1, 1], fullTypes: Array(5).fill('image/webp') }],
  ])('prepare — 형식 목록이 %s면 400이고 발급하지 않는다', async (_label, extra) => {
    expect((await call({ action: 'prepare', sections: [100], ...extra })).status).toBe(400)
    expect(signed).toEqual([])
  })

  it('commit — .jpg·.webp가 섞인 순서 목록을 받아 드래프트에 그대로 넣는다', async () => {
    put('section-01.jpg', 'full-01.jpg', 'full-03.jpg')
    putWebp('full-02.webp')
    const sections = [urlOf('abc123', 'section-01.jpg')]
    const full = [urlOf('abc123', 'full-01.jpg'), urlOf('abc123', 'full-02.webp'), urlOf('abc123', 'full-03.jpg')]
    const res = await call({ action: 'commit', runId: 'abc123', sections, full })
    expect(res.status).toBe(200)
    expect(setDraftDetailPageImages).toHaveBeenCalledWith(expect.anything(), 'user-1', 'draft-1', { sections, full })
  })

  it.each([
    ['.webp인데 JPEG로 올라감', () => putWebp('full-02.webp', 'image/jpeg')],
    ['.jpg 자리에 WebP가 올라감', () => putWebp('full-02.jpg')],
  ])('commit — %s이면 400', async (_label, arrange) => {
    put('section-01.jpg', 'full-01.jpg')
    arrange()
    const name = _label.startsWith('.webp') ? 'full-02.webp' : 'full-02.jpg'
    const res = await call({
      action: 'commit',
      runId: 'abc123',
      sections: [urlOf('abc123', 'section-01.jpg')],
      full: [urlOf('abc123', 'full-01.jpg'), urlOf('abc123', name)],
    })
    expect(res.status).toBe(400)
    expect(setDraftDetailPageImages).not.toHaveBeenCalled()
  })

  it('commit — 섹션 이미지는 .webp를 받지 않고, 전체 이미지 WebP는 상한까지만', async () => {
    put('full-01.jpg')
    putWebp('section-01.webp')
    const bad = await call({
      action: 'commit',
      runId: 'abc123',
      sections: [urlOf('abc123', 'section-01.webp')],
      full: [urlOf('abc123', 'full-01.jpg')],
    })
    expect(bad.status).toBe(400)
    const many = Array.from({ length: 5 }, (_, i) => `full-0${i + 1}.webp`)
    many.forEach((n) => putWebp(n))
    put('section-01.jpg')
    const tooMany = await call({
      action: 'commit',
      runId: 'abc123',
      sections: [urlOf('abc123', 'section-01.jpg')],
      full: many.map((n) => urlOf('abc123', n)),
    })
    expect(tooMany.status).toBe(400)
    expect(setDraftDetailPageImages).not.toHaveBeenCalled()
  })
})
