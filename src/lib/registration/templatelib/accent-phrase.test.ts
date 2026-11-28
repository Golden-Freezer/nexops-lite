/**
 * 강조 구절 모델 지정(적용 T1-17 K) — 슬롯 카피의 _accent → 최종 글 검사 → TemplateRef.accent → 엔진이 그 구절을 칠한다.
 * 칸이 없거나(옛 잡) 구절이 글에 없으면 지금 규칙(수량 → USP 낱말)이다. 공급자 콜은 없다.
 */

import { describe, expect, it } from 'vitest'
import { renderTemplate } from './engine'
import { ctxOf, templateOf, textSlot } from './engine.fixture'
import { TEMPLATES } from './library'
import { slotLinesOf } from './slot-lines'
import { copySlotsOf, sectionAccent, type CopySlot } from './slot-copy'
import type { FlowNode, Template } from './template-types'

const head = (emphasis = true): Template =>
  templateOf({
    flow: [
      { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'titleGap', ...(emphasis ? { emphasis: true } : {}) },
      { kind: 'text', slot: 'sub', token: 'BODY' },
    ],
    slots: { headline: textSlot({ required: true }), sub: textSlot() },
  })
const headlineRich = (t: Template, headline: string, over: Parameters<typeof ctxOf>[0] = {}) => {
  const out = renderTemplate(t, { headline, sub: '보조 글' }, ctxOf({ usp: ['보관'], ...over }))!
  return out.elements.find((e) => e.name === 'designcut-headline')!.textProps!.richContent ?? null
}
const spanOf = (rich: string | null) => rich?.match(/<span style="[^"]+">([^<]*)<\/span>/)?.[1] ?? null

describe('엔진 — 모델이 고른 구절(accentPhrase)', () => {
  it('구절이 글에 있으면 그 구절을 칠한다(규칙이면 수량 20개)', () => {
    expect(spanOf(headlineRich(head(), '20개 한 번에 보관 끝'))).toBe('20개')
    expect(spanOf(headlineRich(head(), '20개 한 번에 보관 끝', { accentPhrase: '보관 끝' }))).toBe('보관 끝')
  })

  it('구절이 글에 없으면 지금 규칙으로 돌아간다', () => {
    expect(spanOf(headlineRich(head(), '20개 한 번에 보관 끝', { accentPhrase: '없는 말' }))).toBe('20개')
  })

  it('치수 묶기로 줄바꿈 없는 공백이 든 글에서도 찾는다', () => {
    const rich = headlineRich(head(), '가로 30cm 넉넉한 칸', { accentPhrase: '가로 30cm' })
    expect(spanOf(rich)?.replace(/ /g, ' ')).toBe('가로 30cm')
  })

  it('강조 칸이 아닌 템플릿은 구절이 있어도 칠하지 않는다', () => {
    expect(headlineRich(head(false), '20개 한 번에 보관 끝', { accentPhrase: '보관 끝' })).toBeNull()
  })

  it('USP 낱말이 없어도(K 계획) 모델 구절이 있으면 그 구절만 칠한다', () => {
    expect(spanOf(headlineRich(head(), '20개 한 번에 보관 끝', { usp: [], accentPhrase: '보관 끝' }))).toBe('보관 끝')
    expect(spanOf(headlineRich(head(), '20개 한 번에 보관 끝', { usp: undefined, accentPhrase: '보관 끝' }))).toBe('보관 끝')
  })

  it('USP 낱말도 모델 구절도 없으면 지금처럼 칠하지 않는다(옛 K 잡 렌더 그대로)', () => {
    expect(headlineRich(head(), '20개 한 번에 보관 끝', { usp: [] })).toBeNull()
    expect(headlineRich(head(), '20개 한 번에 보관 끝', { usp: undefined })).toBeNull()
  })
})

describe('슬롯 카피 — 강조 칸과 구절 검사', () => {
  it('흐름의 emphasis 칸만 강조 칸이다', () => {
    const slots = copySlotsOf(head())
    expect(slots.find((s) => s.name === 'headline')?.accent).toBe(true)
    expect(slots.find((s) => s.name === 'sub')?.accent).toBeUndefined()
    expect(copySlotsOf(head(false)).some((s) => s.accent)).toBe(false)
  })

  it('라이브러리 강조 칸은 모두 맨 위 글 칸 하나이고 강조 칸이 된다', () => {
    let marked = 0
    for (const t of TEMPLATES) {
      const lines = slotLinesOf(t.flow as readonly FlowNode[])
      const emphasized = [...lines].filter(([, line]) => line.emphasis).map(([name]) => name)
      expect(emphasized.length).toBeLessThanOrEqual(1)
      expect(emphasized.every((name) => !name.includes('.'))).toBe(true)
      const accents = copySlotsOf(t).filter((s) => s.accent)
      expect(accents.map((s) => s.name)).toEqual(emphasized)
      marked += accents.length
    }
    expect(marked).toBeGreaterThan(100)
  })

  it('최종 글로 구절을 검사한다 — 부분 문자열·공백 뺀 2~8자·글 전체 아님', () => {
    const slots: CopySlot[] = copySlotsOf(head())
    const values = { headline: '20개 한 번에 보관 끝', sub: '보조' }
    expect(sectionAccent(slots, values, '보관 끝')).toBe('보관 끝')
    expect(sectionAccent(slots, values, ' 보관 끝 ')).toBe('보관 끝')
    expect(sectionAccent(slots, values, '보조')).toBeNull()
    expect(sectionAccent(slots, values, '보관끝')).toBeNull()
    expect(sectionAccent(slots, values, '끝')).toBeNull()
    expect(sectionAccent(slots, values, '20개 한 번에 보관')).toBe('20개 한 번에 보관')
    expect(sectionAccent(slots, { headline: '20개 한 번에 넉넉하게 보관해요' }, '한 번에 넉넉하게 보관')).toBeNull()
    expect(sectionAccent(slots, { headline: '20개 한 번에\n보관 끝' }, '에\n보관')).toBeNull()
    expect(sectionAccent(slots, { headline: '보관 끝' }, '보관 끝')).toBeNull()
    expect(sectionAccent(slots, values, 3)).toBeNull()
    expect(sectionAccent(slots, values, undefined)).toBeNull()
    expect(sectionAccent(slots, {}, '보관 끝')).toBeNull()
    expect(sectionAccent(copySlotsOf(head(false)), values, '보관 끝')).toBeNull()
  })
})
