import { describe, expect, it } from 'vitest'
import { getPdpTestProduct, PDP_TEST_PRODUCT_IDS } from '../__fixtures__/pdp-products'
import { CONCEPT_FAMILY_IDS } from './concepts'
import { lineInputsOf } from './input-values'
import { TEMPLATES } from './library'
import { lineShotsOf, placesOf, withSectionBg } from './line-plan'
import { HERO_SHOT_KEY, keyedShots } from './section-values'
import { selectTemplateLine, type TemplateAgents } from './select-line'
import { assignStages, pageStageNames, showroomLooks, SHOWROOM_MIN, STAGE_SHARE_MAX, stageNameOf } from './shot-stage'
import type { TemplateMeta } from './template-meta'
import type { PdpJobRow } from '../pdp-state'
import { yieldToEventLoop } from './__test__/yield'

const COLORS = { tint: '#AAAAAA', deep: '#111111', accent: '#FF0000' }
const context = { family: 'trust' as const, colors: COLORS, places: ['캠핑', '출근길'] }

describe('컷 무대', () => {
  it('목적이 먼저고, 목적이 정하지 않으면 구도로 정한다', () => {
    const name = (purpose: string, composition: string) => stageNameOf({ purpose, composition })
    expect(name('scene', 'in_hand')).toBe('place')
    expect(name('problem', 'closeup')).toBe('place')
    expect(name('action', 'closeup')).toBe('life')
    expect(name('scale', 'front')).toBe('life')
    expect(name('texture', 'side')).toBe('macro')
    expect(name('feature_proof', 'in_use')).toBe('life')
    expect(name('feature_proof', 'closeup')).toBe('macro')
    expect(name('feature_proof', 'side')).toBe('showroom')
    expect(name('group', 'group')).toBe('showroom')
  })

  it('쇼룸이 모자라면 옮길 수 있는 컷만 쇼룸으로 옮긴다', () => {
    const shots = [
      ...Array.from({ length: 4 }, () => ({ purpose: 'action', composition: 'top' })),
      ...Array.from({ length: 4 }, () => ({ purpose: 'action', composition: 'in_hand' })),
      ...Array.from({ length: 3 }, () => ({ purpose: 'texture', composition: 'closeup' })),
      ...Array.from({ length: 3 }, () => ({ purpose: 'scene', composition: 'side' })),
    ]
    const names = pageStageNames(shots)
    // 손 컷·근접 구도·다른 장소는 그대로다
    expect(names.slice(4, 8)).toEqual(['life', 'life', 'life', 'life'])
    expect(names.slice(8, 11)).toEqual(['macro', 'macro', 'macro'])
    expect(names.slice(11)).toEqual(['place', 'place', 'place'])
    // 옮길 것이 4개뿐이라 5장을 못 채운다 — 지어내지 않고 멈춘다
    expect(names.slice(0, 4)).toEqual(['showroom', 'showroom', 'showroom', 'showroom'])
  })

  it('생활 컷이 넘치면 비율 상한까지 옮긴다', () => {
    const shots = [...Array.from({ length: 12 }, () => ({ purpose: 'state', composition: 'front' })), ...Array.from({ length: 8 }, () => ({ purpose: 'scene', composition: 'side' }))]
    const names = pageStageNames(shots)
    expect(names.filter((name) => name === 'life').length).toBeLessThanOrEqual(shots.length * STAGE_SHARE_MAX)
    expect(names.filter((name) => name === 'showroom').length).toBeGreaterThanOrEqual(SHOWROOM_MIN)
  })

  it('다른 장소는 컷 순서대로 돌려 쓰고, 장소가 없으면 이름 없이 지시한다', () => {
    const shots = [{ purpose: 'scene', composition: 'side' }, { purpose: 'problem', composition: 'side' }, { purpose: 'scene', composition: 'top' }]
    const lines = assignStages(shots, context).map((stage) => stage.line)
    expect(lines[0]).toContain('"캠핑"')
    expect(lines[1]).toContain('"출근길"')
    expect(lines[2]).toContain('"캠핑"')
    expect(lines[0]).toContain('not the shared set')
    // 장소 컷에 붙는 참조 안내는 배경 톤을 맞추라고 한다 — 이 줄이 덮어야 한다
    expect(lines[0]).toContain('anything the reference roles say about the background')
    expect(assignStages(shots, { ...context, places: [] })[0].line).toContain('a real place where the product is used')
  })

  it('상품이 나오는 다른 장소 컷은 제품이 첫 참조 그대로라고 말하고, 고민 장면과 다른 무대는 말하지 않는다(적용 K6 R-K18)', () => {
    const SAME = 'The product itself stays exactly as in the first reference image'
    const shots = [
      { purpose: 'scene', composition: 'side' },
      { purpose: 'problem', composition: 'side' },
      { purpose: 'action', composition: 'in_hand' },
      { purpose: 'texture', composition: 'closeup' },
      { purpose: 'hero', composition: 'front' },
    ]
    for (const places of [context.places, []]) {
      const stages = assignStages(shots, { ...context, places })
      expect(stages.map((stage) => stage.name)).toEqual(['place', 'place', 'life', 'macro', 'showroom'])
      expect(stages.map((stage) => stage.line.includes(SAME))).toEqual([true, false, false, false, false])
      // 장소 줄 안 자리 — 바닥·벽·소품 문장 뒤, 덮는 문장 앞
      expect(stages[0].line).toMatch(/do not apply\. The product itself stays exactly as in the first reference image — same shape, colors, parts and printing; only the place around it changes\. This replaces the Background/)
    }
    // 글이 장소를 말한 컷도 같다
    expect(assignStages([{ purpose: 'scene', composition: 'side', show: '욕실에 두고 써요' }], context)[0].line).toContain(SAME)
  })

  it('컨셉 계열 8행 모두 쇼룸 줄이 있고, 색이 필요한 계열은 페이지 색을 쓴다', () => {
    const shot = [{ purpose: 'group', composition: 'group' }]
    const lines = Object.fromEntries(CONCEPT_FAMILY_IDS.map((family) => [family, assignStages(shot, { ...context, family })[0].line]))
    expect(new Set(Object.values(lines)).size).toBe(CONCEPT_FAMILY_IDS.length)
    expect(lines.cute).toContain(COLORS.tint)
    expect(lines.premium).toContain(COLORS.deep)
    expect(lines.trendy).toContain(COLORS.accent)
    expect(lines.season).toContain(COLORS.tint)
    for (const line of Object.values(lines)) {
      expect(line).toContain('This replaces the Background and Set description lines')
      expect(line).toContain("Keep the page's light direction and color temperature")
    }
  })

  it('쇼룸 컷은 첫 갈래(지금 값) 뒤 바탕 갈래 둘을 페이지 안 순서대로 돌린다 — 둘째 갈래 빛은 계열 값 그대로(적용 K6 ②)', () => {
    const showroom = Array.from({ length: 7 }, () => ({ purpose: 'group', composition: 'group' }))
    for (const family of CONCEPT_FAMILY_IDS) {
      const looks = showroomLooks(family, COLORS)
      expect(looks.length, family).toBe(3)
      expect(new Set(looks.map((look) => look.backdrop)).size, family).toBe(3)
      expect(looks[1].light, family).toBe(looks[0].light)
      const lines = assignStages(showroom, { ...context, family }).map((stage) => stage.line)
      // 첫 쇼룸 컷은 전과 같은 줄(한 컷 페이지와 같다), 넷째부터 다시 돈다
      expect(lines[0], family).toBe(assignStages([showroom[0]], { ...context, family })[0].line)
      expect(lines.slice(0, 3).every((line, at) => line.includes(looks[at].backdrop)), family).toBe(true)
      expect(lines[3], family).toBe(lines[0])
      expect(new Set(lines).size, family).toBe(3)
    }
  })

  it('셋째 쇼룸 갈래만 빛 대비가 바뀐다 — 고른 확산광 계열은 사선 창빛, 그 밖은 또렷한 그림자, 바탕·표면과 빛 지킴 줄은 그대로(적용 K6 ③-b (b))', () => {
    const contrast = Object.fromEntries(CONCEPT_FAMILY_IDS.map((family) => [family, showroomLooks(family, COLORS)[2].light]))
    expect(contrast).toEqual({
      trust: 'diagonal window light',
      cute: 'diagonal window light',
      season: 'diagonal window light',
      minimal: 'a crisp defined shadow',
      premium: 'a crisp defined shadow',
      nature: 'a crisp defined shadow',
      active: 'a crisp defined shadow',
      trendy: 'a crisp defined shadow',
    })
    const third = Array.from({ length: 3 }, () => ({ purpose: 'group', composition: 'group' }))
    for (const family of CONCEPT_FAMILY_IDS) {
      const [base, , look] = showroomLooks(family, COLORS)
      // 계열 첫 빛이 이미 대비 값이면(또렷한 그림자) 셋째도 같다 — 바뀌는 계열은 첫 갈래와 다르다
      if (base.light !== 'a crisp defined shadow') expect(look.light, family).not.toBe(base.light)
      const line = assignStages(third, { ...context, family })[2].line
      expect(line, family).toContain(`${look.backdrop}, ${look.surface}, ${look.light}.`)
      expect(line, family).toContain("Keep the page's light direction and color temperature.")
      // 짙은 면 섹션이어도 셋째 갈래의 빛 대비는 그대로다
      expect(assignStages([...third.slice(0, 2), { ...third[2], bg: 'D' }], { ...context, family })[2].line, family).toContain(`${look.surface}, ${look.light}.`)
    }
  })

  it('바탕 갈래는 최종 보고 L8의 같은 톤·유채색·정반대 색·재질을 모두 쓰고, 제품 색에서 정하는 바탕은 제품 색을 지키라고 적는다', () => {
    const backdrops = CONCEPT_FAMILY_IDS.flatMap((family) => showroomLooks(family, COLORS).slice(1).map((look) => look.backdrop))
    expect(backdrops.some((b) => b.includes('same color family as the product'))).toBe(true)
    expect(backdrops.some((b) => b.includes(`saturated color plane close to ${COLORS.accent}`))).toBe(true)
    expect(backdrops.some((b) => b.includes("color opposite the product's main color"))).toBe(true)
    expect(backdrops.some((b) => / backdrop$/.test(b))).toBe(true)
    for (const b of backdrops.filter((b) => b.includes('the product'))) expect(b).toContain('the product keeps its exact colors')
    // 나무결은 쓰지 않는다(식물·오크 쏠림)
    expect(backdrops.some((b) => /wood|oak|plant/i.test(b))).toBe(false)
  })

  it('짙은 면(D) 섹션의 쇼룸 컷만 바탕이 어두운·중간 면이고, 표면·빛과 돌림 순서는 그대로다', () => {
    const shot = { purpose: 'group', composition: 'group' }
    const plain = assignStages([shot, shot, shot], context).map((stage) => stage.line)
    const dark = assignStages([shot, { ...shot, bg: 'D' }, { ...shot, bg: 'W' }], context).map((stage) => stage.line)
    expect(dark[0]).toBe(plain[0])
    expect(dark[2]).toBe(plain[2])
    expect(dark[1]).toContain(`a dark or mid-tone plane close to ${COLORS.deep}`)
    const second = showroomLooks(context.family, COLORS)[1]
    expect(dark[1]).toContain(`${second.surface}, ${second.light}`)
    expect(dark[1]).not.toContain(second.backdrop)
    // 쇼룸이 아닌 컷은 D 섹션이어도 그대로다
    for (const other of [{ purpose: 'action', composition: 'in_hand' }, { purpose: 'texture', composition: 'closeup' }, { purpose: 'scene', composition: 'side' }]) {
      expect(assignStages([{ ...other, bg: 'D' }], context)).toEqual(assignStages([other], context))
    }
  })

  it('생활 컷만 세트를 쓴다는 줄이고 근접 컷은 소품이 없다', () => {
    const [life, macro] = assignStages([{ purpose: 'action', composition: 'in_hand' }, { purpose: 'texture', composition: 'closeup' }], context)
    expect(life.line).toContain('the shared set')
    expect(life.line).not.toContain('This replaces')
    expect(macro.line).toContain('no props')
  })
})

describe('글이 말하는 장소', () => {
  const place = { purpose: 'scene', composition: 'in_use' }
  const context = { family: CONCEPT_FAMILY_IDS[0], colors: { tint: '#EEEEEE', deep: '#222222', accent: '#AA0000' }, places: ['거실', '현관'] }
  it('글이 장소를 말하면 그 장소를 지시하고 돌려 쓰는 순서는 밀리지 않는다', () => {
    const lines = assignStages([{ ...place, show: '욕실에 두고 써요' }, place, { ...place, show: '오늘도 좋아요' }], context).map((stage) => stage.line)
    expect(lines[0]).toContain('"욕실"')
    expect(lines[1]).toContain('"거실"')
    expect(lines[2]).toContain('"현관"')
  })
  it('장소 무대가 아닌 컷은 글이 장소를 말해도 줄이 그대로다', () => {
    const shot = { purpose: 'action', composition: 'in_hand' }
    expect(assignStages([{ ...shot, show: '욕실에 두고 써요' }], context)).toEqual(assignStages([shot], context))
  })
})

describe('세트 밖 장소', () => {
  const job = (tags: unknown, category = 'beauty') =>
    ({ copy_sections: { final: { usageSceneTags: tags } }, analysis: { detected_category: category }, spec_sheet: {} }) as unknown as Pick<PdpJobRow, 'copy_sections' | 'analysis' | 'spec_sheet'>

  it('사용 장면 태그를 먼저 쓰고 카테고리 장소에서 세트에 쓴 곳을 뺀다', () => {
    expect(placesOf(job(['헬스장 ', '헬스장', '']), 'white marble vanity table')).toEqual(['헬스장', 'bathroom shelf', 'bedside table'])
    expect(placesOf(job(['가', '나', '다', '라']), undefined)).toEqual(['가', '나', '다'])
    expect(placesOf(job(undefined, '없는 카테고리'), undefined)).toEqual(['living room shelf', 'desk', 'kitchen counter'])
    expect(placesOf(job([1, '가']), undefined)[0]).toBe('가')
    expect(placesOf(job(['#생일파티', '# 기념일', '##']), undefined).slice(0, 2)).toEqual(['생일파티', '기념일'])
  })
})

describe('시험 11상품 계획값(선택 콜은 가짜, 후보 첫째)', () => {
  const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
  const agents: TemplateAgents = {
    guideline: async ({ concepts }) => free({ persona: '', tone: '', concept: { id: concepts[0].id, reason: '' }, alternatives: [] }),
    compose: async () => free([]),
    select: async ({ slots }) => free(slots.map((s) => ({ index: s.index, templateId: s.candidates[0].id, reason: '' }))),
  }

  it('최다 무대 45% 이하, 쇼룸 5장 이상, 다른 장소 컷 2장 이상이다', async () => {
    for (const id of PDP_TEST_PRODUCT_IDS) {
      await yieldToEventLoop()
      const product = getPdpTestProduct(id)!
      const inputs = lineInputsOf({ spec_sheet: product.specSheet, analysis: {}, copy_sections: { final: { options: product.specSheet.colorOptions ?? [] } } } as never)
      const { order } = await selectTemplateLine(
        {
          key: id,
          categoryKey: product.categoryKey,
          productHex: null,
          spec: product.specSheet,
          templates: TEMPLATES as unknown as TemplateMeta[],
          inputs,
          product: { category: product.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] },
        },
        agents
      )
      const shots = order.sections.flatMap((row, index) => keyedShots(index, row)).filter((shot) => shot.key !== HERO_SHOT_KEY)
      const names = pageStageNames(shots)
      const count = (name: string) => names.filter((value) => value === name).length
      expect(Math.max(count('showroom'), count('life'), count('place'), count('macro')), id).toBeLessThanOrEqual(shots.length * STAGE_SHARE_MAX)
      expect(count('showroom'), id).toBeGreaterThanOrEqual(SHOWROOM_MIN)
      expect(count('place'), id).toBeGreaterThanOrEqual(2)
      // 쇼룸 5장 이상이면 바탕 갈래 셋이 모두 나온다(적용 K6 ②)
      const showroom = assignStages(shots, { ...context, family: 'trust' }).filter((stage) => stage.name === 'showroom')
      expect(new Set(showroom.map((stage) => stage.line)).size, id).toBe(3)
    }
  }, 60000)

  it('짙은 면(D) 섹션의 쇼룸 컷은 계획의 섹션 바탕을 받아 어두운 바탕이 된다 — P08 deep-wine(premium)', async () => {
    const product = getPdpTestProduct('P08')!
    const inputs = lineInputsOf({ spec_sheet: product.specSheet, analysis: {}, copy_sections: { final: { options: product.specSheet.colorOptions ?? [] } } } as never)
    const pick: TemplateAgents = { ...agents, guideline: async () => free({ persona: '', tone: '', concept: { id: 'deep-wine', reason: '' }, alternatives: [] }) }
    const { order, concept, palette } = await selectTemplateLine(
      { key: 'P08', categoryKey: product.categoryKey, productHex: null, spec: product.specSheet, templates: TEMPLATES as unknown as TemplateMeta[], inputs, product: { category: product.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] } },
      pick
    )
    const shots = withSectionBg(order.sections, lineShotsOf(order.sections, new Map(), []))
    const stages = assignStages(shots, { family: concept.family, colors: palette.colors, places: [] })
    const dark = stages.filter((stage, at) => stage.name === 'showroom' && shots[at].bg === 'D')
    expect(dark.length).toBeGreaterThan(0)
    for (const stage of dark) expect(stage.line).toContain(`a dark or mid-tone plane close to ${palette.colors.deep}`)
    // 바탕을 모르면(D 연결이 없으면) 어두운 바탕 줄이 없다
    const blind = assignStages(lineShotsOf(order.sections, new Map(), []), { family: concept.family, colors: palette.colors, places: [] })
    expect(blind.some((stage) => stage.line.includes('dark or mid-tone plane'))).toBe(false)
  }, 30000)
})
