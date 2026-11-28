/**
 * 생성 화면 '배치' 칸(R03) — 라디오 두 개(지금 배치·새 배치), 고른 쪽만 선택 표시, 설명 한 줄은 고른 배치 것.
 * 켜기(R09) 뒤 폼 기본값은 새 배치다(PdpForm useState 'new'). 서버 렌더 마크업만 본다(DOM 없음).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PDP_BATCH_HINT, PdpFormBatch } from './PdpFormBatch'

// 프로젝트 Vitest 변환은 classic JSX를 사용하고 Next 빌드는 React를 자동 주입한다.
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

const render = (batch: 'now' | 'new') => renderToStaticMarkup(createElement(PdpFormBatch, { batch, onChange: () => {} }))

describe('PdpFormBatch', () => {
  it('지금 배치·새 배치 라디오 두 개, 고른 쪽만 선택 — 설명은 고른 배치 것', () => {
    const html = render('now')
    expect(html.match(/role="radio"/g)).toHaveLength(2)
    expect(html).toMatch(/aria-checked="true"[^>]*>지금 배치</)
    expect(html).toMatch(/aria-checked="false"[^>]*>새 배치</)
    expect(html).toContain(PDP_BATCH_HINT.now)
    expect(html).not.toContain(PDP_BATCH_HINT.new)
  })

  it('새 배치를 고르면 설명이 R08 실측(잡당 API 약 $5.7·약 20~25분) 줄로 바뀐다', () => {
    const html = render('new')
    expect(html).toMatch(/aria-checked="true"[^>]*>새 배치</)
    expect(html).toContain('잡당 API 약 $5.7·약 20~25분')
    expect(html).not.toContain(PDP_BATCH_HINT.now)
  })

  it('지금 배치 설명은 R08 실측(잡당 API 약 $3.7·약 10분)이다 — 옛 결정 탭 장당 $7.3 글은 없다', () => {
    expect(PDP_BATCH_HINT.now).toContain('잡당 API 약 $3.7·약 10분')
    expect(Object.values(PDP_BATCH_HINT).join(' ')).not.toContain('$7.3')
  })

  it('라디오 글은 줄바꿈하지 않는다(390px 한 줄)', () => {
    expect(render('new').match(/whitespace-nowrap/g)).toHaveLength(2)
  })

  it('폼 기본값은 새 배치다(R09 켜기) — PdpForm useState', () => {
    const src = readFileSync(path.join(__dirname, 'PdpForm.tsx'), 'utf8')
    expect(src).toMatch(/useState<PdpModelBatch>\('new'\)/)
    expect(src).not.toMatch(/useState<PdpModelBatch>\('now'\)/)
  })
})
