import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CanvasElement as CanvasElementData, CanvasSection } from '@/lib/registration/editor/types/canvas'
import type { MotionClip } from '@/lib/registration/editor/types/editor'
import CanvasElementComponent from './CanvasElement'
import CanvasSectionComponent from './CanvasSection'
import { MotionPreviewProvider, MotionPreviewToggle, useMotionPreview } from './MotionPreview'

// 편집기 미리보기 움직이는 칸 재생(결정 카드 c30, 가정 B6) — 미리보기 세 곳만 공급자를 두고, 본 캔버스(굽기 원본)는 늘 포스터다.
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: async () => null }) }))

// 프로젝트 Vitest 변환은 classic JSX를 사용하고 Next 빌드는 React를 자동 주입한다.
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

const POSTER = 'https://cdn.example.com/hero.jpg'
const WEBP = 'https://cdn.example.com/hero_motion-motion.webp'
const CLIPS: Record<string, MotionClip> = { [POSTER]: { webpUrl: WEBP, width: 780, height: 1040, bytes: 480_000 } }

const transform = { x: 0, y: 0, width: 860, height: Math.round((860 * 1040) / 780), rotation: 0 }

function image(id = 'hero-img'): CanvasElementData {
  return {
    id, type: 'image', name: 'hero', transform, zIndex: 1, isLocked: false, isVisible: true, opacity: 1,
    imageProps: { src: POSTER, alt: 'hero', objectFit: 'cover', imageType: 'hero', isUserUploaded: false },
  }
}

function framed(id = 'scene'): CanvasElementData {
  return {
    id, type: 'framed-image', name: 'designcut-scene', transform, zIndex: 1, isLocked: false, isVisible: true, opacity: 1,
    framedImageProps: {
      src: POSTER, alt: 'scene', frameId: 'designcut', clipPath: 'none', viewBox: '0 0 100 100', bgColor: '#FFFFFF',
      objectFit: 'cover', imageType: 'designcut_product', isUserUploaded: false,
    } as CanvasElementData['framedImageProps'],
  }
}

const section = (el: CanvasElementData): CanvasSection => ({
  id: 's1', sectionType: 'hero' as CanvasSection['sectionType'], groupType: 'modules', order: 0, isVisible: true, layoutId: 'k',
  canvas: { width: 860, height: transform.height, backgroundColor: '#fff' }, elements: [el],
})

const elementHtml = (el: CanvasElementData, srcs: Record<string, string> | null | 'none') => {
  const node = createElement(CanvasElementComponent, { element: el, sectionId: 's1', sectionType: 'hero' })
  return renderToStaticMarkup(srcs === 'none' ? node : createElement(MotionPreviewProvider, { value: srcs }, node))
}

/** 미리보기 화면과 같은 짜임 — useMotionPreview(기본 꺼짐) + 전환 버튼 + 공급자 */
function PreviewHarness({ sections, start }: { sections: CanvasSection[]; start?: boolean }) {
  const motion = useMotionPreview(sections, CLIPS)
  const [ready, setReady] = React.useState(false)
  if (start && !ready) {
    setReady(true)
    motion.toggle()
  }
  return createElement(
    'div',
    null,
    createElement(MotionPreviewToggle, { playing: motion.playing, count: motion.count, onToggle: motion.toggle }),
    createElement(MotionPreviewProvider, { value: motion.srcs }, sections.map((s) => createElement(CanvasSectionComponent, { key: s.id, section: s }))),
  )
}

describe('사진 요소 — 공급자가 켠 칸만 움직이는 WebP', () => {
  it('공급자가 없으면(본 캔버스·굽기 원본) 포스터 그대로', () => {
    const html = elementHtml(image(), 'none')
    expect(html).toContain(`src="${POSTER}"`)
    expect(html).not.toContain(WEBP)
    expect(html).not.toContain('data-motion-preview')
  })

  it('공급자 값이 null(미리보기 꺼짐)이거나 다른 요소 id면 포스터', () => {
    expect(elementHtml(image(), null)).toContain(`src="${POSTER}"`)
    expect(elementHtml(image(), { other: WEBP })).not.toContain(WEBP)
  })

  it('켠 칸은 같은 자리·같은 맞춤으로 WebP를 그린다 — 그림 요소와 틀 사진 요소 모두', () => {
    const img = elementHtml(image(), { 'hero-img': WEBP })
    expect(img).toContain(`src="${WEBP}"`)
    expect(img).toContain('data-motion-preview=""')
    expect(img).toContain('object-fit:cover')
    const fr = elementHtml(framed(), { scene: WEBP })
    expect(fr).toContain(`src="${WEBP}"`)
    expect(fr).toContain('data-motion-preview=""')
  })
})

describe('미리보기 재생 상태 — 기본 포스터, 전환 버튼', () => {
  it('처음에는 꺼짐: 버튼은 "보기 (칸 수)"이고 사진은 포스터다', () => {
    const html = renderToStaticMarkup(createElement(PreviewHarness, { sections: [section(image())] }))
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('움직이는 칸 보기 (1)')
    expect(html).toContain(`src="${POSTER}"`)
    expect(html).not.toContain(WEBP)
  })

  it('켜면 내보내기가 바꿔 넣는 칸만 WebP로 재생하고 버튼은 "멈추기"', () => {
    const html = renderToStaticMarkup(createElement(PreviewHarness, { sections: [section(image())], start: true }))
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('움직이는 칸 멈추기')
    expect(html).toContain(`src="${WEBP}"`)
  })

  it('움직이는 칸이 없는 잡(바꿔 넣을 칸 0)은 버튼을 그리지 않는다', () => {
    const cropped = { ...image(), imageProps: { ...image().imageProps!, cropRect: { x: 0, y: 0, width: 50, height: 50 } } }
    const html = renderToStaticMarkup(createElement(PreviewHarness, { sections: [section(cropped)], start: true }))
    expect(html).not.toContain('<button')
    expect(html).not.toContain(WEBP)
  })
})

describe('굽기는 미리보기 재생을 찍지 않는다', () => {
  const root = path.resolve(__dirname)
  const read = (rel: string) => readFileSync(path.resolve(root, rel), 'utf8')
  const PREVIEWS = ['MobilePreview.tsx', 'MobileEditorViewer.tsx', '../PdpEditorPreview.tsx']

  it('본 캔버스(굽기 원본, data-canvas-content)에는 재생 공급자가 없다', () => {
    const canvas = read('Canvas.tsx')
    expect(canvas).toContain('data-canvas-content')
    expect(canvas).not.toContain('MotionPreview')
    expect(read('MainCanvas.tsx')).not.toContain('MotionPreview')
  })

  it('미리보기 세 곳만 공급자를 두고, 굽기가 찾는 표시(data-canvas-content)를 갖지 않는다', () => {
    for (const rel of PREVIEWS) {
      const src = read(rel)
      expect(src, rel).toContain('<MotionPreviewProvider value={motion.srcs}>')
      expect(src, rel).not.toContain('data-canvas-content')
    }
  })

  it('굽기 호출부는 본 캔버스 표시로만 캔버스를 찾는다', () => {
    expect(read('CoupangImageSave.tsx')).toContain(`document.querySelector<HTMLElement>('[data-canvas-content]')`)
  })
})
