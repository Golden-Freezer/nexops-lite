/**
 * 굽기·저장 결과 칸의 Wing HTML 단추·움직이는 칸 경고(AX-CT-30, 결정 199 대안 ⓐ) — 서버 렌더 마크업만 본다.
 * 미리보기에는 Supabase 공개 변수가 없어 굽기·저장이 '끝남'에 닿지 못하므로 render-check 대신 이 시험으로 본다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WingHtmlActions } from './WingHtmlActions'
import {
  WING_HTML_MOTION_WARNING,
  visibleWingHtmlNote,
  type WingHtmlNote,
} from '@/lib/registration/editor/utils/exportUtils/wingDetailHtml'

beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

const render = (motionCount: number, note: string | null = null) =>
  renderToStaticMarkup(createElement(WingHtmlActions, { motionCount, note, onCopy: () => {}, onDownload: () => {} }))

const buttons = (html: string) => (html.match(/<button[^>]*>.*?<\/button>/g) ?? []).map((b) => b.replace(/<[^>]+>/g, '').trim())

describe('WingHtmlActions', () => {
  it('단추 둘(Wing HTML 복사·HTML 내려받기)을 그린다', () => {
    expect(buttons(render(0))).toEqual(['Wing HTML 복사', 'HTML 내려받기'])
  })

  it('움직이는 칸이 섞이면 실측 범위 경고를 보인다', () => {
    const html = render(2)
    expect(html).toContain(WING_HTML_MOTION_WARNING.replace(/'/g, '&#x27;'))
    expect(html).toContain('이번 실측(11-16)에서는')
    // 실측 사실 둘 — HTML 은 정지 그림, 이미지 업로드로 올린 움직이는 WebP 는 움직임(반영까지 시간이 걸림)
    expect(html).toContain('정지 그림(PNG)이 됐고')
    expect(html).toContain('방식으로 올린 움직이는 WebP 는 움직였습니다(반영까지 시간이 걸림)')
    expect(html).not.toContain('같은 파일을')
  })

  it('움직이는 칸이 없으면 경고가 없다', () => {
    expect(render(0)).not.toContain('이번 실측(11-16)에서는')
  })

  it('안내 글이 있으면 보인다', () => {
    expect(render(0, '복사가 막혔습니다. HTML 내려받기를 쓰세요.')).toContain('복사가 막혔습니다.')
  })
})

// CoupangImageSave 가 넘기는 대로 visibleWingHtmlNote 결과를 note 로 그린다(#1320 재검수 N1 — 다시 굽기 뒤 옛 안내 글 숨김)
describe('WingHtmlActions + visibleWingHtmlNote', () => {
  const copied = 'Wing 용 HTML 을 복사했습니다.'
  const run1 = ['https://example.com/run1/full-01.jpg']
  const renderFor = (note: WingHtmlNote | null, fullUrls: readonly string[] | null) =>
    render(0, visibleWingHtmlNote(note, fullUrls))

  it('글을 만든 저장 결과 그대로면 안내 글을 보인다', () => {
    expect(renderFor({ forUrls: run1, text: copied }, run1)).toContain(copied)
  })

  it('다시 굽기로 저장 결과가 바뀌면 옛 안내 글을 숨긴다', () => {
    const run2 = ['https://example.com/run2/full-01.jpg']
    expect(renderFor({ forUrls: run1, text: copied }, run2)).not.toContain(copied)
  })

  it('주소가 같아도 배열을 새로 만들면 숨긴다(참조 비교 — fullUrls 는 done 때 한 번만 넣음)', () => {
    expect(renderFor({ forUrls: run1, text: copied }, [...run1])).not.toContain(copied)
  })
})
