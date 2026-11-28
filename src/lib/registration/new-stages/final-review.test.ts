import { describe, expect, it } from 'vitest'
import { buildFinalReviewPrompt, checkFinalReview, finalReviewInputOf, parseFinalReview, runFinalReview, type FinalReviewInput } from './final-review'
import { fakeDeps, TEST_OPTIONS, userText } from './new-stages.fixture'

const INPUT: FinalReviewInput = {
  spec: '{"productName":"두피 빗"}',
  lines: [
    { id: '0.hook_3step.title', text: '두피 염증까지\n싹 잡는 빗' },
    { id: '5.review.count', text: '후기 3,000개' },
  ],
}

const VALID = {
  flags: [
    { id: '0.hook_3step.title', kind: 'regulated', text: '두피 염증까지 / 싹 잡는', why: '질환 표현', fix: '두피에 부드럽게 닿는 빗' },
    { id: '5.review.count', kind: 'number', text: '3,000개', why: '입력에 없는 후기 수', fix: '' },
  ],
  pass: false,
}

describe('최종 검수 프롬프트·입력', () => {
  it('판매자 입력과 화면 글 전부를 싣는다', () => {
    const prompt = buildFinalReviewPrompt(INPUT)
    expect(prompt).toContain('## 판매자 입력(사실 근거)\n{"productName":"두피 빗"}')
    expect(prompt).toContain('- 0.hook_3step.title: 두피 염증까지 / 싹 잡는 빗')
    expect(prompt).toContain('- reproduce:')
  })

  it('잡 입력은 프롬프트용 판매자 입력과 받은 줄', () => {
    const input = finalReviewInputOf({ spec_sheet: { productName: '두피 빗' } as never }, INPUT.lines)
    expect(input.spec).toContain('두피 빗')
    expect(input.lines).toBe(INPUT.lines)
  })
})

describe('parseFinalReview', () => {
  it('맞는 답을 그대로 읽는다', () => {
    expect(parseFinalReview(JSON.stringify(VALID))).toEqual(VALID)
    expect(parseFinalReview('{"flags":[],"pass":true}')).toEqual({ flags: [], pass: true })
  })

  it.each([
    [{ ...VALID, flags: [{ ...VALID.flags[0], kind: 'style' }] }, 'kind'],
    [{ ...VALID, flags: [{ ...VALID.flags[0], fix: null }] }, 'fix'],
    [{ flags: [] }, 'pass'],
    [{ ...VALID, flags: {} }, 'flags'],
  ])('형식 오류 %#', (value, path) => {
    expect(() => parseFinalReview(JSON.stringify(value))).toThrow(path)
  })
})

describe('checkFinalReview — 기록+경고(고치지 않는다)', () => {
  it('걸린 글을 종류별로 센다', () => {
    expect(checkFinalReview(parseFinalReview(JSON.stringify(VALID)), INPUT.lines)).toEqual([
      '최종 검수: 걸린 글 2건(regulated 1·number 1 — 0.hook_3step.title, 5.review.count)',
    ])
  })

  it('합격 답은 경고 0', () => {
    expect(checkFinalReview({ flags: [], pass: true }, INPUT.lines)).toEqual([])
  })

  it('보낸 적 없는 줄 id·그 줄에 없는 걸린 부분·pass 모순을 경고한다', () => {
    const review = parseFinalReview(
      JSON.stringify({ flags: [{ id: '9.ghost', kind: 'age', text: '아이', why: '', fix: '' }, { ...VALID.flags[1], text: '5,000개' }], pass: true }),
    )
    expect(checkFinalReview(review, INPUT.lines)).toEqual([
      '최종 검수: 걸린 글 2건(number 1·age 1 — 9.ghost, 5.review.count)',
      '보낸 적 없는 줄 id 1개(9.ghost)',
      '걸린 부분이 그 줄 글에 없음 1건(5.review.count)',
      'pass true인데 걸린 글이 있음',
    ])
    expect(checkFinalReview({ flags: [], pass: false }, INPUT.lines)).toEqual(['pass false인데 걸린 글이 없음'])
  })
})

describe('runFinalReview', () => {
  it('route 이름 compose/final-review로 부르고 줄을 바꾸지 않는다', async () => {
    const before = JSON.parse(JSON.stringify(INPUT))
    const { deps, calls, routeNames } = fakeDeps({ text: JSON.stringify(VALID) })
    const record = await runFinalReview(INPUT, deps, TEST_OPTIONS)
    expect(routeNames).toEqual(['compose/final-review'])
    expect(calls[0].request.agentName).toBe('registration/pdp-final-review')
    expect(userText(calls[0])).toContain('## 화면 글 전부(id: 글)')
    expect(record).toMatchObject({ stage: 'finalReview', status: 'done', result: VALID })
    expect(INPUT).toEqual(before)
  })

  it('줄이 없으면 부르지 않고 no_input 생략', async () => {
    const { deps, calls } = fakeDeps({ text: JSON.stringify(VALID) })
    expect(await runFinalReview({ ...INPUT, lines: [] }, deps, TEST_OPTIONS)).toMatchObject({ status: 'skipped', reason: 'no_input' })
    expect(calls).toHaveLength(0)
  })

  it('API 실패는 failed(api)로 기록하고 비용을 남긴다', async () => {
    const { deps } = fakeDeps({ error: { message: 'overloaded', stage: 'api', attempts: 2 }, cost: 0 })
    expect(await runFinalReview(INPUT, deps, TEST_OPTIONS)).toMatchObject({ status: 'failed', failure: { kind: 'api', message: 'overloaded' }, costUsd: 0 })
  })
})
