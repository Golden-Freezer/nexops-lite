/**
 * 우리 쿠팡 판매량 고르기(J51) — 잡 생성 본문 칸(고른 것이 없으면 빈 객체·고른 상품 옵션의 수동 값만), Provider 밖에서도 사업장 없음 안내로 그려진다.
 * 서버 렌더 마크업만 본다(DOM 없음).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EMPTY_OWN_SALES, PdpOwnSales, ownSalesSpecFields, useOwnSalesBusinessId } from './PdpOwnSales'

// 프로젝트 Vitest 변환은 classic JSX를 사용하고 Next 빌드는 React를 자동 주입한다.
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

const listing = (productId: string, rowIds: string[]) => ({ productId, name: '구디백', options: rowIds.map((rowId) => ({ rowId, name: '20개 데이지(S)', bundle: { qty: 20, unit: '개' } })) })

describe('ownSalesSpecFields', () => {
  it('고른 것이 없으면 빈 객체 — 지금과 같은 본문', () => {
    expect(ownSalesSpecFields(EMPTY_OWN_SALES)).toEqual({})
    expect(ownSalesSpecFields({ listings: [], bundleQty: { a: { qty: 1, unit: '개' } } })).toEqual({})
  })

  it('등록상품ID와, 고른 상품 옵션에 남은 수동 값만', () => {
    expect(
      ownSalesSpecFields({
        listings: [listing('15969912606', ['r1']), listing('16047244503', ['r2'])],
        bundleQty: { r1: { qty: 25, unit: '개' }, gone: { qty: 5, unit: '개' } },
      })
    ).toEqual({ ownSalesProductIds: ['15969912606', '16047244503'], ownSalesBundleQty: { r1: { qty: 25, unit: '개' } } })
  })
})

function BusinessProbe({ draft }: { draft: string | null }) {
  return createElement('span', null, useOwnSalesBusinessId(draft) ?? '없음')
}

describe('PdpOwnSales', () => {
  it('Provider 밖에서는 사업장이 없어 안내만 — 초안 사업장이 있으면 그 사업장', () => {
    expect(renderToStaticMarkup(createElement(BusinessProbe, { draft: null }))).toBe('<span>없음</span>')
    expect(renderToStaticMarkup(createElement(BusinessProbe, { draft: 'biz-1' }))).toBe('<span>biz-1</span>')
    const html = renderToStaticMarkup(createElement(PdpOwnSales, { businessId: null, value: EMPTY_OWN_SALES, onChange: () => {} }))
    expect(html).toContain('사업장을 먼저 고르세요.')
  })

  it('고른 상품의 옵션 묶음 수량과 출처를 보여 준다', () => {
    const html = renderToStaticMarkup(
      createElement(PdpOwnSales, { businessId: 'biz-1', value: { listings: [listing('15969912606', ['r1'])], bundleQty: {} }, onChange: () => {} })
    )
    expect(html).toContain('value="20"')
    expect(html).toContain('옵션명')
    expect(html).toContain('15969912606')
  })
})
