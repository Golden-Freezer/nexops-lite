/**
 * 입력 사진 칸(option.images·option.lineup) — 칸 값은 컷 키가 아니라 입력 사진 주소 그대로다(적용 K17, V2 K2 P01 입력 7장·화면 0장).
 * 표본 컨텍스트(sample·mock)는 어떤 값에도 사진을 돌려줘 이 결함을 못 잡으므로, 라이브러리 mock 없이 실제 템플릿을 실제 compose로 그린다. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import { composeDesignCut, resolveImage, resolveTemplateImage } from '@/lib/registration/editor/utils/sectionConverter/designCut/compose'
import { readDesignCut } from '@/lib/registration/editor/utils/sectionConverter/designCut/contract'
import { designCutPlanForB } from '@/lib/registration/editor/utils/sectionConverter/designCut/designCut.fixture'
import { fillInputSlots } from './input-values'
import { TEMPLATES, templateById } from './library'
import { sampleSlots } from './sample'
import { INPUT_PHOTO_LISTS, type ListSlot, type SlotItem, type SlotValues, type Template } from './template-types'

const CUTS = { hero: 'https://img.test/hero.png', features: ['https://img.test/f0.png', 'https://img.test/f1.png'], failed: 'https://placehold.co/600x400?text=Generation+Failed' }
const PHOTOS = Array.from({ length: 9 }, (_, i) => `https://img.test/option-${i}.jpg`)
const FAILED = ['https://placehold.co/600x400.png', 'https://img.test/x?text=Generation+Failed', 'https://img.test/placeholder.png']

type Plan = ReturnType<typeof designCutPlanForB> & Record<string, unknown>
const composeWith = (ref: { id: string; slots: SlotValues } | null, target?: (section: Record<string, unknown>) => void) => {
  const plan = designCutPlanForB() as Plan
  plan.layout = 2
  const section = plan.sections.find((s) => s.key === 'point_div:0')! as unknown as Record<string, unknown>
  if (ref) section.templateRef = { id: ref.id, version: 1, slots: ref.slots }
  target?.(section)
  return composeDesignCut([], readDesignCut({ designcut: plan })!, { images: CUTS, sectionOrder: [] })
}
const sectionOf = (t: Template, slots: SlotValues) => composeWith({ id: t.id, slots }).find((s) => s.layoutId === `designcut_k_${t.id}`)
const photosIn = (section: ReturnType<typeof sectionOf>) => (section?.elements ?? []).flatMap((e) => (e.framedImageProps ? [e.framedImageProps.src] : []))

/** 표본 값의 사진을 등록된 컷 키로 바꾼다 — 칸 말고 다른 사진 때문에 섹션이 빠지지 않게 */
function withCutKeys(t: Template, values: SlotValues): SlotValues {
  const keyed = (item: SlotItem, def: ListSlot): SlotItem =>
    Object.fromEntries(Object.entries(item).map(([name, value]) => [name, def.fields[name]?.type === 'image' ? 'hero' : value]))
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => {
      const def = t.slots[name]
      if (def?.type === 'image') return [name, 'hero']
      if (def?.type === 'list' && Array.isArray(value)) return [name, (value as SlotItem[]).map((item) => (typeof item === 'string' ? item : keyed(item, def)))]
      return [name, value]
    })
  ) as SlotValues
}

/** 입력 옵션 n개로 칸을 채운 실제 값 — 저장 계획의 slots와 같은 꼴이다 */
function slotsWith(t: Template, count: number): SlotValues {
  const options = PHOTOS.slice(0, count).map((image, i) => ({ label: `옵션${i + 1}`, image }))
  // 시험 사진 칸(J57 demo.photos)은 판매자 시험 사진 입력을 같은 주소로 받는다 — 옵션 칸에는 쓰이지 않는다
  return { ...withCutKeys(t, sampleSlots(t, { mode: 'full' })), ...fillInputSlots(t, { spec: {} as never, cards: [], options, demoPhotos: PHOTOS.slice(0, count) }) }
}

const INPUT_PHOTO_SLOTS = TEMPLATES.flatMap((t) =>
  Object.entries(t.slots).flatMap(([name, def]) => (def.type === 'list' && INPUT_PHOTO_LISTS.includes(def.input ?? '') ? [{ t, name, def }] : []))
)
const photoFieldOf = (def: ListSlot) => Object.entries(def.fields).find(([, field]) => field.type === 'image')![0]

describe('resolveTemplateImage', () => {
  it('입력 사진 주소는 그대로(앞뒤 공백만 뗀다)', () => {
    expect(resolveTemplateImage(CUTS, PHOTOS[0])).toBe(PHOTOS[0])
    expect(resolveTemplateImage(CUTS, `  ${PHOTOS[1]} `)).toBe(PHOTOS[1])
  })

  it('컷 키는 지금처럼 section_images에서 찾는다', () => {
    expect(resolveTemplateImage(CUTS, 'hero')).toBe(CUTS.hero)
    expect(resolveTemplateImage(CUTS, 'features:1')).toBe(CUTS.features[1])
  })

  it('자리표시·생성 실패 주소와 없는 키는 사진을 만들지 않는다', () => {
    for (const url of FAILED) expect(resolveTemplateImage(CUTS, url), url).toBeNull()
    expect(resolveTemplateImage(CUTS, 'failed')).toBeNull()
    expect(resolveTemplateImage(CUTS, 'no_such_key')).toBeNull()
    expect(resolveTemplateImage(CUTS, 'data:image/png;base64,AAAA')).toBeNull()
    expect(resolveTemplateImage(CUTS, null)).toBeNull()
  })

  it('D 라인이 쓰는 resolveImage는 키만 읽는다', () => {
    expect(resolveImage(CUTS, PHOTOS[0])).toBeNull()
    expect(resolveImage(CUTS, 'hero')).toBe(CUTS.hero)
  })
})

describe('입력 사진 칸 전수 — 실제 compose', () => {
  it('칸 목록을 라이브러리에서 찾았다', () => {
    expect(INPUT_PHOTO_SLOTS.length).toBeGreaterThanOrEqual(20)
    expect(new Set(INPUT_PHOTO_SLOTS.map((s) => s.def.input))).toEqual(new Set(INPUT_PHOTO_LISTS))
  })

  for (const { t, def } of INPUT_PHOTO_SLOTS) {
    const counts = [...new Set([def.min, def.max, def.input === 'option.images' ? (def.inputMax ?? def.max) : def.max])]
    it(`${t.id} — 입력 사진 ${counts.join('·')}장을 모두 그린다`, () => {
      for (const count of counts) {
        const section = sectionOf(t, slotsWith(t, count))
        expect(section, `${t.id} ${count}장`).toBeDefined()
        const drawn = photosIn(section).filter((src) => PHOTOS.includes(src))
        expect(drawn, `${t.id} ${count}장`).toEqual(PHOTOS.slice(0, count))
      }
    })
  }

  it('실패 주소가 섞인 저장 값 — 실물만 그리고 섹션은 남는다', () => {
    const { t, name, def } = INPUT_PHOTO_SLOTS.find((s) => s.t.id === 'option_gallery.grid-three')!
    const photo = photoFieldOf(def)
    const swatches = [PHOTOS[0], FAILED[0], PHOTOS[1], FAILED[1]].map((value) => ({ [photo]: value }))
    const section = sectionOf(t, { ...slotsWith(t, def.min), [name]: swatches })
    expect(section).toBeDefined()
    expect(photosIn(section)).toEqual([PHOTOS[0], PHOTOS[1]])
  })
})

describe('기존 동작', () => {
  it('목록 칸 값이 컷 키여도 지금처럼 컷을 그린다', () => {
    const t = templateById('option_gallery.grid-three')!
    const def = t.slots.swatches as ListSlot
    const photo = photoFieldOf(def)
    const section = sectionOf(t, { ...slotsWith(t, def.min), swatches: ['hero', 'features:0', 'features:1'].map((key) => ({ [photo]: key })) })
    expect(photosIn(section)).toEqual([CUTS.hero, CUTS.features[0], CUTS.features[1]])
  })

  it('컷 칸에 주소가 와도 필수 사진 검사를 지나 그대로 그린다 — 키 먼저, 없으면 주소', () => {
    const t = TEMPLATES.find((candidate) => Object.values(candidate.slots).some((def) => def.type === 'image' && def.required))!
    const [name] = Object.entries(t.slots).find(([, def]) => def.type === 'image' && def.required)!
    const slots = withCutKeys(t, sampleSlots(t, { mode: 'full' }))
    expect(photosIn(sectionOf(t, { ...slots, [name]: PHOTOS[0] }))).toContain(PHOTOS[0])
    expect(sectionOf(t, { ...slots, [name]: FAILED[0] })).toBeUndefined()
  })

  it('D 라인 — 템플릿 기록이 없는 섹션은 주소 값을 사진으로 쓰지 않는다', () => {
    const srcs = (out: ReturnType<typeof composeWith>) => out.flatMap((s) => s.elements.flatMap((e) => (e.framedImageProps ? [e.framedImageProps.src] : e.imageProps ? [e.imageProps.src] : [])))
    const keyed = srcs(composeWith(null, (section) => { section.productImageKey = 'hero' }))
    expect(keyed).toContain(CUTS.hero)
    expect(srcs(composeWith(null, (section) => { section.productImageKey = PHOTOS[0] }))).not.toContain(PHOTOS[0])
  })
})
