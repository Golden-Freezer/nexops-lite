/**
 * K 라인 섹션 값 합치기 — 실제 라이브러리 템플릿으로 카피·입력값·컷 키가 엔진까지 가는지 본다. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { resolveImage } from '@/lib/registration/editor/utils/sectionConverter/designCut/compose'
import type { PdpSpecSheet } from '../pdp-state'
import { renderTemplate } from './engine'
import { ctxOf } from './engine.fixture'
import type { LineInputs } from './input-values'
import { TEMPLATES, templateById } from './library'
import { keyedShots, pointChapterOf, sectionSlotValues, shotKey, slotCopySections, templateRefsOf } from './section-values'
import { assignShots, type OrderedSection } from './selection-order'
import { INPUT_PHOTO_LISTS, type Template } from './template-types'

const inputs = (over: Partial<LineInputs> = {}): LineInputs => ({
  spec: { rating: 4.8, reviewCount: 12 } as unknown as PdpSpecSheet,
  cards: [
    { text: '좋아요', author: '김**', rating: 5 },
    { text: '또 사요', author: '박**', rating: 4 },
    { text: '예뻐요', author: '이**', rating: 5 },
  ],
  options: [
    { label: '빨강', image: 'https://img.test/a.png' },
    { label: '파랑', image: 'https://img.test/b.png' },
  ],
  ...over,
})

const template = (id: string): Template => templateById(id)!
const rowOf = (id: string, over: Partial<OrderedSection> = {}): OrderedSection => {
  const t = template(id)
  return { section: t.section, templateId: id, bg: 'W', shots: assignShots([t])[0], ...over }
}
/** 키가 있으면 사진이 있다고 본다 — 빠뜨릴 키만 고른다 */
const ctxWithout = (missing: (key: string) => boolean = () => false) =>
  ctxOf({ image: (key: string | null) => (key && !missing(key) ? `https://img.test/${key}.png` : null) })

describe('컷 키', () => {
  it('같은 칸은 항목 번호로 나뉘고 콜론이 없어 resolveImage가 직접 키로 읽는다', () => {
    const shots = keyedShots(3, rowOf('petit_div.hashtag-grid'))
    expect(shots.map((s) => [s.key, s.item])).toEqual([
      ['k3_shots_photo_0', 0],
      ['k3_shots_photo_1', 1],
      ['k3_shots_photo_2', 2],
      ['k3_shots_photo_3', 3],
    ])
    expect(resolveImage({ [shotKey(3, 'shots.photo', 0)]: 'https://img.test/a.png' }, 'k3_shots_photo_0')).toBe('https://img.test/a.png')
    expect(resolveImage({}, 'k3_shots_photo_0')).toBeNull()
  })
})

describe('컷 배정 전수', () => {
  it('필수 사진 칸을 컷이 모두 채운다 — 옵션 사진 목록·라인업만 입력값으로 채운다', () => {
    for (const t of TEMPLATES) {
      const shots = assignShots([t])[0].map((s) => s.slot)
      for (const [name, def] of Object.entries(t.slots)) {
        if (def.type === 'image' && def.required) expect(shots, `${t.id}.${name}`).toContain(name)
        if (def.type !== 'list' || !def.required || INPUT_PHOTO_LISTS.includes(def.input ?? '')) continue
        for (const [field, fieldDef] of Object.entries(def.fields)) {
          if (fieldDef.type !== 'image' || !fieldDef.required) continue
          expect(shots.filter((slot) => slot === `${name}.${field}`).length, `${t.id}.${name}.${field}`).toBeGreaterThanOrEqual(def.min)
        }
      }
    }
  })

  it('옵션 사진 목록은 컷으로 세지 않는다', () => {
    const shots = assignShots([template('product_exposure.swatch-grid')])[0]
    expect(shots.some((s) => s.slot.startsWith('swatches.'))).toBe(false)
  })
})

describe('값 합치기', () => {
  it('글자 칸·입력값·사진 칸을 합친다 — 후기 사진 카드는 입력 후기에 컷을 붙인다', () => {
    const sections = [rowOf('review.photo-cards')]
    const values = sectionSlotValues(sections, 0, { headline: '후기' }, inputs())
    expect(values.headline).toBe('후기')
    const items = values.items as Array<Record<string, string>>
    // 사진 위·글 아래 쌓기(T1-14) 뒤 상한 2 — 입력 후기 3개 중 앞 2개만 담고 둘 다 컷을 받는다
    expect(items).toHaveLength(2)
    expect(items[0].photo).toBe('k0_items_photo_0')
    expect(items[1].photo).toBe('k0_items_photo_1')
    expect(items[0]).toMatchObject({ quote: '좋아요' })
  })

  it('컷이 모자라면 남는 후기 항목은 사진 없이 둔다', () => {
    const shots = assignShots([template('review.photo-cards')])[0]
    const values = sectionSlotValues([rowOf('review.photo-cards', { shots: shots.slice(0, 1) })], 0, {}, inputs())
    const items = values.items as Array<Record<string, string>>
    expect(items).toHaveLength(2)
    expect(items[0].photo).toBe('k0_items_photo_0')
    expect(items[1].photo).toBeUndefined()
    expect(items[1]).toMatchObject({ quote: '또 사요' })
  })

  it('옵션 사진은 입력값 그대로이고 컷 키로 덮지 않는다', () => {
    const t = template('product_exposure.swatch-grid')
    const values = sectionSlotValues([rowOf(t.id)], 0, {}, inputs())
    expect(values.swatches).toEqual([{ photo: 'https://img.test/a.png' }, { photo: 'https://img.test/b.png' }])
  })

  it('큰 POINT 번호는 페이지 안 순번이고, POINT가 아니면 넣지 않는다', () => {
    const point = TEMPLATES.find((t) => t.section === 'point_div' && Object.values(t.slots).some((s) => s.type === 'text' && s.input === 'chapter'))!
    const sections = [rowOf('petit_div.hashtag-grid'), rowOf(point.id), rowOf(point.id)]
    const chapter = Object.entries(point.slots).find(([, s]) => s.type === 'text' && s.input === 'chapter')![0]
    expect(sectionSlotValues(sections, 1, {}, inputs())[chapter]).toBe('1')
    expect(sectionSlotValues(sections, 2, {}, inputs())[chapter]).toBe('2')
  })

  it('사진만 있는 목록은 컷 수만큼 항목이 생겨 엔진이 그린다', () => {
    const t = template('petit_div.hashtag-grid')
    const values = sectionSlotValues([rowOf(t.id)], 0, {}, inputs())
    expect(values.shots).toHaveLength(4)
    expect(renderTemplate(t, values, ctxWithout())).not.toBeNull()
  })

  it("'기존 제품' 칸 컷이 없으면 다른 사진으로 바꾸지 않아 엔진이 그리지 않는다(tile-duel)", () => {
    const t = template('compare.tile-duel')
    const copy = { headline: '제목' }
    const values = sectionSlotValues([rowOf(t.id)], 0, copy, inputs())
    expect(values.left).toBe('k0_left_0')
    expect(renderTemplate(t, values, ctxWithout())).not.toBeNull()
    expect(renderTemplate(t, values, ctxWithout((key) => key === 'k0_left_0'))).toBeNull()
  })
})

describe('안 그려지는 POINT(K14) — 번호와 진행 표시에서 뺀다', () => {
  const point = TEMPLATES.find((t) => t.section === 'point_div' && Object.values(t.slots).some((s) => s.type === 'text' && s.input === 'chapter'))!
  const chapter = Object.entries(point.slots).find(([, s]) => s.type === 'text' && s.input === 'chapter')![0]
  const sections = [rowOf('petit_div.hashtag-grid'), rowOf(point.id), rowOf(point.id), rowOf(point.id)]
  // 글 칸을 다 채운 값 — 필수 칸만 있으면 그려진다
  const filled = Object.fromEntries(slotCopySections([rowOf(point.id)])[0].slots.filter((s) => s.required).map((s) => [s.name, s.list ? Array.from({ length: s.list.min }, () => Object.fromEntries(s.list!.fields.map((f) => [f.name, '글']))) : '글']))

  it('글을 지워 필수 칸이 빈 POINT를 건너뛰어 01 다음 02가 된다 — 빠진 POINT 자신은 번호가 없다', () => {
    const page = new Map([[1, filled], [2, {}], [3, filled]])
    expect([1, 2, 3].map((index) => pointChapterOf(sections, index, page))).toEqual([1, undefined, 2])
    expect(sectionSlotValues(sections, 3, filled, inputs(), page)[chapter]).toBe('2')
  })

  it('페이지 글을 모르면 남는다고 본다 — 지금까지의 순번과 같다', () => {
    expect([1, 2, 3].map((index) => pointChapterOf(sections, index))).toEqual([1, 2, 3])
    expect([1, 2, 3].map((index) => pointChapterOf(sections, index, new Map()))).toEqual([1, 2, 3])
    expect(pointChapterOf(sections, 0)).toBeUndefined()
  })

  it('라이브러리에 없는 POINT는 계획에 기록되지 않으므로 세지 않는다', () => {
    const page = [{ section: 'point_div', templateId: 'point_div.none', bg: 'W', shots: [] } as OrderedSection, rowOf(point.id)]
    expect(pointChapterOf(page, 1)).toBe(1)
  })

  it('번호가 필요한 칸은 그 POINT가 그려질 때 번호를 받는다 — 전 POINT 템플릿에서 필수 글이 비면 못 그린다', () => {
    const page = new Map([[1, filled], [2, {}], [3, filled]])
    const ctx = ctxWithout()
    expect(renderTemplate(point, sectionSlotValues(sections, 2, {}, inputs(), page), ctx)).toBeNull()
    expect(renderTemplate(point, sectionSlotValues(sections, 3, filled, inputs(), page), ctx)).not.toBeNull()
  })
})

describe('카피 콜 입력과 선택 기록', () => {
  it('카피 칸이 있는 섹션만 사실 칸 수와 함께 넘기고 번호는 페이지 순서다', () => {
    const sections = [rowOf('sub2_div_page.grid-thumbs'), rowOf('compare.tile-duel', { factSlots: 2 })]
    const out = slotCopySections(sections)
    expect(out.map((s) => s.index)).toContain(1)
    expect(out.find((s) => s.index === 1)).toMatchObject({ section: 'compare', factSlots: 2 })
    expect(out.find((s) => s.index === 1)!.slots.map((s) => s.name)).toContain('headline')
  })

  it('사실 칸 수가 없으면 0이고 모르는 템플릿은 뺀다', () => {
    const out = slotCopySections([rowOf('compare.tile-duel'), { section: 'compare', templateId: 'compare.none', bg: 'W', shots: [] }])
    expect(out).toHaveLength(1)
    expect(out[0].factSlots).toBe(0)
  })

  it('기록은 섹션 수만큼이고 모르는 템플릿은 null이다', () => {
    const t = template('compare.tile-duel')
    const sections = [rowOf(t.id), { section: 'compare', templateId: 'compare.none', bg: 'W', shots: [] } as OrderedSection]
    const refs = templateRefsOf(sections, new Map([[0, { headline: '제목' }]]), inputs())
    expect(refs).toHaveLength(2)
    expect(refs[0]).toMatchObject({ id: t.id, version: t.version })
    expect(refs[0]!.slots).toMatchObject({ headline: '제목', left: 'k0_left_0', right: 'k0_right_0' })
    expect(refs[1]).toBeNull()
  })
})
