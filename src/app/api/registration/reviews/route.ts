// POST /api/registration/reviews — 리뷰 엑셀(쿠팡 리뷰 다운로드 형식) 파싱(pdp-review-input)
// FormData 'file'(.xlsx) + 'kind'(own|competitor) → 정화·표집 결과를 돌려준다. 파일은 저장하지 않는다(스토리지 미사용).
// 화면이 결과를 잡 생성 입력 spec_sheet에 넣는다: 자사 → reviewsText·reviewFiles.own, 경쟁사 → competitorReviews.
// 자사 응답에는 인용 후보(reviewCandidates, W2a — 30건 이하, 이름 없음, 안정 id)도 실린다 — 화면이 골라 reviewQuotes로 넣는다.
// 오너 전용. 이 라우트는 오너가 올린 파일만 받는다 — 수집 리뷰(리뷰 받을 쿠팡 상품 번호)는 잡 생성 때 서버가 읽는다(collected-reviews.ts).

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { intakeReviewFile } from '@/lib/registration/reviews/review-intake'
import { REVIEW_FILE_MAX_BYTES, type ReviewFileKind } from '@/lib/registration/reviews/review-types'

export const dynamic = 'force-dynamic'

function isKind(v: unknown): v is ReviewFileKind {
  return v === 'own' || v === 'competitor'
}

export async function POST(req: NextRequest) {
  try {
    await requireOwner()
    // 본문을 다 읽기 전에 선언된 크기로 먼저 거른다(폼 경계 몫 64KB 여유)
    const declared = Number(req.headers.get('content-length') ?? 0)
    if (declared > REVIEW_FILE_MAX_BYTES + 64 * 1024) {
      return NextResponse.json({ error: '파일 크기 초과 (최대 4MB)' }, { status: 400 })
    }
    const form = await req.formData()
    const file = form.get('file')
    const kind = form.get('kind')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '파일이 필요합니다.' }, { status: 400 })
    }
    if (!isKind(kind)) {
      return NextResponse.json({ error: 'kind는 own 또는 competitor여야 합니다.' }, { status: 400 })
    }
    if (file.size > REVIEW_FILE_MAX_BYTES) {
      return NextResponse.json({ error: '파일 크기 초과 (최대 4MB)' }, { status: 400 })
    }
    if (!/\.xlsx$/i.test(file.name)) {
      return NextResponse.json({ error: '엑셀(.xlsx) 파일만 받습니다.' }, { status: 400 })
    }
    try {
      const data = intakeReviewFile(new Uint8Array(await file.arrayBuffer()), kind, file.name)
      return NextResponse.json({ data })
    } catch (parseError: unknown) {
      const message = parseError instanceof Error ? parseError.message : '리뷰 파일을 읽지 못했습니다.'
      return NextResponse.json({ error: message }, { status: 400 })
    }
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration reviews POST error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
