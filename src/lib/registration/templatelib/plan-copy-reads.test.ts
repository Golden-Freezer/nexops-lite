/**
 * K가 읽는 앞 단계 글(하네스 J28) — pageplan(기획 1장, 결정 카드 c10)·copystory(D 원문 카피, J36). 둘 다 기본 off이고 K 잡에서만 기록한다.
 * 켠 잡만 구성 콜·칸 카피 콜 입력에 기획·원문이 실리고, 꺼진 잡은 입력·프롬프트가 지금과 같다(k-line-run 꺼진 잡 지문·프롬프트 스냅숏이 바이트를 지킨다).
 * AI 콜은 가짜다(유료 0) — 칸 카피 콜은 입력만 받아 두고 멈춘다
 */

import { describe, expect, it } from 'vitest'
import { buildSlotCopyPrompt, type SlotCopyInput, type SlotCopySection } from '@/lib/agents/registration/prompts/pdp-template-copy-prompts'
import { buildComposePrompt, type ComposeInput } from '@/lib/agents/registration/prompts/pdp-template-prompts'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import { ENRICHMENT_DEFAULTS, K4_SWITCHED_ON, resolveEnabledFeatures } from '../enrichment-switch'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import type { CopywritingResult, PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { copyStoryOf, STORY_LINES_MAX } from './copy-story'
import { planTemplateLine, type LinePlanAgents } from './line-plan'
import { pagePlanBriefOf, pagePlanOf, planComposeSteps, planSaysOf, type PagePlanDone } from './page-plan-read'
import { slotCopyReadsOf } from './slot-copy-reads'

const FEATURES = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut', 'designcut2', 'designlayout', 'designlong', 'palette2', 'rhythm', 'flow', 'shotdiv', 'fontpair', 'templatelib']

const PLAN: PagePlanDone = {
  core_promise: '가방 속에서도 접어 두는 빗',
  target: '미니백을 드는 직장인',
  appeals: [{ rank: 1, appeal: '접이식', evidence: '판매자 입력', source: 'spec' }],
  flow: [
    { step: 1, section: 'hook_3step', say: '접으면 손바닥만 해진다', appeals: [1] },
    { step: 2, section: 'problem_empathy', say: '큰 빗은 가방에 안 들어간다', appeals: [1] },
    { step: 3, section: 'point_div', say: '첫째 장점 — 접는 구조', appeals: [1] },
    { step: 4, section: 'point_div', say: '둘째 장점 — 두 개 구성', appeals: [1] },
    { step: 5, section: 'not_a_section', say: '목록 밖', appeals: [1] },
    { step: 6, section: 'cta', say: '가방에 하나 넣어 두세요', appeals: [1] },
  ],
  hook: { promise: '접어서 쏙', hero_moment: '손바닥 위 접힌 빗' },
  cta: '지금 담기',
  dropped: [],
  risks: [],
}
const done = (result: PagePlanDone) => ({ version: 1, stage: 'plan', status: 'done', route: { name: 'x', model: 'x', effort: null, maxTokens: 1, backend: 'api' }, result, warnings: [], costUsd: 0, durationMs: 0 })

function jobOf(extra: string[], research?: Record<string, unknown>): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  job.analysis = { ...job.analysis, enrichment: { version: 1, features: [...FEATURES, ...extra] } } as PdpJobRow['analysis']
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  return { ...job, cost_pool: 'test', research_result: { ...job.research_result, ...(research ?? {}) }, section_images: [], final_html: null, current_step: 'images' } as PdpJobRow
}

const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
/** 구성 콜·칸 카피 콜 입력을 받아 두고 칸 카피에서 멈춘다 */
async function callsOf(job: PdpJobRow): Promise<{ compose: ComposeInput; slots: SlotCopyInput }> {
  const seen: { compose?: ComposeInput; slots?: SlotCopyInput } = {}
  const agents: LinePlanAgents = {
    guideline: async ({ concepts }) => free({ persona: '', tone: '', concept: { id: concepts[0].id, reason: '' }, alternatives: [] }),
    compose: async (input) => {
      seen.compose = input
      return free([])
    },
    select: async ({ slots }) => free(slots.map((slot) => ({ index: slot.index, templateId: slot.candidates[0].id, reason: '' }))),
    fillSlots: async (input) => {
      seen.slots = input
      throw new Error('STOP')
    },
  }
  await expect(planTemplateLine(job, agents)).rejects.toThrow('STOP')
  return { compose: seen.compose!, slots: seen.slots! }
}

describe('스위치 pageplan·copystory — 기본 off, K 잡에서만', () => {
  it.each(['pageplan', 'copystory'] as const)('%s: 기본 off·K4_SWITCHED_ON 밖 — 운영(Vercel·작업자)은 EXTRA를 무시하고, 로컬 EXTRA로 K 잡에서만 기록한다', (name) => {
    expect(ENRICHMENT_DEFAULTS[name]).toBe(false)
    expect(K4_SWITCHED_ON).not.toContain(name)
    expect(resolveEnabledFeatures({})).not.toContain(name)
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_EXTRA: name })).not.toContain(name)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_HOSTED: 'railway-worker', NEXOPS_PDP_ENRICHMENT_EXTRA: name })).not.toContain(name)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: name })).toContain(name)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: name, NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).not.toContain(name)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: name, NEXOPS_PDP_ENRICHMENT_SKIP: 'designcut' })).not.toContain(name)
  })

  it('켜도 다른 기능 목록은 그대로다 — 켠 이름만 더해진다', () => {
    const on = resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'pageplan,copystory' })
    expect(on.filter((f) => f !== 'pageplan' && f !== 'copystory')).toEqual(resolveEnabledFeatures({}))
  })
})

describe('기획 1장 읽기(page-plan-read)', () => {
  it('끝난 기획만 읽는다 — 없음·실패·건너뜀은 null', () => {
    expect(pagePlanOf({ page_plan: done(PLAN) } as never)).toEqual(PLAN)
    expect(pagePlanOf({})).toBeNull()
    expect(pagePlanOf({ page_plan: { version: 1, stage: 'plan', status: 'failed', failure: { kind: 'parse', message: 'x' } } } as never)).toBeNull()
    expect(pagePlanOf({ page_plan: { version: 1, stage: 'plan', status: 'skipped', reason: 'x' } } as never)).toBeNull()
    expect(pagePlanBriefOf(null)).toBeNull()
    expect(pagePlanBriefOf({ ...PLAN, core_promise: ' ', flow: [] })).toBeNull()
  })

  it('요약 — 글은 그대로, 긴 줄은 자르고 빈 단계는 뺀다', () => {
    const brief = pagePlanBriefOf({ ...PLAN, core_promise: `${'가'.repeat(200)}`, flow: [...PLAN.flow, { step: 7, section: '', say: '빈 섹션', appeals: [1] }] })!
    expect(brief.promise.length).toBeLessThanOrEqual(120)
    expect(brief.hookPromise).toBe('접어서 쏙')
    expect(brief.steps.map((s) => s.section)).toEqual(['hook_3step', 'problem_empathy', 'point_div', 'point_div', 'not_a_section', 'cta'])
  })

  it('구성 콜에는 고를 수 있는 섹션의 단계만, 칸 카피에는 놓인 섹션마다 나온 차례대로 짝짓는다', () => {
    const brief = pagePlanBriefOf(PLAN)!
    expect(planComposeSteps(brief, ['hook_3step', 'point_div', 'cta']).map((s) => s.say)).toEqual(['접으면 손바닥만 해진다', '첫째 장점 — 접는 구조', '둘째 장점 — 두 개 구성', '가방에 하나 넣어 두세요'])
    const says = planSaysOf(brief, [{ section: 'hook_3step' }, { section: 'main_cut' }, { section: 'point_div' }, { section: 'point_div' }, { section: 'point_div' }, { section: 'cta' }])
    expect(says).toEqual({ 0: '접으면 손바닥만 해진다', 2: '첫째 장점 — 접는 구조', 3: '둘째 장점 — 두 개 구성', 5: '가방에 하나 넣어 두세요' })
  })
})

describe('원문 카피 줄(copy-story)', () => {
  const FINAL: CopywritingResult = {
    mainIntro: { hook: '미니백 하나 들고\n나서는 길', benefitHeadline: '접으면 손바닥에 쏙', subBenefit: '펼쳐서 빗고 다시 접어요', brandAndName: '브랜드 · 상품명' },
    problem: { question: '손으로만 넘기세요?', empathy: '큰 빗은 가방에 안 들어가요', empathyLines: ['하나', '둘', '셋', '넷', '다섯'] },
    solution: { declaration: '그 자리에서 펼쳐 빗어요', summary: '다 쓰면 접어 넣어요' },
    detailPoints: [
      { claim: '접어서 쏙', proof: 'ABS 손잡이 구조', benefit: '자리 고민 없어요' },
      { claim: '두 개 구성', proof: '옵션 2개', benefit: '집과 가방에 하나씩' },
    ],
    howTo: [{ step: '펼쳐요', description: '손잡이를 펼쳐요' }],
    closingCta: { headline: '가방에 쏙 넣고', subtext: '필요한 수량을 골라요' },
    reviewHighlights: [{ text: '후기 인용' }],
    compareItems: [{ name: '기존 제품', pros: '비교 글' }],
    compareSummary: '비교 요약',
    summary: '중국산이라 가벼운 빗',
  }

  it('섹션마다 맞는 원문 줄 — point_div는 차례대로 detailPoints, 사실 근거·브랜드·후기·비교 줄은 싣지 않는다', () => {
    const story = copyStoryOf(FINAL, [{ section: 'hook_3step' }, { section: 'problem_empathy' }, { section: 'point_div' }, { section: 'point_div' }, { section: 'review' }, { section: 'compare' }, { section: 'cta' }])
    expect(story[0]).toEqual(['미니백 하나 들고 나서는 길', '접으면 손바닥에 쏙', '펼쳐서 빗고 다시 접어요'])
    expect(story[1]).toHaveLength(STORY_LINES_MAX)
    expect(story[2]).toEqual(['접어서 쏙 — 자리 고민 없어요'])
    expect(story[3]).toEqual(['두 개 구성 — 집과 가방에 하나씩'])
    expect(story[4]).toBeUndefined()
    expect(story[5]).toBeUndefined()
    expect(story[6]).toEqual(['가방에 쏙 넣고', '필요한 수량을 골라요'])
    const all = JSON.stringify(story)
    for (const word of ['ABS', '브랜드', '후기 인용', '비교']) expect(all).not.toContain(word)
  })

  it('앞 섹션에 실은 원문 줄은 뒤 섹션에 다시 싣지 않는다 — 첫 화면·대표 컷, 고민 꺼내기·공감', () => {
    const story = copyStoryOf(FINAL, [{ section: 'hook_3step' }, { section: 'main_cut' }, { section: 'problem_raise' }, { section: 'problem_empathy' }])
    expect(story[1]).toBeUndefined()
    expect(story[2]).toEqual(['손으로만 넘기세요?', '큰 빗은 가방에 안 들어가요'])
    expect(story[3]).toEqual(['하나', '둘', '셋', '넷'])
    const lines = Object.values(story).flat()
    expect(new Set(lines).size).toBe(lines.length)
  })

  it('원산지를 말하는 줄은 뺀다(원산지는 상품 정보 표에만)', () => {
    expect(copyStoryOf(FINAL, [{ section: 'key_message' }], '중국')[0]).toBeUndefined()
    expect(copyStoryOf(FINAL, [{ section: 'key_message' }])[0]).toEqual(['중국산이라 가벼운 빗'])
    expect(copyStoryOf(null, [{ section: 'hook_3step' }])).toEqual({})
  })

  it('slotCopyReadsOf — 꺼진 잡은 빈 객체, 켠 잡만 칸이 생긴다', () => {
    const sections = [{ section: 'hook_3step' }, { section: 'cta' }]
    const job = (features: string[]) => ({ analysis: { enrichment: { version: 1, features } }, copy_sections: { final: FINAL } }) as unknown as PdpJobRow
    expect(slotCopyReadsOf(job([]), { spec: {} }, sections)).toEqual({})
    expect(Object.keys(slotCopyReadsOf(job(['copystory']), { spec: {} }, sections))).toEqual(['copyStory'])
    const both = slotCopyReadsOf(job(['copystory']), { spec: {}, pagePlan: pagePlanBriefOf(PLAN)! }, sections)
    expect(both.pagePlan).toEqual({ promise: PLAN.core_promise, target: PLAN.target, hookPromise: '접어서 쏙', says: { 0: '접으면 손바닥만 해진다', 1: '가방에 하나 넣어 두세요' } })
  })
})

describe('프롬프트 — 칸이 없으면 지금 글자 그대로', () => {
  const section: SlotCopySection = { index: 0, section: 'hook_3step', factSlots: 1, slots: [{ name: 'headline', required: true, facts: 1, maxChars: 12, maxLines: 2 }] }
  const base: SlotCopyInput = {
    product: { category: 'household', persona: null, summary: '', keywords: [], usps: [], pains: [] },
    guideline: { persona: '', tone: '' },
    facts: ['접이식'],
    sections: [section],
  }

  it('칸 카피 — 빈 기획·빈 원문은 바이트가 같고, 켠 칸은 블록과 섹션 줄이 붙는다', () => {
    const plain = buildSlotCopyPrompt(base)
    expect(buildSlotCopyPrompt({ ...base, copyStory: {} })).toBe(plain)
    expect(buildSlotCopyPrompt({ ...base, pagePlan: { promise: '', target: '', hookPromise: '', says: {} } })).toBe(plain)
    const on = buildSlotCopyPrompt({ ...base, pagePlan: { promise: '접어 두는 빗', target: '', hookPromise: '접어서 쏙', says: { 0: '손바닥만 해진다' } }, copyStory: { 0: ['미니백 하나 들고 나서는 길'] } })
    expect(on).toContain('## 기획 1장')
    expect(on).toContain('- 핵심 약속: 접어 두는 빗')
    expect(on).toContain('- 첫 화면 약속: 접어서 쏙')
    expect(on).not.toContain('- 고객·상황:')
    expect(on).toContain('## 원문 카피')
    expect(on).toContain('\n  기획: 손바닥만 해진다\n  원문: 미니백 하나 들고 나서는 길')
    expect(on.replace(/\n\n## 기획 1장[\s\S]*?(?=\n\n## 실을)/, '').replace(/\n  (기획|원문): [^\n]*/g, '')).toBe(plain)
  })

  it('구성 콜 — 빈 순서는 바이트가 같고, 켠 칸은 설득 순서 블록이 붙는다', () => {
    const compose: ComposeInput = { product: base.product, guideline: base.guideline, open: ['hook_3step', 'cta'], facts: { count: 3, places: 4 }, range: { min: 8, max: 12 } }
    const plain = buildComposePrompt(compose)
    expect(buildComposePrompt({ ...compose, plan: [] })).toBe(plain)
    const on = buildComposePrompt({ ...compose, plan: [{ section: 'hook_3step', say: '접으면 손바닥만 해진다' }] })
    expect(on).toContain('## 기획 1장 설득 순서')
    expect(on).toContain('1. hook_3step: 접으면 손바닥만 해진다')
    expect(on.replace(/\n\n## 기획 1장 설득 순서[^\n]*\n1\. [^\n]*/, '')).toBe(plain)
  })
})

describe('K 계획 — 켠 잡만 구성·칸 카피 콜 입력이 달라진다', () => {
  const research = { page_plan: done(PLAN) }

  it('꺼진 잡: 기획이 있어도 구성·칸 카피 입력에 기획·원문 칸이 없다', async () => {
    const off = await callsOf(jobOf([], research))
    expect(off.compose).not.toHaveProperty('plan')
    expect(off.slots).not.toHaveProperty('pagePlan')
    expect(off.slots).not.toHaveProperty('copyStory')
  })

  it('pageplan 잡: 기획이 끝났을 때만 구성 콜에 설득 순서, 칸 카피에 약속·섹션 할 말', async () => {
    const on = await callsOf(jobOf(['pageplan'], research))
    expect(on.compose.plan!.length).toBeGreaterThan(0)
    for (const step of on.compose.plan!) expect(on.compose.open).toContain(step.section)
    expect(on.slots.pagePlan).toMatchObject({ promise: PLAN.core_promise, hookPromise: '접어서 쏙' })
    expect(on.slots.pagePlan!.says[0]).toBe('접으면 손바닥만 해진다')
    expect(on.slots).not.toHaveProperty('copyStory')
    const noPlan = await callsOf(jobOf(['pageplan']))
    expect(noPlan.compose).not.toHaveProperty('plan')
    expect(noPlan.slots).not.toHaveProperty('pagePlan')
  })

  it('copystory 잡: 칸 카피에 섹션마다 원문 줄(첫 화면 포함), 구성 콜은 그대로', async () => {
    const on = await callsOf(jobOf(['copystory']))
    expect(on.compose).not.toHaveProperty('plan')
    const story = on.slots.copyStory!
    expect(Object.keys(story).length).toBeGreaterThan(0)
    expect(story[0]?.length).toBeGreaterThan(0)
    for (const lines of Object.values(story)) expect(lines.length).toBeLessThanOrEqual(STORY_LINES_MAX)
    const prompt = buildSlotCopyPrompt(on.slots)
    expect(prompt).toContain('## 원문 카피')
    expect(prompt).toContain('\n  원문: ')
  })
})
