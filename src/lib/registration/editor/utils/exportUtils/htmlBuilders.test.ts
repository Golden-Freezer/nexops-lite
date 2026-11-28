import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '../../types/canvas'
import { ProSectionType } from '../../types/section'
import { makeTextEl } from '../sectionConverter/elements'
import { exportHtml, exportRenderHtml, exportReviewHtml } from './htmlBuilders'

const EDITOR_PAGE = resolve(__dirname, '../../../../../app/registration/detail-page/[jobId]/editor/page.tsx')
const ROOT_LAYOUT = resolve(__dirname, '../../../../../app/layout.tsx')

function page(families: string[]): CanvasSection[] {
  return [
    {
      id: 's1',
      sectionType: ProSectionType.POINT_DIV,
      groupType: 'usp',
      order: 0,
      isVisible: true,
      layoutId: 'point_div_layout_01',
      canvas: { width: 860, height: 600, backgroundColor: '#FFFFFF' },
      elements: families.map((fontFamily, i) =>
        makeTextEl(`t${i}`, '둥근 제목', 'h2', 60, 140 + i * 100, 740, '#222222', 'center', 2, { fontFamily })
      ),
    },
  ]
}

describe('내보내기 HTML — 글꼴(pdp-font-selfhost)', () => {
  const LINK = '<link href="https://nexops-one.vercel.app/fonts/pdp/fonts.css" rel="stylesheet">'

  it('세 HTML 모두 편집기와 같은 자체 보관 스타일시트 하나만 싣는다 — CDN 없음', () => {
    const sections = page(['Cafe24 Ssurround', 'LINE Seed Sans KR', 'Gugi'])
    for (const html of [exportHtml(sections, null), exportRenderHtml(sections, {}, null), exportReviewHtml(sections, null)]) {
      expect(html.split(LINK)).toHaveLength(2)
      expect(html).not.toMatch(/jsdelivr|googleapis|gstatic|@font-face/)
    }
  })

  it('편집기는 루트 layout이 싣는 같은 스타일시트(같은 출처 경로)만 쓴다 — 두 번 싣지 않고 CDN 글꼴 링크가 없다', () => {
    const layout = readFileSync(ROOT_LAYOUT, 'utf8')
    const editor = readFileSync(EDITOR_PAGE, 'utf8')
    expect(layout).toContain('href="/fonts/pdp/fonts.css"')
    for (const src of [layout, editor]) expect(src).not.toMatch(/jsdelivr|googleapis/)
    expect(editor).not.toMatch(/rel="stylesheet"/)
  })
})
