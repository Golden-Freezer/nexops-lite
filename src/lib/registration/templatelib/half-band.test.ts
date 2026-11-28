/**
 * K7-c 4a 반 띠(T2-42) — image `half`: 섹션 위 48 아래부터 사진 높이 절반까지 풀폭 면을 맨 아래 z에 깔고, 면 위 노드는 면 바탕으로 그린다.
 * D 큰 POINT half(buildT3aHalf)와 같은 식·같은 요소 이름(designCut/halfPlane.ts 공용). 칸 product_exposure.half-band·sub_div.half-band. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import { halfPlaneOf } from '@/lib/registration/editor/utils/sectionConverter/designCut/halfPlane'
import { mix, surfaceOf } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import { colorSetsOf } from './color-sets'
import { CONCEPTS } from './concepts'
import { renderTemplate } from './engine'
import { COLORS, ctxOf, imageSlot, templateOf, textSlot } from './engine.fixture'
import { TEMPLATES, templateById } from './library'
import { lintTemplate } from './lint'
import { lintCategoryTemplates, screenKey, skeletonKey } from './lint-category'
import { sampleSlots } from './sample'
import { deriveSignature, signatureKey } from './signature'
import type { FlowNode, ImageNode, Template } from './template-types'

/** 코드 상수를 가져오면 상수가 틀어져도 시험이 함께 움직인다 — 숫자·이름으로 고정한다 */
const PLANE = 'designcut-half-plane'
const HALF_TOP = 48
const W = 860

/** 새 칸 → 사실 수를 맞춘 같은 섹션 가까운 공용 칸 */
const NEW_CELLS: Readonly<Record<string, string>> = {
  'product_exposure.half-band': 'product_exposure.parts-plate',
  'sub_div.half-band': 'sub_div.title-chips',
}

const halfPhoto = (over: Partial<ImageNode> = {}): FlowNode => ({ kind: 'image', slot: 'photo', half: true, ...over })
const fixture = (flow: FlowNode[], photo = imageSlot({ required: true, aspect: ['4:3'] }), over: Partial<Template> = {}) =>
  templateOf({
    id: 'sub_div.half-fixture',
    flow,
    slots: { title: textSlot({ required: true, maxChars: 22 }), photo, note: textSlot({ maxChars: 22 }), photo2: imageSlot({ required: true }) },
    surfaces: ['W', 'N', 'T', 'D'],
    ...over,
  })
const HEAD: FlowNode = { kind: 'text', slot: 'title', token: 'H1', emphasis: true, gapAfter: 'photoGap' }
const SLOTS = { title: '면 위에 얹는 {제목}', photo: 'a', note: '사진 아래 글', photo2: 'b' }

const draw = (t: Template, ctx = ctxOf(), slots: Record<string, string> = SLOTS) => {
  const out = renderTemplate(t, slots, ctx)
  if (!out) throw new Error('그리지 못함')
  return out
}
const named = (out: ReturnType<typeof draw>, name: string) => out.elements.filter((el) => el.name === name)
const one = (out: ReturnType<typeof draw>, name: string) => {
  const [el, ...rest] = named(out, name)
  if (!el || rest.length > 0) throw new Error(`${name} ${named(out, name).length}개`)
  return el
}
const cell = (id: string): Template => {
  const found = templateById(id)
  if (!found) throw new Error(`라이브러리에 없음: ${id}`)
  return found
}
const halvesOf = (t: Template) => lintTemplate(t).filter((v) => v.detail.includes('반 띠'))
const sectionOf = (out: ReturnType<typeof draw>, sectionType: string) =>
  ({
    id: 's',
    sectionType,
    groupType: 'modules',
    order: 0,
    isVisible: true,
    layoutId: 'designcut_k_x',
    preserveBottomPad: true,
    canvas: { width: W, height: out.height, backgroundColor: out.background },
    elements: out.elements,
  }) as unknown as CanvasSection

describe('반 띠 그리기 — 면 위치·높이·색', () => {
  it('면은 맨 아래 z이고 섹션 위 48 아래 풀폭에서 사진 위 끝 + 사진 높이 절반까지 내려온다', () => {
    const out = draw(fixture([HEAD, halfPhoto()]))
    const plane = one(out, PLANE)
    const photo = one(out, 'designcut-scene')
    expect(Math.min(...out.elements.map((el) => el.zIndex))).toBe(plane.zIndex)
    expect(plane.transform).toMatchObject({ x: 0, y: HALF_TOP, width: W })
    expect(plane.transform.height).toBe(photo.transform.y + Math.round(photo.transform.height / 2) - HALF_TOP)
    // 사진은 본문 폭이고 면 아래 경계에 걸친다
    expect(photo.transform.width).toBeLessThan(W)
    expect(photo.transform.y).toBeLessThan(HALF_TOP + plane.transform.height)
    expect(photo.transform.y + photo.transform.height).toBeGreaterThan(HALF_TOP + plane.transform.height)
  })

  it('면 색은 D 큰 POINT half와 같은 식 — 밝은 바탕은 tint, 짙은 바탕은 흰색 10%, 바탕이 이미 tint면 강조색 12%', () => {
    const t = fixture([HEAD, halfPhoto()])
    expect(one(draw(t, ctxOf({ bg: 'W' })), PLANE).shapeProps?.fill).toBe(COLORS.tint)
    expect(one(draw(t, ctxOf({ bg: 'N' })), PLANE).shapeProps?.fill).toBe(COLORS.tint)
    expect(one(draw(t, ctxOf({ bg: 'D' })), PLANE).shapeProps?.fill).toBe(mix(COLORS.deep, '#FFFFFF', 0.1))
    expect(one(draw(t, ctxOf({ bg: 'T' })), PLANE).shapeProps?.fill).toBe(mix(COLORS.tint, COLORS.accent, 0.12))
    for (const bg of ['W', 'N', 'T', 'D'] as const) {
      expect(one(draw(t, ctxOf({ bg })), PLANE).shapeProps?.fill, bg).toBe(halfPlaneOf(surfaceOf(bg, COLORS), COLORS).fill)
    }
  })

  it('면 위 글은 면 바탕으로, 사진 뒤 글은 섹션 바탕으로 색을 정한다 — 흰 바탕 칸의 면 위 제목은 tint 바탕 제목과 같다', () => {
    const note: FlowNode = { kind: 'text', slot: 'note', token: 'BODY' }
    const titleOf = (out: ReturnType<typeof draw>) => out.elements.find((el) => el.type === 'text' && el.textProps?.content?.includes('면 위에'))
    const noteOf = (out: ReturnType<typeof draw>) => out.elements.find((el) => el.type === 'text' && el.textProps?.content === '사진 아래 글')
    // 제목 본색이 흰 바탕 대비 4.95·tint 바탕 대비 3.8이 되는 색 — 흰 바탕으로 재면 제목 본색, 면 바탕으로 재면 글자색(ink)이라 둘이 갈린다
    const colors = { ...COLORS, heading: '#707070', tint: '#D8E2F5' }
    const plain = fixture([HEAD, { kind: 'image', slot: 'photo', gapAfter: 'photoGap' }, note])
    const onFace = draw(fixture([HEAD, halfPhoto({ gapAfter: 'photoGap' }), note]), ctxOf({ bg: 'W', colors }))
    const onTint = draw(plain, ctxOf({ bg: 'T', colors }))
    const onWhite = draw(plain, ctxOf({ bg: 'W', colors }))
    expect(titleOf(onWhite)?.textProps?.color).toBe('#707070')
    expect(titleOf(onFace)?.textProps?.color).toBe(COLORS.ink)
    expect(titleOf(onFace)?.textProps).toEqual(titleOf(onTint)?.textProps)
    expect(noteOf(onFace)?.textProps).toEqual(noteOf(onWhite)?.textProps)
  })

  it('반 띠가 없는 칸은 면을 만들지 않는다 — 라이브러리 전 칸(반 띠 칸 빼고)', () => {
    const hasHalf = (nodes: readonly FlowNode[]): boolean => nodes.some((n) => n.kind === 'image' && n.half === true)
    const plain = TEMPLATES.filter((t) => !hasHalf(t.flow))
    expect(plain.length).toBeGreaterThan(TEMPLATES.length - Object.keys(NEW_CELLS).length - 1)
    const leaks = plain.flatMap((t) => {
      const out = renderTemplate(t, sampleSlots(t, { mode: 'full' }), ctxOf({ bg: t.surfaces[0] }))
      return out && named(out, PLANE).length > 0 ? [t.id] : []
    })
    expect(leaks).toEqual([])
  })
})

describe('반 띠 린트 — 맨 위 단계 본문 폭 사진 하나', () => {
  it('맨 위 단계 본문 폭 필수 사진 하나면 반 띠 위반이 없다', () => {
    expect(halvesOf(fixture([HEAD, halfPhoto()]))).toEqual([])
  })

  const BAD: Array<[string, Template]> = [
    ['둘', fixture([HEAD, halfPhoto(), { kind: 'image', slot: 'photo2', half: true }])],
    ['판 안', fixture([HEAD, { kind: 'panel', fill: 'T', nodes: [halfPhoto()] }])],
    ['풀폭', fixture([HEAD, halfPhoto({ bleed: true })])],
    ['어긋난 폭', fixture([HEAD, halfPhoto({ w: 600 })])],
    ['뒤 판', fixture([HEAD, halfPhoto({ plate: { dx: 24, dy: 24 } })])],
    ['원', fixture([HEAD, halfPhoto({ frame: 'circle' })])],
    ['선택 사진', fixture([HEAD, halfPhoto()], imageSlot({ required: false, aspect: ['4:3'] }))],
  ]
  for (const [label, t] of BAD) {
    it(`${label} — 반 띠 위반`, () => {
      expect(halvesOf(t).length).toBeGreaterThan(0)
    })
  }
})

describe('반 띠 서명·화면 키', () => {
  it('서명은 띠(band)로, 뼈대·화면 키는 반 띠로 따로 센다 — 판 사진·그냥 사진과 겹치지 않는다', () => {
    const t = fixture([HEAD, halfPhoto()])
    const plain = fixture([HEAD, { kind: 'image', slot: 'photo' }])
    expect(deriveSignature(t).container).toBe('band')
    expect(deriveSignature(plain).container).not.toBe('band')
    expect(skeletonKey(t.flow)).toContain('image:half')
    expect(screenKey(t.flow, t.slots)).toContain('photo:half')
    expect(screenKey(t.flow, t.slots)).not.toBe(screenKey(plain.flow, plain.slots))
  })
})

describe('K7-c 4a 칸 2개 — product_exposure.half-band·sub_div.half-band', () => {
  it('두 칸 모두 린트 위반 0, W·N, 맨 위 단계 본문 폭 반 띠 사진 하나', () => {
    for (const id of Object.keys(NEW_CELLS)) {
      const t = cell(id)
      expect(lintTemplate(t), id).toEqual([])
      expect(t.surfaces, id).toEqual(['W', 'N'])
      const halves = t.flow.filter((n) => n.kind === 'image' && n.half)
      expect(halves, id).toHaveLength(1)
      expect(t.signature.container, id).toBe('band')
    }
  })

  it('같은 섹션 공용과 서명이 다르고, 카테고리 칸과 화면이 겹치지 않는다(전수 린트는 library.test)', () => {
    for (const id of Object.keys(NEW_CELLS)) {
      const t = cell(id)
      const others = TEMPLATES.filter((other) => other.section === t.section && other.id !== id && !(other.fit?.categories?.length ?? 0))
      for (const other of others) expect(signatureKey(deriveSignature(other)), `${id} ↔ ${other.id}`).not.toBe(signatureKey(deriveSignature(t)))
    }
    expect(lintCategoryTemplates(TEMPLATES)).toEqual([])
  })

  it('사실 수는 같은 섹션 가까운 공용 칸과 같다 — 사실 예산 물결을 키우지 않는다', () => {
    for (const [id, near] of Object.entries(NEW_CELLS)) expect(cell(id).needs.facts, id).toEqual(cell(near).needs.facts)
  })

  it('모든 컨셉 색 조합 × W·N에서 면 위 글자 대비(M2)·글자 하한(M1) 위반이 없다', () => {
    const sets = CONCEPTS.flatMap((c) => colorSetsOf(c).sets)
    expect(sets.length).toBeGreaterThan(500)
    const failures: string[] = []
    for (const id of Object.keys(NEW_CELLS)) {
      const t = cell(id)
      const slots = sampleSlots(t, { mode: 'full' })
      for (const set of sets) {
        for (const bg of t.surfaces) {
          const out = renderTemplate(t, slots, ctxOf({ colors: set.colors, bg }))
          if (!out) {
            failures.push(`${id} ${set.id} ${bg} 그리지 못함`)
            continue
          }
          const bad = checkMobileReadability({ sections: [sectionOf(out, t.section)] }).violations.filter((v) => v.rule === 'M1' || v.rule === 'M2')
          for (const v of bad) failures.push(`${id} ${set.id} ${bg} ${v.rule} ${v.detail}`)
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([])
  })
})
