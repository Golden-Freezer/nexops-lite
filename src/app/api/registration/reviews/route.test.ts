/**
 * POST /api/registration/reviews(pdp-review-input) — 오너 전용, 입력 검사(kind·크기·확장자·형식), 파싱 결과만 돌려준다(저장 없음).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

vi.mock('@/lib/auth/clerk', () => ({ requireOwner: vi.fn() }))

import { POST } from './route'
import { requireOwner } from '@/lib/auth/clerk'
import { REVIEW_FILE_MAX_BYTES } from '@/lib/registration/reviews/review-types'

const HEADER = [
  '작성일',
  '리뷰어번호',
  '이름',
  '판매자',
  '상품옵션명',
  '평점',
  '리뷰제목',
  '리뷰내용',
  '사진수',
  '도움',
  '도움된인원수',
]

function xlsxFile(rows: unknown[][], name = '리뷰다운로드.xlsx'): File {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '전체리뷰')
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new File([bytes], name)
}

function post(fields: Record<string, string | File>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return new NextRequest('http://localhost/api/registration/reviews', { method: 'POST', body: form })
}

const ROWS = [
  HEADER,
  ['2026-01-01', 'R1', '김*희', '라스(주)', '블랙', 2, '', '라스 뚜껑이 헐거워서 새요. 010-1234-5678', 0, '', 3],
]

beforeEach(() => {
  vi.mocked(requireOwner).mockReset()
  vi.mocked(requireOwner).mockResolvedValue('user_1')
})

describe('POST /api/registration/reviews', () => {
  it('오너가 아니면 인증 응답을 그대로 돌려준다', async () => {
    vi.mocked(requireOwner).mockRejectedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    const res = await POST(post({ file: xlsxFile(ROWS), kind: 'own' }))
    expect(res.status).toBe(403)
  })

  it('크기 상한(4MB)을 넘으면 400 — 선언된 길이로 먼저 거르고, 파일 크기로 다시 거른다', async () => {
    const declared = new NextRequest('http://localhost/api/registration/reviews', {
      method: 'POST',
      body: 'x',
      headers: { 'content-length': String(REVIEW_FILE_MAX_BYTES + 128 * 1024) },
    })
    expect((await POST(declared)).status).toBe(400)
    const big = new File([new Uint8Array(REVIEW_FILE_MAX_BYTES + 1)], 'big.xlsx')
    const res = await POST(post({ file: big, kind: 'own' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('4MB')
  })

  it('kind·확장자·형식이 틀리면 400', async () => {
    expect((await POST(post({ file: xlsxFile(ROWS), kind: 'other' }))).status).toBe(400)
    expect((await POST(post({ file: xlsxFile(ROWS, 'a.csv'), kind: 'own' }))).status).toBe(400)
    expect((await POST(post({ kind: 'own' }))).status).toBe(400)
    const bad = await POST(post({ file: new File(['not excel'], 'a.xlsx'), kind: 'own' }))
    expect(bad.status).toBe(400)
  })

  it('경쟁사 파일은 판매자명·개인정보·옵션을 지운 항목만 돌려준다', async () => {
    const res = await POST(post({ file: xlsxFile(ROWS), kind: 'competitor' }))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.kind).toBe('competitor')
    expect(data.competitorReviews.items).toEqual([
      { id: 1, rating: 2, helped: 3, title: '', body: '(상호 삭제) 뚜껑이 헐거워서 새요. (연락처 삭제)' },
    ])
    expect(JSON.stringify(data.competitorReviews.items)).not.toMatch(/김\*희|블랙|010/)
  })

  it('자사 파일은 리뷰 원문 칸에 넣을 직렬화 텍스트와 메타를 돌려준다', async () => {
    const res = await POST(post({ file: xlsxFile(ROWS), kind: 'own' }))
    const { data } = await res.json()
    expect(data.kind).toBe('own')
    // 작성 월·가린 작성자(P1-6) — 원래 이름('김*희')은 싣지 않는다
    expect(data.reviewsText).toContain('[리뷰1] 평점 2/5 · 도움 3 · 작성 2026.01 · 작성자 김** · 옵션: 블랙')
    expect(data.meta.fileName).toBe('리뷰다운로드.xlsx')
    // 인용 후보(W2a) — 화면은 data.reviewCandidates를 읽는다. 정화 뒤 글, 이름은 가린 꼴만(P1-6), 리뷰어번호 없음.
    // 정화 표지가 남은 글은 카드 불가 사유(blocked)가 붙는다 — 화면은 흐리게·선택 불가
    expect(data.reviewCandidates).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f]{12}$/),
        text: expect.any(String),
        rating: 2,
        option: '블랙',
        month: '2026.01',
        author: '김**',
        blocked: '정화',
      },
    ])
    expect(JSON.stringify(data.reviewCandidates)).not.toMatch(/010-1234|김\*희|R1"/)
  })
})
