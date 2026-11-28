import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '../types/canvas'
import { elementsWithSrc, imageSrcOf, imageSrcPatch } from './imageSwap'
import { R1_JOBS, renderR1 } from './sectionConverter/__fixtures__/r1Render'

/** src만 지운 사본 — 바꾼 뒤에도 나머지(위치·크기·글자·순서)가 같아야 한다 */
function withoutSrc(sections: CanvasSection[]) {
  return sections.map((s) => ({
    ...s,
    elements: s.elements.map((el) => ({
      ...el,
      imageProps: el.imageProps && { ...el.imageProps, src: '', isUserUploaded: false },
      framedImageProps: el.framedImageProps && { ...el.framedImageProps, src: '', isUserUploaded: false },
    })),
  }))
}

function swapAll(sections: CanvasSection[], from: string, to: string, isUserUploaded: boolean): CanvasSection[] {
  const targets = new Set(elementsWithSrc(sections, from).map((t) => t.elementId))
  return sections.map((s) => ({
    ...s,
    elements: s.elements.map((el) => (targets.has(el.id) ? { ...el, ...imageSrcPatch(el, to, isUserUploaded) } : el)),
  }))
}

const el = (patch: Partial<CanvasElement>): CanvasElement => ({
  id: 'e',
  type: 'text',
  name: 'x',
  transform: { x: 0, y: 0, width: 10, height: 10, rotation: 0 },
  zIndex: 1,
  isLocked: false,
  isVisible: true,
  opacity: 1,
  ...patch,
})

describe('imageSrcPatch', () => {
  it('image·framed-image만 src를 바꾸고 나머지 속성은 그대로 둔다', () => {
    const image = el({ type: 'image', imageProps: { src: 'a', alt: 'a', objectFit: 'cover', imageType: 'hero', isUserUploaded: false, cropRect: { x: 1, y: 2, width: 3, height: 4 } } })
    expect(imageSrcPatch(image, 'b', true)).toEqual({ imageProps: { ...image.imageProps, src: 'b', isUserUploaded: true } })
    const framed = el({ type: 'framed-image', framedImageProps: { src: 'a', alt: 'a', frameId: 'circle', clipPath: 'none', viewBox: '0 0 100 100', bgColor: '#fff', objectFit: 'cover', imageType: 'x', isUserUploaded: false } })
    expect(imageSrcPatch(framed, 'b', false)?.framedImageProps?.src).toBe('b')
    expect(imageSrcPatch(el({ type: 'text' }), 'b', true)).toBeNull()
    expect(imageSrcOf(el({ type: 'shape' }))).toBeNull()
  })
})

describe('R1 저장 잡 — 같은 컷이 든 자리를 모두 바꿔도 배치는 그대로', () => {
  for (const [key, f] of R1_JOBS) {
    it(`${key}: 생성 컷 src를 바꾸면 그 컷이 든 요소만 바뀌고, 글자·위치·요소 수는 같으며, 프리셋 가드 탈락은 0`, async () => {
      const { doc, stats } = await renderR1(f)
      expect(stats.layouts.guardDropped, JSON.stringify(stats.layouts)).toBe(0)

      const urls = Object.values(f.images as Record<string, unknown>)
        .flat()
        .filter((u): u is string => typeof u === 'string' && u.startsWith('http'))
      const from = urls.find((u) => elementsWithSrc(doc.sections, u).length > 0)
      expect(from, '문서에 생성 컷이 하나도 안 들어갔다').toBeDefined()

      const before = elementsWithSrc(doc.sections, from!)
      const swapped = swapAll(doc.sections, from!, 'https://img.test/regen.png', false)
      expect(elementsWithSrc(swapped, from!)).toEqual([])
      expect(elementsWithSrc(swapped, 'https://img.test/regen.png')).toEqual(before)
      expect(withoutSrc(swapped)).toEqual(withoutSrc(doc.sections))
    })
  }
})
