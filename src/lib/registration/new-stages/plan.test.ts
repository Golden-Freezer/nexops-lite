import { describe, expect, it } from 'vitest'
import { K_SECTIONS } from '../templatelib/template-meta'
import { fakeDeps, TEST_OPTIONS, userText } from './new-stages.fixture'
import { buildPlanPrompt, checkPagePlan, kLinePlanSections, pagePlanInputOf, parsePagePlan, runPagePlan, type PagePlan } from './plan'

const VALID = {
  core_promise: '아침 3분이면 엉킨 머리가 풀린다',
  target: '아침마다 머리가 엉키는 직장인',
  appeals: [
    { rank: 1, appeal: '엉킴이 덜하다', evidence: '후기 12건', source: 'review' },
    { rank: 2, appeal: '두피가 편하다', evidence: '둥근 빗살', source: 'spec' },
    { rank: 3, appeal: '가볍다', evidence: '120g', source: 'spec' },
  ],
  flow: [
    { step: 1, section: 'hook_3step', say: '3분 정리', appeals: [1] },
    { step: 2, section: 'problem_raise', say: '아침마다 엉킴', appeals: [1] },
    { step: 3, section: 'point_div', say: '엉킴', appeals: [1] },
    { step: 4, section: 'point_div', say: '두피', appeals: [2] },
    { step: 5, section: 'review', say: '후기', appeals: [1, 2] },
    { step: 6, section: 'cta', say: '지금', appeals: [3] },
  ],
  hook: { promise: '3분이면 풀린다', hero_moment: '빗질 한 번에 풀리는 순간' },
  cta: '내일 아침부터 3분',
  dropped: [{ appeal: '정전기 없음', why: '근거 없음' }],
  risks: ['두피 효능으로 읽힐 수 있음'],
}
const ids = kLinePlanSections().map((s) => s.id)

describe('기획 프롬프트·입력', () => {
  it('K 라인 섹션 목록을 하는 일과 함께 싣는다', () => {
    const sections = kLinePlanSections()
    expect(sections.map((s) => s.id)).toEqual([...K_SECTIONS])
    expect(sections.every((s) => s.purpose.length > 0)).toBe(true)
    const prompt = buildPlanPrompt({ spec: 'SPEC', analysis: 'ANALYSIS', research: 'RESEARCH', sections })
    expect(prompt).toContain('### 판매자 입력\nSPEC')
    expect(prompt).toContain('- hook_3step: 첫 화면.')
    expect(prompt).toContain('첫 단계는 hook_3step, 마지막 단계는 cta다')
  })

  it('잡 입력은 리서치의 앞 기획(page_plan)과 분석 기록 칸을 뺀다', () => {
    const input = pagePlanInputOf({
      spec_sheet: { productName: '두피 빗' } as never,
      analysis: { detected_category: 'beauty', enrichment: { version: 1, features: ['x'] } } as never,
      research_result: { target_insights: '직장인', page_plan: { core_promise: '옛 기획' } } as never,
    })
    expect(input.spec).toContain('두피 빗')
    expect(input.analysis).not.toContain('enrichment')
    expect(input.research).toContain('직장인')
    expect(input.research).not.toContain('옛 기획')
    expect(input.sections).toHaveLength(K_SECTIONS.length)
  })
})

describe('parsePagePlan — 형식이 틀리면 던진다', () => {
  it('맞는 답을 그대로 읽는다', () => {
    expect(parsePagePlan(JSON.stringify(VALID))).toEqual(VALID)
  })

  it.each([
    [{ ...VALID, core_promise: '' }, 'core_promise'],
    [{ ...VALID, appeals: [] }, '$.appeals'],
    [{ ...VALID, appeals: [{ ...VALID.appeals[0], source: 'guess' }] }, 'source'],
    [{ ...VALID, flow: [{ ...VALID.flow[0], appeals: ['1'] }] }, 'appeals[0]'],
    [{ ...VALID, hook: { promise: '약속' } }, 'hero_moment'],
    [{ ...VALID, risks: '없음' }, 'risks'],
  ])('형식 오류 %#', (value, path) => {
    expect(() => parsePagePlan(JSON.stringify(value))).toThrow(path)
    expect(() => parsePagePlan(JSON.stringify(value))).toThrow('[형식 오류]')
  })

  it('잘린 답은 잘림으로 던진다', () => {
    expect(() => parsePagePlan(JSON.stringify(VALID).slice(0, 120))).toThrow('[잘림]')
  })
})

describe('checkPagePlan — 규칙 어긋남은 경고만', () => {
  it('규칙을 지킨 기획은 경고 0', () => {
    expect(checkPagePlan(VALID as PagePlan, ids)).toEqual([])
  })

  it('수·첫/끝 섹션·모르는 섹션·되풀이·없는 소구점 번호·추정 소구점을 경고한다', () => {
    const plan = {
      ...VALID,
      appeals: [{ rank: 1, appeal: 'a', evidence: '', source: 'inference' }],
      flow: [
        { step: 1, section: 'main_cut', say: '', appeals: [1] },
        { step: 2, section: 'review', say: '', appeals: [4] },
        { step: 3, section: 'review', say: '', appeals: [] },
        { step: 4, section: 'magic', say: '', appeals: [] },
      ],
    } as PagePlan
    expect(checkPagePlan(plan, ids)).toEqual([
      '소구점 1개 — 규칙 3~5개',
      '설득 단계 4개 — 규칙 6~10단계',
      '첫 단계가 hook_3step이 아님(main_cut)',
      '마지막 단계가 cta가 아님(magic)',
      '쓸 수 없는 섹션 id: magic',
      'point_div 말고 되풀이한 섹션: review',
      '설득 단계가 없는 소구점 번호를 가리킴: 4',
      '근거 없는 추정(inference) 소구점 1개',
    ])
  })
})

describe('runPagePlan', () => {
  it('route 이름 research/page-plan으로 부르고 결과·경고를 기록한다', async () => {
    const { deps, calls, routeNames } = fakeDeps({ text: '```json\n' + JSON.stringify(VALID) + '\n```' })
    const record = await runPagePlan({ spec: 'S', analysis: 'A', research: 'R', sections: kLinePlanSections() }, deps, TEST_OPTIONS)
    expect(routeNames).toEqual(['research/page-plan'])
    expect(calls[0].request.agentName).toBe('registration/pdp-page-plan')
    expect(userText(calls[0])).toContain('### 리서치(2단계 결과)\nR')
    expect(record).toMatchObject({ stage: 'plan', status: 'done', result: VALID, warnings: [] })
  })

  it('잘린 답은 failed(truncated)', async () => {
    const { deps } = fakeDeps({ text: '{"core_promise":"a","appeals":[', stopReason: 'max_tokens' })
    const record = await runPagePlan({ spec: 'S', analysis: 'A', research: 'R', sections: kLinePlanSections() }, deps, TEST_OPTIONS)
    expect(record).toMatchObject({ status: 'failed', failure: { kind: 'truncated' } })
  })
})
