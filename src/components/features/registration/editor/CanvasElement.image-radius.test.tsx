import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CanvasElement as CanvasElementData, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { exportRenderHtml } from '@/lib/registration/editor/utils/exportUtils/htmlBuilders'
import CanvasElementComponent from './CanvasElement'

// 이미지 요소 모서리 반경(옵션 카드 사진, R3) — 편집기 화면과 내보내기 HTML이 같은 반경을 쓰는지 고정한다.
// 굽기(bakeDetailImages)는 편집기 화면을 복제해 찍으므로 편집기 감싸개 style이 곧 굽기 결과다.
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: async () => null }) }))

// 프로젝트 Vitest 변환은 classic JSX를 사용하고 Next 빌드는 React를 자동 주입한다.
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

function image(borderRadii?: [number, number, number, number]): CanvasElementData {
  return {
    id: 'img-1',
    type: 'image',
    name: 'option_card_img_0',
    transform: { x: 60, y: 40, width: 740, height: 740, rotation: 0 },
    zIndex: 3,
    isLocked: false,
    isVisible: true,
    opacity: 1,
    imageProps: {
      src: 'https://cdn.example.com/daisy.jpg',
      alt: 'option_card_img_0',
      objectFit: 'contain',
      imageType: 'options',
      isUserUploaded: false,
      ...(borderRadii ? { borderRadii } : {}),
    },
  }
}

const editorHtml = (el: CanvasElementData) =>
  renderToStaticMarkup(createElement(CanvasElementComponent, { element: el, sectionId: 's', sectionType: 'petit_div' }))
const exportedHtml = (el: CanvasElementData) =>
  exportRenderHtml(
    [
      {
        id: 's', sectionType: 'petit_div', groupType: 'modules', order: 0, isVisible: true, layoutId: 'x',
        canvas: { width: 860, height: 820, backgroundColor: '#FFFFFF' }, elements: [el],
      } as CanvasSection,
    ],
    {},
  )

describe('이미지 요소 모서리 반경 — 편집기·내보내기 같은 값', () => {
  it('borderRadii가 있으면 두 경로 모두 감싸개를 같은 반경으로 자른다(overflow hidden)', () => {
    const el = image([24, 24, 0, 0])
    const editor = editorHtml(el)
    expect(editor).toMatch(/overflow:hidden[^"]*border-radius:24px 24px 0px 0px|border-radius:24px 24px 0px 0px[^"]*overflow:hidden/)
    expect(exportedHtml(el)).toContain('overflow:hidden;border-radius:24px 24px 0px 0px;')
  })

  it('없으면 두 경로 모두 각진 모서리(기존과 같음)', () => {
    const el = image()
    expect(editorHtml(el)).not.toContain('border-radius')
    expect(exportedHtml(el)).not.toContain('border-radius')
  })
})
