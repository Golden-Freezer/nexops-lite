/**
 * 계획 지표 — 구조 6칸·바탕·컷·인포그래픽을 손으로 센 값과 맞춘다. 기록만이라 판정은 하지 않는다.
 */

import { describe, expect, it } from 'vitest'
import type { DesigncutBg, DesigncutPlan, ExtraShotPlan } from '../pdp-state'
import { TEMPLATES, templateById } from '../templatelib/library'
import { bandOf, CARD_MIN_WIDTH, hasCard, visibleSurfaces } from '../templatelib/surface-budget'
import { SCREEN_HEIGHT, drawnPageOf, jobPlanMetrics, missingSectionCount, planMetrics, planMetricsLine, planSectionOf, rowOfTemplate, rowsOfDesigncut, type DrawnSection, type PlanRow } from './plan-metrics'

const row = (section: string, over: Partial<PlanRow> = {}): PlanRow => ({ section, bg: 'W', height: 1000, shots: [], infographics: [], ...over })
const page = (...sections: string[]) => sections.map((s) => row(s))

describe('구조 6칸', () => {
  it('고민 연속은 이어진 수만 센다', () => {
    expect(planMetrics(page('hook_3step', 'problem_raise', 'problem_empathy', 'point_div')).problemRun).toBe(2)
    expect(planMetrics(page('problem_raise', 'point_div', 'problem_empathy')).problemRun).toBe(1)
    expect(planMetrics(page('hook_3step', 'cta')).problemRun).toBe(0)
  })

  it('첫 근거·사용법 위치는 맨 앞 0, 맨 끝 1이고 없으면 null이다', () => {
    const m = planMetrics(page('hook_3step', 'point_div', 'review', 'how_to', 'spec_table'))
    expect(m.firstProofAt).toBe(0.5)
    expect(m.howToAt).toBe(0.75)
    const none = planMetrics(page('hook_3step', 'spec_table'))
    expect(none.firstProofAt).toBeNull()
    expect(none.howToAt).toBeNull()
  })

  it('K의 hidden_page는 사용법이 아니고 디자인 컷은 역할로 가른다', () => {
    expect(planMetrics(page('hook_3step', 'hidden_page')).howToAt).toBeNull()
    expect(planMetrics(page('hidden_page', 'review')).pointFamilyShare).toBe(0.5)
    expect(planMetrics([row('hook_3step', { role: 'hook' }), row('hidden_page', { role: 'how_to_guide' })]).howToAt).toBe(1)
  })

  it('끝 권유는 끝 표를 뺀 앞 3자리만 센다', () => {
    expect(planMetrics(page('event_offer', 'point_div', 'point_div', 'point_div', 'convert_div', 'cta', 'spec_table')).closers).toBe(2)
    expect(planMetrics([...page('convert_div', 'faq', 'point_div', 'cta'), row('spec_table', { key: 'spec_table' }), row('long', { key: 'long:info' })]).closers).toBe(1)
  })

  it('끝 권유는 디자인 컷 역할도 K와 같은 자로 센다', () => {
    const page2 = [row('point_list_div', { role: 'target_recommendation' }), row('long', { key: 'long:faq', role: 'long_expansion' }), row('cta', { role: 'cta' })]
    expect(planMetrics(page2).closers).toBe(2)
  })

  it('장점 비중은 높이로 재고, 높이를 모르면 섹션 수로 잰다', () => {
    expect(planMetrics([row('point_div', { height: 3000 }), row('review', { height: 1000 })]).pointFamilyShare).toBe(0.75)
    expect(planMetrics([row('point_div', { height: null }), row('review', { height: 1000 }), row('faq', { height: 1000 })]).pointFamilyShare).toBe(0.333)
    expect(planMetrics([row('fill', { role: 'fill_message' }), row('x', { role: 'social_proof' })]).pointFamilyShare).toBe(0.5)
    expect(planMetrics([]).pointFamilyShare).toBeNull()
    // 묶음은 분석 문서 A1의 6종이다. 사용 장면·전환 구간은 세지 않는다
    expect(planMetrics(page('point_div', 'sub_div', 'hidden_page', 'key_message', 'point_list_div', 'compare', 'sub2_div_page', 'solution_guide')).pointFamilyShare).toBe(0.75)
  })

  it('첫 화면은 폰 한 화면 높이까지 맞음이고 높이를 모르면 null이다', () => {
    expect(planMetrics([row('hook_3step', { height: SCREEN_HEIGHT })]).hookFitsScreen).toBe(true)
    expect(planMetrics([row('hook_3step', { height: SCREEN_HEIGHT + 1 })]).hookFitsScreen).toBe(false)
    expect(planMetrics([row('hook_3step', { height: null })]).hookFitsScreen).toBeNull()
  })
})

describe('바탕 지표', () => {
  const bgs = (...list: string[]) => list.map((bg) => row('point_div', { bg }))

  it('이웃 다름·W 비율·최장 같음을 계획 bg로 센다', () => {
    const s = planMetrics(bgs('W', 'W', 'W', 'T', 'N', 'W')).surfaces
    expect(s.neighborDiff).toBe(0.6)
    expect(s.wShare).toBe(0.667)
    expect(s.longestSame).toBe(3)
    expect([s.t, s.d, s.n]).toEqual([1, 0, 1])
  })

  it('풀폭 상자가 있는 섹션은 상자 색 하나로 센다', () => {
    const s = planMetrics([row('a', { bg: 'W', band: 'D' }), row('b', { bg: 'W' }), row('c', { bg: 'W', band: 'T' })]).surfaces
    expect([s.t, s.d, s.n]).toEqual([1, 1, 0])
    expect(s.wShare).toBe(0.333)
    expect(s.neighborDiff).toBe(1)
    expect(s.longestSame).toBe(1)
  })

  it('이웃 다름은 바탕 예산 판정(visibleSurfaces)과 같은 값이다 — 실제 라이브러리 템플릿', () => {
    const withBand = TEMPLATES.filter((t) => bandOf(t)).slice(0, 3)
    const plain = TEMPLATES.filter((t) => !bandOf(t)).slice(0, 3)
    const templates = [plain[0], withBand[0], plain[1], withBand[1], plain[2], withBand[2]]
    const backgrounds: DesigncutBg[] = ['W', 'W', 'W', 'W', 'N', 'W']
    const cells = visibleSurfaces(templates, backgrounds)
    const expected = cells.slice(1).filter((cell, i) => cell !== cells[i]).length / (cells.length - 1)
    const rows = templates.map((t, i) => rowOfTemplate(t, { bg: backgrounds[i] }))
    expect(planMetrics(rows).surfaces.neighborDiff).toBe(Math.round(expected * 1000) / 1000)
    expect(planMetrics(rows).surfaces.wShare).toBe(Math.round((cells.filter((c) => c === 'W').length / cells.length) * 1000) / 1000)
  })

  it('흐름 맨 위 사진 위 글 템플릿은 P로 센다 — visibleSurfaces와 같고 t·d·n·W 비율엔 안 든다(T1-30)', () => {
    const photo = TEMPLATES.find((t) => t.id === 'hook_3step.overlay-top-center')!
    const plain = TEMPLATES.filter((t) => !bandOf(t) && !JSON.stringify(t.flow).includes('"overlay":')).slice(0, 2)
    const templates = [plain[0], photo, plain[1]]
    const backgrounds: DesigncutBg[] = ['W', 'W', 'W']
    const rows = templates.map((t, i) => rowOfTemplate(t, { bg: backgrounds[i] }))
    expect(rows[1].band).toBe('P')
    expect(visibleSurfaces(templates, backgrounds)).toEqual(['W', 'P', 'W'])
    const s = planMetrics(rows).surfaces
    expect(s.neighborDiff).toBe(1)
    expect([s.t, s.d, s.n]).toEqual([0, 0, 0])
    expect(s.wShare).toBe(0.667)
  })

  it('바탕을 모르는 줄은 이웃 비교에서 뺀다', () => {
    const s = planMetrics([row('a', { bg: 'W' }), row('kept', { bg: null }), row('b', { bg: 'W' })]).surfaces
    expect(s.neighborDiff).toBe(0)
  })

  it('큰 카드는 흰 바탕일 때만 세고 t·이웃 다름·W 비율에는 넣지 않는다', () => {
    const rows = [
      row('white', { bg: 'W', card: true }),
      row('grey', { bg: 'N', card: true }),
      row('dark', { bg: 'D', card: true }),
      row('band', { bg: 'W', band: 'D', card: true }),
      row('plain', { bg: 'W', card: false }),
    ]
    const s = planMetrics(rows).surfaces
    expect(s.card).toBe(1)
    const without = planMetrics(rows.map((r) => ({ ...r, card: false }))).surfaces
    expect(without.card).toBe(0)
    expect({ ...s, card: 0 }).toEqual(without)
    expect(s.t).toBe(0)
  })

  it('카드 여부를 모르는 줄이 하나라도 있으면 카드 수는 null이다', () => {
    expect(planMetrics([row('a', { card: true }), row('b')]).surfaces.card).toBeNull()
    expect(planMetrics(page('a', 'b')).surfaces.card).toBeNull()
    expect(planMetrics([]).surfaces.card).toBeNull()
  })

  it('연한 면으로 보이는 수는 t + card다 — 실제 라이브러리 템플릿', () => {
    const carded = TEMPLATES.find((t) => hasCard(t) && !bandOf(t) && t.surfaces.includes('W'))!
    const tinted = TEMPLATES.find((t) => bandOf(t) === 'T')!
    const plain = TEMPLATES.find((t) => !hasCard(t) && !bandOf(t) && t.surfaces.includes('T'))!
    const rows = [rowOfTemplate(carded, { bg: 'W' }), rowOfTemplate(tinted, { bg: 'W' }), rowOfTemplate(plain, { bg: 'T' })]
    const s = planMetrics(rows).surfaces
    expect([s.t, s.card]).toEqual([2, 1])
  })

  it('용기 없음 연속은 W·N + 안에 든 사진만 세고, 서명이 없으면 null이다', () => {
    const plain = { container: 'none', photo: 'inset' }
    const rows = [
      row('a', plain),
      row('b', { ...plain, bg: 'N' }),
      row('c', { ...plain, bg: 'T' }),
      row('d', { container: 'card', photo: 'inset' }),
      row('e', { container: 'none', photo: 'bleed-top' }),
      row('f', { container: 'none', photo: 'none' }),
    ]
    expect(planMetrics(rows).surfaces.noContainerRun).toBe(2)
    expect(planMetrics(page('a', 'b')).surfaces.noContainerRun).toBeNull()
  })
})

describe('컷 지표', () => {
  it('무대 칸이 없으면 최다 무대는 null이고 이웃은 구도만 본다', () => {
    const c = planMetrics([
      row('a', { shots: [{ purpose: 'p1', composition: 'front' }, { purpose: 'p2', composition: 'front' }] }),
      row('b', { shots: [{ purpose: 'scale', composition: 'c1' }] }),
      row('c'),
    ]).shots
    expect(c.total).toBe(3)
    expect(c.topStageShare).toBeNull()
    expect(c.neighborSame).toBe(0.5)
    expect([c.purposeKinds, c.compositionKinds]).toEqual([3, 2])
    expect(c.scaleFirstAt).toBe(0.5)
    expect(c.reused).toBe(0)
  })

  it('크기 감은 사진 목적으로 찾는다 — 구도 칸의 같은 글자는 세지 않는다', () => {
    expect(planMetrics([row('a', { shots: [{ purpose: 'scene', composition: 'scale' }] }), row('b')]).shots.scaleFirstAt).toBeNull()
  })

  it('무대가 모두 있으면 최다 비율을 내고 이웃은 무대까지 같아야 같다', () => {
    const c = planMetrics([row('a', { shots: [{ composition: 'front', stage: 'x' }, { composition: 'front', stage: 'y' }, { composition: 'front', stage: 'y' }] })]).shots
    expect(c.topStageShare).toBe(0.667)
    expect(c.neighborSame).toBe(0.5)
  })

  it('같은 사진·같은 목적+구도 짝은 겹침으로 센다', () => {
    expect(planMetrics([row('a', { shots: [{ imageKey: 'hero' }, { imageKey: 'hero' }, { imageKey: 'x' }] })]).shots.reused).toBe(1)
    expect(planMetrics([row('a', { shots: [{ purpose: 'p', composition: 'c' }, { purpose: 'p', composition: 'c' }] })]).shots.reused).toBe(1)
  })
})

describe('줄 만들기', () => {
  it('K 템플릿 — 풀폭 상자·치수 노드·서명을 읽는다', () => {
    const r = rowOfTemplate(
      {
        section: 'perf_metric',
        height: 700,
        signature: { container: 'band', photo: 'none' },
        flow: [{ kind: 'panel', bleed: true, fill: 'D', nodes: [{ kind: 'row', columns: [{ nodes: [{ kind: 'dimension' }] }] }] }, { kind: 'panel', fill: 'T', nodes: [] }],
      },
      { bg: 'W', shots: [{ purpose: 'p', composition: 'c' }] }
    )
    expect(r.band).toBe('D')
    expect(r.infographics.slice().sort()).toEqual(['치수 도식', '큰 숫자'].sort())
    expect(r.container).toBe('band')
    expect(r.shots).toHaveLength(1)
    expect(r.card).toBe(false)
  })

  it('K 템플릿 — 칸 안 큰 C 카드만 카드로 보고, 흐름이 없으면 모른다', () => {
    const panel = (over: object) => ({ section: 'review', height: 700, flow: [{ kind: 'panel', fill: 'C', nodes: [], ...over }] })
    expect(rowOfTemplate(panel({}), { bg: 'W' }).card).toBe(true)
    expect(rowOfTemplate(panel({ w: CARD_MIN_WIDTH }), { bg: 'W' }).card).toBe(true)
    expect(rowOfTemplate(panel({ w: CARD_MIN_WIDTH - 1 }), { bg: 'W' }).card).toBe(false)
    expect(rowOfTemplate(panel({ bleed: true }), { bg: 'W' }).card).toBe(false)
    expect(rowOfTemplate({ section: 'review', height: 700 }, { bg: 'W' }).card).toBeUndefined()
  })

  it('섹션 이름은 조각 번호를 뗀다', () => {
    expect(planSectionOf('point_div:0')).toBe('point_div')
    expect(planSectionOf('k3_point_div')).toBe('point_div')
    expect(planSectionOf('long:info')).toBe('long')
  })

  const plan = {
    order: ['hook_3step', 'problem_raise', 'solution_guide', 'point_div:0', 'long:info'],
    sections: [
      { key: 'hook_3step', role: 'hook', bg: 'W', productImageKey: 'hero', modules: [] },
      { key: 'problem_raise', role: 'problem', bg: 'T', productImageKey: null, modules: [{ type: 'M2a', data: { lines: [] } }] },
      { key: 'point_div:0', role: 'usp_feature', bg: 'W', productImageKey: 'features:0', modules: [{ type: 'M10', data: { scenes: [{ imageKey: 'hero' }] } }, { type: 'M1', data: { items: [] } }] },
      { key: 'long:info', role: 'long_expansion', bg: 'N', productImageKey: null, modules: [{ type: 'M4', data: {} }] },
    ],
  } as unknown as DesigncutPlan

  it('디자인 컷 계획 — 순서대로, 계획 밖 섹션은 바탕 없는 줄이고 사진 키를 모은다', () => {
    const rows = rowsOfDesigncut(plan)
    expect(rows.map((r) => r.section)).toEqual(['hook_3step', 'problem_raise', 'solution_guide', 'point_div', 'long'])
    expect(rows[2]).toMatchObject({ bg: null, shots: [] })
    expect(rows[3].shots.map((s) => s.imageKey)).toEqual(['features:0', 'hero'])
    const m = planMetrics(rows)
    expect(m.problemRun).toBe(1)
    expect(m.shots.reused).toBe(1)
    expect(m.infographics.types).toEqual(['체크리스트', '치수 도식'].sort())
    // 디자인 컷은 템플릿이 없어 카드를 모른다 — 0이 아니라 null이다
    expect(m.surfaces.card).toBeNull()
  })

  it('디자인 컷 컷 지표 — 추가 컷 기록으로 목적·앵글을 읽고 자세히 보기(M11) 컷도 센다. 무대는 칸이 없어 null이다', () => {
    const shots = {
      order: ['point_div:0', 'point_div:1', 'detail'],
      sections: [
        { key: 'point_div:0', role: 'usp_feature', bg: 'W', productImageKey: 'features:0', modules: [] },
        { key: 'point_div:1', role: 'usp_feature', bg: 'T', productImageKey: 'features:1', modules: [] },
        { key: 'detail', role: 'usp_feature', bg: 'W', productImageKey: null, modules: [{ type: 'M11', data: { items: [{ imageKey: 'features:2' }, { imageKey: null }] } }, { type: 'M1', data: { items: ['글'] } }] },
      ],
    } as unknown as DesigncutPlan
    const extraShots = {
      version: 1,
      shots: [{ key: 'features:2', purpose: 'scale' }],
      points: [{ key: 'features:0', purpose: 'action', angle: 1 }, { key: 'features:1', purpose: 'texture', angle: 1 }],
      captions: { checked: 0, unspaced: [], mismatched: [] },
    } as ExtraShotPlan
    const known = planMetrics(rowsOfDesigncut(shots, { extraShots })).shots
    expect(known).toMatchObject({ total: 3, purposeKinds: 3, compositionKinds: 1, neighborSame: 1, scaleFirstAt: 1, topStageShare: null, reused: 0 })
    // 기록이 없으면 컷 수만 나온다(예전 동작)
    const bare = planMetrics(rowsOfDesigncut(shots)).shots
    expect(bare).toMatchObject({ total: 3, purposeKinds: 0, compositionKinds: 0, neighborSame: null, scaleFirstAt: null })
  })

  it('디자인 컷 무대 기록(designcut_stages, 적용 D4 ⓐ)이 있으면 컷마다 무대를 읽어 최다 무대를 낸다 — 한 컷이라도 기록이 없으면 null', () => {
    const plan = {
      order: ['hook', 'point_div:0', 'point_div:1'],
      sections: [
        { key: 'hook', role: 'hook', bg: 'W', productImageKey: 'hero', modules: [] },
        { key: 'point_div:0', role: 'usp_feature', bg: 'W', productImageKey: 'features:0', modules: [] },
        { key: 'point_div:1', role: 'usp_feature', bg: 'T', productImageKey: 'features:1', modules: [] },
      ],
    } as unknown as DesigncutPlan
    const stages = { hero: 'life', 'features:0': 'life', 'features:1': 'macro' }
    const rows = rowsOfDesigncut(plan, { stages })
    expect(rows.map((row) => row.shots.map((shot) => shot.stage))).toEqual([['life'], ['life'], ['macro']])
    expect(planMetrics(rows).shots.topStageShare).toBe(0.667)
    expect(planMetrics(rowsOfDesigncut(plan, { stages: { hero: 'life', 'features:0': 'life' } })).shots.topStageShare).toBeNull()
    expect(planMetrics(rowsOfDesigncut(plan)).shots.topStageShare).toBeNull()
    // 잡 측정도 같은 칸을 넘긴다
    const drawn = plan.order!.map(() => ({ isVisible: true, canvas: { height: 400 } })) as unknown as Parameters<typeof jobPlanMetrics>[1]
    expect(jobPlanMetrics(plan, drawn, { stages }).shots.topStageShare).toBe(0.667)
  })

  it('디자인 컷 장치 — 모듈에 아이콘이 없어 0, 사진 위 글은 계획으로 못 세 null, 사용법은 역할로 센다', () => {
    const cut = {
      order: ['hook_3step', 'hidden_page'],
      sections: [
        { key: 'hook_3step', role: 'hook', bg: 'W', productImageKey: 'hero', modules: [] },
        { key: 'hidden_page', role: 'how_to_guide', bg: 'W', productImageKey: null, modules: [{ type: 'M7', data: { steps: [] } }] },
      ],
    } as unknown as DesigncutPlan
    expect(planMetrics(rowsOfDesigncut(cut)).devices).toEqual({ overlayText: null, icon: 0, howTo: 1 })
    // 계획 밖 기존 섹션(usp_icons를 쓸 수 있다)이 끼면 아이콘도 못 센다
    expect(planMetrics(rowsOfDesigncut({ ...cut, order: [...cut.order, 'main_cut'] })).devices.icon).toBeNull()
  })

  it('K 잡 컷 지표 — 라인 기록을 섹션 번호로 나눠 읽고 k1과 k10을 섞지 않는다. 기록이 없으면 예전처럼 0이다', () => {
    const keys = ['k0_point_div', 'k1_faq', 'k10_compare']
    const kPlan = { order: keys, sections: keys.map((key) => ({ key, role: 'x', bg: 'W', productImageKey: null, modules: [], templateRef: { id: 'x' } })) } as unknown as DesigncutPlan
    const lineShots = [
      { key: 'k0_a_0', purpose: 'scale', composition: 'wide', stage: { name: 's1', line: '지시 가' } },
      { key: 'k1_a_0', purpose: 'scene', composition: 'wide', stage: { name: 's1', line: '지시 나' } },
      { key: 'k10_a_0', purpose: 'scene', composition: 'close', stage: { name: 's2', line: '지시 다' } },
    ]
    const rows = rowsOfDesigncut(kPlan, { lineShots })
    expect(rows.map((r) => r.shots.map((s) => s.imageKey))).toEqual([['k0_a_0'], ['k1_a_0'], ['k10_a_0']])
    expect(planMetrics(rows).shots).toMatchObject({ total: 3, topStageShare: 0.667, neighborSame: 0.5, purposeKinds: 2, compositionKinds: 2, scaleFirstAt: 0 })
    expect(planMetrics(rowsOfDesigncut(kPlan)).shots.total).toBe(0)
  })

  it('K 계획 줄 — 템플릿을 찾으면 장치를 세고, 못 찾으면 null이다', () => {
    const kPlan = { order: ['k0_point_div'], sections: [{ key: 'k0_point_div', role: 'point_div', bg: 'W', productImageKey: null, modules: [], templateRef: { id: 'x' } }] } as unknown as DesigncutPlan
    expect(planMetrics(rowsOfDesigncut(kPlan)).devices.icon).toBeNull()
    const templateOf = () => ({ section: 'point_div', height: 1000, flow: [{ kind: 'icon', slot: 'i' }] })
    expect(planMetrics(rowsOfDesigncut(kPlan, { templateOf })).devices).toEqual({ overlayText: 0, icon: 1, howTo: 0 })
  })

  describe('조립된 문서로 재는 디자인 컷 layout 2', () => {
    const drawn = (backgroundColor: string, names: string[] = [], over: Partial<DrawnSection> = {}): DrawnSection => ({ canvas: { height: 1000, backgroundColor }, elements: names.map((name) => ({ name })), ...over })
    const planOf = (over: Record<string, unknown> = {}) =>
      ({
        layout: 2,
        order: ['a', 'b', 'c', 'd'],
        sections: ['a', 'b', 'c', 'd'].map((key) => ({ key, role: 'usp_feature', bg: 'D', productImageKey: null, modules: [] })),
        ...over,
      }) as unknown as DesigncutPlan

    it('계획은 짙은 면 4인데 화면은 1이면 화면 값이다(R17 P07 D 꼴). 스튜디오 색이 달라도 연한 면이다', () => {
      const m = jobPlanMetrics(planOf(), [drawn('#FFFFFF'), drawn('#F4F3F0'), drawn('#53634D'), drawn('#FAF6ED')])
      expect([m.surfaces.d, m.surfaces.n, m.surfaces.t]).toEqual([1, 2, 0])
      expect(m.surfaces.wShare).toBe(0.25)
      expect(m.surfaces.longestSame).toBe(1)
      expect(planMetrics(rowsOfDesigncut(planOf())).surfaces.d).toBe(4)
    })

    it('사진 위 글은 스크림 든 섹션, 아이콘은 옛 빌더 usp_icon 든 섹션을 센다. 체크 표시는 아이콘이 아니다', () => {
      const page2 = drawnPageOf([drawn('#fff', ['designcut-scrim', 'designcut-headline']), drawn('#fff', ['usp_icon_0', 'usp_icon_1']), drawn('#fff', ['designcut-check-icon-0']), drawn('linear-gradient(#fff,#000)')])
      expect(page2).toEqual({ surfaces: ['W', 'W', 'W', null], overlayText: 1, icon: 1 })
      const m = jobPlanMetrics(planOf(), [drawn('#FFFFFF', ['designcut-scrim']), drawn('#FFFFFF'), drawn('#FFFFFF'), drawn('#FFFFFF')])
      expect(m.devices).toEqual({ overlayText: 1, icon: 0, howTo: 0 })
    })

    it('옛 빌더 줄이 끼어도 문서로 세어 null이 아니고, 안 보이는 섹션은 뺀다', () => {
      const plan = planOf({ order: ['a', 'main_cut'] })
      const m = jobPlanMetrics(plan, [drawn('#FFFFFF'), drawn('#F4F3F0', ['usp_icon_0']), drawn('#53634D', [], { isVisible: false }), drawn('#53634D', [], { canvas: { height: 4, backgroundColor: '#53634D' } })])
      expect(m.devices.icon).toBe(1)
      expect(m.surfaces.d).toBe(0)
      expect(m.hookFitsScreen).toBe(true)
    })

    it('K와 layout 없는 예전 계획은 계획 값이다 — K는 조립이 바탕을 덮지 않는다', () => {
      const k = planOf({ sections: [{ key: 'a', role: 'point_div', bg: 'D', productImageKey: null, modules: [], templateRef: { id: 'x' } }], order: ['a'] })
      expect(jobPlanMetrics(k, [drawn('#FFFFFF')]).surfaces.d).toBe(1)
      expect(jobPlanMetrics(planOf({ layout: undefined }), [drawn('#FFFFFF')]).surfaces.d).toBe(4)
      expect(jobPlanMetrics(planOf({ layout: undefined }), [drawn('#FFFFFF')]).devices.overlayText).toBeNull()
    })
  })

  it('문서 높이는 줄 수가 같을 때만 쓴다', () => {
    expect(rowsOfDesigncut(plan, { heights: [1, 2, 3, 4, 5] }).map((r) => r.height)).toEqual([1, 2, 3, 4, 5])
    expect(rowsOfDesigncut(plan, { heights: [1, 2] }).every((r) => r.height === null)).toBe(true)
  })

  it('계획이 없으면 빈 줄이고 지표는 빈 값이다', () => {
    const m = planMetrics(rowsOfDesigncut(null))
    expect(m.firstProofAt).toBeNull()
    expect(m.hookFitsScreen).toBeNull()
    expect(m.surfaces.neighborDiff).toBeNull()
    expect(m.infographics.kinds).toBe(0)
  })

  it('K 계획 줄 — 템플릿을 못 찾아도 섹션 이름으로 묶음을 센다(역할 칸은 섹션 이름이다)', () => {
    const kPlan = { order: ['k0_point_div', 'k1_faq'], sections: [
      { key: 'k0_point_div', role: 'point_div', bg: 'W', productImageKey: null, modules: [], templateRef: { id: 'x' } },
      { key: 'k1_faq', role: 'faq', bg: 'W', productImageKey: null, modules: [], templateRef: { id: 'y' } },
    ] } as unknown as DesigncutPlan
    const rows = rowsOfDesigncut(kPlan)
    expect(rows[0].role).toBeUndefined()
    expect(planMetrics(rows).pointFamilyShare).toBe(0.5)
  })

  it('한 줄 출력 — 모르는 값은 - 로 찍는다', () => {
    const line = planMetricsLine('P01', planMetrics(page('hook_3step', 'problem_raise')))
    expect(line).toContain('P01 구조 고민연속 1 첫근거 - 사용법 -')
    expect(line).toContain('최다무대 -')
    expect(line).toContain('N0 카드 - W비율')
    expect(planMetricsLine('P01', planMetrics([row('a', { card: true })]))).toContain('N0 카드 1 W비율')
  })

  it('장치 — 든 섹션 수를 세고 못 세는 칸은 null이다(기록만)', () => {
    const counted = planMetrics([row('hook_3step', { overlayText: true, icon: false }), row('point_div', { overlayText: false, icon: true }), row('how_to', { overlayText: false, icon: true })])
    expect(counted.devices).toEqual({ overlayText: 1, icon: 2, howTo: 1 })
    expect(planMetrics(page('hook_3step', 'how_to')).devices).toEqual({ overlayText: null, icon: null, howTo: 1 })
    // 일부만 세면 실제보다 적게 보이므로 null이다
    expect(planMetrics([row('a', { icon: true }), row('b')]).devices.icon).toBeNull()
    expect(planMetrics([]).devices).toEqual({ overlayText: null, icon: null, howTo: 0 })
    const line = planMetricsLine('P01', counted)
    expect(line).toContain('장치 사진위글 1 아이콘 2 사용법 1')
    expect(planMetricsLine('P01', planMetrics(page('a')))).toContain('장치 사진위글 - 아이콘 - 사용법 0')
  })

  it('빠진 섹션 — 글 탓(undrawn)과 컷 탓(lost)을 더하고, 기록이 없으면 모른다(K14)', () => {
    expect(missingSectionCount({ copy: { undrawn: ['5:point_div.x'] }, lost: [{ key: 'k3' }, { key: 'k4' }] })).toBe(3)
    expect(missingSectionCount({ copy: { undrawn: [] }, lost: [] })).toBe(0)
    expect(missingSectionCount({ copy: { undrawn: ['1:main_cut.x'] } })).toBe(1)
    expect(missingSectionCount({ lost: [] })).toBeNull()
    expect(missingSectionCount(null)).toBeNull()
    expect(planMetricsLine('P01', planMetrics(page('a'), null, 2))).toContain('빠진섹션 2')
    expect(planMetricsLine('P01', planMetrics(page('a')))).toContain('빠진섹션 -')
  })

  it('장치 — K 템플릿은 노드로 세고 사진 위 글은 image.overlay다', () => {
    const flow = (...nodes: unknown[]) => ({ section: 'point_div', height: 1000, flow: nodes })
    const onImage = { kind: 'image', slot: 'a', bleed: true, overlay: { anchor: 'top', ink: 'light', nodes: [] } }
    const nested = { kind: 'row', columns: [{ w: 400, nodes: [onImage] }] }
    expect(rowOfTemplate(flow(onImage), { bg: 'W' })).toMatchObject({ overlayText: true, icon: false })
    expect(rowOfTemplate(flow(nested), { bg: 'W' }).overlayText).toBe(true)
    expect(rowOfTemplate(flow({ kind: 'image', slot: 'a' }), { bg: 'W' }).overlayText).toBe(false)
    expect(rowOfTemplate(flow({ kind: 'panel', fill: 'C', nodes: [{ kind: 'icon', slot: 'i' }] }), { bg: 'W' }).icon).toBe(true)
    // 흐름이 없으면 못 센다
    const blank = rowOfTemplate({ section: 'point_div', height: 1000 }, { bg: 'W' })
    expect(blank.overlayText).toBeUndefined()
    expect(blank.icon).toBeUndefined()
  })

  it('장치 — 실제 K 라이브러리에 사진 위 글 템플릿이 있고 전부 사진 위 글로 센다', () => {
    const withOverlay = TEMPLATES.filter((t) => rowOfTemplate(t, { bg: 'W' }).overlayText)
    expect(withOverlay.length).toBeGreaterThan(0)
    expect(withOverlay.every((t) => JSON.stringify(t.flow).includes('"overlay"'))).toBe(true)
  })

  it('실제 K 템플릿 — 칸 이름이 flow라 상자와 치수 도식을 읽는다', () => {
    const dimension = templateById('spec_table.dimension')!
    expect(rowOfTemplate(dimension, { bg: 'W' }).infographics).toContain('치수 도식')
    const darkBand = templateById('spec_table.dark-band')!
    expect(rowOfTemplate(darkBand, { bg: 'W' }).band).toBe('D')
    // 라이브러리 전체에 상자·치수 도식이 있어야 한다 — 칸 이름이 또 바뀌면 여기서 걸린다
    expect(TEMPLATES.filter((t) => rowOfTemplate(t, { bg: 'W' }).band).length).toBeGreaterThan(0)
    expect(TEMPLATES.filter((t) => rowOfTemplate(t, { bg: 'W' }).infographics.includes('치수 도식')).length).toBeGreaterThan(0)
  })

  it('K 계획 줄 — 템플릿을 찾으면 서명을 읽고 문서 높이를 쓴다', () => {
    const kPlan = { order: ['k0_review'], sections: [{ key: 'k0_review', role: 'x', bg: 'W', productImageKey: null, modules: [], templateRef: { id: 'review.a' } }] } as unknown as DesigncutPlan
    const [r] = rowsOfDesigncut(kPlan, { heights: [1234], templateOf: () => ({ section: 'review', height: 2000, signature: { container: 'card', photo: 'none' } }) })
    expect(r).toMatchObject({ section: 'review', key: 'k0_review', height: 1234, container: 'card' })
    expect(r.role).toBeUndefined()
  })
})
