/**
 * 리뷰 받을 쿠팡 상품 번호 — 입력 해석·접수 본문·입구 응답 판독(ops #795 계약: POST results[]·GET data·404 NOT_REQUESTED·503 TABLE_MISSING)
 */

import { describe, expect, it } from 'vitest'
import {
  isActiveReviewState,
  normalizeReviewSourceProductIds,
  parseReviewSourceInput,
  readIntakeResponse,
  readStatusResponse,
  reviewRequestBody,
} from './review-source'

describe('parseReviewSourceInput — 번호·쿠팡 상품 주소', () => {
  it('번호와 주소를 쉼표·공백·줄바꿈으로 나눠 읽고 겹침을 지운다', () => {
    const r = parseReviewSourceInput('123, https://www.coupang.com/vp/products/456?itemId=1\n123  789')
    expect(r).toEqual({ ids: ['123', '456', '789'], invalid: [], overflow: false })
  })

  it('읽지 못한 조각은 따로, 3개를 넘으면 overflow', () => {
    expect(parseReviewSourceInput('12a, 1,2,3,4')).toEqual({ ids: ['1', '2', '3'], invalid: ['12a'], overflow: true })
  })

  it('빈 입력은 번호 없음', () => {
    expect(parseReviewSourceInput('  ')).toEqual({ ids: [], invalid: [], overflow: false })
  })
})

describe('normalizeReviewSourceProductIds — 저장 전 정리', () => {
  it('숫자 문자열만 3개까지, 겹침 없이', () => {
    expect(normalizeReviewSourceProductIds([' 1 ', '1', 'x', 2, '3', '4', '5'])).toEqual(['1', '3', '4'])
    expect(normalizeReviewSourceProductIds('123')).toEqual([])
    expect(normalizeReviewSourceProductIds(['1'.repeat(21)])).toEqual([])
  })
})

describe('reviewRequestBody — 접수 본문', () => {
  it("source 'pdp'·상품명 키(200자 안), 상품명이 없으면 키 없음", () => {
    expect(reviewRequestBody(['1', '2'], '무릎 보호대')).toEqual({ product_ids: ['1', '2'], source: 'pdp', source_key: 'pdp:무릎 보호대' })
    expect(reviewRequestBody(['1'], '  ')).toEqual({ product_ids: ['1'], source: 'pdp' })
    expect(Array.from(reviewRequestBody(['1'], '가'.repeat(300)).source_key!)).toHaveLength(200)
  })
})

describe('readIntakeResponse — 접수 응답', () => {
  it('200이면 상품별 상태·행 수·받은 시각, fresh 표시', () => {
    const json = {
      data: {
        results: [
          { product_id: '1', state: 'queued', rows: 0, collected_at: null, requested_at: 't', last_error: null, outcome: 'queued' },
          { product_id: '2', state: 'done', rows: 1200, collected_at: '2026-11-05T05:00:00Z', outcome: 'fresh' },
        ],
      },
    }
    expect(readIntakeResponse(['1', '2', '3'], 200, json)).toEqual([
      { productId: '1', state: 'queued', rows: 0, collectedAt: null, lastError: null },
      { productId: '2', state: 'done', rows: 1200, collectedAt: '2026-11-05T05:00:00Z', lastError: null, fresh: true },
      { productId: '3', state: 'unavailable', rows: null, collectedAt: null, lastError: '응답에 이 상품이 없습니다.' },
    ])
  })

  it('503(표 없음)·404(입구 없음)·네트워크 실패는 모두 수집 불가', () => {
    for (const [status, json] of [
      [503, { error: '표가 아직 없습니다.', code: 'TABLE_MISSING' }],
      [404, null],
      [0, null],
    ] as const) {
      expect(readIntakeResponse(['1'], status, json).map((v) => v.state)).toEqual(['unavailable'])
    }
    expect(readIntakeResponse(['1'], 503, { error: '표가 아직 없습니다.' })[0]!.lastError).toBe('표가 아직 없습니다.')
  })

  it('모르는 상태 값은 실패로 본다', () => {
    expect(readIntakeResponse(['1'], 200, { data: { results: [{ product_id: '1', state: 'weird' }] } })[0]!.state).toBe('failed')
  })
})

describe('readStatusResponse — 조회 응답', () => {
  it('200 data, 404 NOT_REQUESTED는 요청 없음, 코드 없는 404·503은 수집 불가', () => {
    expect(readStatusResponse('1', 200, { data: { product_id: '1', state: 'running', rows: 40, collected_at: null } })).toMatchObject({ state: 'running', rows: 40 })
    expect(readStatusResponse('1', 200, { data: { state: 'blocked', rows: 3 } }).state).toBe('blocked')
    expect(readStatusResponse('1', 404, { error: '없음', code: 'NOT_REQUESTED' }).state).toBe('not_requested')
    expect(readStatusResponse('1', 404, null).state).toBe('unavailable')
    expect(readStatusResponse('1', 503, { code: 'TABLE_MISSING' }).state).toBe('unavailable')
  })

  it('대기·진행만 다시 묻는다', () => {
    expect(['queued', 'running', 'done', 'failed', 'blocked', 'not_requested', 'unavailable'].filter((s) => isActiveReviewState(s as never))).toEqual([
      'queued',
      'running',
    ])
  })
})
