/**
 * 사이즈 단독 컷(sizecut) 조립 — T6 치수선이 사진 틀이 아니라 제품 경계에 그어지고, 경계를 못 쟀거나 비율이 입력과 다르면 글자만 남는지 본다.
 * size_single 키를 쓰지 않는 계획은 지금과 같다(사진 틀).
 */

import { describe, expect, it } from 'vitest'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import type { PdpJobRow, ProductBox } from '@/lib/registration/pdp-state'
import { designCutJobB, designCutPlanForB } from './designCut.fixture'
import { SIZE_SINGLE_SECTION } from './sizeLines'

const SIZE_URL = 'https://cdn.test/size_single.png'
const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight from the left window', season: 'spring', props: ['linen cloth'] },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
  corners: 'soft',
}
/** 3:4 사진 안 제품 — 틀 450×600에서 270×270, 5×5cm 입력과 비율이 같다 */
const SQUARE_BOX: ProductBox = { left: 0.2, top: 0.3, width: 0.6, height: 0.45, aspect: 0.75 }
const P04_DIMS = [
  { axis: 'w', value: 57, unit: 'mm' },
  { axis: 'h', value: 168, unit: 'mm' },
]

type Dim = { axis: string; value: number; unit: string }
const planOf = (opts: { key?: string; dims?: Dim[] } = {}) => {
  const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & { layout?: 2; artDirection?: typeof ART }
  plan.layout = 2
  plan.artDirection = ART
  const t6 = plan.sections.find((s) => s.template === 'T6') as unknown as {
    productImageKey: string | null
    modules: Array<{ type: string; data: { dims: Dim[] } }>
  }
  if (opts.key) t6.productImageKey = opts.key
  if (opts.dims) t6.modules[0].data.dims = opts.dims
  return plan
}
const docOf = async (plan: unknown, entry?: { productBox?: ProductBox }) => {
  const job = designCutJobB({ plan }) as PdpJobRow
  if (entry) job.section_images = [...job.section_images, { section: SIZE_SINGLE_SECTION, url: SIZE_URL, prompt: 'P', ...entry }]
  const doc = await buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
  return { doc, t6: doc.sections.find((s) => s.layoutId === 'designcut_T6') as CanvasSection, job }
}
const named = (sec: CanvasSection, name: string) => sec.elements.filter((e) => e.name === name)
const productOf = (sec: CanvasSection) => JSON.stringify(named(sec, 'designcut-product')[0])
const captionOf = (sec: CanvasSection) => named(sec, 'designcut-dim-caption')[0].textProps!.content
/** T6 섹션의 모바일 위반만 — 이 시험의 대상 밖 섹션은 다른 시험이 본다 */
const violationsOf = (doc: Parameters<typeof checkMobileReadability>[0]) => checkMobileReadability(doc).violations.filter((v) => v.section === 'spec_table')

describe('T6 — 사이즈 단독 컷', () => {
  it('제품 경계에 선을 긋는다 — 사진 틀(160, 450×600)이 아니라 제품 자리에', async () => {
    const { doc, t6 } = await docOf(planOf({ key: SIZE_SINGLE_SECTION }), { productBox: SQUARE_BOX })
    const productEl = named(t6, 'designcut-product')[0]
    const product = productEl.transform
    // 자르지 않는다 — 사진 전체가 틀 450×600에 들어간다(R15 P11: 자르면 제품이 함께 잘렸다)
    expect(product).toMatchObject({ x: 160, width: 450, height: 600 })
    expect(productEl.framedImageProps?.cropRect).toBeUndefined()
    expect(productEl.framedImageProps?.objectFit).toBe('contain')
    expect(productOf(t6)).toContain(SIZE_URL)
    const w = named(t6, 'designcut-dim-w')[0].transform
    const h = named(t6, 'designcut-dim-h')[0].transform
    // 제품 경계 270×270 — 사진 안 왼쪽 20%·위 30%
    expect(w).toMatchObject({ x: 160 + 90, width: 270 })
    expect(h).toMatchObject({ x: 160 + 90 + 270 + 44 - 20, height: 270 })
    expect(Math.abs(h.y - (product.y + 180))).toBeLessThanOrEqual(1)
    expect(Math.abs(w.y - (h.y + 270 + 44 - 20))).toBeLessThanOrEqual(1)
    // 축 이름이 사진 위에 오지만 띠가 깔려 모바일 M2(사진 위 글자)에 걸리지 않는다
    expect(named(t6, 'designcut-dim-w-label-band')).toHaveLength(1)
    expect(captionOf(t6)).toContain('5')
    expect(violationsOf(doc)).toEqual([])
  })

  it('제품 비율이 입력과 20% 넘게 다르면 선 없이 글자만', async () => {
    const { doc, t6 } = await docOf(planOf({ key: SIZE_SINGLE_SECTION, dims: P04_DIMS }), { productBox: SQUARE_BOX })
    expect(named(t6, 'designcut-dim-w')).toEqual([])
    expect(named(t6, 'designcut-dim-h')).toEqual([])
    expect(named(t6, 'designcut-dim-w-label')).toEqual([])
    expect(captionOf(t6)).toContain('57mm')
    expect(captionOf(t6)).toContain('168mm')
    expect(named(t6, 'designcut-product')[0].framedImageProps?.cropRect).toBeUndefined()
    expect(named(t6, 'designcut-product')[0].framedImageProps?.objectFit).toBe('contain')
    expect(named(t6, 'designcut-product')[0].transform).toMatchObject({ x: 160, width: 450, height: 600 })
    expect(violationsOf(doc)).toEqual([])
  })

  it('경계를 못 쟀으면 사진은 쓰고 선 없이 글자만', async () => {
    const { t6 } = await docOf(planOf({ key: SIZE_SINGLE_SECTION }), {})
    expect(productOf(t6)).toContain(SIZE_URL)
    expect(named(t6, 'designcut-dim-w')).toEqual([])
    expect(named(t6, 'designcut-dim-h')).toEqual([])
    expect(captionOf(t6)).toContain('5')
  })

  it('사이즈 컷이 없으면(실패) T6을 지우지 않고 대표 컷에 글자만 — 대표 컷을 잰 값이 없어 선을 긋지 않는다', async () => {
    const { t6, job } = await docOf(planOf({ key: SIZE_SINGLE_SECTION }))
    const hero = job.section_images.find((e) => e.section === 'hero')!.url
    expect(t6).toBeDefined()
    expect(productOf(t6)).toContain(hero)
    expect(named(t6, 'designcut-dim-w')).toEqual([])
    expect(captionOf(t6)).toContain('5')
  })

  it('좁은 제품도 축 이름 칸은 한 줄 폭을 지키고 선 가운데에 놓인다', async () => {
    // 펜처럼 가는 제품 — 입력 10×130(0.077), 사진 비율 0.075
    const narrow: ProductBox = { left: 0.47, top: 0.2, width: 0.06, height: 0.6, aspect: 0.75 }
    const dims = [
      { axis: 'w', value: 10, unit: 'mm' },
      { axis: 'h', value: 130, unit: 'mm' },
    ]
    const { doc, t6 } = await docOf(planOf({ key: SIZE_SINGLE_SECTION, dims }), { productBox: narrow })
    const line = named(t6, 'designcut-dim-w')[0].transform
    expect(line.width).toBeLessThan(96)
    const label = named(t6, 'designcut-dim-w-label')[0].transform
    expect(label.width).toBe(96)
    expect(Math.abs(label.x + label.width / 2 - (line.x + line.width / 2))).toBeLessThanOrEqual(1)
    expect(violationsOf(doc)).toEqual([])
  })

  it('무대는 그 사진에서 잰 바탕색으로 칠한다 — 값이 없으면(옛 잡) 계획 색', async () => {
    const measured = await docOf(planOf({ key: SIZE_SINGLE_SECTION }), { productBox: { ...SQUARE_BOX, background: '#8d7d69' } })
    const stage = named(measured.t6, 'designcut-stage')[0]
    expect(stage.shapeProps?.fill).toBe('#8d7d69')
    expect(named(measured.t6, 'designcut-dim-w-label-band')[0].shapeProps?.fill).toBe('#8d7d69')
    const old = await docOf(planOf({ key: SIZE_SINGLE_SECTION }), { productBox: SQUARE_BOX })
    expect(named(old.t6, 'designcut-stage')[0]?.shapeProps?.fill ?? '').not.toBe('#8d7d69')
  })

  it('경계를 믿기 어려우면 선 없이 글자만 — 무대색은 그대로 쓴다(R15 P11 흰 스티커)', async () => {
    const { t6 } = await docOf(planOf({ key: SIZE_SINGLE_SECTION }), { productBox: { ...SQUARE_BOX, background: '#f1f0f2', uncertain: true } })
    expect(named(t6, 'designcut-dim-w')).toEqual([])
    expect(named(t6, 'designcut-dim-h')).toEqual([])
    expect(named(t6, 'designcut-stage')[0].shapeProps?.fill).toBe('#f1f0f2')
    expect(captionOf(t6)).toContain('5')
  })

  it('방향을 모르는 치수는 입력 글 그대로, 선 없음(R15 P09 고리·펼침)', async () => {
    const plan = planOf({ key: SIZE_SINGLE_SECTION, dims: [] }) as unknown as { sections: Array<{ template: string; modules: Array<{ data: { raw?: string } }> }> }
    plan.sections.find((s) => s.template === 'T6')!.modules[0].data.raw = '고리 21.4cm, 펼침 37.3cm'
    const { doc, t6 } = await docOf(plan, { productBox: SQUARE_BOX })
    expect(captionOf(t6)).toBe('고리 21.4cm, 펼침 37.3cm')
    expect(named(t6, 'designcut-dim-w')).toEqual([])
    expect(named(t6, 'designcut-dim-h')).toEqual([])
    expect(violationsOf(doc)).toEqual([])
  })

  it('size_single을 쓰지 않는 계획은 지금처럼 사진 틀에 선을 긋는다 — 경계 기록이 있어도 쓰지 않는다', async () => {
    const { t6 } = await docOf(planOf(), { productBox: SQUARE_BOX })
    expect(named(t6, 'designcut-dim-w')[0].transform).toMatchObject({ x: 160, width: 450 })
    expect(named(t6, 'designcut-dim-h')[0].transform).toMatchObject({ height: 600 })
  })
})

describe('편집기 응답 product_boxes', () => {
  it('경계가 있는 컷만 이미지 URL 키로 싣고, 없으면 칸이 없다', () => {
    const job = designCutJobB({ plan: planOf({ key: SIZE_SINGLE_SECTION }) }) as PdpJobRow
    expect(assembleEditorDataResponse(job, null).product_boxes).toBeUndefined()
    job.section_images = [...job.section_images, { section: SIZE_SINGLE_SECTION, url: SIZE_URL, prompt: 'P', productBox: SQUARE_BOX }]
    expect(assembleEditorDataResponse(job, null).product_boxes).toEqual({ [SIZE_URL]: SQUARE_BOX })
  })
})
