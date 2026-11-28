import { describe, expect, it } from 'vitest'
import type { DesignVocabSnapshot, RoleVocab, VocabShare } from '../design-vocab'
import { assignLayouts, type LayoutAssignInput, type PresetSafetyMatrix } from './layout-assign'
import type { PersuasionRecord } from './persuasion-planner'
import { checkLayoutAdjacency } from './persuasion-rules'

const share = (pairs: Array<[string, number]>): VocabShare[] => pairs.map(([key, s]) => ({ key, share: s }))
function role(
  layout: Array<[string, number]>,
  imageShare: number,
  background: Array<[string, number]> = [['solid', 0.9]]
): RoleVocab {
  return {
    sections: 100,
    prevalence: 0.5,
    positionDist: { opening: 0.2, early: 0.2, middle: 0.2, late: 0.2, closing: 0.2 },
    layout: share(layout),
    background: share(background),
    elements: [],
    copyDevices: [],
    overlay: { imageShare, devices: [] },
    shot: { angle: [], composition: [], lighting: [], staging: [], backdrop: [] },
  }
}
function vocab(levers: Array<{ key: string; pro: number; template: number }> = []): DesignVocabSnapshot {
  const roles = {
    hook: role([['overlay_text', 0.6]], 0.9, [
      ['photo', 0.8],
      ['gradient', 0.1],
    ]),
    product_intro: role(
      [
        ['stack_vertical', 0.5],
        ['card_grid', 0.2],
        ['split_lr', 0.1],
      ],
      0.7,
      [
        ['solid', 0.8],
        ['gradient', 0.08],
      ]
    ),
    usp_feature: role(
      [
        ['list_steps', 0.4],
        ['split_lr', 0.3],
        ['card_grid', 0.2],
      ],
      0.6
    ),
    how_to_guide: role(
      [
        ['table', 0.5],
        ['stack_vertical', 0.3],
      ],
      0.2
    ),
  }
  const platform = {
    pages: 10,
    pooled: { pages: 10, sectionCountMedian: 12, roles },
    byCategory: {},
    tierLevers: levers,
  }
  return { platforms: { coupang: platform, naver: { ...platform, tierLevers: [] } } } as unknown as DesignVocabSnapshot
}
const cell = (mobileSafe: boolean) => ({ safe: true, mobileSafe })
const MATRIX: PresetSafetyMatrix = {
  hook_3step: { overlay: cell(true), gradient: cell(true), bold: cell(true) },
  main_cut: { image_first: cell(true), card: cell(false), split: cell(true), gradient: cell(true) },
  point_div: { stacked: cell(true), split: cell(true), bold: cell(true) },
  sub_div: { stacked: cell(true), split: cell(false) },
}
type Stage = PersuasionRecord['stages'][number]
const st = (section: string, r: string, stage: Stage['stage']): Stage => ({ section, role: r, stage, reason: '' })
const STAGES: Stage[] = [
  st('hook_3step', 'hook', 'ATTENTION'),
  st('main_cut', 'product_intro', 'ATTENTION'),
  st('point_div', 'usp_feature', 'VALUE'),
  st('sub_div', 'usp_feature', 'VALUE'),
  st('hidden_page', 'how_to_guide', 'ASSURANCE'),
  st('product_exposure', 'product_intro', 'VALUE'),
  st('cta', 'cta', 'ACTION'),
]
const ORDER = ['hook_3step', 'main_cut', 'divider', 'point_div', 'sub_div', 'hidden_page', 'product_exposure', 'cta']
const run = (over: Partial<LayoutAssignInput> = {}) =>
  assignLayouts({ sectionOrder: ORDER, stages: STAGES, category: 'household', vocab: vocab(), matrix: MATRIX, ...over })
const bySection = (r: ReturnType<typeof run>) => Object.fromEntries(r.records.map((x) => [x.section, x]))

describe('assignLayouts — E-2 레이아웃 배정', () => {
  it('실측 후보(부록 C)를 행렬 mobileSafe로 거르고, LLM 선택이 후보 안이면 유지·밖이면 1순위', () => {
    const r = bySection(run({ llmSelections: { main_cut: 'card', point_div: 'split' } }))
    expect(r.hook_3step).toMatchObject({ category: 'overlay', source: 'vocab' })
    // product_intro: stack_vertical(사진 비율 0.7 → image_first)·card(모바일 불안전 → 제외)·split
    expect(r.main_cut).toMatchObject({ category: 'image_first', source: 'vocab' })
    expect(r.main_cut.reason).toContain('LLM card는 후보 밖')
    expect(r.point_div).toMatchObject({ category: 'split', source: 'llm' })
  })

  it('앞 섹션과 같으면 다음 후보, 없으면 minimal(conflict) — 구분선은 건너뛰고 인접을 본다', () => {
    const r = bySection(run())
    expect(r.point_div).toMatchObject({ category: 'stacked', source: 'vocab' })
    // sub_div 후보 = stacked(split·card는 모바일 불안전) → 앞과 같아 minimal
    expect(r.sub_div).toMatchObject({ category: 'minimal', source: 'conflict' })
    expect(r.divider).toBeUndefined()
  })

  it('PRESET_EXEMPT는 minimal(전용 디자인 유지), 통과 후보가 없으면 minimal(default)', () => {
    const r = bySection(run({ llmSelections: { cta: 'bold', product_exposure: 'card' } }))
    expect(r.cta).toMatchObject({ category: 'minimal', source: 'default' })
    expect(r.product_exposure).toMatchObject({ category: 'minimal', source: 'default' })
    // how_to_guide: table → minimal, stack_vertical(사진 비율 0.2) → minimal
    expect(r.hidden_page).toMatchObject({ category: 'minimal', source: 'vocab' })
  })

  it('비교 강도 high면 첫 가치 섹션에 split 우선(행렬 통과 시)', () => {
    expect(bySection(run({ comparisonIntensity: 'high' })).point_div.category).toBe('split')
    expect(
      bySection(run({ comparisonIntensity: 'high', llmSelections: { point_div: 'stacked' } })).point_div
    ).toMatchObject({
      category: 'split',
      reason: '비교 강도 high — 첫 가치 섹션 비교형 우선',
    })
    expect(bySection(run({ comparisonIntensity: 'medium' })).point_div.category).toBe('stacked')
  })

  it('스타일 카테고리는 그라데이션 레버 우위 + 역할 배경 분포 + 행렬일 때만, 주목·행동 단계 우선 최대 2곳', () => {
    const llmSelections = { hook_3step: 'gradient', main_cut: 'gradient', point_div: 'bold' }
    const lever = [{ key: 'background:gradient', pro: 0.42, template: 0.18 }]
    const withLever = bySection(run({ vocab: vocab(lever), llmSelections }))
    expect(withLever.hook_3step).toMatchObject({ category: 'gradient', source: 'llm' })
    expect(withLever.main_cut).toMatchObject({ category: 'image_first' }) // gradient 연속은 인접 충돌 → 후보
    // point_div(usp_feature)는 배경 분포에 그라데이션이 없어 스타일 불가
    expect(withLever.point_div.category).toBe('stacked')

    const noLever = bySection(
      run({ vocab: vocab([{ key: 'background:gradient', pro: 0.1, template: 0.2 }]), llmSelections })
    )
    expect(noLever.hook_3step).toMatchObject({ category: 'overlay', source: 'vocab' })
  })

  it('스타일 허용은 페이지당 2곳 — 행동·주목 단계가 먼저', () => {
    const lever = [{ key: 'gradient:any', pro: 0.56, template: 0.31 }]
    const stages = STAGES.map((s) => (s.section === 'point_div' ? { ...s, role: 'product_intro' } : s))
    const order = ['point_div', 'hidden_page', 'hook_3step', 'sub_div', 'main_cut']
    const r = bySection(
      run({
        vocab: vocab(lever),
        stages,
        sectionOrder: order,
        llmSelections: { point_div: 'bold', hook_3step: 'gradient', main_cut: 'gradient' },
      })
    )
    expect(r.hook_3step.category).toBe('gradient')
    expect(r.main_cut.category).toBe('gradient')
    expect(r.point_div.category).not.toBe('bold') // VALUE 단계라 세 번째 — 제외
  })

  it('결과는 결정론이고 인접 중복이 없다(R7 통과)', () => {
    const a = run({ llmSelections: { point_div: 'stacked', sub_div: 'stacked' } })
    expect(run({ llmSelections: { point_div: 'stacked', sub_div: 'stacked' } })).toEqual(a)
    expect(checkLayoutAdjacency(ORDER, a.selections)).toEqual({ id: 'R7', pass: true })
    expect(Object.keys(a.selections)).toEqual(ORDER.filter((s) => s !== 'divider'))
  })
})

describe('checkLayoutAdjacency — R7', () => {
  it('minimal 연속은 중복으로 보지 않는다', () => {
    expect(checkLayoutAdjacency(['a', 'b', 'c'], { a: 'minimal', b: 'minimal', c: 'split' }).pass).toBe(true)
    expect(checkLayoutAdjacency(['a', 'b'], { a: 'split', b: 'split' })).toEqual({
      id: 'R7',
      pass: false,
      detail: '인접 중복: a→b(split)',
    })
  })
})
