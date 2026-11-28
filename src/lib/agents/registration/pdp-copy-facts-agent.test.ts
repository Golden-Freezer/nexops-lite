/**
 * 카피 에이전트 사실 값·반복 배선(pdp-copy-facts-r4) — factsBlock은 모든 콜(Stage 1·2·3·pointCards) 말미에 붙고, checkRepeats면
 * Stage 2 산출의 섹션 사이 반복을 Stage 3 '고칠 곳'으로 넣는다. 둘 다 없으면 프롬프트가 지금 그대로다. 공급자는 모의(유료 호출 0).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DESIGN_ACCENT_WRITE_BLOCK, DESIGN_COPY_WRITE_BLOCK } from '@/lib/registration/copy-design-rules'
import type { PdpJobRow } from '@/lib/registration/pdp-state'

const h = vi.hoisted(() => ({
  job: null as unknown as PdpJobRow,
  calls: [] as Array<{ agentName: string; prompt: string }>,
  /** 시험마다 Stage 1·2 답에 덮어쓰는 칸(카피 규칙 시험) */
  extra: {} as Record<string, unknown>,
  /** Stage 3 답에서 빼는 최상위 칸(강조 구절 이어 붙이기 시험) */
  stage3Omit: [] as string[],
}))

/**
 * Stage 1·2가 '손가락 대신'을 열 섹션에 되풀이한 카피를 돌려준다(픽스처 카피 자체의 반복 — '돌리기만 하면' 9섹션 — 보다 많게 해 반복
 * 목록 맨 앞에 오게 한다). pointCards는 비워 보충 콜까지 부른다
 */
const reply = (options: Record<string, unknown>, parser: (t: string) => unknown) => {
  const messages = options.messages as Array<{ content: string }>
  h.calls.push({ agentName: String(options.agentName), prompt: String(messages[0].content) })
  const copy = h.job.copy_sections.final as unknown as Record<string, unknown>
  const repeated = {
    ...copy,
    pointCards: [],
    mainIntro: { ...(copy.mainIntro as object), subBenefit: '손가락 대신 브러쉬로 감아요' },
    solution: { summary: '손가락 대신 실리콘 돌기가 닿아요' },
    summary: '손가락 대신 쓰는 샴푸 브러쉬',
    closingCta: { headline: '손가락 대신 시작해요', subtext: '지금 골라요' },
    keyMessageCopy: { headline: '손가락 대신 쓰는 브러쉬' },
    keyMessageVariations: { top: '손가락 대신 감아요' },
    compareSummary: '손가락 대신 쓰는 이유',
    directionHint: { headline: '손가락 대신 써 보세요' },
    soldOutBanner: { headline: '손가락 대신 인기' },
    eventBundleCopy: { headline: '손가락 대신 묶음' },
    ...h.extra,
  }
  if (options.agentName === 'registration/pdp-copy-stage3') for (const key of h.stage3Omit) delete (repeated as Record<string, unknown>)[key]
  const text = options.agentName === 'registration/pdp-copy-retry-pointcards' ? '[]' : JSON.stringify(repeated)
  return { success: true, data: parser(text), usage: { inputTokens: 0, outputTokens: 0, cost: 0.01 }, duration: 0 }
}
vi.mock('../_base', () => ({ callAgent: async (o: Record<string, unknown>, p: (t: string) => unknown) => reply(o, p) }))
vi.mock('../openai-chat', () => ({
  callOpenAiChat: async (o: Record<string, unknown>, p: (t: string) => unknown) => {
    // OpenAI 공급자는 system을 따로 받는다 — 사용자 메시지만 본다
    return reply(o, p)
  },
}))

import { fixtureToJob, loadEnrichmentFixture } from '@/lib/registration/__golden__/golden-harness'
import { runPdpCopywriting } from './pdp-copy-agent'

const savedBackend = process.env.NEXOPS_PDP_LLM_BACKEND
const FACTS = '## [사실 값 — 옵션 개수·수량 숫자는 이 값만 쓴다]\n- 디자인 6가지'
const REPEAT_HEAD = '## [섹션 사이 반복 — 고칠 곳(결정론 검사)]'

beforeAll(() => {
  h.job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
})
beforeEach(() => {
  delete process.env.NEXOPS_PDP_LLM_BACKEND
  h.calls = []
  h.extra = {}
  h.stage3Omit = []
})
afterEach(() => {
  if (savedBackend !== undefined) process.env.NEXOPS_PDP_LLM_BACKEND = savedBackend
})

const run = (extra: Partial<Parameters<typeof runPdpCopywriting>[0]> = {}) =>
  runPdpCopywriting({
    specSheet: h.job.spec_sheet,
    mode: 'pro',
    analysis: h.job.analysis,
    research: h.job.research_result,
    sectionPlan: h.job.section_plan,
    strategyContract: {},
    runContext: { userId: 'user-1', stage: 'copywriting' },
    ...extra,
  })
const promptOf = (stage: string) => h.calls.find((c) => c.agentName === `registration/pdp-copy-${stage}`)!.prompt

describe('runPdpCopywriting — 사실 값 블록', () => {
  it('factsBlock은 Stage 1·2·3·pointCards 보충 콜의 말미에 붙는다', async () => {
    await run({ factsBlock: FACTS })
    expect(h.calls.map((c) => c.agentName)).toEqual([
      'registration/pdp-copy-stage1',
      'registration/pdp-copy-stage2',
      'registration/pdp-copy-stage3',
      'registration/pdp-copy-retry-pointcards',
    ])
    for (const c of h.calls) expect(c.prompt.endsWith(FACTS), c.agentName).toBe(true)
  })

  it('없으면 어느 프롬프트에도 사실 값 블록이 없다(지금 그대로)', async () => {
    await run()
    for (const c of h.calls) expect(c.prompt, c.agentName).not.toContain('[사실 값')
  })
})

describe('runPdpCopywriting — 섹션 사이 반복을 Stage 3에', () => {
  it('checkRepeats면 Stage 2 산출의 반복을 Stage 3 고칠 곳으로 넣는다(Stage 1·2에는 없다)', async () => {
    await run({ checkRepeats: true })
    expect(promptOf('stage3')).toContain(REPEAT_HEAD)
    expect(promptOf('stage3')).toContain(
      "- '손가락 대신' — closingCta·compareSummary·directionHint·eventBundleCopy·keyMessageCopy·keyMessageVariations·mainIntro·soldOutBanner·solution·summary"
    )
    expect(promptOf('stage1')).not.toContain(REPEAT_HEAD)
    expect(promptOf('stage2')).not.toContain(REPEAT_HEAD)
  })

  it('checkRepeats가 없으면 Stage 3 프롬프트에 반복 블록이 없다(기록 잡이 아닌 잡은 지금 그대로)', async () => {
    await run()
    expect(promptOf('stage3')).not.toContain(REPEAT_HEAD)
  })

  it('반복 블록은 사실 값 블록보다 앞(사실 값이 늘 맨 끝)', async () => {
    await run({ checkRepeats: true, factsBlock: FACTS })
    const prompt = promptOf('stage3')
    expect(prompt.indexOf(REPEAT_HEAD)).toBeGreaterThan(0)
    expect(prompt.indexOf(REPEAT_HEAD)).toBeLessThan(prompt.indexOf(FACTS))
    expect(prompt.endsWith(FACTS)).toBe(true)
  })
})

describe('runPdpCopywriting — 흐름 고칠 곳(flowFix, P1-1b)', () => {
  const FLOW_HEAD = '## [흐름 — 고칠 곳(결정론 검사)]'

  it('flowFix면 기존 반복 블록 대신 흐름 블록이 그 자리에 간다 — 첫 화면과 마지막 띠는 한 곳으로 센다', async () => {
    await run({ checkRepeats: true, flowFix: true, factsBlock: FACTS })
    const prompt = promptOf('stage3')
    expect(prompt).toContain(FLOW_HEAD)
    expect(prompt).not.toContain(REPEAT_HEAD)
    expect(prompt).toContain(
      "- 되풀이 문구: '손가락 대신' — compareSummary·directionHint·eventBundleCopy·keyMessageCopy·keyMessageVariations·mainIntro·soldOutBanner·solution·summary"
    )
    expect(prompt.indexOf(FLOW_HEAD)).toBeLessThan(prompt.indexOf(FACTS))
    expect(prompt.endsWith(FACTS)).toBe(true)
    expect(promptOf('stage1')).not.toContain(FLOW_HEAD)
    expect(promptOf('stage2')).not.toContain(FLOW_HEAD)
  })

  it('flowFix가 없으면 Stage 3에 흐름 블록이 없다(스위치가 꺼진 잡은 지금 그대로)', async () => {
    await run({ checkRepeats: true })
    expect(promptOf('stage3')).not.toContain(FLOW_HEAD)
    expect(promptOf('stage3')).toContain(REPEAT_HEAD)
  })

  it('흐름 검사가 예상 밖 카피 모양(배열이 아닌 공감 줄)으로 던지면 경고를 남기고 기존 반복 블록으로 되돌아간다', async () => {
    h.extra = { problem: { empathyLines: '배열이 아닌 공감 줄' } }
    const out = await run({ checkRepeats: true, flowFix: true })
    expect(out.success).toBe(true)
    expect(promptOf('stage3')).not.toContain(FLOW_HEAD)
    expect(promptOf('stage3')).toContain(REPEAT_HEAD)
    expect(out.success && out.data.warnings.some((w) => w.startsWith('[CopyFlow] 흐름 검사를 하지 못해 기존 반복 블록으로 대신함'))).toBe(true)
  })
})

describe('runPdpCopywriting — 카피 리듬(rhythm, 오너 지시 10-31)', () => {
  const WRITE_HEAD = '## [리듬 — 짧은 문장·의미 단위 줄바꿈]'
  const FIX_HEAD = '## [리듬 — 고칠 곳(결정론 검사)]'
  const LONG = '손가락 대신 쓰는 실리콘 샴푸 브러쉬로 두피를 시원하게'

  it('rhythm이면 Stage 2에 쓰기 지시, Stage 3에 Stage 2 산출의 고칠 곳 — 둘 다 사실 값 블록보다 앞', async () => {
    h.extra = { directionHint: { headline: LONG } }
    await run({ rhythm: true, checkRepeats: true, factsBlock: FACTS })
    const stage2 = promptOf('stage2')
    expect(stage2).toContain(WRITE_HEAD)
    expect(stage2.indexOf(WRITE_HEAD)).toBeLessThan(stage2.indexOf(FACTS))
    const stage3 = promptOf('stage3')
    expect(stage3).toContain(FIX_HEAD)
    expect(stage3).toContain(`- 긴 제목: [directionHint.headline] '${LONG}'`)
    expect(stage3.indexOf(REPEAT_HEAD)).toBeLessThan(stage3.indexOf(FIX_HEAD))
    expect(stage3.endsWith(FACTS)).toBe(true)
    expect(promptOf('stage1')).not.toContain(WRITE_HEAD)
  })

  it('rhythm이 없으면 Stage 2·3 어디에도 리듬 블록이 없다(스위치가 꺼진 잡은 지금 그대로)', async () => {
    h.extra = { directionHint: { headline: LONG } }
    await run({ checkRepeats: true })
    for (const stage of ['stage1', 'stage2', 'stage3']) {
      expect(promptOf(stage)).not.toContain(WRITE_HEAD)
      expect(promptOf(stage)).not.toContain(FIX_HEAD)
    }
  })
})

describe('runPdpCopywriting — 첫 화면 글 줄이기(hookshort, 오너 지시 11-01)', () => {
  const WRITE_HEAD = '## [첫 화면 글 줄이기 — 1~3초 안에 읽히게]'
  const FIX_HEAD = '## [첫 화면 글 — 고칠 곳(결정론 검사)]'
  const LONG = '은은하게 비치는 반투명 소재로 포장까지 예쁘게'

  it('켜면 Stage 2에 쓰기 지시, Stage 3에 넘친 칸 — 둘 다 사실 값 블록보다 앞', async () => {
    h.extra = { mainIntro: { subBenefit: LONG } }
    await run({ hookShort: true, factsBlock: FACTS })
    const stage2 = promptOf('stage2')
    expect(stage2).toContain(WRITE_HEAD)
    expect(stage2.indexOf(WRITE_HEAD)).toBeLessThan(stage2.indexOf(FACTS))
    const stage3 = promptOf('stage3')
    expect(stage3).toContain(FIX_HEAD)
    expect(stage3).toContain('[mainIntro.subBenefit]')
    expect(stage3.endsWith(FACTS)).toBe(true)
    expect(promptOf('stage1')).not.toContain(WRITE_HEAD)
  })

  it('리듬과 함께 켜면 두 쓰기 지시가 다 있고, 첫 화면 칸은 리듬 고칠 곳에 나오지 않는다', async () => {
    h.extra = { mainIntro: { benefitHeadline: '가나다라마바사아자차카타파하가나다' } }
    await run({ hookShort: true, rhythm: true })
    expect(promptOf('stage2')).toContain('## [리듬 — 짧은 문장·의미 단위 줄바꿈]')
    expect(promptOf('stage2')).toContain(WRITE_HEAD)
    const stage3 = promptOf('stage3')
    expect(stage3).toContain('[mainIntro.benefitHeadline]')
    expect(stage3).not.toContain('- 긴 제목: [mainIntro.benefitHeadline]')
  })

  it('끄면 Stage 2·3 어디에도 블록이 없다(스위치가 꺼진 잡은 지금 그대로)', async () => {
    h.extra = { mainIntro: { subBenefit: LONG } }
    await run({})
    for (const stage of ['stage1', 'stage2', 'stage3']) {
      expect(promptOf(stage)).not.toContain(WRITE_HEAD)
      expect(promptOf(stage)).not.toContain(FIX_HEAD)
    }
  })
})

describe("runPdpCopywriting — Track S '실제 구매 후기' 발췌(P1-6 커밋 B)", () => {
  // 60자를 넘는 본문 — 요약을 끄면 예전처럼 60자에서 잘리고, 켜면 자르지 않고 원문 문장 1~2개로 다시 고른다
  const BODY =
    '배송 빨리 왔어요. 손잡이가 편해서 매일 들고 다녀요. 거품도 잘 나고 머리 감을 때 손이 덜 아파서 아침마다 써요.'
  const serialized = (body: string) =>
    [
      '리뷰 전체: 1건 (텍스트 리뷰 1건)',
      '표집: 1건 (평점 분포 유지, 구체적인 긴 리뷰 우선)',
      '[리뷰1] 평점 5/5 · 도움 3 · 작성 2026.10 · 작성자 김**',
      `내용: ${body}`,
    ].join('\n')

  it('LLM 발췌를 자르지 않고 원문 문장 1~2개로 — 출처 리뷰의 원본 평점·작성 월·가린 작성자, 후기 요약·원문', async () => {
    expect(BODY.length).toBeGreaterThan(60)
    h.extra = { reviewHighlights: [{ text: BODY }] }
    const result = await run({ specSheet: { ...h.job.spec_sheet, reviewsText: serialized(BODY) } })
    if (!result.success) throw new Error('copy failed')
    expect(result.data.final.reviewHighlights).toEqual([
      {
        text: '손잡이가 편해서 매일 들고 다녀요. 거품도 잘 나고 머리 감을 때 손이 덜 아파서 아침마다 써요.',
        author: '김**',
        rating: 5,
        month: '2026.10',
        summary: true,
        original: BODY,
      },
    ])
  })

  it('요약을 로컬에서 끄면(대조군) 예전처럼 60자 발췌 — 원본 평점·작성 월·가린 작성자는 붙인다', async () => {
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('VERCEL_ENV', '')
    vi.stubEnv('NEXOPS_PDP_REVIEW_SUMMARY', 'off')
    try {
      h.extra = { reviewHighlights: [{ text: BODY }] }
      const result = await run({ specSheet: { ...h.job.spec_sheet, reviewsText: serialized(BODY) } })
      if (!result.success) throw new Error('copy failed')
      expect(result.data.final.reviewHighlights).toEqual([
        { text: BODY.slice(0, 60), author: '김**', rating: 5, month: '2026.10' },
      ])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('검증은 통과했지만 요약에서 모두 빠지면 원문 결정적 폴백으로 다시 고른다', async () => {
    const body = '선물로 샀는데 다들 좋아해요. 손잡이가 편해서 매일 들고 다녀요.'
    h.extra = { reviewHighlights: [{ text: '선물로 샀는데 다들 좋아해요.' }] }
    const result = await run({ specSheet: { ...h.job.spec_sheet, reviewsText: serialized(body) } })
    if (!result.success) throw new Error('copy failed')
    expect(result.data.final.reviewHighlights).toEqual([
      {
        text: '손잡이가 편해서 매일 들고 다녀요.',
        author: '김**',
        rating: 5,
        month: '2026.10',
        summary: true,
        original: body,
      },
    ])
    expect(result.data.warnings).toContain('[Copywriting] reviewHighlights LLM 후보 전멸 — 원문 결정적 폴백 발췌로 대체')
    expect(result.data.warnings).toContain(
      '[Copywriting] 후기 발췌 1건은 70자 안에 들어오는 요약 문장(경험 문장·인용 안전)이 없어 뺐습니다'
    )
  })
})

describe('runPdpCopywriting — 자동 발췌는 별점 3점 이하를 싣지 않고, 오너가 고른 카드는 그대로다(R17 P06, 시험 글은 지어낸 것)', () => {
  const reviewsText = [
    '리뷰 전체: 3건 (텍스트 리뷰 3건)',
    '[리뷰1] 평점 3/5 · 도움 9',
    '내용: 손잡이가 좀 불편했어요.',
    '[리뷰2] 평점 5/5 · 도움 0',
    '내용: 거품이 잘 나서 매일 써요.',
    '[리뷰3] 평점 5/5 · 도움 0',
    '내용: 색이 사진과 같아서 좋아요.',
  ].join('\n')
  const low = { id: 'low', text: '손잡이가 좀 불편했어요.', rating: 3 }
  const good = { id: 'good', text: '거품이 잘 나서 매일 써요.', rating: 5 }

  it('오너가 고른 3점 카드는 그대로 싣고 별점 경고도 남기지 않는다', async () => {
    const result = await run({ specSheet: { ...h.job.spec_sheet, reviewsText, reviewQuotes: [good, low] } })
    if (!result.success) throw new Error('copy failed')
    expect(result.data.final.reviewHighlights).toEqual([
      { text: good.text, author: '구매고객', rating: 5 },
      { text: low.text, author: '구매고객', rating: 3 },
    ])
    expect(result.data.warnings.filter((w) => w.includes('별점'))).toEqual([])
  })

  it('고른 카드가 없으면 모델 발췌에서 낮은 후기를 빼고 경고를 남긴다', async () => {
    h.extra = { reviewHighlights: [{ text: low.text }, { text: good.text }] }
    const result = await run({ specSheet: { ...h.job.spec_sheet, reviewsText } })
    if (!result.success) throw new Error('copy failed')
    expect(result.data.final.reviewHighlights).toEqual([{ text: good.text, author: '구매고객', rating: 5 }])
    expect(result.data.warnings).toContain('[Copywriting] 후기 발췌 1건은 별점 3점 이하 후기라 뺐습니다')
  })

  it('모델 후보가 낮은 후기로만 채워지면 4점 이상 폴백으로 다시 고른다', async () => {
    h.extra = { reviewHighlights: [{ text: low.text }] }
    const result = await run({ specSheet: { ...h.job.spec_sheet, reviewsText } })
    if (!result.success) throw new Error('copy failed')
    const ratings = (result.data.final.reviewHighlights ?? []).map((r) => r.rating)
    expect(ratings).toEqual([5, 5])
    expect(result.data.warnings).toContain('[Copywriting] reviewHighlights LLM 후보 전멸 — 원문 결정적 폴백 발췌로 대체')
  })

  it('낮은 후보 몫은 다음 후보가 잇는다 — 뺀 뒤 상한 3건을 센다', async () => {
    const more = [reviewsText, '[리뷰4] 평점 5/5 · 도움 0', '내용: 뚜껑이 꼭 맞아서 좋아요.'].join('\n')
    const texts = ['거품이 잘 나서 매일 써요.', '색이 사진과 같아서 좋아요.', '뚜껑이 꼭 맞아서 좋아요.']
    h.extra = { reviewHighlights: [{ text: low.text }, ...texts.map((text) => ({ text }))] }
    const result = await run({ specSheet: { ...h.job.spec_sheet, reviewsText: more } })
    if (!result.success) throw new Error('copy failed')
    expect((result.data.final.reviewHighlights ?? []).map((r) => r.text)).toEqual(texts)
    expect(result.data.warnings).toContain('[Copywriting] 후기 발췌 1건은 별점 3점 이하 후기라 뺐습니다')
  })
})

describe('runPdpCopywriting — 인용 카드(W2b)', () => {
  const card = (id: string, text: string, rating: number, over: Record<string, unknown> = {}) => ({
    id,
    text,
    rating,
    ...over,
  })

  it('인용 카드가 있으면 후기 인용은 그 카드 글만 — 평점·강조 그대로(옵션명은 넘기지 않음), 인용 금지 표현·정화 표지 카드는 빼고 경고(요약 기본 on — 이미 한 문장인 글은 원문 그대로)', async () => {
    const result = await run({
      specSheet: {
        ...h.job.spec_sheet,
        reviewQuotes: [
          card('a', '머리 감을 때 손이 덜 아파요', 4, { option: '블랙', highlights: ['손이 덜 아파요'] }),
          card('b', '두피 치료에 최고예요', 5),
          card('c', '거품이 잘 나요', 5),
          card('d', '문의는 (연락처 삭제)로 했어요', 5),
        ],
      },
    })
    if (!result.success) throw new Error('copy failed')
    expect(result.data.final.reviewHighlights).toEqual([
      { text: '머리 감을 때 손이 덜 아파요', author: '구매고객', rating: 4, highlights: ['손이 덜 아파요'] },
      { text: '거품이 잘 나요', author: '구매고객', rating: 5 },
    ])
    expect(result.data.warnings).toContain(
      '[Copywriting] 인용 카드 2장은 인용 금지 표현(인증·인허가·의학·기능성·최상급·대가성)이나 정화 표지가 있어 뺐습니다'
    )
  })

  it('후기 요약(P1-6) — 긴 카드는 원문 문장 1~2개로, 가린 작성자·작성 월은 넘기고, 요약 문장이 없는 카드는 빼고 경고', async () => {
    const long = '배송 빨리 왔어요. 머리 감을 때 손이 덜 아파요. 거품도 잘 나요.'
    const result = await run({
      specSheet: {
        ...h.job.spec_sheet,
        reviewQuotes: [
          card('a', long, 5, { author: '김**', month: '2026.10' }),
          card('b', `손잡이가 ${'아주 '.repeat(30)}편해요`, 5),
        ],
      },
    })
    if (!result.success) throw new Error('copy failed')
    expect(result.data.final.reviewHighlights).toEqual([
      {
        text: '머리 감을 때 손이 덜 아파요. 거품도 잘 나요.',
        author: '김**',
        rating: 5,
        month: '2026.10',
        summary: true,
        original: long,
      },
    ])
    expect(result.data.warnings).toContain(
      '[Copywriting] 인용 카드 1장은 70자 안에 들어오는 요약 문장(경험 문장·인용 안전)이 없어 뺐습니다'
    )
  })

  it('요약 표시를 로컬에서 끄면(짝 회차 대조군) 카드 글 그대로', async () => {
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('VERCEL_ENV', '')
    vi.stubEnv('NEXOPS_PDP_REVIEW_SUMMARY', 'off')
    try {
      const long = '배송 빨리 왔어요. 머리 감을 때 손이 덜 아파요.'
      const result = await run({ specSheet: { ...h.job.spec_sheet, reviewQuotes: [card('a', long, 5)] } })
      if (!result.success) throw new Error('copy failed')
      expect(result.data.final.reviewHighlights).toEqual([{ text: long, author: '구매고객', rating: 5 }])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('카드가 모두 빠지면 기존 경로(리뷰 원문 대조)로 돌아간다', async () => {
    const result = await run({
      specSheet: { ...h.job.spec_sheet, reviewsText: '', reviewQuotes: [card('b', '두피 치료에 최고예요', 5)] },
    })
    if (!result.success) throw new Error('copy failed')
    expect(result.data.final.reviewHighlights).toEqual([])
  })
})

describe('runPdpCopywriting — 카피 규칙을 Stage 3에(P1-1a, 모든 잡)', () => {
  const RULE_HEAD = '## [카피 규칙 — 고칠 곳(결정론 검사)]'
  const GUIDE_CTA = { closingCta: { headline: '밥그릇·물그릇, 두 칸을 살펴보세요', subtext: '' } }

  it('Stage 2 산출의 안내형 끝말·첫 화면에 없는 종류 낱말을 Stage 3 고칠 곳으로 넣는다(기록 잡이 아니어도, Stage 1·2에는 없다)', async () => {
    h.extra = GUIDE_CTA
    await run()
    const stage3 = promptOf('stage3')
    expect(stage3).toContain(RULE_HEAD)
    expect(stage3).toContain('- [closingCta.headline] "밥그릇·물그릇, 두 칸을 살펴보세요"')
    expect(stage3).toContain("상품 종류 낱말 '꽃가루' 또는 '폭죽'이(가) 없다")
    expect(promptOf('stage1')).not.toContain(RULE_HEAD)
    expect(promptOf('stage2')).not.toContain(RULE_HEAD)
  })

  it('걸린 것이 없으면 Stage 3 프롬프트에 규칙 블록이 없다', async () => {
    const intro = h.job.copy_sections.final!.mainIntro
    h.extra = { mainIntro: { ...intro, productType: '폭죽', subBenefit: '폭죽 하나로 축하 끝' } }
    await run()
    expect(promptOf('stage3')).not.toContain(RULE_HEAD)
  })

  it('반복 블록 뒤, 사실 값 블록 앞(사실 값이 늘 맨 끝)', async () => {
    h.extra = GUIDE_CTA
    await run({ checkRepeats: true, factsBlock: FACTS })
    const prompt = promptOf('stage3')
    expect(prompt.indexOf(REPEAT_HEAD)).toBeGreaterThan(0)
    expect(prompt.indexOf(REPEAT_HEAD)).toBeLessThan(prompt.indexOf(RULE_HEAD))
    expect(prompt.indexOf(RULE_HEAD)).toBeLessThan(prompt.indexOf(FACTS))
    expect(prompt.endsWith(FACTS)).toBe(true)
  })
})

describe('runPdpCopywriting — 디자인 컷 카피 규칙(designRules, 적용 T1-16 D·T1-45 D)', () => {
  const WRITE_HEAD = '## [첫 화면과 고민-POINT 짝]'

  it('켜면 Stage 2에 쓰기 지시가 사실 값 블록보다 앞에 든다', async () => {
    await run({ designRules: true, factsBlock: FACTS })
    const stage2 = promptOf('stage2')
    expect(stage2).toContain(WRITE_HEAD)
    expect(stage2).toContain('pointCards 순서는 바꾸지 않고 고민 줄을 고친다')
    expect(stage2).toContain('입력(상품 정보·후기·고민 분석)에 없는 고민을 쓰지 않는다')
    expect(stage2.indexOf(WRITE_HEAD)).toBeLessThan(stage2.indexOf(FACTS))
    expect(promptOf('stage1')).not.toContain(WRITE_HEAD)
    expect(promptOf('stage3')).not.toContain(WRITE_HEAD)
  })

  it('끄면 세 단계 어디에도 블록이 없다(R 잡은 지금 그대로)', async () => {
    await run({})
    for (const stage of ['stage1', 'stage2', 'stage3']) expect(promptOf(stage)).not.toContain(WRITE_HEAD)
  })

  it('규칙이 규제 표현 밖의 체감 효익을 막지 않는다', () => {
    expect(DESIGN_COPY_WRITE_BLOCK).toContain('쓰면서 느끼는 효익은 살린다')
    expect(DESIGN_COPY_WRITE_BLOCK).not.toMatch(/효과를? (쓰지|금지)|체감.*(금지|쓰지)/)
  })
})

describe('runPdpCopywriting — 제목 강조 구절(designRules, 적용 T1-17 D)', () => {
  const ACCENT_HEAD = '## [제목 강조 구절]'
  const ACCENTS = { '손가락 대신 시작해요': '시작해요' }

  it('켜면 Stage 2에만 강조 지시가 든다(사실 값 블록보다 앞). 끄면 어디에도 없다', async () => {
    await run({ designRules: true, factsBlock: FACTS })
    const stage2 = promptOf('stage2')
    expect(stage2).toContain(ACCENT_HEAD)
    expect(stage2.indexOf(ACCENT_HEAD)).toBeLessThan(stage2.indexOf(FACTS))
    expect(promptOf('stage1')).not.toContain(ACCENT_HEAD)
    expect(promptOf('stage3')).not.toContain(ACCENT_HEAD)
    h.calls = []
    await run({})
    for (const stage of ['stage1', 'stage2', 'stage3']) expect(promptOf(stage)).not.toContain(ACCENT_HEAD)
  })

  it('Stage 3가 칸을 빼면 Stage 2 값을 이어 최종 카피에 남긴다', async () => {
    h.extra = { headlineAccents: ACCENTS }
    h.stage3Omit = ['headlineAccents']
    const result = await run({ designRules: true })
    if (!result.success) throw new Error('copy failed')
    expect(result.data.final.headlineAccents).toEqual(ACCENTS)
  })

  it('Stage 3가 칸을 그대로 두면 그 값이 남는다(정화 단계를 지난다)', async () => {
    h.extra = { headlineAccents: ACCENTS }
    const result = await run({ designRules: true })
    if (!result.success) throw new Error('copy failed')
    expect(result.data.final.headlineAccents).toEqual(ACCENTS)
  })

  it('끈 잡(R)은 이어 붙이지 않는다 — 카피가 지금 그대로다', async () => {
    h.extra = { headlineAccents: ACCENTS }
    h.stage3Omit = ['headlineAccents']
    const result = await run({})
    if (!result.success) throw new Error('copy failed')
    expect(result.data.final.headlineAccents).toBeUndefined()
  })

  it('지시가 규제 표현 밖의 체감 효익을 막지 않는다', () => {
    expect(DESIGN_ACCENT_WRITE_BLOCK).toContain('고객이 얻는 효익')
    expect(DESIGN_ACCENT_WRITE_BLOCK).not.toMatch(/효과를? (쓰지|금지)|체감.*(금지|쓰지)/)
  })
})
