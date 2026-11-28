/**
 * 생성 화면 W3 입력 컴포넌트(PDP-W2W3-CONTRACT v1) — 정적 마크업으로 칸·한도·비활성 조건을 고정하고, 자동 작성 기본 호출을 확인한다.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EXTRA_SPECS_NOTE, PdpExtraSpecsEditor } from './PdpExtraSpecsEditor'
import { ImageModelSelect } from './ImageModelSelect'
import { PDP_IMAGE_MODELS } from '@/lib/agents/image/types'
import { AUTO_FILL_BUDGET_MESSAGE, PdpAutoFillButton, requestAutoFill } from './PdpAutoFillButton'
import { PdpReviewQuoteCards } from './PdpReviewQuoteCards'
import { LONG_INPUT_HINT, PdpLongInputHint } from './PdpLongInputHint'
import { LONG_SECTION_TITLE } from '@/lib/registration/long-sections'

// 프로젝트 Vitest 변환은 classic JSX를 쓴다(PdpPreview.test.tsx와 같은 처리)
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

const noop = () => {}

describe('PdpExtraSpecsEditor', () => {
  it('행마다 항목명(20자)·값(60자) 입력과 지우기, 아래에 추가 버튼', () => {
    const html = renderToStaticMarkup(createElement(PdpExtraSpecsEditor, { rows: [{ key: '용량', value: '500ml' }], onChange: noop }))
    expect(html).toContain('aria-label="추가 스펙 1 항목명"')
    expect(html).toMatch(/maxlength="20"/i)
    expect(html).toMatch(/maxlength="60"/i)
    expect(html).toContain('aria-label="추가 스펙 1 지우기"')
    expect(html).toContain('추가 스펙 항목')
  })
  it('등록 초안에서 채운 행이면 이름 뒤에 (초안)', () => {
    const html = renderToStaticMarkup(createElement(PdpExtraSpecsEditor, { rows: [{ key: '용량', value: '350ml' }], onChange: noop, draft: true }))
    expect(html).toContain('추가 스펙 (항목명 · 값) (초안)')
  })
  it('쓰임 안내는 실제 쓰임대로 — 카피의 상품 사실·긴 상세페이지 표 근거(기본 스펙 표에 넣는다고 하지 않는다)', () => {
    const html = renderToStaticMarkup(createElement(PdpExtraSpecsEditor, { rows: [], onChange: noop }))
    expect(html).toContain(EXTRA_SPECS_NOTE)
    expect(EXTRA_SPECS_NOTE).toContain('카피를 쓸 때 상품 사실로 넘깁니다')
    expect(EXTRA_SPECS_NOTE).toContain('항목명이나 값이 빈 행은 저장할 때 빠집니다')
    expect(EXTRA_SPECS_NOTE).toContain('긴 상세페이지 표의 근거')
    expect(html).not.toContain('사실표에 그대로 들어갑니다')
  })
  it('12행이면 추가 버튼을 막는다', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, value: 'v' }))
    const html = renderToStaticMarkup(createElement(PdpExtraSpecsEditor, { rows, onChange: noop }))
    expect(html).toContain('추가 스펙은 12행까지')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*추가 스펙은 12행까지/)
  })
})

describe('ImageModelSelect', () => {
  it('모델 선택 상자는 칸 폭까지만(긴 옵션 글이 390 폭에서 넘치지 않게)', () => {
    const html = renderToStaticMarkup(
      createElement(ImageModelSelect, {
        models: PDP_IMAGE_MODELS,
        model: PDP_IMAGE_MODELS[0].id,
        quality: 'high',
        imageCount: 20,
        onModelChange: noop,
        onQualityChange: noop,
      })
    )
    expect(html).toMatch(/<select[^>]*class="max-w-full /)
  })
})

describe('PdpLongInputHint', () => {
  it('긴 상세페이지 안내(role=note) — 실측 내재화 β 조건, 세 확장 섹션 이름, 적은 값만, 관리 방법·구성은 직접 적어야 한다', () => {
    const html = renderToStaticMarkup(createElement(PdpLongInputHint))
    expect(html).toContain('role="note"')
    expect(html).toContain('긴 상세페이지 표에 쓰는 칸')
    expect(html.replaceAll('&#x27;', "'")).toContain(LONG_INPUT_HINT)
    for (const kind of ['size', 'care', 'faq'] as const) expect(LONG_INPUT_HINT).toContain(`'${LONG_SECTION_TITLE[kind]}'`)
    for (const phrase of [
      "'실측 내재화 β'로 생성하면",
      '사이즈·소재·사용처',
      '항목명 예: 구성, 관리 방법',
      '적은 값만 쓰고 이미 보이는 값은 다시 싣지 않습니다',
      '관리 방법·구성은 쿠팡 상품 정보에 거의 없어 직접 적어야',
    ]) {
      expect(LONG_INPUT_HINT).toContain(phrase)
    }
  })
})

describe('PdpAutoFillButton', () => {
  const render = (productName: string) =>
    renderToStaticMarkup(
      createElement(PdpAutoFillButton, { productName, current: {}, buildRequest: () => ({}), onApply: noop })
    )
  it('상품명이 없으면 버튼을 막고 이유를 보여 준다', () => {
    const html = render('  ')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="상품명을 먼저 입력해 주세요"/)
  })
  it('상품명이 있으면 누를 수 있고, 빈 칸만 채운다는 안내와 과금 안내가 있다', () => {
    const html = render('스테인리스 식기')
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('AI로 페르소나·톤 채우기')
    expect(html).toContain('빈 칸만 채웁니다. API 과금(월 예산 안)')
  })

  it('requestAutoFill — /api/registration/pdp/auto-fill에 JSON POST, 실패는 서버 문구로 던진다', async () => {
    // React 전역 stub은 그대로 두고 fetch만 바꿨다가 되돌린다
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ suggestions: { targetPersona: 'p' }, model: 'm', costUsd: 0.01 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '잘못된 요청' }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'budget exceeded', code: 'budget' }), { status: 409 }))
    try {
      await expect(requestAutoFill({ productName: 'x' })).resolves.toMatchObject({ suggestions: { targetPersona: 'p' } })
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('/api/registration/pdp/auto-fill')
      expect(init.method).toBe('POST')
      expect(JSON.parse(String(init.body))).toEqual({ productName: 'x' })
      await expect(requestAutoFill({})).rejects.toThrow('잘못된 요청')
      // 예산 막힘(409 budget)은 서버 문구 대신 고정 안내
      await expect(requestAutoFill({})).rejects.toThrow(AUTO_FILL_BUDGET_MESSAGE)
    } finally {
      fetchMock.mockRestore()
    }
  })
})

describe('PdpReviewQuoteCards', () => {
  const candidates = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, text: `물도 사료도 한 번에 ${i}번 후기`, rating: 5 - (i % 2), option: i === 0 ? '화이트' : undefined }))
  it('후보가 없으면 안내만', () => {
    expect(renderToStaticMarkup(createElement(PdpReviewQuoteCards, { candidates: [], selected: [], onChange: noop }))).toContain(
      '자사 리뷰 파일을 올리면'
    )
  })
  it('카드마다 체크·별점·옵션·글, 고른 카드에만 강조 낱말 버튼', () => {
    const selected = [{ id: 'r0', text: candidates[0].text, rating: 5, option: '화이트', highlights: ['사료도'] }]
    const html = renderToStaticMarkup(createElement(PdpReviewQuoteCards, { candidates, selected, onChange: noop }))
    expect(html).toContain('1/6장 선택')
    expect(html.match(/type="checkbox"/g)).toHaveLength(8)
    expect(html).toContain('aria-label="별점 5점"')
    expect(html).toContain('화이트')
    expect(html).toContain('aria-label="후기 인용 후보"')
    expect(html.match(/role="group"[^>]*aria-label="강조할 낱말"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-pressed="true"[^>]*>사료도</)
  })
  it('6장을 고르면 나머지 체크는 막힌다', () => {
    const selected = candidates.slice(0, 6).map(({ id, text, rating }) => ({ id, text, rating }))
    const html = renderToStaticMarkup(createElement(PdpReviewQuoteCards, { candidates, selected, onChange: noop }))
    expect(html).toContain('6/6장 선택')
    expect(html.match(/type="checkbox"[^>]*disabled=""/g)).toHaveLength(2)
  })
  it('사유(blocked)가 있는 후보는 흐리게·체크 막음·사유 칩(체크와 aria-describedby로 묶음), 안내에 장 수', () => {
    const withBlocked = [
      ...candidates.slice(0, 2),
      { id: 'b0', text: '염증이 싹 나았어요', rating: 5, blocked: '의학·기능성' as const },
      { id: 'b1', text: '체험단으로 받았어요', rating: 4, blocked: '대가성' as const },
    ]
    const html = renderToStaticMarkup(createElement(PdpReviewQuoteCards, { candidates: withBlocked, selected: [], onChange: noop }))
    expect(html.match(/type="checkbox"[^>]*disabled=""/g)).toHaveLength(2)
    expect(html).toMatch(/type="checkbox"[^>]*disabled=""[^>]*aria-describedby="quote-block-b0"|aria-describedby="quote-block-b0"[^>]*disabled=""/)
    expect(html).toContain('id="quote-block-b0"')
    expect(html).toContain('의학·기능성 효능 표현 — 인용 불가')
    expect(html).toContain('체험단·협찬 후기 — 인용 불가')
    expect(html).toContain('인용할 수 없는 후기 2장')
    expect(html.match(/opacity-50/g)).toHaveLength(2)
  })
})
