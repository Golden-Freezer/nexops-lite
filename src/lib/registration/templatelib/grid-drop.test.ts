/**
 * 뺀 컷 뒤 목록 칸 정리(결정 카드 c08·J44) — usegate 잡에서 쓰는 법 미달로 뺀 컷이 여러 장 섹션의 목록 항목이면 그 항목을 글·이름표째 빼고
 * 남은 수로 그린다. 픽스처: 4 → 3(위 2·아래 1 가운데), 2 → 1(한 장 가운데), 1 → 0(섹션째 빠짐). 뺀 컷 목록이 없으면(꺼진 잡) 지금 그대로. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import { composeDesignCut } from '@/lib/registration/editor/utils/sectionConverter/designCut/compose'
import { readDesignCut } from '@/lib/registration/editor/utils/sectionConverter/designCut/contract'
import { designCutPlanForB } from '@/lib/registration/editor/utils/sectionConverter/designCut/designCut.fixture'
import { CONTENT_W, MARGIN } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import type { PdpJobRow } from '@/lib/registration/pdp-state'
import { COUNT_FIXED_TEMPLATES, K_SPACE, droppedListMin, renderTemplate } from './engine'
import { ctxOf, imageSlot, templateOf, textSlot } from './engine.fixture'
import { templateById } from './library'
import { lostSectionsOf } from './line-plan'
import { mockSlots } from './mock'
import type { SlotItem, SlotValues, Template } from './template-types'

type Out = NonNullable<ReturnType<typeof renderTemplate>>

const grid = (min: number) =>
  templateOf({
    flow: [
      { kind: 'text', slot: 'headline', token: 'H2', gapAfter: 'photoGap' },
      {
        kind: 'repeat',
        slot: 'items',
        columns: 2,
        gap: 'blockGap',
        nodes: [
          { kind: 'image', slot: 'photo', gapAfter: 'tightGap' },
          { kind: 'text', slot: 'caption', token: 'CAPTION' },
        ],
      },
    ],
    slots: {
      headline: textSlot({ required: true, facts: 0 }),
      items: { type: 'list', required: true, min, max: 4, fields: { photo: imageSlot({ required: true }), caption: textSlot({ required: true }) } },
    },
  })
const key = (i: number) => `k3_items_photo_${i}`
const itemsOf = (n: number): SlotItem[] => Array.from({ length: n }, (_, i) => ({ photo: key(i), caption: `칸 설명 ${i + 1}` }))
const urlOf = (k: string) => `https://cdn.test/${k}.png`
/** 실제 길처럼 뺀 컷은 주소가 없다(section_images url '') — 사진 함수가 null을 준다. marked면 뺀 컷 목록(편집기 응답 dropped_cuts)도 넘긴다 */
const ctxWithout = (gone: string[], marked = true) =>
  ctxOf({ image: (k) => (k && !gone.includes(k) ? urlOf(k) : null), ...(marked ? { dropped: new Set(gone) } : {}) })
const photos = (out: Out) => out.elements.filter((e) => e.name === 'designcut-scene')
const captions = (out: Out) => out.elements.filter((e) => e.name === 'designcut-caption')
const layoutOf = (out: Out) => out.elements.map((e) => [e.name, e.transform.x, e.transform.y, e.transform.width, e.transform.height])
const COL_W = Math.floor((CONTENT_W - K_SPACE.columnGap) / 2)
const CENTER_X = MARGIN + Math.round((COL_W + K_SPACE.columnGap) / 2)

describe('뺀 컷 항목 빼고 다시 놓기(J44)', () => {
  it('4 → 3: 뺀 컷 항목은 사진·설명째 빠지고, 덜 찬 아래 줄 한 칸은 가운데로 모인다', () => {
    const out = renderTemplate(grid(2), { headline: '제목', items: itemsOf(4) }, ctxWithout([key(1)]))!
    expect(photos(out)).toHaveLength(3)
    expect(captions(out).map((e) => e.textProps?.content)).toEqual(['칸 설명 1', '칸 설명 3', '칸 설명 4'])
    expect(photos(out).map((e) => e.transform.x)).toEqual([MARGIN, MARGIN + COL_W + K_SPACE.columnGap, CENTER_X])
    // 설명은 제 사진 바로 아래·같은 칸 — 떠 있는 글이 없다
    captions(out).forEach((caption, i) => {
      const photo = photos(out)[i]
      expect(caption.transform.x).toBe(photo.transform.x)
      expect(caption.transform.y).toBeGreaterThan(photo.transform.y + photo.transform.height)
    })
    expect(photos(out).every((e) => e.transform.width === COL_W)).toBe(true)
  })

  it('지금 길(뺀 컷 목록 없음)은 그대로 — 사진 틀만 빠지고 그 칸 설명이 남는다(꺼진 잡·API 실패 컷)', () => {
    const out = renderTemplate(grid(2), { headline: '제목', items: itemsOf(4) }, ctxWithout([key(1)], false))!
    expect(photos(out)).toHaveLength(3)
    expect(captions(out)).toHaveLength(4)
  })

  it('2 → 1: 남은 한 장은 칸 크기 그대로 가운데 한 칸이다', () => {
    const out = renderTemplate(grid(1), { headline: '제목', items: itemsOf(2) }, ctxWithout([key(0)]))!
    expect(photos(out)).toHaveLength(1)
    expect(captions(out).map((e) => e.textProps?.content)).toEqual(['칸 설명 2'])
    expect(photos(out)[0].transform).toMatchObject({ x: CENTER_X, width: COL_W })
    expect(photos(out)[0].framedImageProps?.src).toBe(urlOf(key(1)))
  })

  it('1 → 0: 남은 항목이 최소보다 적으면 섹션째 빠진다', () => {
    expect(renderTemplate(grid(1), { headline: '제목', items: itemsOf(1) }, ctxWithout([key(0)]))).toBeNull()
  })

  it('덜어진 목록은 최소를 한 장 낮춘다(J48, 하한 2·원래보다 올리지 않음) — 최소 4장 격자 4 → 3은 같은 템플릿으로 위 2·아래 1 가운데, 4 → 2는 섹션째', () => {
    expect([1, 2, 3, 4, 5].map(droppedListMin)).toEqual([1, 2, 2, 3, 4])
    const three = renderTemplate(grid(4), { headline: '제목', items: itemsOf(4) }, ctxWithout([key(2)]))!
    expect(photos(three).map((e) => e.transform.x)).toEqual([MARGIN, MARGIN + COL_W + K_SPACE.columnGap, CENTER_X])
    expect(captions(three).map((e) => e.textProps?.content)).toEqual(['칸 설명 1', '칸 설명 2', '칸 설명 4'])
    expect(renderTemplate(grid(4), { headline: '제목', items: itemsOf(4) }, ctxWithout([key(1), key(2)]))).toBeNull()
    // 지금 길(뺀 컷 목록 없음)은 그대로 빈 칸으로 그린다
    expect(captions(renderTemplate(grid(4), { headline: '제목', items: itemsOf(4) }, ctxWithout([key(2)], false))!)).toHaveLength(4)
  })

  it('최소 3 목록 3 → 2는 그리고(두 칸 한 줄), 최소 2 목록 2 → 1은 섹션째 빠진다', () => {
    const two = renderTemplate(grid(3), { headline: '제목', items: itemsOf(3) }, ctxWithout([key(0)]))!
    expect(photos(two).map((e) => e.transform.x)).toEqual([MARGIN, MARGIN + COL_W + K_SPACE.columnGap])
    expect(renderTemplate(grid(2), { headline: '제목', items: itemsOf(2) }, ctxWithout([key(1)]))).toBeNull()
  })

  it('켠 잡도 이 섹션에서 뺀 컷이 없으면 그대로 — 목록 밖 컷만 뺐거나 빈 목록이면 배치가 같고, 원래 덜 찬 줄은 왼쪽 그대로다', () => {
    const values = { headline: '제목', items: itemsOf(3) }
    const base = renderTemplate(grid(2), values, ctxOf())!
    expect(layoutOf(renderTemplate(grid(2), values, ctxOf({ dropped: new Set(['k9_photo_0']) }))!)).toEqual(layoutOf(base))
    expect(layoutOf(renderTemplate(grid(2), values, ctxOf({ dropped: new Set() }))!)).toEqual(layoutOf(base))
    expect(photos(base).map((e) => e.transform.x)).toEqual([MARGIN, MARGIN + COL_W + K_SPACE.columnGap, MARGIN])
  })
})

/** 라이브러리 템플릿 + 목업 글, 목록 사진만 컷 키로 — 항목 n개 */
const libraryValues = (t: Template, list: string, n: number): SlotValues => {
  const values = mockSlots(t)
  const first = (values[list] as SlotItem[])[0]
  return { ...values, [list]: Array.from({ length: n }, (_, i) => ({ ...first, photo: key(i) })) }
}

describe('라이브러리 격자(J44)', () => {
  it('2×2 사진·이름표 격자(최소 2)에서 한 장을 빼면 3장·이름표 3묶음으로 그리고 뺀 주소가 없다', () => {
    const t = templateById('point_list_div.household-photo-grid-notes')!
    const values = libraryValues(t, 'items', 4)
    const full = renderTemplate(t, values, ctxWithout([]))!
    const out = renderTemplate(t, values, ctxWithout([key(1)]))!
    const labels = (o: Out) => o.elements.filter((e) => e.name.startsWith('annotation-label-'))
    expect(photos(full)).toHaveLength(4)
    expect(photos(out)).toHaveLength(3)
    expect(labels(out).length * 4).toBe(labels(full).length * 3)
    expect(photos(out).map((e) => e.framedImageProps?.src)).not.toContain(urlOf(key(1)))
  })

  it('최소 4장 격자에서 한 장을 빼면 남은 3장을 같은 템플릿으로 그리고, 두 장을 빼면 섹션째 빠진다(J48)', () => {
    const t = templateById('review.photo-grid')!
    const values = libraryValues(t, 'shots', 4)
    expect(renderTemplate(t, values, ctxWithout([]))).not.toBeNull()
    expect(photos(renderTemplate(t, values, ctxWithout([key(0)]))!)).toHaveLength(3)
    expect(renderTemplate(t, values, ctxWithout([key(0), key(1)]))).toBeNull()
  })

  it('칸 수가 뜻인 템플릿은 최소를 낮추지 않는다(decide 20) — 네 방향 4 → 3, 정면·옆·위 3 → 2는 지금처럼 섹션째 빠진다', () => {
    expect([...COUNT_FIXED_TEMPLATES].sort()).toEqual(['product_exposure.four-sides', 'product_exposure.three-views'])
    const four = templateById('product_exposure.four-sides')!
    const fourValues = libraryValues(four, 'shots', 4)
    expect(renderTemplate(four, fourValues, ctxWithout([]))).not.toBeNull()
    expect(renderTemplate(four, fourValues, ctxWithout([key(1)]))).toBeNull()
    const three = templateById('product_exposure.three-views')!
    const threeValues = libraryValues(three, 'views', 3)
    expect(renderTemplate(three, threeValues, ctxWithout([]))).not.toBeNull()
    expect(renderTemplate(three, threeValues, ctxWithout([key(0)]))).toBeNull()
    // 뺀 컷 목록이 없는 지금 길은 그대로 그린다(사진 틀만 빠짐)
    expect(renderTemplate(four, fourValues, ctxWithout([key(1)], false))).not.toBeNull()
  })

  it('최소 3장 격자(3열)에서 한 장을 빼면 남은 2장을 가운데로 그린다(J48)', () => {
    const t = templateById('sub_div.grid-detail')!
    const values = libraryValues(t, 'shots', 3)
    const out = renderTemplate(t, values, ctxWithout([key(1)]))!
    expect(photos(out)).toHaveLength(2)
    expect(renderTemplate(t, values, ctxWithout([key(0), key(1)]))).toBeNull()
  })
})

describe('빠진 섹션 기록·조립 연결(J44)', () => {
  const t = templateById('review.photo-grid')!
  const slots = libraryValues(t, 'shots', 4)
  const job = { section_plan: { designcut: { sections: [{ key: 'review:0', templateRef: { id: t.id, version: 1, slots } }] }, templatelib: { sections: [] } } } as unknown as Pick<
    PdpJobRow,
    'section_plan'
  >
  const shown = [0, 1, 3].map((i) => ({ section: key(i), url: urlOf(key(i)) }))

  it('쓰는 법 미달로 뺀 컷 때문에 낮춘 최소보다도 적어진 섹션만 빠진 섹션으로 센다 — 한 장 뺌(4 → 3)은 그려져 세지 않고, 뺀 표지 없는 실패 컷도 세지 않는다', () => {
    const droppedOf = (i: number) => ({ section: key(i), url: '', droppedForUse: { url: urlOf(key(i)), reason: '쓰는 법 미달: 시험' } })
    expect(lostSectionsOf(job, [...shown, droppedOf(2)])).toEqual([])
    expect(lostSectionsOf(job, [shown[0], shown[2], droppedOf(1), droppedOf(2)])).toEqual([{ key: 'review:0', templateId: t.id, cuts: [] }])
    expect(lostSectionsOf(job, [...shown, { section: key(2), url: '' }])).toEqual([])
  })

  it('조립: 편집기 응답 dropped_cuts가 있을 때만 K 목록 항목을 뺀다', () => {
    const grid4 = templateById('point_list_div.household-photo-grid-notes')!
    const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
    plan.layout = 2
    Object.assign(plan.sections.find((s) => s.key === 'point_div:0')!, { templateRef: { id: grid4.id, version: 1, slots: libraryValues(grid4, 'items', 4) } })
    const images = Object.fromEntries([0, 2, 3].map((i) => [key(i), urlOf(key(i))]))
    const kPhotos = (droppedCuts?: string[]) => {
      const out = composeDesignCut([], readDesignCut({ designcut: plan })!, { images, sectionOrder: [], ...(droppedCuts ? { droppedCuts } : {}) })
      const section = out.find((s) => s.layoutId === `designcut_k_${grid4.id}`)!
      return {
        photos: section.elements.filter((e) => e.name === 'designcut-scene').length,
        labels: section.elements.filter((e) => e.name.startsWith('annotation-label-')).length,
      }
    }
    const before = kPhotos()
    const after = kPhotos([key(1)])
    expect(before.photos).toBe(3)
    expect(after.photos).toBe(3)
    expect(after.labels * 4).toBe(before.labels * 3)
  })
})
