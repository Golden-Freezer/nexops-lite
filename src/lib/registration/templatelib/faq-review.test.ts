/**
 * K 후기 질문 FAQ(K4 ②, 통합 11-05 11:39) — 답은 설계 단계 검사를 지난 자사 후기 원문이고(지어냄 0), 후기 카드와 같은 인용은 FAQ에서 뺀다(한쪽만).
 * 후기 질문이 2개 이상일 때만 그 템플릿을 고르고, 그러면 FAQ는 그것만 후보다. 사실 예산을 쓰지 않는다. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { getPdpTestProduct } from '../__fixtures__/pdp-products'
import { REVIEW_ANSWER_SOURCE } from '../long-sections'
import type { PdpJobRow } from '../pdp-state'
import { renderTemplate } from './engine'
import { fillInputSlots, lineInputsOf, requiredInputsFit, reviewFaqsOf, type LineInputs } from './input-values'
import { TEMPLATES, templateById } from './library'
import { sampleContext } from './sample'
import { isReviewFaq, selectTemplateLine, type TemplateAgents } from './select-line'
import { copyFactRange } from './selection-facts'
import { copySlotsOf } from './slot-copy'
import type { Template } from './template-types'
import type { TemplateMeta } from './template-meta'

const REVIEW_FAQS = (TEMPLATES as unknown as Template[]).filter((t) => isReviewFaq(t))
const QA = [
  { question: '아이가 쓰기에도 괜찮나요?', answer: '아이 손에도 쏙 들어가서 잘 써요' },
  { question: '선물용으로도 괜찮을까요?', answer: '포장이 깔끔해서 선물로 드렸어요' },
  { question: '세척은 어렵지 않나요?', answer: '물로 헹구기만 하면 금방 깨끗해져요' },
]
const card = (text: string) => ({ text, author: '구매자', rating: 5 })
const inputsOf = (faqs: LineInputs['faqs'], cards: LineInputs['cards'] = []): LineInputs => ({ spec: {} as LineInputs['spec'], cards, options: [], ...(faqs ? { faqs } : {}) })

describe('후기 질문 FAQ 항목', () => {
  it('규제 표현·짧은 답·같은 답은 빼고, 후기 카드와 같은 인용은 FAQ에서 뺀다', () => {
    const items = [...QA, { question: '피부에 좋나요?', answer: '아토피가 개선됐어요 정말 좋아요' }, { question: '짧나요?', answer: '좋아요' }, { ...QA[0], question: '같은 답?' }]
    const kept = reviewFaqsOf(items, [card('"포장이 깔끔해서 선물로 드렸어요"')], {})
    expect(kept).toEqual([QA[0], QA[2]])
    expect(reviewFaqsOf(QA, [], {})).toEqual(QA)
  })

  it('잡의 설계 기록(section_plan.long.reviewFaq)에서 읽고, 없으면 faqs 칸이 없다', () => {
    const base = { spec_sheet: {}, analysis: {}, copy_sections: { final: {} } }
    const withFaq = { ...base, section_plan: { long: { version: 1, kinds: ['faq'], excluded: [], reviewFaq: QA } } }
    expect(lineInputsOf(withFaq as unknown as PdpJobRow).faqs).toEqual(QA)
    expect('faqs' in lineInputsOf(base as unknown as PdpJobRow)).toBe(false)
    expect('faqs' in lineInputsOf({ ...base, section_plan: {} } as unknown as PdpJobRow)).toBe(false)
  })
})

describe('후기 질문 FAQ 템플릿', () => {
  it('왼쪽·가운데 두 개이고 카피 칸·사실 예산이 없다 — 질문·답·출처 모두 입력값이다', () => {
    expect(REVIEW_FAQS.map((t) => t.id).sort()).toEqual(['faq.review-center', 'faq.review-quotes'])
    for (const t of REVIEW_FAQS) {
      expect(copySlotsOf(t as unknown as TemplateMeta), t.id).toEqual([])
      expect(copyFactRange(t as unknown as TemplateMeta), t.id).toEqual({ min: 0, max: 0 })
      expect(t.needs.evidence, t.id).toEqual(['faq'])
    }
  })

  it('답은 후기 원문을 따옴표로 감싸고 출처를 단다 — 칸보다 긴 줄은 자르지 않고 건너뛴다', () => {
    const t = templateById('faq.review-quotes') as Template
    const long = { question: '아주 긴 질문'.repeat(8), answer: '긴 답' }
    const values = fillInputSlots(t, inputsOf([long, ...QA]))
    expect(values.items).toEqual(QA.map(({ question, answer }) => ({ question, answer: `"${answer}"`, source: REVIEW_ANSWER_SOURCE })))
  })

  it('후기 질문이 2개 이상일 때만 그려진다', () => {
    for (const t of REVIEW_FAQS) {
      expect(requiredInputsFit(t, inputsOf(undefined)), t.id).toBe(false)
      expect(requiredInputsFit(t, inputsOf(QA.slice(0, 1))), t.id).toBe(false)
      expect(requiredInputsFit(t, inputsOf(QA.slice(0, 2))), t.id).toBe(true)
      const out = renderTemplate(t, fillInputSlots(t, inputsOf(QA)), sampleContext())
      expect(out?.height ?? 0, t.id).toBeGreaterThan(0)
    }
  })
})

describe('후기 질문 FAQ 고르기', () => {
  const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
  const agents: TemplateAgents = {
    guideline: async ({ concepts }) => free({ persona: '', tone: '', concept: { id: concepts[0].id, reason: '' }, alternatives: [] }),
    compose: async () => free(['hook_3step', 'main_cut', 'point_div', 'point_div', 'review', 'faq', 'spec_table', 'cta']),
    select: async ({ slots }) => free(slots.map((slot) => ({ index: slot.index, templateId: slot.candidates[0].id, reason: '' }))),
  }
  const faqOf = async (faqs: LineInputs['faqs']) => {
    const item = getPdpTestProduct('P02')
    const inputs = { ...lineInputsOf({ spec_sheet: item.specSheet, analysis: {}, copy_sections: { final: { options: item.specSheet.colorOptions ?? [] } } } as unknown as PdpJobRow), ...(faqs ? { faqs } : {}) }
    const line = await selectTemplateLine(
      { key: 'P02', categoryKey: item.categoryKey, productHex: null, spec: item.specSheet, templates: TEMPLATES as unknown as TemplateMeta[], inputs, product: { category: item.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] } },
      agents
    )
    return line.order.sections.find((s) => s.section === 'faq')?.templateId ?? null
  }

  it('후기 질문이 있으면 FAQ는 후기 질문 템플릿이고, 없으면 그 템플릿을 고르지 않는다', async () => {
    const withReviews = await faqOf(QA)
    expect(withReviews).not.toBeNull()
    expect(isReviewFaq(templateById(withReviews!)!)).toBe(true)
    const without = await faqOf(undefined)
    if (without) expect(isReviewFaq(templateById(without)!)).toBe(false)
  })
})
