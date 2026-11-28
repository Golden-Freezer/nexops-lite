/**
 * 근거 잠금 칸 검사(R-W3) 시험 — 근거 입력이 있어야 그려진다. 라이브러리의 카테고리 칸을 하나씩 망가뜨려 검사가 잡는지 본다.
 */

import { describe, expect, it } from 'vitest'
import { TEMPLATES, templateById } from './library'
import { INPUT_ONLY_SECTIONS, lintCategoryTemplates, lintEvidenceLock } from './lint-category'
import { SECTION_EVIDENCE } from './selection-facts'
import type { SlotDef, Template } from './template-types'

const LOCKED = Object.keys(SECTION_EVIDENCE)
const clone = (t: Template) => JSON.parse(JSON.stringify(t)) as Template
const cell = (id: string) => {
  const found = templateById(id)
  if (!found) throw new Error(`라이브러리에 없음: ${id}`)
  return clone(found)
}
const details = (t: Template) => lintEvidenceLock(t).map((v) => v.detail)

describe('근거 잠금 칸(R-W3)', () => {
  it('라이브러리의 카테고리 칸은 모두 통과하고, 잠금 섹션 칸이 있다', () => {
    const category = TEMPLATES.filter((t) => t.fit.categories?.length)
    expect(category.flatMap(lintEvidenceLock)).toEqual([])
    const locked = category.filter((t) => LOCKED.includes(t.section))
    expect(locked.length).toBeGreaterThanOrEqual(10)
  })

  it('입력만 쓰는 섹션은 잠금 섹션에서 FAQ와 GIF 칸을 뺀 것이다', () => {
    // GIF 칸(motion_band)은 스위치 근거로 잠기지만 동작 한 줄은 카피가 쓴다
    expect([...INPUT_ONLY_SECTIONS].sort()).toEqual(LOCKED.filter((s) => s !== 'faq' && s !== 'motion_band').sort())
  })

  it.each([
    ['review.household-offset-quotes', 'review'],
    ['certification.household-names-offset-end', 'certification'],
    ['event_offer.household-circle-offer', 'offer'],
    // 성과 섹션은 평점 또는 우리 판매량(J51b)으로 연다
    ['perf_metric.household-plate-score', 'rating 또는 sales'],
    ['faq.household-bleed-rows', 'faq'],
  ])('%s: 섹션 자료(%s)가 아닌 근거로 잠그면 막는다', (id, lock) => {
    const t = cell(id)
    t.needs.evidence = ['review_photos']
    expect(details(t)).toContain(`${t.section} 칸은 needs.evidence에 ${lock} 필수(근거 입력이 있어야 그려진다)`)
  })

  it('후기 글을 모델 글로 바꾸면 막는다 — 지어낸 후기', () => {
    const t = cell('review.household-offset-quotes')
    const items = t.slots.items as Extract<SlotDef, { type: 'list' }>
    const quote = items.fields.quote as Extract<SlotDef, { type: 'text' }>
    quote.source = 'copy'
    delete quote.input
    expect(details(t)).toEqual(['items.quote: 근거 글은 입력만(source input) — 모델 글로 지어내지 않는다'])
  })

  it('혜택 글을 모델 글로 바꾸면 막고, 필수 입력 칸이 없어진 것도 함께 잡는다', () => {
    const t = cell('event_offer.household-circle-offer')
    const offer = t.slots.offer as Extract<SlotDef, { type: 'text' }>
    offer.source = 'copy'
    expect(details(t)).toEqual(['event_offer 칸은 필수 입력 칸이 있어야 한다(입력이 없으면 칸이 빠진다)', 'offer: 근거 글은 입력만(source input) — 모델 글로 지어내지 않는다'])
  })

  it('인증 줄을 선택 칸으로 두면 입력 없이 그려지므로 막는다', () => {
    const t = cell('certification.household-names-offset-end')
    t.slots.items.required = false
    expect(details(t)).toEqual(['certification 칸은 필수 입력 칸이 있어야 한다(입력이 없으면 칸이 빠진다)'])
  })

  it('FAQ는 상품 사실로 답을 쓰므로 모델 글이어도 통과한다', () => {
    const t = cell('faq.household-bleed-rows')
    expect(JSON.stringify(t.slots)).not.toContain('"source":"input"')
    expect(details(t)).toEqual([])
  })

  it('비교 칸은 잠금 섹션이 아니다 — 우리 장점만 체크하는 칸은 evidence가 비어도 된다', () => {
    const t = cell('compare.household-wide-narrow-checks')
    expect(t.needs.evidence).toEqual([])
    expect(details(t)).toEqual([])
  })

  it('공용 템플릿은 이 검사를 받지 않는다(카테고리 칸만)', () => {
    const t = cell('review.household-offset-quotes')
    t.fit.categories = []
    t.needs.evidence = []
    expect(lintEvidenceLock(t)).toEqual([])
  })

  it('전수 검사에 evidence 규칙으로 들어간다', () => {
    const t = cell('review.household-offset-quotes')
    t.needs.evidence = []
    const found = lintCategoryTemplates([t], []).filter((v) => v.rule === 'evidence')
    expect(found.map((v) => v.template)).toEqual([t.id])
  })
})
