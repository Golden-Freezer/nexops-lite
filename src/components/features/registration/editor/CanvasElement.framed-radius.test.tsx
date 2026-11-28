import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CanvasElement as CanvasElementData, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { exportRenderHtml } from '@/lib/registration/editor/utils/exportUtils/htmlBuilders'
import CanvasElementComponent from './CanvasElement'

// 틀 사진(framed-image) roundedRect 모서리(적용 T1-28, K 컨셉 사진 반경) — 운영 편집기·내보내기 파일이라
// cornerRadius가 없는 요소는 화면·내보내기 HTML이 바뀌기 전(main 7d7e0333)과 글자 하나 다르지 않음을 고정한다.
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: async () => null }) }))

beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

const SRC = 'https://cdn.example.com/a.jpg'
const framed = (frameId: string, clipPath: string, cornerRadius?: unknown): CanvasElementData => ({
  id: 'frm-1',
  type: 'framed-image',
  name: 'designcut-scene',
  transform: { x: 60, y: 40, width: 740, height: 560, rotation: 0 },
  zIndex: 3,
  isLocked: false,
  isVisible: true,
  opacity: 1,
  framedImageProps: {
    src: SRC,
    alt: 'designcut-scene',
    frameId,
    clipPath,
    viewBox: '0 0 100 100',
    bgColor: '#FFFFFF',
    objectFit: 'cover',
    imageType: 'designcut_product',
    isUserUploaded: false,
    ...(cornerRadius !== undefined ? { cornerRadius: cornerRadius as number } : {}),
  },
})

const editorHtml = (el: CanvasElementData) =>
  renderToStaticMarkup(createElement(CanvasElementComponent, { element: el, sectionId: 's', sectionType: 'petit_div' }))
/** 내보내기 HTML의 요소 한 줄 — 페이지 머리(글꼴 주소 등)는 이 검사 밖이다 */
const exportedLine = (el: CanvasElementData) => {
  const html = exportRenderHtml(
    [
      {
        id: 's', sectionType: 'petit_div', groupType: 'modules', order: 0, isVisible: true, layoutId: 'x',
        canvas: { width: 860, height: 820, backgroundColor: '#FFFFFF' }, elements: [el],
      } as CanvasSection,
    ],
    {},
  )
  return html.split('\n').find((line) => line.includes(SRC))!.trim()
}

/** 바뀌기 전(main 7d7e0333) 출력 — 이 시험을 main 코드로 돌려 받은 문자열이다 */
const IMG_EDITOR = `<img src="${SRC}" alt="designcut-scene" loading="eager" draggable="false" style="width:100%;height:100%;object-fit:cover;object-position:center center;display:block"/>`
const BOX_EDITOR = 'position:absolute;left:60px;top:40px;width:740px;height:560px;opacity:1;z-index:3;cursor:grab;box-sizing:border-box;overflow:hidden;pointer-events:auto;user-select:none'
const editorNow = (extra: string) => `<link rel="preload" as="image" href="${SRC}"/><div style="${BOX_EDITOR}${extra}">${IMG_EDITOR}</div>`
const IMG_EXPORT = `<img src="${SRC}" alt="designcut-scene" style="width:100%;height:100%;object-fit:cover;object-position:center center;display:block;">`
const exportNow = (extra: string) =>
  `<div style="position:absolute;left:60px;top:40px;width:740px;height:560px;z-index:3;opacity:1;overflow:hidden;background:#FFFFFF;${extra}">${IMG_EXPORT}</div>`

describe('틀 사진 모서리 — cornerRadius 없는 요소는 지금과 같다', () => {
  it('roundedRect는 편집기·내보내기 모두 16 그대로', () => {
    const el = framed('roundedRect', 'inset(0 round 16px)')
    expect(editorHtml(el)).toBe(editorNow(';border-radius:16px'))
    expect(exportedLine(el)).toBe(exportNow('border-radius:16px;'))
  })

  it('rect는 모서리 없이 그대로', () => {
    const el = framed('rect', 'none')
    expect(editorHtml(el)).toBe(editorNow(''))
    expect(exportedLine(el)).toBe(exportNow(''))
  })
})

describe('틀 사진 모서리 — K 컨셉 사진 반경', () => {
  it('roundedRect에 cornerRadius가 있으면 두 경로가 같은 반경을 쓴다', () => {
    for (const r of [0, 12, 24]) {
      const el = framed('roundedRect', `inset(0 round ${r}px)`, r)
      expect(editorHtml(el)).toBe(editorNow(`;border-radius:${r}${r === 0 ? '' : 'px'}`))
      expect(exportedLine(el)).toBe(exportNow(`border-radius:${r}px;`))
    }
  })

  it('숫자가 아니거나 음수·무한이면 두 경로 모두 16이다(저장 JSON이 틀려도 CSS에 끼어들지 않는다)', () => {
    for (const bad of ['24px;background:red', -4, Number.POSITIVE_INFINITY, null]) {
      const el = framed('roundedRect', 'inset(0 round 16px)', bad)
      expect(editorHtml(el)).toBe(editorNow(';border-radius:16px'))
      expect(exportedLine(el)).toBe(exportNow('border-radius:16px;'))
    }
  })

  it('rect·circle은 cornerRadius가 있어도 읽지 않는다', () => {
    expect(exportedLine(framed('rect', 'none', 24))).toBe(exportNow(''))
    expect(exportedLine(framed('circle', 'none', 24))).toBe(exportNow('border-radius:50%;'))
    expect(editorHtml(framed('rect', 'none', 24))).toBe(editorNow(''))
  })
})
