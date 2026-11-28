import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FONT_OPTIONS, fontKey } from '@/lib/registration/editor/constants/fonts'
import { FONT_PREVIEW_SAMPLE, FontPreviewList, FontSelectOptions } from './FontPicker'

// 글꼴 선택 상자를 처음 열 때 41면 글꼴 파일(약 28MB)을 한꺼번에 받던 문제(pdp-font-picker) — 항목·미리보기 줄이 처음 그릴 때
// 글꼴을 입히지 않는지(파일 요청 0) 고정한다. 보이는 줄에만 입히는 동작은 브라우저(IntersectionObserver)에서 render-check로 본다.

// 프로젝트 Vitest 변환은 classic JSX를 사용하고 Next 빌드는 React를 자동 주입한다.
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

const select = (fontFamily: string, fontWeight: number) =>
  renderToStaticMarkup(createElement('select', null, createElement(FontSelectOptions, { fontFamily, fontWeight })))

describe('FontSelectOptions — 선택 상자 항목', () => {
  it('모든 선택지가 있고, 어느 항목에도 글꼴(style)을 입히지 않는다', () => {
    const html = select('Pretendard', 400)
    for (const f of FONT_OPTIONS) expect(html).toContain(`value="${fontKey(f)}"`)
    expect(html).not.toMatch(/font-family/i)
    expect(html).not.toContain('style=')
  })

  it('예전 글꼴(Cafe24 Ssurround)은 지금 값일 때만 비활성 항목으로 보인다', () => {
    expect(select('Cafe24 Ssurround', 700)).toMatch(/<option[^>]*disabled[^>]*>Cafe24 Ssurround \(Jua로 표시\)<\/option>/)
    expect(select('Pretendard', 400)).not.toContain('Cafe24')
  })
})

describe('FontPreviewList — 미리보기 목록', () => {
  // classic JSX라 React 전역 stub(beforeAll) 뒤에 그린다 — describe 본문에서 그리면 수집 단계에서 실패한다
  const render = () => renderToStaticMarkup(createElement(FontPreviewList, { currentKey: 'Jua__400', onPick: () => {} }))

  it('처음 그릴 때는 어느 줄에도 글꼴을 입히지 않는다 — 보이는 줄만 나중에(IntersectionObserver)', () => {
    const html = render()
    expect(html).not.toMatch(/font-family/i)
    expect(html.split(FONT_PREVIEW_SAMPLE)).toHaveLength(FONT_OPTIONS.length + 1)
  })

  it('줄마다 글꼴 키·누름 표시 — 지금 글꼴만 aria-pressed', () => {
    const html = render()
    for (const f of FONT_OPTIONS) expect(html).toContain(`data-font-key="${fontKey(f)}"`)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-pressed="true"[^>]*data-font-key="Jua__400"/)
  })
})
