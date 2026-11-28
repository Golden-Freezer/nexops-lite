import { describe, expect, it } from 'vitest'
import { getPdpTestProduct, PDP_TEST_PRODUCT_IDS } from '../__fixtures__/pdp-products'
import type { DesigncutBg, PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { CONCEPTS } from './concepts'
import { renderTemplate } from './engine'
import { lineInputsOf } from './input-values'
import { TEMPLATES, templateById } from './library'
import { pageMix } from './page-mix'
import { sampleContext, sampleSlots } from './sample'
import { selectTemplateLine, type TemplateAgents } from './select-line'
import { DEVICE_MAX } from './selection-order'
import {
  assignSurfaces,
  bandFits,
  bandOf,
  CARD_MAX,
  CARD_MIN_WIDTH,
  CATEGORY_SURFACE,
  changeRatio,
  CHANGE_RANGE,
  D_MIN_GAP,
  faceOf,
  hasCard,
  N_CAP,
  NON_WHITE_SHARE,
  photoFace,
  SURFACE_BUDGET,
  surfaceBudgetOf,
  visibleSurfaces,
  W_MAX_RUN,
  type SurfaceRow,
} from './surface-budget'
import type { TemplateMeta, TemplateZone } from './template-meta'
import type { Template } from './template-types'
import { yieldToEventLoop } from './__test__/yield'

const OPEN: TemplateMeta['surfaces'] = ['W', 'T', 'N', 'D']
const page = (n: number, surfaces = OPEN): SurfaceRow[] => Array.from({ length: n }, () => ({ surfaces }))
const countOf = (cells: readonly DesigncutBg[], bg: DesigncutBg) => cells.filter((cell) => cell === bg).length
const touching = (cells: readonly DesigncutBg[], a: DesigncutBg, b: DesigncutBg) =>
  cells.filter((cell, i) => i > 0 && ((cell === a && cells[i - 1] === b) || (cell === b && cells[i - 1] === a))).length
const dGaps = (cells: readonly DesigncutBg[]) => {
  const at = cells.flatMap((cell, i) => (cell === 'D' ? [i] : []))
  return at.slice(1).map((value, i) => value - at[i])
}
const longestWhite = (cells: readonly DesigncutBg[]) => cells.reduce((acc, cell) => (cell === 'W' ? { run: acc.run + 1, best: Math.max(acc.best, acc.run + 1) } : { run: 0, best: acc.best }), { run: 0, best: 0 }).best
const band = (fill: 'D' | 'T', bleed = true) => ({ flow: [{ kind: 'panel', fill, bleed, nodes: [] }] })
const card = (w?: number) => ({ flow: [{ kind: 'panel', fill: 'C', ...(w ? { w } : {}), nodes: [] }] })

describe('바탕 예산', () => {
  it('20섹션 페이지는 리듬별 예산 안이고 흰 바탕이 기본이다', () => {
    for (const rhythm of ['light', 'mixed', 'dark'] as const) {
      const cells = assignSurfaces(page(20), rhythm)
      const budget = SURFACE_BUDGET[rhythm]
      expect(countOf(cells, 'D')).toBe(budget.dGoal)
      expect(countOf(cells, 'T')).toBeLessThanOrEqual(budget.tCap)
      // dark는 짙은 면이 세 칸마다라 연한 면 자리가 남지 않을 수 있다
      expect(countOf(cells, 'T') + countOf(cells, 'D')).toBeGreaterThanOrEqual(1)
      if (rhythm !== 'dark') expect(countOf(cells, 'T')).toBeGreaterThanOrEqual(1)
      expect(countOf(cells, 'N')).toBeLessThanOrEqual(N_CAP)
      expect((countOf(cells, 'W') + countOf(cells, 'N')) / cells.length).toBeGreaterThanOrEqual(1 - NON_WHITE_SHARE[rhythm])
      expect(changeRatio(cells)).toBeGreaterThanOrEqual(CHANGE_RANGE.min)
      expect(changeRatio(cells)).toBeLessThanOrEqual(CHANGE_RANGE.max)
      expect(longestWhite(cells)).toBeLessThanOrEqual(W_MAX_RUN)
      expect(touching(cells, 'T', 'N')).toBe(0)
      expect(touching(cells, 'T', 'T')).toBe(0)
      expect(touching(cells, 'T', 'D')).toBe(0)
      for (const gap of dGaps(cells)) expect(gap).toBeGreaterThanOrEqual(D_MIN_GAP)
      expect(cells[0]).toBe('W')
      expect(cells.at(-1)).toBe('W')
    }
  })

  it('짧은 페이지는 연한 면을 줄여 흰 계열 70%를 지킨다', () => {
    const cells = assignSurfaces(page(16), 'mixed')
    expect(countOf(cells, 'D')).toBe(2)
    expect(countOf(cells, 'T')).toBe(2)
    expect((countOf(cells, 'W') + countOf(cells, 'N')) / cells.length).toBeGreaterThanOrEqual(0.7)
  })

  it('dark는 짙은 면 6칸 위에 연한 면도 둔다 — 비흰 상한 50%(K9 후보 2, 30%면 연한 면이 1칸으로 준다)', () => {
    const cells = assignSurfaces(page(24), 'dark')
    expect(countOf(cells, 'D')).toBe(6)
    expect(countOf(cells, 'T')).toBe(2)
    expect((countOf(cells, 'W') + countOf(cells, 'N')) / cells.length).toBeGreaterThanOrEqual(1 - NON_WHITE_SHARE.dark)
  })

  it('짙은 면은 우선 섹션, 연한 면은 사용법·질문 자리로 간다', () => {
    const rows: SurfaceRow[] = page(20, ['W', 'T', 'N']).map((row, i) => (i === 7 ? { surfaces: OPEN, section: 'concept_desc' } : { ...row, section: i === 12 ? 'solution_guide' : 'sub_div' }))
    const cells = assignSurfaces(rows, 'mixed')
    expect(cells[7]).toBe('D')
    expect(cells[12]).toBe('T')
  })

  it('사용법 자리는 짙은 면을 가장 뒤로 미룬다', () => {
    const sections: Record<number, string> = { 5: 'solution_guide', 10: 'petit_div', 15: 'petit_div' }
    const rows: SurfaceRow[] = page(20, ['W', 'N']).map((row, i) => (sections[i] ? { surfaces: OPEN, section: sections[i] } : row))
    const cells = assignSurfaces(rows, 'mixed')
    expect(cells[5]).not.toBe('D')
    expect(cells[10]).toBe('D')
    expect(cells[15]).toBe('D')
  })

  it('큰 POINT 구간 안에는 연한 면을 넣지 않고 회색 면은 넣을 수 있다', () => {
    const rows: SurfaceRow[] = page(20).map((row, i) => ({ ...row, section: i >= 6 && i <= 14 && i % 2 === 0 ? 'point_div' : 'sub_div' }))
    const cells = assignSurfaces(rows, 'light')
    expect(cells.slice(6, 15)).not.toContain('T')
    expect(countOf(cells, 'T')).toBeGreaterThanOrEqual(1)
  })

  it('간격이 같으면 구역이 바뀌는 자리를 앞세운다', () => {
    const zoneOf = (i: number): TemplateZone => (i < 11 ? 'value' : 'trust')
    const rows: SurfaceRow[] = page(20).map((row, i) => ({ ...row, order: { zone: zoneOf(i), notNextTo: [] } }))
    const withZones = assignSurfaces(rows, 'mixed')
    const without = assignSurfaces(page(20), 'mixed')
    expect(without[11]).not.toBe('D')
    expect(withZones[11]).toBe('D')
  })

  it('예산을 다 쓰고 흰 바탕이 길면 놓은 면을 그 안으로 옮긴다 — 개수는 그대로다', () => {
    // 앞쪽 세 칸만 회색 면을 받고, 뒤쪽 긴 묶음은 연한 면만 받는다
    const rows: SurfaceRow[] = Array.from({ length: 16 }, (_, i) => ({ surfaces: (i < 8 ? ['W', 'N'] : ['W', 'T']) as TemplateMeta['surfaces'] }))
    const cells = assignSurfaces(rows, 'light')
    expect(longestWhite(cells)).toBeLessThanOrEqual(W_MAX_RUN)
    expect(countOf(cells, 'T')).toBeLessThanOrEqual(SURFACE_BUDGET.light.tCap)
    expect(countOf(cells, 'N')).toBeLessThanOrEqual(N_CAP)
    expect(touching(cells, 'T', 'N')).toBe(0)
    expect(touching(cells, 'T', 'T')).toBe(0)
  })

  it('긴 흰 바탕 안 카드 칸은 연한 면으로 바꾼다 — 카드가 흰색이 되어 연한 면 수는 그대로다', () => {
    const rows: SurfaceRow[] = Array.from({ length: 12 }, (_, i) => (i === 5 ? { surfaces: ['W', 'T'] as TemplateMeta['surfaces'], ...card() } : { surfaces: ['W'] as TemplateMeta['surfaces'] }))
    const cells = assignSurfaces(rows, 'light')
    expect(cells[5]).toBe('T')
    expect(countOf(cells, 'T')).toBe(1)
  })

  it('옮길 칸이 없으면 흰 바탕이 길어도 그대로 둔다', () => {
    expect(assignSurfaces(page(12, ['W']), 'light')).toEqual(Array(12).fill('W'))
  })

  it('이웃 다름 상한을 넘기면 더 넣지 않는다', () => {
    expect(changeRatio(assignSurfaces(page(5, ['W', 'N', 'D']), 'dark'))).toBeLessThanOrEqual(CHANGE_RANGE.max)
    expect(changeRatio(assignSurfaces(page(8), 'mixed'))).toBeLessThanOrEqual(CHANGE_RANGE.max)
  })

  it('받는 바탕 안에서만 고른다', () => {
    for (const rhythm of ['light', 'mixed', 'dark'] as const) {
      expect(assignSurfaces(page(20, ['W']), rhythm)).toEqual(Array(20).fill('W'))
      for (const bg of assignSurfaces(page(20, ['W', 'N']), rhythm)) expect(['W', 'N']).toContain(bg)
    }
  })
})

describe('풀폭 상자', () => {
  it('풀폭 상자만 센다 — 칸 안의 상자는 아니다', () => {
    expect(bandOf(band('D'))).toBe('D')
    expect(bandOf(band('T'))).toBe('T')
    expect(bandOf(band('T', false))).toBeNull()
    expect(bandOf({ flow: [{ kind: 'row', columns: [{ nodes: [{ kind: 'panel', fill: 'D', bleed: true }] }] }] })).toBe('D')
    expect(bandOf({})).toBeNull()
    expect(bandOf(templateById('spec_table.dark-band') as unknown as Pick<TemplateMeta, 'flow'>)).toBe('D')
    expect(bandOf(templateById('faq.light-band') as unknown as Pick<TemplateMeta, 'flow'>)).toBe('T')
    expect(bandOf(templateById('compare.bubble-points') as unknown as Pick<TemplateMeta, 'flow'>)).toBeNull()
  })

  it('상자도 예산에 들어 바탕으로 더 주지 않고, 이웃도 상자 색으로 본다', () => {
    const rows: SurfaceRow[] = page(20)
    rows[5] = { surfaces: ['W'], ...band('D') }
    rows[12] = { surfaces: ['W'], ...band('D') }
    const backgrounds = assignSurfaces(rows, 'mixed')
    const cells = visibleSurfaces(rows, backgrounds)
    expect(backgrounds).not.toContain('D')
    expect(countOf(cells, 'D')).toBe(2)
    expect(touching(cells, 'T', 'D')).toBe(0)
  })

  it('짙은 띠는 끝 자리와 첫 자리(dark 리듬은 첫 자리 허용)에 못 오고, 예산과 간격을 넘지 못한다', () => {
    const dark = band('D')
    const plain = { flow: [] }
    expect(bandFits(dark, [], false, 'mixed')).toBe(false)
    expect(bandFits(dark, [], false, 'dark')).toBe(true)
    expect(bandFits(dark, [plain, plain, plain], true, 'dark')).toBe(false)
    // dark 상한 7 — 간격 3을 지키며 일곱째까지 받고 여덟째는 못 받는다
    const seven = Array.from({ length: 21 }, (_, i) => (i % 3 === 0 ? dark : plain))
    expect(bandFits(dark, seven.slice(0, 18), false, 'dark')).toBe(true)
    expect(bandFits(dark, seven, false, 'dark')).toBe(false)
    expect(bandFits(dark, [plain, plain, plain], false, 'light')).toBe(false)
    expect(bandFits(dark, [plain, plain, plain], false, 'mixed')).toBe(true)
    expect(bandFits(dark, [plain, dark, plain, plain, dark, plain, plain], false, 'mixed')).toBe(false)
    expect(bandFits(dark, [plain, dark, plain], false, 'dark')).toBe(false)
    expect(bandFits(plain, [], true, 'light')).toBe(true)
  })

  it('흐름 맨 위 풀폭 사진 위 글은 사진 얼굴 P다 — 칸 안 사진·overlay 없는 풀폭 사진·둘째 노드는 아니다(T1-30)', () => {
    const photo = (extra: Record<string, unknown>) => ({ flow: [{ kind: 'image', slot: 'hero', bleed: true, overlay: { anchor: 'top', ink: 'light', nodes: [] }, ...extra }] })
    expect(photoFace(photo({}))).toBe(true)
    expect(faceOf(photo({}))).toBe('P')
    expect(photoFace(photo({ bleed: false }))).toBe(false)
    expect(photoFace(photo({ overlay: undefined }))).toBe(false)
    expect(photoFace({ flow: [{ kind: 'text', slot: 'h' }, ...photo({}).flow] })).toBe(false)
    expect(faceOf(band('D'))).toBe('D')
    expect(faceOf({ flow: [] })).toBeNull()
    // 지금 라이브러리의 사진 위 글 템플릿은 모두 흐름 맨 위다(lint overlay) — 모두 P로 보인다
    const withOverlay = (TEMPLATES as unknown as Array<Template & Pick<TemplateMeta, 'flow'>>).filter((t) => JSON.stringify(t.flow).includes('"overlay":'))
    expect(withOverlay.map((t) => t.id).sort()).toEqual([
      'concept_desc.food-scene-overlay-story',
      'concept_desc.overlay-bottom-story',
      'cta.fashion-worn-overlay-top',
      'cta.overlay-bottom-center',
      'event_offer.overlay-top-left',
      'hook_3step.overlay-bottom-left',
      'hook_3step.overlay-top-center',
      'key_message.fashion-worn-overlay-bottom',
      'key_message.overlay-top-center',
      'key_message.overlay-top-left',
    ])
    for (const t of withOverlay) expect(faceOf(t), t.id).toBe('P')
  })

  it('사진 얼굴은 이웃 다름·흰 바탕 연속엔 들고 D·T·N 개수엔 안 든다 — 그 칸엔 바탕을 주지 않는다(T1-30)', () => {
    const photo = { flow: [{ kind: 'image', slot: 'hero', bleed: true, overlay: { anchor: 'top', ink: 'light', nodes: [] } }] }
    // 흰 바탕만 받는 칸 사이에 사진 칸 — P가 없으면 흰 바탕 7칸 연속·이웃 다름 0이다
    const whiteOnly = () => ({ surfaces: ['W'] as TemplateMeta['surfaces'] })
    const rows: SurfaceRow[] = [whiteOnly(), whiteOnly(), whiteOnly(), { surfaces: ['W', 'N'], ...photo }, whiteOnly(), whiteOnly(), whiteOnly()]
    const backgrounds = assignSurfaces(rows, 'light')
    const cells = visibleSurfaces(rows, backgrounds)
    expect(backgrounds[3]).toBe('W')
    expect(cells).toEqual(['W', 'W', 'W', 'P', 'W', 'W', 'W'])
    expect(changeRatio(cells)).toBeCloseTo(2 / 6)
    expect(longestWhite(cells)).toBe(3)
    // 바탕을 받을 수 있는 칸이 사진 칸뿐이어도 D·T·N을 주지 않는다 — 사진에 가린다
    const onlyPhoto: SurfaceRow[] = [whiteOnly(), whiteOnly(), { surfaces: OPEN, ...photo }, whiteOnly(), whiteOnly()]
    for (const rhythm of ['light', 'mixed', 'dark'] as const) expect(assignSurfaces(onlyPhoto, rhythm), rhythm).toEqual(['W', 'W', 'W', 'W', 'W'])
    // 사진 칸이 W를 받는 칸이라도 D·T·N을 주지 않고, 예산은 사진이 없을 때와 같은 수를 쓴다
    for (const rhythm of ['light', 'mixed', 'dark'] as const) {
      const mid: SurfaceRow[] = page(20)
      mid[6] = { surfaces: OPEN, ...photo }
      mid[13] = { surfaces: OPEN, ...photo }
      const got = assignSurfaces(mid, rhythm)
      const seen = visibleSurfaces(mid, got)
      expect([got[6], got[13]], rhythm).toEqual(['W', 'W'])
      expect([seen[6], seen[13]], rhythm).toEqual(['P', 'P'])
      const budget = SURFACE_BUDGET[rhythm]
      expect(countOf(seen, 'D'), rhythm).toBeLessThanOrEqual(budget.dCap)
      expect(countOf(seen, 'T'), rhythm).toBeLessThanOrEqual(budget.tCap)
      expect(countOf(seen, 'N'), rhythm).toBeLessThanOrEqual(N_CAP)
      // P는 개수에 안 들어 light·mixed의 D·T는 사진이 없을 때와 같은 수다. dark는 짙은 면 간격 3 자리를 사진이 차지해 줄 수 있다.
      // 회색 면은 이웃 다름을 채우려고 넣는 면이라, 사진이 이웃 다름을 올리면 상한(0.75) 앞에서 덜 넣는다
      const plain = assignSurfaces(page(20), rhythm)
      if (rhythm !== 'dark') for (const bg of ['D', 'T'] as const) expect(countOf(seen, bg), `${rhythm} ${bg}`).toBe(countOf(plain, bg))
      expect(countOf(seen, 'N'), rhythm).toBeLessThanOrEqual(countOf(plain, 'N'))
      expect(changeRatio(seen), rhythm).toBeLessThanOrEqual(CHANGE_RANGE.max)
    }
  })

  it('연한 띠는 연한 면·짙은 면 옆에 오지 않고 예산을 넘지 못한다', () => {
    const tint = band('T')
    const plain = { flow: [] }
    expect(bandFits(tint, [tint], false, 'light')).toBe(false)
    expect(bandFits(tint, [band('D')], false, 'mixed')).toBe(false)
    expect(bandFits(band('D'), [plain, tint], false, 'mixed')).toBe(false)
    expect(bandFits(tint, [plain, tint, plain, tint, plain], false, 'dark')).toBe(false)
    expect(bandFits(tint, [plain, tint, plain, tint, plain], false, 'light')).toBe(true)
  })
})

describe('카테고리별 T 상한·D 보정(적용 K3 T1-27, 연구 A3 3.4절 표)', () => {
  it('표 값 — 패션 T1·뷰티 T3 D-1·식품 T3·주방·가구·생활 T2·디지털 T2 D+1, 반려·문구·포장은 못 봄이라 넣지 않는다', () => {
    expect(CATEGORY_SURFACE).toEqual({
      fashion: { tCap: 1, dShift: 0 },
      beauty: { tCap: 3, dShift: -1 },
      food: { tCap: 3, dShift: 0 },
      household: { tCap: 2, dShift: 0 },
      digital: { tCap: 2, dShift: 1 },
    })
  })

  it('보정은 mixed·dark에만 — T 상한은 리듬 값과 작은 쪽, D 보정은 리듬 값에 더한다. light는 카테고리와 상관없이 리듬 값 그대로다', () => {
    expect(surfaceBudgetOf('mixed', 'fashion')).toEqual({ dCap: 2, dGoal: 2, tCap: 1 })
    expect(surfaceBudgetOf('mixed', 'beauty')).toEqual({ dCap: 1, dGoal: 1, tCap: 3 })
    expect(surfaceBudgetOf('mixed', 'digital')).toEqual({ dCap: 3, dGoal: 3, tCap: 2 })
    expect(surfaceBudgetOf('dark', 'beauty')).toEqual({ dCap: 6, dGoal: 5, tCap: 2 })
    expect(surfaceBudgetOf('dark', 'digital')).toEqual({ dCap: 8, dGoal: 7, tCap: 2 })
    for (const category of Object.keys(CATEGORY_SURFACE)) expect(surfaceBudgetOf('light', category)).toEqual(SURFACE_BUDGET.light)
    for (const rhythm of ['light', 'mixed', 'dark'] as const) {
      for (const category of [undefined, '', 'pet', 'stationery', 'packaging']) expect(surfaceBudgetOf(rhythm, category)).toEqual(SURFACE_BUDGET[rhythm])
    }
  })

  it('배정은 카테고리 예산을 따른다 — 패션 mixed는 연한 면 1칸, 디지털 mixed는 짙은 면 3칸, 뷰티 mixed는 1칸, light는 그대로', () => {
    expect(countOf(assignSurfaces(page(20), 'mixed', 'fashion'), 'T')).toBe(1)
    expect(countOf(assignSurfaces(page(20), 'mixed'), 'T')).toBeGreaterThan(1)
    expect(countOf(assignSurfaces(page(20), 'mixed', 'digital'), 'D')).toBe(3)
    expect(countOf(assignSurfaces(page(20), 'mixed', 'beauty'), 'D')).toBe(1)
    for (const category of Object.keys(CATEGORY_SURFACE)) expect(assignSurfaces(page(20), 'light', category)).toEqual(assignSurfaces(page(20), 'light'))
  })

  it('순서 풀이의 띠 판정도 카테고리 상한을 본다 — 패션 mixed는 연한 띠·큰 카드가 하나면 둘째를 받지 않고, light는 그대로 받는다', () => {
    const tint = band('T')
    const plain = { flow: [] }
    expect(bandFits(tint, [plain, tint, plain], false, 'mixed')).toBe(true)
    expect(bandFits(tint, [plain, tint, plain], false, 'mixed', 'fashion')).toBe(false)
    expect(bandFits(card(), [plain, tint, plain], false, 'mixed', 'fashion')).toBe(false)
    expect(bandFits(tint, [plain, tint, plain], false, 'light', 'fashion')).toBe(true)
    expect(bandFits(band('D'), [plain, plain, plain], false, 'mixed', 'beauty')).toBe(true)
    expect(bandFits(band('D'), [plain, band('D'), plain, plain, plain], false, 'mixed', 'beauty')).toBe(false)
  })
})

describe('큰 카드 색 C', () => {
  it('칸 안 넓은 C 상자만 센다 — 풀폭·좁은 칸은 아니다', () => {
    expect(hasCard(card())).toBe(true)
    expect(hasCard(card(CARD_MIN_WIDTH))).toBe(true)
    expect(hasCard(card(CARD_MIN_WIDTH - 1))).toBe(false)
    expect(hasCard({ flow: [{ kind: 'panel', fill: 'C', bleed: true, nodes: [] }] })).toBe(false)
    expect(hasCard(band('T', false))).toBe(false)
    expect(hasCard({ flow: [{ kind: 'row', columns: [{ nodes: [{ kind: 'panel', fill: 'C' }] }] }] })).toBe(true)
  })

  it('C 칸이 있는 템플릿은 필수 값만 그려도 K0 기준(줄 폭 25%·세로 90px, 390 기준)을 넘는다 — 작은 칸이 생기면 세는 법을 다시 본다', () => {
    const withCard = (TEMPLATES as unknown as Template[]).filter((t) => hasCard(t as unknown as Pick<TemplateMeta, 'flow'>))
    expect(withCard.length).toBeGreaterThan(0)
    for (const t of withCard) {
      const result = renderTemplate(t, sampleSlots(t, { mode: 'full' }), sampleContext())
      const panels = (result?.elements ?? []).filter((e) => e.name === 'designcut-panel')
      expect(panels.length, t.id).toBeGreaterThan(0)
      for (const panel of panels) {
        expect(panel.transform.width, t.id).toBeGreaterThanOrEqual(CARD_MIN_WIDTH)
        expect(panel.transform.height, t.id).toBeGreaterThanOrEqual((90 * 860) / 390)
      }
    }
  })

  it('순서 풀이는 카드를 페이지당 상한까지만 받고, 연한 띠와 상한을 나눠 쓴다', () => {
    const plain = { flow: [] }
    expect(CARD_MAX).toBe(1)
    expect(bandFits(card(), [plain], false, 'light')).toBe(true)
    expect(bandFits(card(), [card()], false, 'light')).toBe(false)
    expect(bandFits(card(), [band('T'), plain, band('T'), plain, band('T'), plain], false, 'light')).toBe(false)
    expect(bandFits(card(), [band('T'), plain, band('T'), plain], false, 'dark')).toBe(false)
    expect(bandFits(band('T'), [band('T'), plain, band('T'), plain, card(), plain], false, 'light')).toBe(false)
    expect(bandFits(band('T'), [card(), plain], false, 'light')).toBe(true)
  })

  it('바탕 배정은 흰 바탕 위 카드를 연한 면으로 세고, 그 칸과 옆에 연한 면을 넣지 않는다', () => {
    const rows: SurfaceRow[] = Array.from({ length: 20 }, (_, i) => ({ surfaces: OPEN, ...(i === 8 ? card() : {}) }))
    const without = assignSurfaces(page(20), 'light')
    const cells = assignSurfaces(rows, 'light')
    expect(countOf(without, 'T')).toBe(SURFACE_BUDGET.light.tCap)
    expect(countOf(cells, 'T')).toBe(SURFACE_BUDGET.light.tCap - 1)
    expect([cells[7], cells[8], cells[9]]).not.toContain('T')
  })
})

/** 근거 있는 입력 — 11상품 기본 입력에는 후기·별점·인증 섹션이 없어 그 자리의 바탕을 못 본다(K0 P11 흰 바탕 6칸) */
const WITH_PROOF = { reviewQuotes: [{ text: 'x' }], rating: 4.8, reviewCount: 120, certificationInfo: '시험 성적서 있음' }

describe('시험 상품 전 컨셉', () => {
  const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
  const agentsFor = (conceptId: string) =>
    ({
      guideline: async () => free({ persona: '', tone: '', concept: { id: conceptId, reason: '' }, alternatives: [] }),
      compose: async () => free([]),
      select: async ({ slots }: { slots: Array<{ index: number; candidates: Array<{ id: string }> }> }) => free(slots.map((s) => ({ index: s.index, templateId: s.candidates[0].id, reason: '' }))),
    }) as unknown as TemplateAgents

  it.each([
    ['기본 입력', false],
    ['근거 있는 입력', true],
  ])('11상품 × 44컨셉 페이지가 예산과 이웃 규칙, 부품·틀 상한을 지킨다 — %s', async (_name, withProof) => {
    const pages: Array<{ rhythm: keyof typeof SURFACE_BUDGET; category: string; cells: DesigncutBg[]; cards: number; label: string }> = []
    const mixes: Array<{ devices: ReturnType<typeof pageMix>['devices']; ids: string[]; label: string }> = []
    for (const id of PDP_TEST_PRODUCT_IDS) {
      await yieldToEventLoop()
      const product = getPdpTestProduct(id)
      const spec = (withProof ? { ...product.specSheet, ...WITH_PROOF } : product.specSheet) as PdpSpecSheet
      const inputs = lineInputsOf({ spec_sheet: spec, analysis: {}, copy_sections: { final: { options: spec.colorOptions ?? [] } } } as unknown as PdpJobRow)
      for (const concept of CONCEPTS) {
        await yieldToEventLoop()
        const { order } = await selectTemplateLine(
          {
            key: id,
            categoryKey: product.categoryKey,
            productHex: null,
            spec,
            templates: TEMPLATES as unknown as TemplateMeta[],
            inputs,
            product: { category: product.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] },
          },
          agentsFor(concept.id)
        )
        const rows = order.sections.map((s) => templateById(s.templateId) as unknown as TemplateMeta)
        const cells = visibleSurfaces(rows, order.sections.map((s) => s.bg))
        pages.push({ rhythm: concept.rhythm, category: product.categoryKey, cells, cards: rows.filter((row, i) => hasCard(row) && cells[i] === 'W').length, label: `${id}·${concept.id}` })
        mixes.push({ devices: pageMix(rows).devices, ids: rows.map((row) => row.id), label: `${id}·${concept.id}` })
      }
    }
    expect(pages).toHaveLength(PDP_TEST_PRODUCT_IDS.length * CONCEPTS.length)

    // K9 후보 2 — dark 리듬은 짙은 면이 늘고(4칸 이상이 거의 반, 전에는 상한 4·중앙 3) 첫 화면 짙은 띠가 생긴다. 다른 리듬은 첫 자리 짙은 띠가 없다.
    // K4 ①(POINT 둘째 사진)로 POINT가 길어져 채움 고르기·자리가 바뀌어 4칸 이상 쪽이 34·38/66 → 32·32/66이 됐다(평균 짙은 면 3.50·3.65 → 3.47·3.58,
    // 쪽마다 ±1 양방향). 하한 0.5는 경계라 0.45로 둔다
    const darkPages = pages.filter(({ rhythm }) => rhythm === 'dark')
    expect(darkPages.filter(({ cells }) => countOf(cells, 'D') >= 4).length / darkPages.length).toBeGreaterThanOrEqual(0.45)
    expect(darkPages.some(({ cells }) => countOf(cells, 'D') > 4)).toBe(true)
    expect(darkPages.some(({ cells }) => cells[0] === 'D')).toBe(true)

    // 어기면 안 되는 규칙 — 모든 페이지
    for (const { rhythm, category, cells, cards, label } of pages) {
      const budget = surfaceBudgetOf(rhythm, category)
      expect(countOf(cells, 'D'), label).toBeLessThanOrEqual(budget.dCap)
      expect(countOf(cells, 'T') + cards, label).toBeLessThanOrEqual(budget.tCap)
      expect(cards, label).toBeLessThanOrEqual(CARD_MAX)
      expect(countOf(cells, 'N'), label).toBeLessThanOrEqual(N_CAP)
      expect(touching(cells, 'T', 'N'), label).toBe(0)
      expect(touching(cells, 'T', 'T'), label).toBe(0)
      expect(touching(cells, 'T', 'D'), label).toBe(0)
      for (const gap of dGaps(cells)) expect(gap, label).toBeGreaterThanOrEqual(D_MIN_GAP)
      if (rhythm !== 'dark') expect(cells[0], label).not.toBe('D')
      expect(cells.at(-1), label).not.toBe('D')
    }

    // 같은 페이지의 구성 상한(적용 K3) — 말풍선·원·아치 틀은 큰 POINT까지 세어 2곳까지(P08 candy-pop 말풍선 3곳·한 쪽 틀 5곳이 있었다),
    // 닮은 짝 point_list_div.circle-trio·icon-trio(가운데 제목+둥근 것 셋+이름표, #555 A 지적)는 한 페이지에 함께 들지 않는다
    // 예외였던 근거 있는 입력의 P04·cloud-soft(질문 섹션의 말풍선 없는 후보가 모두 바탕 예산에 막혀 말풍선이 셋째가 됨)는 적용 K5 ①-a 제품군 칸으로
    // 메인이 말풍선 없는 칸(main_cut.tool-plate-title-pair)이 되어 말풍선 2곳이 됐다. 원인(바탕 예산과 섹션 빼기 중 무엇을 양보할지)은 그대로라 다시 생기면 여기서 잡는다
    const bubbleOver = mixes.filter(({ devices }) => devices.bubble > DEVICE_MAX).map(({ label }) => label)
    expect(bubbleOver).toEqual([])
    for (const { devices, ids, label } of mixes) {
      expect(devices.frame, label).toBeLessThanOrEqual(DEVICE_MAX)
      expect(ids.includes('point_list_div.circle-trio') && ids.includes('point_list_div.icon-trio'), label).toBe(false)
    }

    // 목표 — 받는 바탕이 흰색뿐인 템플릿이 몰리면 못 지키는 페이지가 있어 비율로 본다
    const long = pages.filter(({ cells }) => cells.length >= 18)
    const share = <T,>(list: readonly T[], test: (item: T) => boolean) => list.filter(test).length / list.length
    expect(share(long, ({ cells }) => changeRatio(cells) >= CHANGE_RANGE.min && changeRatio(cells) <= CHANGE_RANGE.max)).toBeGreaterThanOrEqual(0.95)
    expect(share(pages, ({ rhythm, cells }) => (countOf(cells, 'W') + countOf(cells, 'N')) / cells.length >= 1 - NON_WHITE_SHARE[rhythm])).toBeGreaterThanOrEqual(0.95)
    expect(share(pages, ({ cells }) => longestWhite(cells) <= W_MAX_RUN)).toBeGreaterThanOrEqual(0.995)
    expect(share(pages, ({ cells }) => countOf(cells, 'T') >= 1 || countOf(cells, 'D') >= 1)).toBeGreaterThanOrEqual(0.95)
  }, 120000)

  it.each([
    ['기본 입력', false],
    ['근거 있는 입력', true],
  ])('첫째 후보를 고른 11상품 기본 페이지는 흰 바탕이 W_MAX_RUN을 넘지 않는다 — %s', async (_name, withProof) => {
    for (const id of PDP_TEST_PRODUCT_IDS) {
      await yieldToEventLoop()
      const product = getPdpTestProduct(id)
      const spec = (withProof ? { ...product.specSheet, ...WITH_PROOF } : product.specSheet) as PdpSpecSheet
      const inputs = lineInputsOf({ spec_sheet: spec, analysis: {}, copy_sections: { final: { options: spec.colorOptions ?? [] } } } as unknown as PdpJobRow)
      const agents = {
        guideline: async ({ concepts }: { concepts: Array<{ id: string }> }) => free({ persona: '', tone: '', concept: { id: concepts[0].id, reason: '' }, alternatives: [] }),
        compose: async () => free([]),
        select: async ({ slots }: { slots: Array<{ index: number; candidates: Array<{ id: string }> }> }) => free(slots.map((s) => ({ index: s.index, templateId: s.candidates[0].id, reason: '' }))),
      } as unknown as TemplateAgents
      const { order } = await selectTemplateLine(
        { key: id, categoryKey: product.categoryKey, productHex: null, spec, templates: TEMPLATES as unknown as TemplateMeta[], inputs, product: { category: product.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] } },
        agents
      )
      const rows = order.sections.map((s) => templateById(s.templateId) as unknown as TemplateMeta)
      expect(longestWhite(visibleSurfaces(rows, order.sections.map((s) => s.bg))), id).toBeLessThanOrEqual(W_MAX_RUN)
    }
  }, 60000)
})
