/**
 * 생성 화면 '배치' 칸(R03) — 라디오 두 개(지금 배치·새 배치), 고른 쪽만 선택 표시, 설명 한 줄은 고른 배치 것.
 * 라이트 폼 기본값은 지금 배치다(PdpForm useState 'now'). 서버 렌더 마크업만 본다(DOM 없음).
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

  it('두 배치 설명은 로컬 Codex·API 비용 0원 계약만 안내한다', () => {
    for (const hint of Object.values(PDP_BATCH_HINT)) {
      expect(hint).toContain('Codex')
      expect(hint).toContain('0원')
      expect(hint).not.toMatch(/\$|Opus|Sol|Argon|GPT-Image|MS 2k/)
    }
  })

  it('라디오 글은 줄바꿈하지 않는다(390px 한 줄)', () => {
    expect(render('new').match(/whitespace-nowrap/g)).toHaveLength(2)
  })

  it('폼 기본값은 지금 배치다 — PdpForm useState', () => {
    const src = readFileSync(path.join(__dirname, 'PdpForm.tsx'), 'utf8')
    expect(src).toMatch(/useState<PdpModelBatch>\('now'\)/)
    expect(src).not.toMatch(/useState<PdpModelBatch>\('new'\)/)
  })
})
