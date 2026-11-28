import { describe, expect, it } from 'vitest'
import { buildFactAuditPrompt, checkFactAudit, factAuditInputOf, parseFactAudit, runFactAudit, type FactAuditInput } from './fact-audit'
import { fakeDeps, TEST_OPTIONS, userText } from './new-stages.fixture'

const INPUT: FactAuditInput = {
  spec: '{"productName":"두피 빗","weight":"120g"}',
  analysis: '{"detected_category":"beauty"}',
  research: '{"pain_points":[{"insight":"아침마다 엉킴"}]}',
  lines: [
    { id: '0.hook_3step.title', text: '120g 가벼운 빗\n아침 3분' },
    { id: '2.point_div:0.body', text: '빗살 200개' },
    { id: '3.review.title', text: '두피 염증 완화' },
  ],
}

const VALID = {
  items: [
    { id: '0.hook_3step.title', claim: '120g', verdict: 'supported', evidence: '"weight":"120g"', fix: '', regulated: false },
    { id: '2.point_div:0.body', claim: '빗살 200개', verdict: 'unsupported', evidence: '', fix: '', regulated: false },
    { id: '3.review.title', claim: '염증 완화', verdict: 'unsupported', evidence: '', fix: '두피에 닿는 느낌이 부드럽다', regulated: true },
  ],
  summary: { checked: 3, unsupported: 2, regulated: 1 },
}

describe('사실 감사 프롬프트·입력', () => {
  it('근거 글과 줄을 id: 글로 싣는다(줄바꿈은 / )', () => {
    const prompt = buildFactAuditPrompt(INPUT)
    expect(prompt).toContain('### 판매자 입력\n{"productName":"두피 빗","weight":"120g"}')
    expect(prompt).toContain('- 0.hook_3step.title: 120g 가벼운 빗 / 아침 3분')
    expect(prompt).toContain('regulated: true로 표시한다')
  })

  it('잡 입력은 근거 글(sources)과 받은 줄 그대로', () => {
    const input = factAuditInputOf(
      { spec_sheet: { productName: '두피 빗' } as never, analysis: {} as never, research_result: { page_plan: { x: 1 } } as never },
      INPUT.lines,
    )
    expect(input.lines).toBe(INPUT.lines)
    expect(input.research).toBe('{}')
  })
})

describe('parseFactAudit', () => {
  it('맞는 답을 그대로 읽는다(빈 items도 된다)', () => {
    expect(parseFactAudit(JSON.stringify(VALID))).toEqual(VALID)
    expect(parseFactAudit('{"items":[],"summary":{"checked":0,"unsupported":0,"regulated":0}}').items).toEqual([])
  })

  it.each([
    [{ ...VALID, items: [{ ...VALID.items[0], verdict: 'maybe' }] }, 'verdict'],
    [{ ...VALID, items: [{ ...VALID.items[0], regulated: 'no' }] }, 'regulated'],
    [{ ...VALID, items: [{ ...VALID.items[0], id: '' }] }, 'id'],
    [{ items: VALID.items }, '$.summary'],
    [{ ...VALID, summary: { checked: 3, unsupported: '2', regulated: 1 } }, 'unsupported'],
  ])('형식 오류 %#', (value, path) => {
    expect(() => parseFactAudit(JSON.stringify(value))).toThrow(path)
  })

  it('빈 답·잘린 답은 던진다', () => {
    expect(() => parseFactAudit('')).toThrow('[빈 답]')
    expect(() => parseFactAudit(JSON.stringify(VALID).slice(0, -3))).toThrow('[잘림]')
  })
})

describe('checkFactAudit — 기록+경고(고치지 않는다)', () => {
  it('찾은 것을 경고로 적는다', () => {
    expect(checkFactAudit(parseFactAudit(JSON.stringify(VALID)), INPUT)).toEqual([
      '사실 감사: 입력에 없는 주장 2줄(2.point_div:0.body, 3.review.title)',
      '사실 감사: 규제 표현 1줄(3.review.title)',
    ])
  })

  it('보낸 적 없는 줄 id·입력에 없는 근거 인용·요약 수 불일치를 경고한다', () => {
    const audit = parseFactAudit(
      JSON.stringify({
        items: [
          { id: '9.ghost.title', claim: 'x', verdict: 'partial', evidence: '입력에 없는 문구', fix: '', regulated: false },
        ],
        summary: { checked: 1, unsupported: 1, regulated: 0 },
      }),
    )
    expect(checkFactAudit(audit, INPUT)).toEqual([
      '사실 감사: 입력보다 세거나 일부만 맞는 주장 1줄(9.ghost.title)',
      '보낸 적 없는 줄 id 1개(9.ghost.title)',
      '근거 인용이 입력 원문에 없음 1줄(9.ghost.title)',
      '요약 수가 항목과 다름(요약 unsupported 1·regulated 0, 항목 0·0)',
    ])
  })
})

describe('runFactAudit', () => {
  it('route 이름 copy/fact-audit으로 부르고 줄·fix를 바꾸지 않는다', async () => {
    const before = JSON.parse(JSON.stringify(INPUT))
    const { deps, calls, routeNames } = fakeDeps({ text: JSON.stringify(VALID) })
    const record = await runFactAudit(INPUT, deps, TEST_OPTIONS)
    expect(routeNames).toEqual(['copy/fact-audit'])
    expect(userText(calls[0])).toContain('## 감사할 화면 글(id: 글)')
    expect(record.status).toBe('done')
    if (record.status !== 'done') return
    expect(record.result.items[2].fix).toBe('두피에 닿는 느낌이 부드럽다')
    expect(record.warnings).toHaveLength(2)
    expect(INPUT).toEqual(before)
  })

  it('줄이 없으면 부르지 않고 no_input 생략', async () => {
    const { deps, calls } = fakeDeps({ text: JSON.stringify(VALID) })
    expect(await runFactAudit({ ...INPUT, lines: [] }, deps, TEST_OPTIONS)).toEqual({ version: 1, stage: 'factAudit', status: 'skipped', reason: 'no_input' })
    expect(calls).toHaveLength(0)
  })

  it('형식 오류 답은 failed(format)', async () => {
    const { deps } = fakeDeps({ text: '{"items":"없음","summary":{}}' })
    expect(await runFactAudit(INPUT, deps, TEST_OPTIONS)).toMatchObject({ status: 'failed', failure: { kind: 'format' } })
  })
})
