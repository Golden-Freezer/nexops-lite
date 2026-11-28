/**
 * K 라인 선택 에이전트 — 라우트·agent 이름·실패 때 후보로 계속, 파서가 목록 밖 값을 버리는지. 공급자 호출은 모의다(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ callLlm: vi.fn() }))
vi.mock('../llm', () => ({ callLlm: (...a: unknown[]) => h.callLlm(...a) }))

import { PDP_MODEL_ROUTES } from '@/lib/registration/pdp-model-routes'
import { CONCEPTS } from '@/lib/registration/templatelib/concepts'
import { tpl } from '@/lib/registration/templatelib/selection.fixture'
import { K_SECTIONS } from '@/lib/registration/templatelib/template-meta'
import { composeTemplateSections, generateTemplateGuideline, selectTemplatePicks } from './pdp-template-agent'
import {
  SECTION_PURPOSES,
  buildComposePrompt,
  buildGuidelinePrompt,
  buildSelectPrompt,
  parseComposition,
  parseGuideline,
  parseSelection,
  type Guideline,
} from './prompts/pdp-template-prompts'

const product = { category: 'household', persona: '자취생', summary: '요약', keywords: ['가벼움'], usps: ['접이식'], pains: ['무거움'] }
const concepts = CONCEPTS.slice(0, 4)
const guideline: Guideline = { persona: '자취생', tone: '담백', concept: { id: concepts[0].id, reason: 'r' }, alternatives: [] }
const RUN = { userId: 'user-1', stage: 'k' }
const slots = [
  { index: 0, section: 'cta', candidates: [tpl('cta.a'), tpl('cta.b')] },
  { index: 1, section: 'review', candidates: [tpl('review.a')] },
]

const succeed = (text: string, cost = 0.01) =>
  h.callLlm.mockImplementation(async (_route, _req, parse: (t: string) => unknown) => ({ success: true, data: parse(text), usage: { cost } }))
const fail = (message: string, cost = 0.002) => h.callLlm.mockResolvedValue({ success: false, error: { message }, usage: { cost } })

beforeEach(() => {
  h.callLlm.mockReset()
})

describe('가이드라인', () => {
  it('라우트·agent 이름·runContext로 부르고 값과 비용을 돌려준다', async () => {
    succeed(JSON.stringify({ persona: ' 자취생 ', tone: '담백', concept: { id: concepts[1].id, reason: '이유' }, alternatives: [concepts[2].id, concepts[3].id] }))
    const out = await generateTemplateGuideline({ product, concepts }, RUN)
    const [route, request] = h.callLlm.mock.calls[0]
    expect(route).toMatchObject({ maxTokens: PDP_MODEL_ROUTES['design/template-guideline'].maxTokens })
    expect(request).toMatchObject({ agentName: 'registration/pdp-template-guideline', runContext: RUN })
    expect(out.usedFallback).toBe(false)
    expect(out.costUsd).toBe(0.01)
    expect(out.value).toEqual({ persona: '자취생', tone: '담백', concept: { id: concepts[1].id, reason: '이유' }, alternatives: [concepts[2].id, concepts[3].id] })
  })

  it('실패하면 후보 앞줄로 계속하고 사유와 비용을 돌려준다', async () => {
    fail('시간 초과')
    const out = await generateTemplateGuideline({ product, concepts }, RUN)
    expect(out).toMatchObject({ usedFallback: true, error: '시간 초과', costUsd: 0.002 })
    expect(out.value).toEqual({ persona: '자취생', tone: '', concept: { id: concepts[0].id, reason: '' }, alternatives: [concepts[1].id, concepts[2].id] })
  })

  it('고객 입력이 없어 실패하면 고객 한 줄은 비운다', async () => {
    fail('x')
    const out = await generateTemplateGuideline({ product: { ...product, persona: null }, concepts }, RUN)
    expect(out.value.persona).toBe('')
  })

  it('파서 — 목록 밖 컨셉은 실패, 대안은 목록 안·중복·같은 값을 뺀 앞 2개, 긴 글은 자른다', () => {
    const allowed = new Set(['a', 'b', 'c', 'd'])
    expect(() => parseGuideline(JSON.stringify({ concept: { id: 'z' } }), allowed)).toThrow('목록에 없습니다')
    expect(() => parseGuideline(JSON.stringify({ persona: 'p' }), allowed)).toThrow('목록에 없습니다')
    expect(() => parseGuideline('', allowed)).toThrow('비어 있습니다')
    expect(() => parseGuideline('글자만', allowed)).toThrow('파싱 실패')
    const parsed = parseGuideline(JSON.stringify({ persona: 'p'.repeat(300), concept: { id: 'a' }, alternatives: ['a', 'z', 'b', 'b', 'c', 'd', 3] }), allowed)
    expect(parsed.alternatives).toEqual(['b', 'c'])
    expect(parsed.persona).toHaveLength(200)
    expect(parsed.tone).toBe('')
    expect(parsed.concept).toEqual({ id: 'a', reason: '' })
    expect(parseGuideline(JSON.stringify({ concept: { id: 'a' }, alternatives: 'b' }), allowed).alternatives).toEqual([])
  })

  it('프롬프트에 상품과 컨셉 id가 든다, 고객 입력이 없으면 추론하라고 적는다', () => {
    const prompt = buildGuidelinePrompt(product, concepts)
    for (const c of concepts) expect(prompt).toContain(c.id)
    expect(prompt).toContain('자취생')
    expect(prompt).toContain('접이식')
    expect(buildGuidelinePrompt({ ...product, persona: null, keywords: [] }, concepts)).toContain('입력 없음')
    expect(buildGuidelinePrompt({ ...product, keywords: [] }, concepts)).toContain('낱말: (없음)')
  })
})

describe('섹션 구성', () => {
  const input = { product, guideline, open: ['cta', 'review', 'petit_div'], facts: { count: 5, places: 8 }, range: { min: 18, max: 22 } }

  it('라우트·agent 이름으로 부르고 목록 안 값만 돌려준다', async () => {
    succeed(JSON.stringify({ sections: ['cta', '없는것', 'review', 'cta'] }))
    const out = await composeTemplateSections(input, RUN)
    const [route, request] = h.callLlm.mock.calls[0]
    expect(route).toMatchObject({ maxTokens: PDP_MODEL_ROUTES['design/template-compose'].maxTokens })
    expect(request).toMatchObject({ agentName: 'registration/pdp-template-compose', runContext: RUN })
    expect(out.value).toEqual(['cta', 'review', 'cta'])
    expect(out.usedFallback).toBe(false)
  })

  it('실패하면 빈 목록과 사유를 돌려준다', async () => {
    fail('x')
    expect(await composeTemplateSections(input, RUN)).toEqual({ value: [], usedFallback: true, error: 'x', costUsd: 0.002 })
  })

  it('파서 — 쓸 수 있는 값이 없으면 실패다, 코드 블록은 벗긴다', () => {
    const allowed = new Set(['cta'])
    expect(() => parseComposition(JSON.stringify({ sections: ['z'] }), allowed)).toThrow('쓸 수 있는 id가 없습니다')
    expect(() => parseComposition(JSON.stringify({ sections: 'cta' }), allowed)).toThrow('쓸 수 있는 id가 없습니다')
    const fence = '`'.repeat(3)
    expect(parseComposition(`${fence}json\n${JSON.stringify({ sections: ['cta'] })}\n${fence}`, allowed)).toEqual(['cta'])
  })

  it('프롬프트에 범위·사실 수·섹션이 하는 일이 든다, 모든 섹션에 설명이 있다', () => {
    const prompt = buildComposePrompt(input)
    expect(prompt).toContain('18~22개')
    expect(prompt).toContain('상품 사실 5개, 사실을 실을 자리 8곳')
    expect(prompt).toContain(`petit_div: ${SECTION_PURPOSES.petit_div}`)
    for (const section of K_SECTIONS) expect(SECTION_PURPOSES[section], section).toBeTruthy()
  })
})

describe('템플릿 선택', () => {
  const input = { product, guideline, conceptName: '깔끔한 신뢰', slots }

  it('라우트·agent 이름으로 부른다, 자리의 후보가 아닌 값은 버린다', async () => {
    succeed(JSON.stringify({ picks: [{ index: 0, templateId: 'cta.b', reason: '이유' }, { index: 1, templateId: 'cta.a', reason: '남의 자리' }] }))
    const out = await selectTemplatePicks(input, RUN)
    const [route, request] = h.callLlm.mock.calls[0]
    expect(route).toMatchObject({ maxTokens: PDP_MODEL_ROUTES['design/template-select'].maxTokens })
    expect(request).toMatchObject({ agentName: 'registration/pdp-template-select', runContext: RUN })
    expect(out.value).toEqual([{ index: 0, templateId: 'cta.b', reason: '이유' }])
  })

  it('실패하면 빈 목록과 사유를 돌려준다', async () => {
    fail('x')
    expect(await selectTemplatePicks(input, RUN)).toEqual({ value: [], usedFallback: true, error: 'x', costUsd: 0.002 })
  })

  it('파서 — 같은 자리는 첫 값만, 쓸 수 있는 값이 없으면 실패다, 없는 자리·이상한 줄은 버린다', () => {
    const picks = parseSelection(
      JSON.stringify({ picks: [{ index: 0, templateId: 'cta.a' }, { index: 0, templateId: 'cta.b' }, { index: 9, templateId: 'cta.a' }, null, 'x'] }),
      slots
    )
    expect(picks).toEqual([{ index: 0, templateId: 'cta.a', reason: '' }])
    expect(() => parseSelection(JSON.stringify({ picks: [{ index: 0, templateId: 'z' }] }), slots)).toThrow('쓸 수 있는 값이 없습니다')
    expect(() => parseSelection(JSON.stringify({ picks: 'x' }), slots)).toThrow('쓸 수 있는 값이 없습니다')
  })

  it('프롬프트에 자리·후보·모양·말투·컨셉이 든다', () => {
    const prompt = buildSelectPrompt(input)
    expect(prompt).toContain('자리 0 (cta)')
    expect(prompt).toContain('자리 1 (review)')
    expect(prompt).toContain('cta.b')
    expect(prompt).toContain('깔끔한 신뢰')
    expect(prompt).toContain('담백')
  })
})
