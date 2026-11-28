/**
 * 카피 단계 사실 값·반복 기록(pdp-copy-facts-r4) — 등록 옵션 구조가 있는 잡은 사실 값 블록을 카피 입력에 넣고 최종 카피의 축 개수
 * 오기를 고쳐 copy_sections.fact_corrections에 남긴다. 플래너 기록 잡은 반복 검사를 켜고 최종 반복을 repeat_findings에 남긴다.
 * 둘 다 해당하지 않는 잡은 지금 그대로다. 카피 에이전트·DB는 모의(유료 호출 0), 기록 잡 판정(recordedCopyInputs)도 모의.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OptionSpec } from './options/option-spec'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  final: null as Record<string, unknown> | null,
  recorded: null as Record<string, unknown> | null,
  /** 카피 콜마다 꺼내 쓰는 첫 화면 부제(마지막 것을 반복) */
  subBenefits: [] as string[],
  copyCalls: [] as Array<Record<string, unknown>>,
  patches: [] as Array<Record<string, unknown>>,
  /** 카피 결과에 싣는 Stage 2 산출(pro, 흐름 수 before) — 없으면 싣지 않는다 */
  stage2: null as Record<string, unknown> | null,
  /** 카피 결과에 싣는 Stage 3 결과 기록 — 없으면 싣지 않는다 */
  stage3: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/agents/budget', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: vi.fn(async () => ({ allowed: true, spentUsd: 0, budgetUsd: 1000 })),
}))
vi.mock('./pdp-jobs', async (orig) => ({
  isPdpJobLeased: (await orig<typeof import('./pdp-jobs')>()).isPdpJobLeased,
  PdpLeaseLostError: (await orig<typeof import('./pdp-jobs')>()).PdpLeaseLostError,
  getPdpJob: vi.fn(async () => h.job),
  claimPdpJobRun: vi.fn(async (_db: unknown, _u: string, job: PdpJobRow) => ({
    job,
    leaseUntil: new Date(Date.now() + 340_000).toISOString(),
  })),
  updatePdpJob: vi.fn(async (_db: unknown, _u: string, _id: string, patch: Record<string, unknown>) => {
    h.patches.push(patch)
    return h.job
  }),
}))
vi.mock('./pdp-enrichment-stage', async (orig) => ({
  ...(await orig<typeof import('./pdp-enrichment-stage')>()),
  recordedCopyInputs: () => h.recorded,
}))
vi.mock('@/lib/agents/registration/pdp-copy-agent', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/registration/pdp-copy-agent')>()),
  runPdpCopywriting: vi.fn(async (input: Record<string, unknown>) => {
    h.copyCalls.push(input)
    const final = h.final as { mainIntro?: Record<string, unknown> }
    const subBenefit = h.subBenefits.length > 1 ? h.subBenefits.shift()! : h.subBenefits[0]
    return {
      success: true,
      data: {
        // R4 P01처럼 번호 최댓값 07을 개수로 읽은 카피 — 네 섹션에 되풀이
        final: {
          ...final,
          mainIntro: { ...final.mainIntro, subBenefit },
          solution: { summary: '7가지 디자인 골라 붙이기' },
          summary: '7가지 디자인 원형 스티커',
          recommendedTargets: ['7가지 디자인 원하는 분'],
        },
        warnings: [],
        ...(h.stage2 ? { stage2: h.stage2 } : {}),
        ...(h.stage3 ? { stage3: h.stage3 } : {}),
      },
      usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
      duration: 0,
    }
  }),
}))

import { runPdpStep } from './pdp-pipeline'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'

const DESIGNS = ['생일답례-01', '생일답례-02', '생일답례-03', '생일답례-04', '생일답례-05', '생일답례-07']
const P01_SPEC: OptionSpec = {
  axes: [
    { kind: 'quantity', name: '수량', values: ['20개', '30개', '50개'] },
    { kind: 'design', name: '디자인', values: DESIGNS },
  ],
  variants: [
    ...DESIGNS.map((d) => ({ label: `20개 ${d}`, values: { quantity: '20개', design: d } })),
    { label: '30개 생일답례-04', values: { quantity: '30개', design: '생일답례-04' } },
    ...DESIGNS.map((d) => ({ label: `50개 ${d}`, values: { quantity: '50개', design: d } })),
  ],
  source: 'products',
}
const RECORDED = {
  factOnlyStrategy: true,
  stage3OwnershipBlock: '## [특징 배정 — 같은 특징을 같은 말로 되풀이하지 않는다]',
}

const saved = () => h.patches.at(-1) as Record<string, unknown>
const savedSections = () => saved().copySections as Record<string, unknown>
const run = () => runPdpStep(h.job!.id, h.job!.user_id)

function setup({
  optionSpec,
  recorded,
  minAge,
  spec: extraSpec,
}: {
  optionSpec?: OptionSpec
  recorded: boolean
  minAge?: number
  spec?: Record<string, unknown>
}) {
  const full = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  h.final = full.copy_sections.final as unknown as Record<string, unknown>
  const base = rewindTo(full, 'copywriting')
  // 픽스처는 만 14세 이상 상품 — 연령 게이트를 쓰는 시험만 다시 넣는다
  const { minAgeYears: _age, ...spec } = base.spec_sheet
  void _age
  h.job = {
    ...base,
    spec_sheet: {
      ...spec,
      ...(optionSpec ? { optionSpec } : {}),
      ...(minAge ? { minAgeYears: minAge } : {}),
      ...extraSpec,
    },
  } as PdpJobRow
  h.recorded = recorded ? RECORDED : null
}

beforeEach(() => {
  h.subBenefits = ['20개부터 50개까지, 7가지 디자인']
  h.copyCalls = []
  h.patches = []
  h.stage2 = null
  h.stage3 = null
  vi.stubEnv('VERCEL', '')
  vi.stubEnv('VERCEL_ENV', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('stepCopywriting — 사실 값·반복 기록', () => {
  it('등록 옵션 구조 + 기록 잡: 사실 값 블록·반복 검사를 넘기고, 최종 카피의 개수를 고쳐 기록한다', async () => {
    setup({ optionSpec: P01_SPEC, recorded: true })
    await run()
    const input = h.copyCalls[0]
    expect(String(input.factsBlock)).toContain('- 디자인 6가지')
    expect(String(input.factsBlock)).toContain('30개: 생일답례-04')
    expect(input.checkRepeats).toBe(true)
    expect(input.stage3OwnershipBlock).toBe(RECORDED.stage3OwnershipBlock)

    const sections = savedSections()
    const final = sections.final as Record<string, { subBenefit?: string; summary?: string }>
    expect(final.mainIntro.subBenefit).toBe('20개부터 50개까지, 6가지 디자인')
    expect(sections.fact_corrections).toEqual(
      expect.arrayContaining([
        {
          path: 'mainIntro.subBenefit',
          from: '20개부터 50개까지, 7가지 디자인',
          to: '20개부터 50개까지, 6가지 디자인',
        },
        { path: 'summary', from: '7가지 디자인 원형 스티커', to: '6가지 디자인 원형 스티커' },
      ])
    )
    expect(sections.repeat_findings).toEqual(
      expect.arrayContaining([
        { phrase: '6가지 디자인', sections: ['mainIntro', 'recommendedTargets', 'solution', 'summary'] },
      ])
    )
    const error = String(saved().error)
    expect(error).toContain('[CopyFacts] 옵션 개수')
    expect(error).toContain('모든 조합처럼 읽힘')
    expect(error).toContain('[CopyRepeats] 섹션 사이 반복')
    expect(saved()).toMatchObject({ currentStep: 'images' })
  })

  it('등록 옵션 구조만(기록 잡 아님): 사실 값은 쓰고 반복 검사·기록은 하지 않는다', async () => {
    setup({ optionSpec: P01_SPEC, recorded: false })
    await run()
    expect(h.copyCalls[0]).not.toHaveProperty('checkRepeats')
    expect(String(h.copyCalls[0].factsBlock)).toContain('- 디자인 6가지')
    expect(savedSections()).not.toHaveProperty('repeat_findings')
    expect(savedSections().fact_corrections).toBeDefined()
  })

  it('둘 다 아니면 지금 그대로 — 사실 값 블록·정정·반복 기록이 없다', async () => {
    setup({ recorded: false })
    await run()
    expect(h.copyCalls[0]).not.toHaveProperty('factsBlock')
    expect(h.copyCalls[0]).not.toHaveProperty('checkRepeats')
    const sections = savedSections()
    expect(sections).not.toHaveProperty('fact_corrections')
    expect(sections).not.toHaveProperty('repeat_findings')
    expect((sections.final as Record<string, { subBenefit?: string }>).mainIntro.subBenefit).toBe(
      '20개부터 50개까지, 7가지 디자인'
    )
    expect(String(saved().error ?? '')).not.toContain('[CopyFacts]')
  })

  it('재생성 결과도 고친다 — 사실 값 대조는 모든 재생성 뒤(연령 재생성 결과의 개수 오기)', async () => {
    setup({ optionSpec: P01_SPEC, recorded: false, minAge: 14 })
    h.subBenefits = ['어린이도 쓰는 7가지 디자인', '누구나 쓰는 7가지 디자인']
    await run()
    // 픽스처 카테고리의 유사도 재생성이 더 돌 수 있어 개수가 아니라 연령 재생성이 있었는지만 본다
    expect(h.copyCalls.some((c) => String(c.groundingBlock).includes('[연령 제한 재작성 지시]'))).toBe(true)
    const sections = savedSections()
    expect((sections.final as Record<string, { subBenefit?: string }>).mainIntro.subBenefit).toBe('누구나 쓰는 6가지 디자인')
    expect(sections.fact_corrections).toEqual(
      expect.arrayContaining([
        { path: 'mainIntro.subBenefit', from: '누구나 쓰는 7가지 디자인', to: '누구나 쓰는 6가지 디자인' },
      ])
    )
  })
})

describe('stepCopywriting — 숫자·단위 대조(P0-2)', () => {
  const directiveCall = () => h.copyCalls.find((c) => String(c.groundingBlock).includes('[숫자·단위 재작성 지시]'))
  const subBenefitOf = (sections: Record<string, unknown>) =>
    (sections.final as Record<string, { subBenefit?: string }>).mainIntro.subBenefit

  it('입력에 없는 숫자+단위가 있으면 재작성 1회 — 줄인 결과를 받고 걸린 수·재작성만 기록한다', async () => {
    setup({ recorded: false, minAge: 14 })
    h.subBenefits = ['48시간 지속되는 파티', '오래 즐기는 파티']
    await run()
    expect(String(directiveCall()?.groundingBlock)).toContain('"48시간 지속되는 파티" (48시간)')
    const sections = savedSections()
    expect(subBenefitOf(sections)).toBe('오래 즐기는 파티')
    expect(sections.number_check).toEqual({ found: 1, regenerated: true, remaining: [] })
    expect(String(saved().error ?? '')).not.toContain('[CopyNumbers]')
  })

  it('재작성이 줄이지 못하면 이전 카피 — 경고와 남은 숫자를 기록한다(지우지 않는다)', async () => {
    setup({ recorded: false, minAge: 14 })
    h.subBenefits = ['48시간 지속되는 파티']
    await run()
    const sections = savedSections()
    expect(subBenefitOf(sections)).toBe('48시간 지속되는 파티')
    expect(sections.number_check).toEqual({
      found: 1,
      regenerated: false,
      remaining: [{ path: 'mainIntro.subBenefit', token: '48시간', text: '48시간 지속되는 파티' }],
    })
    const error = String(saved().error)
    expect(error).toContain('숫자·단위 재생성이 입력에 없는 숫자를 줄이지 못함')
    expect(error).toContain('[CopyNumbers] 입력에 없는 숫자·단위 1건')
  })

  it("입력에 있으면 재작성하지 않고 기록도 없다 — 입력 '하루 두 번'이 카피 '1일 2회'를 받친다", async () => {
    setup({ recorded: false, minAge: 14, spec: { usageLocation: '생일파티 · 하루 두 번 뿌려도 넉넉' } })
    h.subBenefits = ['1일 2회 넉넉하게 터지는 파티']
    await run()
    expect(directiveCall()).toBeUndefined()
    expect(savedSections()).not.toHaveProperty('number_check')
  })
})

describe('stepCopywriting — 상품 사실·떠넘기는 문장(W2b)', () => {
  // R5 P07 마무리 문구 — 페이지에 없는 '하단 상세 정보'로 떠넘긴다
  const DEFLECT = '하단 상세 정보에서 사이즈를 확인해 담아보세요'
  const withDeflection = () => {
    h.final = { ...h.final, closingCta: { headline: '오늘 바닥에 놓을 식기, 2구로 골라보세요', subtext: DEFLECT } }
  }

  it('새 입력 필드(무게·원산지·추가 스펙)가 있으면 기록 잡이 아니어도 상품 사실 블록을 넣고, 떠넘기는 문장을 빼서 기록한다', async () => {
    setup({ recorded: false, spec: { weight: '180g', origin: '중국', extraSpecs: [{ key: '용량', value: '350ml' }] } })
    withDeflection()
    await run()
    const block = String(h.copyCalls[0].factsBlock)
    expect(block).toContain('## [상품 사실')
    expect(block).toContain('- 소재: 종이/압축공기')
    expect(block).toContain('- 무게: 180g')
    expect(block).toContain('- 원산지: 중국')
    expect(block).toContain('- 용량: 350ml')
    const sections = savedSections()
    expect((sections.final as Record<string, { subtext?: string }>).closingCta.subtext).toBe('')
    expect(sections.deflection_removed).toEqual([{ path: 'closingCta.subtext', before: DEFLECT, after: '' }])
    expect(String(saved().error)).toContain('[SpecFacts] 떠넘기는 문장 1곳 제거')
  })

  it('기록 잡은 새 필드가 없어도 상품 사실 블록(소재·크기와 규칙)을 넣는다 — 옵션 사실 값 블록 뒤', async () => {
    setup({ optionSpec: P01_SPEC, recorded: true })
    await run()
    const block = String(h.copyCalls[0].factsBlock)
    expect(block.indexOf('## [사실 값')).toBeLessThan(block.indexOf('## [상품 사실'))
    expect(block).toContain('- 크기: 길이 30cm 원통형 10개입')
    expect(block).toContain("'상세 정보에서 확인'")
  })

  it('둘 다 아니면 떠넘기는 문장도 그대로 둔다(프롬프트·최종 카피 불변)', async () => {
    setup({ recorded: false })
    withDeflection()
    await run()
    expect(h.copyCalls[0]).not.toHaveProperty('factsBlock')
    const sections = savedSections()
    expect((sections.final as Record<string, { subtext?: string }>).closingCta.subtext).toBe(DEFLECT)
    expect(sections).not.toHaveProperty('deflection_removed')
  })
})

describe('stepCopywriting — 사용 순서(적용 G-U1)', () => {
  const STEPS = [
    { title: '뚜껑을 돌려 연다', description: '시계 반대 방향으로' },
    { title: '내용물을 채운다' },
    { title: '뚜껑을 닫아 보관한다', description: '딸깍 소리가 날 때까지' },
  ]
  const asDesigncut = () => {
    h.job = { ...h.job!, generation_track: 'internalized', section_plan: { ...h.job!.section_plan, enrichment: { version: 1, features: ['designcut'] }, internalized_skeleton: { persuasion: {} } } } as unknown as PdpJobRow
  }
  const howTo = (n: number) => Array.from({ length: n }, (_, i) => ({ step: `단계 ${i + 1}`, description: '설명' }))

  it('디자인 컷 잡에 입력 사용 순서가 있으면 사실 블록에 단계 수·순서 그대로 넣는다 — howTo 단계 수가 같으면 경고 없음', async () => {
    setup({ recorded: false, spec: { usageSteps: STEPS } })
    asDesigncut()
    h.final = { ...h.final, howTo: howTo(3) }
    await run()
    const block = String(h.copyCalls[0].factsBlock)
    expect(block).toContain('## [사용 순서 — 판매자 입력 3단계, howTo는 이 단계 수·순서 그대로 쓴다]')
    expect(block).toContain('1. 뚜껑을 돌려 연다 — 시계 반대 방향으로\n2. 내용물을 채운다\n3. 뚜껑을 닫아 보관한다 — 딸깍 소리가 날 때까지')
    expect(String(saved().error ?? '')).not.toContain('[UsageSteps]')
  })

  it('최종 howTo 단계 수가 입력과 다르면 경고만 남긴다(카피는 고치지 않는다)', async () => {
    setup({ recorded: false, spec: { usageSteps: STEPS } })
    asDesigncut()
    h.final = { ...h.final, howTo: howTo(2) }
    await run()
    expect(String(saved().error)).toContain('[UsageSteps] 입력 사용 순서 3단계인데 최종 howTo 2단계')
    expect((savedSections().final as { howTo: unknown[] }).howTo).toHaveLength(2)
  })

  it('디자인 컷이 아닌 잡(R)·입력 없음·한 단계라도 규제 표현이면 지금 그대로 — 사실 블록이 없다', async () => {
    setup({ recorded: false, spec: { usageSteps: STEPS } })
    await run()
    expect(h.copyCalls[0]).not.toHaveProperty('factsBlock')
    h.copyCalls = []
    setup({ recorded: false })
    asDesigncut()
    await run()
    expect(h.copyCalls[0]).not.toHaveProperty('factsBlock')
    h.copyCalls = []
    setup({ recorded: false, spec: { usageSteps: [...STEPS.slice(0, 2), { title: '아토피 치료 효과를 확인한다' }] } })
    asDesigncut()
    await run()
    expect(h.copyCalls[0]).not.toHaveProperty('factsBlock')
  })
})

describe('stepCopywriting — 카피 규칙 기록(P1-1a, 모든 잡)', () => {
  beforeEach(() => setup({ recorded: false }))

  it('최종 카피에 남은 안내형 끝말·첫 화면 종류 낱말 누락을 경고하고 copy_rule_check에 남긴다', async () => {
    await run()
    expect(savedSections().copy_rule_check).toEqual({
      guide_endings: [{ path: 'directionHint.headline', text: '지금 컬러를 확인해보세요' }],
      hook_type_missing: ['꽃가루', '폭죽'],
    })
    expect(String(saved().error)).toContain(
      '[CopyRules] 제목·CTA 안내형 끝말 1건, 첫 화면에 상품 종류 낱말(꽃가루·폭죽) 없음 — copy_sections.copy_rule_check 참조'
    )
  })

  it('걸린 것이 없으면 기록·경고가 없다', async () => {
    h.final = { ...h.final!, directionHint: { headline: '지금 컬러를 골라요', subCopy: '' } }
    h.subBenefits = ['돌리면 터지는 컬러 꽃가루']
    await run()
    expect(savedSections()).not.toHaveProperty('copy_rule_check')
    expect(String(saved().error ?? '')).not.toContain('[CopyRules]')
  })
})

describe('stepCopywriting — 카피 흐름 수(P1-1b, 모든 잡)', () => {
  beforeEach(() => setup({ recorded: false }))

  it('스위치가 꺼진 기록 없는 잡에도 copy_flow를 남긴다 — 카피 입력에 flowFix는 없고 경고도 늘지 않는다', async () => {
    await run()
    const record = savedSections().copy_flow as Record<string, unknown> & { counts: Record<string, number> }
    expect(record.version).toBe(1)
    // 모의 카피는 '7가지 디자인'을 첫 화면·solution·요약·추천 대상에 되풀이한다
    expect(record.counts.phrases).toBeGreaterThanOrEqual(1)
    expect(record.counts.numbers).toBeGreaterThanOrEqual(1)
    expect((record.examples as { numbers: string[] }).numbers).toContain('7가지')
    expect(record).not.toHaveProperty('before')
    expect(record).not.toHaveProperty('fix')
    expect(h.copyCalls[0]).not.toHaveProperty('flowFix')
    expect(String(saved().error ?? '')).not.toContain('copy_flow')
  })

  it('디자인 컷이 아닌 잡은 designRules를 넘기지 않는다', async () => {
    await run()
    expect(h.copyCalls[0]).not.toHaveProperty('designRules')
  })

  it('디자인 컷 잡은 designRules를 넘긴다', async () => {
    h.job = { ...h.job!, generation_track: 'internalized', section_plan: { ...h.job!.section_plan, enrichment: { version: 1, features: ['designcut'] }, internalized_skeleton: { persuasion: {} } } } as unknown as PdpJobRow
    await run()
    expect(h.copyCalls[0]).toMatchObject({ designRules: true, withoutExampleColors: true })
  })

  it('flow 기록 잡은 flowFix를 넘기고 fix를 남긴다 — Stage 2 산출의 수는 before로(고치기 전과 비교)', async () => {
    h.job = { ...h.job!, analysis: { ...h.job!.analysis, enrichment: { version: 1, features: ['flow'] } } } as PdpJobRow
    h.stage2 = { ...h.final!, summary: '7가지 디자인', compareSummary: '7가지 디자인으로', soldOutBanner: { headline: '7가지 디자인' } }
    await run()
    expect(h.copyCalls[0]).toMatchObject({ flowFix: true })
    const record = savedSections().copy_flow as { fix?: boolean; before?: Record<string, number>; counts: Record<string, number> }
    expect(record.fix).toBe(true)
    expect(record.before?.numbers).toBeGreaterThanOrEqual(1)
    expect(Object.keys(record.before!)).toEqual(Object.keys(record.counts))
  })

  it('예상 밖 카피 모양(배열이 아닌 공감 줄)으로 흐름 수를 세지 못해도 카피 단계는 계속된다 — copy_flow 없이 경고 한 줄', async () => {
    h.final = { ...h.final!, problem: { empathyLines: '배열이 아닌 공감 줄' } }
    await run()
    expect(saved().currentStep).toBe('images')
    expect(savedSections()).not.toHaveProperty('copy_flow')
    expect(String(saved().error)).toContain('[CopyFlow] 카피 흐름 수를 세지 못해 copy_flow 없이 진행')
  })
})

describe('stepCopywriting — Stage 3 결과 기록·카피 경고 로그(pdp-stage3-fix-effective)', () => {
  beforeEach(() => setup({ recorded: false }))

  it('카피 결과의 Stage 3 기록을 copy_sections.stage3에 그대로 남기고, 카피 경고를 실행 로그에 한 줄 남긴다', async () => {
    h.stage3 = { version: 1, parsed: 'object', reported: [], restored: ['solution'], kept: [], changedTopLevel: [] }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await run()
      expect(savedSections().stage3).toEqual(h.stage3)
      const line = warn.mock.calls.map((c) => String(c[0])).find((m) => m.startsWith('[registration/pdp-copy] 카피 단계 경고'))
      expect(line).toBeDefined()
      expect(line).toContain(String(saved().error).split(' | ')[0])
    } finally {
      warn.mockRestore()
    }
  })

  it('Stage 3 기록이 없는 결과(premium·예전 잡)는 칸을 만들지 않는다', async () => {
    await run()
    expect(savedSections()).not.toHaveProperty('stage3')
  })
})

describe('stepCopywriting — 카피 리듬 수(rhythm, 모든 잡)', () => {
  beforeEach(() => setup({ recorded: false }))

  it('스위치가 꺼진 기록 없는 잡에도 copy_rhythm을 남긴다 — 카피 입력에 rhythm은 없다', async () => {
    await run()
    const record = savedSections().copy_rhythm as { version: number; counts: Record<string, number> }
    expect(record.version).toBe(1)
    expect(record.counts.head_fields).toBeGreaterThan(0)
    expect(record.counts.body_fields).toBeGreaterThan(0)
    expect(record).not.toHaveProperty('before')
    expect(record).not.toHaveProperty('fix')
    expect(h.copyCalls[0]).not.toHaveProperty('rhythm')
  })

  it('rhythm 기록 잡은 rhythm을 넘기고 fix를 남긴다 — Stage 2 산출의 수는 before로', async () => {
    h.job = { ...h.job!, analysis: { ...h.job!.analysis, enrichment: { version: 1, features: ['rhythm'] } } } as PdpJobRow
    h.stage2 = { ...h.final!, directionHint: { headline: '손가락 대신 쓰는 실리콘 샴푸 브러쉬로 두피를 시원하게' } }
    await run()
    expect(h.copyCalls[0]).toMatchObject({ rhythm: true })
    const record = savedSections().copy_rhythm as { fix?: boolean; before?: Record<string, number> }
    expect(record.fix).toBe(true)
    expect(record.before?.head_long).toBeGreaterThanOrEqual(1)
  })
})
