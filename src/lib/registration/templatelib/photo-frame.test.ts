import { describe, expect, it } from 'vitest'
import type { CanvasElement } from '@/lib/registration/editor/types/canvas'
import { exportRenderHtml } from '@/lib/registration/editor/utils/exportUtils/htmlBuilders'
import { conceptById } from './concepts'
import { renderTemplate } from './engine'
import { ctxOf, imageSlot, templateOf } from './engine.fixture'
import { lineShotsOf } from './line-plan'
import { TEMPLATES } from './library'
import { lintTemplate } from './lint'
import { skeletonKey } from './lint-category'
import { sampleContext, sampleSlots } from './sample'
import type { OrderedSection } from './selection-order'
import { buildShotBrief, type LineShot } from './shot-brief'
import type { FlowNode, ImageSlot, Template } from './template-types'

/** 기준 값은 시험에 고정한다 — 코드 상수를 가져오면 변이를 못 잡는다 */
const ARCH = 'inset(0 round 9999px 9999px 0 0)'
const circleSlot = imageSlot({ aspect: ['1:1'], minHeight: 300 })
const archSlot = imageSlot({ aspect: ['3:4'], minHeight: 300 })
const imageNode = (over: Partial<Extract<FlowNode, { kind: 'image' }>> = {}): FlowNode => ({ kind: 'image', slot: 'photo', w: 560, x: 150, frame: 'circle', ...over })
const framed = (node: Partial<Extract<FlowNode, { kind: 'image' }>>, slot: ImageSlot, over: Partial<Template> = {}): Template =>
  templateOf({ id: 'sub_div.frame-test', flow: [imageNode(node)], slots: { photo: slot }, ...over })
const photoOf = (t: Template, ctx = ctxOf()) => renderTemplate(t, { photo: 'key' }, ctx)!.elements.find((e) => e.type === 'framed-image') as CanvasElement
const details = (t: Template) => lintTemplate(t).filter((v) => v.rule === 'photo').map((v) => v.detail).join('|')

describe('사진 틀 그리기', () => {
  it('원은 원 틀이고 언제나 정원이다 — 실제 컷 비율·최소 높이와 무관하다', () => {
    const el = photoOf(framed({}, circleSlot), ctxOf({ aspectOf: () => 0.5 }))
    expect(el.framedImageProps!.frameId).toBe('circle')
    expect(el.framedImageProps!.clipPath).toBe('none')
    expect(el.transform.width).toBe(560)
    expect(el.transform.height).toBe(560)
    const tall = photoOf(framed({}, imageSlot({ aspect: ['1:1'], minHeight: 900 })))
    expect(tall.transform.height).toBe(tall.transform.width)
  })

  it('아치는 위 두 모서리만 둥글고 높이는 슬롯 비율을 따른다', () => {
    const el = photoOf(framed({ frame: 'arch' }, archSlot))
    expect(el.framedImageProps!.frameId).toBe('designcut')
    expect(el.framedImageProps!.clipPath).toBe(ARCH)
    expect(el.transform.height).toBe(Math.round(560 / (3 / 4)))
  })

  it('틀을 안 쓴 사진은 그대로다', () => {
    const plain = photoOf(framed({ frame: undefined }, imageSlot({ aspect: ['3:4'], minHeight: 300 })))
    expect(plain.framedImageProps!.frameId).toBe('roundedRect')
    expect(plain.framedImageProps!.clipPath).toBe('inset(0 round 16px)')
    const sharp = photoOf(framed({ frame: undefined }, imageSlot({ aspect: ['3:4'], minHeight: 300 })), ctxOf({ radius: { capsule: 0, card: 0, bubble: 0, chip: 0 } }))
    expect(sharp.framedImageProps!.frameId).toBe('rect')
    const bleed = photoOf(templateOf({ id: 'sub_div.frame-test', flow: [{ kind: 'image', slot: 'photo', bleed: true }], slots: { photo: imageSlot({ aspect: ['3:4'], minHeight: 300 }) } }))
    expect(bleed.framedImageProps!.frameId).toBe('designcut')
    expect(bleed.framedImageProps!.clipPath).toBe('none')
  })

  it('내보내기 HTML이 틀을 그대로 옮긴다 — 편집기와 같은 값을 읽는다', () => {
    const html = (t: Template) => {
      const out = renderTemplate(t, { photo: 'key' }, ctxOf())!
      return exportRenderHtml([{ id: 's', name: 's', order: 0, isVisible: true, isLocked: false, canvas: { width: 860, height: out.height, backgroundColor: out.background }, elements: out.elements }] as never, {})
    }
    expect(html(framed({}, circleSlot))).toContain('border-radius:50%')
    expect(html(framed({ frame: 'arch' }, archSlot))).toContain(`clip-path:${ARCH}`)
  })
})

describe('컨셉 사진 반경(T1-28)', () => {
  const tall = imageSlot({ aspect: ['3:4'], minHeight: 300 })
  const radiusOf = (card: number, photo?: number) => ({ capsule: 32, card, bubble: 36, chip: 999, ...(photo !== undefined ? { photo } : {}) })
  const html = (t: Template, ctx = ctxOf()) => {
    const out = renderTemplate(t, { photo: 'key' }, ctx)!
    return exportRenderHtml([{ id: 's', name: 's', order: 0, isVisible: true, isLocked: false, canvas: { width: 860, height: out.height, backgroundColor: out.background }, elements: out.elements }] as never, {})
  }

  it('사진 반경이 없으면 둥근 틀은 16이고 cornerRadius 칸이 없다(D·옛 K 잡 그대로)', () => {
    const el = photoOf(framed({ frame: undefined }, tall))
    expect(el.framedImageProps!.clipPath).toBe('inset(0 round 16px)')
    expect(el.framedImageProps).not.toHaveProperty('cornerRadius')
    expect(html(framed({ frame: undefined }, tall))).toContain('border-radius:16px;')
  })

  it('soft 12·round 24는 둥근 틀 반경·내보내기 HTML에 그대로 나온다', () => {
    for (const [card, photo] of [
      [24, 12],
      [36, 24],
    ]) {
      const ctx = ctxOf({ radius: radiusOf(card, photo) })
      const el = photoOf(framed({ frame: undefined }, tall), ctx)
      expect(el.framedImageProps!.frameId).toBe('roundedRect')
      expect(el.framedImageProps!.cornerRadius).toBe(photo)
      expect(el.framedImageProps!.clipPath).toBe(`inset(0 round ${photo}px)`)
      expect(html(framed({ frame: undefined }, tall), ctx)).toContain(`border-radius:${photo}px;`)
    }
  })

  it('square(카드 8)는 사진이 직각 틀이고 반경 칸이 없다 — 사진 0', () => {
    const el = photoOf(framed({ frame: undefined }, tall), ctxOf({ radius: radiusOf(8, 0) }))
    expect(el.framedImageProps!.frameId).toBe('rect')
    expect(el.framedImageProps!.clipPath).toBe('none')
    expect(el.framedImageProps).not.toHaveProperty('cornerRadius')
  })

  it('원·아치·풀폭 사진은 사진 반경을 받지 않는다', () => {
    const ctx = ctxOf({ radius: radiusOf(36, 24) })
    expect(photoOf(framed({}, circleSlot), ctx).framedImageProps).not.toHaveProperty('cornerRadius')
    expect(photoOf(framed({ frame: 'arch' }, archSlot), ctx).framedImageProps!.clipPath).toBe(ARCH)
    const bleed = photoOf(templateOf({ id: 'sub_div.frame-test', flow: [{ kind: 'image', slot: 'photo', bleed: true }], slots: { photo: tall } }), ctx)
    expect(bleed.framedImageProps!.clipPath).toBe('none')
    expect(bleed.framedImageProps).not.toHaveProperty('cornerRadius')
  })

  it('사진 뒤 판도 사진 반경을 따른다 — 없으면 16, 직각이면 0', () => {
    const plateOf = (ctx = ctxOf()) =>
      renderTemplate(framed({ frame: undefined, plate: { dx: 24, dy: 24 } }, tall), { photo: 'key' }, ctx)!.elements.find((e) => e.name === 'designcut-plate')!
    expect(plateOf().shapeProps!.borderRadius).toBe(16)
    expect(plateOf(ctxOf({ radius: radiusOf(36, 24) })).shapeProps!.borderRadius).toBe(24)
    expect(plateOf(ctxOf({ radius: radiusOf(8, 0) })).shapeProps!.borderRadius).toBe(0)
  })
})

describe('사진 틀 린트', () => {
  it('좋은 조합은 틀 위반이 없다', () => {
    expect(details(framed({}, circleSlot))).toBe('')
    expect(details(framed({ frame: 'arch' }, archSlot))).toBe('')
  })

  it('원은 비율 1:1만, 최소 높이는 폭 안이다', () => {
    expect(details(framed({}, imageSlot({ aspect: ['1:1', '3:4'], minHeight: 300 })))).toContain('비율 1:1만')
    expect(details(framed({}, imageSlot({ aspect: ['1:1'], minHeight: 700 })))).toContain('최소 높이 700')
  })

  it('아치는 세로 비율만이다', () => {
    expect(details(framed({ frame: 'arch' }, imageSlot({ aspect: ['1:1'], minHeight: 300 })))).toContain('세로 비율만')
    expect(details(framed({ frame: 'arch' }, imageSlot({ aspect: ['4:3'], minHeight: 300 })))).toContain('세로 비율만')
  })

  it('풀폭·뒤 판·사진 위 글·contain과 함께 쓸 수 없다', () => {
    expect(details(framed({ bleed: true, x: undefined, w: undefined }, circleSlot))).toContain('풀폭 금지')
    expect(details(framed({ plate: { dx: 16, dy: 16 } }, circleSlot))).toContain('뒤 판 금지')
    expect(details(framed({ overlay: { anchor: 'top', ink: 'light', nodes: [] } }, circleSlot))).toContain('사진 위 글 금지')
    expect(details(framed({ fit: 'contain' }, circleSlot))).toContain('cover만')
  })

  it('첫 화면·대표 컷·직각 컨셉에 쓸 수 없다', () => {
    expect(details(framed({}, circleSlot, { id: 'hook_3step.frame-test', section: 'hook_3step' }))).toContain('첫 화면 금지')
    expect(details(framed({}, imageSlot({ aspect: ['1:1'], minHeight: 300, purpose: ['hero', 'scene'] })))).toContain('대표 컷')
    const fit = { ...templateOf({}).fit, concepts: ['mono-minimal'] }
    expect(details(framed({}, circleSlot, { fit }))).toContain('직각 컨셉 금지: mono-minimal')
  })

  it('틀을 안 쓴 사진은 이 검사를 받지 않는다', () => {
    const plain = framed({ frame: undefined }, imageSlot({ aspect: ['4:3'], minHeight: 900, purpose: ['hero'] }), { fit: { ...templateOf({}).fit, concepts: ['mono-minimal'] } })
    expect(details(plain)).not.toMatch(/틀/)
  })

  it('뼈대에 틀이 드러나 사각 사진 칸과 구분된다', () => {
    expect(skeletonKey([imageNode()])).toBe('image:circle')
    expect(skeletonKey([imageNode({ frame: 'arch' })])).toBe('image:arch')
    expect(skeletonKey([imageNode({ frame: 'decor' })])).toBe('image')
    expect(skeletonKey([imageNode({ frame: undefined })])).toBe('image')
  })
})

describe('컷 지시', () => {
  const shot = (over: Partial<LineShot> = {}): LineShot => ({ key: 'k', section: 'sub_div', purpose: 'scene', composition: 'in_use', aspect: '1:1', show: '', ...over })

  it('원·아치 칸에만 잘리는 자리를 말하고, 다른 칸은 글자 하나 안 바뀐다', () => {
    const plain = buildShotBrief(shot())
    expect(plain).not.toContain('Frame:')
    const lineIn = (brief: string) => brief.split('\n').find((line) => line.startsWith('Frame:'))
    expect(lineIn(buildShotBrief(shot({ clipShape: 'circle' })))).toContain('four corners disappear')
    expect(lineIn(buildShotBrief(shot({ clipShape: 'arch' })))).toContain('two top corners disappear')
    expect(buildShotBrief(shot({ clipShape: 'circle' })).replace(/\n?Frame:[^\n]*/, '')).toBe(plain)
  })

  const rowOf = (templateId: string, slot: string) =>
    ({ section: 'x', templateId, shots: [{ slot, purpose: 'scene', composition: 'in_use' }] }) as unknown as OrderedSection

  it('계획이 슬롯의 틀을 컷 기록에 싣는다 — 목록 칸도 읽고, 틀이 없으면 칸 자체가 없다', () => {
    expect(lineShotsOf([rowOf('point_list_div.circle-trio', 'items.photo')], new Map(), [])[0].clipShape).toBe('circle')
    expect(lineShotsOf([rowOf('sub_div.arch-pair', 'items.photo')], new Map(), [])[0].clipShape).toBe('arch')
    expect(lineShotsOf([rowOf('concept_desc.circle-center', 'photo')], new Map(), [])[0].clipShape).toBe('circle')
    const plain = lineShotsOf([rowOf('concept_desc.rule-offset', 'photo')], new Map(), [])[0]
    expect(Object.keys(plain)).not.toContain('clipShape')
  })
})

describe('틀 템플릿', () => {
  const ids = ['point_list_div.circle-trio', 'concept_desc.circle-center', 'sub_div.arch-pair']
  const shape: Record<string, 'circle' | 'designcut'> = { 'point_list_div.circle-trio': 'circle', 'concept_desc.circle-center': 'circle', 'sub_div.arch-pair': 'designcut' }

  it('라이브러리에 있고 전수 검사를 지나며 표본 사진이 그 틀로 그려진다', () => {
    for (const id of ids) {
      const t = TEMPLATES.find((x) => x.id === id)!
      expect(t, id).toBeDefined()
      expect(lintTemplate(t), id).toEqual([])
      const out = renderTemplate(t, sampleSlots(t, { mode: 'full' }), sampleContext())!
      const photos = out.elements.filter((e) => e.type === 'framed-image')
      expect(photos.length, id).toBe(t.needs.photos)
      for (const photo of photos) expect(photo.framedImageProps!.frameId, id).toBe(shape[id])
    }
  })

  it('직각 컨셉은 고르지 않는다', () => {
    for (const id of ids) {
      for (const concept of TEMPLATES.find((x) => x.id === id)!.fit.concepts) expect(conceptById(concept)?.shape, `${id} ${concept}`).not.toBe('square')
    }
  })
})
