/**
 * 컨셉 모서리(적용 T1-28) — 원문(연구 A3 #9) 값 그대로인지, 계획·계약·조립이 K 섹션에만 쓰는지 본다. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import { composeDesignCut } from '@/lib/registration/editor/utils/sectionConverter/designCut/compose'
import { readDesignCut } from '@/lib/registration/editor/utils/sectionConverter/designCut/contract'
import { designCutPlanForB } from '@/lib/registration/editor/utils/sectionConverter/designCut/designCut.fixture'
import type { DesigncutPlan } from '../pdp-state'
import { colorSetsOf } from './color-sets'
import { CONCEPT_RADIUS, shapeRadius } from './concept-radius'
import { CONCEPTS } from './concepts'
import { templateById, TEMPLATES } from './library'
import { buildTemplatelibPlan } from './plan'
import type { OrderedSection } from './selection-order'
import { copySlotsOf, type CopyValues } from './slot-copy'
import type { TemplateMeta } from './template-meta'

/** 원문 값은 시험에 고정한다 — 코드 표를 가져오면 변이를 못 잡는다 */
const SOURCE = {
  square: { card: 8, photo: 0 },
  soft: { card: 24, photo: 12, capsule: 32 },
  round: { card: 36, photo: 24, capsule: 999 },
  mix: { card: 24, photo: 12, capsule: 32 },
}

describe('컨셉 모서리 표', () => {
  it('원문 값 그대로다 — mix는 soft, square 캡슐은 원문 무값이라 칸이 없다', () => {
    for (const [shape, want] of Object.entries(SOURCE)) expect(shapeRadius(shape as keyof typeof SOURCE)).toEqual(want)
    expect('capsule' in shapeRadius('square')).toBe(false)
  })

  it('말풍선·칩은 원문 무값이라 어느 모서리에도 없다', () => {
    for (const radius of Object.values(CONCEPT_RADIUS)) {
      expect(radius).not.toHaveProperty('bubble')
      expect(radius).not.toHaveProperty('chip')
    }
  })

  it('44컨셉 모두 모서리 값이 있고, square만 카드 8 이하(엔진 isSharp — 사진 직각)다', () => {
    expect(CONCEPTS.length).toBeGreaterThanOrEqual(44)
    for (const concept of CONCEPTS) {
      const radius = shapeRadius(concept.shape)
      expect(radius.card <= 8).toBe(concept.shape === 'square')
    }
  })

  it('돌려준 값을 고쳐도 표는 그대로다', () => {
    const copy = shapeRadius('round')
    copy.card = 1
    expect(shapeRadius('round').card).toBe(36)
  })
})

const base = () => designCutPlanForB() as unknown as DesigncutPlan
const palette = colorSetsOf(CONCEPTS[0]).sets[0]
const inputs = { spec: { productName: '시험 상품' }, cards: [], options: [] } as never
/** 사진·입력값·목록 칸 없이 시험 카피만으로 그려지는 convert_div 템플릿 하나 */
const convertId = (TEMPLATES as unknown as TemplateMeta[]).find(
  (t) => t.section === 'convert_div' && Object.values(t.slots).every((slot) => slot.type === 'text' && slot.source === 'copy')
)!.id
const copyOf = (id: string): CopyValues =>
  Object.fromEntries(copySlotsOf(templateById(id) as unknown as TemplateMeta).map((slot) => [slot.name, '시험 문구']))
const rowOf = (id: string): OrderedSection => {
  const template = templateById(id)!
  return { section: template.section, templateId: id, bg: template.surfaces[0], shots: [] }
}

describe('계획·계약·조립', () => {
  const planOf = (shape?: 'round' | 'soft' | 'square' | 'mix') =>
    buildTemplatelibPlan(base(), { sections: [rowOf(convertId)], palette, fontPair: CONCEPTS[0].fontPair, copy: new Map([[0, copyOf(convertId)]]), inputs, ...(shape ? { shape } : {}) })

  it('shape가 있으면 templateRadius를 기록하고, 없으면 칸이 없다', () => {
    expect(planOf('round').templateRadius).toEqual(SOURCE.round)
    expect(planOf('mix').templateRadius).toEqual(SOURCE.soft)
    expect(planOf()).not.toHaveProperty('templateRadius')
  })

  it('계약은 0 이상 유한 숫자만 받고, 하나라도 틀리면 칸을 두지 않는다', () => {
    const read = (templateRadius: unknown) => readDesignCut({ designcut: { ...base(), templateRadius } })!.templateRadius
    expect(read(SOURCE.round)).toEqual(SOURCE.round)
    expect(read(SOURCE.square)).toEqual(SOURCE.square)
    expect(read(undefined)).toBeUndefined()
    for (const bad of [null, 'round', { card: 8 }, { card: -1, photo: 0 }, { card: 8, photo: '0' }, { card: 8, photo: Number.NaN }, { card: 8, photo: 0, capsule: 'x' }, { card: Infinity, photo: 0 }])
      expect(read(bad)).toBeUndefined()
    expect(read({ card: 8, photo: 0, bubble: 3 })).toEqual({ card: 8, photo: 0 })
  })

  it('templateRadius는 K 섹션만 바꾸고 D 섹션 요소는 바이트까지 같다', () => {
    const compose = (plan: DesigncutPlan) => composeDesignCut([], readDesignCut({ designcut: plan })!, { images: {}, sectionOrder: [], stats: undefined })
    const mixed = (radius?: DesigncutPlan['templateRadius']) => {
      const plan = base()
      const k = planOf()
      // D 계획 섹션 앞에 K 섹션 하나를 붙인다 — 나머지는 D 빌더가 그린다
      return { ...plan, sections: [...k.sections, ...plan.sections], order: [...k.order, ...plan.order], layout: 2 as const, templateColors: k.templateColors, ...(radius ? { templateRadius: radius } : {}) }
    }
    const before = compose(mixed())
    const after = compose(mixed(SOURCE.round))
    // 요소·묶음·그라데이션 id(uid: 접두_순번_시각)는 그릴 때마다 달라 지운다 — 나머지는 글자 하나까지 같아야 한다
    const dOf = (list: typeof before) => JSON.stringify(list.filter((s) => !s.layoutId.startsWith('designcut_k_'))).replace(/[a-z]+_\d+_\d{13}/g, 'uid')
    expect(after.length).toBe(before.length)
    expect(dOf(after)).toBe(dOf(before))
    expect(after.some((s) => s.layoutId.startsWith('designcut_k_'))).toBe(true)
  })
})
