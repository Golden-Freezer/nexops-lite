/**
 * 강조 구절 모델 지정(적용 T1-17)의 저장·조립 — 계획의 templateRef.accent(K)·text.accent(D)를 계약이 다시 검사하고, 조립이 그 구절을 칠한다.
 * 칸이 없는 옛 계획은 지금 규칙(수량 → POINT 낱말) 그대로다. LLM·DB 없음
 */

import { describe, expect, it, vi } from 'vitest'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { composeDesignCut } from '@/lib/registration/editor/utils/sectionConverter/designCut/compose'
import { readDesignCut } from '@/lib/registration/editor/utils/sectionConverter/designCut/contract'
import { designCutPlanForB } from '@/lib/registration/editor/utils/sectionConverter/designCut/designCut.fixture'

vi.mock('@/lib/registration/templatelib/library', async () => {
  const { templateOf, textSlot } = await import('./engine.fixture')
  const k = templateOf({
    id: 'point_div.accent',
    section: 'point_div',
    surfaces: ['W'],
    flow: [
      { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'titleGap', emphasis: true },
      { kind: 'text', slot: 'note', token: 'BODY' },
    ],
    slots: { headline: textSlot({ required: true }), note: textSlot({ required: true }) },
  })
  const all = [k]
  return { TEMPLATES: all, templateById: (id: string) => all.find((t) => t.id === id), templatesOf: () => all }
})

const IMAGES = { hero: 'https://img.test/hero.png', features: Array.from({ length: 6 }, (_, i) => `https://img.test/f${i}.png`) }
type Plan = ReturnType<typeof designCutPlanForB> & Record<string, unknown>
const SLOTS = { headline: '20개 서랍에 쏙 들어가요', note: '설명 한 줄' }

const planWith = (ref?: Record<string, unknown>, dAccents: Record<string, unknown> = {}) => {
  const plan = designCutPlanForB() as Plan
  plan.layout = 2
  if (ref) Object.assign(plan.sections.find((s) => s.key === 'point_div:0')!, { templateRef: { id: 'point_div.accent', version: 1, slots: SLOTS, ...ref } })
  for (const s of plan.sections) {
    const text = s.text as { headline: string | null; accent?: unknown }
    if (text.headline && text.headline in dAccents) text.accent = dAccents[text.headline]
  }
  return plan
}
const compose = (plan: Plan) => composeDesignCut([], readDesignCut({ designcut: plan })!, { images: IMAGES, sectionOrder: [] })
const spanOf = (rich: string | null | undefined) => rich?.match(/<span style="[^"]+">([^<]*)<\/span>/)?.[1]?.replace(/ /g, ' ') ?? null
const kHead = (out: CanvasSection[]) => {
  const section = out.find((s) => s.layoutId.startsWith('designcut_k_'))!
  return spanOf(section.elements.find((e) => e.name === 'designcut-headline')!.textProps!.richContent)
}
const dHead = (out: CanvasSection[], headline: string) =>
  spanOf(out.flatMap((s) => s.elements).find((e) => e.name === 'designcut-headline' && e.textProps!.content === headline)?.textProps!.richContent)

describe('K — templateRef.accent', () => {
  it('구절이 있으면 그 구절, 없으면 지금 규칙(수량)', () => {
    expect(kHead(compose(planWith({ accent: '쏙 들어가요' })))).toBe('쏙 들어가요')
    expect(kHead(compose(planWith({})))).toBe('20개')
  })

  it('계약이 저장 값을 다시 검사한다 — 칸 글에 없거나 8자를 넘거나 글 전체면 칸을 두지 않는다', () => {
    for (const accent of ['없는 말', '서랍에 쏙 들어가요 정말', '20개 서랍에 쏙 들어가요', 7]) {
      const plan = planWith({ accent })
      const ref = readDesignCut({ designcut: plan })!.sections.find((s) => s.templateRef)!.templateRef!
      expect(ref.accent).toBeUndefined()
      expect(kHead(compose(plan))).toBe('20개')
    }
  })

  it('POINT 제목이 비어 USP 낱말이 없는 계획(K 계획 모양)에서도 구절만 있으면 칠하고, 없으면 지금처럼 칠하지 않는다', () => {
    const noUsp = (ref: Record<string, unknown>) => {
      const plan = planWith(ref)
      for (const s of plan.sections) Object.assign(s, { chapter: null })
      return plan
    }
    expect(kHead(compose(noUsp({ accent: '쏙 들어가요' })))).toBe('쏙 들어가요')
    expect(kHead(compose(noUsp({})))).toBeNull()
  })

  it('옛 계획(칸 없음)은 읽은 기록에 칸이 없고 그리기가 그대로다', () => {
    const ref = readDesignCut({ designcut: planWith({}) })!.sections.find((s) => s.templateRef)!.templateRef!
    expect(Object.keys(ref).sort()).toEqual(['id', 'slots', 'version'])
  })
})

describe('D — section.text.accent', () => {
  it('제목에 든 구절이면 그 구절을 칠하고, 다른 제목은 지금 규칙이다', () => {
    const out = compose(planWith(undefined, { '50매 대용량': '대용량' }))
    expect(dHead(out, '50매 대용량')).toBe('대용량')
    const before = compose(planWith())
    expect(dHead(before, '50매 대용량')).toBe('50매')
    const others = (o: CanvasSection[]) =>
      o.flatMap((s) => s.elements).filter((e) => e.name === 'designcut-headline' && e.textProps!.content !== '50매 대용량').map((e) => e.textProps!.richContent ?? null)
    expect(others(out)).toEqual(others(before))
  })

  it('계약이 저장 값을 다시 검사한다 — 제목에 없거나 8자를 넘거나 제목 전체면 지금 규칙', () => {
    for (const accent of ['선물', '50매 대용량', '대용량 구성 넉넉하게 담아요', ['대용량']]) {
      const plan = planWith(undefined, { '50매 대용량': accent })
      const text = readDesignCut({ designcut: plan })!.sections.find((s) => s.text.headline === '50매 대용량')!.text
      expect(text.accent).toBeUndefined()
      expect(dHead(compose(plan), '50매 대용량')).toBe('50매')
    }
  })

  it('옛 계획(칸 없음)은 섹션 글에 accent 칸이 없다', () => {
    const plan = readDesignCut({ designcut: planWith() })!
    expect(plan.sections.some((s) => 'accent' in s.text)).toBe(false)
  })
})
