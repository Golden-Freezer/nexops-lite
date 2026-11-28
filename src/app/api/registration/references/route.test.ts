/**
 * POST /api/registration/references — 오너 전용, 형식·크기·쪽 수 거절(400), 월 예산 409, 모델 실패 502, 파일 미저장.
 * 띠 자르기·산출 정리는 실제 함수, 예산·모델 호출은 모의다(유료 호출 0, DB 0).
 */

import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ budget: vi.fn(), strips: vi.fn(), pdf: vi.fn() }))

vi.mock('@/lib/auth/clerk', () => ({ requireOwner: vi.fn() }))
vi.mock('@/lib/agents/budget', () => ({ checkMonthlyBudget: (...a: unknown[]) => h.budget(...a) }))
vi.mock('@/lib/agents/registration/pdp-reference-agent', () => ({
  REFERENCE_AGENT: 'registration/pdp-reference-analysis',
  analyzeReferenceStrips: (...a: unknown[]) => h.strips(...a),
  analyzeReferencePdf: (...a: unknown[]) => h.pdf(...a),
}))

import { POST } from './route'
import { requireOwner } from '@/lib/auth/clerk'

const USAGE = { inputTokens: 1000, outputTokens: 500, cost: 0.08 }
const BATCH = {
  transcript: [{ unit: 1, text: '답례품 포장, 스무 개 한 번에 준비' }],
  sections: [{ start: 0, end: 30, role: 'hook', layout: 'full_photo', visual: '제품 단독 컷', move: '공감→약속', appeals: ['대용량 구성'], density: 'low' }],
  strengths: ['첫 화면에 제품이 크게 보인다'],
  weaknesses: [],
  lastRole: 'hook',
}

async function post(file: { bytes: Uint8Array | Buffer; name: string } | null, kind: string | null = 'competitor') {
  const form = new FormData()
  if (file) form.append('file', new File([new Uint8Array(file.bytes)], file.name))
  if (kind) form.append('kind', kind)
  return POST(new NextRequest('http://localhost/api/registration/references', { method: 'POST', body: form }))
}
const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#f4ece4' } }).png().toBuffer()
const pdf = (pages: number) =>
  Buffer.from(`%PDF-1.4\n${'<< /Type /Page >>\n'.repeat(pages)}%%EOF`, 'latin1')

beforeEach(() => {
  vi.mocked(requireOwner).mockReset().mockResolvedValue('user-1')
  h.budget.mockReset().mockResolvedValue({ allowed: true, spentUsd: 1, budgetUsd: 50 })
  h.strips.mockReset().mockResolvedValue({ success: true, data: [BATCH], usage: USAGE, duration: 10 })
  h.pdf.mockReset().mockResolvedValue({ success: true, data: [BATCH], usage: USAGE, duration: 10 })
})

describe('POST /api/registration/references', () => {
  it('긴 캡처 → 띠 분석 → ReferenceInput(오너 user_id로 사용 기록)', async () => {
    const res = await post({ bytes: await png(1000, 5000), name: 'C:\\captures\\page.png' }, 'own')
    expect(res.status).toBe(200)
    const { reference } = await res.json()
    expect(reference).toMatchObject({ kind: 'own', fileName: 'page.png', source: 'image', units: 4, costUsd: 0.08 })
    expect(reference.insights).toMatchObject({ version: 1, flow: 'hook', strengths: ['첫 화면에 제품이 크게 보인다'] })
    expect(reference.transcript).toBe('답례품 포장, 스무 개 한 번에 준비')
    const [strips, runContext] = h.strips.mock.calls[0]
    expect(strips).toHaveLength(4)
    expect(runContext).toEqual({ userId: 'user-1', stage: 'registration/pdp-reference-analysis' })
  })

  it('PDF → 문서 입력 분석(쪽 수 그대로)', async () => {
    const res = await post({ bytes: pdf(3), name: 'page.pdf' })
    expect(res.status).toBe(200)
    expect((await res.json()).reference).toMatchObject({ source: 'pdf', units: 3 })
    expect(h.pdf.mock.calls[0][1]).toBe(3)
  })

  it.each([
    ['파일 없음', null, 'competitor', '파일이 필요합니다'],
    ['종류 오류', { bytes: Buffer.from('%PDF-1.4'), name: 'a.pdf' }, 'rival', 'kind는'],
    ['형식 밖', { bytes: Buffer.from('PK\u0003\u0004zip'), name: 'a.zip' }, 'other', 'PDF만 받습니다'],
    ['쪽 수 초과', { bytes: pdf(31), name: 'a.pdf' }, 'competitor', '최대 30쪽'],
  ] as const)('%s → 400 거절 메시지, 모델 호출 없음', async (_, file, kind, message) => {
    const res = await post(file ? { ...file } : null, kind)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain(message)
    expect(h.strips).not.toHaveBeenCalled()
    expect(h.pdf).not.toHaveBeenCalled()
  })

  it('크기 초과 PDF(4MB 넘음 — Vercel 요청 본문 상한 안) → 400', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n<< /Type /Page >>\n', 'latin1'), Buffer.alloc(4 * 1024 * 1024 + 10)])
    const res = await post({ bytes: big, name: 'big.pdf' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('PDF 최대 4MB')
  })

  it('화면 띠 입력(strips·positions) → 서버 자르기 없이 그 띠로 분석, 파일명·표집 경고는 폼에서', async () => {
    const strip = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
    const form = new FormData()
    form.append('kind', 'own')
    form.append('fileName', 'C:\\captures\\long.png')
    form.append('strips', new File([strip], 'strip-1.jpg'))
    form.append('strips', new File([strip], 'strip-2.jpg'))
    form.append('positions', JSON.stringify([{ start: 0, end: 52 }, { start: 48, end: 100 }]))
    form.append('sampled', '1')
    const res = await POST(new NextRequest('http://localhost/api/registration/references', { method: 'POST', body: form }))
    expect(res.status).toBe(200)
    const { reference } = await res.json()
    expect(reference).toMatchObject({ kind: 'own', fileName: 'long.png', source: 'image', units: 2 })
    expect(reference.warnings).toEqual(['캡처가 길어 2개 구간만 골라 읽었습니다.'])
    const [strips] = h.strips.mock.calls[0]
    expect(strips).toEqual([
      { data: Buffer.from(strip).toString('base64'), mediaType: 'image/jpeg', start: 0, end: 52 },
      { data: Buffer.from(strip).toString('base64'), mediaType: 'image/jpeg', start: 48, end: 100 },
    ])
  })

  it('띠 입력이 틀리면 400(파일 입력으로 넘어가지 않는다)', async () => {
    const form = new FormData()
    form.append('kind', 'competitor')
    form.append('strips', new File([new Uint8Array([0x89, 0x50])], 'strip-1.jpg'))
    form.append('positions', JSON.stringify([{ start: 0, end: 100 }]))
    const res = await POST(new NextRequest('http://localhost/api/registration/references', { method: 'POST', body: form }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('JPEG만')
    expect(h.strips).not.toHaveBeenCalled()
  })

  it('월 예산 한도면 409, 모델 실패면 502(비용 함께)', async () => {
    h.budget.mockResolvedValueOnce({ allowed: false, spentUsd: 50, budgetUsd: 50 })
    expect((await post({ bytes: pdf(2), name: 'a.pdf' })).status).toBe(409)
    h.pdf.mockResolvedValueOnce({ success: false, error: { message: '시간 초과', stage: 'timeout', attempts: 2 }, usage: USAGE, duration: 1 })
    const res = await post({ bytes: pdf(2), name: 'a.pdf' })
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ costUsd: 0.08 })
  })
})
